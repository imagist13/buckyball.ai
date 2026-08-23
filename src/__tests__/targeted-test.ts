/**
 * Targeted tests for investigating specific failures from the functional test.
 * Run with: npx tsx src/__tests__/targeted-test.ts
 */
import { chromium, type Page } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });

  // =====================================================
  // Test 1: Mobile - Does sidebar auto-close after navigation?
  // And does the header toggle button work as a hamburger?
  // =====================================================
  console.log('=== Test 1: Mobile sidebar behavior ===');
  {
    const context = await browser.newContext({ viewport: { width: 375, height: 667 } });
    const page = await context.newPage();

    // On mobile, sidebar starts OPEN (state defaults to true in AppShell)
    await page.goto('http://localhost:3000/chat', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);

    // Find the X button in sidebar header (visible on mobile)
    const closeBtn = page.locator('aside button:has(svg)').first();
    console.log('Close button in sidebar found:', await closeBtn.isVisible());

    // Close sidebar via X
    await closeBtn.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: '/Users/op7418/Documents/code/opus-4.6-test/src/__tests__/screenshots/mobile-sidebar-closed.png' });

    // Now check if there's a way to reopen the sidebar (the toggle button in header)
    const headerToggle = page.locator('header button').first();
    console.log('Header toggle button found:', await headerToggle.isVisible());
    console.log('Header toggle button text:', await headerToggle.innerText().catch(() => 'none'));

    // Click header toggle to reopen sidebar
    await headerToggle.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: '/Users/op7418/Documents/code/opus-4.6-test/src/__tests__/screenshots/mobile-sidebar-reopened.png' });

    // Check sidebar is visible again
    const sidebarVisible = await page.locator('aside').isVisible();
    console.log('Sidebar reopened via header toggle:', sidebarVisible);

    await context.close();
  }

  // =====================================================
  // Test 2: Chat URL update and sidebar refresh
  // The chat page creates session and navigates AFTER streaming completes.
  // We test: does the sidebar show the new session?
  // =====================================================
  console.log('\n=== Test 2: Chat URL and sidebar update ===');
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    await page.goto('http://localhost:3000/chat', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);

    // Send message
    const textarea = page.locator('textarea').first();
    await textarea.fill('Hi');
    await textarea.press('Enter');

    // Wait for streaming to start
    await page.waitForTimeout(2000);
    console.log('URL after 2s:', page.url());

    // Wait up to 30s for the response to finish and URL to change
    try {
      await page.waitForURL('**/chat/*', { timeout: 30000 });
      console.log('URL updated to:', page.url());
    } catch {
      console.log('URL did not change within 30s. Current URL:', page.url());
    }

    // Check sidebar
    const chatLinks = await page.locator('aside a[href*="/chat/"]').count();
    console.log('Chat links in sidebar:', chatLinks);

    await page.screenshot({ path: '/Users/op7418/Documents/code/opus-4.6-test/src/__tests__/screenshots/chat-after-complete.png' });

    await context.close();
  }

  // =====================================================
  // Test 3: Plugins filter tabs - check the actual rendered text
  // =====================================================
  console.log('\n=== Test 3: Plugins filter tabs ===');
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    await page.goto('http://localhost:3000/plugins', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);

    // The tabs render as "All (0)", "Global (0)", "Project (0)" -- not exact match with "All"
    const allBtn = page.locator('button:has-text("All")');
    const globalBtn = page.locator('button:has-text("Global")');
    const projectBtn = page.locator('button:has-text("Project")');

    console.log('All button count:', await allBtn.count());
    console.log('Global button count:', await globalBtn.count());
    console.log('Project button count:', await projectBtn.count());

    if (await allBtn.count() > 0) {
      console.log('All button text:', await allBtn.first().innerText());
    }
    if (await globalBtn.count() > 0) {
      console.log('Global button text:', await globalBtn.first().innerText());
    }
    if (await projectBtn.count() > 0) {
      console.log('Project button text:', await projectBtn.first().innerText());
    }

    await context.close();
  }

  // =====================================================
  // Test 4: MCP back button -- it exists in the screenshot as an arrow
  // =====================================================
  console.log('\n=== Test 4: MCP back navigation ===');
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    await page.goto('http://localhost:3000/plugins/mcp', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);

    // The back button is visible in the screenshot as a left arrow
    const backButtons = await page.locator('button:has(svg), a:has(svg)').all();
    console.log('Total buttons/links with SVG:', backButtons.length);

    for (let i = 0; i < Math.min(backButtons.length, 10); i++) {
      const el = backButtons[i];
      const text = await el.innerText().catch(() => '');
      const ariaLabel = await el.getAttribute('aria-label') || '';
      const tag = await el.evaluate(el => el.tagName);
      const href = await el.getAttribute('href') || '';
      console.log(`  [${i}] ${tag} text="${text}" aria-label="${ariaLabel}" href="${href}"`);
    }

    // Look for the specific back button (arrow left icon that links to /plugins)
    const backLink = page.locator('a[href="/plugins"], button').filter({ has: page.locator('svg') });
    const backLinkCount = await backLink.count();
    console.log('Back link (to /plugins) count:', backLinkCount);

    await context.close();
  }

  // =====================================================
  // Test 5: Sidebar collapse on desktop
  // =====================================================
  console.log('\n=== Test 5: Sidebar collapse on desktop ===');
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    await page.goto('http://localhost:3000/chat', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);

    // The header has a PanelLeftClose/PanelLeft toggle
    const headerToggle = page.locator('header button').first();
    const srText = await page.locator('header button .sr-only').first().innerText().catch(() => '');
    console.log('Header toggle sr-only text:', srText);

    // Get sidebar width before
    const sidebarBefore = await page.locator('aside').boundingBox();
    console.log('Sidebar before toggle:', sidebarBefore ? `x=${sidebarBefore.x} w=${sidebarBefore.width}` : 'not found');

    // Click to collapse
    await headerToggle.click();
    await page.waitForTimeout(500);

    const sidebarAfter = await page.locator('aside').boundingBox();
    console.log('Sidebar after toggle:', sidebarAfter ? `x=${sidebarAfter.x} w=${sidebarAfter.width}` : 'hidden/not found');

    await page.screenshot({ path: '/Users/op7418/Documents/code/opus-4.6-test/src/__tests__/screenshots/desktop-sidebar-collapsed.png' });

    // Click to expand
    await headerToggle.click();
    await page.waitForTimeout(500);

    const sidebarReopen = await page.locator('aside').boundingBox();
    console.log('Sidebar after re-expand:', sidebarReopen ? `x=${sidebarReopen.x} w=${sidebarReopen.width}` : 'hidden/not found');

    await context.close();
  }

  await browser.close();
  console.log('\nDone.');
}

main().catch(console.error);
