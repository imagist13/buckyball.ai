/** Grok Imagine image/video client backed by the existing Grok Build OAuth bundle. */
import fs from 'node:fs';
import path from 'node:path';
import type { MediaBlock } from '@/types';
import { envProxyFetch } from './env-proxy-fetch';
import { saveMediaToLibrary } from './media-saver';
import { createXaiOAuthMediaFetch } from './xai-oauth-manager';

export const XAI_IMAGINE_IMAGE_MODEL = 'grok-imagine-image-2.0';
export const XAI_IMAGINE_VIDEO_MODEL = 'grok-imagine-video-1.5';
export const XAI_IMAGINE_API_BASE_URL = 'https://api.x.ai/v1';

const IMAGE_TIMEOUT_MS = 300_000;
const VIDEO_TIMEOUT_MS = 300_000;
const VIDEO_POLL_INTERVAL_MS = 5_000;
const VIDEO_DOWNLOAD_TIMEOUT_MS = 120_000;
const MAX_REFERENCE_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_GENERATED_IMAGE_BYTES = 50 * 1024 * 1024;
const MAX_GENERATED_VIDEO_BYTES = 250 * 1024 * 1024;
const ALLOWED_VIDEO_DOWNLOAD_HOSTS = new Set(['vidgen.x.ai', 'files-cdn.x.ai']);

const IMAGE_ASPECT_RATIOS = new Set([
  '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3',
  '2:1', '1:2', '19.5:9', '9:19.5', '20:9', '9:20', 'auto',
]);
const VIDEO_ASPECT_RATIOS = new Set(['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3']);
const VIDEO_RESOLUTIONS = new Set(['480p', '720p']);
const VIDEO_DURATIONS = new Set([6, 10]);

export class XaiImagineError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'XaiImagineError';
  }
}

export interface XaiImagineImageInput {
  prompt: string;
  aspectRatio?: string;
  resolution?: '1k' | '2k';
  quality?: 'low' | 'medium';
  referenceImages?: Array<{ mimeType: string; data: string }>;
  abortSignal?: AbortSignal;
}

export interface XaiImagineImageOutput {
  bytes: Uint8Array;
  mimeType: string;
  model: string;
}

export interface GenerateGrokVideoInput {
  prompt: string;
  imagePath?: string;
  referenceImagePaths?: string[];
  duration?: 6 | 10;
  aspectRatio?: string;
  resolution?: '480p' | '720p';
  sessionId?: string;
  runtimeId?: string;
  cwd?: string;
  abortSignal?: AbortSignal;
}

export interface GenerateGrokVideoOutput {
  mediaGenerationId: string;
  localPath: string;
  mimeType: 'video/mp4';
  model: string;
  elapsedMs: number;
  requestId: string;
}

interface XaiImagineTestOptions {
  fetchImpl?: typeof fetch;
  downloadFetchImpl?: typeof fetch;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

function combinedSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function assertPrompt(prompt: string): string {
  const value = prompt.trim();
  if (!value) throw new XaiImagineError('Grok Imagine requires a non-empty prompt.', undefined, 'INVALID_PROMPT');
  return value;
}

function inferImageMime(bytes: Uint8Array): string {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 12 && Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF'
    && Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP') return 'image/webp';
  return 'image/jpeg';
}

function imageExtensionMime(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.png': return 'image/png';
    case '.webp': return 'image/webp';
    case '.gif': return 'image/gif';
    case '.avif': return 'image/avif';
    case '.jpg':
    case '.jpeg':
    default: return 'image/jpeg';
  }
}

function referencePathToDataUrl(filePath: string, cwd?: string): { mimeType: string; data: string } {
  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(cwd || process.cwd(), filePath);
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw new XaiImagineError(`Reference image is not a file: ${resolved}`, undefined, 'INVALID_REFERENCE');
  if (stat.size > MAX_REFERENCE_IMAGE_BYTES) {
    throw new XaiImagineError(`Reference image exceeds ${MAX_REFERENCE_IMAGE_BYTES} bytes: ${resolved}`, undefined, 'REFERENCE_TOO_LARGE');
  }
  return { mimeType: imageExtensionMime(resolved), data: fs.readFileSync(resolved).toString('base64') };
}

function asImageReference(image: { mimeType: string; data: string }): { url: string } {
  if (!/^image\/[A-Za-z0-9.+-]+$/.test(image.mimeType) || !image.data) {
    throw new XaiImagineError('Invalid reference image payload.', undefined, 'INVALID_REFERENCE');
  }
  return { url: `data:${image.mimeType};base64,${image.data}` };
}

async function readJsonResponse<T>(response: Response, operation: string): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    const preview = text.replace(/\s+/g, ' ').slice(0, 500);
    throw new XaiImagineError(
      `${operation} failed with HTTP ${response.status}${preview ? `: ${preview}` : ''}`,
      response.status,
      response.status === 401 ? 'AUTH_REQUIRED' : response.status === 403 ? 'ENTITLEMENT_REQUIRED' : 'HTTP_FAILURE',
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new XaiImagineError(`${operation} returned invalid JSON.`, response.status, 'INVALID_RESPONSE');
  }
}

