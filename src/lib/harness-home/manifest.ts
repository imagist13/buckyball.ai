import {
  HARNESS_HOME_SCHEMA_VERSION,
  type HarnessHomeManifest,
  type PortableContentRef,
  type RuntimeOverlayRecord,
} from './contracts';
import { assertSecretRef } from './secret-ref';
import { assertNoSecretMaterial } from './validation';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requireRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function requireArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function validateContentRef(value: unknown, label: string): void {
  const ref = requireRecord(value, label) as Partial<PortableContentRef>;
  requireString(ref.id, `${label}.id`);
  const refPath = requireString(ref.path, `${label}.path`);
  if (refPath.startsWith('/') || refPath.split(/[\\/]/).includes('..')) {
    throw new Error(`${label}.path must be a repository-relative safe path.`);
  }
  requireString(ref.contentHash, `${label}.contentHash`);
}

function validateContentRefArray(value: unknown, label: string): void {
  requireArray(value, label).forEach((ref, index) =>
    validateContentRef(ref, `${label}[${index}]`));
}

function validateOverlay(
  key: string,
  value: unknown,
  label: string,
): void {
  const overlay = requireRecord(value, label) as Partial<RuntimeOverlayRecord>;
  const runtimeId = requireString(overlay.runtimeId, `${label}.runtimeId`);
  if (runtimeId !== key) {
    throw new Error(`${label}.runtimeId must match its opaque map key.`);
  }
  validateContentRefArray(overlay.definitionRefs, `${label}.definitionRefs`);
  validateContentRefArray(overlay.stateRefs, `${label}.stateRefs`);
}

/**
 * Validates the known schema in place and returns a JSON clone. Unknown
 * top-level, index and Runtime-overlay fields are deliberately preserved.
 */
export function parseHarnessHomeManifest(input: unknown): HarnessHomeManifest {
  const manifest = requireRecord(input, 'manifest');
  if (manifest.schemaVersion !== HARNESS_HOME_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported Harness Home schema version: ${String(manifest.schemaVersion)}`,
    );
  }
  requireString(manifest.harnessId, 'manifest.harnessId');
  if (!Number.isSafeInteger(manifest.generation) || Number(manifest.generation) < 0) {
    throw new Error('manifest.generation must be a non-negative integer.');
  }
  const writtenAt = requireString(manifest.writtenAt, 'manifest.writtenAt');
  if (!Number.isFinite(Date.parse(writtenAt))) {
    throw new Error('manifest.writtenAt must be an ISO-compatible timestamp.');
  }

  const definition = requireRecord(manifest.definition, 'manifest.definition');
  for (const key of [
    'identityRefs',
    'ruleRefs',
    'skillRefs',
    'mcpRefs',
    'creativeMethodRefs',
  ]) {
    validateContentRefArray(definition[key], `manifest.definition.${key}`);
  }

  const state = requireRecord(manifest.state, 'manifest.state');
  for (const key of ['memoryRefs', 'preferenceRefs', 'feedbackRefs']) {
    validateContentRefArray(state[key], `manifest.state.${key}`);
  }

  requireArray(manifest.assetRefs, 'manifest.assetRefs');
  const overlays = requireRecord(
    manifest.runtimeOverlays,
    'manifest.runtimeOverlays',
  );
  for (const [runtimeId, overlay] of Object.entries(overlays)) {
    validateOverlay(runtimeId, overlay, `manifest.runtimeOverlays.${runtimeId}`);
  }
  requireArray(manifest.secretRefs, 'manifest.secretRefs')
    .forEach(assertSecretRef);

  assertNoSecretMaterial(manifest, 'Harness Home manifest');

  return JSON.parse(JSON.stringify(manifest)) as HarnessHomeManifest;
}

export function serializeHarnessHomeManifest(
  manifest: HarnessHomeManifest,
): string {
  const validated = parseHarnessHomeManifest(manifest);
  return `${JSON.stringify(validated, null, 2)}\n`;
}
