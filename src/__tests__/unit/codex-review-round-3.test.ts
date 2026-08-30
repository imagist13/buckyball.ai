/**
 * Phase 5 review round 3 contract — wiring corrections.
 *
 * P1 — Approval bridge actually wired into the runtime (not just
 *      shipped as a module). The Slice 2 commit landed
 *      approval-bridge.ts + its tests but a file-modification race
 *      lost the runtime edit, leaving declineByDefault in place.
 *      Codex reviewer caught it.
 *
 * P2 — file_changed upstream covers BOTH fs/changed notifications
 *      (requires explicit fs/watch subscription) AND fileChange
 *      ThreadItem completions (synthesized from item.changes[]).
 *      Without both paths Codex's file edits would never trigger
 *      PreviewPanel auto-refresh.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { synthesizeFileChangedFromCompletedItem } from '@/lib/codex/event-mapper';

const runtimeSrc = fs.readFileSync(
  path.resolve(__dirname, '../../lib/codex/runtime.ts'),
  'utf8',
);

describe('Approval bridge wiring — P1 fix', () => {
  it('runtime imports handleCodexApprovalRequest from approval-bridge', () => {
    assert.match(
      runtimeSrc,
      /import\s+\{\s*handleCodexApprovalRequest\s*\}\s+from\s+['"]\.\/approval-bridge['"]/,
    );
  });

  it('runtime no longer declares declineByDefault', () => {
    // The earlier intermediate stance is fully retired.
    assert.doesNotMatch(runtimeSrc, /declineByDefault/);
  });

  it('runtime onServerRequest handlers call handleCodexApprovalRequest with sessionId + jsonRpcId', () => {
    // The handler is registered for each approval method and forwards
    // (sessionId, jsonRpcId, method, params, emitSse) to the bridge.
    assert.match(
      runtimeSrc,
      /onServerRequest\(method,[\s\S]{0,500}handleCodexApprovalRequest\(\s*\{[\s\S]{0,300}sessionId,[\s\S]{0,300}jsonRpcId:\s*ctx\.id/,
    );
  });

  it('runtime registers the canonical + legacy approval methods', () => {
    // All 5 methods must be in the loop the handler is registered for.
    for (const method of [
      "'item/commandExecution/requestApproval'",
      "'item/fileChange/requestApproval'",
      "'item/permissions/requestApproval'",
      "'execCommandApproval'",
      "'applyPatchApproval'",
    ]) {
      assert.ok(
        runtimeSrc.includes(method),
        `runtime must register approval handler for ${method}`,
      );
    }
  });
});

describe('synthesizeFileChangedFromCompletedItem — P2 fix', () => {
  const ctx = { sessionId: 's1' };

  it('fileChange item.completed with changes[] → file_changed with paths', () => {
    const event = synthesizeFileChangedFromCompletedItem(
      {
        item: {
          type: 'fileChange',
          id: 'fc-1',
          changes: [
            { path: '/tmp/a.md', kind: 'update', diff: '...' },
            { path: '/tmp/b.md', kind: 'add', diff: '...' },
          ],
          status: 'success',
        },
      },
      ctx,
    );
    assert.equal(event?.type, 'file_changed');
    if (event?.type !== 'file_changed') throw new Error('unreachable');
    assert.deepEqual([...event.paths], ['/tmp/a.md', '/tmp/b.md']);
  });

  it('returns null for non-fileChange items (commandExecution, etc.)', () => {
    const event = synthesizeFileChangedFromCompletedItem(
      { item: { type: 'commandExecution', id: 'cmd-1' } },
      ctx,
    );
    assert.equal(event, null);
  });

  it('returns null when changes[] is empty / missing', () => {
    assert.equal(
      synthesizeFileChangedFromCompletedItem(
        { item: { type: 'fileChange', id: 'fc-1', changes: [] } },
        ctx,
      ),
      null,
    );
    assert.equal(
      synthesizeFileChangedFromCompletedItem({ item: { type: 'fileChange', id: 'fc-1' } }, ctx),
      null,
    );
  });

  it('filters out entries with non-string / empty path', () => {
    const event = synthesizeFileChangedFromCompletedItem(
      {
        item: {
          type: 'fileChange',
          id: 'fc-1',
          changes: [
            { path: '/tmp/ok.md', kind: 'update' },
            { path: '', kind: 'update' },
            { path: null, kind: 'update' },
            { kind: 'update' },
          ],
        },
      },
      ctx,
    );
    if (event?.type !== 'file_changed') throw new Error('unreachable');
    assert.deepEqual([...event.paths], ['/tmp/ok.md']);
  });
});

describe('Runtime fs/watch lifecycle — P2 fix', () => {
  it('runtime imports synthesizeFileChangedFromCompletedItem from event-mapper', () => {
    assert.match(
      runtimeSrc,
      /import\s*\{[\s\S]{0,400}synthesizeFileChangedFromCompletedItem[\s\S]{0,400}\}\s*from\s+['"]\.\/event-mapper['"]/,
    );
  });

  it('runtime declares the fsWatchEntries module-scope map', () => {
    assert.match(runtimeSrc, /const\s+fsWatchEntries\s*=\s*new\s+Map<\s*string,\s*string\s*>/);
  });

  it('runtime calls fs/watch after thread is established (best-effort)', () => {
    assert.match(
      runtimeSrc,
      /client\.request\([\s\S]{0,50}'fs\/watch'[\s\S]{0,500}path:\s*options\.workingDirectory/,
    );
    assert.match(runtimeSrc, /fsWatchEntries\.set\(sessionId,\s*watchId\)/);
  });

  it('runtime sends fs/unwatch in closeStream cleanup', () => {
    assert.match(
      runtimeSrc,
      /closeStream[\s\S]{0,2000}fsWatchEntries\.get\(sessionId\)/,
    );
    assert.match(runtimeSrc, /client\.request\('fs\/unwatch',\s*\{\s*watchId\s*\}/);
  });

  it('runtime invokes synthesizeFileChangedFromCompletedItem on item/completed', () => {
    assert.match(
      runtimeSrc,
      /method\s*===\s*'item\/completed'[\s\S]{0,500}synthesizeFileChangedFromCompletedItem/,
    );
  });
});
