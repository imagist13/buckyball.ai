import type { SecretRef } from './contracts';
import { assertSecretRef, formatSecretRef } from './secret-ref';

export type SecretResolution =
  | {
      readonly status: 'resolved';
      readonly value: string;
    }
  | {
      readonly status: 'unresolved' | 'unavailable';
      readonly reason: string;
      readonly reauthorizationRequired: boolean;
    };

export interface SecretMetadata {
  readonly ref: SecretRef;
  readonly portableRef: string;
  readonly status: Exclude<SecretResolution['status'], 'resolved'> | 'available';
  readonly mutable: boolean;
  readonly reason?: string;
}

export interface SecretStoreBackend {
  readonly namespace: string;
  readonly mutable: boolean;
  resolve(ref: SecretRef): SecretResolution;
  set?(ref: SecretRef, value: string): void;
  delete?(ref: SecretRef): void;
}

export interface SecretStore {
  get(ref: SecretRef): SecretMetadata;
  resolve(ref: SecretRef): SecretResolution;
  set(ref: SecretRef, value: string): void;
  delete(ref: SecretRef): void;
}

export class CompositeSecretStore implements SecretStore {
  readonly #backends = new Map<string, SecretStoreBackend>();

  constructor(backends: readonly SecretStoreBackend[]) {
    for (const backend of backends) {
      if (this.#backends.has(backend.namespace)) {
        throw new Error(`Secret backend "${backend.namespace}" is registered twice.`);
      }
      this.#backends.set(backend.namespace, backend);
    }
  }

  #backend(ref: SecretRef): SecretStoreBackend {
    assertSecretRef(ref);
    const backend = this.#backends.get(ref.namespace);
    if (!backend) {
      throw new Error(`Secret namespace "${ref.namespace}" is not registered.`);
    }
    return backend;
  }

  get(ref: SecretRef): SecretMetadata {
    const backend = this.#backend(ref);
    const resolution = backend.resolve(ref);
    return {
      ref,
      portableRef: formatSecretRef(ref),
      status: resolution.status === 'resolved' ? 'available' : resolution.status,
      mutable: backend.mutable,
      ...(resolution.status === 'resolved' ? {} : { reason: resolution.reason }),
    };
  }

  resolve(ref: SecretRef): SecretResolution {
    return this.#backend(ref).resolve(ref);
  }

  set(ref: SecretRef, value: string): void {
    const backend = this.#backend(ref);
    if (!backend.mutable || !backend.set) {
      throw new Error(`Secret namespace "${ref.namespace}" is read-only.`);
    }
    if (!value) throw new Error('Secret value must not be empty.');
    backend.set(ref, value);
  }

  delete(ref: SecretRef): void {
    const backend = this.#backend(ref);
    if (!backend.mutable || !backend.delete) {
      throw new Error(`Secret namespace "${ref.namespace}" is read-only.`);
    }
    backend.delete(ref);
  }
}

export function createKeyValueSecretBackend(input: {
  readonly namespace: string;
  readonly read: (key: string) => string | undefined;
  readonly write?: (key: string, value: string) => void;
  readonly remove?: (key: string) => void;
}): SecretStoreBackend {
  const mutable = !!input.write && !!input.remove;
  return {
    namespace: input.namespace,
    mutable,
    resolve(ref) {
      const value = input.read(ref.key);
      return value
        ? { status: 'resolved', value }
        : {
          status: 'unresolved',
          reason: `No credential is connected for ${formatSecretRef(ref)}.`,
          reauthorizationRequired: true,
        };
    },
    ...(mutable
      ? {
        set(ref: SecretRef, value: string) {
          input.write!(ref.key, value);
        },
        delete(ref: SecretRef) {
          input.remove!(ref.key);
        },
      }
      : {}),
  };
}

export function createEnvironmentSecretBackend(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): SecretStoreBackend {
  return {
    namespace: 'environment',
    mutable: false,
    resolve(ref) {
      const value = environment[ref.key];
      return value
        ? { status: 'resolved', value }
        : {
          status: 'unresolved',
          reason: `Environment variable ${ref.key} is not set on this machine.`,
          reauthorizationRequired: true,
        };
    },
  };
}

export function createExternalOwnedSecretBackend(): SecretStoreBackend {
  return {
    namespace: 'external-owned',
    mutable: false,
    resolve(ref) {
      return {
        status: 'unavailable',
        reason:
          `Credential ${formatSecretRef(ref)} is owned by an external Harness. `
          + 'Reconnect through that Harness; the host application will not read its auth files.',
        reauthorizationRequired: true,
      };
    },
  };
}
