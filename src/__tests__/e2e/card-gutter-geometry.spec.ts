import { test, expect, type Page } from '@playwright/test';
import {
  goToChat,
  goToConversation,
  collectConsoleErrors,
  filterCriticalErrors,
} from '../helpers';

/**
 * Phase 7c closeout guardrail (Codex review finding #3).
 *
 * Source-pin unit tests in `card-primitives.test.ts` prove the
 * ResizeGutter's class/structure contract but NOT that its 2px line
 * lands on the geometric mid-line of the gap between two cards — jsdom
 * does no layout. This e2e measures real bounding boxes in a Chromium
 * render and asserts, for every gutter on screen: 8px width, a centered
 * 2px line, that it is a row-level sibling (never inside a CardFrame),
 * and that its center equals the mid-line between the two card frames
 * it separates.
 *
 * Two cases:
 *   - default `/chat`: only the sidebar↔main gutter is present.
 *   - multi-panel `/chat/[id]` with the unified workspace sidebar open:
 *     the row holds sidebar | main | workspace. Files now renders inside
 *     workspace Primary instead of creating another card.
 *
 * Platform note: a browser stamps data-shell="web", so the darwin
 * clip-path / radius profile does NOT activate here. Gutter geometry is
 * platform-agnostic (always an 8px flex container with a centered 2px
 * line), so it is fully measurable. The Electron-only darwin visual
 * profile is verified separately by the Electron diag in the plan.
 */

async function assertAllGutterGeometry(page: Page): Promise<number> {
  const gutters = page.locator('[data-resize-gutter]');
  const count = await gutters.count();
  expect(count, 'at least one gutter present').toBeGreaterThanOrEqual(1);

  for (let i = 0; i < count; i++) {
    const gutter = gutters.nth(i);

    const gutterBox = await gutter.boundingBox();
    expect(gutterBox, `gutter ${i} has a bounding box`).not.toBeNull();
    expect(
      Math.abs(gutterBox!.width - 8),
      `gutter ${i} width ~= 8 (got ${gutterBox!.width})`,
    ).toBeLessThanOrEqual(1);

    // The gutter's single child div is the visible line (opacity:0 until
    // hover, but always laid out, so it has a box).
    const line = gutter.locator('div').first();
    const lineBox = await line.boundingBox();
    expect(lineBox, `gutter ${i} line has a bounding box`).not.toBeNull();
    expect(
      Math.abs(lineBox!.width - 2),
      `gutter ${i} line width ~= 2 (got ${lineBox!.width})`,
    ).toBeLessThanOrEqual(1);

    const gutterCenter = gutterBox!.x + gutterBox!.width / 2;
    const lineCenter = lineBox!.x + lineBox!.width / 2;
    expect(
      Math.abs(lineCenter - gutterCenter),
      `gutter ${i} line centered in gutter`,
    ).toBeLessThanOrEqual(1);

    // Row-level contract + lands on the gap mid-line between the two
    // card frames it separates.
    const rel = await gutter.evaluate((el) => {
      const prev = el.previousElementSibling as HTMLElement | null;
      const next = el.nextElementSibling as HTMLElement | null;
      const gr = el.getBoundingClientRect();
      return {
        insideFrame: !!el.closest('[data-platform-card-frame]'),
        prevIsFrame: !!prev?.hasAttribute('data-platform-card-frame'),
        nextIsFrame: !!next?.hasAttribute('data-platform-card-frame'),
        prevRight: prev ? prev.getBoundingClientRect().right : null,
        nextLeft: next ? next.getBoundingClientRect().left : null,
        gutterCenter: gr.left + gr.width / 2,
      };
    });
    expect(rel.insideFrame, `gutter ${i} must NOT be inside a CardFrame`).toBe(false);
    expect(rel.prevIsFrame, `gutter ${i} follows a CardFrame`).toBe(true);
    expect(rel.nextIsFrame, `gutter ${i} precedes a CardFrame`).toBe(true);
    if (rel.prevRight !== null && rel.nextLeft !== null) {
      const gapMid = (rel.prevRight + rel.nextLeft) / 2;
      expect(
        Math.abs(rel.gutterCenter - gapMid),
        `gutter ${i} center ~= gap mid-line (center ${rel.gutterCenter} vs mid ${gapMid})`,
      ).toBeLessThanOrEqual(1);
    }
  }
  return count;
}

test.describe('Card ResizeGutter geometry @smoke', () => {
  test('default chat: visible gutter is 8px with a centered 2px line, between two card frames @smoke', async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await goToChat(page);
    await expect(page.locator('[data-resize-gutter]').first()).toBeAttached();
    await assertAllGutterGeometry(page);
    const critical = filterCriticalErrors(errors);
    expect(critical, `unexpected console errors:\n${critical.join('\n')}`).toHaveLength(0);
  });

  test('chat detail: multiple gutters stay centered between the correct card pairs @smoke', async ({
    page,
  }) => {
    // A chat-detail route renders the multi-card row. The workspace
    // sidebar surfaces here (via a post-mount effect), so the row holds
    // at least sidebar | main | workspace → ≥2 gutters across two
    // different card pairs (sidebar↔main and main↔workspace). The
    // session id need not resolve to real data; the cards are layout-
    // level. Poll for ≥2 to absorb the async open, then geometry-check
    // EVERY gutter. (File tree + assistant use the identical
    // CardFrame/CardSurface/ResizeGutter pattern, pinned by
    // card-primitives.test.ts; they are not separately driven open
    // here, so this asserts the multi-gutter row without claiming full
    // all-panels coverage.)
    await goToConversation(page, 'e2e-gutter-geometry-probe');

    await expect
      .poll(() => page.locator('[data-resize-gutter]').count(), { timeout: 8000 })
      .toBeGreaterThanOrEqual(2);

    const count = await assertAllGutterGeometry(page);
    expect(count, 'chat detail shows ≥2 gutters across different card pairs').toBeGreaterThanOrEqual(2);
  });
});
