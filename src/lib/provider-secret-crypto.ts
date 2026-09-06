import crypto from 'node:crypto';

export const PROVIDER_SECRET_KEY_ENV = 'CODEPILOT_PROVIDER_SECRET_KEY';
export const PROVIDER_SECRET_BACKEND_ENV = 'CODEPILOT_PROVIDER_SECRET_BACKEND';
export const PROVIDER_SECRET_LEVEL_ENV = 'CODEPILOT_PROVIDER_SECRET_LEVEL';
const CIPHERTEXT_PREFIX = 'cpsec:v1';

export type ProviderSecretSecurityLevel = 'system_protected' | 'degraded' | 'unavailable' | 'test';

export interface ProviderSecretEnvironmentStatus {
  available: boolean;
  backend: string;
  securityLevel: ProviderSecretSecurityLevel;
}

interface ProviderSecretRuntimeState {
  consumed: boolean;
  key: Buffer | null;
  backend: string;
  securityLevel: ProviderSecretSecurityLevel;
}

const RUNTIME_STATE_KEY = Symbol.for('codepilot.provider-secret-runtime-state');

function runtimeState(): ProviderSecretRuntimeState {
  const root = globalThis as typeof globalThis & {
    [RUNTIME_STATE_KEY]?: ProviderSecretRuntimeState;
  };
  if (!root[RUNTIME_STATE_KEY]) {
    root[RUNTIME_STATE_KEY] = {
      consumed: false,
      key: null,
      backend: 'none',
      securityLevel: 'unavailable',
    };
  }
  return root[RUNTIME_STATE_KEY]!;
}

function parseSecurityLevel(value: string | undefined): ProviderSecretSecurityLevel {
  return value === 'system_protected' || value === 'degraded' || value === 'test'
    ? value
    : 'unavailable';
}

function decodeKey(encoded: string | undefined): Buffer | null {
  if (!encoded) return null;
  try {
    const key = Buffer.from(encoded, 'base64');
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

/**
 * Move the packaged-child data key out of process.env during Next bootstrap.
 * All later Agent/tool subprocesses inherit an environment with no DEK.
 */
export function consumeProviderSecretEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): ProviderSecretEnvironmentStatus {
  const state = runtimeState();
  if (state.consumed) {
    delete env[PROVIDER_SECRET_KEY_ENV];
    delete env[PROVIDER_SECRET_BACKEND_ENV];
    delete env[PROVIDER_SECRET_LEVEL_ENV];
    return {
      available: state.key !== null,
      backend: state.backend,
      securityLevel: state.securityLevel,
    };
  }
  state.key = decodeKey(env[PROVIDER_SECRET_KEY_ENV]);
  state.backend = env[PROVIDER_SECRET_BACKEND_ENV] || 'none';
  state.securityLevel = state.key
    ? parseSecurityLevel(env[PROVIDER_SECRET_LEVEL_ENV])
    : 'unavailable';
  state.consumed = true;

  delete env[PROVIDER_SECRET_KEY_ENV];
  delete env[PROVIDER_SECRET_BACKEND_ENV];
  delete env[PROVIDER_SECRET_LEVEL_ENV];

  return {
    available: state.key !== null,
    backend: state.backend,
    securityLevel: state.securityLevel,
  };
}

function getKey(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const state = runtimeState();
  if (env === process.env && state.consumed) return state.key;
  return decodeKey(env[PROVIDER_SECRET_KEY_ENV]);
}

function aadForProvider(providerId: string): Buffer {
  return Buffer.from(`codepilot:provider:${providerId}:api_key:v1`, 'utf8');
}

export function getProviderSecretEnvironmentStatus(
  env: NodeJS.ProcessEnv = process.env,
): ProviderSecretEnvironmentStatus {
  const key = getKey(env);
  const state = runtimeState();
  const consumed = env === process.env && state.consumed;
  const securityLevel = consumed
    ? state.securityLevel
    : parseSecurityLevel(env[PROVIDER_SECRET_LEVEL_ENV]);
  return {
    available: key !== null,
    backend: consumed ? state.backend : env[PROVIDER_SECRET_BACKEND_ENV] || 'none',
    securityLevel: key ? securityLevel : 'unavailable',
  };
}

export function encryptProviderSecret(
  providerId: string,
  plaintext: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const key = getKey(env);
  if (!key) throw new Error('provider_secret_key_unavailable');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aadForProvider(providerId));
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    CIPHERTEXT_PREFIX,
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join(':');
}

export function decryptProviderSecret(
  providerId: string,
  ciphertext: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const key = getKey(env);
  if (!key) throw new Error('provider_secret_key_unavailable');
  const parts = ciphertext.split(':');
  if (parts.length !== 5 || `${parts[0]}:${parts[1]}` !== CIPHERTEXT_PREFIX) {
    throw new Error('provider_secret_ciphertext_invalid');
  }
  const iv = Buffer.from(parts[2], 'base64url');
  const tag = Buffer.from(parts[3], 'base64url');
  const encrypted = Buffer.from(parts[4], 'base64url');
  if (iv.length !== 12 || tag.length !== 16) throw new Error('provider_secret_ciphertext_invalid');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(aadForProvider(providerId));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

export function providerSecretStorageKind(env: NodeJS.ProcessEnv = process.env): string {
  const status = getProviderSecretEnvironmentStatus(env);
  return status.available ? `safe_storage:${status.backend}` : 'legacy_plaintext';
}
