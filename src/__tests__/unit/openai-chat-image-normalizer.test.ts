/**
 * openai-chat-image-normalizer.test.ts — regression for the OpenAI Chat
 * Completions image data URL normalization (Phase 2 发现 3 收口).
 *
 * Pins the contract of src/lib/openai-chat-image-normalizer.ts:
 * - bare base64 image payloads become data:<sniffed mime>;base64,… URLs
 * - already-schemed URLs (data:/http:/https:) are preserved verbatim
 *   (double-prefix guard for when upstream fixes the bug)
 * - MIME sniffing is deterministic magic-byte detection for
 *   png/jpeg/webp/gif/svg; unrecognized bytes are left untouched
 * - the fetch wrapper only rewrites string JSON bodies POSTed to a
 *   `…/chat/completions` path
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sniffImageMimeFromBase64,
  normalizeChatCompletionsImageUrls,
  withChatImageDataUrlFetch,
} from '../../lib/openai-chat-image-normalizer';

// ── Synthetic payloads (magic bytes + padding, non-sensitive) ───

const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const JPEG_HEAD = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.from('JFIF-synthetic-probe-padding'),
]).toString('base64');
const GIF_HEAD = Buffer.from('GIF89a-synthetic-probe-padding').toString('base64');
const WEBP_HEAD = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WEBPVP8 synthetic-probe'),
]).toString('base64');
const SVG_PLAIN = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64');
const SVG_XML_DECL = Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64');
const UNKNOWN_BYTES = Buffer.from('plain text, definitely not an image format').toString('base64');

function chatBody(url: string) {
  return {
    model: 'probe',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'probe' },
          { type: 'image_url', image_url: { url } },
        ],
      },
    ],
  };
}

function normalizedUrl(body: unknown): string | undefined {
  const result = normalizeChatCompletionsImageUrls(body) as
    | { messages: Array<{ content: Array<{ type: string; image_url?: { url: string } }> }> }
    | undefined;
  return result?.messages[0].content.find((p) => p.type === 'image_url')?.image_url?.url;
}

// ── MIME sniffing ───────────────────────────────────────────────

describe('openai-chat image normalizer — MIME sniffing', () => {
  it('detects png / jpeg / gif / webp / svg from magic bytes', () => {
    assert.equal(sniffImageMimeFromBase64(PNG_1PX), 'image/png');
    assert.equal(sniffImageMimeFromBase64(JPEG_HEAD), 'image/jpeg');
    assert.equal(sniffImageMimeFromBase64(GIF_HEAD), 'image/gif');
    assert.equal(sniffImageMimeFromBase64(WEBP_HEAD), 'image/webp');
    assert.equal(sniffImageMimeFromBase64(SVG_PLAIN), 'image/svg+xml');
    assert.equal(sniffImageMimeFromBase64(SVG_XML_DECL), 'image/svg+xml');
  });

  it('returns undefined for unrecognized bytes — never blind-guesses a MIME', () => {
    assert.equal(sniffImageMimeFromBase64(UNKNOWN_BYTES), undefined);
    assert.equal(sniffImageMimeFromBase64(''), undefined);
    assert.equal(sniffImageMimeFromBase64('AAAA'), undefined);
  });
});

// ── Body normalization ──────────────────────────────────────────

describe('openai-chat image normalizer — body normalization', () => {
  it('bare base64 PNG becomes data:image/png;base64,…', () => {
    assert.equal(normalizedUrl(chatBody(PNG_1PX)), `data:image/png;base64,${PNG_1PX}`);
  });

  it('bare base64 JPEG is labeled image/jpeg, not blind-guessed as png', () => {
    assert.equal(normalizedUrl(chatBody(JPEG_HEAD)), `data:image/jpeg;base64,${JPEG_HEAD}`);
  });

  it('existing data URL passes through verbatim (no double prefix after upstream fix)', () => {
    const dataUrl = `data:image/png;base64,${PNG_1PX}`;
    assert.equal(normalizeChatCompletionsImageUrls(chatBody(dataUrl)), undefined);
  });

  it('remote http/https URLs pass through verbatim', () => {
    assert.equal(normalizeChatCompletionsImageUrls(chatBody('https://example.com/cat.png')), undefined);
    assert.equal(normalizeChatCompletionsImageUrls(chatBody('http://example.com/cat.png')), undefined);
  });

  it('base64 of unrecognized bytes is left untouched (no wrong MIME label)', () => {
    assert.equal(normalizeChatCompletionsImageUrls(chatBody(UNKNOWN_BYTES)), undefined);
  });

  it('non-image parts, string content, and toolless bodies are untouched', () => {
    assert.equal(
      normalizeChatCompletionsImageUrls({
        model: 'probe',
        messages: [{ role: 'user', content: 'plain string content' }],
      }),
      undefined,
    );
    assert.equal(normalizeChatCompletionsImageUrls({ model: 'probe' }), undefined);
    assert.equal(normalizeChatCompletionsImageUrls(null), undefined);
  });

  it('does not mutate the input body', () => {
    const body = chatBody(PNG_1PX);
    const snapshot = JSON.stringify(body);
    normalizeChatCompletionsImageUrls(body);
    assert.equal(JSON.stringify(body), snapshot);
  });
});

// ── Fetch wrapper ───────────────────────────────────────────────

interface CapturedInit {
  url: string;
  body: unknown;
}

function makeCapture(): { calls: CapturedInit[]; fetch: typeof fetch } {
  const calls: CapturedInit[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, body: init?.body });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  return { calls, fetch: impl };
}

describe('openai-chat image normalizer — fetch wrapper', () => {
  it('rewrites bare base64 in a /chat/completions JSON body', async () => {
    const { calls, fetch: inner } = makeCapture();
    const wrapped = withChatImageDataUrlFetch(inner);
    await wrapped('https://gateway.example/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify(chatBody(PNG_1PX)),
    });
    const sent = JSON.parse(calls[0].body as string);
    assert.equal(
      sent.messages[0].content[1].image_url.url,
      `data:image/png;base64,${PNG_1PX}`,
    );
  });

  it('leaves already-normal bodies byte-identical', async () => {
    const { calls, fetch: inner } = makeCapture();
    const wrapped = withChatImageDataUrlFetch(inner);
    const body = JSON.stringify(chatBody(`data:image/png;base64,${PNG_1PX}`));
    await wrapped('https://gateway.example/v1/chat/completions', { method: 'POST', body });
    assert.equal(calls[0].body, body);
  });

  it('ignores non-chat-completions endpoints and non-JSON bodies', async () => {
    const { calls, fetch: inner } = makeCapture();
    const wrapped = withChatImageDataUrlFetch(inner);
    const body = JSON.stringify(chatBody(PNG_1PX));
    await wrapped('https://gateway.example/v1/embeddings', { method: 'POST', body });
    assert.equal(calls[0].body, body);
    await wrapped('https://gateway.example/v1/chat/completions', { method: 'POST', body: 'not json' });
    assert.equal(calls[1].body, 'not json');
  });
});
