/**
 * Runtime Compatibility Matrix â?single source of truth.
 *
 * Every consumer (Provider Card badges, Models page filter+badges, chat
 * picker, provider-resolver) must call into here so the labels and gates
 * stay consistent. The matrix has two layers:
 *
 *   - Provider layer: one of `ProviderRuntimeCompat` per provider record.
 *   - Model layer: a bag of capability flags per `ModelRuntimeCompat`.
 *
 * Heuristics (deliberately simple â?explicit list rather than inference):
 *   image-image protocols                          â?media_only
 *   anthropic-official / bedrock / vertex preset   â?claude_code_ready
 *   anthropic protocol + meta.claudeCodeVerified   â?claude_code_verified
 *   anthropic protocol w/ any other preset         â?claude_code_experimental
 *   openrouter Anthropic Skin (no /v1)             â?openrouter_anthropic_skin
 *   openrouter OpenAI Skin (/v1) / openai-compat / google chat â?bbagent_only
 *   no matched preset                              â?unknown
 */
import type { ApiProvider, ProviderRuntimeCompat, ModelRuntimeCompat } from '@/types';
import { findMatchingPresetForRecord, type VendorPreset } from '@/lib/provider-catalog';
import type { RuntimeId } from '@/lib/runtime/runtime-id';

export interface ProviderCompatRecord {
  preset_key: string;
  provider_type: string;
  protocol: string;
  base_url: string;
}

const CLAUDE_CODE_READY_PRESETS = new Set(['anthropic-official', 'bedrock', 'vertex']);

/**
 * OpenRouter exposes two HTTP "skins" off the same domain:
 *   - `https://openrouter.ai/api`      â?Anthropic-compatible (`/v1/messages`),
 *                                        the path OpenRouter's own Claude Code
 *                                        integration doc recommends. Reaches
 *                                        Claude Code Runtime.
 *   - `https://openrouter.ai/api/v1`   â?OpenAI-compatible (`/chat/completions`).
 *                                        CodePilot + Codex Runtime (bbagent_only).
 *
 * The default OpenRouter preset shipped in `provider-catalog.ts` uses the
 * Anthropic skin. Users editing the URL or pasting from OpenAI tutorials
 * can land on the `/v1` form, which we route as `bbagent_only`.
 *
 * Detection is intentionally URL-shape based: the path either ends with
 * `/api` (Anthropic skin) or includes `/api/v1` / ends with `/v1`
 * (OpenAI-compatible skin). Trailing slashes are normalized so
 * `https://openrouter.ai/api/` still matches.
 */
export function isOpenRouterAnthropicSkinUrl(baseUrl: string): boolean {
  const trimmed = baseUrl.replace(/\/+$/, '').toLowerCase();
  if (!trimmed.includes('openrouter.ai')) return false;
  // Anthropic skin: ends with `/api`, NOT `/api/v1`.
  return /\/api$/.test(trimmed);
}

/**
 * True for OpenRouter providers whose base_url is the Anthropic skin
 * (`https://openrouter.ai/api`). Exported so call sites that want the
 * fact-check (e.g. resolver behavior) can reuse the same predicate as
 * the compat tier.
 */
export function isOpenRouterAnthropicSkinRecord(record: ProviderCompatRecord): boolean {
  const preset = findMatchingPresetForRecord(record);
  if (preset?.key !== 'openrouter') return false;
  return isOpenRouterAnthropicSkinUrl(record.base_url);
}

