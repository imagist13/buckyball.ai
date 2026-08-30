/**
 * status-notice-i18n.test.ts — the告知链 for runtime status notices renders from
 * the i18n dictionary, in the user's locale (model plan Phase 2 / s09, Codex
 * review P2 2026-07-18).
 *
 * The finding: SAMPLING_PARAMS_IGNORED and the unsupported-model
 * RUNTIME_EFFORT_IGNORED were built as English sentences on the SERVER, so a zh
 * user got English toasts and `src/i18n/*.ts` had no keys for either. These
 * tests assert the real chain end to end:
 *   producer → { code, reason, params } → resolveStatusNoticeKeys → translate
 * plus that BOTH chat entry points route through the one shared resolver (a
 * second mapping table is exactly the drift this design prevents).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveStatusNoticeKeys } from '../../lib/status-notice-i18n';
import { buildSamplingIgnoredNotice } from '../../lib/anthropic-sampling-notice';
import { sanitizeClaudeModelOptions } from '../../lib/claude-model-options';
import { translate } from '../../i18n';
import en from '../../i18n/en';
import zh from '../../i18n/zh';

const readSrc = (rel: string) => readFileSync(join(process.cwd(), 'src', rel), 'utf8');

// The exact keys this round introduces. en/zh must both define all of them.
const NEW_KEYS = [
  'chat.notice.samplingIgnored.title',
  'chat.notice.samplingIgnored.modelRejects.one',
  'chat.notice.samplingIgnored.modelRejects.other',
  'chat.notice.samplingIgnored.runtimeCannotSend.one',
  'chat.notice.samplingIgnored.runtimeCannotSend.other',
  'chat.notice.effortIgnored.unsupportedModel.title',
  'chat.notice.effortIgnored.unsupportedModel.message',
  'chat.notice.effortIgnored.unsupportedTier.title',
  'chat.notice.effortIgnored.unsupportedTier.message',
  'chat.notice.effortIgnored.thirdPartyProxy.title',
  'chat.notice.effortIgnored.thirdPartyProxy.message',
  'chat.notice.effortAdjusted.thinkingDisabled.title',
  'chat.notice.effortAdjusted.thinkingDisabled.message',
  'chat.notice.subagentModelUnavailable.title',
  'chat.notice.subagentModelUnavailable.message',
] as const;

describe('s09 — new user-visible notices exist in BOTH locales', () => {
  for (const key of NEW_KEYS) {
    it(`${key} is defined in en and zh`, () => {
      assert.ok((en as Record<string, string>)[key], `en.ts is missing ${key}`);
      assert.ok((zh as Record<string, string>)[key], `zh.ts is missing ${key}`);
    });
  }

  it('the zh copy is actually Chinese, not an English placeholder', () => {
    for (const key of NEW_KEYS) {
      assert.match((zh as Record<string, string>)[key], /[一-龥]/,
        `${key} was copied from en.ts without translating`);
    }
  });
});

describe('s09 — sampling notice resolves to a localized string, not wire prose', () => {
  const notice = buildSamplingIgnoredNotice({
    runtime: 'native',
    model: 'claude-sonnet-5',
    sanitized: sanitizeClaudeModelOptions({ model: 'claude-sonnet-5', temperature: 0.7 }),
  })!;

  it('the producer emits a reason + params (no rendered sentence)', () => {
    assert.equal(notice.reason, 'model-rejects');
    assert.deepEqual(notice.params, { model: 'claude-sonnet-5', names: 'temperature', count: 1 });
  });

  it('renders through the i18n key in en, interpolating model + names', () => {
    const keys = resolveStatusNoticeKeys(notice)!;
    assert.equal(keys.messageKey, 'chat.notice.samplingIgnored.modelRejects.one');
    const text = translate('en', keys.messageKey, notice.params);
    assert.match(text, /claude-sonnet-5/);
    assert.match(text, /temperature/);
    assert.match(text, /was not sent/, 'single param → singular copy');
  });

  it('the SAME payload renders in Chinese for a zh user', () => {
    const keys = resolveStatusNoticeKeys(notice)!;
    const text = translate('zh', keys.messageKey, notice.params);
    assert.match(text, /[一-龥]/, 'this is the whole point of the finding');
    assert.match(text, /claude-sonnet-5/, 'the model still has to be nameable');
    assert.notEqual(text, translate('en', keys.messageKey, notice.params));
  });

  it('three stripped params pick the plural key', () => {
    const many = buildSamplingIgnoredNotice({
      runtime: 'native',
      model: 'claude-sonnet-5',
      sanitized: sanitizeClaudeModelOptions({
        model: 'claude-sonnet-5', temperature: 0.2, topP: 0.9, topK: 40,
      }),
    })!;
    const keys = resolveStatusNoticeKeys(many)!;
    assert.equal(keys.messageKey, 'chat.notice.samplingIgnored.modelRejects.other');
    assert.match(translate('en', keys.messageKey, many.params), /were not sent/);
  });

  it('the SDK runtime maps to its own reason (different failure, different copy)', () => {
    const sdk = buildSamplingIgnoredNotice({
      runtime: 'sdk',
      model: 'claude-sonnet-4-6',
      sanitized: sanitizeClaudeModelOptions({ model: 'claude-sonnet-4-6', temperature: 0.3 }),
    })!;
    const keys = resolveStatusNoticeKeys(sdk)!;
    assert.equal(keys.messageKey, 'chat.notice.samplingIgnored.runtimeCannotSend.one');
    assert.match(translate('zh', keys.messageKey, sdk.params), /SDK/);
  });
});

describe('s09 — unsupported-model effort notice is localized too', () => {
  const payload = {
    code: 'RUNTIME_EFFORT_IGNORED',
    reason: 'unsupported-model',
    params: { model: 'claude-haiku-4-5-20251001', effort: 'max' },
  };

  it('resolves to the effortIgnored keys and names model + picked effort', () => {
    const keys = resolveStatusNoticeKeys(payload)!;
    assert.equal(keys.messageKey, 'chat.notice.effortIgnored.unsupportedModel.message');
    const text = translate('en', keys.messageKey, payload.params);
    assert.match(text, /claude-haiku-4-5-20251001/);
    assert.match(text, /"max"/, 'the user must see which pick was dropped');
  });

  it('renders in Chinese for a zh user', () => {
    const keys = resolveStatusNoticeKeys(payload)!;
    const text = translate('zh', keys.messageKey, payload.params);
    assert.match(text, /[一-龥]/);
    assert.match(text, /max/);
  });

  it('the copy no longer claims Sonnet 4.6 lacks effort (P1 consistency)', () => {
    for (const locale of ['en', 'zh'] as const) {
      const text = translate(locale, 'chat.notice.effortIgnored.unsupportedModel.message', payload.params);
      assert.match(text, /Sonnet 4\.6/,
        'Sonnet 4.6 is effort-capable — the "pick a supported model" list must say so');
    }
  });
});

describe('s09 — effort tier/proxy omissions preserve the user\'s real choice', () => {
  it('renders the unsupported Sonnet 4.6 tier and its real allowlist', () => {
    const payload = {
      code: 'RUNTIME_EFFORT_IGNORED',
      reason: 'unsupported-tier',
      params: {
        model: 'claude-sonnet-4-6',
        effort: 'xhigh',
        supported: 'low, medium, high, max',
      },
    };
    const keys = resolveStatusNoticeKeys(payload)!;
    assert.equal(keys.messageKey, 'chat.notice.effortIgnored.unsupportedTier.message');
    for (const locale of ['en', 'zh'] as const) {
      const text = translate(locale, keys.messageKey, payload.params);
      assert.match(text, /claude-sonnet-4-6/);
      assert.match(text, /xhigh/);
      assert.match(text, /low, medium, high, max/);
    }
  });

  it('localizes the third-party proxy notice instead of shipping English prose', () => {
    const payload = {
      code: 'RUNTIME_EFFORT_IGNORED',
      reason: 'third-party-proxy',
      params: { effort: 'xhigh' },
    };
    const keys = resolveStatusNoticeKeys(payload)!;
    assert.equal(keys.messageKey, 'chat.notice.effortIgnored.thirdPartyProxy.message');
    assert.match(translate('en', keys.messageKey, payload.params), /"xhigh"/);
    assert.match(translate('zh', keys.messageKey, payload.params), /「xhigh」/);
  });
});

describe('Opus 5 — disabled-thinking effort adjustment is localized', () => {
  const payload = {
    code: 'RUNTIME_EFFORT_ADJUSTED',
    reason: 'thinking-disabled-cap',
    params: { model: 'claude-opus-5', requested: 'xhigh', effective: 'high' },
  };

  it('names the requested and effective effort in both locales', () => {
    const keys = resolveStatusNoticeKeys(payload)!;
    assert.equal(keys.messageKey, 'chat.notice.effortAdjusted.thinkingDisabled.message');
    for (const locale of ['en', 'zh'] as const) {
      const text = translate(locale, keys.messageKey, payload.params);
      assert.match(text, /claude-opus-5/);
      assert.match(text, /xhigh/);
      assert.match(text, /high/);
    }
  });
});

describe('sub-agent model capability failures are localized and actionable', () => {
  const payload = {
    code: 'SUBAGENT_MODEL_UNAVAILABLE',
    reason: 'runtime-model-unsupported',
    params: { model: 'grok-4.5' },
  };

  it('tells the user the model did not run and offers a Runtime choice', () => {
    const keys = resolveStatusNoticeKeys(payload)!;
    assert.equal(keys.messageKey, 'chat.notice.subagentModelUnavailable.message');
    assert.match(translate('en', keys.messageKey, payload.params), /switch the session Runtime/i);
    assert.match(translate('zh', keys.messageKey, payload.params), /切换当前会话的 Runtime/);
  });
});

describe('s09 — unmapped notices degrade, they do not break', () => {
  it('a notice with no reason returns null (caller falls back to message)', () => {
    assert.equal(resolveStatusNoticeKeys({ code: 'THINKING_ALWAYS_ON' }), null);
  });

  it('an unrecognized reason returns null instead of throwing', () => {
    assert.equal(
      resolveStatusNoticeKeys({ code: 'RUNTIME_EFFORT_IGNORED', reason: 'from-a-newer-server' }),
      null,
    );
  });

  it('a notice without a reason remains unmapped', () => {
    assert.equal(resolveStatusNoticeKeys({ code: 'RUNTIME_EFFORT_IGNORED' }), null);
  });
});

describe('s09 — both chat entry points render via the shared resolver', () => {
  it('useSSEStream localizes inside maybeShowStatusToast', () => {
    const src = readSrc('hooks/useSSEStream.ts');
    assert.match(src, /resolveStatusNoticeKeys/,
      'the toast route must resolve i18n keys, not print the wire message');
    assert.match(src, /translateActive/);
    // The status bar has to use the same resolution or it would show nothing
    // now that the server stopped sending `message` for these codes.
    assert.match(src, /callbacks\.onStatus\(resolveStatusNoticeText\(statusData\)\)/);
  });

  it('the inline parser in app/chat/page.tsx reuses maybeShowStatusToast', () => {
    const src = readSrc('app/chat/page.tsx');
    assert.match(src, /maybeShowStatusToast\(statusData\)/,
      'a second toast path would need a second mapping table — that is the drift');
    assert.doesNotMatch(src, /resolveStatusNoticeKeys/,
      'the page must NOT map keys itself; one resolver, one set of keys');
  });

  it('neither native producer emits English prose for localized effort omissions', () => {
    for (const rel of ['lib/agent-loop.ts', 'lib/experimental/agent-loop-toolloop-poc.ts']) {
      const src = readSrc(rel);
      assert.match(src, /reason: 'unsupported-model'/, `${rel} must localize unsupported models`);
      assert.match(src, /reason: 'unsupported-tier'/, `${rel} must localize unsupported tiers`);
      assert.match(src, /reason: 'third-party-proxy'/, `${rel} must localize proxy omissions`);
      assert.doesNotMatch(src, /title: 'Effort ignored on this runtime'/,
        `${rel} still hardcodes the English proxy title`);
      assert.doesNotMatch(src, /message: `Third-party Anthropic proxies/,
        `${rel} still hardcodes the English proxy message`);
    }
  });

  it('the server keeps a diagnostic breadcrumb (log ≠ user surface)', () => {
    const src = readSrc('lib/agent-loop.ts');
    assert.match(src, /console\.warn\([\s\S]{0,200}not on Anthropic's effort-capable model list/,
      'dropping the toast prose must not drop operator diagnosability');
  });
});
