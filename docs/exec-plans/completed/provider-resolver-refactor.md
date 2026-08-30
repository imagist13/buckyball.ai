# Provider Resolver Refactor

**Status:** Complete (Phase 1–5)
**Scope:** Provider system unification — resolve "主聊天能用、旁路功能失效" structural issue

## Problem

- `ApiProvider` mixes protocol/vendor/auth/model-mapping into one flat structure
- `claude-client` and `text-generator` are two independent provider resolution chains
- GLM/Kimi/MiniMax/Volcengine/Bailian are Anthropic-compatible but built as `custom` (OpenAI-compatible in text-generator)
- Model listing relies on hardcoded base_url → model label mapping
- Bridge/chat/onboarding/checkin/plan have divergent provider resolution
- No contract tests

## Solution

### Phase 1: Core modules
- `src/lib/provider-catalog.ts` — vendor presets, default model catalogs, protocol definitions
- `src/lib/provider-resolver.ts` — unified provider/model resolution for all consumers

### Phase 2: DB migration
- Add `protocol`, `headers_json`, `env_overrides_json`, `role_models_json` to `api_providers`
- Create `provider_models` table
- Migrate existing data (provider_type → protocol, extra_env → env_overrides_json)

### Phase 3: Consumer refactoring
- `claude-client.ts` → use resolver's `toClaudeCodeEnv()`
- `text-generator.ts` → use resolver's `toAiSdkConfig()`
- `route.ts`, `conversation-engine.ts`, `onboarding`, `checkin`, `plan` → use shared resolver

### Phase 4: UI update
- `ProviderManager.tsx` presets → reference catalog
- `ProviderForm.tsx` → protocol selector instead of provider_type
- `/api/providers/models` → read from catalog + provider_models

### Phase 5: Tests
- Provider resolver contract tests
- Entry point consistency tests
- Preset protocol validation
- Regression tests (env cleanup, bind semantics)

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-09 | Add fields to existing table, not new system | Minimize migration risk, preserve existing data |
| 2026-03-09 | Protocol-based dispatch instead of brand-name | Matches actual API behavior, extensible |
| 2026-03-09 | Merge custom-anthropic into anthropic-thirdparty | Remove user confusion between two nearly identical presets |
| 2026-03-09 | Auth env keys protected from envOverrides deletion | Legacy extra_env placeholders (`{"ANTHROPIC_AUTH_TOKEN":""}`) were deleting freshly-injected credentials |
| 2026-03-09 | Env var names use `_MODEL` suffix | Claude Code SDK expects `ANTHROPIC_DEFAULT_SONNET_MODEL`, not `ANTHROPIC_DEFAULT_SONNET` |

## Verification

- **aiberm** (no model mapping): ✅ responded "OK claude-sonnet-4-6"
- **pipellm** (with sonnet/opus/haiku mapping): ✅ responded "OK claude-sonnet-4-6"
- Unit tests: 229/229 passed
