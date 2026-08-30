/**
 * run-cockpit-unknown-capacity.test.ts — contract for RunCockpit's
 * "context window unknown" popover block.
 *
 * Background (2026-05-08): the old fallback path rendered only the
 * Model / 默认 / 权限 rows when `usage.contextWindow` couldn't be
 * resolved (e.g. glm-5-turbo, custom CodePlan brand whose window
 * isn't in `model-context.ts`). The popover lost the entire context
 * breakdown even though `useContextUsage` had valid input / output /
 * cache numbers from the assistant turn. The user's recommendation:
 * mirror the old `ContextUsageIndicator` "capacity unknown" branch —
 * still surface the breakdown, just drop the percentage + progress
 * bar that have no denominator.
 *
 * This contract keeps both the unknown-capacity guard and the
 * breakdown rows present so a future refactor doesn't quietly
 * regress to "no contextWindow → no context info."
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const repoRoot = path.join(__dirname, '..', '..');

describe('RunCockpit — capacity-unknown context block', () => {
  // 2026-05-09 split: the unknown-capacity branch lives in the lazy
  // popover content file (RunCockpit.tsx is the trigger-only shell).
  // We read from RunCockpitPopoverContent.tsx so the contract still
  // catches a regression that drops the breakdown rows. The shell file
  // intentionally never references these keys — that's the whole point
  // of the split, and the chat-static-graph test enforces it.
  const src = fs.readFileSync(
    path.join(repoRoot, 'components/chat/RunCockpitPopoverContent.tsx'),
    'utf8',
  );

  it('declares an unknown-capacity guard derived from usage.hasData && !hasFullCtx', () => {
    assert.match(
      src,
      /showUnknownCapacityBlock\s*=\s*usage\.hasData\s*&&\s*!hasFullCtx/,
      'RunCockpitPopoverContent must derive an unknown-capacity flag so the fallback path can render context details when usage exists but contextWindow is missing',
    );
  });

  it('renders a "容量未知" / capacity-unknown header label in the unknown-capacity block', () => {
    assert.match(
      src,
      /runStatus\.contextCapacityUnknown/,
      'RunCockpitPopoverContent fallback must surface a "capacity unknown" label so the user can tell the percentage is intentionally missing rather than the data being absent',
    );
  });

  it('renders ContextBreakdownList in the unknown-capacity block (Phase 6 Phase 2a redesign)', () => {
    // 2026-05-19 redesign: the legacy 3-row Input / Output / Cache
    // breakdown is replaced by the 10-row ContextBreakdownList. The
    // contract is unchanged in spirit — breakdown stays visible without
    // a contextWindow — only the rendering surface changed.
    // Cache still surfaces via the `cache_or_previous` row inside
    // ContextBreakdownList when cacheReadTokens / cacheCreationTokens > 0.
    assert.match(
      src,
      /<ContextBreakdownList\s+breakdown=\{usage\.breakdown\}\s*\/>/,
      'RunCockpitPopoverContent unknown-capacity branch must render <ContextBreakdownList breakdown={usage.breakdown} /> so the 10-part breakdown stays visible',
    );
  });

  it('the contextCapacityUnknown i18n key exists in both zh and en bundles', () => {
    // Note: contextInput / contextOutput / contextCache keys remain in
    // both bundles because ContextUsageIndicator (a separate mount path)
    // still uses them. They'll be revisited in Phase 2c when that path
    // also adopts ContextBreakdownList.
    const zh = fs.readFileSync(path.join(repoRoot, 'i18n/zh.ts'), 'utf8');
    const en = fs.readFileSync(path.join(repoRoot, 'i18n/en.ts'), 'utf8');
    const key = 'runStatus.contextCapacityUnknown';
    assert.match(zh, new RegExp(`['"]${key.replace('.', '\\.')}['"]`), `${key} missing from zh.ts`);
    assert.match(en, new RegExp(`['"]${key.replace('.', '\\.')}['"]`), `${key} missing from en.ts`);
  });
});
