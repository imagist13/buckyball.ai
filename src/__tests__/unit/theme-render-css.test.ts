/**
 * Unit tests for theme family CSS renderer.
 *
 * Run with: npx tsx --test src/__tests__/unit/theme-render-css.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { colorKeyToCssVar, renderThemeFamilyCSS } from '../../lib/theme/render-css';
import type { ThemeFamily } from '../../lib/theme/types';

describe('colorKeyToCssVar', () => {
  it('should convert simple keys', () => {
    assert.equal(colorKeyToCssVar('background'), '--background');
    assert.equal(colorKeyToCssVar('foreground'), '--foreground');
    assert.equal(colorKeyToCssVar('primary'), '--primary');
  });

  it('should convert camelCase to kebab-case', () => {
    assert.equal(colorKeyToCssVar('cardForeground'), '--card-foreground');
    assert.equal(colorKeyToCssVar('primaryForeground'), '--primary-foreground');
    assert.equal(colorKeyToCssVar('mutedForeground'), '--muted-foreground');
    assert.equal(colorKeyToCssVar('sidebarPrimaryForeground'), '--sidebar-primary-foreground');
  });

  it('should handle numbered keys', () => {
    assert.equal(colorKeyToCssVar('chart1'), '--chart-1');
    assert.equal(colorKeyToCssVar('chart5'), '--chart-5');
  });
});

describe('renderThemeFamilyCSS', () => {
  const makeColors = (val: string) => ({
    background: val,
    foreground: val,
    card: val,
    cardForeground: val,
    popover: val,
    popoverForeground: val,
    primary: val,
    primaryForeground: val,
    secondary: val,
    secondaryForeground: val,
    muted: val,
    mutedForeground: val,
    accent: val,
    accentForeground: val,
    destructive: val,
    border: val,
    input: val,
    ring: val,
    chart1: val,
    chart2: val,
    chart3: val,
    chart4: val,
    chart5: val,
    sidebar: val,
    sidebarForeground: val,
    sidebarPrimary: val,
    sidebarPrimaryForeground: val,
    sidebarAccent: val,
    sidebarAccentForeground: val,
    sidebarBorder: val,
    sidebarRing: val,
  });

  const testFamily: ThemeFamily = {
    id: 'test',
    label: 'Test',
    order: 0,
    light: makeColors('oklch(1 0 0)'),
    dark: makeColors('oklch(0.1 0 0)'),
  };

  it('should generate light and dark blocks', () => {
    const css = renderThemeFamilyCSS([testFamily]);
    assert.ok(css.includes('html[data-theme-family="test"]'));
    assert.ok(css.includes('html.dark[data-theme-family="test"]'));
  });

  it('should include correct CSS variable assignments', () => {
    const css = renderThemeFamilyCSS([testFamily]);
    assert.ok(css.includes('--background: oklch(1 0 0);'));
    assert.ok(css.includes('--background: oklch(0.1 0 0);'));
    assert.ok(css.includes('--card-foreground:'));
    assert.ok(css.includes('--sidebar-primary-foreground:'));
  });

  it('should handle multiple families', () => {
    const family2: ThemeFamily = {
      id: 'second',
      label: 'Second',
      order: 1,
      light: makeColors('oklch(0.5 0 0)'),
      dark: makeColors('oklch(0.2 0 0)'),
    };
    const css = renderThemeFamilyCSS([testFamily, family2]);
    assert.ok(css.includes('html[data-theme-family="test"]'));
    assert.ok(css.includes('html[data-theme-family="second"]'));
    assert.ok(css.includes('html.dark[data-theme-family="second"]'));
  });

  it('should return empty string for empty input', () => {
    const css = renderThemeFamilyCSS([]);
    assert.equal(css, '');
  });
});
