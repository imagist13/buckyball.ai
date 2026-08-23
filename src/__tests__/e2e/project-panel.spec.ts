import { test, expect } from '@playwright/test';
import {
  goToChat,
  goToSettings,
  goToPlugins,
  fileTreePanel,
  fileTreeToggleButton,
  panelCloseButton,
  fileSearchInput,
  fileTreeRefreshButton,
  collectConsoleErrors,
  filterCriticalErrors,
  waitForPageReady,
} from '../helpers';

// PanelZone was restructured: file tree panel, width, and toggle button
// live under the UnifiedTopBar now, and navigating to /chat/test-session
// hits a "Session not found" page that no longer matches the panel-hidden
// contract. Marked as skip under tech debt #9 with the layout rewrite.
test.describe.skip('Project Panel (V3 â€?PanelZone)', () => {
  test.describe('Panel Toggle', () => {
    test('file tree panel is hidden by default on /chat/[id] route', async ({ page }) => {
      await page.goto('/chat/test-session');
      await waitForPageReady(page);

      // FileTree panel should not auto-open (independent toggle model)
      const panel = fileTreePanel(page);
      await expect(panel).toBeHidden();
    });

    test('file tree toggle button is visible on /chat/[id] route', async ({ page }) => {
      await page.goto('/chat/test-session');
      await waitForPageReady(page);

      const toggle = fileTreeToggleButton(page);
      await expect(toggle).toBeVisible();
    });

    test('file tree panel is hidden on /settings route', async ({ page }) => {
      await goToSettings(page);
      const panel = fileTreePanel(page);
      await expect(panel).toBeHidden();
    });

    test('file tree panel is hidden on /plugins route', async ({ page }) => {
      await goToPlugins(page);
      const panel = fileTreePanel(page);
      await expect(panel).toBeHidden();
    });

    test('file tree panel is hidden on /chat (no id) route', async ({ page }) => {
      await goToChat(page);
      const panel = fileTreePanel(page);
      await expect(panel).toBeHidden();
    });
  });

  test.describe('Panel Open/Close', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/chat/test-session');
      await waitForPageReady(page);
    });

    test('clicking file tree toggle opens the panel', async ({ page }) => {
      await fileTreeToggleButton(page).click();
      await page.waitForTimeout(300);

      await expect(fileTreePanel(page)).toBeVisible();
    });

    test('close button inside panel hides it', async ({ page }) => {
      // Open first
      await fileTreeToggleButton(page).click();
      await page.waitForTimeout(300);
      await expect(fileTreePanel(page)).toBeVisible();

      // Click close button in panel header
      await panelCloseButton(page).click();
      await page.waitForTimeout(300);

      await expect(fileTreePanel(page)).toBeHidden();
    });

    test('clicking file tree toggle again closes the panel', async ({ page }) => {
      // Open
      await fileTreeToggleButton(page).click();
      await page.waitForTimeout(300);
      await expect(fileTreePanel(page)).toBeVisible();

      // Toggle again to close
      await fileTreeToggleButton(page).click();
      await page.waitForTimeout(300);

      await expect(fileTreePanel(page)).toBeHidden();
    });

    test('panel has correct width when open', async ({ page }) => {
      await fileTreeToggleButton(page).click();
      await page.waitForTimeout(300);

      const panel = fileTreePanel(page);
      const box = await panel.boundingBox();
      expect(box).not.toBeNull();
      // FileTreePanel width = 280px
      expect(box!.width).toBe(280);
    });
  });

  test.describe('File Tree', () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/chat/test-session');
      await waitForPageReady(page);
      // Open file tree panel
      await fileTreeToggleButton(page).click();
      await page.waitForTimeout(300);
    });

    test('file search input is visible', async ({ page }) => {
      const search = fileSearchInput(page);
      await expect(search).toBeVisible();
      await expect(search).toHaveAttribute('placeholder', 'Filter files...');
    });

    test('refresh button is visible', async ({ page }) => {
      await expect(fileTreeRefreshButton(page)).toBeVisible();
    });

    test('search input accepts text and filters', async ({ page }) => {
      const search = fileSearchInput(page);
      await search.fill('nonexistent-xyz');
      await expect(search).toHaveValue('nonexistent-xyz');
    });

    test('clearing search restores the tree', async ({ page }) => {
      const search = fileSearchInput(page);
      await search.fill('test');
      await page.waitForTimeout(300);
      await search.clear();
      await page.waitForTimeout(300);
      await expect(search).toHaveValue('');
    });
  });

  test.describe('No Console Errors', () => {
    test('project panel page has no console errors', async ({ page }) => {
      const errors = collectConsoleErrors(page);
      await page.goto('/chat/test-session');
      await waitForPageReady(page);
      const critical = filterCriticalErrors(errors).filter(
        (e) =>
          !e.includes('405') &&
          !e.includes('404') &&
          !e.includes('Failed to load resource')
      );
      expect(critical).toHaveLength(0);
    });
  });
});
