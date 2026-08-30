/**
 * Update-check version comparison — preview builds must rank BELOW the matching
 * stable release. Guards `compareSemver` (extracted to `src/lib/compare-semver.ts`)
 * which `src/app/api/app/updates/route.ts` uses as:
 *   updateAvailable = compareSemver(latestVersion, currentVersion) > 0
 *
 * Bug it locks: the old impl split on '.' + Number()-coerced the first three
 * segments, dropping the `-preview.N` suffix (and `NaN || 0` collapsed patch to
 * 0), so `0.55.0` compared EQUAL to `0.55.0-preview.5` → preview testers never
 * saw the stable v0.55.0 update.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { compareSemver } from '@/lib/compare-semver';

// `updateAvailable` in the route is exactly `compareSemver(latest, current) > 0`.
const updateAvailable = (latest: string, current: string) => compareSemver(latest, current) > 0;

describe('compareSemver — stable outranks same-version prerelease (update check)', () => {
  it('stable > same-version preview — the reported bug: preview.5 must see v0.55.0', () => {
    assert.equal(compareSemver('0.55.0', '0.55.0-preview.5'), 1);
    assert.equal(updateAvailable('0.55.0', '0.55.0-preview.5'), true);
  });

  it('stable > an earlier same-version preview', () => {
    assert.equal(compareSemver('0.55.0', '0.55.0-preview.4'), 1);
    assert.equal(updateAvailable('0.55.0', '0.55.0-preview.4'), true);
  });

  it('higher patch stable > preview of a lower patch', () => {
    assert.equal(compareSemver('0.55.1', '0.55.0-preview.5'), 1);
    assert.equal(updateAvailable('0.55.1', '0.55.0-preview.5'), true);
  });

  it('equal stable versions are NOT an update', () => {
    assert.equal(compareSemver('0.55.0', '0.55.0'), 0);
    assert.equal(updateAvailable('0.55.0', '0.55.0'), false);
  });

  it('a prerelease never updates over its own stable', () => {
    assert.equal(compareSemver('0.55.0-preview.5', '0.55.0'), -1);
    assert.equal(updateAvailable('0.55.0-preview.5', '0.55.0'), false);
  });

  it('prerelease identifiers order numerically: preview.4 < preview.5', () => {
    assert.equal(compareSemver('0.55.0-preview.4', '0.55.0-preview.5'), -1);
    assert.equal(compareSemver('0.55.0-preview.5', '0.55.0-preview.4'), 1);
    assert.equal(compareSemver('0.55.0-preview.5', '0.55.0-preview.5'), 0);
  });

  it('plain stable precedence still works (regression sanity) + tolerates leading v', () => {
    assert.equal(compareSemver('0.55.0', '0.54.0'), 1);
    assert.equal(compareSemver('0.54.0', '0.55.0'), -1);
    assert.equal(compareSemver('1.0.0', '0.99.99'), 1);
    assert.equal(compareSemver('v0.55.0', '0.55.0-preview.5'), 1);
  });

  it('unparseable versions are conservative → 0, never a false update', () => {
    assert.equal(compareSemver('garbage', '0.55.0'), 0);
    assert.equal(compareSemver('0.55.0', ''), 0);
    assert.equal(compareSemver('0.55', '0.55.0'), 0); // incomplete MAJOR.MINOR
    assert.equal(compareSemver(null as unknown as string, '0.55.0'), 0);
    assert.equal(updateAvailable('not-a-version', '0.55.0-preview.5'), false);
  });
});

describe('updates route source — uses the shared comparator, not a re-inlined one', () => {
  const src = readFileSync(
    path.resolve(__dirname, '../../app/api/app/updates/route.ts'),
    'utf8',
  );
  it('imports compareSemver from the lib', () => {
    assert.match(src, /import \{ compareSemver \} from "@\/lib\/compare-semver"/);
  });
  it('no longer re-declares a local compareSemver (the buggy value-only one)', () => {
    assert.doesNotMatch(src, /function compareSemver/);
  });
});
