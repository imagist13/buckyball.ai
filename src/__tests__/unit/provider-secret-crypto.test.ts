import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  consumeProviderSecretEnvironment,
  decryptProviderSecret,
  encryptProviderSecret,
  getProviderSecretEnvironmentStatus,
  PROVIDER_SECRET_BACKEND_ENV,
  PROVIDER_SECRET_KEY_ENV,
  PROVIDER_SECRET_LEVEL_ENV,
} from '../../lib/provider-secret-crypto';

function testEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    [PROVIDER_SECRET_KEY_ENV]: Buffer.alloc(32, 0x5a).toString('base64'),
    [PROVIDER_SECRET_BACKEND_ENV]: 'test',
    [PROVIDER_SECRET_LEVEL_ENV]: 'test',
  };
}

describe('provider secret envelope encryption', () => {
  it('round-trips Unicode credentials without embedding plaintext', () => {
    const plaintext = '密钥 with spaces & symbols/+/=';
    const ciphertext = encryptProviderSecret('provider-中文', plaintext, testEnv());

    assert.match(ciphertext, /^cpsec:v1:/);
    assert.doesNotMatch(ciphertext, /密钥|spaces/);
    assert.equal(decryptProviderSecret('provider-中文', ciphertext, testEnv()), plaintext);
  });

  it('uses a random nonce for every encryption', () => {
    const first = encryptProviderSecret('provider-a', 'same-secret', testEnv());
    const second = encryptProviderSecret('provider-a', 'same-secret', testEnv());
    assert.notEqual(first, second);
  });

  it('authenticates provider identity and ciphertext integrity', () => {
    const ciphertext = encryptProviderSecret('provider-a', 'secret', testEnv());
    assert.throws(() => decryptProviderSecret('provider-b', ciphertext, testEnv()));
    const tampered = `${ciphertext.slice(0, -1)}${ciphertext.endsWith('A') ? 'B' : 'A'}`;
    assert.throws(() => decryptProviderSecret('provider-a', tampered, testEnv()));
  });

  it('reports unavailable for missing or malformed data keys', () => {
    assert.equal(getProviderSecretEnvironmentStatus({ NODE_ENV: 'test' }).available, false);
    assert.equal(getProviderSecretEnvironmentStatus({
      NODE_ENV: 'test',
      [PROVIDER_SECRET_KEY_ENV]: Buffer.alloc(8).toString('base64'),
    }).available, false);
    assert.throws(() => encryptProviderSecret('provider-a', 'secret', { NODE_ENV: 'test' }), /key_unavailable/);
  });

  it('consumes the bootstrap key and removes every internal env variable', () => {
    const env = testEnv();
    const status = consumeProviderSecretEnvironment(env);
    assert.deepEqual(status, { available: true, backend: 'test', securityLevel: 'test' });
    assert.equal(env[PROVIDER_SECRET_KEY_ENV], undefined);
    assert.equal(env[PROVIDER_SECRET_BACKEND_ENV], undefined);
    assert.equal(env[PROVIDER_SECRET_LEVEL_ENV], undefined);
  });
});
