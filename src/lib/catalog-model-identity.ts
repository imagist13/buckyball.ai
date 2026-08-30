import type { ModelEnableSource, ProviderModelSource } from '@/types';

export interface CatalogModelLegacyFingerprint {
  upstreamModelId: string;
  displayName: string;
  capabilities: Record<string, unknown>;
}

export interface CatalogIdentityModel {
  modelId: string;
  upstreamModelId?: string;
  displayName: string;
  legacyFingerprints?: CatalogModelLegacyFingerprint[];
}

export interface LocalCatalogIdentityRow {
  model_id: string;
  upstream_model_id: string;
  display_name: string;
  capabilities_json: string | null;
  enabled: number;
  source: ProviderModelSource;
  user_edited: number;
  enable_source: ModelEnableSource;
}

export type CatalogModelPresenceState =
  | 'current_enabled'
  | 'current_hidden'
  | 'legacy_upgrade_available'
  | 'identity_conflict'
  | 'missing';

export interface CatalogModelPresence {
  state: CatalogModelPresenceState;
  existingModelId?: string;
  conflictModelIds?: string[];
}

function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, normalizeJson(child)]),
  );
}

function parseCapabilities(value: string | null): unknown {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return null;
  }
}

function capabilitiesMatch(
  row: LocalCatalogIdentityRow,
  fingerprint: CatalogModelLegacyFingerprint,
): boolean {
  const actual = parseCapabilities(row.capabilities_json);
  if (actual === null) return false;
  return JSON.stringify(normalizeJson(actual)) === JSON.stringify(normalizeJson(fingerprint.capabilities));
}

/**
 * A legacy catalog row is upgradable only when its complete shipped identity
 * is known and no user-ownership signal is present. In particular, `source`
 * is not authoritative for old databases: the source-column migration had to
 * backfill pre-existing rows as `manual` even when they came from a catalog.
 */
export function isLegacyCatalogModelRow(
  row: LocalCatalogIdentityRow,
  model: CatalogIdentityModel,
): boolean {
  if (row.model_id !== model.modelId) return false;
  if (row.user_edited !== 0) return false;
  if (row.enable_source === 'manual_enabled' || row.enable_source === 'manual_hidden') return false;
  return (model.legacyFingerprints ?? []).some(fingerprint =>
    row.upstream_model_id === fingerprint.upstreamModelId
    && row.display_name === fingerprint.displayName
    && capabilitiesMatch(row, fingerprint),
  );
}

/**
 * Keep stable DB identity and current vendor SKU identity separate. A stable
 * alias occupied by an old wire is not "already added"; it is either a
 * provable legacy upgrade or an ownership conflict that needs confirmation.
 */
export function classifyCatalogModelPresence(
  rows: LocalCatalogIdentityRow[],
  model: CatalogIdentityModel,
): CatalogModelPresence {
  const upstreamModelId = model.upstreamModelId || model.modelId;
  const identityRows = rows.filter(row =>
    row.model_id === model.modelId
    || row.model_id === upstreamModelId
    || row.upstream_model_id === upstreamModelId,
  );
  if (identityRows.length === 0) return { state: 'missing' };

  const currentRows = identityRows.filter(row => row.upstream_model_id === upstreamModelId);
  const canonicalCurrentRows = currentRows.filter(row => row.model_id === model.modelId);
  const enabledCurrentRows = currentRows.filter(row => row.enabled === 1);
  // A usable canonical row stays usable even if an older/direct duplicate is
  // also present. The extra row remains visible in Settings > Models for
  // manual cleanup, but must not turn the current SKU into a dead-end badge.
  const canonicalCurrent = canonicalCurrentRows.length === 1 ? canonicalCurrentRows[0] : null;
  const authoritativeCurrent = canonicalCurrent?.enabled === 1
    ? canonicalCurrent
    : enabledCurrentRows.length === 1
      ? enabledCurrentRows[0]
      : canonicalCurrent && enabledCurrentRows.length === 0
        ? canonicalCurrent
        : currentRows.length === 1
          ? currentRows[0]
          : null;
  if (authoritativeCurrent) {
    return {
      state: authoritativeCurrent.enabled === 1 ? 'current_enabled' : 'current_hidden',
      existingModelId: authoritativeCurrent.model_id,
    };
  }

  if (identityRows.length === 1 && isLegacyCatalogModelRow(identityRows[0], model)) {
    return {
      state: 'legacy_upgrade_available',
      existingModelId: identityRows[0].model_id,
    };
  }

  return {
    state: 'identity_conflict',
    conflictModelIds: [...new Set(identityRows.map(row => row.model_id))],
  };
}