async function readBoundedResponseBytes(response: Response, maxBytes: number): Promise<Buffer> {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new XaiImagineError(`Grok Imagine media exceeds the ${maxBytes}-byte download limit.`, response.status, 'OUTPUT_TOO_LARGE');
  }
  if (!response.body) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) throw new XaiImagineError(`Grok Imagine media exceeds the ${maxBytes}-byte download limit.`, response.status, 'OUTPUT_TOO_LARGE');
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new XaiImagineError(`Grok Imagine media exceeds the ${maxBytes}-byte download limit.`, response.status, 'OUTPUT_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), total);
}

export async function requestGrokImagineImage(
  input: XaiImagineImageInput,
  options: XaiImagineTestOptions = {},
): Promise<XaiImagineImageOutput> {
  const prompt = assertPrompt(input.prompt);
  const aspectRatio = input.aspectRatio || '1:1';
  if (!IMAGE_ASPECT_RATIOS.has(aspectRatio)) {
    throw new XaiImagineError(`Unsupported Grok Imagine image aspect ratio: ${aspectRatio}`, undefined, 'INVALID_ASPECT_RATIO');
  }
  const references = input.referenceImages || [];
  const endpoint = references.length > 0 ? '/images/edits' : '/images/generations';
  const payload: Record<string, unknown> = {
    model: XAI_IMAGINE_IMAGE_MODEL,
    prompt,
    n: 1,
    resolution: input.resolution || '1k',
    quality: input.quality || 'medium',
    response_format: 'b64_json',
  };
  if (references.length === 0) {
    payload.aspect_ratio = aspectRatio;
  } else if (references.length === 1) {
    payload.image = asImageReference(references[0]);
  } else {
    payload.images = references.map(asImageReference);
    payload.aspect_ratio = aspectRatio;
  }

  const oauthFetch = createXaiOAuthMediaFetch(options.fetchImpl);
  const response = await oauthFetch(`${XAI_IMAGINE_API_BASE_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: combinedSignal(input.abortSignal, IMAGE_TIMEOUT_MS),
    redirect: 'error',
  });
  const body = await readJsonResponse<{
    data?: Array<{ b64_json?: string }>;
    model?: string;
  }>(response, references.length > 0 ? 'Grok Imagine image edit' : 'Grok Imagine image generation');
  const encoded = body.data?.[0]?.b64_json;
  if (!encoded) throw new XaiImagineError('Grok Imagine returned no image data.', response.status, 'EMPTY_OUTPUT');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length === 0) throw new XaiImagineError('Grok Imagine returned empty image data.', response.status, 'EMPTY_OUTPUT');
  if (bytes.length > MAX_GENERATED_IMAGE_BYTES) throw new XaiImagineError('Grok Imagine returned an image larger than the 50 MiB limit.', response.status, 'OUTPUT_TOO_LARGE');
  return { bytes, mimeType: inferImageMime(bytes), model: body.model || XAI_IMAGINE_IMAGE_MODEL };
}

function videoReference(filePath: string, cwd?: string): { url: string } {
  if (/^https:\/\//i.test(filePath)) return { url: filePath };
  if (/^data:image\//i.test(filePath)) return { url: filePath };
  const image = referencePathToDataUrl(filePath, cwd);
  return asImageReference(image);
}

function assertVideoDownloadUrl(raw: string): URL {
  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    throw new XaiImagineError('Grok Imagine returned an invalid video URL.', undefined, 'INVALID_DOWNLOAD_URL');
  }
  if (
    target.protocol !== 'https:'
    || target.port
    || target.username
    || target.password
    || !ALLOWED_VIDEO_DOWNLOAD_HOSTS.has(target.hostname)
  ) {
    throw new XaiImagineError('Grok Imagine returned a video URL outside the approved xAI download hosts.', undefined, 'UNTRUSTED_DOWNLOAD_URL');
  }
  return target;
}

async function waitForPoll(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw signal.reason;
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(signal?.reason || new Error('Video generation aborted.'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export async function generateGrokVideo(
  input: GenerateGrokVideoInput,
  options: XaiImagineTestOptions = {},
): Promise<GenerateGrokVideoOutput> {
  const startedAt = Date.now();
  const prompt = assertPrompt(input.prompt);
  const duration = input.duration || 6;
  const aspectRatio = input.aspectRatio || '16:9';
  const resolution = input.resolution || '480p';
  if (!VIDEO_DURATIONS.has(duration)) throw new XaiImagineError('Grok Imagine video duration must be 6 or 10 seconds.', undefined, 'INVALID_DURATION');
  if (!VIDEO_ASPECT_RATIOS.has(aspectRatio)) throw new XaiImagineError(`Unsupported Grok Imagine video aspect ratio: ${aspectRatio}`, undefined, 'INVALID_ASPECT_RATIO');
  if (!VIDEO_RESOLUTIONS.has(resolution)) throw new XaiImagineError(`Unsupported Grok Imagine video resolution: ${resolution}`, undefined, 'INVALID_RESOLUTION');
  const referencePaths = input.referenceImagePaths || [];
  if (referencePaths.length > 7) throw new XaiImagineError('Grok Imagine video accepts at most 7 reference images.', undefined, 'TOO_MANY_REFERENCES');

  const payload: Record<string, unknown> = {
    model: XAI_IMAGINE_VIDEO_MODEL,
    prompt,
    duration,
    resolution,
  };
  if (input.imagePath) {
    payload.image = videoReference(input.imagePath, input.cwd);
  } else {
    payload.aspect_ratio = aspectRatio;
    if (referencePaths.length > 0) payload.reference_images = referencePaths.map(value => videoReference(value, input.cwd));
  }

  const oauthFetch = createXaiOAuthMediaFetch(options.fetchImpl);
  const signal = combinedSignal(input.abortSignal, options.timeoutMs || VIDEO_TIMEOUT_MS);
  const startResponse = await oauthFetch(`${XAI_IMAGINE_API_BASE_URL}/videos/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
    redirect: 'error',
  });
  const start = await readJsonResponse<{ request_id?: string }>(startResponse, 'Grok Imagine video generation');
  const requestId = start.request_id || '';
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(requestId)) {
    throw new XaiImagineError('Grok Imagine returned an invalid video request ID.', startResponse.status, 'INVALID_RESPONSE');
  }

  let videoUrl = '';
  while (!videoUrl) {
    await waitForPoll(options.pollIntervalMs ?? VIDEO_POLL_INTERVAL_MS, signal);
    const pollResponse = await oauthFetch(`${XAI_IMAGINE_API_BASE_URL}/videos/${requestId}`, {
      method: 'GET',
      signal,
      redirect: 'error',
    });
    const poll = await readJsonResponse<{
      status?: string;
      video?: { url?: string };
    }>(pollResponse, 'Grok Imagine video poll');
    if (poll.status === 'done') {
      videoUrl = poll.video?.url || '';
      if (!videoUrl) throw new XaiImagineError('Grok Imagine completed without a video URL.', pollResponse.status, 'EMPTY_OUTPUT');
      break;
    }
    if (poll.status === 'failed' || poll.status === 'expired') {
      throw new XaiImagineError(`Grok Imagine video generation ${poll.status}.`, pollResponse.status, poll.status.toUpperCase());
    }
  }

  const downloadTarget = assertVideoDownloadUrl(videoUrl);
  const downloadFetch = options.downloadFetchImpl || envProxyFetch;
  const downloadResponse = await downloadFetch(downloadTarget, {
    method: 'GET',
    signal: combinedSignal(input.abortSignal, VIDEO_DOWNLOAD_TIMEOUT_MS),
    redirect: 'error',
  });
  if (!downloadResponse.ok) {
    throw new XaiImagineError(`Grok Imagine video download failed with HTTP ${downloadResponse.status}.`, downloadResponse.status, 'DOWNLOAD_FAILED');
  }
  const downloadContentType = downloadResponse.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (downloadContentType && downloadContentType !== 'video/mp4' && downloadContentType !== 'application/octet-stream') {
    throw new XaiImagineError(`Grok Imagine returned unsupported video content type: ${downloadContentType}`, downloadResponse.status, 'INVALID_MEDIA_TYPE');
  }
  const bytes = await readBoundedResponseBytes(downloadResponse, MAX_GENERATED_VIDEO_BYTES);
  if (bytes.length === 0) throw new XaiImagineError('Grok Imagine returned an empty video.', downloadResponse.status, 'EMPTY_OUTPUT');

  const block: MediaBlock = { type: 'video', mimeType: 'video/mp4', data: bytes.toString('base64') };
  const saved = saveMediaToLibrary(block, {
    sessionId: input.sessionId,
    source: 'xai-oauth',
    prompt,
    model: XAI_IMAGINE_VIDEO_MODEL,
    aspectRatio,
    imageSize: resolution,
    producerId: 'xai-imagine-video',
    runtimeId: input.runtimeId,
    methodRef: 'generateGrokVideo',
  });
  return {
    mediaGenerationId: saved.mediaId,
    localPath: saved.localPath,
    mimeType: 'video/mp4',
    model: XAI_IMAGINE_VIDEO_MODEL,
    elapsedMs: Date.now() - startedAt,
    requestId,
  };
}

export function readGrokReferenceImages(paths: readonly string[], cwd?: string): Array<{ mimeType: string; data: string }> {
  return paths.map(value => referencePathToDataUrl(value, cwd));
}
