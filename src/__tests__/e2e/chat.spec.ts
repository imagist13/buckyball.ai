import { test, expect } from '@playwright/test';
import {
  goToChat,
  sendMessage,
  waitForStreamingStart,
  waitForStreamingEnd,
  chatInput,
  sendButton,
  stopButton,
  newChatButton,
  sidebar,
  sessionLinks,
  assistantMessage,
  collectConsoleErrors,
  filterCriticalErrors,
  expectPageLoadTime,
  waitForPageReady,
} from '../helpers';

test.describe('Chat Page', () => {
  test.describe('Page Rendering', () => {
    test('home page redirects to /chat', async ({ page }) => {
      await page.goto('/');
      await page.waitForURL('**/chat');
      expect(page.url()).toContain('/chat');
    });

    test('chat page loads within 3 seconds', async ({ page }) => {
      await expectPageLoadTime(page, '/chat');
    });

    test('chat page has no console errors', async ({ page }) => {
      const errors = collectConsoleErrors(page);
      await goToChat(page);
      const critical = filterCriticalErrors(errors);
      expect(critical).toHaveLength(0);
    });

    test('chat page shows empty state when no messages', async ({ page }) => {
      await goToChat(page);
      // MessageList renders the empty state with a heading + description from
      // i18n (messageList.claudeChat / messageList.emptyDescription). The
      // heading level has shifted between h2 / h3 in recent layout work; use
      // role=heading so the level stops being load-bearing.
      await expect(
        page.getByRole('heading', { name: /(CodePilot|对话)/i }).first(),
      ).toBeVisible();
      await expect(
        page.locator('p').filter({ hasText: /(Start a conversation|开始与)/i }).first(),
      ).toBeVisible();
    });
  });

  test.describe('Chat UI Elements', () => {
    test('New Chat button is visible in sidebar', async ({ page }) => {
      await goToChat(page);
      await expect(newChatButton(page)).toBeVisible();
    });

    test('chat textarea is visible with correct placeholder', async ({ page }) => {
      await goToChat(page);
      const input = chatInput(page);
      await expect(input).toBeVisible();
      // Placeholder rotates with composer state; in the default idle state
      // (no badge, no CLI tool, no streaming) the PromptInputTextarea shows
      // "Message Claude…". Match leniently so slight copy tweaks don't nag.
      const placeholder = await input.getAttribute('placeholder');
      expect(placeholder).toMatch(/message\s*claude/i);
    });

    test('send button is visible', async ({ page }) => {
      await goToChat(page);
      await expect(sendButton(page)).toBeVisible();
    });

    test.skip('helper text is displayed below input', async ({ page }) => {
      // The "Enter to send, Shift+Enter for new line" helper line was
      // removed from the composer during the PromptInput refactor. Kept as
      // skip so the history of this assertion is visible; delete once the
      // composer design stabilises.
      await goToChat(page);
      expect(page).toBeDefined();
    });
  });

  test.describe('Send Message', () => {
    test('can type in chat input', async ({ page }) => {
      await goToChat(page);
      const input = chatInput(page);
      await input.fill('Hello, this is a test');
      await expect(input).toHaveValue('Hello, this is a test');
    });

    test.skip('send a message and see it in the conversation', async ({ page }) => {
      // Requires a live provider to accept the first message; under the
      // default test env this races with the /chat → /chat/[id] redirect
      // and the assertion fires on the wrong page. Skipped until we mock
      // the send path (matches the mocked flow in mention-ui.spec.ts).
      await goToChat(page);
      await sendMessage(page, 'Test message from Playwright');
      await expect(page.locator('.is-user').first()).toBeVisible();
    });

    test('stop button replaces send button during streaming', async ({ page }) => {
      await goToChat(page);
      await sendMessage(page, 'Hello');

      // Post-PromptInput refactor the textarea is no longer disabled mid-
      // stream — users can queue a follow-up message. Instead, the submit
      // button flips to aria-label="Stop".
      await expect(stopButton(page)).toBeVisible({ timeout: 10_000 });
    });
  });

  test.describe('Streaming Response', () => {
    test('stop button appears during streaming', async ({ page }) => {
      await goToChat(page);
      await sendMessage(page, 'Hi');

      // Stop button (destructive variant with square icon) should appear
      await expect(stopButton(page)).toBeVisible({ timeout: 10_000 });
    });

    test('assistant avatar appears for assistant response', async ({ page }) => {
      await goToChat(page);
      await sendMessage(page, 'Say hello');

      // Wait for the first assistant message wrapper to appear — the
      // ai-elements Message component adds `is-assistant` to the wrapper
      // rather than the old data-role attribute.
      await expect(assistantMessage(page)).toBeVisible({ timeout: 10_000 });
    });

    test('URL updates to session ID after response completes', async ({ page }) => {
      await goToChat(page);
      await sendMessage(page, 'Hi there');

      // Wait for URL to change to /chat/[session-id]
      await page.waitForURL('**/chat/*', { timeout: 120_000 });
      expect(page.url()).toMatch(/\/chat\/.+/);
    });

    test.skip('conversation appears in sidebar after response', async ({ page }) => {
      // Same live-provider dependency as "send a message and see it in the
      // conversation" above — needs a real stream to complete so the
      // session row is persisted and the /chat → /chat/[id] redirect fires.
      // Skipped with the other real-API tests pending a deterministic
      // mocked-stream fixture.
      await goToChat(page);
      await sendMessage(page, 'Sidebar test');
      await page.waitForURL('**/chat/*', { timeout: 120_000 });
      const links = sessionLinks(page);
      await expect(links.first()).toBeVisible();
    });
  });

  test.describe('Abort Generation', () => {
    test('clicking stop button halts streaming', async ({ page }) => {
      await goToChat(page);
      await sendMessage(page, 'Write a very long essay about the universe');

      // Wait for streaming to start
      await expect(stopButton(page)).toBeVisible({ timeout: 10_000 });

      // Click stop
      await stopButton(page).click();

      // Send button should return (streaming ended)
      await expect(sendButton(page)).toBeVisible({ timeout: 10_000 });
    });
  });

  test.describe('Chat History', () => {
    test('sidebar has chat list section', async ({ page }) => {
      await goToChat(page);
      // Label was "Recent Chats" → now just "Chats" / "对话列表" depending
      // on locale. Assert the sidebar contains either variant.
      await expect(
        page.locator('aside').filter({ hasText: /(Chats|对话)/i }).first(),
      ).toBeVisible();
    });

    test('empty state or session list is shown in sidebar', async ({ page }) => {
      await goToChat(page);
      // Either "No conversations yet" or session links should be visible
      const emptyState = page.locator('text=No conversations yet');
      const sessions = sessionLinks(page);
      const hasEmpty = await emptyState.isVisible().catch(() => false);
      const hasLinks = (await sessions.count()) > 0;
      expect(hasEmpty || hasLinks).toBeTruthy();
    });
  });
});
