/**
 * Sonnet 5 接入回归 (2026-07-18, model plan Phase 2 / s01–s08) —
 * 模式沿用 fable-5-model.test.ts。
 *
 * Sonnet 5 (claude-sonnet-5) 与 Opus 4.7/4.8 / Fable 5 共享 adaptive-thinking
 * 请求契约（无手动 extended thinking；1M 默认上下文；非默认采样参数 400），
 * 但与 Fable 5 有一处关键差异：**思考可以显式关掉**。官方迁移指南
 * (whats-new-sonnet-5, 2026-07-17 核实)：adaptive thinking 默认开启，但
 * thinking:{type:'disabled'} 是合法且被尊重的请求（Fable 5 会 400）。所以
 * Sonnet 5 绝不能走 fable 的 thinkingForcedOn 分支 —— 'disabled' 原样透传，
 * 语义与 Opus 4.8 一致。
 *
 * 其它官方合同：effort low/medium/high(默认)/xhigh/max；新 tokenizer 同文本
 * 约 +30% token（budget 注记，非 wire 变更）。effort 现在在 Native 官方路径
 * 真正下发（@ai-sdk/anthropic 4.0.5 走 GA output_config.effort，无过期 beta
 * header）—— s05 revert，UI 选择与 wire 一致。
 *
 * 不接入 OpenRouter slug —— 仓库纪律要求显式 fixture，slug 未经验证。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  sanitizeClaudeModelOptions,
  isOpusAdaptiveThinkingModel,
  isFableModel,
  isSonnet5Model,
} from '../../lib/claude-model-options';
import { getContextWindow } from '../../lib/model-context';

const LIB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../lib');
const read = (f: string) => fs.readFileSync(path.join(LIB, f), 'utf8');

describe('Sonnet 5 — adaptive-thinking family detection', () => {
  it('detects sonnet-5 in upstream / short / tagged forms', () => {
    assert.equal(isSonnet5Model('claude-sonnet-5'), true);
    assert.equal(isSonnet5Model('sonnet-5'), true);
    assert.equal(isSonnet5Model('claude-sonnet-5[1m]'), true);
    assert.equal(isSonnet5Model(undefined), false);
  });

  it('does NOT misfire on the non-adaptive sonnet-4-6 (s06 no-regression)', () => {
    assert.equal(isSonnet5Model('claude-sonnet-4-6'), false);
    assert.equal(isOpusAdaptiveThinkingModel('claude-sonnet-4-6'), false);
    // and sonnet-5 is not mistaken for fable — different disable semantics
    assert.equal(isFableModel('claude-sonnet-5'), false);
  });

  it('sonnet-5 joins the adaptive family guard (enabled→adaptive, no 1m beta)', () => {
    assert.equal(isOpusAdaptiveThinkingModel('claude-sonnet-5'), true);
    // existing family members unaffected
    assert.equal(isOpusAdaptiveThinkingModel('claude-opus-4-8'), true);
    assert.equal(isOpusAdaptiveThinkingModel('claude-fable-5'), true);
  });
});

describe('Sonnet 5 — request param guards', () => {
  it('manual extended thinking → adaptive/summarized; 1M default (no beta header)', () => {
    const out = sanitizeClaudeModelOptions({
      model: 'claude-sonnet-5',
      thinking: { type: 'enabled', budgetTokens: 10000 },
      context1m: true,
    });
    assert.deepEqual(out.thinking, { type: 'adaptive', display: 'summarized' });
    assert.equal(out.applyContext1mBeta, false);
    assert.equal(out.isOpusAdaptiveThinking, true);
  });

  it("thinking:'disabled' is HONORED on Sonnet 5 (accepted upstream; NOT forced-on like Fable 5)", () => {
    const out = sanitizeClaudeModelOptions({
      model: 'claude-sonnet-5',
      thinking: { type: 'disabled' },
    });
    // The whole point of the SONNET_5_PATTERN split: 'disabled' passes through
    // untouched (Opus 4.8 semantics), and the forced-on flag stays false.
    assert.deepEqual(out.thinking, { type: 'disabled' });
    assert.equal(out.thinkingForcedOn, false,
      'sonnet-5 must NOT reuse the fable thinkingForcedOn path — disabled is a real option');
  });

  it('adaptive without display gets summarized (reasoning UI stays visible)', () => {
    const out = sanitizeClaudeModelOptions({
      model: 'claude-sonnet-5',
      thinking: { type: 'adaptive' },
    });
    assert.deepEqual(out.thinking, { type: 'adaptive', display: 'summarized' });
  });

  it('effort passes through the sanitizer untouched (wire assembly happens downstream)', () => {
    const out = sanitizeClaudeModelOptions({
      model: 'claude-sonnet-5',
      effort: 'xhigh',
    });
    assert.equal(out.effort, 'xhigh');
  });

  it('thinkingForcedOn is false on all sonnet-5 paths (adaptive / omitted)', () => {
    assert.equal(sanitizeClaudeModelOptions({
      model: 'claude-sonnet-5', thinking: { type: 'adaptive' },
    }).thinkingForcedOn, false);
    assert.equal(sanitizeClaudeModelOptions({
      model: 'claude-sonnet-5',
    }).thinkingForcedOn, false);
  });
});

describe('Sonnet 5 — sampling guard (s04: non-default temp/top_p/top_k 400s)', () => {
  it('strips a non-default temperature and reports it', () => {
    const out = sanitizeClaudeModelOptions({ model: 'claude-sonnet-5', temperature: 0.7 });
    assert.equal(out.sampling.temperature, undefined,
      'non-default temperature must not reach the wire');
    assert.deepEqual(out.strippedSamplingParams, ['temperature']);
  });

  it('keeps temperature exactly 1 (Anthropic default) without reporting it', () => {
    const out = sanitizeClaudeModelOptions({ model: 'claude-sonnet-5', temperature: 1 });
    assert.equal(out.sampling.temperature, 1);
    assert.deepEqual(out.strippedSamplingParams, []);
  });

  it('strips ANY explicit top_p / top_k (no default value exists)', () => {
    const out = sanitizeClaudeModelOptions({
      model: 'claude-sonnet-5', topP: 0.9, topK: 40,
    });
    assert.equal(out.sampling.topP, undefined);
    assert.equal(out.sampling.topK, undefined);
    assert.deepEqual(out.strippedSamplingParams, ['topP', 'topK']);
  });

  it('reports every stripped param together (temp + top_p + top_k)', () => {
    const out = sanitizeClaudeModelOptions({
      model: 'claude-sonnet-5', temperature: 0.2, topP: 0.5, topK: 10,
    });
    assert.deepEqual(out.strippedSamplingParams, ['temperature', 'topP', 'topK']);
    assert.deepEqual(out.sampling, {});
  });

  it('no sampling params → nothing stripped, empty sampling', () => {
    const out = sanitizeClaudeModelOptions({ model: 'claude-sonnet-5', effort: 'high' });
    assert.deepEqual(out.sampling, {});
    assert.deepEqual(out.strippedSamplingParams, []);
  });

  it('the guard does NOT misfire on non-adaptive Sonnet 4.6 — sampling passes through', () => {
    const out = sanitizeClaudeModelOptions({
      model: 'claude-sonnet-4-6', temperature: 0.7, topP: 0.9, topK: 40,
    });
    assert.deepEqual(out.sampling, { temperature: 0.7, topP: 0.9, topK: 40 },
      'Sonnet 4.6 is not in the 400-on-non-default family — do not strip');
    assert.deepEqual(out.strippedSamplingParams, []);
  });

  it('same guard applies to the rest of the adaptive family (Fable 5 / Opus 4.8)', () => {
    for (const model of ['claude-fable-5', 'claude-opus-4-8']) {
      const out = sanitizeClaudeModelOptions({ model, temperature: 0.5 });
      assert.deepEqual(out.strippedSamplingParams, ['temperature'],
        `${model} must strip non-default temperature`);
    }
  });
});

describe('Sonnet 5 — context window', () => {
  it('claude-sonnet-5 resolves to 1M (exact + via upstream option)', () => {
    assert.equal(getContextWindow('claude-sonnet-5'), 1_000_000);
    assert.equal(
      getContextWindow('sonnet-5', { upstream: 'claude-sonnet-5' }),
      1_000_000,
    );
  });

  it('sonnet-4-6 alias does NOT accidentally resolve via the sonnet-5 entry', () => {
    // 'sonnet' short alias is 200K; the sonnet-5 1M entry must not leak into it.
    assert.equal(getContextWindow('sonnet'), 200000);
  });
});

describe('Sonnet 5 — catalog / resolver source pins', () => {
  it('first-party Anthropic catalog ships sonnet-5 with concrete upstream and NO role', () => {
    const src = read('provider-catalog.ts');
    assert.match(src, /modelId: 'sonnet-5'/, 'catalog must contain sonnet-5');
    assert.match(src, /upstreamModelId: 'claude-sonnet-5'/);
    const entryStart = src.indexOf("modelId: 'sonnet-5'");
    const entry = src.slice(entryStart, entryStart + 900);
    // No role: sonnet-5 must be an explicit pick, not the default `sonnet`
    // role target (which stays claude-sonnet-4-6).
    assert.doesNotMatch(entry.split('},')[0], /\brole:/,
      'sonnet-5 must not claim a role alias');
  });

  it('OpenRouter catalog intentionally has NO sonnet-5 entry (slug unverified)', () => {
    const src = read('provider-catalog.ts');
    const orStart = src.indexOf('OPENROUTER_ANTHROPIC_MODELS');
    const orEnd = src.indexOf('ANTHROPIC_FIRST_PARTY_MODELS');
    assert.ok(!src.slice(orStart, orEnd).includes('sonnet-5'),
      'do not add an OpenRouter sonnet-5 slug without an explicit verified fixture');
  });
});

describe('Sonnet 5 — s06 no-regression on the existing family', () => {
  it('Opus 4.8 thinking:disabled still honored (unchanged)', () => {
    const out = sanitizeClaudeModelOptions({
      model: 'claude-opus-4-8', thinking: { type: 'disabled' },
    });
    assert.deepEqual(out.thinking, { type: 'disabled' });
    assert.equal(out.thinkingForcedOn, false);
  });

  it('Fable 5 thinking:disabled still forced-on (unchanged)', () => {
    const out = sanitizeClaudeModelOptions({
      model: 'claude-fable-5', thinking: { type: 'disabled' },
    });
    assert.equal(out.thinking, undefined);
    assert.equal(out.thinkingForcedOn, true);
  });
});