export function getProviderCompat(record: ProviderCompatRecord): ProviderRuntimeCompat {
  // Image protocols short-circuit â?never participate in chat-side runtimes.
  if (record.provider_type === 'gemini-image' || record.provider_type === 'openai-image') {
    return 'media_only';
  }
  const preset: VendorPreset | undefined = findMatchingPresetForRecord(record);
  if (!preset) return 'unknown';
  if (CLAUDE_CODE_READY_PRESETS.has(preset.key)) return 'claude_code_ready';
  if (preset.protocol === 'anthropic') {
    // Verified Code Plan / Coding presets get a distinct tier so users
    // can tell "GLM Coding Plan that we've tested end-to-end" apart from
    // "generic anthropic-thirdparty wrapper that may or may not work".
    return preset.meta?.claudeCodeVerified
      ? 'claude_code_verified'
      : 'claude_code_experimental';
  }
  if (preset.protocol === 'openrouter') {
    // OpenRouter's `https://openrouter.ai/api` skin speaks Anthropic wire
    // protocol per their Claude Code integration doc; route it as a
    // distinct claude_code-capable tier rather than bbagent_only. The
    // `/v1` skin (OpenAI-compatible) keeps the bbagent_only path.
    return isOpenRouterAnthropicSkinUrl(record.base_url)
      ? 'openrouter_anthropic_skin'
      : 'bbagent_only';
  }
  if (preset.protocol === 'openai-compatible' || preset.protocol === 'xai' || preset.protocol === 'google') {
    return 'bbagent_only';
  }
  return 'unknown';
}

/** Convenience for callers holding a full `ApiProvider`. */
export function getProviderCompatFromApi(provider: ApiProvider): ProviderRuntimeCompat {
  return getProviderCompat(provider);
}

/**
 * Model-layer compat. We don't try to introspect every upstream model â? * we project from provider compat + model id heuristics + any catalog
 * capability flags the caller passes through.
 */
