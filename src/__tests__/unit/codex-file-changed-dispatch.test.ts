/**
 * Phase 5 Phase 4 Slice 1 — file-changed dispatch contract.
 *
 * Pins the path:
 *
 *   Codex runtime → canonical RuntimeRunEvent file_changed
 *   → SSE `data: {"type":"file_changed","data":"{\"paths\":[...]}"}`
 *   → useSSEStream handleSSEEvent's `file_changed` case
 *   → SSECallbacks.onFileChanged(paths)
 *   → stream-session-manager dispatchFileChanged({ paths, source: 'ai-tool' })
 *   → window 'codepilot:file-changed' event
 *   → PreviewPanel quiet-refresh
 *
 * Earlier Phase 3 emitted file_changed as a status SSE with embedded
 * JSON, which useSSEStream's status case rendered as raw text and
 * never dispatched. Codex review round 2 caught the gap.
 *
 * This test asserts:
 *
 *   1. SSEEventType union has 'file_changed' (TS-level pin).
 *   2. Codex runtime.canonicalToSseLine emits the new event type
 *      (grep-level pin on the source file so a future refactor
 *      can't silently revert to status).
 *   3. handleSSEEvent's file_changed case invokes callbacks.onFileChanged
 *      with the parsed paths array.
 *   4. stream-session-manager's onFileChanged forwards to
 *      dispatchFileChanged (source-level pin).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { SSEEventType } from '@/types';

const runtimeSrc = fs.readFileSync(
  path.resolve(__dirname, '../../lib/codex/runtime.ts'),
  'utf8',
);
const useSseSrc = fs.readFileSync(
  path.resolve(__dirname, '../../hooks/useSSEStream.ts'),
  'utf8',
);
const streamMgrSrc = fs.readFileSync(
  path.resolve(__dirname, '../../lib/stream-session-manager.ts'),
  'utf8',
);

describe('SSE file_changed event — Phase 5 Phase 4 Slice 1 contract', () => {
  it('SSEEventType union includes file_changed', () => {
    // Compile-time pin: assigning 'file_changed' to SSEEventType must
    // typecheck. Breaking the union (removing the member) fails the
    // build before this runtime assertion runs.
    const t: SSEEventType = 'file_changed';
    assert.equal(t, 'file_changed');
  });

  it('Codex runtime emits file_changed SSE (not status fallback)', () => {
    // The `case 'file_changed':` arm in canonicalToSseLine must
    // produce the dedicated file_changed event type — earlier revision
    // shoved it through `type: 'status'` which never reached the
    // dispatch path. Match the object-literal shape (unquoted key,
    // single-quoted value) the source actually uses. Window generous
    // to accommodate explanatory comments in the arm body.
    assert.match(
      runtimeSrc,
      /case 'file_changed':[\s\S]{0,1500}type:\s*'file_changed'/,
    );
    assert.match(
      runtimeSrc,
      /case 'file_changed':[\s\S]{0,1500}paths:\s*event\.paths/,
    );
  });

  it('useSSEStream handleSSEEvent has a file_changed case routing to onFileChanged', () => {
    assert.match(useSseSrc, /case 'file_changed':\s*\{/);
    assert.match(useSseSrc, /callbacks\.onFileChanged\?\.\(paths\)/);
  });

  it('SSECallbacks declares the optional onFileChanged channel', () => {
    assert.match(useSseSrc, /onFileChanged\?\:\s*\(paths:\s*string\[\]\)\s*=>\s*void/);
  });

  it('stream-session-manager wires onFileChanged → dispatchFileChanged', () => {
    assert.match(streamMgrSrc, /onFileChanged:\s*\(paths\)\s*=>/);
    // The onFileChanged handler body resolves relative paths and then
    // calls dispatchFileChanged with source:'ai-tool'. Allow generous
    // whitespace + intermediate lines between the handler open and
    // the dispatch call.
    assert.match(
      streamMgrSrc,
      /onFileChanged:\s*\(paths\)\s*=>[\s\S]{0,1500}dispatchFileChanged\([\s\S]{0,300}source:\s*'ai-tool'/,
    );
  });
});
