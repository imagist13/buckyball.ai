/**
 * Phase 4 P1.2 — inline-html CSP injection.
 *
 * The route-served file preview gets a Round 4 CSP at the HTTP level.
 * srcDoc inline-html (code-fence Preview, Markdown→HTML presentation,
 * localhost redirector) needs an equivalent CSP delivered via a
 * `<meta>` tag. These tests pin the directive table + the three
 * insertion-position cases (existing head / html-no-head / fragment).
 *
 * Run: npx tsx --test src/__tests__/unit/inline-html-csp.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildInlineHtmlCspMeta,
  injectInlineHtmlCsp,
} from '../../lib/inline-html-csp';

describe('buildInlineHtmlCspMeta — strict mode (default)', () => {
  it('emits a meta tag with the Round 4 Static baseline', () => {
    const meta = buildInlineHtmlCspMeta();
    assert.match(meta, /<meta http-equiv="Content-Security-Policy"/i);
    // Default-deny baseline
    assert.match(meta, /default-src 'none'/);
    // Static resource families — https allowed
    assert.match(meta, /img-src [^;"]*https:/);
    assert.match(meta, /style-src [^;"]*https:/);
    assert.match(meta, /font-src [^;"]*https:/);
    assert.match(meta, /media-src [^;"]*https:/);
    // Scripts and network egress denied in inline-html (no Interactive
    // mode exposed here)
    assert.match(meta, /script-src 'none'/);
    assert.match(meta, /connect-src 'none'/);
    assert.match(meta, /frame-src 'none'/);
    assert.match(meta, /object-src 'none'/);
    assert.match(meta, /worker-src 'none'/);
    assert.match(meta, /manifest-src 'none'/);
    // Structural
    assert.match(meta, /frame-ancestors 'self'/);
    assert.match(meta, /base-uri 'self'/);
    assert.match(meta, /form-action 'none'/);
  });
});

describe('buildInlineHtmlCspMeta — navigate mode', () => {
  it('still locks fetch / frame / worker; keeps form-action none', () => {
    const meta = buildInlineHtmlCspMeta('navigate');
    assert.match(meta, /default-src 'none'/);
    assert.match(meta, /connect-src 'none'/);
    assert.match(meta, /frame-src 'none'/);
    assert.match(meta, /object-src 'none'/);
    assert.match(meta, /worker-src 'none'/);
    assert.match(meta, /script-src 'none'/);
    assert.match(meta, /form-action 'none'/);
  });
});

describe('injectInlineHtmlCsp — placement', () => {
  it('inserts after an existing <head>', () => {
    const input = '<!doctype html><html><head><title>x</title></head><body>y</body></html>';
    const out = injectInlineHtmlCsp(input);
    assert.match(out, /<head><meta http-equiv="Content-Security-Policy"[^>]*><title>x<\/title>/);
  });

  it('synthesises a <head> when there is <html> but no <head>', () => {
    const input = '<html><body>x</body></html>';
    const out = injectInlineHtmlCsp(input);
    assert.match(
      out,
      /<html><head><meta http-equiv="Content-Security-Policy"[^>]*><\/head><body>/,
    );
  });

  it('wraps a bare fragment in a minimal shell', () => {
    const input = '<p>hello</p>';
    const out = injectInlineHtmlCsp(input);
    assert.match(out, /^<!doctype html><html><head>/);
    assert.match(out, /<meta http-equiv="Content-Security-Policy"/);
    assert.match(out, /<body><p>hello<\/p><\/body><\/html>$/);
  });

  it('untrusted existing CSP must NOT suppress CodePilot CSP (Phase 4 P1.3)', () => {
    // Codex review finding: AI-generated HTML / code fence content
    // is untrusted; if the input carries its own permissive CSP
    // (e.g. `default-src *`), CodePilot must still inject its
    // restrictive Round 4 baseline. CSP intersection means the
    // effective policy = AND of all active policies, so our
    // restrictive meta tightens (never loosens) the result.
    const input =
      '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src *"></head><body></body></html>';
    const out = injectInlineHtmlCsp(input);
    // Both CSPs must appear in the output (intersection enforces
    // BOTH); our restrictive one comes BEFORE the existing one so
    // the browser parses the strict policy first.
    const metas = out.match(/Content-Security-Policy/gi) || [];
    assert.equal(metas.length, 2, 'CodePilot CSP injected alongside the existing one');
    // CodePilot meta appears first (before the permissive one)
    const codepilotIdx = out.indexOf("default-src 'none'");
    const permissiveIdx = out.indexOf('default-src *');
    assert.ok(codepilotIdx > -1, 'CodePilot CSP present');
    assert.ok(permissiveIdx > -1, 'original CSP preserved (intersection still tightens via ours)');
    assert.ok(
      codepilotIdx < permissiveIdx,
      'CodePilot CSP must precede the existing one so the browser sees the strict policy first',
    );
  });

  it('untrusted CSP in <body> (no <head> case) ends up inert because our shell synthesizes its own <head>', () => {
    // CSP <meta> is only honoured in <head>. When we synthesize a
    // shell around a bare fragment, the input goes into <body>, so
    // any CSP meta it carried is ignored by the browser. Only our
    // injected <head> CSP applies.
    const input =
      '<meta http-equiv="Content-Security-Policy" content="default-src *"><p>x</p>';
    const out = injectInlineHtmlCsp(input);
    // Output shape: our shell wraps the input verbatim into <body>
    assert.match(out, /^<!doctype html><html><head>/);
    assert.match(out, /default-src 'none'/);
    // The original (would-be permissive) meta is in <body>, not <head>
    const headEnd = out.indexOf('</head>');
    const permissiveIdx = out.indexOf('default-src *');
    assert.ok(permissiveIdx > headEnd, 'permissive meta ends up in <body>, where browsers ignore CSP metas');
  });
});
