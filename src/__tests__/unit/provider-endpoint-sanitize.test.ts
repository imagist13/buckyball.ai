/**
 * Provider card endpoint sanitization (Step 4 P1 follow-up).
 *
 * Some user records ended up with API keys / tokens stored in the
 * `base_url` column. The Provider Card was rendering the raw value as
 * "接入地址 sk-or-v1-…", which leaked credentials in screenshots /
 * recordings / logs. This test pins:
 *
 *   - High-confidence secret prefixes are flagged as suspicious and
 *     never exposed verbatim.
 *   - Non-URL gibberish is also flagged (covers paste accidents that
 *     don't match a known prefix).
 *   - Normal HTTP(S) endpoints render as host/path with no tooltip leak.
 *   - Custom paths (e.g. `…/anthropic`) and non-default ports are
 *     preserved so users can still tell their proxies apart.
 *   - Trailing slashes are normalized.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeEndpointForDisplay,
  type SanitizeTranslator,
} from '../../lib/provider-endpoint-sanitize';

// Test stub: render the i18n key plus interpolated `{tail}` so assertions
// can verify which branch fired without depending on the actual zh/en
// bundle. The shape mirrors what ProviderManager passes through.
const stubT: SanitizeTranslator = (key, vars) => {
  if (key === 'provider.endpoint.suspicious') return `SUSPICIOUS:${vars?.tail ?? ''}`;
  return 'TOOLTIP:masked';
};

describe('sanitizeEndpointForDisplay — secret-prefix detection', () => {
  it('OpenAI / Anthropic-compat sk- prefix → suspicious', () => {
    const r = sanitizeEndpointForDisplay('sk-ant-api03-AAAAfake-key-tail', stubT);
    assert.equal(r.suspicious, true);
    assert.match(r.display, /SUSPICIOUS:tail$/);
    assert.equal(r.tooltip, 'TOOLTIP:masked');
  });

  it('OpenRouter sk-or- prefix → suspicious', () => {
    const r = sanitizeEndpointForDisplay('sk-or-v1-xxxxxxx1234', stubT);
    assert.equal(r.suspicious, true);
    assert.match(r.display, /SUSPICIOUS:1234$/);
  });

  it('Bailian Coding Plan sk-sp- prefix → suspicious', () => {
    const r = sanitizeEndpointForDisplay('sk-sp-aaaaaaaabbbb', stubT);
    assert.equal(r.suspicious, true);
  });

  it('GitHub PAT ghp_ prefix → suspicious', () => {
    const r = sanitizeEndpointForDisplay('ghp_AAAABBBBccccDDDD1234', stubT);
    assert.equal(r.suspicious, true);
    assert.match(r.display, /SUSPICIOUS:1234$/);
  });

  it('GitHub fine-grained PAT (gh_pat_) → suspicious', () => {
    const r = sanitizeEndpointForDisplay('gh_pat_xxxxxxxxxxxx', stubT);
    assert.equal(r.suspicious, true);
  });

  it('uppercase paste of secret prefix still flagged (case-insensitive)', () => {
    const r = sanitizeEndpointForDisplay('SK-ANT-uppercase-paste', stubT);
    assert.equal(r.suspicious, true);
  });
});

describe('sanitizeEndpointForDisplay — invalid URL fallthrough', () => {
  it('non-URL gibberish → suspicious', () => {
    const r = sanitizeEndpointForDisplay('not a url at all 1234', stubT);
    assert.equal(r.suspicious, true);
    // Last-4 still shown for identification.
    assert.match(r.display, /SUSPICIOUS:1234$/);
  });

  it('non-http(s) protocol (file://) → suspicious', () => {
    // `base_url` should always be HTTP(S); other protocols are
    // misconfiguration. Bedrock/Vertex use env_overrides, not base_url.
    const r = sanitizeEndpointForDisplay('file:///etc/passwd', stubT);
    assert.equal(r.suspicious, true);
  });

  it('javascript: pseudo-URL → suspicious', () => {
    const r = sanitizeEndpointForDisplay('javascript:alert(1)', stubT);
    assert.equal(r.suspicious, true);
  });

  it('empty string → not suspicious, empty display', () => {
    const r = sanitizeEndpointForDisplay('', stubT);
    assert.equal(r.suspicious, false);
    assert.equal(r.display, '');
  });
});

describe('sanitizeEndpointForDisplay — normal endpoints', () => {
  it('Anthropic official → host/path without protocol', () => {
    const r = sanitizeEndpointForDisplay('https://api.anthropic.com', stubT);
    assert.equal(r.suspicious, false);
    assert.equal(r.display, 'api.anthropic.com');
    assert.equal(r.tooltip, undefined);
  });

  it('OpenRouter Anthropic skin → keeps `/api` path', () => {
    const r = sanitizeEndpointForDisplay('https://openrouter.ai/api', stubT);
    assert.equal(r.suspicious, false);
    assert.equal(r.display, 'openrouter.ai/api');
  });

  it('Bailian Coding Plan → keeps deep path', () => {
    const r = sanitizeEndpointForDisplay(
      'https://coding.dashscope.aliyuncs.com/apps/anthropic',
      stubT,
    );
    assert.equal(r.suspicious, false);
    assert.equal(r.display, 'coding.dashscope.aliyuncs.com/apps/anthropic');
  });

  it('non-default port preserved', () => {
    const r = sanitizeEndpointForDisplay('http://localhost:11434/v1', stubT);
    assert.equal(r.suspicious, false);
    assert.equal(r.display, 'localhost:11434/v1');
  });

  it('trailing slash normalized away', () => {
    const r = sanitizeEndpointForDisplay('https://api.example.com/', stubT);
    assert.equal(r.suspicious, false);
    assert.equal(r.display, 'api.example.com');
  });

  it('http (not https) → still rendered, not suspicious', () => {
    // Self-hosted Ollama / LiteLLM are http-only; not a security concern
    // for the masking gate (which is about secret leakage, not transport).
    const r = sanitizeEndpointForDisplay('http://192.168.1.10:4000', stubT);
    assert.equal(r.suspicious, false);
    assert.equal(r.display, '192.168.1.10:4000');
  });
});
