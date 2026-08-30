/**
 * Round 2 — flow-level contract tests for the "blocking + confirm-and-send"
 * cycle. Models the MessageInput's bypass-flag state machine without React,
 * so we can lock down the contract independently of the React renderer.
 * (No built-in reason currently sets requiresConfirm: permission-elevation was
 * removed 2026-06-02, and context-cost-change was downgraded to a non-blocking
 * heads-up 2026-06-19 per #632. These tests model the GENERIC bypass machinery
 * with a hypothetical blocking id — the machinery is retained for any future
 * real-danger confirm, and the screenshot-preservation contract below protects
 * ANY rejected submit, not just checkpoint blocks.)
 *
 * The contract under test:
 *   1. While a `requiresConfirm` reason is active, MessageInput's
 *      handleSubmit returns early.
 *   2. The banner's confirm action sets bypass=true synchronously,
 *      then re-triggers submit; that submit proceeds even if the
 *      reason hasn't been cleared yet (state propagation may lag).
 *   3. After bypass consumes ONE submit, it auto-clears so the next
 *      user-initiated submit re-blocks.
 *
 * Run: npx tsx --test src/__tests__/unit/run-checkpoint-blocking.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { buildCheckpoints, type BuildCheckpointsOpts } from '../../lib/run-checkpoint';

// ─── Tiny model of MessageInput's bypass machine ────────────────────

function makeSubmitMachine(initialBlockingIds: string[]) {
  const state = {
    blockingIds: [...initialBlockingIds],
    bypass: false,
    submitsRecorded: 0,
  };
  return {
    state,
    setBlockingIds(ids: string[]) {
      state.blockingIds = [...ids];
    },
    /** User clicks composer send. Returns true if the send went through. */
    userSubmit(): boolean {
      if (!state.bypass && state.blockingIds.length > 0) return false;
      state.bypass = false; // consume one
      state.submitsRecorded += 1;
      return true;
    },
    /** Banner action: set bypass + re-attempt submit (mimics the
     *  window-event flow in MessageInput). */
    confirmAndSend(): boolean {
      state.bypass = true;
      // Note: blockingIds is intentionally not cleared here. The page
      // will clear it on its next render (state propagation lag).
      // The test asserts bypass overrides the lag.
      const ok = state.bypass && (state.bypass || state.blockingIds.length === 0);
      if (!ok) return false;
      state.bypass = false;
      state.submitsRecorded += 1;
      return true;
    },
  };
}

const ok: BuildCheckpointsOpts = {
  noCompatibleProvider: false,
  defaultInvalid: false,
  runtimeFallback: false,
};
const read = (rel: string) => readFileSync(path.resolve(__dirname, '../..', rel), 'utf8');

async function promptInputWouldClearAfterSubmit(onSubmit: () => Promise<void>): Promise<boolean> {
  let cleared = false;
  try {
    await onSubmit();
    cleared = true;
  } catch {
    // PromptInput catches submit failures and keeps local text/files.
  }
  return cleared;
}

// ─── Contract 1-3: bypass machine ───────────────────────────────────

describe('MessageInput-style submit blocking + bypass', () => {
  it('user submit is blocked while a requiresConfirm reason is active', () => {
    const m = makeSubmitMachine(['future-danger-confirm']);
    assert.equal(m.userSubmit(), false);
    assert.equal(m.state.submitsRecorded, 0);
  });

  it('confirm-and-send goes through even when blocking ids are still set', () => {
    const m = makeSubmitMachine(['future-danger-confirm']);
    // The state-machine deliberately keeps blockingIds set to model
    // React state-propagation lag between confirm-action and re-render.
    assert.equal(m.confirmAndSend(), true);
    assert.equal(m.state.submitsRecorded, 1);
  });

  it('bypass auto-clears after one consume — next user submit re-blocks', () => {
    const m = makeSubmitMachine(['future-danger-confirm']);
    m.confirmAndSend();
    assert.equal(m.userSubmit(), false, 'second submit must re-block');
    assert.equal(m.state.submitsRecorded, 1);
  });

  it('user submit goes through normally when no blocking reasons', () => {
    const m = makeSubmitMachine([]);
    assert.equal(m.userSubmit(), true);
    assert.equal(m.state.submitsRecorded, 1);
  });
});

