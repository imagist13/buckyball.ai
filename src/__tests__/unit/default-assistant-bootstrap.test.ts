import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import {
  ASSISTANT_WORKSPACE_PATH_SETTING,
  bootstrapDefaultAssistantWorkspace,
} from '@/lib/assistant-default-workspace';
import { resolveDefaultAssistantHome } from '../../../electron/default-assistant-home';

describe('default assistant bootstrap', () => {
  it('uses Electron Documents resolution instead of guessing a home path', () => {
    assert.equal(
      resolveDefaultAssistantHome(path.join('/platform', 'Documents')),
      path.join('/platform', 'Documents', 'CodePilot', 'Assistant'),
    );
  });

  it('is process-single-flight and commits only once', async () => {
    let stored = '';
    let initialized = 0;
    let commits = 0;
    const deps = {
      getSetting: () => stored || undefined,
      initializeWorkspace: () => {
        initialized += 1;
        return ['instructions.md'];
      },
      compareAndSetSettingIfBlank: (key: string, value: string) => {
        assert.equal(key, ASSISTANT_WORKSPACE_PATH_SETTING);
        commits += 1;
        if (stored.trim()) return false;
        stored = value;
        return true;
      },
    };

    const first = bootstrapDefaultAssistantWorkspace('/default-assistant', deps);
    const second = bootstrapDefaultAssistantWorkspace('/default-assistant', deps);
    assert.equal(first, second);

    const [a, b] = await Promise.all([first, second]);
    assert.equal(a.selected, true);
    assert.deepEqual(a, b);
    assert.equal(initialized, 1);
    assert.equal(commits, 1);
  });

  it('does not overwrite an explicit path that wins during initialization', async () => {
    let stored = '';
    const result = await bootstrapDefaultAssistantWorkspace('/default-assistant', {
      getSetting: () => stored || undefined,
      initializeWorkspace: () => {
        stored = '/user-selected-assistant';
        return ['instructions.md'];
      },
      compareAndSetSettingIfBlank: (_key: string, value: string) => {
        if (stored.trim()) return false;
        stored = value;
        return true;
      },
    });

    assert.equal(result.selected, false);
    assert.equal(result.path, '/user-selected-assistant');
    assert.equal(result.existingPath, '/user-selected-assistant');
  });

  it('leaves an existing non-blank path untouched, even when it is stale', async () => {
    let initialized = 0;
    const result = await bootstrapDefaultAssistantWorkspace('/default-assistant', {
      getSetting: () => '/missing-but-user-owned',
      initializeWorkspace: () => {
        initialized += 1;
        return [];
      },
      compareAndSetSettingIfBlank: () => true,
    });

    assert.equal(result.selected, false);
    assert.equal(result.path, '/missing-but-user-owned');
    assert.equal(initialized, 0);
  });
});