export function getModelCompat(args: {
  modelId: string;
  upstreamModelId?: string;
  providerCompat: ProviderRuntimeCompat;
  /** Catalog `capabilities` if available. */
  capabilities?: {
    reasoning?: boolean;
    toolUse?: boolean;
    supportsEffort?: boolean;
    supportsAdaptiveThinking?: boolean;
  };
}): ModelRuntimeCompat {
  const { modelId, upstreamModelId, providerCompat, capabilities } = args;

  if (providerCompat === 'media_only') {
    return { media: true };
  }

  const compat: ModelRuntimeCompat = { chat: true };

  // Tool-use defaults to true unless catalog explicitly says otherwise.
  // Most modern chat models carry tools â?opting out is the rare case.
  if (capabilities?.toolUse !== false) compat.tool_capable = true;
  if (capabilities?.reasoning || capabilities?.supportsEffort || capabilities?.supportsAdaptiveThinking) {
    compat.thinking_capable = true;
  }

  // Phase 0.5 Slice B (2026-05-13) â?populate `supportedRuntimes` as
  // the canonical compat field. Legacy booleans still set for
  // back-compat input; new readers (API route filter, Slice E
  // adapters) consume `supportedRuntimes` directly. Reasons land in
  // `unsupportedReasonByRuntime` so the UI can tell users WHY a
  // model is hidden in a given runtime.
  const supported = new Set<RuntimeId>();
  const reasons: Record<string, string> = {};

  // Phase 5b shipped (2026-05-15) â?codex_runtime reach is now covered
  // by the unified provider-proxy translator at
  // `/api/codex/proxy/v1/responses`. The translator wraps ai-sdk's
  // `createModel()` so the same wire-format handling Native uses is
  // reused for the OpenAI-compat / Anthropic-compat / CodePlan
  // families. `codex_runtime` therefore lights up for every chat-
  // capable compat tier EXCEPT `unknown` (we don't know the protocol)
  // and `codex_account` (which routes through Codex's own app-server,
  // not the proxy).
  const CODEX_PROXY_PENDING_REASON_ZH =
    'Codex provider proxy ææªè¯å«è¯?provider ç±»åï¼æ æ³å¤å®?wire format';
  const CODEX_PROXY_PENDING_REASON_EN =
    'Codex provider proxy canât infer this providerâs wire format yet';
  // The wording mirrors the proxy route's `unsupported_yet` error
  // codes; UI can pick the language form at render time. We store
  // the zh-CN form by default to match the rest of `reasons.*`.

  switch (providerCompat) {
    case 'claude_code_ready':
      // Anthropic official / Bedrock / Vertex â?`@ai-sdk/anthropic` can also
      // talk to these directly without the Claude Code subprocess, so the
      // model is reachable from bb-agent Runtime too. Marking both lets a
      // user on Native runtime configure only Anthropic and still see models.
      // Phase 5b: Codex Runtime now reaches these via the provider proxy.
      compat.claude_code_compatible = true;
      compat.bbagent_compatible = true;
      supported.add('claude_code');
      supported.add('bbagent');
      supported.add('codex_runtime');
      break;
    case 'claude_code_verified':
    case 'claude_code_experimental':
      // Anthropic-compat brand presets (Kimi / GLM / MiniMax / Volcengine /
      // Xiaomi MiMo / Bailian / DeepSeek Coding Plan / etc.). These are
      // mostly `sdkProxyOnly` historically, but `ClaudeCodeCompatAdapter`
      // (src/lib/claude-code-compat/) now lets bb-agent Runtime speak the
      // same Anthropic wire format as the Claude Code subprocess â?see
      // `provider-transport.ts::isNativeCompatible('claude-code-compat')`
      // and `provider-resolver.ts` routing third-party Anthropic proxies
      // to sdkType='claude-code-compat'. So both runtimes can reach these
      // providers; we mark both flags. Verified vs experimental still
      // differ only in UI tone ("å¼å®¹" vs "å®éª"), not in routing.
      // Phase 5b: Codex Runtime also reaches these via the provider proxy.
      compat.claude_code_compatible = true;
      compat.bbagent_compatible = true;
      supported.add('claude_code');
      supported.add('bbagent');
      supported.add('codex_runtime');
      break;
    case 'openrouter_anthropic_skin':
      // OpenRouter Anthropic skin (`/api`, no `/v1`). Reachable from
      // Claude Code Runtime per OpenRouter's own integration doc; mark
      // claude_code_compatible so the runtime filter keeps these rows in
      // the Claude Code picker. We do NOT also flag
      // bbagent_compatible â?bb-agent Runtime expects the
      // OpenAI-compat `/v1` skin URL form, and silently accepting an
      // Anthropic-shaped URL would route CodePilot through the wrong
      // path. Users wanting both runtimes should configure two providers
      // (one per skin URL).
      // Phase 5b: Codex Runtime reaches this via the provider proxy
      // (Anthropic wire format), so codex_runtime is also supported.
      compat.claude_code_compatible = true;
      supported.add('claude_code');
      supported.add('codex_runtime');
      reasons.bbagent =
        'OpenRouter Anthropic skin URL (/api) â?switch to /v1 skin for bb-agent Runtime';
      break;
    case 'bbagent_only':
      // Provider-layer bbagent_only means the provider doesn't speak the
      // Claude Code wire format, period. We deliberately do NOT lift
      // `anthropic/claude-*` rows back into `claude_code_compatible` here
      // even though some aggregators (OpenRouter) expose an
      // anthropic-compat endpoint â?that exposes a hidden contradiction:
      // the Provider Card / Models page label this provider "OpenAI å¼å®¹"
      // and the tooltip says "ä¸è¿å?Claude Code æµç¨", but a smuggled
      // claude alias would still surface in the Claude Code picker and
      // route through a path the user didn't ask for.
      // Users who want to use Claude models through OpenRouter / a relay
      // should configure an explicit `anthropic-thirdparty` preset
      // pointing at the relay's anthropic-compat endpoint â?that maps to
      // claude_code_experimental and is a single, coherent provider
      // identity in the UI.
      // Phase 5b: Codex Runtime reaches this via the provider proxy
      // (OpenAI-compatible wire format), so codex_runtime is supported.
      compat.bbagent_compatible = true;
      supported.add('bbagent');
      supported.add('codex_runtime');
      reasons.claude_code =
        'OpenAI-compatible protocol â?not reachable from Claude Code Runtime';
      break;
    case 'codex_account':
      // Phase 5 Phase 2 (2026-05-13) â?Codex Account models flow only
      // through Codex Runtime (their own app-server). They're NOT
      // reachable from ClaudeCode SDK or the bb-agent Runtime
      // native loop â?Codex owns the thread / turn / tool execution
      // shape. CodePilot provider proxy (Phase 5 Â§provider proxy)
      // is the future channel for the reverse direction (CodePilot
      // models reachable from Codex Runtime); the matrix is one-way
      // for the model side.
      supported.add('codex_runtime');
      reasons.claude_code =
        'Codex Account model â?only reachable through Codex Runtime';
      reasons.bbagent =
        'Codex Account model â?only reachable through Codex Runtime';
      break;
    case 'unknown':
      // We don't know the right answer â?let the user verify. Both
      // legacy runtimes keep the model visible until they hide it
      // explicitly. Codex Runtime stays gated because the proxy can't
      // pick a wire format without knowing the provider type.
      compat.claude_code_compatible = true;
      compat.bbagent_compatible = true;
      supported.add('claude_code');
      supported.add('bbagent');
      reasons.codex_runtime = CODEX_PROXY_PENDING_REASON_ZH;
      break;
  }
  // Suppress unused-var warning when only the zh form is plumbed
  // through reasons today; UI bilingual layer can pull from the
  // exported const directly when it adds the en mirror.
  void CODEX_PROXY_PENDING_REASON_EN;

  compat.supportedRuntimes = [...supported];
  if (Object.keys(reasons).length > 0) {
    compat.unsupportedReasonByRuntime = reasons;
  }

  return compat;
}

