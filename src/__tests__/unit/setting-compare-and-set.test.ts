import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compareAndSetSettingIfBlank, getSetting, setSetting } from '@/lib/db';

const KEY = 'test_default_assistant_compare_and_set';

describe('compareAndSetSettingIfBlank', () => {
  let previous: string | undefined;

  before(() => {
    previous = getSetting(KEY);
  });

  after(() => {
    setSetting(KEY, previous ?? '');
  });

  it('sets absent/blank values and refuses to replace an explicit value', () => {
    setSetting(KEY, '');
    assert.equal(compareAndSetSettingIfBlank(KEY, '/default'), true);
    assert.equal(getSetting(KEY), '/default');
    assert.equal(compareAndSetSettingIfBlank(KEY, '/other'), false);
    assert.equal(getSetting(KEY), '/default');
  });
});
