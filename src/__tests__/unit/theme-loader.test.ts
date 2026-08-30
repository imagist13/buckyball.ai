/**
 * Unit tests for theme family loader — tests the real public functions.
 *
 * Run with: npx tsx --test src/__tests__/unit/theme-loader.test.ts
 *
 * Strategy: stub process.cwd() to a temp dir and call _resetCache() before
 * each test to get fresh loader results.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getAllThemeFamilies, getThemeFamilyMetas, _resetCache } from '../../lib/theme/loader';

/** Helper to create a minimal valid ThemeColors object. */
function makeColors(base: string) {
  return {
    background: base, foreground: base, card: base, cardForeground: base,
    popover: base, popoverForeground: base, primary: base, primaryForeground: base,
    secondary: base, secondaryForeground: base, muted: base, mutedForeground: base,
    accent: base, accentForeground: base, destructive: base, border: base,
    input: base, ring: base, chart1: base, chart2: base, chart3: base,
    chart4: base, chart5: base, sidebar: base, sidebarForeground: base,
    sidebarPrimary: base, sidebarPrimaryForeground: base, sidebarAccent: base,
    sidebarAccentForeground: base, sidebarBorder: base, sidebarRing: base,
  };
}

function makeTheme(id: string, order: number, color = 'oklch(0.5 0 0)') {
  return { id, label: id, order, light: makeColors(color), dark: makeColors(color) };
}

let tmpDir: string;
const origCwd = process.cwd;

describe('theme-loader: getAllThemeFamilies', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-loader-test-'));
    fs.mkdirSync(path.join(tmpDir, 'themes'));
    _resetCache();
    process.cwd = () => tmpDir;
  });

  afterEach(() => {
    process.cwd = origCwd;
    _resetCache();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads valid theme files and sorts by order', () => {
    fs.writeFileSync(path.join(tmpDir, 'themes', 'b.json'), JSON.stringify(makeTheme('beta', 2)));
    fs.writeFileSync(path.join(tmpDir, 'themes', 'a.json'), JSON.stringify(makeTheme('alpha', 1)));
    fs.writeFileSync(path.join(tmpDir, 'themes', 'default.json'), JSON.stringify(makeTheme('default', 0)));

    const families = getAllThemeFamilies();
    assert.equal(families.length, 3);
    assert.equal(families[0].id, 'default');
    assert.equal(families[1].id, 'alpha');
    assert.equal(families[2].id, 'beta');
  });

  it('skips invalid JSON files and still loads valid ones', () => {
    fs.writeFileSync(path.join(tmpDir, 'themes', 'good.json'), JSON.stringify(makeTheme('good', 1)));
    fs.writeFileSync(path.join(tmpDir, 'themes', 'bad.json'), 'not valid json {{{');
    fs.writeFileSync(path.join(tmpDir, 'themes', 'incomplete.json'), JSON.stringify({ id: 'incomplete', label: 'X' }));

    const families = getAllThemeFamilies();
    const ids = families.map(f => f.id);

    assert.ok(ids.includes('good'), 'valid theme loaded');
    assert.ok(ids.includes('default'), 'default synthesized');
    assert.ok(!ids.includes('incomplete'), 'incomplete theme skipped');
  });

  it('synthesizes default when no default.json exists', () => {
    fs.writeFileSync(path.join(tmpDir, 'themes', 'custom.json'), JSON.stringify(makeTheme('custom', 5)));

    const families = getAllThemeFamilies();
    assert.ok(families.some(f => f.id === 'default'), 'default family exists');
    assert.equal(families[0].id, 'default', 'default sorts first');
    assert.equal(families[0].light.primary, 'oklch(0.262 0 0)', 'uses hardcoded fallback');
  });

  it('handles missing themes directory gracefully', () => {
    fs.rmSync(path.join(tmpDir, 'themes'), { recursive: true });

    const families = getAllThemeFamilies();
    assert.equal(families.length, 1);
    assert.equal(families[0].id, 'default');
  });

  it('ignores non-JSON files', () => {
    fs.writeFileSync(path.join(tmpDir, 'themes', 'readme.md'), '# Themes');
    fs.writeFileSync(path.join(tmpDir, 'themes', 'valid.json'), JSON.stringify(makeTheme('valid', 1)));

    const families = getAllThemeFamilies();
    assert.equal(families.length, 2); // valid + synthesized default
  });

  it('rejects themes missing chart/sidebar color keys', () => {
    // Create a theme with only the old required keys (no chart*, no sidebar*)
    const partialColors = {
      background: 'x', foreground: 'x', card: 'x', cardForeground: 'x',
      popover: 'x', popoverForeground: 'x', primary: 'x', primaryForeground: 'x',
      secondary: 'x', secondaryForeground: 'x', muted: 'x', mutedForeground: 'x',
      accent: 'x', accentForeground: 'x', destructive: 'x', border: 'x',
      input: 'x', ring: 'x',
    };
    const partial = { id: 'partial', label: 'Partial', order: 1, light: partialColors, dark: partialColors };
    fs.writeFileSync(path.join(tmpDir, 'themes', 'partial.json'), JSON.stringify(partial));

    const families = getAllThemeFamilies();
    assert.ok(!families.some(f => f.id === 'partial'), 'theme missing chart/sidebar keys is rejected');
  });

  it('strips invalid codeTheme/shikiTheme but keeps the theme', () => {
    const theme = {
      ...makeTheme('fixable', 1),
      codeTheme: { light: 123, dark: 'oneDark' },   // light is wrong type
      shikiTheme: 'not-an-object',                    // completely wrong
    };
    fs.writeFileSync(path.join(tmpDir, 'themes', 'fixable.json'), JSON.stringify(theme));

    const families = getAllThemeFamilies();
    const loaded = families.find(f => f.id === 'fixable');
    assert.ok(loaded, 'theme itself is still loaded');
    assert.equal(loaded!.codeTheme, undefined, 'invalid codeTheme stripped');
    assert.equal(loaded!.shikiTheme, undefined, 'invalid shikiTheme stripped');
  });

  it('caches results across calls', () => {
    fs.writeFileSync(path.join(tmpDir, 'themes', 'default.json'), JSON.stringify(makeTheme('default', 0)));

    const first = getAllThemeFamilies();
    // Add another file after first load
    fs.writeFileSync(path.join(tmpDir, 'themes', 'extra.json'), JSON.stringify(makeTheme('extra', 1)));
    const second = getAllThemeFamilies();

    assert.strictEqual(first, second, 'returns same reference from cache');
    assert.equal(second.length, 1, 'does not pick up new files without cache reset');
  });
});

