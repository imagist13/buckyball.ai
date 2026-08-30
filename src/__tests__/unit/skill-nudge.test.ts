import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  shouldSuggestSkill,
  buildSkillNudgePayload,
  buildSkillNudgeStatusEvent,
  SKILL_NUDGE_STEP_THRESHOLD,
  SKILL_NUDGE_DISTINCT_TOOL_THRESHOLD,
} from '../../lib/skill-nudge';

describe('shouldSuggestSkill', () => {
  it('returns false when step count is below threshold', () => {
    const stats = {
      step: SKILL_NUDGE_STEP_THRESHOLD - 1,
      distinctTools: new Set(['A', 'B', 'C', 'D']),
    };
    assert.equal(shouldSuggestSkill(stats), false);
  });

  it('returns false when distinct tool count is below threshold', () => {
    const stats = {
      step: 100,
      distinctTools: new Set(
        Array.from({ length: SKILL_NUDGE_DISTINCT_TOOL_THRESHOLD - 1 }, (_, i) => `tool${i}`)
      ),
    };
    assert.equal(shouldSuggestSkill(stats), false);
  });

  it('returns true when both thresholds are met', () => {
    const stats = {
      step: SKILL_NUDGE_STEP_THRESHOLD,
      distinctTools: new Set(['A', 'B', 'C']),
    };
    assert.equal(shouldSuggestSkill(stats), true);
  });

  it('returns true when both thresholds are exceeded', () => {
    const stats = {
      step: 20,
      distinctTools: new Set(['Read', 'Write', 'Edit', 'Grep', 'Bash']),
    };
    assert.equal(shouldSuggestSkill(stats), true);
  });

  it('boundary: exactly at step threshold with exactly at distinct tool threshold', () => {
    const stats = {
      step: SKILL_NUDGE_STEP_THRESHOLD,
      distinctTools: new Set(['A', 'B', 'C'].slice(0, SKILL_NUDGE_DISTINCT_TOOL_THRESHOLD)),
    };
    assert.equal(shouldSuggestSkill(stats), true);
  });

  it('boundary: zero step, zero tools', () => {
    const stats = { step: 0, distinctTools: new Set<string>() };
    assert.equal(shouldSuggestSkill(stats), false);
  });
});

describe('buildSkillNudgePayload', () => {
  it('returns a skill_nudge payload with message and reason', () => {
    const stats = {
      step: 10,
      distinctTools: new Set(['Read', 'Write', 'Grep', 'Bash']),
    };
    const payload = buildSkillNudgePayload(stats);
    assert.equal(payload.type, 'skill_nudge');
    assert.ok(payload.message.length > 0);
    assert.equal(payload.reason.step, 10);
    assert.equal(payload.reason.distinctToolCount, 4);
  });

  it('tool names are sorted for deterministic telemetry', () => {
    const stats = {
      step: 8,
      distinctTools: new Set(['Write', 'Bash', 'Edit']),
    };
    const payload = buildSkillNudgePayload(stats);
    assert.deepEqual(payload.reason.toolNames, ['Bash', 'Edit', 'Write']);
  });

  it('message references the actual counts', () => {
    const stats = {
      step: 12,
      distinctTools: new Set(['A', 'B', 'C', 'D', 'E']),
    };
    const payload = buildSkillNudgePayload(stats);
    assert.ok(payload.message.includes('12'));
    assert.ok(payload.message.includes('5'));
  });
});

describe('buildSkillNudgeStatusEvent (fix 3 — SSE shape for web + bridge)', () => {
  const stats = { step: 10, distinctTools: new Set(['Read', 'Write', 'Grep']) };

  it('sets notification: true for web SSE parser branch', () => {
    // useSSEStream.ts:126 routes `statusData.notification` to
    // callbacks.onStatus(message) which renders in the status bar.
    // Without this flag, the event falls into the default branch and
    // shows raw JSON text.
    const event = buildSkillNudgeStatusEvent(stats);
    assert.equal(event.notification, true);
  });

  it('includes a human-readable message at top level', () => {
    const event = buildSkillNudgeStatusEvent(stats);
    assert.ok(typeof event.message === 'string');
    assert.ok(event.message.length > 0);
  });

  it('includes subtype: skill_nudge for bridge and future UI handlers', () => {
    // conversation-engine.ts's status case dispatches on subtype to
    // append the nudge to the assistant reply. Without subtype=="skill_nudge"
    // the bridge silently drops the event.
    const event = buildSkillNudgeStatusEvent(stats);
    assert.equal(event.subtype, 'skill_nudge');
  });

  it('embeds the full structured payload for telemetry/rich UIs', () => {
    const event = buildSkillNudgeStatusEvent(stats);
    assert.ok(event.payload);
    assert.equal(event.payload.type, 'skill_nudge');
    assert.equal(event.payload.reason.step, 10);
    assert.equal(event.payload.reason.distinctToolCount, 3);
    assert.deepEqual(event.payload.reason.toolNames, ['Grep', 'Read', 'Write']);
  });

  it('top-level message matches payload.message', () => {
    const event = buildSkillNudgeStatusEvent(stats);
    assert.equal(event.message, event.payload.message);
  });
});
