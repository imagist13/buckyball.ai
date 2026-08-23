import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyHeartbeatOutcome,
  HEARTBEAT_TOKEN,
  isHeartbeatContentEmpty,
} from '../../lib/heartbeat';
import { heartbeatNotificationAction } from '../../lib/task-scheduler';

describe('heartbeat exact-token protocol', () => {
  it('silences only the exact HEARTBEAT_OK token after outer whitespace', () => {
    assert.deepEqual(classifyHeartbeatOutcome('  HEARTBEAT_OK\n'), {
      kind: 'silent',
      text: HEARTBEAT_TOKEN,
    });
  });

  for (const value of [
    'Summary: HEARTBEAT_OK',
    'HEARTBEAT_OK\nThere is something to review.',
    '<!-- heartbeat-done -->',
    'heartbeat_ok',
  ]) {
    it(`does not silence non-exact output: ${JSON.stringify(value)}`, () => {
      const outcome = classifyHeartbeatOutcome(value);
      assert.equal(outcome.kind, 'speak_up');
      assert.equal(outcome.text, value.trim());
    });
  }
});

describe('heartbeat content emptiness', () => {
  it('treats headings, comments and empty checkboxes as empty', () => {
    assert.equal(isHeartbeatContentEmpty('# Checklist\n\n- [ ]\n<!-- note -->'), true);
  });

  it('treats an actionable checklist item as non-empty', () => {
    assert.equal(isHeartbeatContentEmpty('- [ ] Review the latest daily memory'), false);
  });
});

describe('heartbeat notification click target', () => {
  it('persists an explicit route back to the assistant session', () => {
    assert.deepEqual(heartbeatNotificationAction('session/with space'), {
      type: 'route',
      payload: '/chat/session%2Fwith%20space',
    });
    assert.equal(heartbeatNotificationAction('  '), undefined);
  });
});
