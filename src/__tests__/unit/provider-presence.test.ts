/**
 * Unit tests for hasCodePilotProvider() — the precheck used by /api/chat to
 * decide whether to let a request through or redirect the user to the setup
 * flow.
 *
 * Key contract: settings.json (cc-switch, manual edits) is NOT a credential
 * source for CodePilot's provider-presence check. The user must have either
 * a DB provider, process.env ANTHROPIC_*, or the legacy
 * `anthropic_auth_token` setting.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Swap HOME and DATA dir so tests don't touch real user files / DB
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalDataDir = process.env.CLAUDE_GUI_DATA_DIR;
const originalApiKey = process.env.ANTHROPIC_API_KEY;
const originalAuthToken = process.env.ANTHROPIC_AUTH_TOKEN;

let tempHome: string;
let tempDataDir: string;

// db.ts caches the data-dir path on first import, so setting
// CLAUDE_GUI_DATA_DIR per test does not switch databases. Instead we share the
// data dir across tests but wipe all providers + the legacy setting between
// them, so each test starts from a clean DB surface.
beforeEach(async () => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-presence-home-'));
  if (!tempDataDir) {
    tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-presence-db-'));
    process.env.CLAUDE_GUI_DATA_DIR = tempDataDir;
  }
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;

  const { getAllProviders, deleteProvider, setSetting } = await import('@/lib/db');
  for (const p of getAllProviders()) deleteProvider(p.id);
  setSetting('anthropic_auth_token', '');
  // Clear OAuth tokens so earlier tests can't leak credentials into later ones
  setSetting('openai_oauth_access_token', '');
  setSetting('openai_oauth_refresh_token', '');
  setSetting('openai_oauth_expires_at', '');
});

afterEach(() => {
  if (originalHome !== undefined) process.env.HOME = originalHome;
  else delete process.env.HOME;
  if (originalUserProfile !== undefined) process.env.USERPROFILE = originalUserProfile;
  else delete process.env.USERPROFILE;
  if (originalApiKey !== undefined) process.env.ANTHROPIC_API_KEY = originalApiKey;
  if (originalAuthToken !== undefined) process.env.ANTHROPIC_AUTH_TOKEN = originalAuthToken;
  try { fs.rmSync(tempHome, { recursive: true, force: true }); } catch { /* ignore */ }
  // leave tempDataDir in place for the lifetime of the suite
});

