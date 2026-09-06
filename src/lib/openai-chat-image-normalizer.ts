/**
 * openai-chat-image-normalizer.ts — data URL normalization for the OpenAI
 * Chat Completions gateway path (ai-provider.ts non-OAuth 'openai' branch).
 *
 * Why this exists (Phase 2 finding 3): `@ai-sdk/openai@4.0.5`
 * `.chat()` converts `{type:'file', data:<base64>, mediaType:'image/png'}`
 * parts into `{type:'image_url', image_url:{url:<bare base64>}}` — the
 * `data:<mime>;base64,` prefix is dropped (dist/index.js ~L307 calls
 * `convertToBase64(...)` without building a data URL). Standard
 * OpenAI-compatible gateways expect a data URL or a remote URL, so bare
 * base64 is broken on the wire. The Responses path and
 * `@ai-sdk/openai-compatible` both emit proper data URLs; only `.chat()`
 * is affected.
 *
 * Contract (upstream-fix safe):
 * - Only `messages[].content[]` parts with `type:'image_url'` are touched.
 * - URLs that already have a scheme (`data:`, `http:`, `https:`, or any
 *   other non-base64 string) pass through verbatim — once upstream fixes
 *   the bug, this wrapper degrades to a no-op instead of double-prefixing.
 * - The MIME type is recovered by deterministic magic-byte sniffing
 *   (png/jpeg/webp/gif/svg only). Unrecognized bytes are left untouched —
 *   an unfixed bare-base64 URL is no worse than today, while a wrong MIME
 *   label would be a new bug.
 */

// ── MIME sniffing ───────────────────────────────────────────────

// Decode only the head of the base64 payload for magic-byte checks.
// 1024 base64 chars ≈ 768 bytes — enough for every signature below,
// including SVG preambles with an XML declaration / doctype.
const SNIFF_BASE64_CHARS = 1024;

/**
 * Deterministic image MIME sniff over base64-encoded bytes.
 * Returns undefined when the bytes match none of the known signatures.
 */
export function sniffImageMimeFromBase64(base64: string): string | undefined {
  let head: Buffer;
  try {
    head = Buffer.from(base64.slice(0, SNIFF_BASE64_CHARS), 'base64');
  } catch {
    return undefined;
  }
  if (head.length < 4) return undefined;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  // JPEG: FF D8 FF
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return 'image/jpeg';
  }
  // GIF: "GIF87a" / "GIF89a"
  const ascii6 = head.subarray(0, 6).toString('latin1');
  if (ascii6 === 'GIF87a' || ascii6 === 'GIF89a') {
    return 'image/gif';
  }
  // WEBP: "RIFF" .... "WEBP"
  if (
    head.length >= 12 &&
    head.subarray(0, 4).toString('latin1') === 'RIFF' &&
    head.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  // SVG: text starting with "<svg" or an XML declaration followed by <svg
  const text = head.toString('utf8').replace(/^﻿/, '').trimStart();
  if (text.startsWith('<svg') || (text.startsWith('<?xml') && text.includes('<svg'))) {
    return 'image/svg+xml';
  }
  return undefined;
}

// ── Bare-base64 detection + body normalization ─────────────────

// Strict base64 charset. Any URL (data:/http:/https:/blob:) contains ':'
// or '.' and fails this check, so schemed URLs can never be re-prefixed.
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
// Smaller than any real image payload; avoids sniffing junk strings.
const MIN_BASE64_LENGTH = 16;

function toDataUrlIfBareBase64Image(url: string): string | undefined {
  if (url.length < MIN_BASE64_LENGTH) return undefined;
  // Fast scheme guard (explicit intent; the charset check below also rejects these).
  if (url.startsWith('data:') || url.startsWith('http:') || url.startsWith('https:')) return undefined;
  if (!BASE64_RE.test(url)) return undefined;
  const mime = sniffImageMimeFromBase64(url);
  if (!mime) return undefined;
  return `data:${mime};base64,${url}`;
}

interface ChatImageUrlPart {
  type?: unknown;
  image_url?: { url?: unknown };
}

interface ChatCompletionsBody {
  messages?: Array<{ content?: unknown }>;
}

/**
 * Normalize bare-base64 `image_url.url` values in a Chat Completions body
 * (parsed JSON). Mutates nothing; returns the normalized body when at least
 * one URL changed, or undefined when the body is already normal.
 */
export function normalizeChatCompletionsImageUrls(body: unknown): unknown | undefined {
  const messages = (body as ChatCompletionsBody)?.messages;
  if (!Array.isArray(messages)) return undefined;

  let changed = false;
  const nextMessages = messages.map((message) => {
    const content = message?.content;
    if (!Array.isArray(content)) return message;
    let messageChanged = false;
    const nextContent = content.map((part: ChatImageUrlPart) => {
      if (part?.type !== 'image_url') return part;
      const url = part.image_url?.url;
      if (typeof url !== 'string') return part;
      const dataUrl = toDataUrlIfBareBase64Image(url);
      if (!dataUrl) return part;
      messageChanged = true;
      return { ...part, image_url: { ...part.image_url, url: dataUrl } };
    });
    if (!messageChanged) return message;
    changed = true;
    return { ...message, content: nextContent };
  });

  if (!changed) return undefined;
  return { ...(body as object), messages: nextMessages };
}

// ── Fetch wrapper (the app integration point) ───────────────────

function isChatCompletionsUrl(url: string): boolean {
  try {
    return new URL(url).pathname.endsWith('/chat/completions');
  } catch {
    return false;
  }
}

/**
 * Wrap a fetch so JSON bodies POSTed to a `…/chat/completions` path get
 * their bare-base64 image_url values upgraded to data URLs. Everything else
 * (other endpoints, non-string bodies, unparseable JSON) passes through
 * untouched.
 */
export function withChatImageDataUrlFetch(fetchImpl: typeof fetch = fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (init && typeof init.body === 'string' && isChatCompletionsUrl(url)) {
      try {
        const normalized = normalizeChatCompletionsImageUrls(JSON.parse(init.body));
        if (normalized !== undefined) {
          init = { ...init, body: JSON.stringify(normalized) };
        }
      } catch {
        // Not JSON — send as-is.
      }
    }
    return fetchImpl(input, init);
  }) as typeof fetch;
}
