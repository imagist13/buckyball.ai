import type {
  AssetRef,
  CanonicalCapabilityRef,
  CreativeMethodDefinition,
  HarnessScope,
  PortableContentRef,
  RuntimeProjection,
  TasteMemoryClass,
  TasteMemoryEvidence,
} from './contracts';
import { assertCompleteProvenance } from './provenance';
import { isSecretRef } from './secret-ref';

const SECRET_KEY_PATTERN =
  /^(api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password|client[_-]?secret|private[_-]?key)$/i;

const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:sk|ghp|gh_pat|xai)-[A-Za-z0-9_-]{12,}\b/i,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
  /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/i,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /\b(?:token|secret|api[_-]?key)\s*[:=]\s*["']?[a-f0-9]{32,}\b/i,
];

const TASTE_MEMORY_CLASSES = new Set<TasteMemoryClass>([
  'one_off',
  'project_preference',
  'durable_user_preference',
  'builtin_principle',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requireNonEmptyString(value: unknown, label: string): void {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string.`);
  }
}

export function validateHarnessScope(
  value: unknown,
  label = 'Harness scope',
): asserts value is HarnessScope {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    throw new Error(`${label} must be a valid Harness scope object.`);
  }
  switch (value.kind) {
    case 'builtin':
      return;
    case 'user':
      if (value.userId !== undefined) {
        requireNonEmptyString(value.userId, `${label}.userId`);
      }
      return;
    case 'assistant':
      requireNonEmptyString(value.assistantId, `${label}.assistantId`);
      return;
    case 'project':
      requireNonEmptyString(value.projectId, `${label}.projectId`);
      if (value.rootRef !== undefined) {
        requireNonEmptyString(value.rootRef, `${label}.rootRef`);
      }
      return;
    case 'runtime_overlay':
      requireNonEmptyString(value.runtimeId, `${label}.runtimeId`);
      if (!isRecord(value.base) || value.base.kind === 'runtime_overlay') {
        throw new Error(`${label}.base must be a non-overlay Harness scope.`);
      }
      validateHarnessScope(value.base, `${label}.base`);
      return;
    default:
      throw new Error(`${label}.kind "${value.kind}" is not supported.`);
  }
}

export function validateTasteMemoryClass(
  value: unknown,
): asserts value is TasteMemoryClass {
  if (
    typeof value !== 'string'
    || !TASTE_MEMORY_CLASSES.has(value as TasteMemoryClass)
  ) {
    throw new Error('Taste Memory classification is not supported.');
  }
}

export interface SecretLeak {
  readonly path: string;
  readonly reason: string;
}

export function findSecretLeaks(
  value: unknown,
  currentPath = '$',
): readonly SecretLeak[] {
  if (isSecretRef(value)) return [];

  if (typeof value === 'string') {
    return SECRET_VALUE_PATTERNS
      .filter((pattern) => pattern.test(value))
      .map((pattern) => ({
        path: currentPath,
        reason: `value matches forbidden secret pattern ${pattern.source}`,
      }));
  }
  if (!value || typeof value !== 'object') return [];

  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      findSecretLeaks(entry, `${currentPath}[${index}]`));
  }

  const leaks: SecretLeak[] = [];
  for (const [key, entry] of Object.entries(value)) {
    const entryPath = `${currentPath}.${key}`;
    if (
      SECRET_KEY_PATTERN.test(key)
      && typeof entry === 'string'
      && entry.trim()
    ) {
      leaks.push({
        path: entryPath,
        reason: `field "${key}" contains inline secret material`,
      });
      continue;
    }
    leaks.push(...findSecretLeaks(entry, entryPath));
  }
  return leaks;
}

export function assertNoSecretMaterial(value: unknown, label = 'value'): void {
  const leaks = findSecretLeaks(value);
  if (leaks.length > 0) {
    const summary = leaks
      .slice(0, 3)
      .map((leak) => `${leak.path}: ${leak.reason}`)
      .join('; ');
    throw new Error(`${label} contains forbidden secret material: ${summary}`);
  }
}

export function validateCanonicalCapability(
  capability: CanonicalCapabilityRef,
): void {
  if (!capability.id.trim()) {
    throw new Error('Canonical capability id must not be empty.');
  }
  if (
    capability.maturity === 'stable'
    && capability.referenceStatus !== 'executable'
  ) {
    throw new Error(
      `Stable capability "${capability.id}" must be executable in the reference Runtime.`,
    );
  }
  if (
    capability.maturity === 'draft'
    && capability.referenceStatus === 'rejected'
    && !capability.reason
  ) {
    throw new Error(`Rejected capability "${capability.id}" requires a reason.`);
  }
}

export function validateRuntimeProjection(projection: RuntimeProjection): void {
  if (!projection.runtimeId.trim()) {
    throw new Error('Runtime projection requires an opaque runtimeId.');
  }
  projection.executableCapabilities.forEach(validateCanonicalCapability);
  projection.perceptibleOnlyCapabilities.forEach((capability) => {
    validateCanonicalCapability(capability);
    if (
      capability.maturity === 'stable'
      && capability.referenceStatus === 'executable'
    ) {
      throw new Error(
        `Executable stable capability "${capability.id}" cannot be marked perceptible-only.`,
      );
    }
  });
  for (const fragment of projection.contextFragments) {
    assertCompleteProvenance(fragment.provenance, `fragment ${fragment.id}`);
  }
}

export function validateCreativeMethod(method: CreativeMethodDefinition): void {
  validateHarnessScope(method.scope, `Creative Method ${method.id || '(unknown)'} scope`);
  if (
    !method.id.trim()
    || !method.version.trim()
    || !method.title.trim()
    || !method.summary.trim()
    || method.steps.length === 0
  ) {
    throw new Error(
      'Creative Method requires id, version, title, summary and at least one step.',
    );
  }
  if (method.critiqueCriteria.length === 0) {
    throw new Error(`Creative Method "${method.id}" requires critique criteria.`);
  }
  const validateActivationPhrases = (
    value: readonly string[],
    label: 'trigger' | 'non-trigger',
    required: boolean,
  ): void => {
    if (!Array.isArray(value) || (required && value.length === 0)) {
      throw new Error(
        `Creative Method "${method.id}" requires at least one ${label}.`,
      );
    }
    for (const phrase of value) {
      if (
        typeof phrase !== 'string'
        || !phrase.trim()
        || phrase.length > 240
        || /[\u0000-\u001f\u007f-\u009f]/u.test(phrase)
      ) {
        throw new Error(
          `Creative Method "${method.id}" ${label}s must be 1-240 `
          + 'characters without control characters.',
        );
      }
    }
  };
  validateActivationPhrases(method.triggers, 'trigger', true);
  validateActivationPhrases(method.nonTriggers, 'non-trigger', false);
  if (method.changelog.length === 0) {
    throw new Error(`Creative Method "${method.id}" requires a changelog.`);
  }
  if (
    method.status === 'confirmed'
    && (!method.confirmedAt || !method.confirmationEvidenceRef)
  ) {
    throw new Error(
      `Confirmed Creative Method "${method.id}" requires a confirmation `
      + 'timestamp and evidence reference.',
    );
  }
  if (
    method.confirmedAt
    && !Number.isFinite(Date.parse(method.confirmedAt))
  ) {
    throw new Error(`Creative Method "${method.id}" has an invalid confirmedAt.`);
  }
  for (const entry of method.changelog) {
    if (
      !entry.version.trim()
      || !entry.summary.trim()
      || !Number.isFinite(Date.parse(entry.changedAt))
    ) {
      throw new Error(
        `Creative Method "${method.id}" has an invalid changelog entry.`,
      );
    }
  }
  validateEvidenceRef(
    method.progressiveDisclosureRef,
    `method ${method.id} progressive disclosure`,
  );
  if (method.confirmationEvidenceRef) {
    validateEvidenceRef(
      method.confirmationEvidenceRef,
      `method ${method.id} confirmation`,
    );
  }
  assertCompleteProvenance(method.source, `method ${method.id}`);
}

function isPortableContentRef(
  value: PortableContentRef | AssetRef,
): value is PortableContentRef {
  return 'path' in value;
}

function validateEvidenceRef(
  ref: PortableContentRef | AssetRef,
  label: string,
): void {
  if (isPortableContentRef(ref)) {
    if (!ref.id.trim() || !ref.path.trim() || !ref.contentHash.trim()) {
      throw new Error(`${label} must identify portable content.`);
    }
    return;
  }
  if (!ref.assetId.trim()) {
    throw new Error(`${label} must identify an Asset.`);
  }
}

export function validateTasteMemoryEvidence(
  evidence: TasteMemoryEvidence,
): void {
  validateTasteMemoryClass(evidence.classification);
  validateHarnessScope(evidence.scope, `Taste Memory ${evidence.id || '(unknown)'} scope`);
  if (!evidence.id.trim() || !evidence.preferenceKey.trim()) {
    throw new Error('Taste Memory requires id and preferenceKey.');
  }
  if (!evidence.statement.trim()) {
    throw new Error('Taste Memory statement must not be empty.');
  }
  if (evidence.confidence < 0 || evidence.confidence > 1) {
    throw new Error('Taste Memory confidence must be between 0 and 1.');
  }
  validateEvidenceRef(evidence.evidenceRef, `Taste Memory ${evidence.id}`);
  for (const [field, value] of [
    ['createdAt', evidence.createdAt],
    ['updatedAt', evidence.updatedAt],
    ['lastConfirmedAt', evidence.lastConfirmedAt],
    ['revokedAt', evidence.revokedAt],
  ] as const) {
    if (value && !Number.isFinite(Date.parse(value))) {
      throw new Error(`Taste Memory ${field} must be an ISO-compatible timestamp.`);
    }
  }
  if (
    evidence.classification === 'durable_user_preference'
    && !evidence.lastConfirmedAt
  ) {
    throw new Error(
      'Durable user preference requires an explicit confirmation timestamp.',
    );
  }
  if (
    evidence.classification === 'builtin_principle'
    && !evidence.lastConfirmedAt
  ) {
    throw new Error(
      'Built-in principle requires an explicit confirmation timestamp.',
    );
  }
  if (evidence.revokedAt && !evidence.revokeReason?.trim()) {
    throw new Error('Revoked Taste Memory requires a reason.');
  }
}
