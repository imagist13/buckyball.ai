export type ModelOptionSupportState = 'selectable' | 'fixed' | 'unsupported' | 'unknown';

export interface ModelOptionSupport<T = string | boolean> {
  state: ModelOptionSupportState;
  runtime: string;
  protocol: string;
  modelIds: string[];
  fixedValue?: T;
  source: string;
}

export interface ComposerModelCapabilityDescriptor {
  effort: ModelOptionSupport<string> & { values?: string[]; noteKey?: string };
  context1m: ModelOptionSupport<boolean>;
}

interface BuildDescriptorInput {
  runtime?: string;
  protocol?: string;
  modelIds: Array<string | undefined>;
  supportsEffort?: boolean;
  supportedEffortLevels?: string[];
  effortNoteKey?: string;
  contextWindow?: number;
}

/**
 * The persisted `context_1m` option maps to Anthropic's
 * `context-1m-2025-08-07` beta header. It is not a generic "make any 200K
 * model 1M" switch. Keep the UI fail-closed unless the provider model API
 * carries an explicit upstream ID for one of the model generations that
 * still uses that beta.
 *
 * Bare role aliases are intentionally excluded: a custom provider can map
 * `sonnet` / `opus` to a different upstream model, so an alias alone is not a
 * trustworthy capability source.
 */
export function isContext1mBetaModelId(rawId: string | undefined): boolean {
  if (!rawId) return false;
  // Right-bound the version so an unverified future/typo ID such as 4-60 is
  // never claimed merely because it contains the 4-6 prefix. Provider slugs
  // and regional prefixes remain supported because the explicit upstream
  // `claude-*` token can occur later in the string.
  return /claude-(?:sonnet|opus)-4(?:[-.]6|-20250514)(?![0-9])/i.test(rawId);
}

function isContext1mBetaModel(modelIds: string[]): boolean {
  return modelIds.some(isContext1mBetaModelId);
}

/**
 * Adapts the existing catalog/API capability surface into UI states. It does
 * not invent a second model table: absence stays `unknown`, while a sourced
 * 1M capacity is `fixed` rather than a switch that would send a no-op header.
 */
export function buildComposerModelCapabilityDescriptor(
  input: BuildDescriptorInput,
): ComposerModelCapabilityDescriptor {
  const runtime = input.runtime || 'unknown';
  const protocol = input.protocol || 'unknown';
  const modelIds = input.modelIds.filter((id): id is string => Boolean(id));
  const effortValues = input.supportedEffortLevels?.filter(Boolean);
  const effort: ComposerModelCapabilityDescriptor['effort'] =
    input.supportsEffort === true && effortValues && effortValues.length > 0
      ? {
          state: 'selectable',
          runtime,
          protocol,
          modelIds,
          values: effortValues,
          noteKey: input.effortNoteKey,
          source: 'providers/models.supportedEffortLevels',
        }
      : input.supportsEffort === false
        ? {
            state: 'unsupported',
            runtime,
            protocol,
            modelIds,
            source: 'providers/models.supportsEffort=false',
          }
        : {
            state: 'unknown',
            runtime,
            protocol,
            modelIds,
            source: 'providers/models.effort-capability-absent',
          };

  let context1m: ComposerModelCapabilityDescriptor['context1m'];
  if (typeof input.contextWindow !== 'number') {
    context1m = {
      state: 'unknown',
      runtime,
      protocol,
      modelIds,
      source: 'providers/models.contextWindow-absent',
    };
  } else if (input.contextWindow >= 1_000_000) {
    context1m = {
      state: 'fixed',
      runtime,
      protocol,
      modelIds,
      fixedValue: true,
      source: 'providers/models.contextWindow',
    };
  } else if (
    protocol === 'anthropic'
    && runtime !== 'codex_runtime'
    && isContext1mBetaModel(modelIds)
  ) {
    context1m = {
      state: 'selectable',
      runtime,
      protocol,
      modelIds,
      source: 'provider-options.context_1m+explicit-4.6-upstream-model',
    };
  } else {
    context1m = {
      state: 'unsupported',
      runtime,
      protocol,
      modelIds,
      source: 'runtime+protocol+contextWindow',
    };
  }

  return { effort, context1m };
}

export interface NormalizedContext1mSelection {
  requested: boolean;
  effective: boolean;
  adjusted: boolean;
  source: string;
}

/**
 * `context_1m` is a request option, not a synonym for a model whose native
 * capacity already is 1M. Switching to fixed/unsupported/unknown must remove a
 * an effective value for this route so the footer and outbound request cannot
 * drift. The caller must not persist that normalization: provider requested
 * options are shared across sessions and change only after explicit user input.
 */
export function normalizeContext1mSelection(
  support: ComposerModelCapabilityDescriptor['context1m'],
  requested: boolean,
): NormalizedContext1mSelection {
  const effective = support.state === 'selectable' ? requested : false;
  return {
    requested,
    effective,
    adjusted: requested !== effective,
    source: support.source,
  };
}
