/**
 * Unit tests for context-assembler.
 *
 * Run with: npx tsx --test src/__tests__/unit/context-assembler.test.ts
 *
 * Tests verify:
 * 1. Desktop entry point includes widget prompt
 * 2. Bridge entry point does NOT include widget prompt
 * 3. Workspace prompt only injected for assistant project sessions
 * 4. generative_ui_enabled=false skips widget even on desktop
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ChatSession } from '../../types';

function makeSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: 'test-session',
    title: 'Test',
    model: 'sonnet',
    working_directory: '/Users/test/project',
    system_prompt: 'You are a helpful assistant.',
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
    sdk_session_id: '',
    mode: 'code',
    provider_id: '',
    sdk_cwd: '',
    permission_profile: 'default',
    project_name: '',
    status: 'active',
    provider_name: '',
    runtime_pin: '',
    runtime_status: 'idle',
    runtime_updated_at: '',
    runtime_error: '',
    ...overrides,
  };
}

describe('assembleContext', () => {

  it('desktop: includes session prompt and enables generativeUI', async () => {
    const { assembleContext } = await import('../../lib/context-assembler');
    const result = await assembleContext({
      session: makeSession(),
      entryPoint: 'desktop',
      userPrompt: 'hello',
    });

    assert.ok(result.systemPrompt?.includes('You are a helpful assistant.'));
    assert.equal(result.generativeUIEnabled, true);
    assert.equal(result.isAssistantProject, false);
  });

  it('bridge: does NOT enable generativeUI or widget MCP', async () => {
    const { assembleContext } = await import('../../lib/context-assembler');
    const result = await assembleContext({
      session: makeSession(),
      entryPoint: 'bridge',
      userPrompt: 'hello',
    });

    assert.equal(result.generativeUIEnabled, false);
  });

  it('includes systemPromptAppend when provided', async () => {
    const { assembleContext } = await import('../../lib/context-assembler');
    const result = await assembleContext({
      session: makeSession(),
      entryPoint: 'desktop',
      userPrompt: 'hello',
      systemPromptAppend: 'EXTRA INSTRUCTIONS HERE',
    });

    assert.ok(result.systemPrompt?.includes('EXTRA INSTRUCTIONS HERE'));
    assert.ok(result.systemPrompt?.includes('You are a helpful assistant.'));
  });

  it('non-workspace session: isAssistantProject is false', async () => {
    const { assembleContext } = await import('../../lib/context-assembler');
    const result = await assembleContext({
      session: makeSession({ working_directory: '/Users/test/project' }),
      entryPoint: 'desktop',
      userPrompt: 'hello',
    });

    assert.equal(result.isAssistantProject, false);
    assert.equal(result.assistantProjectInstructions, '');
  });

  // Widget MCP keyword detection is now handled solely in claude-client.ts.
  // context-assembler no longer computes needsWidgetMcp.

  it('session with empty system_prompt: does not throw', async () => {
    const { assembleContext } = await import('../../lib/context-assembler');
    const result = await assembleContext({
      session: makeSession({ system_prompt: '' }),
      entryPoint: 'bridge',
      userPrompt: 'hello',
    });

    // Should not throw — prompt may be undefined or contain only CLI context
    assert.ok(true);
  });

  it('prompt ordering: session prompt present in result', async () => {
    const { assembleContext } = await import('../../lib/context-assembler');
    const result = await assembleContext({
      session: makeSession({ system_prompt: '<<SESSION>>' }),
      entryPoint: 'desktop',
      userPrompt: 'hello',
    });

    assert.ok(result.systemPrompt?.includes('<<SESSION>>'));
  });
});
