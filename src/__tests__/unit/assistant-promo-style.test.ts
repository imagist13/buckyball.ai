import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(
  path.resolve(__dirname, '../../components/chat/ChatEmptyState.tsx'),
  'utf8',
);
const promoSource = source.slice(source.indexOf('export function AssistantPromoCard'));
const onboardingSource = source.slice(0, source.indexOf('/* ─── Sidebar promo card'));

describe('assistant onboarding entry-card style contract', () => {
  it('uses compact whole-card actions instead of the legacy Card footer treatment', () => {
    assert.match(onboardingSource, /data-assistant-onboarding-cards/);
    assert.match(onboardingSource, /w-full px-4 py-2/);
    assert.match(onboardingSource, /data-chat-entry-card=/);
    assert.match(onboardingSource, /min-h-\[88px\]/);
    assert.match(onboardingSource, /rounded-2xl/);
    assert.doesNotMatch(onboardingSource, /<Card(?:\s|>)/);
    assert.doesNotMatch(onboardingSource, /CardFooter/);
    assert.doesNotMatch(onboardingSource, /shadow-(?:sm|md)/);
  });

  it('keeps project and assistant entry actions explicit and keyboard focusable', () => {
    assert.match(onboardingSource, /actionLabel=\{t\('chat\.empty\.selectFolder'\)\}/);
    assert.match(onboardingSource, /chat\.empty\.assistant\.open/);
    assert.match(onboardingSource, /chat\.empty\.assistant\.setup/);
    assert.match(onboardingSource, /focus-visible:ring-2/);
  });

  it('does not render the redundant explanation or recent-project shortcuts', () => {
    assert.doesNotMatch(onboardingSource, /chat\.empty\.explanation/);
    assert.doesNotMatch(onboardingSource, /chat\.empty\.recentProjects/);
    assert.doesNotMatch(onboardingSource, /recentProjects/);
    assert.doesNotMatch(onboardingSource, /onSelectProject/);
  });
});

describe('assistant sidebar promo style contract', () => {
  it('uses a borderless lightweight sidebar treatment', () => {
    assert.match(promoSource, /relative mx-2 mb-2 px-3 py-2/);
    assert.match(promoSource, /variant="ghost"/);
    assert.match(promoSource, /data-assistant-promo/);
    assert.doesNotMatch(promoSource, /<Card(?:\s|>)/);
    assert.doesNotMatch(promoSource, /EGG_IMAGE_URL/);
    assert.doesNotMatch(promoSource, /border-sidebar-border/);
    assert.doesNotMatch(promoSource, /shadow-/);
    assert.doesNotMatch(promoSource, /variant="outline"/);
  });

  it('keeps the dismiss action localized and large enough to target', () => {
    assert.match(promoSource, /aria-label=\{t\('chat\.empty\.assistant\.dismiss'\)\}/);
    assert.match(promoSource, /size-6/);
    assert.match(promoSource, /items-start/);
  });

  it('supports a non-persistent visual QA preview', () => {
    assert.match(promoSource, /preview = false/);
    assert.match(promoSource, /dismissed && !preview/);
    assert.match(promoSource, /if \(!preview\)/);
  });
});
