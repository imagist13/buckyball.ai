import {
  normalizePermissionProfile,
  type SessionPermissionProfile,
} from '@/lib/permission/profile';

/**
 * User-facing access levels shown in the consolidated composer footer.
 *
 * `read_only` deliberately remains a mode on the persisted wire. It is not a
 * cosmetic preset: every Runtime already gives `mode=plan` stricter semantics
 * than any permission profile, so the adapter must preserve that precedence.
 */
export const COMPOSER_ACCESS_LEVELS = [
  'read_only',
  'default',
  'auto_review',
  'full_access',
] as const;

export type ComposerAccessLevel = (typeof COMPOSER_ACCESS_LEVELS)[number];

export interface DecodedComposerAccessLevel {
  level: ComposerAccessLevel;
  /** Persisted `ask` is legacy main-chat state. Display it conservatively but
   * never rewrite it merely because the composer mounted. */
  legacyAsk: boolean;
  /** Invalid persisted values fail closed and remain diagnosable. */
  degraded: boolean;
  source: 'plan-mode' | 'code-profile' | 'legacy-ask' | 'invalid-mode';
}

export interface EncodedComposerAccessLevel {
  mode: 'code' | 'plan';
  permissionProfile: SessionPermissionProfile;
}

export interface ComposerAccessCapability {
  /** Undefined means the probe has not produced a trustworthy answer yet. */
  autoReviewSupported?: boolean;
}

export function decodeComposerAccessLevel(
  mode: unknown,
  profile: unknown,
  capability: ComposerAccessCapability = {},
): DecodedComposerAccessLevel {
  if (mode === 'plan') {
    return {
      level: 'read_only',
      legacyAsk: false,
      degraded: false,
      source: 'plan-mode',
    };
  }

  if (mode === 'ask') {
    return {
      level: 'default',
      legacyAsk: true,
      degraded: false,
      source: 'legacy-ask',
    };
  }

  if (mode !== undefined && mode !== null && mode !== '' && mode !== 'code') {
    return {
      level: 'default',
      legacyAsk: false,
      degraded: true,
      source: 'invalid-mode',
    };
  }

  const normalized = normalizePermissionProfile(profile);
  const capabilityDegraded = normalized === 'auto_review'
    && capability.autoReviewSupported === false;
  return {
    level: normalized,
    legacyAsk: false,
    degraded: capabilityDegraded
      || (normalized !== profile && profile !== undefined && profile !== null && profile !== ''),
    source: 'code-profile',
  };
}

export function encodeComposerAccessLevel(
  level: ComposerAccessLevel,
): EncodedComposerAccessLevel {
  if (level === 'read_only') {
    return { mode: 'plan', permissionProfile: 'default' };
  }
  return { mode: 'code', permissionProfile: level };
}
