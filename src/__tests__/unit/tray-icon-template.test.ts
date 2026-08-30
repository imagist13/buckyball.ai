/**
 * P1 (2026-06-01) — macOS packaged menubar Tray icon.
 *
 * Root cause: packaged macOS reused the full-color app icon (icon.icns,
 * resized to 16x16) for the menubar Tray. `.icns` resized to menubar size
 * rendered as a blurry / unbranded blob and ignored the light/dark menubar
 * template-icon convention — on the user's other Mac the top-bar icon looked
 * missing / wrong. Fix: a dedicated monochrome template PNG + setTemplateImage.
 *
 * Source/asset pins (visual acceptance is deferred to the next packaged build
 * on another Mac per docs/preview/packaged-preview-p0-diagnosis-2026-06-01.md):
 *   - darwin Tray path must NOT resolve to icon.icns.
 *   - the darwin tray image must be marked setTemplateImage(true).
 *   - electron-builder must ship the tray template asset into Resources.
 *   - Dock/app icon (mac.icon) stays on icon.icns — only the tray changed.
 *   - Windows/Linux tray behavior is untouched.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const mainSrc = readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
const builderYml = readFileSync(path.join(root, 'electron-builder.yml'), 'utf8');
const ensureTrayBlock = mainSrc.match(/function ensureTray\(\)[\s\S]*?\n\}/)?.[0] ?? '';

describe('macOS Tray uses a dedicated template image, not the .icns app icon', () => {
  it('getTrayIconPath points at trayTemplate.png — NOT icon.icns', () => {
    const block = mainSrc.match(/function getTrayIconPath\(\)[\s\S]*?\n\}/)?.[0] ?? '';
    assert.ok(block, 'getTrayIconPath() must exist');
    assert.match(block, /trayTemplate\.png/);
    assert.doesNotMatch(block, /icon\.icns/, 'the tray path must not resolve to the .icns app icon');
  });

  it('ensureTray branches on darwin, uses the template path, and marks it setTemplateImage(true)', () => {
    assert.ok(ensureTrayBlock, 'ensureTray() must exist');
    assert.match(ensureTrayBlock, /process\.platform === 'darwin'/, 'tray creation must branch on darwin');
    assert.match(ensureTrayBlock, /getTrayIconPath\(\)/, 'darwin tray must use the template path');
    assert.match(ensureTrayBlock, /setTemplateImage\(true\)/, 'darwin tray image must be a macOS template image');
  });

  it('darwin primary tray image is the template, with .icns only as a missing-asset fallback', () => {
    const tmplIdx = ensureTrayBlock.indexOf('getTrayIconPath()');
    const iconIdx = ensureTrayBlock.indexOf('getIconPath()');
    assert.ok(
      tmplIdx !== -1 && (iconIdx === -1 || tmplIdx < iconIdx),
      'getTrayIconPath() (template) must be the darwin primary; getIconPath() (.icns) only the fallback',
    );
  });

  it('exactly one setTemplateImage call — Windows/Linux tray behavior unchanged', () => {
    const calls = ensureTrayBlock.match(/setTemplateImage/g) ?? [];
    assert.equal(calls.length, 1, 'setTemplateImage must be darwin-only (no template marking off darwin)');
  });

  it('electron-builder ships the tray template asset(s) into Resources', () => {
    assert.match(builderYml, /trayTemplate\*?\.png/, 'extraResources filter must include the tray template png(s)');
  });

  it('Dock/app icon stays on icon.icns (mac.icon unchanged)', () => {
    assert.match(builderYml, /icon:\s*build\/icon\.icns/, 'mac.icon must remain build/icon.icns — only the tray changed');
  });

  it('the tray template assets exist in build/ so the dev + packaged paths resolve', () => {
    assert.ok(existsSync(path.join(root, 'build/trayTemplate.png')), 'build/trayTemplate.png missing');
    assert.ok(existsSync(path.join(root, 'build/trayTemplate@2x.png')), 'build/trayTemplate@2x.png missing (retina)');
  });
});
