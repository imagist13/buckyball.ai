/**
 * What the composer's permission dropdown says about `auto_review`
 * (`runtime-permission-modes.md` Phase 1, a07; review round #4 P2).
 *
 * ## Why this is a module and not four ternaries in the component
 *
 * The option has four distinct unavailable-ish states — probing, probe failed,
 * SDK too old, external MCP present — and each is a DIFFERENT fact about the
 * user's machine with a different remedy. The first cut collapsed them by
 * rendering the SDK-version sentence with `minVersion ?? '—'`, so a probe that
 * had not answered yet (or had failed) told the user "requires SDK — (installed:
 * —)": a made-up version claim standing in for "we don't know", permanently, if
 * the fetch failed. That is precisely the placeholder-as-fact pattern CLAUDE.md's
 * 反假数据 section forbids.
 *
 * Pulling the decision out here makes the states enumerable and testable
 * without a DOM: the component renders whatever `notice` it is handed and
 * cannot invent a version number, because it no longer sees one.
 */

/** Capability payload from `GET /api/chat/permission-capability`. */
export interface AutoReviewCapability {
  readonly supported: boolean;
  readonly minVersion?: string;
  readonly installedVersion?: string | null;
  /** Which gate refused. Absent when `supported` is true. */
  readonly unavailableReason?: 'sdk_version' | 'codex_version' | 'external_mcp' | 'runtime';
  /**
   * The effective ChatRuntime, present only when `unavailableReason === 'runtime'`.
   * Carried for breadcrumb/debugging; the notice copy is runtime-agnostic.
   */
  readonly runtime?: string;
  readonly externalMcp?: {
    readonly present: boolean;
    readonly certainty?: 'configured' | 'undetectable';
    readonly sources?: readonly string[];
  };
}

/**
 * The probe's lifecycle. `checking` and `failed` are separate on purpose:
 * "we haven't asked yet" and "we asked and it broke" look identical to a
 * component that only tracks `capability | null`, which is how the failure
 * state ended up rendering as a version mismatch.
 */
export type AutoReviewProbeState =
  | { readonly status: 'checking' }
  | { readonly status: 'failed' }
  | { readonly status: 'ready'; readonly capability: AutoReviewCapability };

/** An i18n key plus its interpolation params — never pre-rendered text. */
export interface AutoReviewNotice {
  readonly key: string;
  readonly params?: Readonly<Record<string, string>>;
}

export interface AutoReviewDisplay {
  /** Whether the dropdown item may be clicked. */
  readonly selectable: boolean;
  /** Why it can't be picked (or null when it can). Always a real, sourced fact. */
  readonly notice: AutoReviewNotice | null;
  /**
   * True when the session is SAVED as auto_review but is not running as it.
   * Only ever true once the probe has answered — we don't announce a
   * degradation we haven't confirmed.
   */
  readonly degraded: boolean;
}

export const AUTO_REVIEW_NOTICE_KEYS = {
  checking: 'permission.autoReviewChecking',
  probeFailed: 'permission.autoReviewProbeFailed',
  sdkVersion: 'permission.autoReviewUnavailable',
  sdkVersionUnknown: 'permission.autoReviewUnavailableUnknownVersion',
  codexVersion: 'permission.autoReviewCodexUnavailable',
  codexVersionUnknown: 'permission.autoReviewCodexUnavailableUnknownVersion',
  externalMcp: 'permission.autoReviewExternalMcp',
  externalMcpUnknown: 'permission.autoReviewExternalMcpUnknown',
  runtime: 'permission.autoReviewUnsupportedRuntime',
} as const;

function unavailableNotice(capability: AutoReviewCapability): AutoReviewNotice {
  // Non-Claude runtime — the option is off because THIS runtime has no auto
  // reviewer (review round #6, P1), not because of an SDK version or MCP config.
  if (capability.unavailableReason === 'runtime') {
    return { key: AUTO_REVIEW_NOTICE_KEYS.runtime };
  }

  if (capability.unavailableReason === 'external_mcp') {
    // 'undetectable' means a config file was unreadable — say that, rather
    // than asserting the user has servers configured. Different fact.
    return capability.externalMcp?.certainty === 'undetectable'
      ? { key: AUTO_REVIEW_NOTICE_KEYS.externalMcpUnknown }
      : { key: AUTO_REVIEW_NOTICE_KEYS.externalMcp };
  }

  if (capability.unavailableReason === 'codex_version') {
    const minVersion = capability.minVersion;
    if (!minVersion) return { key: AUTO_REVIEW_NOTICE_KEYS.probeFailed };
    return capability.installedVersion
      ? {
          key: AUTO_REVIEW_NOTICE_KEYS.codexVersion,
          params: { minVersion, installedVersion: capability.installedVersion },
        }
      : {
          key: AUTO_REVIEW_NOTICE_KEYS.codexVersionUnknown,
          params: { minVersion },
        };
  }

  const minVersion = capability.minVersion;
  const installedVersion = capability.installedVersion;

  // No minVersion to quote ⇒ we cannot make the version claim at all. This is
  // the branch that used to print '—'.
  if (!minVersion) return { key: AUTO_REVIEW_NOTICE_KEYS.probeFailed };

  // The SDK version was unreadable (sdk-capability returns null for that).
  // "installed: unknown" is honest; "installed: —" is a shrug pretending to be
  // a version.
  if (!installedVersion) {
    return { key: AUTO_REVIEW_NOTICE_KEYS.sdkVersionUnknown, params: { minVersion } };
  }

  return { key: AUTO_REVIEW_NOTICE_KEYS.sdkVersion, params: { minVersion, installedVersion } };
}

/**
 * Fail-closed in the UI direction too: anything other than a confirmed
 * `supported: true` leaves the option unselectable. The user is never offered a
 * profile we cannot promise to honour, and never told a reason we did not
 * actually establish.
 */
export function resolveAutoReviewDisplay(input: {
  readonly probe: AutoReviewProbeState;
  readonly permissionProfile: string;
}): AutoReviewDisplay {
  const { probe, permissionProfile } = input;
  const savedAsAutoReview = permissionProfile === 'auto_review';

  if (probe.status === 'checking') {
    return { selectable: false, notice: { key: AUTO_REVIEW_NOTICE_KEYS.checking }, degraded: false };
  }

  if (probe.status === 'failed') {
    return { selectable: false, notice: { key: AUTO_REVIEW_NOTICE_KEYS.probeFailed }, degraded: false };
  }

  if (probe.capability.supported) {
    return { selectable: true, notice: null, degraded: false };
  }

  return {
    selectable: false,
    notice: unavailableNotice(probe.capability),
    degraded: savedAsAutoReview,
  };
}
