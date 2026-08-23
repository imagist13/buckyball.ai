/**
 * Provider Catalog â?vendor presets, protocol definitions, and default model catalogs.
 *
 * This is the single source of truth for:
 * - Which protocol a vendor uses (anthropic, openai-compatible, bedrock, vertex, etc.)
 * - Default env overrides each vendor needs for Claude Code SDK
 * - Default model catalogs (role â?upstream model id mapping)
 * - Auth key injection style (ANTHROPIC_API_KEY vs ANTHROPIC_AUTH_TOKEN)
 * - Provider meta info (API key URLs, docs, billing model, notes)
 */

import { z } from 'zod';

// ââ Protocol types ââââââââââââââââââââââââââââââââââââââââââââââ

/**
 * Protocol describes how to talk to a provider's API.
 * This determines which SDK client to instantiate and which env vars to set.
 */
export type Protocol =
  | 'anthropic'           // Native Anthropic API (official + third-party compatible)
  | 'openai-compatible'   // OpenAI-compatible REST API
  | 'xai'                 // Native xAI Responses API
  | 'openrouter'          // OpenRouter (OpenAI-compatible with extra headers)
  | 'bedrock'             // AWS Bedrock (env-based auth, CLAUDE_CODE_USE_BEDROCK)
  | 'vertex'              // Google Vertex AI (env-based auth, CLAUDE_CODE_USE_VERTEX)
  | 'google'              // Google Generative AI (Gemini text)
  | 'gemini-image'        // Google Gemini image generation
  | 'openai-image';       // OpenAI GPT Image generation

/**
 * How the provider authenticates: which env var to inject the API key into.
 */
export type AuthStyle =
  | 'api_key'             // ANTHROPIC_API_KEY
  | 'auth_token'          // ANTHROPIC_AUTH_TOKEN
  | 'env_only'            // No API key; auth via extra env (bedrock/vertex)
  | 'custom_header';      // API key in custom header (future)

/**
 * Model role â?semantic purpose, maps to ANTHROPIC_DEFAULT_*, ANTHROPIC_MODEL, etc.
 */
export type ModelRole = 'default' | 'reasoning' | 'small' | 'haiku' | 'sonnet' | 'opus';

/** Reasoning-effort tiers exposed by provider model catalogs. */
export type ProviderEffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/**
 * A model entry in the catalog.
 */
export interface CatalogModel {
  /** Internal/UI model ID (what the user sees and what we pass to Claude Code) */
  modelId: string;
  /** Actual upstream model ID (what gets sent to the API) â?if different from modelId */
  upstreamModelId?: string;
  /** Human-readable display name */
  displayName: string;
  /** Role mapping for Claude Code env vars */
  role?: ModelRole;
  /** Capabilities */
  capabilities?: {
    reasoning?: boolean;
    toolUse?: boolean;
    vision?: boolean;
    pdf?: boolean;
    contextWindow?: number;
    /** Whether this model supports effort levels (reasoning effort) */
    supportsEffort?: boolean;
    /** Allowed effort levels for this model (Opus 4.7 adds 'xhigh') */
    supportedEffortLevels?: ProviderEffortLevel[];
    /**
     * i18n key for a one-line note under the effort menu, used when the tier
     * list alone would misread. Phase 1 (2026-07-17): GLM collapses Claude
     * Code's six `/effort` tokens onto two real tiers, and Kimi's only vendor
     * tier is `max` â?in both cases the user needs to know what the shown
     * tiers mean before picking one. Must resolve to an existing key in
     * `src/i18n/en.ts` + `zh.ts`.
     */
    effortNoteKey?: string;
    /** Whether this model supports adaptive thinking */
    supportsAdaptiveThinking?: boolean;
    /** Vendor-documented thinking mode when it is not user-switchable. */
    thinkingMode?: 'always' | 'adaptive';
    /** Vendor default effort when the user leaves the selector on Auto. */
    defaultEffortLevel?: ProviderEffortLevel;
    /** Vendor sampling defaults/limits that must be represented honestly. */
    thinkingTemperatureDefault?: number;
    thinkingTemperatureMin?: number;
    temperatureClampBehavior?: 'upstream_clamps_below_min';
  };
}

/**
 * Role models map â?maps semantic roles to model IDs.
 * Used to generate ANTHROPIC_MODEL, ANTHROPIC_REASONING_MODEL, ANTHROPIC_DEFAULT_* env vars.
 */
export interface RoleModels {
  default?: string;
  reasoning?: string;
  small?: string;
  haiku?: string;
  sonnet?: string;
  opus?: string;
}

// ââ Vendor preset definition ââââââââââââââââââââââââââââââââââââ

export interface VendorPreset {
  /** Unique preset key (used as lookup key) */
  key: string;
  /** Human-readable name */
  name: string;
  /** Description (English) */
  description: string;
  /** Description (Chinese) */
  descriptionZh: string;
  /** Wire protocol */
  protocol: Protocol;
  /** Auth style */
  authStyle: AuthStyle;
  /** Default base URL (empty for bedrock/vertex) */
  baseUrl: string;
  /** Default env overrides for Claude Code SDK */
  defaultEnvOverrides: Record<string, string>;
  /** Default model catalog */
  defaultModels: CatalogModel[];
  /** Default role models mapping */
  defaultRoleModels?: RoleModels;
  /** Which fields the quick-connect form shows */
  fields: ('name' | 'api_key' | 'base_url' | 'env_overrides' | 'model_names' | 'model_mapping')[];
  /** Category: chat (default) or media */
  category?: 'chat' | 'media';
  /** Icon key for UI */
  iconKey: string;
  /**
   * True for providers that only support the Claude Code SDK wire protocol
   * (e.g. Kimi /coding/, GLM /api/anthropic).
   * These providers cannot be used with the Vercel AI SDK text generation path
   * (streamText / generateText) because they don't implement the standard
   * Anthropic Messages API.
   */
  sdkProxyOnly?: boolean;
  /** Whether this credential may be used outside an immediate user interaction. */
  usagePolicy?: 'general' | 'interactive_only';
  /**
   * Provider-specific wire capabilities that have been verified against the
   * vendor's own API contract. These declarations are deliberately separate
   * from model UI capabilities: an aggregator may list the same model without
   * implementing the same transport or effort fields.
   */
  wireCapabilities?: {
    /** Anthropic-compatible models that accept GA `output_config.effort`. */
    anthropicEffort?: {
      modelIds: string[];
    };
    /** Native Responses transport used only when Codex Runtime selects a listed model. */
    codexResponses?: {
      baseUrl: string;
      modelIds: string[];
      /**
       * Per-model wire ID rewrites when the Anthropic and Responses products
       * use different names for the same catalog entry. Keys must also appear
       * in `modelIds`; undeclared aliases never gain the transport implicitly.
       */
      modelIdOverrides?: Record<string, string>;
      /** Explicit Codex-effort aliases documented by this Responses endpoint. */
      effortAliases?: Partial<Record<'minimal' | ProviderEffortLevel, ProviderEffortLevel>>;
      /** Whether the endpoint accepts OpenAI's optional reasoning summary field. */
      supportsReasoningSummary?: boolean;
    };
  };
  /** Provider meta info for user guidance and error recovery */
  meta?: {
    /** URL where user can obtain/manage API key */
    apiKeyUrl?: string;
    /** Official configuration documentation URL */
    docsUrl?: string;
    /** Pricing page URL */
    pricingUrl?: string;
    /** Service status page URL */
    statusPageUrl?: string;
    /** Billing model */
    billingModel: 'pay_as_you_go' | 'coding_plan' | 'token_plan' | 'free' | 'self_hosted';
    /** Notes/warnings shown during provider configuration */
    notes?: string[];
    /** Chinese notes; falls back to `notes` when omitted. */
    notesZh?: string[];
    /** Official purchase/manage-plan entry, distinct from docs and key creation. */
    purchaseUrl?: string;
    /**
     * Whether this anthropic-compat preset has been verified end-to-end:
     * tool calling, thinking, model aliases, and `/v1/messages` quirks all
     * confirmed to work. Drives the `claude_code_verified` runtime compat
     * tier (info tone, "Claude Code å¼å®¹") instead of the default
     * `claude_code_experimental` (warning tone, "Claude Code å®éª").
     * Only meaningful for `protocol: 'anthropic'` presets.
     */
    claudeCodeVerified?: boolean;
    /**
     * Whether `defaultModels` is the authoritative lineup for this preset
     * â?i.e. anything outside it counts as drift / off-list, not as a
     * legitimate user customization. Drives the "å·²ä¸å¨å½åæ¨èç®å½?
     * badge in the Models page.
     *
     * Plan providers (`sdkProxyOnly && billingModel â?{coding_plan,
     * token_plan}`) are inherently authoritative â?the plan whitelist IS
     * the truth â?so they don't need this flag set explicitly; the badge
     * gate ORs with `isCatalogOnlyPlanProviderRecord`.
     *
     * Set this only on pay-as-you-go presets where we deliberately curate
     * the lineup (e.g. DeepSeek's v4 family) and want catalog drift to
     * surface to the user. Do NOT set on starter / seed catalogs (Kimi /
     * Moonshot / Xiaomi MiMo PAYG / anthropic-thirdparty / OpenRouter)
     * where defaultModels is just a 1-3 alias bootstrap and user-added
     * SKUs are normal usage, not drift.
     */
    fixedCatalog?: boolean;
    /**
     * Model discovery posture. `'catalog_only'` = the shipped `defaultModels`
     * lineup is the ONLY truth: no `/v1/models` refresh, no search-and-add, and
     * `classifyProvider` returns `unsupported`. Used for subscription gateways
     * whose model endpoint either needs a key, mixes wire protocols, or returns
     * a superset of the plan whitelist (ClinePass, OpenCode Go). Distinct from
     * the `sdkProxyOnly && coding_plan` plan gate: those keep search-and-add ON
     * (their `/v1/models` is a clean per-vendor list), this turns it OFF.
     * Phase 2 may add a `'filtered_models_endpoint'` mode with allowlist/prefix.
     */
    modelDiscoveryMode?: 'catalog_only';
  };
}

/**
 * Minimum record needed to resolve a persisted provider product identity.
 * `preset_key` is intentionally required: legacy callers must pass `''` so
 * TypeScript makes every inference site acknowledge that it is using the
 * conservative fallback path.
 */
export interface ProviderPresetIdentityRecord {
  preset_key: string;
  provider_type: string;
  protocol: string;
  base_url: string;
}

export type ProviderPresetIdentityResolution =
  | { status: 'resolved'; preset: VendorPreset; source: 'preset_key' | 'legacy_exact' | 'legacy_fuzzy' | 'legacy_type' }
  | { status: 'ambiguous'; candidateKeys: string[] }
  | { status: 'invalid'; candidateKeys: string[] }
  | { status: 'unmatched'; candidateKeys: [] };

// ââ Zod Schema for preset validation ââââââââââââââââââââââââââââââ

const PresetMetaSchema = z.object({
  apiKeyUrl: z.string().optional(),
  docsUrl: z.string().optional(),
  pricingUrl: z.string().optional(),
  statusPageUrl: z.string().optional(),
  billingModel: z.enum(['pay_as_you_go', 'coding_plan', 'token_plan', 'free', 'self_hosted']),
  notes: z.array(z.string()).optional(),
  notesZh: z.array(z.string()).optional(),
  purchaseUrl: z.string().optional(),
  claudeCodeVerified: z.boolean().optional(),
  fixedCatalog: z.boolean().optional(),
  modelDiscoveryMode: z.enum(['catalog_only']).optional(),
});

export const PresetSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  descriptionZh: z.string(),
  protocol: z.enum(['anthropic', 'openai-compatible', 'xai', 'openrouter', 'bedrock', 'vertex', 'google', 'gemini-image', 'openai-image']),
  authStyle: z.enum(['api_key', 'auth_token', 'env_only', 'custom_header']),
  baseUrl: z.string(),
  defaultEnvOverrides: z.record(z.string(), z.string()),
  defaultModels: z.array(z.object({
    modelId: z.string(),
    upstreamModelId: z.string().optional(),
    displayName: z.string(),
    role: z.enum(['default', 'reasoning', 'small', 'haiku', 'sonnet', 'opus']).optional(),
    capabilities: z.object({
      reasoning: z.boolean().optional(),
      toolUse: z.boolean().optional(),
      vision: z.boolean().optional(),
      pdf: z.boolean().optional(),
      contextWindow: z.number().optional(),
      supportsEffort: z.boolean().optional(),
      supportedEffortLevels: z.array(z.enum(['low', 'medium', 'high', 'xhigh', 'max'])).optional(),
      effortNoteKey: z.string().optional(),
      supportsAdaptiveThinking: z.boolean().optional(),
      thinkingMode: z.enum(['always', 'adaptive']).optional(),
      defaultEffortLevel: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
      thinkingTemperatureDefault: z.number().optional(),
      thinkingTemperatureMin: z.number().optional(),
      temperatureClampBehavior: z.enum(['upstream_clamps_below_min']).optional(),
    }).optional(),
  })),
  fields: z.array(z.string()),
  iconKey: z.string(),
  sdkProxyOnly: z.boolean().optional(),
  usagePolicy: z.enum(['general', 'interactive_only']).optional(),
  wireCapabilities: z.object({
    anthropicEffort: z.object({
      modelIds: z.array(z.string().min(1)).min(1),
    }).optional(),
    codexResponses: z.object({
      baseUrl: z.string().url(),
      modelIds: z.array(z.string().min(1)).min(1),
      modelIdOverrides: z.record(z.string(), z.string().min(1)).optional(),
      effortAliases: z.partialRecord(
        z.enum(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']),
        z.enum(['low', 'medium', 'high', 'xhigh', 'max']),
      ).optional(),
      supportsReasoningSummary: z.boolean().optional(),
    }).optional(),
  }).optional(),
  category: z.enum(['chat', 'media']).optional(),
  defaultRoleModels: z.record(z.string(), z.string()).optional(),
  meta: PresetMetaSchema.optional(),
}).refine(data => {
  // auth_token presets must NOT have ANTHROPIC_API_KEY in envOverrides
  // (auth_token injection already clears API_KEY; envOverrides entry would be ignored by AUTH_ENV_KEYS skip)
  if (data.authStyle === 'auth_token' && data.defaultEnvOverrides.ANTHROPIC_API_KEY !== undefined) {
    return false;
  }
  // api_key presets must NOT have ANTHROPIC_AUTH_TOKEN in envOverrides
  if (data.authStyle === 'api_key' && data.defaultEnvOverrides.ANTHROPIC_AUTH_TOKEN !== undefined) {
    return false;
  }
  // Note: auth_token presets MAY have ANTHROPIC_AUTH_TOKEN with a fixed pseudo-value (e.g. Ollama uses 'ollama').
  // This is allowed because it's a preset default, not user input â?though the AUTH_ENV_KEYS skip in
  // toClaudeCodeEnv() means it will only take effect if the user doesn't provide their own key.
  return true;
}, { message: 'authStyle conflicts with auth-related keys in defaultEnvOverrides' }).refine(data => {
  const responses = data.wireCapabilities?.codexResponses;
  return !responses?.modelIdOverrides
    || Object.keys(responses.modelIdOverrides).every(modelId => responses.modelIds.includes(modelId));
}, { message: 'codexResponses.modelIdOverrides keys must be declared in modelIds' });

// ââ Default Anthropic models ââââââââââââââââââââââââââââââââââââ

