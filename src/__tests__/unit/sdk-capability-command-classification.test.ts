import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PopoverItem } from '@/types';
import { appendSdkCapabilityCommands } from '@/hooks/useSlashCommands';

describe('SDK capability command classification', () => {
  it('treats metadata-only SDK skills as SDK commands, never injectable Skills', () => {
    const items = appendSdkCapabilityCommands([], [], [{ name: 'ball' }]);

    assert.deepEqual(items, [{
      label: 'ball',
      value: '/ball',
      description: 'SDK command: /ball',
      builtIn: false,
      source: 'sdk',
      kind: 'sdk_command',
    }]);
  });

  it('keeps a filesystem-backed Skill injectable when metadata has the same name', () => {
    const localSkill: PopoverItem = {
      label: 'ball',
      value: '/ball',
      description: 'Local SKILL.md',
      source: 'project',
      kind: 'agent_skill',
    };

    const items = appendSdkCapabilityCommands([localSkill], [], ['ball']);

    assert.deepEqual(items, [localSkill]);
  });

  it('deduplicates names shared by SDK commands and SDK skills', () => {
    const items = appendSdkCapabilityCommands([], ['compact'], ['compact']);

    assert.equal(items.length, 1);
    assert.equal(items[0].kind, 'sdk_command');
  });
});
