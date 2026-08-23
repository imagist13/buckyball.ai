import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MissingToolResultsError, streamText, type ModelMessage } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import {
  MISSING_TOOL_RESULT_CONTENT,
  repairIncompleteToolHistory,
} from '../../lib/tool-history-integrity';

function toolCall(id: string, providerExecuted = false): ModelMessage {
  return {
    role: 'assistant',
    content: [{
      type: 'tool-call',
      toolCallId: id,
      toolName: 'Read',
      input: { path: 'README.md' },
      ...(providerExecuted ? { providerExecuted: true } : {}),
    }],
  } as ModelMessage;
}

function toolResult(id: string, value = 'ok'): ModelMessage {
  return {
    role: 'tool',
    content: [{
      type: 'tool-result',
      toolCallId: id,
      toolName: 'Read',
      output: { type: 'text', value },
    }],
  } as ModelMessage;
}

describe('tool history integrity', () => {
  it('leaves a valid call/result pair unchanged', () => {
    const input = [
      { role: 'user', content: 'read it' } as ModelMessage,
      toolCall('call-1'),
      toolResult('call-1'),
      { role: 'user', content: 'continue' } as ModelMessage,
    ];
    const result = repairIncompleteToolHistory(input);
    assert.deepEqual(result.messages, input);
    assert.equal(result.synthesizedResults, 0);
    assert.equal(result.droppedOrphanResults, 0);
  });

  it('closes a missing result before the next user boundary', () => {
    const result = repairIncompleteToolHistory([
      { role: 'user', content: 'read it' } as ModelMessage,
      toolCall('call-1'),
      { role: 'user', content: 'continue after stop' } as ModelMessage,
    ]);
    assert.deepEqual(result.messages.map((message) => message.role), [
      'user', 'assistant', 'tool', 'user',
    ]);
    const synthetic = result.messages[2].content as Array<{
      toolCallId: string;
      output: { value: string };
    }>;
    assert.equal(synthetic[0].toolCallId, 'call-1');
    assert.equal(synthetic[0].output.value, MISSING_TOOL_RESULT_CONTENT);
    assert.equal(result.synthesizedResults, 1);
  });

  it('closes every pending call at end of transcript', () => {
    const call = {
      role: 'assistant',
      content: [
        { type: 'tool-call', toolCallId: 'call-1', toolName: 'Read', input: {} },
        { type: 'tool-call', toolCallId: 'call-2', toolName: 'Grep', input: {} },
      ],
    } as ModelMessage;
    const result = repairIncompleteToolHistory([call]);
    assert.equal(result.synthesizedResults, 2);
    assert.equal(result.messages.length, 2);
    assert.equal((result.messages[1].content as unknown[]).length, 2);
  });

  it('drops orphan results from model replay but retains non-result tool parts', () => {
    const orphan = {
      role: 'tool',
      content: [
        { type: 'tool-result', toolCallId: 'orphan', toolName: 'Read', output: { type: 'text', value: 'unknown' } },
        { type: 'tool-approval-response', approvalId: 'approval-1', approved: false },
      ],
    } as ModelMessage;
    const result = repairIncompleteToolHistory([orphan]);
    assert.equal(result.droppedOrphanResults, 1);
    assert.equal(result.messages.length, 1);
    assert.deepEqual(result.messages[0].content, [
      { type: 'tool-approval-response', approvalId: 'approval-1', approved: false },
    ]);
  });

  it('does not synthesize a result for provider-executed calls', () => {
    const result = repairIncompleteToolHistory([toolCall('provider-1', true)]);
    assert.equal(result.synthesizedResults, 0);
    assert.equal(result.messages.length, 1);
  });

  it('turns the real AI SDK MissingToolResults rejection into a valid prompt', async () => {
    const broken = [
      toolCall('call-stopped'),
      { role: 'user', content: 'continue' } as ModelMessage,
    ];
    const model = () => new MockLanguageModelV3({
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'stream-start', warnings: [] });
            controller.enqueue({
              type: 'response-metadata',
              id: 'repair-probe',
              modelId: 'test',
              timestamp: new Date(0),
            });
            controller.enqueue({ type: 'text-start', id: 'answer-1' });
            controller.enqueue({ type: 'text-delta', id: 'answer-1', delta: 'ok' });
            controller.enqueue({ type: 'text-end', id: 'answer-1' });
            controller.enqueue({
              type: 'finish',
              finishReason: { unified: 'stop', raw: 'stop' },
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
                outputTokens: { total: 1, text: 1, reasoning: undefined },
              },
            });
            controller.close();
          },
        }),
      }),
    });

    let observedError: unknown;
    const rejected = streamText({
      model: model(),
      messages: broken,
      onError: ({ error }) => { observedError = error; },
    });
    await assert.rejects(async () => { await rejected.response; });
    assert.equal(MissingToolResultsError.isInstance(observedError), true);

    const repaired = repairIncompleteToolHistory(broken);
    const accepted = streamText({ model: model(), messages: repaired.messages });
    await assert.doesNotReject(async () => { await accepted.response; });
  });
});