// restore original DATA_DIR after whole suite
process.on('exit', () => {
  if (originalDataDir !== undefined) process.env.CLAUDE_GUI_DATA_DIR = originalDataDir;
  else delete process.env.CLAUDE_GUI_DATA_DIR;
  try { fs.rmSync(tempDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

function writeClaudeSettings(body: unknown) {
  const dir = path.join(tempHome, '.claude');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(body));
}

describe('hasCodePilotProvider', () => {
  it('returns false on a clean install (no DB provider, no env, no settings)', async () => {
    const { hasCodePilotProvider } = await import('../../lib/provider-presence');
    assert.equal(hasCodePilotProvider(), false);
  });

  it('returns true when process.env.ANTHROPIC_API_KEY is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    const { hasCodePilotProvider } = await import('../../lib/provider-presence');
    assert.equal(hasCodePilotProvider(), true);
  });

  it('returns true when process.env.ANTHROPIC_AUTH_TOKEN is set', async () => {
    process.env.ANTHROPIC_AUTH_TOKEN = 'sk-ant-test';
    const { hasCodePilotProvider } = await import('../../lib/provider-presence');
    assert.equal(hasCodePilotProvider(), true);
  });

  it('returns true when a DB provider with api_key exists', async () => {
    const { createProvider } = await import('@/lib/db');
    createProvider({
      name: 'Kimi',
      provider_type: 'anthropic',
      base_url: 'https://kimi.example.com',
      api_key: 'sk-kimi-test',
    });
    const { hasCodePilotProvider } = await import('../../lib/provider-presence');
    assert.equal(hasCodePilotProvider(), true);
  });

  it('returns true when legacy anthropic_auth_token setting is set', async () => {
    const { setSetting } = await import('@/lib/db');
    setSetting('anthropic_auth_token', 'sk-legacy-token');
    const { hasCodePilotProvider } = await import('../../lib/provider-presence');
    assert.equal(hasCodePilotProvider(), true);
  });

  it('returns FALSE even when ~/.claude/settings.json has a cc-switch token — this is by design', async () => {
    writeClaudeSettings({
      env: {
        ANTHROPIC_BASE_URL: 'https://relay.example.com',
        ANTHROPIC_AUTH_TOKEN: 'sk-ant-cc-switch',
      },
    });
    const { hasCodePilotProvider } = await import('../../lib/provider-presence');
    // Contract: ~/.claude/settings.json is the Claude Code CLI's config file;
    // hasCodePilotProvider() intentionally ignores it so users relying only on
    // cc-switch get routed to the CodePilot setup wizard. This will intercept
    // first-time cc-switch users at /api/chat until they add a provider
    // explicitly — a deliberate behavior change documented in 0.50.3 release
    // notes (see docs/exec-plans/active/runtime-auto-and-onboarding.md).
    assert.equal(hasCodePilotProvider(), false);
  });

  it('returns true for a Bedrock provider configured via legacy extra_env', async () => {
    const { createProvider } = await import('@/lib/db');
    createProvider({
      name: 'Bedrock (legacy)',
      provider_type: 'anthropic',
      base_url: '',
      api_key: '',
      extra_env: JSON.stringify({ CLAUDE_CODE_USE_BEDROCK: '1', AWS_REGION: 'us-east-1' }),
    });
    const { hasCodePilotProvider } = await import('../../lib/provider-presence');
    assert.equal(hasCodePilotProvider(), true);
  });

  it('returns true for a Bedrock provider configured via env_overrides_json (current UI)', async () => {
    const { createProvider } = await import('@/lib/db');
    createProvider({
      name: 'Bedrock (current)',
      provider_type: 'anthropic',
      base_url: '',
      api_key: '',
      env_overrides_json: JSON.stringify({ CLAUDE_CODE_USE_BEDROCK: '1', AWS_REGION: 'us-east-1' }),
    });
    const { hasCodePilotProvider } = await import('../../lib/provider-presence');
    assert.equal(hasCodePilotProvider(), true);
  });

  it('returns true for a Vertex provider configured via env_overrides_json', async () => {
    const { createProvider } = await import('@/lib/db');
    createProvider({
      name: 'Vertex',
      provider_type: 'anthropic',
      base_url: '',
      api_key: '',
      env_overrides_json: JSON.stringify({ CLAUDE_CODE_USE_VERTEX: 'true', ANTHROPIC_VERTEX_PROJECT_ID: 'p1' }),
    });
    const { hasCodePilotProvider } = await import('../../lib/provider-presence');
    assert.equal(hasCodePilotProvider(), true);
  });

  it('returns true when a valid OpenAI OAuth session exists', async () => {
    const { setSetting } = await import('@/lib/db');
    setSetting('openai_oauth_access_token', 'ya29.a0Test');
    // expiresAt in the future so isOAuthUsable() returns true
    setSetting('openai_oauth_expires_at', String(Date.now() + 60 * 60 * 1000));
    const { hasCodePilotProvider } = await import('../../lib/provider-presence');
    assert.equal(hasCodePilotProvider(), true);
  });

  it('returns true when OAuth access token is expired but a refresh token exists', async () => {
    const { setSetting } = await import('@/lib/db');
    setSetting('openai_oauth_access_token', 'ya29.expired');
    setSetting('openai_oauth_expires_at', String(Date.now() - 60 * 1000));
    setSetting('openai_oauth_refresh_token', 'refresh-token');
    const { hasCodePilotProvider } = await import('../../lib/provider-presence');
    assert.equal(hasCodePilotProvider(), true);
  });

  it('returns false when OAuth is logged out (no access token)', async () => {
    const { hasCodePilotProvider } = await import('../../lib/provider-presence');
    assert.equal(hasCodePilotProvider(), false);
  });
});
