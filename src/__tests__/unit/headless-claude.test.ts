/**
 * Phase 3 Step 4b — `runClaudeHeadless` contract.
 *
 * Pins the v2 plan invariants the headless wrapper must enforce:
 *
 *   1. SSE buffer parser handles canonical `data: <json>\n\n` blocks
 *      and tolerates partial trailing chunks (the runtime emits
 *      across multiple reader.read() ticks).
 *
 *   2. `permission_request` event triggers `status:
 *      'waiting_for_permission'` with the partial assistantText
 *      preserved + the requesting tool captured. **No durable
 *      resume** — the wrapper aborts the underlying stream so the
 *      agent's `await registerPendingPermission(...)` rejects.
 *
 *   3. `error` event triggers `status: 'failed'` with the message.
 *
 *   4. `done` event triggers `status: 'succeeded'`.
 *
 *   5. `text` events accumulate into `assistantText`; non-text
 *      events (tool_use, thinking, status) are observed but not
 *      added to the text trace (4b v1 keeps it simple).
 *
 * The full streamClaude integration isn't exercised here (it would
 * require a real subprocess / SDK mock); we test the parser + the
 * end-to-end semantics by feeding a constructed ReadableStream.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const HEADLESS_SRC = readFileSync(
  path.resolve(__dirname, '../../lib/headless-claude.ts'),
  'utf-8',
);

describe('parseSSEBuffer (pure helper)', () => {
  it('parses a single complete event', async () => {
    const { parseSSEBuffer } = await import('../../lib/headless-claude');
    const r = parseSSEBuffer(`data: {"type":"text","data":"hello"}\n\n`);
    assert.equal(r.events.length, 1);
    assert.equal(r.events[0].type, 'text');
    assert.equal(r.events[0].data, 'hello');
    assert.equal(r.remaining, '');
  });

  it('parses multiple complete events in order', async () => {
    const { parseSSEBuffer } = await import('../../lib/headless-claude');
    const r = parseSSEBuffer(
      `data: {"type":"text","data":"foo"}\n\ndata: {"type":"text","data":"bar"}\n\ndata: {"type":"done","data":""}\n\n`,
    );
    assert.equal(r.events.length, 3);
    assert.equal(r.events[0].type, 'text');
    assert.equal(r.events[1].type, 'text');
    assert.equal(r.events[2].type, 'done');
  });

  it('preserves a trailing partial chunk for the next read', async () => {
    const { parseSSEBuffer } = await import('../../lib/headless-claude');
    // 1 complete event + half a 2nd one (no terminating \n\n yet).
    const r = parseSSEBuffer(
      `data: {"type":"text","data":"first"}\n\ndata: {"type":"text",`,
    );
    assert.equal(r.events.length, 1);
    assert.equal(r.events[0].type, 'text');
    assert.equal(r.remaining.startsWith('data: {"type":"text",'), true);
  });

  it('skips malformed JSON without throwing', async () => {
    const { parseSSEBuffer } = await import('../../lib/headless-claude');
    const r = parseSSEBuffer(
      `data: {bad json}\n\ndata: {"type":"text","data":"good"}\n\n`,
    );
    assert.equal(r.events.length, 1);
    assert.equal(r.events[0].type, 'text');
    assert.equal(r.events[0].data, 'good');
  });
});

function makeStream(chunks: string[]): ReadableStream<string> {
  let i = 0;
  return new ReadableStream<string>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[i]);
      i += 1;
    },
  });
}

describe('normalizeEventData (Codex P2 fix)', () => {
  // formatSSE in claude-client wraps `{type, data: <STRINGIFIED>}`
  // into `data: <JSON>\n\n`. After parseSSEBuffer.JSON.parse the
  // outer block, our `evt.data` is the raw string, not the parsed
  // object. Earlier rev only checked `typeof evt.data === 'object'`
  // → permanently false → toolName / toolInput / sdk_session_id were
  // dropped on the floor. The end-to-end tests below cover the bug
  // scenario; this block pins the unit-level invariants.
  it('parses a JSON-stringified payload back into the expected object', async () => {
    const { parseSSEBuffer } = await import('../../lib/headless-claude');
    const inner = JSON.stringify({ toolName: 'Write', toolInput: { path: '/tmp/x' } });
    const wire = `data: ${JSON.stringify({ type: 'permission_request', data: inner })}\n\n`;
    const r = parseSSEBuffer(wire);
    assert.equal(r.events.length, 1);
    // evt.data is the still-stringified inner payload — the consumer
    // is responsible for the second JSON.parse via normalizeEventData.
    assert.equal(typeof r.events[0].data, 'string');
    const inner2 = JSON.parse(r.events[0].data as string);
    assert.equal(inner2.toolName, 'Write');
    assert.deepEqual(inner2.toolInput, { path: '/tmp/x' });
  });

  it('source must dispatch through normalizeEventData for non-text events (so tool name + sdk_session_id survive)', () => {
    // Pin the structural fix: there's a `normalizeEventData` helper
    // and the dispatch loop reads `evt.data` through it before
    // pulling fields. Earlier rev did `typeof evt.data === 'object'`
    // checks straight on the raw string, which silently skipped
    // every wrapped payload.
    assert.match(
      HEADLESS_SRC,
      /function\s+normalizeEventData\s*\(/,
      'headless-claude.ts must define normalizeEventData (Codex P2). Without it, JSON-stringified SSE payloads are read as strings and field access returns undefined.',
    );
    // The permission_request branch must read `data` (normalized),
    // not `evt.data` directly. We assert the toolName extraction
    // sees normalized form.
    assert.match(
      HEADLESS_SRC,
      /['"]permission_request['"][\s\S]{0,1500}?d\.toolName/,
      'permission_request branch must dereference toolName from a normalized payload (not from raw evt.data).',
    );
  });

  it('text branch must NOT call normalizeEventData (text data is a raw string, not JSON)', () => {
    // Edge: claude-client emits `text` deltas as raw strings, no
    // JSON wrapping. JSON.parse('"true"' as text) would silently
    // turn `"true"` into a boolean and drop a legitimate text
    // fragment. Pin the structural choice: the `text` branch reads
    // evt.data directly, every other branch goes through normalize.
    // Window 0-1200 covers the comment block + the `if/append/
    // continue;` triplet without spilling into the next branch.
    const m = HEADLESS_SRC.match(
      /evt\.type\s*===\s*['"]text['"][\s\S]{0,1200}?continue;/,
    );
    assert.ok(
      m,
      'text branch must early-continue so the normalize step below cannot reach it (raw-string text deltas would be parsed as booleans/numbers and lost).',
    );
    assert.doesNotMatch(
      m![0],
      /normalizeEventData/,
      'text branch must read evt.data directly — JSON.parse on a literal text fragment "true"/"42"/null would silently turn the delta into a non-string and drop it.',
    );
  });

  it('captures sdkSessionId from status / result events for runner persistence', () => {
    // Codex P1 — agent-task-runner needs to call updateSdkSessionId
    // after a successful run so the next scheduled fire can SDK-resume
    // instead of starting from a blank brain. The id only appears in
    // `status` (init) and `result` (final) event payloads. Pin both
    // branches.
    assert.match(
      HEADLESS_SRC,
      /evt\.type\s*===\s*['"]status['"][\s\S]{0,500}?session_id/,
      'status event branch must capture session_id (the SDK init carries it).',
    );
    assert.match(
      HEADLESS_SRC,
      /evt\.type\s*===\s*['"]result['"][\s\S]{0,500}?session_id/,
      'result event branch must capture session_id (defense for status-event misses).',
    );
    assert.match(
      HEADLESS_SRC,
      /sdkSessionId\??\s*:/,
      'HeadlessRunResult must expose sdkSessionId so the runner can persist it.',
    );
  });
});

describe('runClaudeHeadless: end-to-end semantics (mock streamClaude)', () => {
  // We can't easily monkey-patch streamClaude (ESM module imports
  // are read-only), so we exercise the consume loop via a smaller
  // helper extracted for testability. The runner imports `streamClaude`
  // dynamically, so the real-world wiring is exercised at runtime.
  // For the parser + status-machine logic, the parseSSEBuffer cases
  // above + the source-grep contracts below cover the intent.
  it('source declares status enum that matches v2 plan: succeeded | failed | waiting_for_permission', () => {
    assert.match(
      HEADLESS_SRC,
      /export\s+type\s+HeadlessRunStatus\s*=\s*'succeeded'\s*\|\s*'failed'\s*\|\s*'waiting_for_permission'/,
      `headless-claude.ts must declare HeadlessRunStatus = 'succeeded' | 'failed' | 'waiting_for_permission' (no other states); the runner translates these into task_run_logs.status writes.`,
    );
  });

  it('permission_request branch aborts the underlying stream (no durable resume)', () => {
    // Pin the structural intent: when the consumer sees a
    // permission_request event, it must call abortController.abort()
    // so the agent's pending permission await rejects. Without this,
    // background tasks would deadlock waiting for a UI that doesn't
    // exist.
    const block = HEADLESS_SRC.match(
      /['"]permission_request['"][\s\S]*?abortController\.abort\(\)/,
    );
    assert.ok(
      block,
      'permission_request branch must call abortController.abort() before returning waiting_for_permission. Without this, the agent process stays parked on registerPendingPermission and the runner leaks.',
    );
  });

  it('does NOT contain language about resuming or restoring agent state (no durable resume v1)', () => {
    // Drop comments so the v2 plan's negative-case rationale doesn't
    // trip the assertion.
    const stripped = HEADLESS_SRC
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, ''))
      .join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    for (const phrase of [
      /resume\s+(?:the\s+)?stream\s+from/i,
      /continue\s+the\s+paused\s+stream/i,
      /restore\s+agent\s+state/i,
    ]) {
      assert.doesNotMatch(
        stripped,
        phrase,
        `headless code must not suggest durable resume (matched ${phrase}); v2 plan's rule #2 forbids it. The user re-runs from scratch or abandons.`,
      );
    }
  });

  it('text events accumulate into assistantText; tool_use/thinking are NOT appended', () => {
    // Check the dispatch logic structurally — only the 'text' branch
    // touches assistantText; the others handle their own concerns or
    // are observed-and-ignored. Wider window because there's an
    // explanatory comment between the branch entry and the actual
    // append.
    assert.match(
      HEADLESS_SRC,
      /evt\.type\s*===\s*['"]text['"][\s\S]{0,500}?assistantText\s*\+=/,
      "the 'text' event branch must append to assistantText",
    );
    // The exact non-append behavior for tool_use/thinking is asserted
    // by absence: search for any 'tool_use'/'thinking' branch that
    // ALSO touches assistantText.
    assert.doesNotMatch(
      HEADLESS_SRC,
      /evt\.type\s*===\s*['"]tool_use['"][\s\S]{0,500}?assistantText\s*\+=/,
      "tool_use must NOT contribute to assistantText (4b v1 keeps the message trace text-only)",
    );
    assert.doesNotMatch(
      HEADLESS_SRC,
      /evt\.type\s*===\s*['"]thinking['"][\s\S]{0,500}?assistantText\s*\+=/,
      'thinking events must NOT contribute to assistantText',
    );
  });
});

describe('agent-task-runner now uses headless streamClaude (Step 4b swap)', () => {
  it('runScheduledAgentTask imports runClaudeHeadless and no longer uses generateTextFromProvider', () => {
    const runnerSrc = readFileSync(
      path.resolve(__dirname, '../../lib/agent-task-runner.ts'),
      'utf-8',
    );
    assert.match(
      runnerSrc,
      /runClaudeHeadless/,
      'agent-task-runner must call runClaudeHeadless — Step 4b replaces 4a\'s generateTextFromProvider one-shot.',
    );
    // Strip line + block comments first so the rationale comments
    // mentioning the old API don't trip the negative assertion.
    const stripped = runnerSrc
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, ''))
      .join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(
      stripped,
      /generateTextFromProvider/,
      'agent-task-runner code must not reference generateTextFromProvider after Step 4b. Comments explaining the legacy path are stripped before this check.',
    );
  });

  it('runner waiting_for_permission branch persists partial assistant text + flips run status', () => {
    const runnerSrc = readFileSync(
      path.resolve(__dirname, '../../lib/agent-task-runner.ts'),
      'utf-8',
    );
    // Locate the waiting_for_permission branch and assert it (a)
    // calls addMessage with task_run_id metadata, (b) updates the
    // run row to status='waiting_for_permission'.
    const branch = runnerSrc.match(
      /headless\.status\s*===\s*['"]waiting_for_permission['"][\s\S]*?return\s*\{[\s\S]*?status:\s*['"]waiting_for_permission['"]/,
    );
    assert.ok(branch, 'agent-task-runner must have an explicit waiting_for_permission branch');
    assert.match(
      branch![0],
      /addMessage\([\s\S]*?task_run_id:\s*runId/,
      'waiting_for_permission branch must persist the partial assistant text with task_run_id metadata so MessageList can render the WaitingForPermissionPanel',
    );
    assert.match(
      branch![0],
      /updateTaskRunLog\([\s\S]*?status:\s*['"]waiting_for_permission['"]/,
      'waiting_for_permission branch must flip task_run_logs.status accordingly',
    );
  });

  it('runner forwards full session context to runClaudeHeadless (Codex P1)', () => {
    // Earlier rev only forwarded prompt/sessionId/system/working-
    // directory — every fire was a "new brain". The fix is to mirror
    // what chat/route.ts builds for streamClaude. Pin every field
    // separately so missing-one regressions get caught.
    const runnerSrc = readFileSync(
      path.resolve(__dirname, '../../lib/agent-task-runner.ts'),
      'utf-8',
    );
    // Find the runClaudeHeadless call's options bag.
    const callMatch = runnerSrc.match(
      /runClaudeHeadless\(\s*\{[\s\S]*?\}\s*\)/,
    );
    assert.ok(
      callMatch,
      'expected a runClaudeHeadless({...}) call in the runner.',
    );
    const callBody = callMatch![0];
    // SDK resume — without this, every scheduled fire starts a fresh
    // SDK conversation and the model has no memory of prior turns
    // even within the same task-bound session.
    assert.match(
      callBody,
      /sdkSessionId\s*:/,
      'runner must pass sdkSessionId to runClaudeHeadless (else SDK resume never engages and tasks lose all prior context).',
    );
    // Fallback context — when SDK resume fails or has been cleared,
    // streamClaude reconstitutes context from history + summary. The
    // runner must plumb both. Allow object-shorthand (`conversationHistory,`)
    // or explicit (`conversationHistory: x,`) — both are valid forms
    // and the test should accept either as long as the prop is passed.
    assert.match(
      callBody,
      /conversationHistory\s*[,:}\n]/,
      'runner must pass conversationHistory to runClaudeHeadless (fallback path when SDK resume is unavailable).',
    );
    assert.match(
      callBody,
      /sessionSummary\s*:/,
      'runner must pass sessionSummary to runClaudeHeadless (compressed-context skeleton).',
    );
    assert.match(
      callBody,
      /sessionSummaryBoundaryRowid\s*:/,
      'runner must pass sessionSummaryBoundaryRowid so reactive compact preserves the existing boundary instead of resetting to 0.',
    );
    // Per-session execution-engine pin — the headline immunity Phase
    // 2 promised. ScheduledTask itself doesn't carry runtime_pin;
    // pinning lives on the task-bound or buddy session row.
    assert.match(
      callBody,
      /sessionRuntimePin\s*:[^,}]*session\?/,
      'runner must derive sessionRuntimePin from the task-bound session (chat_sessions.runtime_pin), not pass undefined unconditionally.',
    );
    // Provider / model — without these, the resolver picks fresh
    // defaults instead of the model the session actually committed
    // to.
    assert.match(
      callBody,
      /sessionProviderId\s*:/,
      'runner must pass sessionProviderId so streamClaude resolves the same provider this session has been writing to.',
    );
    assert.match(
      callBody,
      /\bmodel\s*:/,
      'runner must pass model (from the session row) so the model name persists across runs.',
    );
  });

  it('runner persists the new sdk_session_id after a successful run', () => {
    const runnerSrc = readFileSync(
      path.resolve(__dirname, '../../lib/agent-task-runner.ts'),
      'utf-8',
    );
    // Pin the post-call write. The conditional `headless.sdkSessionId
    // && ...` lets us skip the write for permission-aborted runs that
    // never saw the init event, so a permission-aborted retry doesn't
    // overwrite a known-good sdk_session_id with empty.
    assert.match(
      runnerSrc,
      /headless\.sdkSessionId[\s\S]{0,200}?updateSdkSessionId\(/,
      'runner must call updateSdkSessionId(sessionId, headless.sdkSessionId) after a successful headless run, otherwise the next scheduled run still SDK-resumes against the OLD session id and the model loses any state SDK created internally during this run.',
    );
  });

  it('runner runs the Phase 2 invalidReason gate before the headless call (Codex P2)', () => {
    const runnerSrc = readFileSync(
      path.resolve(__dirname, '../../lib/agent-task-runner.ts'),
      'utf-8',
    );
    // The gate must use `resolveProviderForSession`, NOT raw
    // `resolveProvider` — only the session-scoped wrapper sets
    // `invalidReason` for "session points at a deleted provider".
    // Raw resolveProvider silently env-falls-back, which is the bug
    // Phase 2 closed and the runner was re-introducing.
    assert.match(
      runnerSrc,
      /resolveProviderForSession\s*\(/,
      'runner must call resolveProviderForSession (Phase 2 immunity gate). Raw resolveProvider silently falls back to env when the session provider is deleted.',
    );
    // The short-circuit must:
    //   1. Detect invalidReason
    //   2. Return early with status='failed' (no streamClaude call)
    //   3. Write the run row to terminal status so the scheduler can
    //      fire the failure notification + linkback.
    const gateBlock = runnerSrc.match(
      /resolved\.invalidReason\b[\s\S]{0,1500}?return\s*\{[\s\S]{0,200}?status:\s*['"]failed['"]/,
    );
    assert.ok(
      gateBlock,
      'when resolved.invalidReason is set, runner must return { status: "failed" } early — never reach runClaudeHeadless. Otherwise streamClaude env-fallback re-introduces the silent re-route.',
    );
    assert.match(
      gateBlock![0],
      /updateTaskRunLog\([\s\S]{0,300}?status:\s*['"]failed['"]/,
      'invalidReason short-circuit must also flip the task_run_logs row to status="failed" so /runs and the failure-notification linkback see the terminal state.',
    );
  });

  it('runner forwards the resolved provider + provider id + model to runClaudeHeadless (Codex P2)', () => {
    const runnerSrc = readFileSync(
      path.resolve(__dirname, '../../lib/agent-task-runner.ts'),
      'utf-8',
    );
    const callMatch = runnerSrc.match(/runClaudeHeadless\(\s*\{[\s\S]*?\}\s*\)/);
    assert.ok(callMatch, 'expected a runClaudeHeadless call body to inspect.');
    const body = callMatch![0];
    // The resolved provider object must be forwarded so streamClaude
    // doesn't re-resolve from raw session fields. Pin the literal
    // `resolved.provider` reference, not just any `provider:` prop —
    // earlier rev was passing nothing here.
    assert.match(
      body,
      /provider\s*:\s*resolved\.provider\b/,
      'runner must forward `provider: resolved.provider` so the headless run hits the SAME provider chat/route would have picked.',
    );
    // ProviderId — derived from the resolved provider, not blindly
    // taken from `session.provider_id` (which could be the deleted
    // ghost id the gate above just refused to use).
    assert.match(
      body,
      /providerId\s*:\s*effectiveProviderId/,
      'runner must forward providerId derived from the resolved provider (effectiveProviderId), not the raw session field.',
    );
    // Model — prefer upstream over alias (chat route does the same
    // at line 647). Third-party Anthropic-compat proxies sometimes
    // only accept the upstream id.
    assert.match(
      body,
      /\bmodel\s*:[\s\S]{0,200}?resolved\.upstreamModel/,
      'runner must prefer resolved.upstreamModel over resolved.model when calling streamClaude — third-party proxies may only accept the upstream id.',
    );
  });

  it('invalidReason gate runs before heavy imports (mcp-loader / headless-claude)', () => {
    // Pin the import ordering so the gate stays fast even under DB
    // contention. Earlier rev imported runClaudeHeadless +
    // mcp-loader before the gate, which pushed a "deleted provider"
    // sync-failing run from <50ms to several hundred ms — long
    // enough that run-event-link.test.ts started racing on a 400ms
    // wait. Heavy imports MUST live below the invalidReason early
    // return.
    const runnerSrc = readFileSync(
      path.resolve(__dirname, '../../lib/agent-task-runner.ts'),
      'utf-8',
    );
    // Resolve positions: provider-resolver import (pre-gate) and the
    // headless-claude import (post-gate). Both should exist; the
    // first must precede the gate, the second must follow it.
    const providerResolverImportIdx = runnerSrc.indexOf(
      `await import('./provider-resolver')`,
    );
    const headlessImportIdx = runnerSrc.indexOf(
      `await import('./headless-claude')`,
    );
    const mcpLoaderImportIdx = runnerSrc.indexOf(
      `await import('./mcp-loader')`,
    );
    const invalidReasonIdx = runnerSrc.indexOf('resolved.invalidReason');
    assert.ok(providerResolverImportIdx > -1, 'expected provider-resolver import.');
    assert.ok(headlessImportIdx > -1, 'expected headless-claude import.');
    assert.ok(mcpLoaderImportIdx > -1, 'expected mcp-loader import.');
    assert.ok(invalidReasonIdx > -1, 'expected resolved.invalidReason check.');
    assert.ok(
      providerResolverImportIdx < invalidReasonIdx,
      'provider-resolver must be imported BEFORE the invalidReason gate (the gate calls resolveProviderForSession).',
    );
    assert.ok(
      headlessImportIdx > invalidReasonIdx,
      'headless-claude must be imported AFTER the invalidReason gate. Importing it earlier paid the transitive load on every "deleted provider" run and slowed the gate enough to race scheduler tests.',
    );
    assert.ok(
      mcpLoaderImportIdx > invalidReasonIdx,
      'mcp-loader must be imported AFTER the invalidReason gate — same reason as headless-claude.',
    );
  });

  it('runner loads MCP servers via predictNativeRuntime + loadAllMcpServers / loadCodePilotMcpServers (Codex P2)', () => {
    const runnerSrc = readFileSync(
      path.resolve(__dirname, '../../lib/agent-task-runner.ts'),
      'utf-8',
    );
    // Without this branch, headless tasks would only see the
    // keyword-injected CodePilot built-ins; user-configured MCP
    // servers wouldn't load → foreground vs scheduled diverge.
    assert.match(
      runnerSrc,
      /predictNativeRuntime\(\s*effectiveProviderId/,
      'runner must select MCP server scope via predictNativeRuntime(effectiveProviderId) — same rule chat/route.ts uses.',
    );
    assert.match(
      runnerSrc,
      /loadAllMcpServers\(\)[\s\S]{0,200}?loadCodePilotMcpServers\(\)/,
      'runner must load BOTH variants — native runtime gets loadAllMcpServers (full map); SDK runtime gets loadCodePilotMcpServers (env-placeholder subset).',
    );
    // And actually pass it.
    const callMatch = runnerSrc.match(/runClaudeHeadless\(\s*\{[\s\S]*?\}\s*\)/);
    assert.ok(callMatch);
    assert.match(
      callMatch![0],
      /mcpServers\s*[,:]/,
      'runner must pass mcpServers to runClaudeHeadless (object-shorthand or explicit colon both fine).',
    );
  });
});

describe('TaskWaitingForPermissionPanel UI plumb (Codex P2)', () => {
  // The panel calls `onAction?.()` after a successful re-run /
  // abandon, but only its parent (ChatView via MessageList) holds
  // the message + taskRuns state. Earlier rev rendered the panel
  // without the prop, so the panel stayed visible after abandon
  // even though task_run_logs.status was already 'cancelled' in DB.
  it('MessageList passes onTaskRunAction through to TaskWaitingForPermissionPanel as onAction', () => {
    const messageListSrc = readFileSync(
      path.resolve(__dirname, '../../components/chat/MessageList.tsx'),
      'utf-8',
    );
    // The render site must wire onAction. Match against the JSX
    // <TaskWaitingForPermissionPanel run={run} onAction={...} />
    // to make accidental prop omission a hard test failure.
    assert.match(
      messageListSrc,
      /<TaskWaitingForPermissionPanel\s+run=\{run\}\s+onAction=\{onTaskRunAction\}/,
      'MessageList must pass onAction={onTaskRunAction} to TaskWaitingForPermissionPanel — without it the panel never refreshes after abandon/rerun (Codex P2 regression).',
    );
    // And the prop must be declared on the component's interface.
    assert.match(
      messageListSrc,
      /onTaskRunAction\??:\s*\(\)\s*=>\s*void/,
      'MessageList must declare onTaskRunAction in MessageListProps so the parent can wire reconcileWithDb.',
    );
  });

  it('ChatView wires onTaskRunAction={reconcileWithDb} into MessageList', () => {
    const chatViewSrc = readFileSync(
      path.resolve(__dirname, '../../components/chat/ChatView.tsx'),
      'utf-8',
    );
    // Anchor on the actual JSX render block, not on stray references
    // (e.g. an explanatory `<MessageList />` mention in a comment
    // higher up). The render block opens with `<MessageList\n` —
    // newline immediately after the tag name — and runs to its
    // self-close. Up the window to 4 KiB to span every prop.
    const ml = chatViewSrc.match(
      /<MessageList\n[\s\S]{0,4000}?\/>/,
    );
    assert.ok(ml, 'expected the <MessageList\\n .../> JSX render block in ChatView.');
    assert.match(
      ml![0],
      /onTaskRunAction=\{reconcileWithDb\}/,
      'ChatView must pass onTaskRunAction={reconcileWithDb} so the panel actually refreshes after abandon/rerun.',
    );
  });
});

describe('TaskWaitingForPermissionPanel: only Re-run / Abandon, no resume', () => {
  it('source has only the two action buttons + no "continue"/"resume" language', () => {
    const panelSrc = readFileSync(
      path.resolve(__dirname, '../../components/chat/TaskWaitingForPermissionPanel.tsx'),
      'utf-8',
    );
    // Re-run: POST /api/tasks/{taskId}/run. fetch(URL, opts) — URL
    // precedes options block. Pin both halves regardless of order.
    assert.match(
      panelSrc,
      /\/api\/tasks\/[^`'"]*?\/run/,
      'panel must call /api/tasks/{id}/run for the Re-run action',
    );
    assert.match(
      panelSrc,
      /method:\s*['"]POST['"]/,
      'panel must use POST for the Re-run action (creates a new runId)',
    );
    // Abandon: PATCH /api/tasks/runs/{runId}.
    assert.match(
      panelSrc,
      /\/api\/tasks\/runs\/[^`'"]*?\$\{[^}]*?run\.id/,
      'panel must call /api/tasks/runs/{runId} for the Abandon action',
    );
    assert.match(
      panelSrc,
      /method:\s*['"]PATCH['"]/,
      'panel must use PATCH for the Abandon action (flips old run to cancelled)',
    );
    // No durable resume language.
    const stripped = panelSrc
      .split('\n')
      .map((l) => l.replace(/\/\/.*$/, ''))
      .join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    for (const phrase of [
      /agent\.resume/i,
      /continueRun/i,
      /resumeRun/i,
      /\bresume\s+stream\b/i,
    ]) {
      assert.doesNotMatch(
        stripped,
        phrase,
        `panel must not invoke any "resume" / "continue" API (matched ${phrase}); v2 invariant forbids durable resume.`,
      );
    }
  });
});

// ────────────────────────────────────────────────────────────────────
// Codex follow-up: tool event handling + pseudo-XML detection
// ────────────────────────────────────────────────────────────────────
//
// Scenario:
//   - A non-Claude model behind an Anthropic-compat proxy (e.g. GLM)
//     emits tool calls as XML inside `text` events because the
//     proxy fails to translate the model's native tool format into
//     the SDK's `tool_use` events.
//   - The SDK never recognises a real tool call, never executes a
//     tool, and the stream still terminates `done`.
//   - Earlier rev: runner persisted the raw XML to the chat session
//     as if it were the model's answer + marked the run 'succeeded'.
//   - New rev: detect (toolResultCount===0 + pseudo-XML in text) and
//     flip status to 'failed' so the run row reflects the broken
//     tool config and the recurring scheduler stops firing into it.

function buildSSE(events: Array<{ type: string; data: unknown }>): string {
  // For text events, the data is a raw string delta; for everything
  // else, claude-client formatSSE stringifies the inner payload (so
  // evt.data becomes a string of JSON). Mirror both forms exactly.
  const parts: string[] = [];
  for (const e of events) {
    const innerData =
      e.type === 'text'
        ? typeof e.data === 'string'
          ? e.data
          : String(e.data)
        : JSON.stringify(e.data);
    parts.push(`data: ${JSON.stringify({ type: e.type, data: innerData })}\n\n`);
  }
  return parts.join('');
}

describe('detectPseudoToolCallXml (Codex P2 follow-up)', () => {
  it('matches <tool_call_list> wrapper', async () => {
    const { detectPseudoToolCallXml } = await import('../../lib/headless-claude');
    assert.equal(
      detectPseudoToolCallXml('<tool_call_list><tool_call name="LS"/></tool_call_list>'),
      true,
    );
  });

  it('matches a bare <tool_call> with attributes', async () => {
    const { detectPseudoToolCallXml } = await import('../../lib/headless-claude');
    assert.equal(
      detectPseudoToolCallXml('I will call: <tool_call name="LS">{}</tool_call>'),
      true,
    );
  });

  it('does NOT match prose mentioning the phrase tool_call as English text', async () => {
    const { detectPseudoToolCallXml } = await import('../../lib/headless-claude');
    // Without the leading `<`, it's just user prose — must not
    // false-match. The pseudo-XML produced by GLM-style proxies
    // always starts with the angle bracket.
    assert.equal(
      detectPseudoToolCallXml('We have a tool_call abstraction in the code.'),
      false,
    );
    assert.equal(
      detectPseudoToolCallXml('tool_call_list is documented at /docs/tools.'),
      false,
    );
  });
});

describe('consumeHeadlessStream — tool event semantics', () => {
  it('text → tool_use → tool_result → final text → done: succeeded with FULL transcript', async () => {
    const { consumeHeadlessStream } = await import('../../lib/headless-claude');
    // Simulate a real SDK round: model says some prose, calls a
    // tool, gets a result, replies with the final answer.
    const stream = makeStream([
      buildSSE([{ type: 'text', data: 'Let me check the directory.\n' }]),
      buildSSE([{ type: 'tool_use', data: { id: 't1', name: 'LS', input: {} } }]),
      buildSSE([{ type: 'tool_result', data: { tool_use_id: 't1', content: 'file1.txt\nfile2.txt', is_error: false } }]),
      buildSSE([{ type: 'text', data: 'Files: file1.txt, file2.txt' }]),
      buildSSE([{ type: 'done', data: '' }]),
    ]);
    const result = await consumeHeadlessStream(stream, new AbortController());
    assert.equal(result.status, 'succeeded');
    assert.equal(result.toolUseCount, 1);
    assert.equal(result.toolResultCount, 1);
    // The final assistantText should contain BOTH the prose before
    // and after the tool round — that's how the model narrates a
    // tool-using turn.
    assert.match(result.assistantText, /Let me check the directory\./);
    assert.match(result.assistantText, /Files: file1\.txt, file2\.txt/);
  });

  it('tool_use without matching tool_result → status flips to failed (integrity check, Codex P2)', async () => {
    // Edge case the pseudo-XML check alone misses: SDK DID emit
    // tool_use, so the protocol is fine — but tool_result never
    // came back (tool runtime crash, aborted handler, network drop).
    // Model's final text says "done" anyway. Without this integrity
    // check, the run goes 'succeeded' and a recurring task quietly
    // trusts a partial outcome.
    const { consumeHeadlessStream } = await import('../../lib/headless-claude');
    const stream = makeStream([
      buildSSE([{ type: 'text', data: 'Checking the directory.\n' }]),
      buildSSE([{ type: 'tool_use', data: { id: 't1', name: 'LS', input: { path: '/tmp' } } }]),
      // Note: no tool_result. Tool runtime "crashed".
      buildSSE([{ type: 'text', data: 'Done — files are listed above.' }]),
      buildSSE([{ type: 'done', data: '' }]),
    ]);
    const result = await consumeHeadlessStream(stream, new AbortController());
    assert.equal(
      result.status,
      'failed',
      'tool_use without a matching tool_result must flip to failed — recurring scheduler cannot trust the model\'s final text when at least one tool call lost its result mid-flight.',
    );
    assert.equal(result.toolUseCount, 1);
    assert.equal(result.toolResultCount, 0);
    assert.ok(
      result.error && /工具调用未返回结果|tool[_ ]?call[s]?\s+(?:did not|never)/i.test(result.error),
      'failed-status error must explain "tool calls did not return results" so the user understands it is mid-execution loss, not a config issue.',
    );
  });

  it('integrity check wins over pseudo-XML check when BOTH apply', async () => {
    // If somehow both signals fire (tool_use emitted but only some
    // returned + final text contains pseudo-XML), the integrity
    // failure is the more specific diagnosis: the SDK *did*
    // recognise tools, so the failure is mid-execution, not a
    // non-translating proxy. Make sure the integrity branch wins.
    const { consumeHeadlessStream } = await import('../../lib/headless-claude');
    const stream = makeStream([
      buildSSE([{ type: 'tool_use', data: { id: 't1', name: 'LS', input: {} } }]),
      buildSSE([{ type: 'text', data: '<tool_call name="X"/>' }]),
      buildSSE([{ type: 'done', data: '' }]),
    ]);
    const result = await consumeHeadlessStream(stream, new AbortController());
    assert.equal(result.status, 'failed');
    assert.ok(
      result.error && /工具调用未返回结果|tool[_ ]?call[s]?\s+(?:did not|never)/i.test(result.error),
      'when both integrity and pseudo-XML apply, the integrity message wins (the proxy is fine; the failure is mid-execution).',
    );
  });

  it('pseudo-XML in text + zero tool_result → status flips to failed (Codex P2 follow-up)', async () => {
    const { consumeHeadlessStream } = await import('../../lib/headless-claude');
    // The exact failure mode the user reported: the model emits its
    // tool call as XML text. The proxy doesn't translate. The SDK
    // never produces a real tool_use / tool_result. Stream ends
    // `done`. Headless must NOT mark this 'succeeded'.
    const stream = makeStream([
      buildSSE([{
        type: 'text',
        data: '<tool_call_list><tool_call name="list_directory">{"path": "/Users/foo"}</tool_call></tool_call_list>',
      }]),
      buildSSE([{ type: 'done', data: '' }]),
    ]);
    const result = await consumeHeadlessStream(stream, new AbortController());
    assert.equal(
      result.status,
      'failed',
      'pseudo-XML + zero tool_result must flip status to failed; otherwise recurring scheduler keeps firing into a broken tool config and persists XML to the chat session as if it were the model\'s answer.',
    );
    assert.equal(result.toolUseCount, 0);
    assert.equal(result.toolResultCount, 0);
    // The XML itself is preserved in assistantText so the runner
    // can persist it to the chat session for diagnostic visibility.
    assert.match(result.assistantText, /tool_call_list/);
    // The error message must explain *why* — "tools not executed".
    assert.ok(
      result.error && /工具未执行|tools? (?:were )?not executed/i.test(result.error),
      'failed-status error must explain that tools were not actually executed (so the user knows it is a config / proxy issue, not the prompt).',
    );
  });

  it('real tool execution wins even when text contains the literal substring "<tool_call"', async () => {
    // Defense against false-positive: if the model legitimately
    // describes the XML format AS PART OF its answer (e.g. the user
    // asked about XML tool-call syntax) but real tools also fired,
    // we should NOT flip to failed. The detector only matters when
    // toolResultCount===0.
    const { consumeHeadlessStream } = await import('../../lib/headless-claude');
    const stream = makeStream([
      buildSSE([{ type: 'text', data: 'The XML form is `<tool_call name="X"/>`.\n' }]),
      buildSSE([{ type: 'tool_use', data: { id: 't1', name: 'LS', input: {} } }]),
      buildSSE([{ type: 'tool_result', data: { tool_use_id: 't1', content: 'a.txt', is_error: false } }]),
      buildSSE([{ type: 'text', data: 'Done.' }]),
      buildSSE([{ type: 'done', data: '' }]),
    ]);
    const result = await consumeHeadlessStream(stream, new AbortController());
    assert.equal(result.status, 'succeeded');
    assert.equal(result.toolResultCount, 1);
  });

  it('captures sdk_session_id from result event and exposes via sdkSessionId', async () => {
    const { consumeHeadlessStream } = await import('../../lib/headless-claude');
    const stream = makeStream([
      buildSSE([{ type: 'status', data: { session_id: 'sdk-init-abc' } }]),
      buildSSE([{ type: 'text', data: 'OK.' }]),
      buildSSE([{ type: 'result', data: { session_id: 'sdk-final-xyz', subtype: 'success', is_error: false, num_turns: 1, duration_ms: 12 } }]),
      buildSSE([{ type: 'done', data: '' }]),
    ]);
    const result = await consumeHeadlessStream(stream, new AbortController());
    assert.equal(result.status, 'succeeded');
    // result event lands after status, so it's the one we keep —
    // matches what the runner ultimately writes back to chat_sessions.
    assert.equal(result.sdkSessionId, 'sdk-final-xyz');
  });
});

describe('runner — failed runs persist model output to session for diagnostics', () => {
  it('headless.status==="failed" with non-empty assistantText writes an annotated assistant message', () => {
    const runnerSrc = readFileSync(
      path.resolve(__dirname, '../../lib/agent-task-runner.ts'),
      'utf-8',
    );
    // Earlier rev only wrote the run row for failures, leaving the
    // chat session blank. After the pseudo-XML detection started
    // flipping status to failed, that blank session would tell the
    // user nothing — they wouldn't see WHAT the model said. Pin the
    // failed-branch addMessage call so the diagnostic stays visible.
    const failedBranch = runnerSrc.match(
      /headless\.status\s*===\s*['"]failed['"][\s\S]{0,2500}?return\s*\{[\s\S]{0,200}?status:\s*['"]failed['"]/,
    );
    assert.ok(failedBranch, 'expected the runner to have an explicit failed branch.');
    assert.match(
      failedBranch![0],
      /addMessage\([\s\S]{0,500}?task_run_id:\s*runId/,
      'failed branch must call addMessage with task_run_id metadata when assistantText is non-empty — otherwise the user opens the task session and sees an empty conversation despite the run row being terminal failed.',
    );
    // Pin the failure annotation suffix so the user sees `⚠️ ...
    // 工具未执行 ...` rather than just the raw pseudo-XML.
    assert.match(
      failedBranch![0],
      /⚠️/,
      'failed branch must annotate the message with a clear visual marker (⚠️) — otherwise pseudo-XML reads as if it were the actual answer.',
    );
  });
});
