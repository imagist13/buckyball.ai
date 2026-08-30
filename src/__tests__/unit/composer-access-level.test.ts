import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  COMPOSER_ACCESS_LEVELS,
  decodeComposerAccessLevel,
  encodeComposerAccessLevel,
} from '@/lib/composer-access-level';

describe('composer access level persisted → UI decode', () => {
  it('makes plan authoritative over every legacy profile', () => {
    for (const profile of ['default', 'auto_review', 'full_access', 'invalid']) {
      assert.deepEqual(decodeComposerAccessLevel('plan', profile), {
        level: 'read_only',
        legacyAsk: false,
        degraded: false,
        source: 'plan-mode',
      });
    }
  });

  it('maps code and missing mode through the normalized profile', () => {
    for (const mode of ['code', undefined]) {
      assert.equal(decodeComposerAccessLevel(mode, 'default').level, 'default');
      assert.equal(decodeComposerAccessLevel(mode, 'auto_review').level, 'auto_review');
      assert.equal(decodeComposerAccessLevel(mode, 'full_access').level, 'full_access');
    }
  });

  it('surfaces ask as conservative legacy state without inventing an elevation', () => {
    assert.deepEqual(decodeComposerAccessLevel('ask', 'full_access'), {
      level: 'default',
      legacyAsk: true,
      degraded: false,
      source: 'legacy-ask',
    });
  });

  it('fails unknown mode/profile values closed and leaves a breadcrumb', () => {
    assert.deepEqual(decodeComposerAccessLevel('superuser', 'full_access'), {
      level: 'default',
      legacyAsk: false,
      degraded: true,
      source: 'invalid-mode',
    });
    assert.deepEqual(decodeComposerAccessLevel('code', 'superuser'), {
      level: 'default',
      legacyAsk: false,
      degraded: true,
      source: 'code-profile',
    });
  });

  it('marks a persisted reviewer profile degraded only after capability is known unsupported', () => {
    assert.equal(
      decodeComposerAccessLevel('code', 'auto_review', { autoReviewSupported: false }).degraded,
      true,
    );
    assert.equal(decodeComposerAccessLevel('code', 'auto_review').degraded, false);
  });
});

describe('composer access level UI → persistence encode', () => {
  it('round-trips every canonical UI level', () => {
    for (const level of COMPOSER_ACCESS_LEVELS) {
      const encoded = encodeComposerAccessLevel(level);
      assert.equal(
        decodeComposerAccessLevel(encoded.mode, encoded.permissionProfile).level,
        level,
      );
    }
  });

  it('keeps read-only planning out of elevated profiles', () => {
    assert.deepEqual(encodeComposerAccessLevel('read_only'), {
      mode: 'plan',
      permissionProfile: 'default',
    });
  });
});