describe('theme-loader: getThemeFamilyMetas', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-meta-test-'));
    fs.mkdirSync(path.join(tmpDir, 'themes'));
    _resetCache();
    process.cwd = () => tmpDir;
  });

  afterEach(() => {
    process.cwd = origCwd;
    _resetCache();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns lightweight meta with preview colors and codeTheme', () => {
    const theme = {
      ...makeTheme('test', 0, 'oklch(0.5 0.1 200)'),
      description: 'A test theme',
      codeTheme: { light: 'oneLight', dark: 'oneDark' },
      shikiTheme: { light: 'one-light', dark: 'one-dark-pro' },
    };
    fs.writeFileSync(path.join(tmpDir, 'themes', 'test.json'), JSON.stringify(theme));

    const metas = getThemeFamilyMetas();
    const testMeta = metas.find(m => m.id === 'test');

    assert.ok(testMeta, 'meta exists');
    assert.equal(testMeta!.label, 'test');
    assert.equal(testMeta!.description, 'A test theme');
    assert.ok(testMeta!.previewColors, 'has preview colors');
    assert.equal(testMeta!.previewColors!.primaryLight, 'oklch(0.5 0.1 200)');
    assert.ok(testMeta!.codeTheme, 'has codeTheme');
    assert.equal(testMeta!.codeTheme!.dark, 'oneDark');
    assert.ok(testMeta!.shikiTheme, 'has shikiTheme');
    assert.equal(testMeta!.shikiTheme!.dark, 'one-dark-pro');
  });

  it('meta does not include full color data', () => {
    fs.writeFileSync(path.join(tmpDir, 'themes', 'default.json'), JSON.stringify(makeTheme('default', 0)));

    const metas = getThemeFamilyMetas();
    const meta = metas[0] as unknown as Record<string, unknown>;

    assert.ok(!('light' in meta), 'no light colors in meta');
    assert.ok(!('dark' in meta), 'no dark colors in meta');
    assert.ok(!('order' in meta), 'no order in meta');
  });
});