// Shared Anthropic catalog used by non-first-party providers
// (anthropic-thirdparty, openrouter, ollama, litellm) and the generic
// protocol fallback. Intentionally alias-only: third-party providers
// often require their own upstream model names (OpenRouter goes through
// the OpenAI SDK, LiteLLM expects user-configured names, etc.), and
// forcing claude-opus-4-7 here would break those pass-through paths.
// First-party Anthropic has its own catalog below.
const ANTHROPIC_DEFAULT_MODELS: CatalogModel[] = [
  {
    modelId: 'sonnet',
    displayName: 'Sonnet 4.6',
    role: 'sonnet',
    capabilities: {
      supportsEffort: true,
      supportedEffortLevels: ['low', 'medium', 'high', 'max'],
      supportsAdaptiveThinking: true,
    },
  },
  {
    modelId: 'opus',
    displayName: 'Opus 4.7',
    role: 'opus',
    capabilities: {
      supportsEffort: true,
      supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      supportsAdaptiveThinking: true,
    },
  },
  {
    modelId: 'haiku',
    displayName: 'Haiku 4.5',
    role: 'haiku',
    capabilities: {
      supportsEffort: true,
      supportedEffortLevels: ['low', 'medium', 'high'],
    },
  },
];

// Phase 5b round-8 fix (2026-05-18) â?OpenRouter's Anthropic skin
// (https://openrouter.ai/api) rejects the bare aliases `sonnet` /
// `opus` / `haiku` with "is not a valid model ID". Real-credential
// smoke confirmed that switching `haiku` to the upstream slug
// `anthropic/claude-haiku-4.5` returns the prompted string. The
// version-tagged slugs follow OpenRouter's documented naming
// convention (verified for haiku in smoke; sonnet/opus follow the
// same `<vendor>/claude-<role>-<major.minor>` shape â?if a version
// is unavailable on OpenRouter, the API returns the same
// "not a valid model ID" error pointing at the canonical name, so
// users can fix locally via the model picker).
//
// First-party Anthropic uses a different upstream slug shape (dash
// separators, e.g. `claude-haiku-4-5-20251001`) so it stays in its
// own ANTHROPIC_FIRST_PARTY_MODELS catalog below. OpenRouter is the
// only preset that re-uses the alias trio but with its own
// upstream surface, so we keep the array OpenRouter-specific.
const OPENROUTER_ANTHROPIC_MODELS: CatalogModel[] = [
  {
    modelId: 'sonnet',
    upstreamModelId: 'anthropic/claude-sonnet-4.6',
    displayName: 'Sonnet 4.6',
    role: 'sonnet',
    capabilities: {
      supportsEffort: true,
      supportedEffortLevels: ['low', 'medium', 'high', 'max'],
      supportsAdaptiveThinking: true,
    },
  },
  {
    modelId: 'opus',
    upstreamModelId: 'anthropic/claude-opus-4.7',
    displayName: 'Opus 4.7',
    role: 'opus',
    capabilities: {
      supportsEffort: true,
      supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      supportsAdaptiveThinking: true,
    },
  },
  {
    modelId: 'opus-4-8',
    // OpenRouter slug confirmed by Codex (2026-05-29) â?explicit fixture,
    // not inferred from the 4.7 naming pattern.
    upstreamModelId: 'anthropic/claude-opus-4.8',
    displayName: 'Opus 4.8',
    // No `role` â?explicit pick; `opus` alias stays 4.7 (Phase A safe default).
    capabilities: {
      supportsEffort: true,
      supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      supportsAdaptiveThinking: true,
    },
  },
  {
    modelId: 'haiku',
    upstreamModelId: 'anthropic/claude-haiku-4.5',
    displayName: 'Haiku 4.5',
    role: 'haiku',
    capabilities: {
      supportsEffort: true,
      supportedEffortLevels: ['low', 'medium', 'high'],
    },
  },
];

// First-party Anthropic API (anthropic-official preset) â?pins opus to
// the explicit upstream ID so resolved.upstreamModel carries a concrete
// model name downstream. This unblocks the Opus 4.7 sanitizer regex
// in claude-model-options.ts (which matches upstream IDs, not aliases)
// and guarantees the native path doesn't forward the bare "opus"
// alias to @ai-sdk/anthropic.
const ANTHROPIC_FIRST_PARTY_MODELS: CatalogModel[] = [
  {
    modelId: 'sonnet',
    upstreamModelId: 'claude-sonnet-4-6',
    displayName: 'Sonnet 4.6',
    role: 'sonnet',
    capabilities: {
      supportsEffort: true,
      supportedEffortLevels: ['low', 'medium', 'high', 'max'],
      supportsAdaptiveThinking: true,
    },
  },
  {
    modelId: 'sonnet-5',
    upstreamModelId: 'claude-sonnet-5',
    displayName: 'Sonnet 5',
    // No `role`: Sonnet 5 is an explicit pick, NOT the default `sonnet` role
    // target (which stays claude-sonnet-4-6). Existing sessions pinned to
    // Sonnet 4.6 must NOT auto-migrate â?same pinned-default discipline as
    // opus-4-8 / fable-5.
    //
    // Official contract (whats-new-sonnet-5 migration guide, verified
    // 2026-07-17): adaptive thinking is the DEFAULT but â?unlike Fable 5 â?    // can be explicitly turned off with thinking:{type:'disabled'} (Fable 5
    // 400s on that). Manual extended thinking ({enabled,budgetTokens}) is
    // removed and 400s. Non-default temperature/top_p/top_k 400. effort
    // low/medium/high(default)/xhigh/max. New tokenizer â?same text â?+30%
    // tokens vs 4.6. Wire handling lives in claude-model-options.ts +
    // agent-loop.ts (effort now sent on native â?@ai-sdk/anthropic 4.0.5
    // ships GA output_config.effort, no deprecated beta header).
    capabilities: {
      supportsEffort: true,
      supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      supportsAdaptiveThinking: true,
    },
  },
  {
    modelId: 'opus',
    upstreamModelId: 'claude-opus-4-7',
    displayName: 'Opus 4.7',
    role: 'opus',
    capabilities: {
      supportsEffort: true,
      supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      supportsAdaptiveThinking: true,
    },
  },
  {
    modelId: 'opus-4-8',
    upstreamModelId: 'claude-opus-4-8',
    displayName: 'Opus 4.8',
    // No `role`: Opus 4.8 is an explicit pick, NOT the default `opus` role
    // target. roleModels.opus / ANTHROPIC_DEFAULT_OPUS_MODEL stays
    // claude-opus-4-7 until the user opts to switch (Phase A safe default).
    capabilities: {
      supportsEffort: true,
      // Same levels as 4.7; the effort DEFAULT (high) is applied by the
      // Claude Code CLI/SDK when effort is unset, not here.
      supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      supportsAdaptiveThinking: true,
    },
  },
  {
    modelId: 'opus-5',
    upstreamModelId: 'claude-opus-5',
    displayName: 'Opus 5',
    // No `role`: Opus 5 is an explicit pick. Keep the existing `opus`
    // role pinned to 4.7 so saved sessions and defaults do not silently
    // change model after an application update.
    //
    // Official contract (2026-07-24): 1M context, adaptive thinking on by
    // default, effort low/medium/high(default)/xhigh/max. When thinking is
    // explicitly disabled, xhigh/max are invalid; the shared sanitizer keeps
    // thinking off and lowers effort to high with a visible notice.
    capabilities: {
      supportsEffort: true,
      supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      supportsAdaptiveThinking: true,
    },
  },
  {
    modelId: 'fable-5',
    upstreamModelId: 'claude-fable-5',
    displayName: 'Fable 5',
    // No `role`: Fable 5 (2026-06 launch, the tier above Opus) is an
    // explicit pick, same policy as Opus 4.8 â?no silent default switch.
    // Request contract = Opus 4.7/4.8 family (adaptive thinking only,
    // 1M context) with one extra guard handled in claude-model-options.ts
    // (explicit thinking:disabled returns 400 â?omitted instead).
    capabilities: {
      supportsEffort: true,
      supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      supportsAdaptiveThinking: true,
    },
  },
  {
    modelId: 'haiku',
    upstreamModelId: 'claude-haiku-4-5-20251001',
    displayName: 'Haiku 4.5',
    role: 'haiku',
    capabilities: {
      supportsEffort: true,
      supportedEffortLevels: ['low', 'medium', 'high'],
    },
  },
];

// Single source of truth for the built-in "Claude Code" (env) provider's
// model list â?same aliases + concrete upstream IDs as the first-party
// catalog, minus `role` (env mode has no role-mapping semantics).
//
// Consumers must DERIVE from this export, never re-hardcode (Codex review
// P1, 2026-06-10: three hand-maintained copies had drifted â?the model
// picker's env group and the client fallback were missing opus-4-8 AND
// fable-5 while the resolver had both):
//   - provider-resolver.ts            envModels (alias â?upstream resolution)
//   - app/api/providers/models/route.ts  DEFAULT_MODELS + ENV_ALIAS_TO_UPSTREAM
//   - hooks/useProviderModels.ts      DEFAULT_MODEL_OPTIONS (client fallback)
export const ENV_CLAUDE_CODE_MODELS: CatalogModel[] = ANTHROPIC_FIRST_PARTY_MODELS.map(
  ({ role: _role, ...model }) => model,
);

// Bedrock / Vertex: per Claude Code docs, the `opus` alias still resolves
// to Opus 4.6 on these platforms (unlike first-party Anthropic). Users who
// want Opus 4.7 on Bedrock/Vertex must pass the full model name or set
// ANTHROPIC_DEFAULT_OPUS_MODEL explicitly. We surface this in the label to
// avoid promising 4.7 capabilities (xhigh) on an alias that actually runs 4.6.
const BEDROCK_VERTEX_DEFAULT_MODELS: CatalogModel[] = [
  {
    modelId: 'sonnet',
    displayName: 'Sonnet 4.6',
    role: 'sonnet',
    capabilities: {
      supportsEffort: true,
      supportedEffortLevels: ['low', 'medium', 'high', 'max'],
      supportsAdaptiveThinking: true,
    },
  },
  {
    modelId: 'opus',
    displayName: 'Opus 4.6 (alias)',
    role: 'opus',
    capabilities: {
      supportsEffort: true,
      supportedEffortLevels: ['low', 'medium', 'high', 'max'],
      supportsAdaptiveThinking: true,
    },
  },
  {
    modelId: 'haiku',
    displayName: 'Haiku 4.5',
    role: 'haiku',
    capabilities: {
      supportsEffort: true,
      supportedEffortLevels: ['low', 'medium', 'high'],
    },
  },
];

/**
 * GLM Coding Plan catalog â?shared by the CN and Global presets (same lineup,
 * different regional endpoints). Verified against the vendor's GLM-5.3 model,
 * latest-model, overview, Claude Code and Codex pages on 2026-08-14; the
 * evidence matrix lives in
 * docs/research/glm-5-3-codeplan-adaptation-2026-08-14.md.
 *
 * The stable `sonnet` / `haiku` modelIds preserve saved buckyball.ai sessions.
 * Their upstream IDs are the current official products. Claude's Anthropic
 * route uses `glm-5.3[1m]`, while the native Responses route requires the bare
 * `glm-5.3`; that transport-specific rewrite is declared in wireCapabilities
 * rather than represented as a duplicate picker row.
 */
const GLM_CODING_PLAN_MODELS: CatalogModel[] = [
  {
    modelId: 'sonnet',
    upstreamModelId: 'glm-5.3[1m]',
    displayName: 'GLM-5.3',
    role: 'sonnet',
    capabilities: {
      reasoning: true,
      toolUse: true,
      contextWindow: 1_048_576,
      supportsEffort: true,
      supportedEffortLevels: ['low', 'high', 'max'],
      defaultEffortLevel: 'max',
      effortNoteKey: 'messageInput.effort.note.glmCodePlan',
    },
  },
  {
    modelId: 'glm-5-turbo',
    upstreamModelId: 'glm-5-turbo',
    displayName: 'GLM-5-Turbo',
    capabilities: {
      reasoning: true,
      toolUse: true,
      contextWindow: 204_800,
      defaultEffortLevel: 'max',
    },
  },
  {
    modelId: 'haiku',
    upstreamModelId: 'glm-4.7',
    displayName: 'GLM-4.7',
    role: 'haiku',
    capabilities: {
      reasoning: true,
      toolUse: true,
      contextWindow: 204_800,
    },
  },
];

// ââ Vendor presets ââââââââââââââââââââââââââââââââââââââââââââââ

