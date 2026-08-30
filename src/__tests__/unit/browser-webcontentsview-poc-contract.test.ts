import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildPocPartition,
  validateBounds,
  isAllowedBrowserUrl,
} = require('../../../docs/research/browser-webcontentsview-poc/harness/contract.cjs') as {
  buildPocPartition: (workspaceKey: string, nonce: string) => string;
  validateBounds: (value: unknown, windowBounds: { width: number; height: number }) => { x: number; y: number; width: number; height: number } | null;
  isAllowedBrowserUrl: (url: string) => boolean;
};

describe('WebContentsView POC narrow contract', () => {
  it('derives a bounded isolated partition from opaque workspace id + nonce', () => {
    const key = 'a'.repeat(64);
    const first = buildPocPartition(key, 'nonce_123');
    assert.match(first, /^persist:codepilot-browser-poc-[a-f0-9]{24}$/);
    assert.notEqual(first, buildPocPartition(key, 'nonce_456'));
    assert.throws(() => buildPocPartition('/absolute/path', 'nonce_123'));
  });

  it('rejects non-finite, fractional, negative, oversized and off-window bounds', () => {
    const windowBounds = { width: 1200, height: 800 };
    assert.deepEqual(validateBounds({ x: 10, y: 20, width: 300, height: 400 }, windowBounds), { x: 10, y: 20, width: 300, height: 400 });
    assert.equal(validateBounds({ x: 10.5, y: 20, width: 300, height: 400 }, windowBounds), null);
    assert.equal(validateBounds({ x: -1, y: 20, width: 300, height: 400 }, windowBounds), null);
    assert.equal(validateBounds({ x: 1000, y: 20, width: 300, height: 400 }, windowBounds), null);
    assert.equal(validateBounds({ x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 1 }, windowBounds), null);
  });

  it('allows HTTPS and loopback HTTP but blocks dangerous/remote schemes', () => {
    assert.equal(isAllowedBrowserUrl('https://example.com/path'), true);
    assert.equal(isAllowedBrowserUrl('http://127.0.0.1:3000/'), true);
    assert.equal(isAllowedBrowserUrl('http://localhost:3000/'), true);
    assert.equal(isAllowedBrowserUrl('http://example.com/'), false);
    assert.equal(isAllowedBrowserUrl('file:///etc/passwd'), false);
    assert.equal(isAllowedBrowserUrl('javascript:alert(1)'), false);
    assert.equal(isAllowedBrowserUrl('data:text/html,x'), false);
  });
});
