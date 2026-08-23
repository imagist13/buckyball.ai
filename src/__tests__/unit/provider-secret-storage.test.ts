import '../db-isolation.setup';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createProvider,
  deleteProvider,
  getDb,
  getProvider,
  getProviderSecretStorageDiagnostics,
  migrateProviderSecrets,
  updateProvider,
} from '../../lib/db';
import { encryptProviderSecret } from '../../lib/provider-secret-crypto';

describe('provider secret storage', () => {
  it('stores new keys as ciphertext and materializes plaintext only in memory', () => {
    const plaintext = 'sk-测试-value';
    const provider = createProvider({
      name: `secret-test-${Date.now()}`,
      provider_type: 'custom',
      base_url: 'https://example.invalid',
      api_key: plaintext,
    });

    try {
      const raw = getDb().prepare(
        'SELECT api_key, api_key_ciphertext, api_key_storage FROM api_providers WHERE id = ?',
      ).get(provider.id) as { api_key: string; api_key_ciphertext: string; api_key_storage: string };
      assert.equal(raw.api_key, '');
      assert.match(raw.api_key_ciphertext, /^cpsec:v1:/);
      assert.doesNotMatch(raw.api_key_ciphertext, /测试|value/);
      assert.equal(raw.api_key_storage, 'safe_storage:test');
      const materialized = getProvider(provider.id);
      assert.equal(materialized?.api_key, plaintext);
      assert.equal('api_key_ciphertext' in (materialized ?? {}), false);

      const priorCiphertext = raw.api_key_ciphertext;
      updateProvider(provider.id, { notes: 'metadata-only update' });
      const after = getDb().prepare(
        'SELECT api_key_ciphertext FROM api_providers WHERE id = ?',
      ).get(provider.id) as { api_key_ciphertext: string };
      assert.equal(after.api_key_ciphertext, priorCiphertext);
    } finally {
      deleteProvider(provider.id);
    }
  });

  it('migrates legacy plaintext transactionally and idempotently', () => {
    const id = `legacy-secret-${Date.now()}`;
    const plaintext = 'legacy-secret-value';
    const now = new Date().toISOString();
    getDb().prepare(`
      INSERT INTO api_providers
        (id, name, provider_type, base_url, api_key, api_key_ciphertext, api_key_storage, created_at, updated_at)
      VALUES (?, ?, 'custom', 'https://example.invalid', ?, '', 'legacy_plaintext', ?, ?)
    `).run(id, id, plaintext, now, now);

    try {
      assert.equal(migrateProviderSecrets(getDb()), 1);
      assert.equal(migrateProviderSecrets(getDb()), 0);
      const raw = getDb().prepare(
        'SELECT api_key, api_key_ciphertext, api_key_storage FROM api_providers WHERE id = ?',
      ).get(id) as { api_key: string; api_key_ciphertext: string; api_key_storage: string };
      assert.equal(raw.api_key, '');
      assert.match(raw.api_key_ciphertext, /^cpsec:v1:/);
      assert.equal(raw.api_key_storage, 'safe_storage:test');
      assert.equal(getProvider(id)?.api_key, plaintext);

      const diagnostics = getProviderSecretStorageDiagnostics();
      assert.equal(diagnostics.available, true);
      assert.equal(diagnostics.backend, 'test');
      assert.ok(diagnostics.encryptedProviders >= 1);
      assert.equal(diagnostics.legacyPlaintextProviders, 0);
      assert.equal(diagnostics.lastErrorCode, null);
      assert.doesNotMatch(JSON.stringify(diagnostics), /legacy-secret-value|cpsec:v1/);
    } finally {
      deleteProvider(id);
    }
  });

  it('treats non-empty plaintext as authoritative over stale ciphertext', () => {
    const id = `rollback-secret-${Date.now()}`;
    const currentPlaintext = 'current-key-after-rollback';
    const staleCiphertext = encryptProviderSecret(id, 'stale-key-before-rollback');
    const now = new Date().toISOString();
    getDb().prepare(`
      INSERT INTO api_providers
        (id, name, provider_type, base_url, api_key, api_key_ciphertext, api_key_storage, created_at, updated_at)
      VALUES (?, ?, 'custom', 'https://example.invalid', ?, ?, 'safe_storage:test', ?, ?)
    `).run(id, id, currentPlaintext, staleCiphertext, now, now);

    try {
      assert.equal(getProvider(id)?.api_key, currentPlaintext);
      assert.equal(migrateProviderSecrets(getDb()), 1);
      const raw = getDb().prepare(
        'SELECT api_key, api_key_ciphertext FROM api_providers WHERE id = ?',
      ).get(id) as { api_key: string; api_key_ciphertext: string };
      assert.equal(raw.api_key, '');
      assert.notEqual(raw.api_key_ciphertext, staleCiphertext);
      assert.equal(getProvider(id)?.api_key, currentPlaintext);
    } finally {
      deleteProvider(id);
    }
  });

  it('keeps a failed row recoverable without aborting other provider migrations', () => {
    const suffix = Date.now();
    const blockedId = `blocked-secret-${suffix}`;
    const healthyId = `healthy-secret-${suffix}`;
    const triggerName = `block_provider_secret_${suffix}`;
    const now = new Date().toISOString();
    const insert = getDb().prepare(`
      INSERT INTO api_providers
        (id, name, provider_type, base_url, api_key, api_key_ciphertext, api_key_storage, created_at, updated_at)
      VALUES (?, ?, 'custom', 'https://example.invalid', ?, '', 'legacy_plaintext', ?, ?)
    `);
    insert.run(blockedId, blockedId, 'blocked-current-key', now, now);
    insert.run(healthyId, healthyId, 'healthy-current-key', now, now);
    getDb().exec(`
      CREATE TRIGGER "${triggerName}"
      BEFORE UPDATE OF api_key_ciphertext ON api_providers
      WHEN OLD.id = '${blockedId}'
      BEGIN
        SELECT RAISE(ABORT, 'synthetic provider migration failure');
      END;
    `);

    try {
      assert.equal(migrateProviderSecrets(getDb()), 1);
      const blocked = getDb().prepare(
        'SELECT api_key, api_key_ciphertext FROM api_providers WHERE id = ?',
      ).get(blockedId) as { api_key: string; api_key_ciphertext: string };
      assert.equal(blocked.api_key, 'blocked-current-key');
      assert.equal(blocked.api_key_ciphertext, '');
      assert.equal(getProvider(blockedId)?.api_key, 'blocked-current-key');

      const healthy = getDb().prepare(
        'SELECT api_key, api_key_ciphertext FROM api_providers WHERE id = ?',
      ).get(healthyId) as { api_key: string; api_key_ciphertext: string };
      assert.equal(healthy.api_key, '');
      assert.match(healthy.api_key_ciphertext, /^cpsec:v1:/);
      assert.equal(getProvider(healthyId)?.api_key, 'healthy-current-key');
      assert.notEqual(getProviderSecretStorageDiagnostics().lastErrorCode, null);
    } finally {
      getDb().exec(`DROP TRIGGER IF EXISTS "${triggerName}"`);
      deleteProvider(blockedId);
      deleteProvider(healthyId);
    }
  });
});
