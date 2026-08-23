import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('Electron protects the provider data key with safeStorage and passes it only to the packaged child', () => {
  const keyManager = fs.readFileSync(path.join(repoRoot, 'electron/provider-secret-key.ts'), 'utf8');
  const main = fs.readFileSync(path.join(repoRoot, 'electron/main.ts'), 'utf8');
  const startupPolicy = fs.readFileSync(
    path.join(repoRoot, 'electron/provider-secret-startup-policy.ts'),
    'utf8',
  );
  const recoverySmoke = fs.readFileSync(
    path.join(repoRoot, 'scripts/smoke-packaged-server-recovery.mjs'),
    'utf8',
  );
  const preload = fs.readFileSync(path.join(repoRoot, 'electron/preload.ts'), 'utf8');
  const instrumentation = fs.readFileSync(path.join(repoRoot, 'src/instrumentation.ts'), 'utf8');

  assert.match(keyManager, /safeStorage\.isEncryptionAvailable\(\)/);
  assert.match(keyManager, /safeStorage\.encryptString\(encodedKey\)/);
  assert.match(keyManager, /safeStorage\.decryptString/);
  assert.match(keyManager, /wrappedKey:/);
  assert.doesNotMatch(keyManager, /JSON\.stringify\(\{[^}]*encodedKey/);

  assert.match(main, /initializeProviderSecretEnvironment\(app\.getPath\('userData'\)\)/);
  assert.match(
    main,
    /if \(macosKeychainProbe\.status === 'unavailable'\)[\s\S]*?safeStorage skipped[\s\S]*?else \{[\s\S]*?initializeProviderSecretEnvironment/,
    'a confirmed-missing macOS keychain must bypass safeStorage before it can show a modal',
  );
  assert.match(main, /buildMacosKeychainEnvironment\(/);
  assert.match(main, /shouldSkipProviderSecretForIsolatedSmoke\(/);
  assert.match(main, /key !== PROVIDER_SECRET_ISOLATED_SMOKE_ENV/);
  assert.match(startupPolicy, /codepilot-packaged-recovery-/);
  assert.match(recoverySmoke, /CODEPILOT_PROVIDER_SECRET_ISOLATED_SMOKE:\s*'1'/);
  assert.match(main, /overrides:\s*\{[\s\S]*?\.\.\.providerSecretEnvironment/);
  assert.doesNotMatch(preload, /PROVIDER_SECRET_KEY|providerSecretEnvironment/);
  assert.match(instrumentation, /consumeProviderSecretEnvironment\(\)/);
  assert.match(keyManager, /PROVIDER_SECRET_KEY_ENV/);
});
