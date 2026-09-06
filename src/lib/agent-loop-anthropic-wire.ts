/**
 * agent-loop-anthropic-wire.ts — build the Anthropic `providerOptions` wire
 * object for the native Agent Loop.
 *
 * Extracted from agent-loop.ts's inline step loop (model plan Phase 2 / s05,
 * 2026-07-18) following the same convention as agent-loop-error-event.ts /
 * agent-loop-tool-error.ts: the wire-shaping logic lives in its own dependency-
 * free module so it is unit-testable directly (no DB / provider imports pulled
 * in). The object returned here is the SAME one assigned to `providerOptions`
 * and handed to `streamText({ providerOptions })` — asserting on it is asserting
 * on the real request shape, not a source-text grep.
 */

import {
  getAnthropicApiSupportedEffortLevels,
  type EffortLevel,
  type ClaudeModelOptionsOutput,
} from './claude-model-options';

/**
 * Result of {@link buildAnthropicProviderOptions}: the exact `anthropic`
 * provider-options object that gets handed to `streamText({ providerOptions })`
 * (or `undefined` when nothing needs sending), plus whether an explicit effort
 * was dropped on a third-party proxy so the caller can emit the one-shot
 * RUNTIME_EFFORT_IGNORED notice.
 */
export interface AnthropicWireOptions {
  /** `providerOptions.anthropic` for streamText, or undefined if empty. */
  anthropic: Record<string, unknown> | undefined;
  /** True when a user-picked effort was NOT sent because the target is a
   *  third-party Anthropic proxy (may not accept the field). */
  effortDroppedForProxy: boolean;
  /** Original user-picked tier omitted by the proxy. Compatibility defaults
   *  never populate this field because they are not user choices. */
  effortDroppedForProxyRequested?: string;
  /** True when a user-picked effort was NOT sent on the OFFICIAL Anthropic
   *  path because the resolved model isn't on Anthropic's effort-capable list
   *  (`anthropicApiSupportsEffort`) — e.g. Haiku 4.5 or an unknown model.
   *  Callers MUST surface this once (RUNTIME_EFFORT_IGNORED); the composer
   *  still offers an Effort picker for models whose catalog entry declares
   *  SDK-level effort, so an unannounced omission would silently misrepresent
   *  the pick. Mutually exclusive with `effortDroppedForProxy`. */
  effortDroppedUnsupportedModel: boolean;
  /** Present when the model accepts effort but not the requested tier. */
  effortDroppedUnsupportedTier?: {
    requested: string;
    supported: readonly string[];
  };
}

/**
 * Build the Anthropic `providerOptions` from sanitized model options.
 *
 * Effort policy on the official Anthropic path is PER MODEL + LEVEL:
 * @ai-sdk/anthropic 4.0.5 ships effort via GA `output_config.effort` with no
 * effort beta header, so the old "drop effort for the whole adaptive family"
 * workaround is dead — but the API only accepts the field for the models on
 * Anthropic's effort list (`anthropicApiSupportsEffort`). Supported models
 * (Sonnet 5 / Fable 5 / Opus 4.7 / 4.8 / 5) get the composer's pick on the wire
 * (the plan's "four-way consistency" gate) with no toast, since that matches
 * real behavior. Unsupported or unknown models (e.g. Haiku 4.5) omit effort and
 * set `effortDroppedUnsupportedModel` so the caller notifies once — sending it
 * anyway is an unsupported request shape (Codex review P1, 2026-07-18:
 * haiku 4.5 + max was reaching the wire as {"effort":"max"}).
 *
 * Third-party proxies drop effort regardless of model (may not accept the
 * field). `effortDroppedForProxy` is raised only for an explicit user choice;
 * an Opus 5 Auto compatibility default is not misreported as user-picked High.
 */
export function buildAnthropicProviderOptions(args: {
  isThirdPartyProxy: boolean;
  /** Resolved upstream model ID (e.g. 'claude-sonnet-5'). Aliases like 'sonnet'
   *  are not on the effort list and fail closed to "unsupported" — callers
   *  should resolve to upstream before building the wire. */
  model: string | undefined;
  sanitized: Pick<
    ClaudeModelOptionsOutput,
    'thinking' | 'effort' | 'effortProvenance' | 'applyContext1mBeta'
  >;
  /** Vendor-verified tiers for a third-party Anthropic-compatible wire. */
  verifiedEffortLevels?: readonly EffortLevel[];
}): AnthropicWireOptions {
  const { isThirdPartyProxy, model, sanitized, verifiedEffortLevels } = args;
  const anthropicOpts: Record<string, unknown> = {};
  let effortDroppedForProxy = false;
  let effortDroppedForProxyRequested: string | undefined;
  let effortDroppedUnsupportedModel = false;
  let effortDroppedUnsupportedTier: AnthropicWireOptions['effortDroppedUnsupportedTier'];
  const explicitlyRequestedEffort = sanitized.effortProvenance.source === 'explicit'
    ? sanitized.effortProvenance.requested
    : undefined;

  if (isThirdPartyProxy) {
    // Proxies: only pass thinking if explicitly enabled (not adaptive).
    // Effort stays fail-closed unless the matched provider preset declares
    // model-specific support for GA `output_config.effort`. This lets a
    // first-party DeepSeek credential use its documented effort contract
    // without granting the same claim to aggregators that happen to expose
    // an identically named model.
    if (sanitized.thinking && sanitized.thinking.type === 'enabled') {
      anthropicOpts.thinking = sanitized.thinking;
    }
    if (sanitized.effort) {
      if (!verifiedEffortLevels) {
        if (explicitlyRequestedEffort) {
          effortDroppedForProxy = true;
          effortDroppedForProxyRequested = explicitlyRequestedEffort;
        }
      } else if (!verifiedEffortLevels.includes(sanitized.effort as EffortLevel)) {
        effortDroppedUnsupportedTier = {
          requested: explicitlyRequestedEffort ?? sanitized.effort,
          supported: verifiedEffortLevels,
        };
      } else {
        anthropicOpts.effort = sanitized.effort;
      }
    }
    // Don't pass adaptive thinking for proxies.
  } else {
    // Official API: pass through sanitized thinking, and effort ONLY for models
    // on Anthropic's effort list (see JSDoc above). UI selection == wire for
    // supported models; unsupported/unknown models omit + raise the drop signal.
    if (sanitized.thinking) {
      anthropicOpts.thinking = sanitized.thinking;
    }
    if (sanitized.effort) {
      const supportedLevels = getAnthropicApiSupportedEffortLevels(model);
      if (!supportedLevels) {
        effortDroppedUnsupportedModel = true;
      } else if (!supportedLevels.includes(sanitized.effort as EffortLevel)) {
        effortDroppedUnsupportedTier = {
          requested: explicitlyRequestedEffort ?? sanitized.effort,
          supported: supportedLevels,
        };
      } else {
        anthropicOpts.effort = sanitized.effort;
      }
    }
  }

  if (sanitized.applyContext1mBeta) {
    anthropicOpts.anthropicBeta = ['context-1m-2025-08-07'];
  }

  return {
    anthropic: Object.keys(anthropicOpts).length > 0 ? anthropicOpts : undefined,
    effortDroppedForProxy,
    effortDroppedForProxyRequested,
    effortDroppedUnsupportedModel,
    effortDroppedUnsupportedTier,
  };
}
