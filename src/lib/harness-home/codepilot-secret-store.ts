import {
  getProvider,
  getSetting,
  setSetting,
  updateProvider,
} from '@/lib/db';
import {
  CompositeSecretStore,
  createEnvironmentSecretBackend,
  createExternalOwnedSecretBackend,
  createKeyValueSecretBackend,
} from './secret-store';

/**
 * Compatibility facade over v0.62 credential stores. It deliberately does
 * not migrate values or read external framework auth files.
 */
export function createCodePilotSecretStore(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): CompositeSecretStore {
  return new CompositeSecretStore([
    createKeyValueSecretBackend({
      namespace: 'codepilot-setting',
      read: getSetting,
      write: setSetting,
      remove: (key) => setSetting(key, ''),
    }),
    createKeyValueSecretBackend({
      namespace: 'codepilot-provider',
      read: (providerId) => getProvider(providerId)?.api_key || undefined,
      write: (providerId, value) => {
        if (!getProvider(providerId)) {
          throw new Error(`Provider "${providerId}" does not exist.`);
        }
        updateProvider(providerId, { api_key: value });
      },
      remove: (providerId) => {
        if (!getProvider(providerId)) return;
        updateProvider(providerId, { api_key: '' });
      },
    }),
    createEnvironmentSecretBackend(environment),
    createExternalOwnedSecretBackend(),
  ]);
}