export const VENDOR_PRESETS: VendorPreset[] = [
  // ââ Official Anthropic ââ
  {
    key: 'anthropic-official',
    name: 'Anthropic',
    description: 'Official Anthropic API',
    descriptionZh: 'Anthropic å®æ¹ API',
    protocol: 'anthropic',
    authStyle: 'api_key',
    baseUrl: 'https://api.anthropic.com',
    defaultEnvOverrides: {},
    defaultModels: ANTHROPIC_FIRST_PARTY_MODELS,
    fields: ['api_key'],
    iconKey: 'anthropic',
    meta: {
      apiKeyUrl: 'https://platform.claude.com/settings/keys',
      docsUrl: 'https://platform.claude.com/docs/en/api/overview',
      billingModel: 'pay_as_you_go',
    },
  },

  // ââ Anthropic Third-party (generic) ââ
  {
    key: 'anthropic-thirdparty',
    name: 'Anthropic Third-party API',
    description: 'Anthropic-compatible API â?provide URL and Key',
    descriptionZh: 'Anthropic å¼å®¹ç¬¬ä¸æ?API â?å¡«åå°ååå¯é?,
    protocol: 'anthropic',
    authStyle: 'api_key',
    baseUrl: '',
    defaultEnvOverrides: { ANTHROPIC_API_KEY: '' },
    defaultModels: ANTHROPIC_DEFAULT_MODELS,
    fields: ['name', 'api_key', 'base_url', 'model_mapping', 'env_overrides'],
    iconKey: 'anthropic',
  },

  // ââ OpenAI-Compatible Third-party (generic) ââ
  // Generic OpenAI-compatible chat gateway: user supplies base_url + key +
  // model. Routes through @ai-sdk/openai's chat-completions wire, so it's
  // reachable from bb-agent Runtime and Codex Runtime but NOT Claude Code
  // (Anthropic wire). runtime-compat maps protocol 'openai-compatible' to the
  // `bbagent_only` tier; getProviderCompat reaches that tier only when this
  // preset is matched (see findMatchingPresetForRecord / findMatchingPreset).
  // NOT sdkProxyOnly (that flag means "Claude Code subprocess only" â?the
  // opposite of this). NOT claudeCodeVerified (only meaningful for anthropic).
  // No default model catalog â?the user names their own model; never fabricate
  // an official-OpenAI lineup for an arbitrary third-party gateway.
  {
    key: 'openai-compatible',
    name: 'OpenAI-Compatible API',
    description: 'OpenAI-compatible chat API â?provide URL, key and model (CodePilot / Codex runtimes)',
    descriptionZh: 'OpenAI å¼å®¹ç¬¬ä¸æ?API â?å¡«åå°åãå¯é¥åæ¨¡åï¼ç¨äº?CodePilot / Codex è¿è¡æ¶ï¼',
    protocol: 'openai-compatible',
    authStyle: 'api_key',
    baseUrl: '',
    defaultEnvOverrides: {},
    defaultModels: [],
    fields: ['name', 'api_key', 'base_url', 'model_names'],
    iconKey: 'openai',
    meta: {
      billingModel: 'pay_as_you_go',
    },
  },

  // ââ xAI official Responses API ââ
  // Keep this branded and separate from the generic OpenAI-compatible preset:
  // Grok 4.6's supported product path is /v1/responses via @ai-sdk/xai.
  {
    key: 'xai',
    name: 'xAI API Key',
    description: 'Official xAI API using the Responses API (CodePilot / Codex runtimes)',
    descriptionZh: 'xAI å®æ¹ API Keyï¼ä½¿ç?Responses APIï¼ç¨äº?CodePilot / Codex è¿è¡æ¶ï¼',
    protocol: 'xai',
    authStyle: 'api_key',
    baseUrl: 'https://api.x.ai/v1',
    defaultEnvOverrides: {},
    defaultModels: [
      {
        modelId: 'grok-4.6',
        displayName: 'Grok 4.6',
        capabilities: {
          reasoning: true,
          toolUse: true,
          vision: true,
          contextWindow: 500_000,
          supportsEffort: true,
          supportedEffortLevels: ['low', 'medium', 'high'],
          thinkingMode: 'always',
          defaultEffortLevel: 'high',
        },
      },
      { modelId: 'grok-4.5', displayName: 'Grok 4.5 (Legacy)' },
    ],
    defaultRoleModels: { default: 'grok-4.6' },
    fields: ['api_key'],
    iconKey: 'xai',
    meta: {
      apiKeyUrl: 'https://console.x.ai/',
      docsUrl: 'https://docs.x.ai/docs/overview',
      pricingUrl: 'https://x.ai/api',
      billingModel: 'pay_as_you_go',
      modelDiscoveryMode: 'catalog_only',
      notes: [
        'Uses xAI API billing. This is separate from a SuperGrok subscription login.',
        'API keys are stored using CodePilotâs current local SQLite credential boundary; encrypted-at-rest migration remains tracked separately.',
      ],
      notesZh: [
        'ä½¿ç¨ xAI API è´¦æ·è®¡è´¹ï¼ä¸ SuperGrok è®¢éç»å½ç¸äºç¬ç«ã?,
        'API Key æ²¿ç¨ CodePilot å½åæ¬å° SQLite å­æ®è¾¹çï¼å å¯è½çè¿ç§»ä»ç±ç¬ç«ææ¯åºè·è¸ªã?,
      ],
    },
  },

  // ââ OpenRouter ââ
  {
    key: 'openrouter',
    name: 'OpenRouter',
    description: 'Use OpenRouter to access multiple models',
    descriptionZh: 'éè¿ OpenRouter è®¿é®å¤ç§æ¨¡å',
    protocol: 'openrouter',
    authStyle: 'auth_token',
    baseUrl: 'https://openrouter.ai/api',
    defaultEnvOverrides: {},
    // Round 8 (2026-05-18) â?was ANTHROPIC_DEFAULT_MODELS (bare
    // sonnet/opus/haiku aliases). OpenRouter rejected the aliases
    // with "is not a valid model ID"; we now ship the fully-
    // qualified `anthropic/claude-<role>-<version>` slugs via
    // upstreamModelId. The resolver reads catalogEntry.upstreamModelId
    // (provider-resolver.ts:424) so existing role-based pickers keep
    // working with the short aliases on the UI side.
    defaultModels: OPENROUTER_ANTHROPIC_MODELS,
    fields: ['api_key'],
    iconKey: 'openrouter',
    meta: {
      apiKeyUrl: 'https://openrouter.ai/workspaces/default/keys',
      docsUrl: 'https://openrouter.ai/docs/guides/coding-agents/claude-code-integration',
      billingModel: 'pay_as_you_go',
    },
  },

  // ââ Zhipu GLM (China) ââ
  {
    key: 'glm-cn',
    name: 'GLM (CN)',
    description: 'Zhipu GLM Code Plan â?China region',
    descriptionZh: 'æºè°± GLM ç¼ç¨å¥é¤ â?ä¸­å½å?,
    protocol: 'anthropic',
    authStyle: 'auth_token',
    baseUrl: 'https://open.bigmodel.cn/api/anthropic',
    defaultEnvOverrides: {
      API_TIMEOUT_MS: '3000000',
      CLAUDE_CODE_AUTO_COMPACT_WINDOW: '1000000',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'glm-4.7',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-5.3[1m]',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-5.3[1m]',
    },
    defaultModels: GLM_CODING_PLAN_MODELS,
    defaultRoleModels: {
      default: 'glm-5.3[1m]',
      sonnet: 'glm-5.3[1m]',
      opus: 'glm-5.3[1m]',
      haiku: 'glm-4.7',
    },
    wireCapabilities: {
      anthropicEffort: { modelIds: ['glm-5.3[1m]'] },
      codexResponses: {
        baseUrl: 'https://open.bigmodel.cn/api/v1',
        modelIds: ['glm-5.3[1m]', 'glm-5-turbo'],
        modelIdOverrides: { 'glm-5.3[1m]': 'glm-5.3' },
        effortAliases: { minimal: 'low', medium: 'high', xhigh: 'max' },
        supportsReasoningSummary: true,
      },
    },
    fields: ['api_key'],
    iconKey: 'zhipu',
    sdkProxyOnly: true,
    meta: {
      apiKeyUrl: 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys',
      docsUrl: 'https://docs.bigmodel.cn/cn/coding-plan/tool/claude',
      pricingUrl: 'https://docs.bigmodel.cn/cn/coding-plan/overview',
      billingModel: 'coding_plan',
      notes: [
        'GLM-5.3 points: input 6.9, cached input 1.7, output 24.',
        'Off-peak requests use 50% of the listed points; peak hours are weekdays 14:00â?8:00 (UTC+8).',
      ],
      notesZh: [
        'GLM-5.3 ç§¯ååçï¼è¾å?6.9ãç¼å­è¾å?1.7ãè¾å?24ã?,
        'éé«å³°æ¶æ®µæè¡¨åç§¯åç?50% æ¶èï¼é«å³°æ¶æ®µä¸ºå·¥ä½æ¥ 14:00â?8:00ï¼UTC+8ï¼ã?,
      ],
      claudeCodeVerified: true,
    },
  },

  // ââ Zhipu GLM (Global) ââ
  {
    key: 'glm-global',
    name: 'GLM (Global)',
    description: 'Zhipu GLM Code Plan â?Global region',
    descriptionZh: 'æºè°± GLM ç¼ç¨å¥é¤ â?å½éå?,
    protocol: 'anthropic',
    authStyle: 'auth_token',
    baseUrl: 'https://api.z.ai/api/anthropic',
    defaultEnvOverrides: {
      API_TIMEOUT_MS: '3000000',
      CLAUDE_CODE_AUTO_COMPACT_WINDOW: '1000000',
      ANTHROPIC_DEFAULT_HAIKU_MODEL: 'glm-4.7',
      ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-5.3[1m]',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-5.3[1m]',
    },
    defaultModels: GLM_CODING_PLAN_MODELS,
    defaultRoleModels: {
      default: 'glm-5.3[1m]',
      sonnet: 'glm-5.3[1m]',
      opus: 'glm-5.3[1m]',
      haiku: 'glm-4.7',
    },
    wireCapabilities: {
      anthropicEffort: { modelIds: ['glm-5.3[1m]'] },
      codexResponses: {
        baseUrl: 'https://api.z.ai/api/v1',
        modelIds: ['glm-5.3[1m]', 'glm-5-turbo'],
        modelIdOverrides: { 'glm-5.3[1m]': 'glm-5.3' },
        effortAliases: { minimal: 'low', medium: 'high', xhigh: 'max' },
        supportsReasoningSummary: true,
      },
    },
    fields: ['api_key'],
    iconKey: 'zhipu',
    sdkProxyOnly: true,
    meta: {
      apiKeyUrl: 'https://z.ai/manage-apikey/apikey-list',
      docsUrl: 'https://docs.z.ai/devpack/tool/claude',
      pricingUrl: 'https://docs.z.ai/devpack/overview',
      billingModel: 'coding_plan',
      notes: [
        'GLM-5.3 points: input 6.9, cached input 1.7, output 24.',
        'Off-peak requests use 50% of the listed points; peak hours are weekdays 14:00â?8:00 (UTC+8).',
      ],
      notesZh: [
        'GLM-5.3 ç§¯ååçï¼è¾å?6.9ãç¼å­è¾å?1.7ãè¾å?24ã?,
        'éé«å³°æ¶æ®µæè¡¨åç§¯åç?50% æ¶èï¼é«å³°æ¶æ®µä¸ºå·¥ä½æ¥ 14:00â?8:00ï¼UTC+8ï¼ã?,
      ],
      claudeCodeVerified: true,
    },
  },

  // ââ Kimi ââ
  {
    key: 'kimi',
    name: 'Kimi Coding Plan',
    description: 'Kimi Coding Plan API',
    descriptionZh: 'Kimi ç¼ç¨è®¡å API',
    protocol: 'anthropic',
    authStyle: 'api_key',
    baseUrl: 'https://api.kimi.com/coding/',
    defaultEnvOverrides: { ENABLE_TOOL_SEARCH: 'false' },
    // Phase 1 (2026-07-17, reaffirmed 2026-07-19) â?`Kimi for Coding` is the
    // product/channel the user picks. The vendor also publishes versioned IDs
    // such as `k3`; they are NOT aliases we can infer from this display name.
    // Per the product decision, buckyball.ai sends the channel's own documented
    // `kimi-for-coding` wire ID and deliberately keeps the backing/version name
    // out of the UI. No explicit `k3` row is added and no K3 compatibility
    // branch is needed when the channel's backing implementation changes.
    defaultModels: [
      {
        // `sonnet` is a legacy UI/DB alias, NOT a Kimi model: existing
        // providers have a provider_models row and sessions pinned to this
        // id, so renaming it would strand them. It stays the id; the wire
        // truth is upstreamModelId.
        modelId: 'sonnet',
        // Explicit upstream so the request carries the product channel's own
        // wire id â?never a version id inferred from the display name.
        // Previously absent, which left resolveProvider falling through to
        // its single-model alias fallback (provider-resolver.ts:~590) and
        // shipping the bare string `sonnet` to Kimi.
        upstreamModelId: 'kimi-for-coding',
        displayName: 'Kimi for Coding',
        role: 'default',
        capabilities: {
          supportsEffort: true,
          // Kimi's 2026-07-16 K3 release notes document low/high/max for the
          // model currently served by Kimi Code. Keep the product/channel name
          // stable in the UI while exposing the channel's current effort
          // contract. `auto` remains buckyball.ai's own
          // "send no effort at all" option (src/lib/effort-levels.ts), not a
          // Kimi tier; the note key makes that distinction explicit.
          supportedEffortLevels: ['low', 'high', 'max'],
          effortNoteKey: 'messageInput.effort.note.kimiAuto',
        },
      },
    ],
    fields: ['api_key'],
    iconKey: 'kimi',
    sdkProxyOnly: true,
    meta: {
      apiKeyUrl: 'https://www.kimi.com/code/console',
      docsUrl: 'https://www.kimi.com/code/docs/more/third-party-agents.html',
      billingModel: 'pay_as_you_go',
      notes: [],
      claudeCodeVerified: true,
    },
  },

  // ââ Moonshot ââ
  {
    key: 'moonshot',
    name: 'Moonshot',
    description: 'Moonshot AI API',
    descriptionZh: 'æä¹æé¢ API',
    protocol: 'anthropic',
    authStyle: 'auth_token',
    baseUrl: 'https://api.moonshot.cn/anthropic',
    defaultEnvOverrides: { ENABLE_TOOL_SEARCH: 'false' },
    defaultModels: [
      { modelId: 'sonnet', displayName: 'Kimi K2.5', role: 'default' },
    ],
    fields: ['api_key'],
    iconKey: 'moonshot',
    sdkProxyOnly: true,
    meta: {
      apiKeyUrl: 'https://platform.moonshot.cn/console/api-keys',
      docsUrl: 'https://platform.moonshot.cn/docs/guide/agent-support',
      billingModel: 'pay_as_you_go',
      notes: ['å»ºè®®è®¾ç½®æ¯æ¥æ¶è´¹ä¸éï¼é²æ­?agentic å¾ªç¯å¿«éæ¶è?token'],
      claudeCodeVerified: true,
    },
  },

  // ââ MiniMax (China) ââ
  {
    key: 'minimax-cn',
    name: 'MiniMax (CN)',
    description: 'MiniMax Code Plan â?China region',
    descriptionZh: 'MiniMax ç¼ç¨å¥é¤ â?ä¸­å½å?,
    protocol: 'anthropic',
    authStyle: 'auth_token',
    baseUrl: 'https://api.minimaxi.com/anthropic',
    defaultEnvOverrides: {
      API_TIMEOUT_MS: '3000000',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    },
    defaultModels: [
      { modelId: 'sonnet', upstreamModelId: 'MiniMax-M2.7', displayName: 'MiniMax-M2.7', role: 'default' },
    ],
    defaultRoleModels: {
      default: 'MiniMax-M2.7',
      sonnet: 'MiniMax-M2.7',
      opus: 'MiniMax-M2.7',
      haiku: 'MiniMax-M2.7',
    },
    fields: ['api_key'],
    iconKey: 'minimax',
    sdkProxyOnly: true,
    meta: {
      apiKeyUrl: 'https://platform.minimaxi.com/user-center/payment/token-plan',
      docsUrl: 'https://platform.minimaxi.com/docs/token-plan/claude-code',
      billingModel: 'token_plan',
      claudeCodeVerified: true,
    },
  },

  // ââ MiniMax (Global) ââ
  {
    key: 'minimax-global',
    name: 'MiniMax (Global)',
    description: 'MiniMax Code Plan â?Global region',
    descriptionZh: 'MiniMax ç¼ç¨å¥é¤ â?å½éå?,
    protocol: 'anthropic',
    authStyle: 'auth_token',
    baseUrl: 'https://api.minimax.io/anthropic',
    defaultEnvOverrides: {
      API_TIMEOUT_MS: '3000000',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    },
    defaultModels: [
      { modelId: 'sonnet', upstreamModelId: 'MiniMax-M2.7', displayName: 'MiniMax-M2.7', role: 'default' },
    ],
    defaultRoleModels: {
      default: 'MiniMax-M2.7',
      sonnet: 'MiniMax-M2.7',
      opus: 'MiniMax-M2.7',
      haiku: 'MiniMax-M2.7',
    },
    fields: ['api_key'],
    iconKey: 'minimax',
    sdkProxyOnly: true,
    meta: {
      apiKeyUrl: 'https://platform.minimax.io/user-center/payment/token-plan',
      docsUrl: 'https://platform.minimax.io/docs/token-plan/opencode',
      billingModel: 'token_plan',
      claudeCodeVerified: true,
    },
  },

  // ââ Volcengine Ark ââ
  {
    key: 'volcengine',
    name: 'Volcengine Ark',
    description: 'Volcengine Ark Coding Plan â?Doubao, GLM, DeepSeek, Kimi',
    descriptionZh: 'å­èç«å±±æ¹è Coding Plan â?è±åãGLMãDeepSeekãKimi',
    protocol: 'anthropic',
    authStyle: 'auth_token',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/coding',
    defaultEnvOverrides: {},
    // Volcengine Ark Coding Plan whitelist. Volcengine's docs explicitly
    // separate "Coding Plan Model Name" (what users put in ANTHROPIC_MODEL)
    // from the much larger online-inference Model ID space served by
    // Ark â?never auto-probe that endpoint for a Coding Plan provider
    // (handled by the Coding/Token Plan gate in model-discovery.ts).
    // The eight standard SKUs cover the Doubao + cross-vendor lineup;
    // `ark-code-latest` is a special console-managed entry where the
    // actual model is selected by Volcengine's Ark console (Auto mode)
    // â?flagged in the displayName so users know it's not a stable
    // pinned model.
    defaultModels: [
      { modelId: 'doubao-seed-2.0-code', displayName: 'Doubao Seed 2.0 Code', role: 'default' },
      { modelId: 'doubao-seed-2.0-pro', displayName: 'Doubao Seed 2.0 Pro' },
      { modelId: 'doubao-seed-2.0-lite', displayName: 'Doubao Seed 2.0 Lite' },
      { modelId: 'doubao-seed-code', displayName: 'Doubao Seed Code' },
      { modelId: 'minimax-m2.5', displayName: 'MiniMax M2.5' },
      { modelId: 'glm-4.7', displayName: 'GLM-4.7' },
      { modelId: 'deepseek-v3.2', displayName: 'DeepSeek V3.2' },
      { modelId: 'kimi-k2.5', displayName: 'Kimi K2.5' },
      { modelId: 'ark-code-latest', displayName: 'ark-code-latest (Console-managed / Auto)' },
    ],
    fields: ['api_key', 'model_names'],
    iconKey: 'volcengine',
    sdkProxyOnly: true,
    meta: {
      apiKeyUrl: 'https://console.volcengine.com/ark/region:ark+cn-beijing/openManagement',
      docsUrl: 'https://www.volcengine.com/docs/82379/1928262',
      billingModel: 'coding_plan',
      notes: ['éåå¨æ§å¶å°æ¿æ´?Endpoint', 'API Key ä¸ºä¸´æ¶å­è¯?],
      claudeCodeVerified: true,
    },
  },

  // ââ Xiaomi MiMo (æéä»è´¹) ââ
  {
    key: 'xiaomi-mimo',
    name: 'Xiaomi MiMo',
    description: 'Xiaomi MiMo Pay-as-you-go API â?MiMo-V2.5-Pro',
    descriptionZh: 'å°ç±³ MiMo æéä»è´¹ â?MiMo-V2.5-Pro',
    protocol: 'anthropic',
    authStyle: 'auth_token',
    baseUrl: 'https://api.xiaomimimo.com/anthropic',
    defaultEnvOverrides: {},
    defaultModels: [
      { modelId: 'sonnet', upstreamModelId: 'mimo-v2.5-pro', displayName: 'MiMo-V2.5-Pro', role: 'default' },
      // UltraSpeed â?high-throughput experience mode of MiMo-V2.5-Pro.
      // Optional + approval-gated by Xiaomi, so NOT the default. The official
      // model page lists Anthropic-protocol access on this same .../anthropic
      // channel with model="mimo-v2.5-pro-ultraspeed" (streaming + thinking) â?      // verified against the page's Anthropic-protocol sample 2026-06-09.
      // Capabilities limited to what the doc states; no unsourced contextWindow.
      { modelId: 'mimo-v2.5-pro-ultraspeed', upstreamModelId: 'mimo-v2.5-pro-ultraspeed', displayName: 'MiMo-V2.5-Pro-UltraSpeed', capabilities: { toolUse: true, reasoning: true } },
    ],
    defaultRoleModels: {
      default: 'mimo-v2.5-pro',
      sonnet: 'mimo-v2.5-pro',
      opus: 'mimo-v2.5-pro',
      haiku: 'mimo-v2.5-pro',
    },
    // model_names: MiMo has no /v1/models discovery (sdkProxyOnly) and ships
    // new model ids (v2.5 / v2.5pro) over time. Without a model field the
    // connect dialog saved role_models_json:'{}', so the resolver back-filled
    // the stale `mimo-v2-pro` default every send (#577). Exposing model_names
    // lets the user set their actual model, which the resolver then honors.
    fields: ['api_key', 'model_names'],
    iconKey: 'xiaomi-mimo',
    sdkProxyOnly: true,
    meta: {
      apiKeyUrl: 'https://platform.xiaomimimo.com/#/console/api-keys',
      docsUrl: 'https://platform.xiaomimimo.com/#/docs/integration/claudecode',
      billingModel: 'pay_as_you_go',
      notes: [],
      claudeCodeVerified: true,
    },
  },

  // ââ Xiaomi MiMo Token Plan (è®¢éå¥é¤) ââ
  {
    key: 'xiaomi-mimo-token-plan',
    name: 'Xiaomi MiMo Token Plan',
    description: 'Xiaomi MiMo Token Plan subscription â?MiMo-V2.5-Pro',
    descriptionZh: 'å°ç±³ MiMo Token Plan è®¢éå¥é¤ â?MiMo-V2.5-Pro',
    protocol: 'anthropic',
    authStyle: 'auth_token',
    baseUrl: 'https://token-plan-cn.xiaomimimo.com/anthropic',
    defaultEnvOverrides: {},
    defaultModels: [
      { modelId: 'sonnet', upstreamModelId: 'mimo-v2.5-pro', displayName: 'MiMo-V2.5-Pro', role: 'default' },
    ],
    defaultRoleModels: {
      default: 'mimo-v2.5-pro',
      sonnet: 'mimo-v2.5-pro',
      opus: 'mimo-v2.5-pro',
      haiku: 'mimo-v2.5-pro',
    },
    // model_names: same as the pay-as-you-go preset above â?lets Token Plan
    // users set their actual MiMo model instead of being pinned to the stale
    // `mimo-v2-pro` default (#577).
    fields: ['api_key', 'model_names'],
    iconKey: 'xiaomi-mimo',
    sdkProxyOnly: true,
    meta: {
      apiKeyUrl: 'https://platform.xiaomimimo.com/#/console/plan-manage',
      docsUrl: 'https://platform.xiaomimimo.com/#/docs/integration/claudecode',
      billingModel: 'token_plan',
      notes: [],
      claudeCodeVerified: true,
    },
  },

  // ââ Aliyun Bailian ââ
  {
    key: 'bailian',
    name: 'Aliyun Bailian',
    description: 'Aliyun Bailian Coding Plan â?Qwen, GLM, Kimi, MiniMax',
    descriptionZh: 'é¿éäºç¾ç?Coding Plan â?éä¹åé®ãGLMãKimiãMiniMax',
    protocol: 'anthropic',
    authStyle: 'auth_token',
    baseUrl: 'https://coding.dashscope.aliyuncs.com/apps/anthropic',
    defaultEnvOverrides: {},
    // Exact Coding Plan text whitelist, verified against the official page on
    // 2026-07-21. This product has a separate host and lifecycle from Qwen
    // Token Plan; do not merge the identities even though both use sk-sp keys.
    defaultModels: [
      { modelId: 'qwen3.7-plus', displayName: 'Qwen 3.7 Plus' },
      { modelId: 'qwen3.6-plus', displayName: 'Qwen 3.6 Plus', role: 'default' },
      { modelId: 'qwen3.5-plus', displayName: 'Qwen 3.5 Plus' },
      { modelId: 'qwen3-max-2026-01-23', displayName: 'Qwen 3 Max (2026-01-23)' },
      { modelId: 'qwen3-coder-next', displayName: 'Qwen 3 Coder Next' },
      { modelId: 'qwen3-coder-plus', displayName: 'Qwen 3 Coder Plus' },
      { modelId: 'kimi-k2.5', displayName: 'Kimi K2.5' },
      { modelId: 'glm-5', displayName: 'GLM-5' },
      { modelId: 'glm-4.7', displayName: 'GLM-4.7' },
      { modelId: 'MiniMax-M2.5', displayName: 'MiniMax-M2.5' },
    ],
    fields: ['api_key'],
    iconKey: 'bailian',
    sdkProxyOnly: true,
    usagePolicy: 'interactive_only',
    meta: {
      apiKeyUrl: 'https://bailian.console.aliyun.com',
      docsUrl: 'https://help.aliyun.com/zh/model-studio/coding-plan',
      purchaseUrl: 'https://bailian.console.aliyun.com/?tab=model#/efm/coding_plan',
      billingModel: 'coding_plan',
      notes: [
        'Use a Coding Plan key (sk-sp-); regular DashScope keys are not interchangeable.',
        'Lite is available only to existing subscribers and no longer supports new purchases or renewal; Pro is sold in limited availability.',
        'Coding Plan is metered by model calls and is limited to interactive coding tools, not automation scripts or application backends.',
      ],
      notesZh: [
        'å¿é¡»ä½¿ç¨ Coding Plan ä¸ç¨ Keyï¼ä»¥ sk-sp- å¼å¤´ï¼ï¼æ®é?DashScope Key ä¸éç¨ã?,
        'Lite ä»ä¾å­éç¨æ·ä½¿ç¨ï¼å·²åæ­¢æ°è´­åç»­è´¹ï¼Pro ééå¯è´­ã?,
        'Coding Plan ææ¨¡åè°ç¨æ¬¡æ°è®¡éï¼ä»éäº¤äºå¼ç¼ç¨å·¥å·ï¼ä¸å¾ç¨äºèªå¨åèæ¬æåºç¨åç«¯ã?,
      ],
      claudeCodeVerified: true,
    },
  },

  // ââ Qwen Token Plan ä¸ªäººç?ââ
  // Personal and team share the same endpoint. `preset_key` is therefore the
  // only product identity; URL matching deliberately returns ambiguous.
  {
    key: 'qwen-token-plan-personal-cn',
    name: 'Qwen Token Plan Personal',
    description: 'Qwen Token Plan Personal â?rolling credits for individual interactive coding and agent tools',
    descriptionZh: 'åé® Token Plan ä¸ªäººç?â?é¢åä¸ªäººäº¤äºå¼ç¼ç¨ä¸æºè½ä½å·¥å·çæ»å¨é¢åº¦å¥é¤',
    protocol: 'anthropic',
    authStyle: 'auth_token',
    baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic',
    defaultEnvOverrides: {
      CLAUDE_CODE_SUBAGENT_MODEL: 'qwen3.7-max',
    },
    defaultModels: [
      {
        modelId: 'qwen3.8-max-preview',
        displayName: 'Qwen 3.8 Max Preview',
        role: 'default',
        capabilities: {
          reasoning: true,
          contextWindow: 983616,
          supportsEffort: true,
          supportedEffortLevels: ['low', 'high', 'xhigh'],
          thinkingMode: 'always',
          defaultEffortLevel: 'xhigh',
          thinkingTemperatureDefault: 0.6,
          thinkingTemperatureMin: 0.6,
          temperatureClampBehavior: 'upstream_clamps_below_min',
        },
      },
      { modelId: 'qwen3.7-max', displayName: 'Qwen 3.7 Max' },
      { modelId: 'qwen3.7-plus', displayName: 'Qwen 3.7 Plus' },
      { modelId: 'qwen3.6-flash', displayName: 'Qwen 3.6 Flash', role: 'haiku' },
      { modelId: 'glm-5.2', displayName: 'GLM-5.2' },
      { modelId: 'deepseek-v4-pro', displayName: 'DeepSeek V4 Pro' },
    ],
    defaultRoleModels: {
      default: 'qwen3.8-max-preview',
      sonnet: 'qwen3.8-max-preview',
      opus: 'qwen3.8-max-preview',
      haiku: 'qwen3.6-flash',
    },
    fields: ['api_key'],
    iconKey: 'bailian',
    sdkProxyOnly: true,
    usagePolicy: 'interactive_only',
    meta: {
      apiKeyUrl: 'https://platform.qianwenai.com/docs/api-reference/preparation/api-key',
      docsUrl: 'https://platform.qianwenai.com/docs/token-plan/personal/token-plan-personal-overview',
      purchaseUrl: 'https://platform.qianwenai.com/token-plan',
      billingModel: 'token_plan',
      notes: [
        'Personal credits use rolling 5-hour and 7-day windows; one plan may be purchased per verified identity.',
        'Personal usage includes the planâs data-optimization authorization. Review the official terms before connecting.',
        'The plan key is shown in full only when created or reset. Store it before leaving the Qwen platform.',
        'For interactive coding and agent tools only; automation scripts, application backends, and batch jobs are not allowed.',
      ],
      notesZh: [
        'ä¸ªäººçé¢åº¦æ 5 å°æ¶ä¸?7 å¤©æ»å¨çªå£è®¡ç®ï¼åä¸å®åè®¤è¯ä¸»ä½éè´­ä¸ä»½ã?,
        'ä¸ªäººçåå«å¥é¤çæ°æ®ä¼åææï¼è¯·å¨è¿æ¥åéè¯»å®æ¹æ¡æ¬¾ã?,
        'å¥é¤ Key ä»å¨åå»ºæéç½®æ¶å®æ´æ¾ç¤ºä¸æ¬¡ï¼è¯·åå¦¥åä¿å­ã?,
        'ä»éäº¤äºå¼ç¼ç¨ä¸æºè½ä½å·¥å·ï¼ä¸å¾ç¨äºèªå¨åèæ¬ãåºç¨åç«¯ææ¹éä»»å¡ã?,
      ],
    },
  },

  // ââ Qwen Token Plan å¢éç?ââ
  {
    key: 'bailian-token-plan-cn',
    name: 'Qwen Token Plan Team',
    description: 'Qwen Token Plan Team â?seat-based credits for interactive coding and agent tools',
    descriptionZh: 'åé® Token Plan å¢éç?â?é¢åå¢éäº¤äºå¼ç¼ç¨ä¸æºè½ä½å·¥å·çå¸­ä½å¶é¢åº¦å¥é¤?,
    protocol: 'anthropic',
    authStyle: 'auth_token',
    baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic',
    defaultEnvOverrides: {
      CLAUDE_CODE_SUBAGENT_MODEL: 'qwen3.7-max',
    },
    defaultModels: [
      {
        modelId: 'qwen3.8-max-preview',
        displayName: 'Qwen 3.8 Max Preview',
        role: 'default',
        capabilities: {
          reasoning: true,
          contextWindow: 983616,
          supportsEffort: true,
          supportedEffortLevels: ['low', 'high', 'xhigh'],
          thinkingMode: 'always',
          defaultEffortLevel: 'xhigh',
          thinkingTemperatureDefault: 0.6,
          thinkingTemperatureMin: 0.6,
          temperatureClampBehavior: 'upstream_clamps_below_min',
        },
      },
      { modelId: 'qwen3.7-max', displayName: 'Qwen 3.7 Max' },
      { modelId: 'qwen3.7-plus', displayName: 'Qwen 3.7 Plus' },
      { modelId: 'qwen3.6-plus', displayName: 'Qwen 3.6 Plus' },
      { modelId: 'qwen3.6-flash', displayName: 'Qwen 3.6 Flash', role: 'haiku' },
      { modelId: 'deepseek-v4-pro', displayName: 'DeepSeek V4 Pro' },
      { modelId: 'deepseek-v4-flash', displayName: 'DeepSeek V4 Flash' },
      { modelId: 'deepseek-v3.2', displayName: 'DeepSeek V3.2' },
      { modelId: 'kimi-k2.7-code', displayName: 'Kimi K2.7 Code' },
      { modelId: 'kimi-k2.6', displayName: 'Kimi K2.6' },
      { modelId: 'kimi-k2.5', displayName: 'Kimi K2.5' },
      { modelId: 'glm-5.2', displayName: 'GLM-5.2' },
      { modelId: 'glm-5.1', displayName: 'GLM-5.1' },
      { modelId: 'glm-5', displayName: 'GLM-5' },
      { modelId: 'MiniMax-M2.5', displayName: 'MiniMax-M2.5' },
    ],
    defaultRoleModels: {
      default: 'qwen3.8-max-preview',
      sonnet: 'qwen3.8-max-preview',
      opus: 'qwen3.8-max-preview',
      haiku: 'qwen3.6-flash',
    },
    fields: ['api_key'],
    iconKey: 'bailian',
    sdkProxyOnly: true,
    usagePolicy: 'interactive_only',
    meta: {
      apiKeyUrl: 'https://platform.qianwenai.com/docs/api-reference/preparation/api-key',
      docsUrl: 'https://platform.qianwenai.com/docs/token-plan/team/token-plan-team-overview',
      purchaseUrl: 'https://platform.qianwenai.com/token-plan',
      billingModel: 'token_plan',
      notes: [
        'Team plans are seat-based. The official terms state conversation data is not used for training.',
        'The plan key is shown in full only when created or reset; it is not interchangeable with Coding Plan or regular DashScope keys.',
        'For interactive coding and agent tools only; automation scripts, application backends, and batch jobs are not allowed.',
      ],
      notesZh: [
        'å¢éçæå¸­ä½è®¡è´¹ï¼å®æ¹æ¡æ¬¾æ¿è¯ºä¸ä½¿ç¨å¯¹è¯æ°æ®è¿è¡æ¨¡åè®­ç»ã?,
        'å¥é¤ Key ä»å¨åå»ºæéç½®æ¶å®æ´æ¾ç¤ºä¸æ¬¡ï¼ä¸ä¸ Coding Plan / æ®é?DashScope Key ä¸éç¨ã?,
        'ä»éäº¤äºå¼ç¼ç¨ä¸æºè½ä½å·¥å·ï¼ä¸å¾ç¨äºèªå¨åèæ¬ãåºç¨åç«¯ææ¹éä»»å¡ã?,
      ],
    },
  },

  // ââ ClinePass ââ
  // ClinePass subscription accessed through the Cline API (OpenAI-compatible
  // Chat Completions). Models use the `cline-pass/<id>` slug â?that IS the
  // value sent to the API, so modelId == upstream (no alias). The Cline API
  // is a multi-provider aggregator; its `/v1/models` returns far more than the
  // ClinePass whitelist AND needs a key, so discovery is `catalog_only`:
  // ship the 11-model whitelist as truth, no refresh / no search-and-add.
  // NOT sdkProxyOnly â?OpenAI-compatible reaches CodePilot + Codex runtimes
  // via the AI SDK chat path, never the Claude Code subprocess.
  {
    key: 'cline-pass',
    name: 'ClinePass',
    description: 'ClinePass subscription â?open coding models via the Cline API (CodePilot / Codex runtimes)',
    descriptionZh: 'ClinePass è®¢é â?éè¿ Cline API è®¿é®å¼æºç¼ç¨æ¨¡åï¼ç¨äº CodePilot / Codex è¿è¡æ¶ï¼',
    protocol: 'openai-compatible',
    authStyle: 'api_key',
    baseUrl: 'https://api.cline.bot/api/v1',
    defaultEnvOverrides: {},
    // ClinePass whitelist â?https://cline.bot/models plus the Cline API model
    // id contract at https://docs.cline.bot/api/models. Kimi K3 was added
    // 2026-07-20 from the current product lineup; the public static model
    // directory still lagged that rollout, so its exact cline-pass/kimi-k3 id
    // is pinned by the provider/model-name contract and a real-key smoke.
    // The cline-pass/ prefix is part of the model id sent to
    // /chat/completions, so no upstreamModelId alias is needed.
    defaultModels: [
      { modelId: 'cline-pass/glm-5.2', displayName: 'GLM-5.2', capabilities: { toolUse: true } },
      { modelId: 'cline-pass/kimi-k3', displayName: 'Kimi K3', capabilities: { toolUse: true } },
      { modelId: 'cline-pass/kimi-k2.7-code', displayName: 'Kimi K2.7 Code', capabilities: { toolUse: true } },
      { modelId: 'cline-pass/kimi-k2.6', displayName: 'Kimi K2.6', capabilities: { toolUse: true } },
      { modelId: 'cline-pass/deepseek-v4-pro', displayName: 'DeepSeek V4 Pro', capabilities: { toolUse: true } },
      { modelId: 'cline-pass/deepseek-v4-flash', displayName: 'DeepSeek V4 Flash', capabilities: { toolUse: true } },
      { modelId: 'cline-pass/mimo-v2.5', displayName: 'MiMo-V2.5', capabilities: { toolUse: true } },
      { modelId: 'cline-pass/mimo-v2.5-pro', displayName: 'MiMo-V2.5-Pro', capabilities: { toolUse: true } },
      { modelId: 'cline-pass/minimax-m3', displayName: 'MiniMax M3', capabilities: { toolUse: true } },
      { modelId: 'cline-pass/qwen3.7-max', displayName: 'Qwen3.7 Max', capabilities: { toolUse: true } },
      { modelId: 'cline-pass/qwen3.7-plus', displayName: 'Qwen3.7 Plus', capabilities: { toolUse: true } },
    ],
    fields: ['api_key'],
    iconKey: 'cline',
    meta: {
      apiKeyUrl: 'https://app.cline.bot',
      docsUrl: 'https://docs.cline.bot/getting-started/clinepass',
      billingModel: 'coding_plan',
      modelDiscoveryMode: 'catalog_only',
      notes: ['æ¨¡åä½¿ç¨ cline-pass/<model-id> å½¢å¼ï¼ç±è®¢éç½ååå®ä¹ï¼ä¸åå¨çº¿å·æ°ã?],
    },
  },

  // ââ OpenCode Go (OpenAI-compatible) ââ
  // OpenCode Zen "Go" subscription, OpenAI-compatible half. Same host + key as
  // the Anthropic half below; split into two presets because protocol lives at
  // the provider layer (no per-model wire dispatch). `/zen/go/v1/models` is a
  // single MIXED catalog (both wire protocols) and a superset of this plan's
  // lineup, so discovery is `catalog_only` â?auto-import would put `/messages`-
  // only models on the `/chat/completions` path. Models use bare ids (the
  // `opencode-go/` prefix is OpenCode-config-only, not the API model field).
  {
    key: 'opencode-go-openai',
    name: 'OpenCode Go (OpenAI)',
    description: 'OpenCode Zen Go subscription â?OpenAI-compatible models (CodePilot / Codex runtimes)',
    descriptionZh: 'OpenCode Zen Go è®¢é â?OpenAI å¼å®¹æ¨¡åï¼ç¨äº?CodePilot / Codex è¿è¡æ¶ï¼',
    protocol: 'openai-compatible',
    authStyle: 'api_key',
    baseUrl: 'https://opencode.ai/zen/go/v1',
    defaultEnvOverrides: {},
    // OpenAI-compatible half of the official endpoint table â?    // https://dev.opencode.ai/docs/go/ (verified 2026-07-20).
    defaultModels: [
      { modelId: 'glm-5.2', displayName: 'GLM-5.2', capabilities: { toolUse: true } },
      { modelId: 'glm-5.1', displayName: 'GLM-5.1', capabilities: { toolUse: true } },
      { modelId: 'kimi-k3', displayName: 'Kimi K3', capabilities: { toolUse: true } },
      { modelId: 'kimi-k2.7-code', displayName: 'Kimi K2.7 Code', capabilities: { toolUse: true } },
      { modelId: 'kimi-k2.6', displayName: 'Kimi K2.6', capabilities: { toolUse: true } },
      { modelId: 'deepseek-v4-pro', displayName: 'DeepSeek V4 Pro', capabilities: { toolUse: true } },
      { modelId: 'deepseek-v4-flash', displayName: 'DeepSeek V4 Flash', capabilities: { toolUse: true } },
      { modelId: 'mimo-v2.5', displayName: 'MiMo-V2.5', capabilities: { toolUse: true } },
      { modelId: 'mimo-v2.5-pro', displayName: 'MiMo-V2.5-Pro', capabilities: { toolUse: true } },
    ],
    fields: ['api_key'],
    iconKey: 'opencode',
    meta: {
      apiKeyUrl: 'https://opencode.ai/auth',
      docsUrl: 'https://opencode.ai/docs/zh-cn/go/',
      billingModel: 'coding_plan',
      modelDiscoveryMode: 'catalog_only',
      notes: ['ä¸ãOpenCode Go (Anthropic)ãå±ç¨åä¸è®¢é Keyï¼æ¨¡åç±å¥é¤ç½ååå®ä¹ã?],
    },
  },

  // ââ OpenCode Go (Anthropic Messages) ââ
  // Anthropic-Messages half of the same OpenCode Go subscription. The real
  // endpoint is https://opencode.ai/zen/go/v1/messages, but the base is stored
  // WITHOUT the trailing /v1 on purpose. The Claude Code SDK ALWAYS appends
  // `/v1/messages` to ANTHROPIC_BASE_URL, so a `.../zen/go/v1` base makes the
  // SDK POST to `.../zen/go/v1/v1/messages` â?404 HTML â?surfaced as "model
  // (minimax-m3) doesn't exist" (verified 2026-06-30). (The native
  // ClaudeCodeCompatModel.buildMessagesUrl() actually handles a /v1-ending base
  // fine â?it appends only `/messages` in that case â?so the CodePilot path was
  // already correct; the SDK path was the broken one.) Storing `.../zen/go`
  // makes all three transports converge on the right URL: the SDK appends
  // `/v1/messages`, the adapter's deep-path branch also yields
  // `.../zen/go/v1/messages`, and the Codex provider proxy reuses the adapter.
  // (Every other anthropic preset's base ends in /api/anthropic etc. for the
  // same SDK reason.) Bonus: this base differs from the OpenAI half
  // (`.../zen/go/v1`), so no preset collision. authStyle: api_key â?x-api-key
  // (probe confirmed x-api-key, not Bearer; the endpoint does not require
  // anthropic-version). NOT claudeCodeVerified: ships experimental until a
  // real-key smoke.
  {
    key: 'opencode-go-anthropic',
    name: 'OpenCode Go (Anthropic)',
    description: 'OpenCode Zen Go subscription â?Anthropic Messages models (experimental on Claude Code)',
    descriptionZh: 'OpenCode Zen Go è®¢é â?Anthropic Messages æ¨¡åï¼Claude Code å¼å®¹æ§å®éªä¸­ï¼?,
    protocol: 'anthropic',
    authStyle: 'api_key',
    baseUrl: 'https://opencode.ai/zen/go',
    defaultEnvOverrides: {},
    // Anthropic-Messages half of the official endpoint table â?    // https://opencode.ai/docs/zh-cn/go/ (verified 2026-06-30).
    defaultModels: [
      { modelId: 'minimax-m3', displayName: 'MiniMax M3', capabilities: { toolUse: true } },
      { modelId: 'minimax-m2.7', displayName: 'MiniMax M2.7', capabilities: { toolUse: true } },
      { modelId: 'minimax-m2.5', displayName: 'MiniMax M2.5', capabilities: { toolUse: true } },
      { modelId: 'qwen3.7-max', displayName: 'Qwen3.7 Max', capabilities: { toolUse: true } },
      { modelId: 'qwen3.7-plus', displayName: 'Qwen3.7 Plus', capabilities: { toolUse: true } },
      { modelId: 'qwen3.6-plus', displayName: 'Qwen3.6 Plus', capabilities: { toolUse: true } },
    ],
    fields: ['api_key'],
    iconKey: 'opencode',
    meta: {
      apiKeyUrl: 'https://opencode.ai/auth',
      docsUrl: 'https://opencode.ai/docs/zh-cn/go/',
      billingModel: 'coding_plan',
      modelDiscoveryMode: 'catalog_only',
      notes: [
        'ä¸ãOpenCode Go (OpenAI)ãå±ç¨åä¸è®¢é Keyï¼æ¨¡åç±å¥é¤ç½ååå®ä¹ã?,
        'Anthropic Messages åè®®ï¼Claude Code Runtime å¼å®¹æ§æªç»çå®å­æ®éªè¯ï¼åä»¥å®éªææä¾ã?,
      ],
    },
  },

  // ââ DeepSeek ââ
  {
    key: 'deepseek',
    name: 'DeepSeek',
    description: 'DeepSeek Anthropic-compatible API â?fixed model lineup',
    descriptionZh: 'DeepSeek Anthropic å¼å®¹ API â?æ¨¡åæ¸ååºå®',
    protocol: 'anthropic',
    authStyle: 'auth_token',
    baseUrl: 'https://api.deepseek.com/anthropic',
    defaultEnvOverrides: {
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK: '1',
      CLAUDE_CODE_SUBAGENT_MODEL: 'deepseek-v4-flash',
    },
    // DeepSeek catalog â?verified against
    // https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/claude_code,
    // /codex, /guides/thinking_mode, and /quick_start/pricing (verified 2026-08-13).
    // The legacy aliases deepseek-chat
    // and deepseek-reasoner will be deprecated 2026-07-24 and currently
    // map to non-thinking / thinking modes of deepseek-v4-flash, so they
    // are not surfaced as defaults â?users still get them by manual add.
    // The `[1m]` suffix is a Claude Code convention DeepSeek's docs use
    // verbatim to select the 1M-context variant; both v4-pro and v4-flash
    // also have a non-suffixed default-context variant.
    defaultModels: [
      {
        modelId: 'deepseek-v4-pro[1m]',
        upstreamModelId: 'deepseek-v4-pro[1m]',
        displayName: 'DeepSeek V4 Pro (1M)',
        role: 'opus',
        capabilities: {
          reasoning: true,
          toolUse: true,
          contextWindow: 1_048_576,
          supportsEffort: true,
          supportedEffortLevels: ['low', 'high', 'max'],
          defaultEffortLevel: 'high',
        },
      },
      {
        modelId: 'deepseek-v4-pro',
        upstreamModelId: 'deepseek-v4-pro',
        displayName: 'DeepSeek V4 Pro',
        role: 'default',
        capabilities: {
          reasoning: true,
          toolUse: true,
          contextWindow: 1_048_576,
          supportsEffort: true,
          supportedEffortLevels: ['low', 'high', 'max'],
          defaultEffortLevel: 'high',
        },
      },
      {
        modelId: 'deepseek-v4-flash',
        upstreamModelId: 'deepseek-v4-flash',
        displayName: 'DeepSeek V4 Flash',
        role: 'haiku',
        capabilities: {
          reasoning: true,
          toolUse: true,
          contextWindow: 1_048_576,
          supportsEffort: true,
          supportedEffortLevels: ['low', 'high', 'max'],
          defaultEffortLevel: 'high',
        },
      },
    ],
    wireCapabilities: {
      anthropicEffort: {
        modelIds: ['deepseek-v4-pro[1m]', 'deepseek-v4-pro', 'deepseek-v4-flash'],
      },
      codexResponses: {
        baseUrl: 'https://api.deepseek.com',
        modelIds: ['deepseek-v4-flash', 'deepseek-v4-pro'],
        effortAliases: { xhigh: 'high' },
        supportsReasoningSummary: false,
      },
    },
    defaultRoleModels: {
      default: 'deepseek-v4-pro[1m]',
      opus: 'deepseek-v4-pro[1m]',
      sonnet: 'deepseek-v4-pro[1m]',
      haiku: 'deepseek-v4-flash',
    },
    fields: ['api_key'],
    iconKey: 'deepseek',
    sdkProxyOnly: true,
    meta: {
      apiKeyUrl: 'https://platform.deepseek.com/api_keys',
      docsUrl: 'https://api-docs.deepseek.com',
      billingModel: 'pay_as_you_go',
      claudeCodeVerified: true,
      // Catalog is the official lineup, not a starter seed â?when users
      // see e.g. deepseek-v3.2-exp from a previous catalog version still
      // sitting in their list, that's drift, not legitimate custom add.
      // Surfacing the "å·²ä¸å¨å½åæ¨èç®å½? badge for those rows is the
      // intended behavior. (Plan providers are caught by
      // `isCatalogOnlyPlanProviderRecord`; DeepSeek isn't a plan
      // provider but has the same authoritative-catalog property.)
      fixedCatalog: true,
    },
  },

  // ââ AWS Bedrock ââ
  {
    key: 'bedrock',
    name: 'AWS Bedrock',
    description: 'Amazon Bedrock â?requires AWS credentials',
    descriptionZh: 'Amazon Bedrock â?éè¦?AWS å­è¯',
    protocol: 'bedrock',
    authStyle: 'env_only',
    baseUrl: '',
    defaultEnvOverrides: {
      CLAUDE_CODE_USE_BEDROCK: '1',
      AWS_REGION: 'us-east-1',
      CLAUDE_CODE_SKIP_BEDROCK_AUTH: '1',
    },
    defaultModels: BEDROCK_VERTEX_DEFAULT_MODELS,
    fields: ['env_overrides'],
    iconKey: 'bedrock',
    meta: {
      apiKeyUrl: 'https://console.aws.amazon.com',
      docsUrl: 'https://aws.amazon.com/cn/bedrock/anthropic/',
      billingModel: 'pay_as_you_go',
      notes: ['éå?AWS Console è®¢é Claude æ¨¡å'],
    },
  },

  // ââ Google Vertex AI ââ
  {
    key: 'vertex',
    name: 'Google Vertex',
    description: 'Google Vertex AI â?requires GCP credentials',
    descriptionZh: 'Google Vertex AI â?éè¦?GCP å­è¯',
    protocol: 'vertex',
    authStyle: 'env_only',
    baseUrl: '',
    defaultEnvOverrides: {
      CLAUDE_CODE_USE_VERTEX: '1',
      CLOUD_ML_REGION: 'us-east5',
      CLAUDE_CODE_SKIP_VERTEX_AUTH: '1',
    },
    defaultModels: BEDROCK_VERTEX_DEFAULT_MODELS,
    fields: ['env_overrides'],
    iconKey: 'google',
    meta: {
      docsUrl: 'https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-claude',
      billingModel: 'pay_as_you_go',
      notes: ['éå¯ç¨ Vertex AI å¹¶å¨ Model Garden è®¢é Claude æ¨¡å'],
    },
  },

  // ââ Ollama ââ
  {
    key: 'ollama',
    name: 'Ollama',
    description: 'Ollama â?run local models with Anthropic-compatible API',
    descriptionZh: 'Ollama â?æ¬å°è¿è¡æ¨¡åï¼Anthropic å¼å®¹ API',
    protocol: 'anthropic',
    authStyle: 'auth_token',
    baseUrl: 'http://localhost:11434',
    defaultEnvOverrides: {
      ANTHROPIC_AUTH_TOKEN: 'ollama',  // Fixed pseudo-token for Ollama (no real auth needed)
    },
    defaultModels: [],  // User must specify â?depends on pulled models
    fields: ['base_url', 'model_names'],
    iconKey: 'ollama',
    sdkProxyOnly: true,
    meta: {
      docsUrl: 'https://docs.ollama.com/integrations/claude-code',
      billingModel: 'free',
      notes: ['éè¦æ¬å°å®è£?Ollama å¹¶æåæ¨¡å?],
    },
  },

  // ââ LiteLLM ââ
  {
    key: 'litellm',
    name: 'LiteLLM',
    description: 'LiteLLM proxy â?local or remote',
    descriptionZh: 'LiteLLM ä»£ç â?æ¬å°æè¿ç¨?,
    protocol: 'anthropic',
    authStyle: 'api_key',
    baseUrl: 'http://localhost:4000',
    defaultEnvOverrides: {},
    defaultModels: ANTHROPIC_DEFAULT_MODELS,
    fields: ['api_key', 'base_url'],
    iconKey: 'server',
    meta: {
      docsUrl: 'https://docs.litellm.ai/docs/',
      billingModel: 'self_hosted',
    },
  },

  // ââ Google Gemini (Image) ââ
  {
    key: 'gemini-image',
    name: 'Google Gemini (Image)',
    description: 'Nano Banana Pro â?AI image generation by Google Gemini',
    descriptionZh: 'Nano Banana Pro â?Google Gemini AI å¾ççæ',
    protocol: 'gemini-image',
    authStyle: 'api_key',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultEnvOverrides: { GEMINI_API_KEY: '' },
    defaultModels: [
      { modelId: 'gemini-3.1-flash-image-preview', displayName: 'Nano Banana 2' },
      { modelId: 'gemini-3-pro-image-preview', displayName: 'Nano Banana Pro' },
      { modelId: 'gemini-2.5-flash-image', displayName: 'Nano Banana' },
    ],
    fields: ['api_key'],
    category: 'media',
    iconKey: 'google',
    meta: {
      apiKeyUrl: 'https://aistudio.google.com/api-keys',
      docsUrl: 'https://ai.google.dev/gemini-api/docs/image-generation',
      billingModel: 'pay_as_you_go',
    },
  },

  // ââ Google Gemini (Image) Third-party ââ
  // Same protocol & SDK as the official preset; only the base URL differs so
  // users can route through a compatible proxy (e.g. custom relay, CN mirror).
  {
    key: 'gemini-image-thirdparty',
    name: 'Gemini Image Third-party',
    description: 'Nano Banana via compatible proxy â?provide URL and Key',
    descriptionZh: 'Nano Banana å¼å®¹ç¬¬ä¸æ?API â?å¡«åå°ååå¯é?,
    protocol: 'gemini-image',
    authStyle: 'api_key',
    baseUrl: '',
    defaultEnvOverrides: { GEMINI_API_KEY: '' },
    defaultModels: [
      { modelId: 'gemini-3.1-flash-image-preview', displayName: 'Nano Banana 2' },
      { modelId: 'gemini-3-pro-image-preview', displayName: 'Nano Banana Pro' },
      { modelId: 'gemini-2.5-flash-image', displayName: 'Nano Banana' },
    ],
    fields: ['name', 'api_key', 'base_url'],
    category: 'media',
    iconKey: 'google',
  },

  // ââ OpenAI (Image) ââ
  {
    key: 'openai-image',
    name: 'OpenAI (Image)',
    description: 'GPT Image 2 â?AI image generation by OpenAI',
    descriptionZh: 'GPT Image 2 â?OpenAI AI å¾ççæ',
    protocol: 'openai-image',
    authStyle: 'api_key',
    baseUrl: 'https://api.openai.com/v1',
    defaultEnvOverrides: { OPENAI_API_KEY: '' },
    defaultModels: [
      { modelId: 'gpt-image-2', displayName: 'GPT Image 2' },
      { modelId: 'gpt-image-1.5', displayName: 'GPT Image 1.5' },
      { modelId: 'gpt-image-1', displayName: 'GPT Image 1' },
      { modelId: 'gpt-image-1-mini', displayName: 'GPT Image 1 Mini' },
    ],
    fields: ['api_key'],
    category: 'media',
    iconKey: 'openai',
    meta: {
      apiKeyUrl: 'https://platform.openai.com/api-keys',
      docsUrl: 'https://platform.openai.com/docs/guides/image-generation',
      billingModel: 'pay_as_you_go',
    },
  },

  // ââ OpenAI (Image) Third-party ââ
  {
    key: 'openai-image-thirdparty',
    name: 'OpenAI Image Third-party',
    description: 'GPT Image via compatible proxy â?provide URL and Key',
    descriptionZh: 'GPT Image å¼å®¹ç¬¬ä¸æ?API â?å¡«åå°ååå¯é?,
    protocol: 'openai-image',
    authStyle: 'api_key',
    baseUrl: '',
    defaultEnvOverrides: { OPENAI_API_KEY: '' },
    defaultModels: [
      { modelId: 'gpt-image-2', displayName: 'GPT Image 2' },
      { modelId: 'gpt-image-1.5', displayName: 'GPT Image 1.5' },
      { modelId: 'gpt-image-1', displayName: 'GPT Image 1' },
      { modelId: 'gpt-image-1-mini', displayName: 'GPT Image 1 Mini' },
    ],
    fields: ['name', 'api_key', 'base_url'],
    category: 'media',
    iconKey: 'openai',
  },

];

// ââ Runtime preset validation (fails fast on invalid presets) âââ

for (const p of VENDOR_PRESETS) {
  PresetSchema.parse(p);
}

// ââ Lookup helpers ââââââââââââââââââââââââââââââââââââââââââââââ

/** Get a preset by key. */
export function getPreset(key: string): VendorPreset | undefined {
  return VENDOR_PRESETS.find(p => p.key === key);
}

/**
 * True for presets where the available model list is a subscription SKU
 * whitelist (Coding Plan / Token Plan), not the full upstream inference
 * catalogue. These vendors must NOT be auto-probed:
 *   - their /v1/models endpoint at the same host returns the wider Ark /
 *     DashScope / etc. catalogue (text + image + embedding + deprecated
 *     variants);
 *   - probing-and-writing it surfaces non-plan SKUs that 4xx on use and
 *     can incur out-of-plan billing.
 *
 * Trigger: `sdkProxyOnly && billingModel â?{coding_plan, token_plan}`.
 * Pay-as-you-go anthropic-compat (kimi, moonshot, xiaomi-mimo, deepseek)
 * is NOT caught â?their full inference catalogue is the genuine offering.
 *
 * **Caller contract**: this function takes a *verified preset key*. Most
 * stored providers carry `provider_type='anthropic'` even when they came
 * from a brand-specific preset (Volcengine, Bailian, GLM, MiniMax, â? â? * the actual preset is recovered via `findMatchingPresetForRecord` using
 * `base_url`. UI sites that only have a provider record must use
 * `isCatalogOnlyPlanProviderRecord()` instead, otherwise the check
 * silently misses every plan provider. Only call this directly when
 * upstream code (e.g. an API route) already ran the matcher and has a
 * confirmed key (`model-discovery.ts:classifyProvider` is one such caller).
 */
export function isCatalogOnlyPlanProvider(presetKey: string | undefined | null): boolean {
  if (!presetKey) return false;
  const preset = getPreset(presetKey);
  if (!preset) return false;
  return Boolean(
    preset.sdkProxyOnly &&
    (preset.meta?.billingModel === 'coding_plan' || preset.meta?.billingModel === 'token_plan')
  );
}

/**
 * Record-aware version of `isCatalogOnlyPlanProvider` â?the safe choice
 * for any UI site that holds a provider record (or an Add-Service draft
 * record) but not yet a verified preset key.
 *
 * Why this exists: brand-specific anthropic-compat presets (Volcengine /
 * Bailian / GLM CN+Global / MiniMax CN+Global / Xiaomi MiMo Token Plan)
 * are all stored with `provider_type='anthropic'`. Looking up the preset
 * by `provider_type` alone always misses them â?the matcher needs
 * `base_url` to recover the real preset. Routing through
 * `findMatchingPresetForRecord` here keeps every UI caller honest and
 * keeps both UI sites and the discovery gate on the same answer.
 */
export function isCatalogOnlyPlanProviderRecord(record: ProviderPresetIdentityRecord): boolean {
  const matched = findMatchingPresetForRecord(record);
  return isCatalogOnlyPlanProvider(matched?.key);
}

/**
 * True for presets that ship `meta.modelDiscoveryMode: 'catalog_only'` â?the
 * strictest discovery posture: no `/v1/models` refresh, no search-and-add, and
 * `classifyProvider` returns `unsupported`. The shipped `defaultModels` lineup
 * is the only truth.
 *
 * This is intentionally NOT folded into `isCatalogOnlyPlanProvider`: plan
 * providers (GLM / MiniMax) keep search-and-add ON because their `/v1/models`
 * is a clean per-vendor list, whereas these gateways (ClinePass, OpenCode Go)
 * expose a key-gated, mixed-protocol, or superset endpoint that must never be
 * auto-imported. By-key variant for callers that already resolved a preset
 * (e.g. `model-discovery.ts:classifyProvider`); use the record variant from any
 * UI/route site that only holds a provider record.
 */
export function isCatalogOnlyDiscoveryProvider(presetKey: string | undefined | null): boolean {
  if (!presetKey) return false;
  return getPreset(presetKey)?.meta?.modelDiscoveryMode === 'catalog_only';
}

/** Record-aware version of `isCatalogOnlyDiscoveryProvider`. */
export function isCatalogOnlyDiscoveryRecord(record: ProviderPresetIdentityRecord): boolean {
  return isCatalogOnlyDiscoveryProvider(findMatchingPresetForRecord(record)?.key);
}

/**
 * True for OpenRouter provider records â?the aggregator that ships 300+
 * model entries through `/v1/models`. OpenRouter is *not* a Coding/Token
 * Plan vendor (every model is genuinely usable on pay-as-you-go), but
 * full materialization of its catalogue into `provider_models` is the
 * wrong UX: users want to search-and-add a few, not reverse-trim 300.
 *
 * Goes through `findMatchingPresetForRecord` so legacy DB rows with empty
 * `protocol` field still classify correctly via `provider_type='openrouter'`
 * or `base_url` exact match. UI sites and routes must NOT read
 * `provider.protocol` directly for this gate â?the helper is the contract.
 *
 * Used by:
 *   - `POST /api/providers` route â?eager seed via `seedCatalogModelsIfEmpty`
 *     instead of relying on lazy GET-time seed
 *   - `POST /api/providers/[id]/search-models` route â?auth gate
 *   - `POST /api/providers/[id]/validate-models` route â?auth gate
 *   - `model-discovery.ts:classifyProvider` â?return `unsupported` for
 *     OpenRouter so the discover/apply path never auto-materializes
 *   - `POST /api/providers/[id]/discover-models/apply` â?400 reject
 *   - `ProviderManager` Add-Service success path â?show search-add toast
 *   - `ModelsSection` per-card refresh â?route to validate-models
 */
export function isOpenRouterProviderRecord(record: ProviderPresetIdentityRecord): boolean {
  return findMatchingPresetForRecord(record)?.key === 'openrouter';
}

/** Get all presets for a given category (defaults to 'chat'). */
export function getPresetsByCategory(category: 'chat' | 'media' = 'chat'): VendorPreset[] {
  return VENDOR_PRESETS.filter(p => (p.category || 'chat') === category);
}

/**
 * Catalog defaults for a provider. Used by the Models page as a fallback
 * when discovery isn't possible (404 on /v1/models, OAuth/SDK-only families,
 * etc.) â?the curated list is shipped in VENDOR_PRESETS.
 *
 * Returns [] if no preset matches; the caller should treat that as
 * "manual entry only" (user must add models themselves).
 */
export function getCatalogDefaultModelsForRecord(record: ProviderPresetIdentityRecord): CatalogModel[] {
  const matched = findMatchingPresetForRecord(record);
  return matched?.defaultModels ?? [];
}

/**
 * Step 4 ææ¡æ¶å£ï¼?026-05-06ï¼ââ?ç¨æ·è¯­è¨çãæ¥å¥æ¹å¼ãåç±»ã? *
 * Provider Card ä¹åç´æ¥å±ç¤º `authStyle` å·¥ç¨æä¸¾å¼ï¼"Auth Token" /
 * "API Key"ï¼ï¼ç¼ºä¹å¯¹ç¨æ·çè§£éåï¼å¥é¤ vs æéãç»å½?vs è¾?Keyãæ¬å? * vs è¿ç«¯è¿å æ¡ç¨æ·çæ­£å³å¿çè½´é½è¢«åè¿äºä¸ä¸ªåºå±å¸å°ã? *
 * è¿ä¸ª helper æ?preset + provider record æ å°æä¸é?6 ç±»ç¨æ·é¢ææ¡ï¼? *   - subscription_token  å¥é¤ Tokenï¼Coding/Token Planï¼billingModel å½ä¸­
 *   - api_key             API Keyï¼æéä»è´¹ãanthropic å®æ¹
 *   - oauth               ææç»å½ï¼openai-oauthãanthropic-oauth ç­? *   - local               æ¬å°æå¡ï¼ollama / litellm / å¶å® self_hosted
 *   - cloud_credentials   äºè´¦å·å­è¯ï¼bedrock / vertexï¼authStyle env_onlyï¼? *   - gateway             ä¸­è½¬ç½å³ï¼anthropic-thirdparty / æ²¡å¹éä»»ä½?preset
 *                         çèªå®ä¹ URL
 *
 * UI èªå·±æ¿å° `AccessType` ååèµ?i18nï¼`provider.accessType.*`ï¼ââ?è¿ä¸ª
 * æä»¶ä¸åå«ä»»ä½ç¨æ·ææ¡ï¼åªè´è´£åç±»ã? */
export type AccessType =
  | 'subscription_token'
  | 'api_key'
  | 'oauth'
  | 'local'
  | 'cloud_credentials'
  | 'gateway';

export function getProviderAccessType(record: ProviderPresetIdentityRecord): AccessType {
  // OAuth-shaped provider_type values â?these are virtual providers that
  // don't carry an api_key field (auth is in a side channel) so the
  // billingModel check below would miss them.
  if (record.provider_type === 'openai-oauth' || record.provider_type === 'xai-oauth' || record.provider_type === 'anthropic-oauth') {
    return 'oauth';
  }
  const preset = findMatchingPresetForRecord(record);
  if (!preset) {
    // Unmatched preset = user-configured custom URL, conventionally a
    // ä¸­è½¬ç½å³. Same wording as `anthropic-thirdparty` below.
    return 'gateway';
  }
  // Cloud-managed presets use SDK-side env credentials, not an
  // app-managed key. Calling them "API Key" misled users into looking
  // for a key field that isn't there.
  if (preset.authStyle === 'env_only') return 'cloud_credentials';
  // Local services. Ollama uses `billingModel: 'free'` (no charging
  // concept), LiteLLM uses `'self_hosted'` (user-deployed proxy);
  // both are the same user-facing bucket â?æ¬å°æå¡.
  if (preset.meta?.billingModel === 'self_hosted' || preset.meta?.billingModel === 'free') {
    return 'local';
  }
  // Subscription-style billing â?the canonical "å¥é¤ Token" bucket.
  if (preset.meta?.billingModel === 'coding_plan' || preset.meta?.billingModel === 'token_plan') {
    return 'subscription_token';
  }
  // Generic anthropic-compatible relay / custom gateway preset.
  if (preset.key === 'anthropic-thirdparty') return 'gateway';
  // Fall through: pay-as-you-go API key / free-tier (treated the same
  // here â?user puts a key in the form field).
  return 'api_key';
}

/**
 * Phase 1 Step 2 â?"å·²ä¸å¨å½åæ¨èç®å½? badge support.
 *
 * Returns `false` when the provider has a non-empty curated catalog AND
 * `modelId` isn't one of its `defaultModels[].modelId`. The Models page
 * uses this to surface a row-level hint:
 *   - DeepSeek catalog upgraded from v3.x to v4 family â?user's row of
 *     `deepseek-v3.2-exp` survives (manual_* protection at apply time)
 *     but the row no longer maps to a current recommendation. Without
 *     this badge, the user sees "manual_enabled" and assumes they had
 *     enabled it themselves; the badge clarifies "the catalog moved
 *     under you, not the other way around".
 *   - Volcengine catalog change â?same shape.
 *
 * Returns `true` (= "in catalog" or "no concept of catalog") when:
 *   - The model_id IS in the current catalog. No badge needed.
 *   - The provider has no preset / no catalog defaults. Custom-only
 *     provider; "out of catalog" doesn't mean anything here.
 *
 * **Why OpenRouter is intentionally out of scope at the call site (not
 * here)**: OpenRouter ships a 3-alias catalog (sonnet / opus / haiku)
 * but every additional row is *expected* to be search-and-add. Showing
 * "not in catalog" on every search-added row would be noise. The UI
 * caller short-circuits via `isOpenRouterProviderRecord` before asking
 * this function. Keeping the OpenRouter exception at the call site
 * means this helper stays a pure catalog-membership check, which is
 * easier to reason about and test.
 */
export function isModelInCurrentCatalog(
  record: ProviderPresetIdentityRecord,
  modelId: string,
): boolean {
  const defaults = getCatalogDefaultModelsForRecord(record);
  if (defaults.length === 0) return true;
  return defaults.some(m => m.modelId === modelId);
}

/**
 * Phase 1 Step 2 â?gate for the "å·²ä¸å¨å½åæ¨èç®å½? row badge.
 *
 * The badge fires only when **all three** hold:
 *   1. The provider's catalog is authoritative â?i.e. plan whitelist or
 *      curator-fixed lineup. Outside this set, `defaultModels` is just a
 *      starter seed (Kimi 1-alias, Moonshot 1-alias, Xiaomi MiMo PAYG
 *      1-alias, anthropic-thirdparty 3-alias, OpenRouter 3-alias) where
 *      user-added rows are normal usage, not drift.
 *   2. The provider is not OpenRouter â?its 3-alias catalog is a search-
 *      and-add bootstrap and every search-added row is *expected* to be
 *      outside it. (Already excluded by rule 1, but the explicit guard
 *      documents the intent for future readers.)
 *   3. The model_id is not in the current `defaultModels` for this
 *      provider â?i.e. the row genuinely sits outside our authoritative
 *      list.
 *
 * Authoritative catalog = `isCatalogOnlyPlanProviderRecord` (any plan
 * provider) OR `meta.fixedCatalog === true` (declared opt-in for
 * curator-fixed pay-as-you-go presets, currently only DeepSeek).
 *
 * Lifted to a single helper so the call site (Models page row renderer)
 * gets one boolean and the test surface stays narrow â?see
 * `legacy-catalog-hint.test.ts` for the case matrix.
 */
export function shouldShowLegacyCatalogBadge(
  record: ProviderPresetIdentityRecord,
  modelId: string,
): boolean {
  if (isOpenRouterProviderRecord(record)) return false;
  const preset = findMatchingPresetForRecord(record);
  if (!preset) return false;
  const isAuthoritative =
    isCatalogOnlyPlanProviderRecord(record) ||
    isCatalogOnlyDiscoveryRecord(record) ||
    preset.meta?.fixedCatalog === true;
  if (!isAuthoritative) return false;
  return !isModelInCurrentCatalog(record, modelId);
}

/**
 * Phase 1 Step 2 æ¶æ â?åä¸çç¸æºï¼è¿ä¸ª provider æ¯å¦åºè¯¥å±ç¤ºãå·æ°æ¨¡åãæé®ï¼
 *
 * æ¥èª CodexãModels / Providers ä½éªæ¶æãååï¼
 *   "å¦ææå¡åæ¬èº«ä¸æ¯æå¯é æåæ¨¡åï¼å°±ä¸è¦æ¾ç¤ºãå·æ°æ¨¡åãæé®ã?
 *
 * å?preset å³ç­è¡¨è§ `docs/research/provider-model-discovery.md` ç? * "å?preset æåå¯é æ§å®¡è®? æ®µãæè¦ï¼
 *   - **å¯é **ï¼ollamaï¼å¬å¼ /api/tagsï¼ãlitellmï¼æ å?/v1/modelsï¼ã? *     anthropic-thirdpartyï¼å¤æ°èªå®ä¹ç½å³æ¯æ /v1/models ââ?ä»ä½ä¸? *     "é¦æ¬¡éç½®åè¯ä¸æ¬? å¥å£ï¼ã? *   - **ä¸å¯é?/ ä¸åºè¯¥æ**ï¼å¥é¤åï¼ç½åå â?ä¸æ¸¸å¨éï¼ãOpenRouter
 *     ï¼èµ°ç¬ç« search/validateï¼ãimage providersï¼æ·· text/audio/embeddingï¼ã? *     bedrock/vertexï¼SDK onlyï¼ãanthropic-officialï¼?v1/models åé¡µç»?org
 *     billingï¼catalog æ?truthï¼ãPAYG anthropic-compatï¼kimi/moonshot/
 *     xiaomi-mimo/deepseekï¼catalog é½æ¯ 1-3 ä¸ªåºå®?aliasï¼æåè¡ä¸ºæªå®æµï¼? *     æ?Codex 4-category æ¡æ¶å½å¥é¤åï¼ã? *
 * UI è°ç¨ç¹ï¼ModelsSection è¡çº§ / ProviderCard / Refresh Allï¼å¿é¡»ç¨è¿ä¸ª
 * helper å³å®æé®å¯è§æ§ï¼ä¸è¦åèªå¤æ­ã? */
export function canReliablyFetchModels(
  record: ProviderPresetIdentityRecord,
): { reliable: boolean; reasonZh: string; reasonEn: string } {
  // Plan providers stay blocked from the *write* refresh path:
  // probe-and-apply would replace plan-curated catalog rows with raw
  // upstream ids (e.g. GLM auto-refresh would overwrite our `sonnet â?  // GLM-5-Turbo` alias mapping with a plain `glm-5-turbo` row). Even
  // though some plan providers (GLM, MiniMax) have a clean readable
  // /v1/models, the search-and-add path has its own helper
  // `canSearchUpstreamModels` for that â?it's read-only and doesn't
  // need the same protection.
  if (isCatalogOnlyPlanProviderRecord(record)) {
    return {
      reliable: false,
      reasonZh: 'å¥é¤åæå¡ï¼æ¨¡åç±å¥é¤ç½ååå®ä¹ï¼å¦éè¡?SKU è¯·ç¨ãæ·»å æ¨¡åã?,
      reasonEn: 'Plan-based provider â?model list is defined by your subscription whitelist. Use "Add model" to add SKUs.',
    };
  }
  // Catalog-only discovery gateways (ClinePass, OpenCode Go): the shipped
  // whitelist is the only truth â?their model endpoint is key-gated /
  // mixed-protocol / a superset, so neither refresh nor search-and-add is safe.
  if (isCatalogOnlyDiscoveryRecord(record)) {
    return {
      reliable: false,
      reasonZh: 'å¥é¤åæå¡ï¼æ¨¡åç±åç½®ç½ååå®ä¹ï¼æä¸æ¯æå¨çº¿å·æ?,
      reasonEn: 'Subscription provider â?models are defined by a built-in whitelist; online refresh is disabled.',
    };
  }
  // OpenRouter: search-and-add is the canonical add path; validate is the
  // canonical refresh path. Don't surface a generic /v1/models refresh.
  if (isOpenRouterProviderRecord(record)) {
    return {
      reliable: false,
      reasonZh: 'OpenRouter éè¿æç´¢æ·»å æ¨¡åï¼ä¸éè¦å¨éå·æ?,
      reasonEn: 'OpenRouter uses search-and-add for new models â?no bulk refresh needed.',
    };
  }
  const preset = findMatchingPresetForRecord(record);
  // No preset match â?assume custom; allow refresh attempt (the route will
  // either succeed or fall through to "no models"). This matches the
  // anthropic-thirdparty experimental classification at the route layer.
  if (!preset) {
    return { reliable: true, reasonZh: '', reasonEn: '' };
  }
  // Phase 1 Step 2 æ¶æ round 6 (2026-05-06): empirical probe results
  // against the dev DB drove this list:
  //
  //   - kimi (`https://api.kimi.com/coding/v1/models`): returns 1 model
  //     (`kimi-for-coding`). Search-add UX is meaningful even with 1
  //     candidate â?saves the user typing.
  //   - moonshot / xiaomi-mimo: similar PAYG anthropic-compat shape, not
  //     individually probed but presumed-reliable on the same logic.
  //     If their /v1/models 404s, the search dialog surfaces the error
  //     and the manual-fallback link still gets the user there.
  //   - deepseek (`https://api.deepseek.com/anthropic/v1/models`): 404.
  //     Block from search-add so the user lands on manual immediately
  //     instead of seeing a broken search dialog. DeepSeek's catalog is
  //     the v4 family `meta.fixedCatalog: true` â?manual-add is the
  //     intended path for any additional SKUs.
  if (preset.key === 'deepseek') {
    return {
      reliable: false,
      reasonZh: 'DeepSeek ä¸æ¯æéè¿ /v1/models æååè¡¨ï¼è¯·å¨ãæ·»å æ¨¡åãéæå¨è¾å¥ model id',
      reasonEn: "DeepSeek does not expose /v1/models â?use manual entry in Add model.",
    };
  }
  // Image providers: catalog-only.
  if (preset.protocol === 'gemini-image' || preset.protocol === 'openai-image') {
    return {
      reliable: false,
      reasonZh: 'å¾åæå¡åä½¿ç¨åç½®æ¨¡ååè¡?,
      reasonEn: 'Image providers use the built-in catalog.',
    };
  }
  // Cloud direct (Bedrock / Vertex): SDK-only, no plain HTTP probe.
  if (preset.key === 'bedrock' || preset.key === 'vertex') {
    return {
      reliable: false,
      reasonZh: 'è¯¥æå¡åéè¦äº SDK æè½æåæ¨¡ååè¡¨',
      reasonEn: 'This provider needs the cloud SDK to fetch models.',
    };
  }
  // Anthropic-official: /v1/models is paginated + tied to org billing
  // scope; catalog (sonnet/opus/haiku) is the truth.
  if (preset.key === 'anthropic-official') {
    return {
      reliable: false,
      reasonZh: 'å®æ¹ API ä½¿ç¨åç½®æ¨¡ååè¡¨',
      reasonEn: 'Official API uses the built-in catalog.',
    };
  }
  // OAuth: no model list endpoint at all.
  if (preset.key === 'openai-oauth') {
    return {
      reliable: false,
      reasonZh: 'OAuth ç»å½æ¹å¼æ²¡ææ¨¡ååè¡¨æ¥å£',
      reasonEn: 'OAuth login does not expose a model list endpoint.',
    };
  }
  // ollama / litellm / anthropic-thirdparty / openai-compatible â?reliable
  // (or at least: a refresh attempt is meaningful).
  return { reliable: true, reasonZh: '', reasonEn: '' };
}

/**
 * Phase 1 Step 2 æ¶æ round 7 (2026-05-06) â?gate for the search-and-add
 * dialog. **Read-only**: opens upstream `/v1/models`, lets the user pick,
 * writes only the chosen rows via the existing manual-add route. Never
 * triggers a bulk apply, so the same protections as
 * `canReliablyFetchModels` (which guards the auto-write path) don't
 * apply.
 *
 * Empirical findings (2026-05-06, against the dev DB):
 *   - GLM (`https://open.bigmodel.cn/api/anthropic/v1/models`): returns
 *     ~6 GLM-family SKUs cleanly. Search-add is meaningful.
 *   - MiniMax (`https://api.minimax.io/anthropic/v1/models`): returns
 *     ~5 MiniMax-M2.x SKUs cleanly. Search-add is meaningful.
 *   - Kimi (`https://api.kimi.com/coding/v1/models`): returns 1 SKU
 *     (`kimi-for-coding`). Marginal but better than typing.
 *   - Volcengine (Ark): returns 100+ mixed text/audio/embedding/image â? *     user explicitly excluded. Stays manual.
 *   - Bailian (DashScope): same shape as Volcengine.
 *   - Xiaomi MiMo Token Plan: empirically 404.
 *   - DeepSeek: empirically 404.
 *
 * Anything else is delegated to `canReliablyFetchModels` so we don't
 * duplicate the per-protocol case analysis. Image / cloud-direct / OAuth
 * etc. all fall through that helper's negative branches.
 */
export function canSearchUpstreamModels(
  record: ProviderPresetIdentityRecord,
): { reliable: boolean; reasonZh: string; reasonEn: string } {
  // Catalog-only discovery gateways (ClinePass, OpenCode Go): unlike the plan
  // providers below (whose /v1/models is a clean per-vendor list), their model
  // endpoint is key-gated / mixed-protocol / a superset of the plan lineup, so
  // search-and-add is disabled in Phase 1. Checked before the
  // `isCatalogOnlyPlanProviderRecord` branch (which returns true) so these
  // override it to false.
  if (isCatalogOnlyDiscoveryRecord(record)) {
    return {
      reliable: false,
      reasonZh: 'å¥é¤åæå¡ï¼æ¨¡åç±åç½®ç½ååå®ä¹ï¼æä¸æ¯æå¨çº¿æç´¢æ·»å?,
      reasonEn: 'Subscription provider â?models come from a built-in whitelist; online search-and-add is disabled.',
    };
  }
  if (isOpenRouterProviderRecord(record)) {
    return { reliable: true, reasonZh: '', reasonEn: '' };
  }
  const preset = findMatchingPresetForRecord(record);
  // Explicit deny-list â?empirically known to fail or return garbage.
  // Other plan presets (glm-cn / glm-global / minimax-cn / minimax-global)
  // fall through to reliable=true.
  // Empirical (2026-05-06):
  //   - volcengine: Ark mixed 100+ catalog (text/audio/image/embedding/
  //     deprecated) â?clean SKU set untestable per Codex's call
  //   - bailian: `/v1/models` 404s on the Coding Plan host
  //     (`coding.dashscope.aliyuncs.com/apps/anthropic`); only
  //     `/v1/messages` exists. 401-vs-404 confirms not auth-gated.
  //   - bailian-token-plan-cn: same vendor / different host
  //     (`token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic`).
  //     Treated as manual-only by user policy: Token Plan å¢éç?key
  //     is team-tier and not safe to probe with /v1/models from a
  //     shared client. Add SKUs via the manual dialog only.
  //   - xiaomi-mimo-token-plan: 404 on /v1/models
  //   - deepseek: 404 on /v1/models
  const manualOnlyKeys = new Set([
    'volcengine',
    'bailian',
    'qwen-token-plan-personal-cn',
    'bailian-token-plan-cn',
    'xiaomi-mimo-token-plan',
    'deepseek',
  ]);
  if (preset && manualOnlyKeys.has(preset.key)) {
    return {
      reliable: false,
      reasonZh: 'è¯¥æå¡åçæ¨¡ååè¡¨æ¥å£è¿åç»æä¸éåä½æç´¢æ¥æºï¼è¯·ç¨ãæ·»å æ¨¡åãæå¨è¾å?,
      reasonEn: "This provider's /v1/models output isn't suitable as a search source â?use Add model to type the id manually.",
    };
  }
  // Plan providers not in the deny-list above (GLM, MiniMax, Xiaomi MiMo
  // PAYG): fall through and return reliable=true. The search-models
  // route passes `bypassUnsupportedGate: true` so the prober runs even
  // though `classifyProvider` would otherwise mark plan presets as
  // 'unsupported' for the write path.
  if (isCatalogOnlyPlanProviderRecord(record)) {
    return { reliable: true, reasonZh: '', reasonEn: '' };
  }
  // Everything else: defer to `canReliablyFetchModels` so categories
  // like image / cloud-direct / Anthropic official / OAuth get the
  // same negative answer they'd get for the refresh button.
  return canReliablyFetchModels(record);
}

function inferProtocolFromLegacyFields(providerType: string, baseUrl: string): Protocol {
  if (providerType === 'anthropic') return 'anthropic';
  if (providerType === 'openai-compatible') return 'openai-compatible';
  if (providerType === 'openrouter') return 'openrouter';
  if (providerType === 'bedrock') return 'bedrock';
  if (providerType === 'vertex') return 'vertex';
  if (providerType === 'gemini-image') return 'gemini-image';
  if (providerType === 'openai-image') return 'openai-image';
  if (providerType === 'custom') {
    const anthropicUrls = [
      'bigmodel.cn', 'z.ai', 'kimi.com', 'moonshot.cn', 'moonshot.ai',
      'minimaxi.com', 'minimax.io', 'volces.com', 'volcengine.com',
      'dashscope.aliyuncs.com', 'maas.aliyuncs.com', 'xiaomimimo.com',
      'localhost:11434',
    ];
    const urlLower = baseUrl.toLowerCase();
    if (anthropicUrls.some(u => urlLower.includes(u)) || urlLower.includes('/anthropic')) {
      return 'anthropic';
    }
  }
  return 'anthropic';
}

function uniquePresetResult(
  candidates: VendorPreset[],
  source: 'legacy_exact' | 'legacy_fuzzy',
): ProviderPresetIdentityResolution | undefined {
  if (candidates.length === 1) return { status: 'resolved', preset: candidates[0], source };
  if (candidates.length > 1) {
    return { status: 'ambiguous', candidateKeys: candidates.map(p => p.key).sort() };
  }
  return undefined;
}

/**
 * Single source of truth for provider product identity.
 *
 * Explicit identities are validated against protocol and canonical base URL.
 * Legacy rows may resolve only when exact/fuzzy matching yields one candidate;
 * shared endpoints are deliberately returned as `ambiguous` instead of taking
 * catalog array order.
 */
export function resolveProviderPresetIdentity(
  record: ProviderPresetIdentityRecord,
): ProviderPresetIdentityResolution {
  const effectiveProtocol = isValidProtocol(record.protocol)
    ? record.protocol
    : inferProtocolFromLegacyFields(record.provider_type, record.base_url);

  if (record.preset_key) {
    const preset = getPreset(record.preset_key);
    if (!preset) return { status: 'invalid', candidateKeys: [record.preset_key] };
    const protocolMatches = preset.protocol === effectiveProtocol;
    const baseMatches = !preset.baseUrl || preset.baseUrl === record.base_url;
    if (!protocolMatches || !baseMatches) {
      return { status: 'invalid', candidateKeys: [record.preset_key] };
    }
    return { status: 'resolved', preset, source: 'preset_key' };
  }

  if (record.base_url) {
    const exactAtBase = VENDOR_PRESETS.filter(p => Boolean(p.baseUrl) && p.baseUrl === record.base_url);
    const exact = exactAtBase.filter(p => p.protocol === effectiveProtocol);
    const exactResult = uniquePresetResult(exact, 'legacy_exact');
    if (exactResult) return exactResult;

    // If this exact URL is owned by a different protocol, do not hostname-
    // fuzzy it into another preset on the same host. OpenCode Go's OpenAI and
    // Anthropic paths are the canonical regression case.
    if (exactAtBase.length === 0) {
      const legacyUrl = record.base_url.toLowerCase();
      const fuzzy = VENDOR_PRESETS.filter(p => {
        if (!p.baseUrl || p.protocol !== effectiveProtocol) return false;
        try {
          return legacyUrl.includes(new URL(p.baseUrl).hostname);
        } catch {
          return false;
        }
      });
      const fuzzyResult = uniquePresetResult(fuzzy, 'legacy_fuzzy');
      if (fuzzyResult) return fuzzyResult;
    }
  }

  let key: string | undefined;
  if (record.provider_type === 'bedrock') key = 'bedrock';
  else if (record.provider_type === 'vertex') key = 'vertex';
  else if (record.provider_type === 'openrouter') key = 'openrouter';
  else if (record.provider_type === 'gemini-image') key = record.base_url ? 'gemini-image-thirdparty' : 'gemini-image';
  else if (record.provider_type === 'openai-image') key = record.base_url ? 'openai-image-thirdparty' : 'openai-image';
  else if (record.provider_type === 'xai' || effectiveProtocol === 'xai') key = 'xai';
  else if (effectiveProtocol === 'openai-compatible') key = 'openai-compatible';
  else if (record.provider_type === 'anthropic' && record.base_url === 'https://api.anthropic.com') key = 'anthropic-official';
  else if (record.provider_type === 'anthropic' && record.base_url) key = 'anthropic-thirdparty';

  const preset = key ? getPreset(key) : undefined;
  return preset
    ? { status: 'resolved', preset, source: 'legacy_type' }
    : { status: 'unmatched', candidateKeys: [] };
}

export function findMatchingPresetForRecord(record: ProviderPresetIdentityRecord): VendorPreset | undefined {
  const resolution = resolveProviderPresetIdentity(record);
  return resolution.status === 'resolved' ? resolution.preset : undefined;
}

export interface VerifiedProviderWireCapabilities {
  /** Verified Anthropic `output_config.effort` tiers for this exact model. */
  anthropicEffortLevels?: readonly ProviderEffortLevel[];
  /** Verified native Responses endpoint for Codex Runtime. */
  codexResponses?: {
    baseUrl: string;
    /** Exact model ID required by the native Responses endpoint. */
    modelId: string;
    supportedEffortLevels?: readonly ProviderEffortLevel[];
    effortAliases?: Partial<Record<'minimal' | ProviderEffortLevel, ProviderEffortLevel>>;
    supportsReasoningSummary: boolean;
  };
}

/**
 * Resolve model-specific wire capabilities from the provider preset.
 *
 * This is intentionally record-aware and fail-closed. A matching hostname is
 * not enough: the stored provider identity must resolve to a real preset, the
 * selected model must be in that preset's catalog, and the wire declaration
 * must explicitly list it. This keeps same-model aggregators from inheriting
 * DeepSeek's first-party transport contract.
 */
export function getVerifiedProviderWireCapabilities(
  record: ProviderPresetIdentityRecord,
  modelId: string,
): VerifiedProviderWireCapabilities {
  const preset = findMatchingPresetForRecord(record);
  if (!preset) return {};

  const model = preset.defaultModels.find(candidate =>
    candidate.modelId === modelId || candidate.upstreamModelId === modelId,
  );
  if (!model) return {};

  const canonicalIds = new Set([model.modelId, model.upstreamModelId].filter(Boolean));
  const declaredId = (ids: readonly string[] | undefined): string | undefined =>
    ids?.find(id => canonicalIds.has(id));
  const supportedEffortLevels = model.capabilities?.supportsEffort
    ? model.capabilities.supportedEffortLevels
    : undefined;
  const anthropicDeclaredId = declaredId(preset.wireCapabilities?.anthropicEffort?.modelIds);
  const responsesDeclaredId = declaredId(preset.wireCapabilities?.codexResponses?.modelIds);
  const responseModelId = responsesDeclaredId
    ? preset.wireCapabilities?.codexResponses?.modelIdOverrides?.[responsesDeclaredId]
      ?? model.upstreamModelId
      ?? model.modelId
    : undefined;

  return {
    ...(supportedEffortLevels && anthropicDeclaredId
      ? { anthropicEffortLevels: supportedEffortLevels }
      : {}),
    ...(responsesDeclaredId && responseModelId
      ? {
          codexResponses: {
            baseUrl: preset.wireCapabilities!.codexResponses!.baseUrl,
            modelId: responseModelId,
            ...(supportedEffortLevels ? { supportedEffortLevels } : {}),
            ...(preset.wireCapabilities!.codexResponses!.effortAliases
              ? { effortAliases: preset.wireCapabilities!.codexResponses!.effortAliases }
              : {}),
            supportsReasoningSummary:
              preset.wireCapabilities!.codexResponses!.supportsReasoningSummary === true,
          },
        }
      : {}),
  };
}

/** All valid Protocol union values â?used for raw-field validation. */
export const VALID_PROTOCOLS = new Set<Protocol>([
  'anthropic',
  'openai-compatible',
  'xai',
  'openrouter',
  'bedrock',
  'vertex',
  'google',
  'gemini-image',
  'openai-image',
]);

/** Type guard for raw protocol strings coming from API bodies or legacy DB. */
export function isValidProtocol(value: unknown): value is Protocol {
  return typeof value === 'string' && VALID_PROTOCOLS.has(value as Protocol);
}

/**
 * Compute the effective protocol for a provider â?prefer the raw protocol
 * field if it's a known Protocol value, otherwise fall back to
 * inferProtocolFromLegacy(provider_type, base_url). Use this everywhere
 * a write path, resolver, or diagnostic needs the "real" protocol: raw
 * provider.protocol can legitimately be '' on legacy rows, and the POST
 * API can see body.protocol === undefined from older clients.
 */
export function getEffectiveProviderProtocol(
  providerType: string,
  protocol: string | undefined,
  baseUrl: string,
  presetKey: string,
): Protocol {
  if (presetKey) {
    const resolved = resolveProviderPresetIdentity({
      preset_key: presetKey,
      provider_type: providerType,
      protocol: protocol || '',
      base_url: baseUrl,
    });
    if (resolved.status === 'resolved') return resolved.preset.protocol;
  }
  if (protocol && VALID_PROTOCOLS.has(protocol as Protocol)) {
    return protocol as Protocol;
  }
  return inferProtocolFromLegacy(providerType, baseUrl, presetKey);
}

/**
 * Infer the protocol from a legacy provider_type.
 * Used during migration from the old system.
 */
export function inferProtocolFromLegacy(
  providerType: string,
  baseUrl: string,
  presetKey: string,
): Protocol {
  const preset = presetKey ? getPreset(presetKey) : undefined;
  if (preset && (!preset.baseUrl || preset.baseUrl === baseUrl)) return preset.protocol;
  return inferProtocolFromLegacyFields(providerType, baseUrl);
}

/**
 * Infer the auth style from a legacy provider.
 * Checks extra_env to determine if it uses AUTH_TOKEN vs API_KEY.
 */
export function inferAuthStyleFromLegacy(
  providerType: string,
  extraEnv: string,
): AuthStyle {
  if (providerType === 'bedrock' || providerType === 'vertex') return 'env_only';

  try {
    const env = JSON.parse(extraEnv || '{}');
    if ('ANTHROPIC_AUTH_TOKEN' in env) return 'auth_token';
  } catch { /* fallthrough */ }

  return 'api_key';
}

/**
 * Find a matching vendor preset for a legacy provider.
 * Matches by base_url first, then by provider_type.
 * When `protocol` is provided, fuzzy (hostname) matching is restricted to
 * presets with the same protocol to avoid misclassifying cross-protocol
 * providers that share the same host (e.g. dashscope OpenAI-compatible vs Bailian Anthropic).
 */
export function findPresetForLegacy(
  baseUrl: string,
  providerType: string,
  protocol: Protocol | undefined,
  presetKey: string,
): VendorPreset | undefined {
  return findMatchingPresetForRecord({
    preset_key: presetKey,
    provider_type: providerType,
    protocol: protocol || '',
    base_url: baseUrl,
  });
}

/**
 * Get the default models for a provider based on its catalog preset.
 * If the provider has a matching preset, returns the preset's defaultModels.
 * Otherwise returns a protocol-appropriate fallback catalog.
 *
 * @param providerType â?legacy provider_type string from DB (e.g. 'anthropic',
 *   'bedrock'). Used to disambiguate baseUrl='' cases: a legacy
 *   anthropic-typed provider with an empty baseUrl migrated from older
 *   settings is treated as the official Anthropic endpoint (first-party
 *   catalog), not a generic third-party proxy.
 */
export function getDefaultModelsForProvider(
  protocol: Protocol,
  baseUrl: string,
  providerType?: string,
): CatalogModel[] {
  // Try to find a preset by exact base_url. Protocol must agree â?otherwise
  // an openai-compatible chat provider configured with
  // https://api.openai.com/v1 would match the openai-image preset and
  // inherit the GPT Image catalog for chat model selection.
  const preset = VENDOR_PRESETS.find(
    p => p.baseUrl && p.baseUrl === baseUrl && p.protocol === protocol,
  );
  if (preset) {
    // Preset matched â?return its models even if empty (e.g. Volcengine
    // requires users to specify their own model names, so defaultModels is []).
    return preset.defaultModels;
  }

  // Fuzzy match: legacy providers may have old URLs (e.g. minimaxi.com/anthropic/v1
  // before the /v1 suffix was removed). Match by domain substring against presets,
  // but only when the protocol matches to avoid misclassifying custom OpenAI-compatible
  // providers that share the same host (e.g. dashscope.aliyuncs.com/compatible-mode/v1).
  if (baseUrl) {
    const urlLower = baseUrl.toLowerCase();
    const fuzzy = VENDOR_PRESETS.find(p => {
      if (!p.baseUrl || p.protocol !== protocol) return false;
      try {
        const presetHost = new URL(p.baseUrl).hostname;
        return urlLower.includes(presetHost);
      } catch { return false; }
    });
    if (fuzzy) return fuzzy.defaultModels;
  }

  // Legacy first-party Anthropic: migrated Default providers have
  // provider_type='anthropic' with base_url=''. The native runtime
  // treats them as the official @ai-sdk/anthropic endpoint, so they
  // must resolve opus to the concrete claude-opus-4-7 upstream (same
  // as the anthropic-official preset). Without this branch they'd
  // fall through to the alias-only catalog and bypass the 4.7
  // sanitizer, 1M context, and xhigh metadata.
  if (protocol === 'anthropic' && !baseUrl && providerType === 'anthropic') {
    return ANTHROPIC_FIRST_PARTY_MODELS;
  }

  // Protocol-based defaults (only when no preset matched).
  // Bedrock/Vertex get the alias-only catalog with Opus 4.6 labels because
  // their DB-backed provider has baseUrl='' and the preset match above
  // never fires. Without this branch, they'd fall through to the shared
  // Anthropic catalog and mis-resolve opus as first-party Opus 4.7.
  if (protocol === 'bedrock' || protocol === 'vertex') {
    return BEDROCK_VERTEX_DEFAULT_MODELS;
  }
  if (protocol === 'anthropic' || protocol === 'openrouter') {
    return ANTHROPIC_DEFAULT_MODELS;
  }
  if (protocol === 'xai') {
    return getPreset('xai')?.defaultModels ?? [];
  }
  // Media protocols: a third-party provider pointing at a custom proxy URL
  // won't match an exact or fuzzy host, so fall back to the third-party
  // preset's default catalog to surface the standard GPT Image / Nano Banana
  // model list in the settings UI.
  if (protocol === 'gemini-image') {
    const p = VENDOR_PRESETS.find(x => x.key === 'gemini-image-thirdparty');
    return p?.defaultModels ?? [];
  }
  if (protocol === 'openai-image') {
    const p = VENDOR_PRESETS.find(x => x.key === 'openai-image-thirdparty');
    return p?.defaultModels ?? [];
  }

  return [];
}
