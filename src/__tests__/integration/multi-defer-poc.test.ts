/**
 * Multi-Defer POC — verifies whether Claude Agent SDK 0.2.111 allows a single
 * result round to produce multiple concurrent `deferred_tool_use` entries.
 *
 * Typings declare `SDKResultSuccess.deferred_tool_use?: SDKDeferredToolUse`
 * (singular, not array). If the SDK actually behaves as typed, the "merged
 * drawer" multi-defer UI in Phase 7b must be permanently dropped and we stay
 * with serial single-defer forever.
 *
 * Runbook:
 *   CLAUDE_SDK_POC=1 npm run test:sdk-poc -- --test-name-pattern=multi-defer
 *
 * Strategy:
 *   1. Attach a PreToolUse hook that returns { decision: 'defer' } for every
 *      tool invocation.
 *   2. Ask the model to call two tools in one turn.
 *   3. Observe whether:
 *        a) Only one defer surfaces, second tool never issued → singular
 *        b) Both surface as separate deferred_tool_use entries → SDK actually
 *           supports concurrent (typings lag)
 *        c) SDK crashes → bug, report upstream
 *
 * Output: result classification written to
 *   docs/research/agent-sdk-0-2-111-capabilities.md.json
 * Gates Phase 7b-future (concurrent-defer UI).
 */

import { test } from 'node:test';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { fixtureMcpServer } from '../fixtures/fixture-mcp-server';
import { recordPocResult } from './poc-record';

const POC_ENABLED = process.env.CLAUDE_SDK_POC === '1';
const HAS_CREDS = !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN);

test('multi-defer POC — classify SDK behavior on concurrent defer attempts', { skip: !POC_ENABLED || !HAS_CREDS }, async () => {
  if (!POC_ENABLED || !HAS_CREDS) {
    console.log('[multi-defer-poc] Skipped — see runbook in file header');
    return;
  }

  const deferredSeen: unknown[] = [];
  const resultMessages: unknown[] = [];

  const q = query({
    prompt: 'Please call the fixture-poc ping tool AND the fixture-poc echo tool (with value="hello") in this single response.',
    options: {
      model: 'claude-opus-4-7',
      mcpServers: { 'fixture-poc': fixtureMcpServer },
      maxTurns: 2,
      hooks: {
        PreToolUse: [{
          hooks: [async (_input) => ({
            hookSpecificOutput: {
              hookEventName: 'PreToolUse' as const,
              permissionDecision: 'defer' as const,
            },
          })],
        }],
      },
    },
  });

  for await (const msg of q) {
    if ((msg as { type?: string }).type === 'result') {
      resultMessages.push(msg);
      const deferred = (msg as { deferred_tool_use?: unknown }).deferred_tool_use;
      if (deferred) deferredSeen.push(deferred);
    }
  }

  const classification = (() => {
    if (resultMessages.length === 0) return 'no_result';
    if (deferredSeen.length === 0) return 'no_defer_at_all';
    if (deferredSeen.length === 1 && resultMessages.length === 1) return 'singular_as_typed';
    if (deferredSeen.length > 1) return 'concurrent_supported';
    if (resultMessages.length > 1) return 'serial_multi_round';
    return 'unknown';
  })();

  console.log('[multi-defer-poc] result count:', resultMessages.length);
  console.log('[multi-defer-poc] deferred count:', deferredSeen.length);
  console.log('[multi-defer-poc] classification:', classification);

  recordPocResult('multi_defer', {
    resultCount: resultMessages.length,
    deferredCount: deferredSeen.length,
    classification,
    concurrentSupported: classification === 'concurrent_supported',
  });

  // Intentionally no assert — this POC is a classifier, not a pass/fail gate.
  // Phase 7b-future unlocks iff classification === 'concurrent_supported'.
});
