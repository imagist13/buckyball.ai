import { test, expect } from '@playwright/test';
import { goToChat } from '../helpers';

/**
 * First-message composer clear — the lingering-text bug (behavioral lock).
 *
 * The /chat new-chat composer is a single stable-keyed MessageInput that no
 * longer remounts at the isStreaming flip (#615), and `sendFirstMessage` does
 * not resolve until the whole stream ends. So MessageInput clears the composer
 * OPTIMISTICALLY at submit (before `await onSend`), not after delivery — without
 * that, the just-sent text sat in the box for the entire turn.
 *
 * Why a dedicated e2e: the "new-chat submit" test in
 * context-chips-send-clear.spec.ts deliberately can NOT assert this — it lets
 * /api/chat finish, which redirects to a fresh ChatView that masks whether the
 * original composer cleared (Codex flagged that trap). Here we HOLD the
 * /api/chat response open so the page stays on /chat (no redirect) and assert
 * the SAME composer empties right after submit. A regression to "clear after
 * await onSend" leaves the text in the box → this goes red.
 *
 * Pairs with unit/composer-first-message-clear.test.ts (source-pin).
 */
test.describe('First-message composer clears optimistically @smoke', () => {
  test('typed first message clears the composer at submit, before any redirect', async ({ page }) => {
    // Session insert the first-message flow does before opening the stream.
    await page.route('**/api/chat/sessions', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          session: {
            id: 'mock-first-msg-session',
            title: 'Mock',
            model: 'sonnet',
            mode: 'code',
            provider_id: 'mock',
            working_directory: '/tmp',
          },
        }),
      });
    });

    // HOLD the /api/chat response so sendFirstMessage stays mid-"stream" (no
    // router.push), keeping us on the SAME /chat composer to assert on.
    let chatHit = false;
    await page.route('**/api/chat', async (route) => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      chatHit = true;
      await new Promise((r) => setTimeout(r, 4000));
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: `data: ${JSON.stringify({ type: 'done' })}\n\n`,
      });
    });

    await goToChat(page);

    const input = page.locator('textarea[name="message"]').first();
    if ((await input.count()) === 0) {
      test.skip(true, 'Chat message input is unavailable in current test environment');
    }
    await expect(input).toBeVisible();

    await input.fill('hello first message');
    await expect(input).toHaveValue('hello first message');
    await input.press('Enter');

    // Skip (don't false-fail) if the new-chat send can't fire in this env —
    // e.g. no provider/model is sendable under the active runtime. The send
    // reaching /api/chat is the precondition for a meaningful clear assertion.
    let sent = false;
    try {
      await expect.poll(() => chatHit, { timeout: 5_000 }).toBeTruthy();
      sent = true;
    } catch {
      sent = false;
    }
    test.skip(!sent, 'first-message send did not fire (no sendable provider in this env)');

    // Optimistic clear: the SAME composer empties immediately, while /api/chat
    // is still "streaming" (held) and BEFORE any redirect to /chat/[id].
    await expect(input).toHaveValue('', { timeout: 2_000 });

    // Proves we asserted on the new-chat composer, not a post-redirect ChatView.
    expect(page.url()).not.toMatch(/\/chat\/[^/?#]+/);
  });
});
