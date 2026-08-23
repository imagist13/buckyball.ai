import { test, expect } from '@playwright/test';
import {
  goToChat,
  goToPlugins,
  goToMCP,
  goToSettings,
  collectConsoleErrors,
  filterCriticalErrors,
  waitForPageReady,
} from '../helpers';

test.describe('Smoke @smoke', () => {
  test('Home redirects to /chat @smoke', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    const response = await page.goto('/');
    await waitForPageReady(page);

    expect(response?.status()).toBeLessThan(400);
    expect(page.url()).toContain('/chat');

    const title = await page.title();
    expect(title).not.toContain('404');
    expect(title).not.toContain('500');

    const hasErrorOverlay = await page.locator('#__next-build-error, [data-nextjs-dialog]').count();
    expect(hasErrorOverlay).toBe(0);

    const critical = filterCriticalErrors(errors);
    expect(critical).toHaveLength(0);
  });

  test('Chat page loads @smoke', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await goToChat(page);

    const title = await page.title();
    expect(title).not.toContain('404');
    expect(title).not.toContain('500');

    const hasErrorOverlay = await page.locator('#__next-build-error, [data-nextjs-dialog]').count();
    expect(hasErrorOverlay).toBe(0);

    const critical = filterCriticalErrors(errors);
    expect(critical).toHaveLength(0);
  });

  test('Plugins page loads @smoke', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await goToPlugins(page);

    const title = await page.title();
    expect(title).not.toContain('404');
    expect(title).not.toContain('500');

    const hasErrorOverlay = await page.locator('#__next-build-error, [data-nextjs-dialog]').count();
    expect(hasErrorOverlay).toBe(0);

    const critical = filterCriticalErrors(errors);
    expect(critical).toHaveLength(0);
  });

  test('MCP page loads @smoke', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await goToMCP(page);

    const title = await page.title();
    expect(title).not.toContain('404');
    expect(title).not.toContain('500');

    const hasErrorOverlay = await page.locator('#__next-build-error, [data-nextjs-dialog]').count();
    expect(hasErrorOverlay).toBe(0);

    const critical = filterCriticalErrors(errors);
    expect(critical).toHaveLength(0);
  });

  test('Settings page loads @smoke', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await goToSettings(page);

    const title = await page.title();
    expect(title).not.toContain('404');
    expect(title).not.toContain('500');

    const hasErrorOverlay = await page.locator('#__next-build-error, [data-nextjs-dialog]').count();
    expect(hasErrorOverlay).toBe(0);

    const critical = filterCriticalErrors(errors);
    expect(critical).toHaveLength(0);
  });

  test('Settings Codex deep link redirects to Runtime page @smoke', async ({ page }) => {
    // Phase 5 Phase 6 IA correction (2026-05-14). /settings/codex was a
    // standalone tab in the first cut of Phase 6; the IA correction
    // moved its content into Runtime + Providers + Models and turned
    // the URL into a redirect so deep links / bookmarks survive. The
    // smoke verifies that a navigation to /settings/codex lands on
    // /settings/runtime and the Codex Runtime engine card is visible.
    const errors = collectConsoleErrors(page);
    await page.goto('/settings/codex');
    await waitForPageReady(page);

    expect(page.url()).toContain('/settings/runtime');

    const title = await page.title();
    expect(title).not.toContain('404');
    expect(title).not.toContain('500');

    const hasErrorOverlay = await page.locator('#__next-build-error, [data-nextjs-dialog]').count();
    expect(hasErrorOverlay).toBe(0);

    // Runtime page renders three engine cards (Claude Code / CodePilot /
    // Codex). Phase 6 later shortened the visible labels, so the Codex
    // card heading is the structural signal that the IA-correction
    // redirect target is alive.
    const headings = await page.locator('h3').allTextContents();
    const headingBlob = headings.join(' ');
    expect(headingBlob).toMatch(/\bCodex\b/);

    const critical = filterCriticalErrors(errors);
    expect(critical).toHaveLength(0);
  });
});
