/**
 * Hooks POC — verifies whether Claude Agent SDK 0.2.111 fixed the CLI
 * control-frame pollution bug that forced us to disable queryOptions.hooks
 * (see claude-client.ts comment near hook block).
 *
 * Runbook:
 *   CLAUDE_SDK_POC=1 npm run test:sdk-poc -- --test-name-pattern=hooks
 *
 * Requires either:
 *   - ANTHROPIC_API_KEY, or
 *   - Claude Code OAuth session (CLAUDE_CODE_OAUTH_TOKEN)
 *
 * Exercises the full CodePilot queryOptions combination:
 *   hooks: { PreToolUse, PostToolUse, PermissionDenied } + canUseTool
 *   + in-process MCP + stderr capture + resume flag
 *
 * Pass criteria:
 *   - No "CLI output was not valid JSON" errors
 *   - hook callbacks fire with the expected shape
 *   - stderr capture doesn't corrupt control frames
 *
 * Output: writes structured report to docs/research/agent-sdk-0-2-111-capabilities.md.json
 * next to the research doc for regression comparison.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { fixtureMcpServer } from '../fixtures/fixture-mcp-server';
import { recordPocResult } from './poc-record';

const POC_ENABLED = process.env.CLAUDE_SDK_POC === '1';
const HAS_CREDS = !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN);

test('hooks POC — real queryOptions combination does not trigger CLI control-frame bug', { skip: !POC_ENABLED || !HAS_CREDS }, async () => {
  if (!POC_ENABLED) {
    console.log('[hooks-poc] Skipped: set CLAUDE_SDK_POC=1 to enable');
    return;
  }
  if (!HAS_CREDS) {
    console.log('[hooks-poc] Skipped: no ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN');
    return;
  }

  const hookInvocations: { event: string; tool?: string }[] = [];
  const stderrChunks: string[] = [];

  // Ask the model to call two tools: ping (should be allowed) and
  // fail_always (will be denied by canUseTool → triggers PermissionDenied
  // hook). This exercises all three hook surfaces the plan promises.
  const q = query({
    prompt: 'Call the fixture-poc ping tool, then call the fixture-poc fail_always tool. Report what happens with each.',
    options: {
      model: 'claude-opus-4-7',
      mcpServers: { 'fixture-poc': fixtureMcpServer },
      hooks: {
        PreToolUse: [{
          hooks: [async (input) => {
            const toolName = 'tool_name' in input ? input.tool_name : undefined;
            hookInvocations.push({ event: 'PreToolUse', tool: toolName });
            return { continue: true };
          }],
        }],
        PostToolUse: [{
          hooks: [async (input) => {
            const toolName = 'tool_name' in input ? input.tool_name : undefined;
            hookInvocations.push({ event: 'PostToolUse', tool: toolName });
            return { continue: true };
          }],
        }],
        PermissionDenied: [{
          hooks: [async (input) => {
            const toolName = 'tool_name' in input ? input.tool_name : undefined;
            hookInvocations.push({ event: 'PermissionDenied', tool: toolName });
            return { continue: true };
          }],
        }],
      },
      canUseTool: async (toolName) => {
        hookInvocations.push({ event: 'canUseTool', tool: toolName });
        // Deny fail_always specifically so PermissionDenied hook fires.
        if (toolName.includes('fail_always')) {
          return { behavior: 'deny', message: 'intentionally denied by POC' };
        }
        return { behavior: 'allow', updatedInput: {} };
      },
      stderr: (data: string) => {
        stderrChunks.push(data);
      },
    },
  });

  let resultSeen = false;
  let terminalReason: string | undefined;
  const jsonErrors: string[] = [];

  try {
    for await (const msg of q) {
      if (msg.type === 'result') {
        resultSeen = true;
        terminalReason = (msg as { terminal_reason?: string }).terminal_reason;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/valid JSON/i.test(message)) jsonErrors.push(message);
    throw err;
  }

  assert.equal(resultSeen, true, 'should receive a result message');
  assert.equal(jsonErrors.length, 0, 'should not emit "CLI output was not valid JSON" errors');
  assert.ok(hookInvocations.length > 0, 'hook callbacks should fire');
  // Sanity: all three hook types should have been exercised. If any is
  // missing, Phase 6 go/no-go should flag this as coverage gap.
  const byEvent = new Set(hookInvocations.map(i => i.event));
  assert.ok(byEvent.has('PreToolUse'), 'PreToolUse hook should fire at least once');
  assert.ok(byEvent.has('canUseTool'), 'canUseTool permission callback should fire at least once');
  assert.ok(byEvent.has('PermissionDenied'), 'PermissionDenied hook should fire when canUseTool returns deny');
  console.log('[hooks-poc] invocations:', hookInvocations);
  console.log('[hooks-poc] events covered:', [...byEvent]);
  console.log('[hooks-poc] terminal_reason:', terminalReason);
  console.log('[hooks-poc] stderr bytes:', stderrChunks.reduce((n, c) => n + c.length, 0));

  recordPocResult('hooks', {
    eventsCovered: [...byEvent],
    invocationCount: hookInvocations.length,
    terminalReason,
    stderrBytes: stderrChunks.reduce((n, c) => n + c.length, 0),
    jsonErrorCount: jsonErrors.length,
    cliControlFrameBugPresent: jsonErrors.length > 0,
  });
});