/**
 * Display labels â?keeps wording consistent across Provider Card, Models
 * page filter, and any future telemetry. UI calls these directly so a
 * future copy change touches one place.
 */
export function compatLabel(compat: ProviderRuntimeCompat, isZh: boolean): string {
  switch (compat) {
    case 'claude_code_ready':        return isZh ? 'Claude Code ç´è¿' : 'Claude Code direct';
    case 'claude_code_verified':     return isZh ? 'Claude Code å¼å®¹' : 'Claude Code compat';
    case 'claude_code_experimental': return isZh ? 'Claude Code å®éª' : 'Claude Code experimental';
    case 'openrouter_anthropic_skin':
      return isZh ? 'OpenRouter Â· Claude Code å¼å®¹' : 'OpenRouter Â· Claude Code compat';
    case 'bbagent_only':           return isZh ? 'buckyball.ai Â· Codex' : 'buckyball.ai Â· Codex';
    case 'codex_account':            return isZh ? 'Codex è´¦å·' : 'Codex Account';
    case 'media_only':               return isZh ? 'å¾ççæ' : 'Image gen';
    case 'unknown':                  return isZh ? 'ééªè¯' : 'Needs verification';
  }
}

/** Tooltip-length explanation â?used on hover and in filter help. */
export function compatTooltip(compat: ProviderRuntimeCompat, isZh: boolean): string {
  switch (compat) {
    case 'claude_code_ready':
      return isZh
        ? 'å®æ¹ Anthropic API / Bedrock / Vertexï¼Claude Code ç´æ¥æ¥å¥ï¼å·¥å?/ thinking å®æ´æ¯æ'
        : 'Official Anthropic API / Bedrock / Vertex â?Claude Code talks to it directly, full tool + thinking support';
    case 'claude_code_verified':
      return isZh
        ? 'å·²å®æµç Anthropic å¼å®¹ååï¼GLM / Kimi / Volcengine / MiniMax / ç¾ç¼ / å°ç±³ MiMo / DeepSeek ç­?Code Plan / Coding å¥é¤ï¼ï¼å·¥å·è°ç¨ / thinking / æ¨¡åå«åè¡ä¸ºå·²éªè¯?
        : 'Verified Anthropic-compatible vendor (GLM / Kimi / Volcengine / MiniMax / Bailian / Xiaomi MiMo / DeepSeek Coding Plans) â?tool calling, thinking, and alias mapping confirmed in practice';
    case 'claude_code_experimental':
      return isZh
        ? 'éç¨ Anthropic å¼å®¹ç¬¬ä¸æ¹æ¨¡æ¿æèªå®ä¹ç½å³ï¼å·¥å·è°ç¨ / thinking / æ¨¡åå«åè¡ä¸ºåå³äºè¯¥ç½å³å®ç°ï¼å»ºè®®æµè¯ååç¨äºå³é®åºæ?
        : 'Generic Anthropic-compatible template or custom gateway â?tool / thinking / aliases depend on the vendor implementation, test before relying on it for critical work';
    case 'openrouter_anthropic_skin':
      return isZh
        ? 'éè¿ OpenRouter Anthropic Skin æ¥å¥ Claude Codeï¼å»ºè®®ä¼åä½¿ç?anthropic/claude-* æ¨¡åãå¶å®ååçæ¨¡åä»å¯éè¿ OpenRouter è°ç¨ï¼ä½å·¥å·è°ç¨ / thinking è¡ä¸ºåå³äºå·ä½ä¸æ¸¸ã?
        : 'Reaches Claude Code via the OpenRouter Anthropic skin â?best suited to anthropic/claude-* models. Other models route through OpenRouter too, but tool calling / thinking behavior depends on the upstream vendor.';
    case 'bbagent_only':
      return isZh
        ? 'OpenAI å¼å®¹åè®®ï¼å¯å?bb-agent Runtime ä¸?Codex Runtime ä¸ä½¿ç¨ï¼ä¸æ¯æ?Claude Code Runtimeï¼ä¸ä¼åºç°å¨å¶æ¨¡åéæ©å¨ä¸­ï¼?
        : 'OpenAI-compatible protocol â?usable from bb-agent Runtime and Codex Runtime; not supported by Claude Code Runtime (never shown in its picker)';
    case 'codex_account':
      return isZh
        ? 'å·²ç»å½?Codex è´¦å·çåçæ¨¡åï¼ä»éè¿æ¬æº codex app-server å?Codex Runtime ä¸ä½¿ç?
        : 'Native models from the logged-in Codex account â?only reachable through the local codex app-server in Codex Runtime';
    case 'media_only':
      return isZh
        ? 'å¾ççææå¡ï¼åªç¨äºåªä½åä½åè½ï¼ä¸åºç°å¨èå¤©æ¨¡åéæ©å?
        : 'Image-generation service â?used by media features only, never appears in chat pickers';
    case 'unknown':
      return isZh
        ? 'èªå®ä¹å°åææªè¯å«çé¢è®¾ï¼æ¯å¦å¼å®¹ Claude Code åå³äºè¯¥ç½å³å®ç°ï¼å»ºè®®æµè¯è¿æ¥ååå¯ç¨å³é®æ¨¡å?
        : 'Custom URL or unrecognized preset â?Claude Code compatibility depends on the gateway, test before relying on it';
  }
}

