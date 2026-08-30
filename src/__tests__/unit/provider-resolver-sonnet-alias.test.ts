/**
 * P0.5 (2026-06-01) — bare Anthropic alias must never reach a Claude-compat
 * gateway verbatim.
 *
 * Packaged log showed `Claude Code compat API error: 503 ... 分组 auto 下模型
 * sonnet 无可用渠道`: a legacy DB row `model_id='sonnet'` (NULL upstream) on a
 * New-API / Claude-compat provider flowed to the gateway as `sonnet`. The
 * existing single-model "first in list" fallback doesn't fire for multi-model
 * gateways, so the alias leaked. Fix: a DETERMINISTIC alias→upstream map
 * applied on BOTH send paths (toClaudeCodeEnv ANTHROPIC_MODEL +
 * toAiSdkConfig modelId).
 *
 * See docs/preview/packaged-preview-p0-diagnosis-2026-06-01.md + tech-debt #23.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  canonicalAnthropicAliasUpstream,
  ANTHROPIC_ALIAS_UPSTREAM,
} from '@/lib/provider-resolver';

// ── Pure map ────────────────────────────────────────────────────────

describe('canonicalAnthropicAliasUpstream — deterministic alias → upstream', () => {
  it('maps the three bare aliases to their canonical upstream ids', () => {
    assert.equal(canonicalAnthropicAliasUpstream('sonnet'), 'claude-sonnet-4-6');
    assert.equal(canonicalAnthropicAliasUpstream('opus'), 'claude-opus-4-7');
    assert.equal(canonicalAnthropicAliasUpstream('haiku'), 'claude-haiku-4-5-20251001');
  });
  it('returns undefined for a non-alias / already-qualified id (never forces it)', () => {
    assert.equal(canonicalAnthropicAliasUpstream('claude-sonnet-4-6'), undefined);
    assert.equal(canonicalAnthropicAliasUpstream('glm-4.6'), undefined);
    assert.equal(canonicalAnthropicAliasUpstream(undefined), undefined);
    assert.equal(canonicalAnthropicAliasUpstream(''), undefined);
  });
  it('table is exactly the three Anthropic UI aliases', () => {
    assert.deepEqual(Object.keys(ANTHROPIC_ALIAS_UPSTREAM).sort(), ['haiku', 'opus', 'sonnet']);
  });
});

// ── DB integration: legacy `sonnet` row on a Claude-compat provider ──

const originalDataDir = process.env.CLAUDE_GUI_DATA_DIR;
const originalApiKey = process.env.ANTHROPIC_API_KEY;
const originalAuthToken = process.env.ANTHROPIC_AUTH_TOKEN;
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
let tempDataDir: string;
let tempHome: string;

beforeEach(() => {
  tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-sonnetalias-db-'));
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-sonnetalias-home-'));
  process.env.CLAUDE_GUI_DATA_DIR = tempDataDir;
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
});

afterEach(() => {
  if (originalDataDir !== undefined) process.env.CLAUDE_GUI_DATA_DIR = originalDataDir;
  else delete process.env.CLAUDE_GUI_DATA_DIR;
  if (originalApiKey !== undefined) process.env.ANTHROPIC_API_KEY = originalApiKey;
  if (originalAuthToken !== undefined) process.env.ANTHROPIC_AUTH_TOKEN = originalAuthToken;
  if (originalHome !== undefined) process.env.HOME = originalHome; else delete process.env.HOME;
  if (originalUserProfile !== undefined) process.env.USERPROFILE = originalUserProfile; else delete process.env.USERPROFILE;
  try { fs.rmSync(tempDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  try { fs.rmSync(tempHome, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('legacy `sonnet` row on a Claude-compat provider does not leak verbatim', () => {
  async function setupProviderWithLegacySonnet() {
    const { createProvider, upsertProviderModel } = await import('../../lib/db');
    const provider = createProvider({
      name: 'New-API Gateway',
      provider_type: 'anthropic',
      base_url: 'https://gateway.example.com',
      api_key: 'sk-gw',
      // default role is the bare alias — exactly the legacy gateway config.
      role_models_json: JSON.stringify({ default: 'sonnet' }),
    });
    // Legacy materialized row: model_id='sonnet', NULL upstream (stored as '').
    // DB-wins merge means availableModels['sonnet'] carries no upstream, so the
    // catalog can't canonicalize it — only the P0.5 alias map can.
    upsertProviderModel({ provider_id: provider.id, model_id: 'sonnet', enabled: 1 });
    return provider;
  }

  it('toAiSdkConfig resolves a bare `sonnet` model override to claude-sonnet-4-6', async () => {
    const provider = await setupProviderWithLegacySonnet();
    const { resolveProvider, toAiSdkConfig } = await import('../../lib/provider-resolver');
    const resolved = resolveProvider({ providerId: provider.id });
    const config = toAiSdkConfig(resolved, 'sonnet');
    assert.equal(config.modelId, 'claude-sonnet-4-6', 'bare sonnet must canonicalize, not ship verbatim');
    assert.notEqual(config.modelId, 'sonnet');
  });

  it('toClaudeCodeEnv sets ANTHROPIC_MODEL to claude-sonnet-4-6 (not bare sonnet)', async () => {
    const provider = await setupProviderWithLegacySonnet();
    const { resolveProvider, toClaudeCodeEnv } = await import('../../lib/provider-resolver');
    const resolved = resolveProvider({ providerId: provider.id });
    const env = toClaudeCodeEnv({}, resolved);
    assert.equal(env.ANTHROPIC_MODEL, 'claude-sonnet-4-6', 'Claude Code env must not ship bare `sonnet` to the gateway');
    assert.notEqual(env.ANTHROPIC_MODEL, 'sonnet');
  });
});

// ── Wiring source pins (both send paths) ────────────────────────────

describe('provider-resolver — P0.5 canonicalization wired on both send paths', () => {
  const src = fs.readFileSync(
    path.resolve(__dirname, '../../lib/provider-resolver.ts'),
    'utf8',
  );
  it('roleModelForEnv (toClaudeCodeEnv → ANTHROPIC_MODEL) canonicalizes the resolved id', () => {
    // `canonicalAnthropicAliasUpstream(resolvedId)` is unique to roleModelForEnv
    // (toAiSdkConfig's call passes `modelId`), so this single match pins the
    // ANTHROPIC_MODEL send-path wiring.
    assert.match(
      src,
      /canonicalAnthropicAliasUpstream\(resolvedId\)/,
      'roleModelForEnv must canonicalize the FINAL resolved id before it becomes ANTHROPIC_MODEL',
    );
  });
  it('toAiSdkConfig main-model path canonicalizes a bare alias on anthropic protocol', () => {
    assert.match(
      src,
      /SHORT_ALIASES\.has\(modelId\)\s*&&\s*resolved\.protocol === 'anthropic'[\s\S]{0,200}canonicalAnthropicAliasUpstream\(/,
      'toAiSdkConfig must canonicalize a residual bare alias for anthropic-protocol providers',
    );
  });
});
