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
    runtime_pin: 'codepilot_runtime',
    permission_profile: 'default',
    runtime_status: 'idle',
    context_summary: null,
  };
  const messages = [{
    id: 'workspace-inspector-paths-message',
    session_id: fixtureId,
    role: 'assistant',
    content: JSON.stringify([
      {
        type: 'text',
        text: 'Artifact fixture:\n\n```html\n<h1>Inspector artifact</h1>\n```',
      },
      {
        type: 'tool_use',
        id: 'workspace-inspector-write',
        name: 'Write',
        input: {
          file_path: `${workingDirectory}/artifact.html`,
          content: '<h1>Inspector diff</h1>',
        },
      },
      {
        type: 'tool_result',
        tool_use_id: 'workspace-inspector-write',
        content: 'File written.',
        is_error: false,
      },
    ]),
    created_at: now,
    token_usage: null,
    stream_status: 'completed',
  }];

  await page.addInitScript(() => {
    localStorage.removeItem('codepilot:collapsed-projects');
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.startsWith('codepilot:workspace-surfaces')) localStorage.removeItem(key);
      if (key?.startsWith('codepilot:workspace-sidebar')) localStorage.removeItem(key);
    }
    sessionStorage.clear();
  });

  await page.route('**/api/workspace/identity?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        identity: {
          id: 'e2e-workspace-context-menu-actions',
          scope: 'directory',
          version: 1,
        },
      }),
    });
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
      body: JSON.stringify({ messages, hasMore: false }),
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
    const requestedPath = new URL(route.request().url()).searchParams.get('path');
    const isArtifact = requestedPath?.endsWith('/artifact.html') === true;
    const content = isArtifact ? '<h1>Inspector diff</h1>' : markdownContent;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        preview: {
          path: isArtifact ? `${workingDirectory}/artifact.html` : `${workingDirectory}/review-note.md`,
          content,
          language: isArtifact ? 'html' : 'markdown',
          line_count: 3,
          line_count_exact: true,
          truncated: false,
          bytes_read: content.length,
          bytes_total: content.length,
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

async function openFixtureFiles(page: Page) {
  const shell = page.locator('[data-workspace-sidebar]');
  if (!(await shell.isVisible())) {
    await page.getByRole('button', { name: /^(Workspace sidebar|工作区侧栏)$/i }).click();
  }
  await expect(shell).toBeVisible();
  const filesTab = shell.getByRole('tab', { name: /Files|文件/i });
  if (await filesTab.count() === 0) {
    await shell.getByRole('button').filter({ hasText: /Files|文件/ }).first().click();
  }
  await expect(filesTab).toBeVisible();
}

test.describe('Workspace context-menu action handoff @smoke', () => {
  test('Files, Artifact, and Diff open in Inspector without replacing the Files Primary', async ({
    page,
  }) => {
    await installWorkspaceFixture(page);
    await goToConversation(page, fixtureId);
    await openFixtureFiles(page);

    const shell = page.locator('[data-workspace-sidebar]');
    const panel = shell.locator('[data-workspace-sidebar-tabpanel]');
    const fileRow = page.getByRole('treeitem').filter({ hasText: 'review-note.md' }).first();

    await fileRow.click();
    await expect(panel).toHaveAttribute('data-primary-kind', 'files');
    await expect(panel).toHaveAttribute('data-inspector-open', 'true');
    await expect(shell.getByRole('tab', { name: 'review-note.md' })).toHaveAttribute('aria-selected', 'true');

    await panel.press('Escape');
    await expect(panel).not.toHaveAttribute('data-inspector-open', 'true');
    await page.locator('[data-codepilot-codefence-preview="html"]').click();
    await expect(panel).toHaveAttribute('data-primary-kind', 'files');
    await expect(panel).toHaveAttribute('data-inspector-open', 'true');
    await expect(shell.getByRole('tab', { name: 'fence.html' })).toHaveAttribute('aria-selected', 'true');

    await panel.press('Escape');
    await expect(panel).not.toHaveAttribute('data-inspector-open', 'true');
    await page.getByText('artifact.html', { exact: true })
      .locator('..')
      .locator('..')
      .locator('..')
      .getByRole('button', { name: /Preview|预览/i })
      .click();
    await expect(panel).toHaveAttribute('data-primary-kind', 'files');
    await expect(panel).toHaveAttribute('data-inspector-open', 'true');
    await expect(shell.getByRole('tab', { name: 'artifact.html' })).toHaveAttribute('aria-selected', 'true');
  });

  test('file-tree rename survives menu focus restoration and owns input right-click', async ({
    page,
  }) => {
    await installWorkspaceFixture(page);
    await goToConversation(page, fixtureId);
    await openFixtureFiles(page);
    const row = page
      .getByRole('treeitem')
      .filter({ hasText: 'review-note.md' })
      .first();
    await expect(row).toBeVisible();

    await row.click({ button: 'right' });
    await page
      .getByRole('menuitem', { name: /Rename|重命名/ })
      .click();

    const renameInput = page
      .getByRole('treeitem')
      .getByRole('textbox', { name: /Rename|重命名/ })
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
      .getByRole('menuitem', { name: /^(Rename conversation|重命名对话)$/ })
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
    await openFixtureFiles(page);

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
