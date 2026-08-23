/**
 * Unit tests for WeChat media encryption/decryption.
 *
 * Run with: npx tsx src/__tests__/unit/weixin-media.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { encryptMedia, decryptMedia, generateMediaKey, aesEcbPaddedSize } from '../../lib/bridge/adapters/weixin/weixin-media';

describe('AES-128-ECB encrypt/decrypt', () => {
  it('round-trips correctly', () => {
    const key = generateMediaKey();
    const plaintext = Buffer.from('Hello, WeChat media encryption!');
    const encrypted = encryptMedia(plaintext, key);
    const decrypted = decryptMedia(encrypted, key);
    assert.equal(decrypted.toString(), plaintext.toString());
  });

  it('round-trips with various sizes', () => {
    const key = generateMediaKey();

    // Exactly 16 bytes (one block)
    const data16 = Buffer.alloc(16, 0x42);
    assert.deepEqual(decryptMedia(encryptMedia(data16, key), key), data16);

    // 15 bytes (less than one block)
    const data15 = Buffer.alloc(15, 0x43);
    assert.deepEqual(decryptMedia(encryptMedia(data15, key), key), data15);

    // 17 bytes (just over one block)
    const data17 = Buffer.alloc(17, 0x44);
    assert.deepEqual(decryptMedia(encryptMedia(data17, key), key), data17);

    // Large data
    const dataLarge = Buffer.alloc(1024, 0x45);
    assert.deepEqual(decryptMedia(encryptMedia(dataLarge, key), key), dataLarge);

    // Empty data should still work with PKCS7
    const dataEmpty = Buffer.alloc(0);
    assert.deepEqual(decryptMedia(encryptMedia(dataEmpty, key), key), dataEmpty);
  });

  it('produces correct ciphertext size', () => {
    const key = generateMediaKey();
    const data = Buffer.alloc(100, 0x46);
    const encrypted = encryptMedia(data, key);
    // AES-128-ECB with PKCS7: ceil((100+1)/16) * 16 = 112
    assert.equal(encrypted.length, 112);
  });
});

describe('generateMediaKey', () => {
  it('generates 16-byte key', () => {
    const key = generateMediaKey();
    assert.equal(key.length, 16);
  });

  it('generates unique keys', () => {
    const key1 = generateMediaKey();
    const key2 = generateMediaKey();
    assert.equal(key1.equals(key2), false);
  });
});

describe('aesEcbPaddedSize', () => {
  it('computes correct padded sizes', () => {
    assert.equal(aesEcbPaddedSize(0), 16);
    assert.equal(aesEcbPaddedSize(1), 16);
    assert.equal(aesEcbPaddedSize(15), 16);
    assert.equal(aesEcbPaddedSize(16), 32);
    assert.equal(aesEcbPaddedSize(17), 32);
    assert.equal(aesEcbPaddedSize(31), 32);
    assert.equal(aesEcbPaddedSize(32), 48);
    assert.equal(aesEcbPaddedSize(100), 112);
  });
});
