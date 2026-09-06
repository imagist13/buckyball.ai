import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { safeStorage } from 'electron';
import {
  PROVIDER_SECRET_BACKEND_ENV,
  PROVIDER_SECRET_KEY_ENV,
  PROVIDER_SECRET_LEVEL_ENV,
} from '../src/lib/provider-secret-crypto';

interface WrappedProviderSecretKey {
  version: 1;
  wrappedKey: string;
  createdAt: string;
}

function storageBackend(): { backend: string; level: 'system_protected' | 'degraded' } {
  if (process.platform === 'win32') return { backend: 'windows_dpapi', level: 'system_protected' };
  if (process.platform === 'darwin') return { backend: 'macos_keychain', level: 'system_protected' };
  const backend = safeStorage.getSelectedStorageBackend();
  return {
    backend: `linux_${backend}`,
    level: backend === 'basic_text' || backend === 'unknown' ? 'degraded' : 'system_protected',
  };
}

/**
 * Load or create the data-encryption key. The on-disk file contains only the
 * safeStorage-wrapped key; the plaintext key is returned for the packaged
 * Next child environment and never logged or written beside the database.
 */
export function initializeProviderSecretEnvironment(userDataDir: string): Record<string, string> {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('safe_storage_unavailable');
  const keyPath = path.join(userDataDir, 'provider-secret-key.v1.json');
  let encodedKey: string;

  if (fs.existsSync(keyPath)) {
    const parsed = JSON.parse(fs.readFileSync(keyPath, 'utf8')) as WrappedProviderSecretKey;
    if (parsed.version !== 1 || typeof parsed.wrappedKey !== 'string' || !parsed.wrappedKey) {
      throw new Error('provider_secret_key_file_invalid');
    }
    encodedKey = safeStorage.decryptString(Buffer.from(parsed.wrappedKey, 'base64'));
  } else {
    encodedKey = crypto.randomBytes(32).toString('base64');
    const payload: WrappedProviderSecretKey = {
      version: 1,
      wrappedKey: safeStorage.encryptString(encodedKey).toString('base64'),
      createdAt: new Date().toISOString(),
    };
    fs.mkdirSync(userDataDir, { recursive: true });
    const tempPath = `${keyPath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tempPath, keyPath);
  }

  if (Buffer.from(encodedKey, 'base64').length !== 32) {
    throw new Error('provider_secret_key_invalid');
  }
  const storage = storageBackend();
  return {
    [PROVIDER_SECRET_KEY_ENV]: encodedKey,
    [PROVIDER_SECRET_BACKEND_ENV]: storage.backend,
    [PROVIDER_SECRET_LEVEL_ENV]: storage.level,
  };
}
