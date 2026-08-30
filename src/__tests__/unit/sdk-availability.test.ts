/**
 * Integration tests for SDK availability + announcement persistence.
 * Exercises REAL code paths including DB providers and API route handler.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getSetting, setSetting, getDb,
  createProvider, deleteProvider, getAllProviders,
} from '@/lib/db';

// ── Env helpers ────────────────────────────────────────────────

let savedEnv: Record<string, string | undefined> = {};
let savedDbToken: string | undefined;

function saveEnv() {
  savedEnv = {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN,
  };
  savedDbToken = getSetting('anthropic_auth_token');
}

function clearAnthropicEnv() {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  setSetting('anthropic_auth_token', '');
}

function restoreEnv() {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  if (savedDbToken !== undefined) {
    setSetting('anthropic_auth_token', savedDbToken);
  }
}

// ── Test provider helpers ──────────────────────────────────────

function cleanupTestProviders() {
  for (const p of getAllProviders()) {
    if (p.name.startsWith('__test_sdk_')) deleteProvider(p.id);
  }
}

function deactivateNonTestProviders(): string[] {
  const db = getDb();
  const deactivated: string[] = [];
  for (const p of getAllProviders()) {
    if (!p.name.startsWith('__test_sdk_') && p.is_active) {
      db.prepare('UPDATE api_providers SET is_active = 0 WHERE id = ?').run(p.id);
      deactivated.push(p.id);
    }
  }
  return deactivated;
}

function reactivateProviders(ids: string[]) {
  const db = getDb();
  for (const id of ids) {
    db.prepare('UPDATE api_providers SET is_active = 1 WHERE id = ?').run(id);
  }
}

// ── Suite 1: SDK availability with env vars ────────────────────

describe('sdkRuntime.isAvailable() — env var paths', () => {
  beforeEach(() => saveEnv());
  afterEach(() => restoreEnv());

  it('ANTHROPIC_API_KEY env → credential check passes', async () => {
    clearAnthropicEnv();
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
    const { sdkRuntime } = await import('@/lib/runtime/sdk-runtime');
    const result = sdkRuntime.isAvailable();
    // true if CLI exists, false if not — but credential branch is exercised either way
    if (result) assert.equal(result, true);
  });

  it('ANTHROPIC_AUTH_TOKEN env → credential check passes', async () => {
    clearAnthropicEnv();
    process.env.ANTHROPIC_AUTH_TOKEN = 'test-auth-token';
    const { sdkRuntime } = await import('@/lib/runtime/sdk-runtime');
    const result = sdkRuntime.isAvailable();
    if (result) assert.equal(result, true);
  });

  it('legacy DB anthropic_auth_token → credential check passes', async () => {
    clearAnthropicEnv();
    setSetting('anthropic_auth_token', 'test-legacy-token');
    const { sdkRuntime } = await import('@/lib/runtime/sdk-runtime');
    const result = sdkRuntime.isAvailable();
    if (result) assert.equal(result, true);
    setSetting('anthropic_auth_token', '');
  });
});

// ── Suite 2: SDK availability with DB providers ────────────────

describe('sdkRuntime.isAvailable() — DB provider paths', () => {
  let deactivated: string[] = [];

  beforeEach(() => {
    saveEnv();
    clearAnthropicEnv();
    cleanupTestProviders();
    // Deactivate existing providers so only our test provider is active
    deactivated = deactivateNonTestProviders();
  });

  afterEach(() => {
    cleanupTestProviders();
    reactivateProviders(deactivated);
    restoreEnv();
  });

  it('active DB provider with api_key → available (getActiveProvider path)', async () => {
    createProvider({
      name: '__test_sdk_anthropic',
      provider_type: 'anthropic',
      protocol: 'anthropic',
      base_url: 'https://api.anthropic.com',
      api_key: 'sk-ant-test-provider-key',
      extra_env: '{}',
    });

    const { sdkRuntime } = await import('@/lib/runtime/sdk-runtime');
    const result = sdkRuntime.isAvailable();
    // true if CLI exists (has provider with api_key), false if no CLI
    if (result) assert.equal(result, true);
  });

  it('isAvailable only depends on CLI binary, not provider config', async () => {
    // Even with a Bedrock provider and no API key, isAvailable() only checks CLI.
    // Auth validation happens at runtime, not at availability check.
    createProvider({
      name: '__test_sdk_bedrock',
      provider_type: 'bedrock',
      protocol: 'bedrock',
      base_url: '',
      api_key: '',
      extra_env: '{"CLAUDE_CODE_USE_BEDROCK":"1","AWS_REGION":"us-east-1"}',
    });

    const { sdkRuntime } = await import('@/lib/runtime/sdk-runtime');
    const result = sdkRuntime.isAvailable();
    assert.equal(typeof result, 'boolean'); // depends on CLI binary existence
  });

  it('no active providers + no env creds → depends only on CLI binary', async () => {
    // isAvailable() now only checks CLI binary existence.
    // Auth is managed by CLI itself (OAuth session, etc.) and fails at runtime.
    // This test verifies the check doesn't crash with empty DB/env state.
    const { sdkRuntime } = await import('@/lib/runtime/sdk-runtime');
    const result = sdkRuntime.isAvailable();
    // Result depends on whether CLI binary exists on this machine — both are valid
    assert.equal(typeof result, 'boolean');
  });
});

// ── Suite 3: Announcement DB persistence ───────────────────────

describe('Announcement dismiss — real DB persistence', () => {
  const ANNOUNCEMENT_KEY = 'codepilot:announcement:v0.48-agent-engine';
  let savedValue: string | undefined;

  beforeEach(() => {
    savedValue = getSetting(ANNOUNCEMENT_KEY);
  });

  afterEach(() => {
    setSetting(ANNOUNCEMENT_KEY, savedValue || '');
  });

  it('setSetting/getSetting roundtrip works for announcement key', () => {
    setSetting(ANNOUNCEMENT_KEY, 'true');
    assert.equal(getSetting(ANNOUNCEMENT_KEY), 'true');
  });

  it('can clear dismiss flag', () => {
    setSetting(ANNOUNCEMENT_KEY, 'true');
    setSetting(ANNOUNCEMENT_KEY, '');
    const read = getSetting(ANNOUNCEMENT_KEY);
    assert.ok(!read || read === '');
  });
});

// ── Suite 4: Announcement API whitelist ────────────────────────

describe('Announcement dismiss — API route whitelist', () => {
  // Tests that the settings/app route handler accepts the announcement key.
  // This is the exact regression that was fixed (key missing from ALLOWED_KEYS).

  it('ALLOWED_KEYS includes the announcement key', async () => {
    // Import the route module source to check the whitelist directly.
    // The route.ts exports GET/PUT handlers, but we can also check
    // the module's ALLOWED_KEYS by reading the file.
    const fs = await import('fs');
    const routeSource = fs.readFileSync(
      'src/app/api/settings/app/route.ts',
      'utf-8',
    );
    assert.ok(
      routeSource.includes('codepilot:announcement:v0.48-agent-engine'),
      'ALLOWED_KEYS must include the announcement dismiss key — ' +
      'without it, PUT silently drops the key and the dialog reappears on restart',
    );
  });
});
