import { expect, test, type Page } from '@playwright/test';
import { goToConversation } from '../helpers';

const fixtureId = 'workspace-context-menu-actions';
const workingDirectory = '/tmp/codepilot-context-menu-actions';

async function installWorkspaceFixture(page: Page) {
  let markdownContent = '# Review\n\n- [ ] Refresh checkbox\n';
  const now = new Date().toISOString();
  const session = {
    id: fixtureId,
    title: 'Context menu review fixture',
    created_at: now,
    updated_at: now,
    model: 'sonnet',
    system_prompt: '',
    working_directory: workingDirectory,
    sdk_session_id: '',
    project_name: 'Context menu fixture',
    source: 'user',
    status: 'active',
    mode: 'code',
    provider_name: 'Fixture',
    provider_id: 'fixture',
    runtime_pin: 'bbagent',
    permission_profile: 'default',
    runtime_status: 'idle',
    context_summary: null,
  };

  await page.addInitScript(() => {
    localStorage.removeItem('codepilot:collapsed-projects');
    sessionStorage.clear();
  });

  await page.route('**/api/chat/sessions', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessions: [session] }),
      });
      return;
    }
    await route.continue();
  });
  await page.route(`**/api/chat/sessions/${fixtureId}`, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ session }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route(`**/api/chat/sessions/${fixtureId}/messages**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ messages: [], hasMore: false }),
    });
  });
  await page.route('**/api/files?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        tree: [
          {
            name: 'review-note.md',
            path: `${workingDirectory}/review-note.md`,
            type: 'file',
          },
        ],
      }),
    });
  });
  await page.route('**/api/files/preview?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        preview: {
          path: `${workingDirectory}/review-note.md`,
          content: markdownContent,
          language: 'markdown',
          line_count: 3,
          line_count_exact: true,
          truncated: false,
          bytes_read: markdownContent.length,
          bytes_total: markdownContent.length,
        },
      }),
    });
  });
  return {
    setMarkdownContent(next: string) {
      markdownContent = next;
    },
  };
}

test.describe('Workspace context-menu action handoff @smoke', () => {
  test('file-tree rename survives menu focus restoration and owns input right-click', async ({
    page,
  }) => {
    await installWorkspaceFixture(page);
    await goToConversation(page, fixtureId);
    const row = page
      .getByRole('treeitem')
      .filter({ hasText: 'review-note.md' })
      .first();
    await expect(row).toBeVisible();

    await row.click({ button: 'right' });
    await page
      .getByRole('menuitem', { name: /Rename|重命�? })
      .click();

    const renameInput = page
      .getByRole('treeitem')
      .getByRole('textbox', { name: /Rename|重命�? })
      .first();
    await expect(renameInput).toBeVisible();
    await page.waitForTimeout(400);
    await expect(renameInput).toBeFocused();

    await renameInput.click({ button: 'right' });
    await expect(page.locator('[data-slot="context-menu-content"]')).toHaveCount(0);
  });

  test('conversation rename and delete close the context menu before the next UI', async ({
    page,
  }) => {
    await installWorkspaceFixture(page);
    await goToConversation(page, fixtureId);
    const sessionLink = page.locator(`a[href="/chat/${fixtureId}"]`).first();
    await expect(sessionLink).toBeVisible();

    await sessionLink.click({ button: 'right' });
    await page
      .getByRole('menuitem', { name: /^(Rename conversation|重命名对�?$/ })
      .click();

    const dialog = page.getByRole('dialog');
    const renameInput = dialog.getByRole('textbox');
    await expect(renameInput).toBeVisible();
    await page.waitForTimeout(400);
    await expect(renameInput).toBeFocused();
    await expect(page.locator('[data-slot="context-menu-content"]')).toHaveCount(0);
    await dialog.getByRole('button', { name: /^(Cancel|取消)$/ }).click();

    await sessionLink.click({ button: 'right' });
    page.once('dialog', (nativeDialog) => nativeDialog.dismiss());
    await page
      .getByRole('menuitem', { name: /^(Delete conversation|删除对话)$/ })
      .click();
    await expect(page.locator('[data-slot="context-menu-content"]')).toHaveCount(0);
  });

  test('quiet refresh updates the rendered checklist state', async ({ page }) => {
    const fixture = await installWorkspaceFixture(page);
    await goToConversation(page, fixtureId);

    await page
      .getByRole('treeitem')
      .filter({ hasText: 'review-note.md' })
      .first()
      .click();

    const editor = page.locator('[data-markdown-editor]').first();
    const checkbox = editor.locator('.cm-lp-task-checkbox input').first();
    await expect(editor).toBeVisible();
    await expect(checkbox).toBeVisible();
    await expect(checkbox).not.toBeChecked();

    fixture.setMarkdownContent('# Review\n\n- [x] Refresh checkbox\n');
    await page.evaluate((path) => {
      window.dispatchEvent(
        new CustomEvent('codepilot:file-changed', {
          detail: { paths: [path], source: 'external' },
        }),
      );
    }, `${workingDirectory}/review-note.md`);

    await expect(checkbox).toBeChecked();
  });
});