describe('MessageInput ↔ PromptInput checkpoint preservation contract', () => {
  it('a checkpoint-blocked submit must reject so PromptInput does not clear screenshots', async () => {
    assert.equal(
      await promptInputWouldClearAfterSubmit(async () => {}),
      true,
      'PromptInput clears text/files after a resolved submit',
    );
    assert.equal(
      await promptInputWouldClearAfterSubmit(async () => {
        throw new Error('run-checkpoint-blocked');
      }),
      false,
      'PromptInput preserves text/files when submit rejects',
    );
  });

  it('MessageInput throws the checkpoint-blocked sentinel instead of returning', () => {
    const src = read('components/chat/MessageInput.tsx');
    // #615 refactor: the raw throw moved into the shared abortComposerSubmit()
    // helper. Accept either form so the sentinel stays pinned through the move.
    assert.match(src, /(throw new Error|abortComposerSubmit)\(['"]run-checkpoint-blocked['"]\)/);
    assert.doesNotMatch(
      src,
      /blockingReasonIds[\s\S]{0,120}\{\s*return;\s*\}/,
      'blocked submit must not resolve successfully, or PromptInput will clear attachments',
    );
  });
});

describe('PromptInput keeps text/files when an async submit rejects (real source pin)', () => {
  // The OTHER half of the screenshot-preservation contract. MessageInput
  // throwing 'run-checkpoint-blocked' only preserves attachments because
  // PromptInput.handleSubmit calls clear() ONLY on the resolved branch and
  // deliberately skips it in BOTH the rejected-promise catch and the outer
  // sync catch. The local `promptInputWouldClearAfterSubmit` model above could
  // silently diverge from the real component; this pins the real source so a
  // future "tidy up the empty catch" can't drop the user's screenshots while
  // every other test stays green. (Behavioral RTL render would be stronger but
  // we have no React renderer here; source-pin is the low-cost guardrail.)
  const src = read('components/ai-elements/prompt-input.tsx');
  // Isolate handleSubmit so unrelated catch blocks elsewhere in the file
  // (blob-URL conversion) don't enter the analysis. `// Render with or without`
  // is the comment immediately after handleSubmit's useCallback closes.
  const start = src.indexOf('const handleSubmit: FormEventHandler');
  const tail = src.indexOf('// Render with or without local provider');
  assert.ok(
    start >= 0 && tail > start,
    'prompt-input.tsx anchors moved — re-point the handleSubmit isolation in this test',
  );
  const handleSubmit = src.slice(start, tail);

  it('clear() runs only after the awaited result resolves', () => {
    assert.match(
      handleSubmit,
      /if \(result instanceof Promise\)[\s\S]*?await result;\s*clear\(\);/,
      'the resolved-promise branch must await THEN clear; clear must not move ahead of the await',
    );
  });

  it('neither the rejected-promise catch nor the outer catch clears text/files', () => {
    const catchBodies = [...handleSubmit.matchAll(/catch\s*\{([^}]*)\}/g)].map((m) => m[1]);
    assert.ok(
      catchBodies.length >= 2,
      'expected both the rejected-promise catch and the outer try/catch to be present in handleSubmit',
    );
    for (const body of catchBodies) {
      assert.doesNotMatch(
        body,
        /clear\s*\(|textInput\.clear/,
        'a catch in handleSubmit must NOT clear — clearing on a rejected/failed submit drops the screenshots a blocked checkpoint is supposed to preserve',
      );
    }
  });
});

describe('ChatView RunCheckpoint context window source pins', () => {
  it('checkpoint usage passes route-effective context1m + upstreamModelId like RunCockpit', () => {
    const src = read('components/chat/ChatView.tsx');
    assert.match(
      src,
      /const usage = useContextUsage\(\s*messages,\s*currentModel,\s*\{\s*context1m: effectiveContext1m,\s*upstreamModelId: currentModelUpstream,\s*\}\s*\)/,
      'RunCheckpoint cost gating must use the same route-effective context-window inputs the status row and send path use',
    );
  });
});

// ─── Contract 1+4: integrated — context-cost across a "send" ─────────

describe('Context-cost reason auto-clears after the underlying send', () => {
  // Pure flow: when user has a 12K pending and then confirms+sends,
  // the chip-add → send pipeline drops pending to 0; the next call
  // to buildCheckpoints with pending=0 must omit the reason.
  it('pending=12K → reason fires; pending=0 after send → reason gone', () => {
    let pending = 12_000;
    let used = 0;
    const before = buildCheckpoints({ ...ok, pendingContextTokens: pending, usedContextTokens: used });
    assert.ok(before.some((r) => r.id === 'context-cost-change'));

    // Simulate send: chips clear → pendingContextTokens drops to 0,
    // usedContextTokens climbs by the same amount.
    used += pending;
    pending = 0;
    const after = buildCheckpoints({ ...ok, pendingContextTokens: pending, usedContextTokens: used });
    assert.equal(after.find((r) => r.id === 'context-cost-change'), undefined);
  });
});
