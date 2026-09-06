import type { SecretRef } from './contracts';

const SECRET_SCHEME = 'secret:';

export function formatSecretRef(ref: SecretRef): string {
  assertSecretRef(ref);
  const url = new URL(`${SECRET_SCHEME}//${encodeURIComponent(ref.namespace)}`);
  url.pathname = `/${encodeURIComponent(ref.key)}`;
  url.searchParams.set('scope', ref.scope);
  url.searchParams.set('v', String(ref.version));
  return url.toString();
}

export function parseSecretRef(value: string): SecretRef {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('SecretRef must be a valid secret:// URI.');
  }
  if (url.protocol !== SECRET_SCHEME) {
    throw new Error('SecretRef must use the secret:// scheme.');
  }
  const namespace = decodeURIComponent(url.hostname);
  const key = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const scope = url.searchParams.get('scope') ?? '';
  const version = Number(url.searchParams.get('v'));
  const ref: SecretRef = {
    scheme: 'secret',
    namespace,
    key,
    scope,
    version,
  };
  assertSecretRef(ref);
  return ref;
}

export function isSecretRef(value: unknown): value is SecretRef {
  try {
    assertSecretRef(value);
    return true;
  } catch {
    return false;
  }
}

export function assertSecretRef(value: unknown): asserts value is SecretRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('SecretRef must be an object.');
  }
  const candidate = value as Partial<SecretRef>;
  if (
    candidate.scheme !== 'secret'
    || typeof candidate.namespace !== 'string'
    || !candidate.namespace.trim()
    || typeof candidate.key !== 'string'
    || !candidate.key.trim()
    || typeof candidate.scope !== 'string'
    || !candidate.scope.trim()
    || !Number.isSafeInteger(candidate.version)
    || (candidate.version ?? 0) < 1
  ) {
    throw new Error('SecretRef is incomplete or invalid.');
  }
}
