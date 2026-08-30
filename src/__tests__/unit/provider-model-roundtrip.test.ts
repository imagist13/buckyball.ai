/**
 * tech-debt #37 (2026-06-03) — sessions silently displayed/sent the WRONG model.
 *
 * Root cause: many persisted sessions store a *canonical* upstream model id while
 * the provider's picker rows are *aliases* (`value: 'opus' | 'sonnet' | 'haiku'`)
 * whose canonical id lives on `upstreamModelId`. There are TWO real canonical
 * forms, both verified against the live app:
 *   - OpenRouter (provider_type=openrouter): `anthropic/claude-opus-4.7`
 *     (the OpenRouter model slug) — confirmed via /api/providers/models 2026-06-04.
 *   - Direct Anthropic-skin / preset providers: `claude-opus-4-7` (dashes) —
 *     the preset merge in `src/app/api/providers/models/route.ts`.
 * Old `value`-only matches couldn't match EITHER, so they fell through to
 * `modelOptions[0]` (Sonnet, sort_order 0) — wrong display + silent Opus→Sonnet
 * send. Real session `de19e576` (OpenRouter, model=`anthropic/claude-opus-4.7`)
 * is exactly this shape; before the fix its composer read "Sonnet 4.6", after it
 * reads "Opus 4.7".
 *
 * Fix: one shared canonical-aware matcher, `findModelOption`, matches by alias
 * `value` OR canonical `upstreamModelId`. Commit b6d2e43 rewired only
 * `useProviderModels.resolvedModel`/`currentModelOption`; Codex review then
 * caught that the composer still had value-only matches that defeated it — most
 * importantly `MessageInput`'s auto-correct effect, which rewrote `currentModel`
 * to the first model (Sonnet) for any canonical id and (since it feeds
 * `useProviderModels`) made the send path send Sonnet. This file pins BOTH the
 * matcher behaviour AND every composer consumer onto the matcher.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { findModelOption, resolveComposerModelAutoCorrect } from '@/lib/model-option-match';

// Mirrors the CONFIRMED live OpenRouter picker rows (/api/providers/models,
// 2026-06-04): alias `value`, OpenRouter-slug `upstreamModelId`. `sonnet` is
// FIRST — the wrong fallback the bug produced for a canonical-Opus session.
const OPENROUTER_ROWS = [
  { value: 'sonnet', upstreamModelId: 'anthropic/claude-sonnet-4.6' },
  { value: 'opus', upstreamModelId: 'anthropic/claude-opus-4.7' },
  { value: 'haiku', upstreamModelId: 'anthropic/claude-haiku-4.5' },
];

// Direct Anthropic-skin / preset providers carry the OTHER canonical form
// (`claude-opus-4-7`, dashes, no prefix). The matcher must handle both.
const ANTHROPIC_SKIN_ROWS = [
  { value: 'sonnet', upstreamModelId: 'claude-sonnet-4-6' },
  { value: 'opus', upstreamModelId: 'claude-opus-4-7' },
  { value: 'haiku', upstreamModelId: 'claude-haiku-4-5-20251001' },
];

describe('findModelOption — alias ↔ canonical round-trip (tech-debt #37)', () => {
  it('matches by alias value', () => {
    assert.equal(findModelOption(OPENROUTER_ROWS, 'opus')?.value, 'opus');
  });

  it('resolves the OpenRouter canonical Opus slug to the opus row — NOT the first (Sonnet) row (the de19e576 repro)', () => {
    const row = findModelOption(OPENROUTER_ROWS, 'anthropic/claude-opus-4.7');
    assert.equal(row?.value, 'opus', 'a saved anthropic/claude-opus-4.7 must resolve to opus, not fall through to sonnet');
    assert.notEqual(row?.value, 'sonnet');
  });

  it('resolves the direct-Anthropic canonical Opus id (dashes) to the opus row', () => {
    assert.equal(findModelOption(ANTHROPIC_SKIN_ROWS, 'claude-opus-4-7')?.value, 'opus');
  });

  it('resolves a saved canonical Sonnet id (either form) to the sonnet row', () => {
    assert.equal(findModelOption(OPENROUTER_ROWS, 'anthropic/claude-sonnet-4.6')?.value, 'sonnet');
    assert.equal(findModelOption(ANTHROPIC_SKIN_ROWS, 'claude-sonnet-4-6')?.value, 'sonnet');
  });

  it('returns undefined for an id absent from the group (caller falls back to the group default)', () => {
    // The dash form is NOT an OpenRouter upstream id, so it must not match there.
    assert.equal(findModelOption(OPENROUTER_ROWS, 'claude-opus-4-7'), undefined);
    assert.equal(findModelOption(OPENROUTER_ROWS, 'not-a-model'), undefined);
  });

  it('returns undefined for an empty / undefined id', () => {
    assert.equal(findModelOption(OPENROUTER_ROWS, undefined), undefined);
    assert.equal(findModelOption(OPENROUTER_ROWS, ''), undefined);
  });
});

describe('resolveComposerModelAutoCorrect — canonical ids do NOT trigger auto-correct (#37 P1, behavioral)', () => {
  it('returns null for a resolvable canonical id — the regression: must NOT rewrite currentModel to Sonnet', () => {
    assert.equal(resolveComposerModelAutoCorrect('anthropic/claude-opus-4.7', OPENROUTER_ROWS), null);
    assert.equal(resolveComposerModelAutoCorrect('claude-opus-4-7', ANTHROPIC_SKIN_ROWS), null);
  });
  it('returns null for a valid alias', () => {
    assert.equal(resolveComposerModelAutoCorrect('opus', OPENROUTER_ROWS), null);
  });
  it('falls back to the first model for a genuinely-absent model (legit auto-correct preserved)', () => {
    assert.equal(resolveComposerModelAutoCorrect('gpt-4-removed', OPENROUTER_ROWS), 'sonnet');
  });
  it('returns null when there is nothing to correct (empty model / empty options)', () => {
    assert.equal(resolveComposerModelAutoCorrect('', OPENROUTER_ROWS), null);
    assert.equal(resolveComposerModelAutoCorrect(undefined, OPENROUTER_ROWS), null);
    assert.equal(resolveComposerModelAutoCorrect('opus', []), null);
  });
});

// ---- Source pins: every composer consumer must use the canonical-aware
// matcher, and the old value-only anti-patterns must stay gone. These guard the
// "display + send contract must not fork" invariant that Codex review flagged.
const read = (rel: string) => readFileSync(path.resolve(__dirname, '../..', rel), 'utf8');

describe('useProviderModels — resolved model uses the round-trip matcher (#37)', () => {
  const src = read('hooks/useProviderModels.ts');
  it('resolvedModel resolves via findModelOption(...).value', () => {
    assert.match(src, /const resolvedModel = findModelOption\(modelOptions, modelName\)\?\.value/);
  });
  it('currentModelOption uses findModelOption', () => {
    assert.match(src, /findModelOption\(modelOptions, currentModelValue\)/);
  });
});

describe('MessageInput — auto-correct routes through the canonical-aware helper (#37 P1)', () => {
  const src = read('components/chat/MessageInput.tsx');
  it('uses resolveComposerModelAutoCorrect', () => {
    assert.match(src, /resolveComposerModelAutoCorrect\(modelName, modelOptions\)/);
  });
  it('no longer uses the value-only .some() that rewrote canonical ids to the first model', () => {
    assert.doesNotMatch(src, /modelOptions\.some\(\s*m => m\.value === modelName\s*\)/);
  });
});

describe('ModelSelectorDropdown — display + active-row are canonical-aware (#37 P2)', () => {
  const src = read('components/chat/ModelSelectorDropdown.tsx');
  it('trigger label resolves via findModelOption', () => {
    assert.match(src, /findModelOption\(modelOptions, currentModelValue\)/);
  });
  it('active-row highlight resolves via findModelOption(group.models, …)', () => {
    assert.match(src, /findModelOption\(group\.models, currentModelValue\)\?\.value/);
  });
  it('no longer uses value-only currentModelOption / isActive matches', () => {
    assert.doesNotMatch(src, /modelOptions\.find\(\(m\) => m\.value === currentModelValue\)/);
    assert.doesNotMatch(src, /\.value === currentModelValue && group\.provider_id === currentProviderIdValue/);
  });
});

describe('ChatView — currentModelUpstream lookup is canonical-aware (#37)', () => {
  const src = read('components/chat/ChatView.tsx');
  it('upstream lookup uses findModelOption', () => {
    assert.match(src, /findModelOption\(models, currentModel\)/);
  });
  it('no longer uses the value-only models?.find for the upstream lookup', () => {
    assert.doesNotMatch(src, /models\?\.find\(\(m: \{ value: string \}\) => m\.value === currentModel\)/);
  });
});

describe('RunCockpitPopoverContent — run-status model label is canonical-aware (#37)', () => {
  const src = read('components/chat/RunCockpitPopoverContent.tsx');
  it('session model entry resolves via findModelOption', () => {
    assert.match(src, /findModelOption\(sessionProviderGroup\.models, modelName\)/);
  });
  it('no longer uses the value-only models.find for the run-status label', () => {
    assert.doesNotMatch(src, /sessionProviderGroup\.models\.find\(\(m\) => m\.value === modelName\)/);
  });
});