/** Tone for badges â?matches the design system status palette.
 *
 *  Phase 1 Step 2 æ¶æ round 4 (2026-05-06): keep this for callers that
 *  still want the full-background pill (e.g. select-item pickers where
 *  the colored chip helps comprehension). For inline status tags in
 *  card / section headers prefer `compatDotColor` + plain label â? *  Codex's spec calls out that full-bg pills are visually loud when
 *  there's only 1-2 tags on a row.
 */
export function compatTone(compat: ProviderRuntimeCompat): string {
  switch (compat) {
    case 'claude_code_ready':        return 'bg-status-success-muted text-status-success-foreground';
    case 'claude_code_verified':     return 'bg-status-info-muted text-status-info-foreground';
    case 'claude_code_experimental': return 'bg-status-warning-muted text-status-warning-foreground';
    case 'openrouter_anthropic_skin':
      // Same tone as `claude_code_verified` â?the runtime guarantee is
      // the same (Anthropic skin works with Claude Code per OpenRouter
      // docs); only the brand-name flavor differs.
      return 'bg-status-info-muted text-status-info-foreground';
    case 'bbagent_only':           return 'bg-primary/10 text-primary';
    case 'codex_account':            return 'bg-status-info-muted text-status-info-foreground';
    case 'media_only':               return 'bg-muted text-muted-foreground';
    case 'unknown':                  return 'bg-muted text-muted-foreground';
  }
}

/** Just the dot color â?for "colored dot + plain text" inline status
 *  tags. Caller renders e.g. `<span class="size-1.5 rounded-full {dot}" />`
 *  next to a muted-foreground label. */
export function compatDotColor(compat: ProviderRuntimeCompat): string {
  switch (compat) {
    case 'claude_code_ready':        return 'bg-status-success-foreground';
    case 'claude_code_verified':     return 'bg-status-info-foreground';
    case 'claude_code_experimental': return 'bg-status-warning-foreground';
    case 'openrouter_anthropic_skin': return 'bg-status-info-foreground';
    case 'bbagent_only':           return 'bg-primary';
    case 'codex_account':            return 'bg-status-info-foreground';
    case 'media_only':               return 'bg-muted-foreground';
    case 'unknown':                  return 'bg-muted-foreground';
  }
}
