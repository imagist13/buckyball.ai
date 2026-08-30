# Harness Home v0.62 Implementation Inventory

> Date: 2026-07-30
> Baseline: local `main@3c9af2e8`, product version `0.62.0`
> Purpose: Shared Phase 0 fact map and enforcing-anchor input. This document records observed code, not desired product claims.

## Executive finding

The user-owned Harness does not currently have one durable, framework-neutral source of truth. The closest existing pieces are:

- assistant workspace Markdown files for identity and memory;
- Claude-centric Skill and MCP filesystem surfaces;
- a per-turn `HarnessBundle` and Context Compiler;
- three Runtime-specific adapters;
- Gallery/media persistence in SQLite plus local files.

The implementation therefore needs a neutral contract and repository before changing UI. Existing loaders remain compatibility sources during migration.

## Source-of-truth map

### Memory and assistant identity

| Concern | Current source | Reader / writer | Ownership observation |
|---------|----------------|-----------------|-----------------------|
| Assistant identity and rules | workspace `soul.md`, `user.md`, `claude.md`/`AGENTS.md` | `src/lib/assistant-workspace.ts:loadWorkspaceFiles / assembleWorkspacePrompt / generateRootDocs` | User files are already the durable source. |
| Long-term memory | workspace `memory.md` | `assistant-workspace.ts`, Memory MCP | User file is durable. |
| Daily memory | workspace `memory/daily/*.md` | `writeDailyMemory / loadDailyMemories`; `src/lib/memory-extractor.ts:extractMemories` | User file is durable; extraction is an automated writer. |
| Workspace state | `.assistant/state.json` | `loadState / saveState` | Runtime state and identity metadata are mixed. |
| Search/runtime access | the files above, exposed by `src/lib/memory-search-mcp.ts:createMemorySearchMcpServer` | Claude/Native/Codex mount paths | Runtime projection exists, but no framework-neutral manifest/index exists. |
| Chat/session memory | SQLite `sessions` / `messages` / summaries | `src/lib/db.ts` | Runtime history, not the canonical user Memory. |

### Skills and commands

| Source | Current implementation | Current write behavior |
|--------|------------------------|------------------------|
| `~/.claude/commands` | `src/app/api/skills/route.ts:GET`; detail route | API creates/updates/deletes Claude command files. |
| `<project>/.claude/commands` | same | Project-scoped Claude surface. |
| `<project>/.claude/skills/*/SKILL.md` | same | Project-scoped Claude surface. |
| `~/.agents/skills/*/SKILL.md` | same | Read and edit support exists. |
| `~/.claude/skills/*/SKILL.md` | same | Read and edit support exists. |
| Claude plugin command directories | `getPluginCommandsDirs` | Read-only discovery. |
| Marketplace install/remove | `src/app/api/skills/marketplace/*/route.ts` | Shells out to `npx skills ... --agent claude-code`; target is hard-coded. |
| Runtime availability | SDK capability cache + Harness scanners | Discovery and executable status are coupled to existing Runtime logic. |

No canonical Skill identity, provenance, conflict, export, or round-trip contract exists.

### MCP

| Source | Reader | Writer / lifecycle |
|--------|--------|--------------------|
| `~/.claude/settings.json:mcpServers` | `src/lib/mcp-loader.ts:loadAndMerge` | `src/app/api/plugins/mcp/route.ts:PUT / POST` |
| `~/.claude.json:mcpServers` | same | `PUT` preserves the rest of the file; delete/toggle routes also touch external config. |
| `<project>/.mcp.json:mcpServers` | `loadProjectMcpServers` | Treated as read-only; enabled override is persisted into Claude settings. |
| `${SETTING_KEY}` placeholders | `mcp-loader.ts` | Resolved from SQLite settings at runtime. |
| Codex projection | `src/lib/codex/mcp-config.ts:buildCodexMcpServersConfig` and built-in MCP builders | Runtime-specific translation and log redaction. |

The MCP Manager currently edits Claude-owned files. Canonical creation and explicit export are absent.

### Runtime and Harness projection

| Concern | Current anchor | Observation |
|---------|----------------|-------------|
| Runtime ID | `src/lib/runtime/runtime-id.ts:RUNTIME_IDS / isRuntimeId` | Closed three-value union. |
| Runtime instances | `src/lib/runtime/registry.ts:registerRuntime / resolveRuntime` | Registry storage is open, but resolution contains ID-specific branches and legacy aliases. |
| Stable runtime contract | `src/lib/runtime/contract.ts`, `src/lib/runtime/types.ts` | Event and permission contracts already exist. |
| Built-in capabilities | `src/lib/harness/capability-contract.ts:HARNESS_CAPABILITIES` | Exposure is a fixed record with three Runtime keys. |
| Turn envelope | `src/lib/harness/harness-bundle.ts:buildHarnessBundle` | Useful per-turn envelope; external framework ID is still closed. |
| Context | `src/lib/harness/context-compiler.ts:compileContext` | Runtime-specific hint branches. |
| Runtime projection | `src/lib/harness/runtime-adapter.ts:adaptForClaudeCode / adaptForNative / adaptForCodexProxy` | Three explicit facades. |
| Settings coverage | `src/lib/harness/capability-matrix.ts`; `src/components/settings/RuntimeCapabilityList.tsx` | Coverage is not descriptor-derived. |

Reproducible lexical baseline:

```text
rg -l "claude_code|codepilot_runtime|codex_runtime" \
  src/lib/runtime src/lib/harness src/app src/components src/hooks
=> 35 product files

rg -l "claude_code|codepilot_runtime|codex_runtime" src/__tests__
=> 57 test / fixture files
```

This is a coupling/risk baseline, not a claim that every file must change for a new Runtime.

### Artifact, media and durable assets

| Kind | Producer / materializer | Validator / terminal condition | Consumer | Durable location | Initial registry decision |
|------|-------------------------|--------------------------------|----------|------------------|---------------------------|
| `image` | `src/lib/media-saver.ts:saveMediaToLibrary / importFileToLibrary`; media generator; Codex import | completed media block or existing file | Gallery / MediaPreview / serve route | `.codepilot-media` file + `media_generations` row | register |
| `video` | media generator/import using MIME mapping | completed file | Gallery / MediaPreview | same | register |
| `audio` | MCP/import path and MIME mapping | completed file; preview support exists in MediaBlock consumers | Gallery / MediaPreview | same | register after conformance fixture |
| `html_bundle` | no durable bundle materializer yet | current HTML preview only validates scoped serving; Artifact may still be turn-local | HTML preview / Artifact renderer | no unified durable Asset record | do not register until Program B2 |
| `web_snapshot` | no producer | none | none | none | do not register |
| `component` | no materializer | none | turn Artifact only | none | do not register |
| `document` | no materializer | none | no Asset consumer | none | do not register |

`media_generations` is a real existing store, but it lacks a general registered-kind descriptor, content hash, lineage, typed reference, and deletion dependency model.

### Secrets and credentials

| Credential class | Current store | Resolver / lifecycle | Portable behavior |
|------------------|---------------|----------------------|-------------------|
| Provider API keys | SQLite `api_providers.api_key`; provider-specific env | provider resolver / transport | Export must contain a ref only. |
| OpenAI OAuth | multiple SQLite settings in `openai-oauth-manager.ts` | refresh and clear functions | Export unresolved on another machine. |
| xAI OAuth | atomic JSON bundle in SQLite setting `xai_oauth_bundle` | `xai-oauth-manager.ts` | Export unresolved on another machine. |
| MCP `${...}` value | SQLite setting | `mcp-loader.ts` | Descriptor may retain the placeholder; resolved value never enters Harness files. |
| Environment credential | process environment | provider resolver | Read-only external reference. |
| Claude/Codex auth | external framework-owned files / CLI | external Runtime | Must not be read, copied, or deleted by Harness migration. |

There is no Electron `safeStorage`, keytar, or OS keychain integration in v0.62. The first implementation therefore uses a compatibility `SecretStore` facade over existing stores:

1. `codepilot-setting` and `codepilot-provider` can resolve and explicitly mutate through existing APIs;
2. `environment` resolves read-only and rejects set/delete;
3. `external-owned` always reports unresolved to portable import/export and never reads auth files;
4. unknown namespaces fail closed;
5. diagnostics return metadata only; export serializes `SecretRef`, never resolved values.

Moving existing credentials into OS storage is a separate security migration and is not silently bundled into Harness Home.

## Fourth-framework touchpoint baseline

The current external-perception L0 path references the closed framework contract or scanner at eight files:

1. `src/lib/harness/harness-bundle.ts`
2. `src/lib/harness/external-framework-harness.ts`
3. `src/lib/harness/runtime-adapter.ts`
4. `src/lib/claude-client.ts`
5. `src/lib/builtin-tools/index.ts`
6. `src/lib/codex/proxy/unified-adapter.ts`
7. `src/__tests__/unit/harness-external-framework-scanner.test.ts`
8. `src/__tests__/unit/harness-extension-fragment.test.ts`

Portable L1 does not exist. Achieving Skill + MCP parity today additionally crosses both Skill route files, marketplace install/remove, MCP API, MCP loader, and their route tests. This is at least eight more implementation/test files before framework-specific parsing.

The target budget after Program A is exactly three change locations for an ordinary L0/L1 addition:

1. `src/lib/harness-home/adapters/<framework-id>/**`
2. one descriptor registry entry
3. adapter fixtures/conformance tests

No Context Compiler, Settings capability component, Artifact renderer, existing adapter, Skill route, or MCP route change is permitted without a logged exception.

Full L3 is intentionally separate. Its v0.62 lexical risk surface is 35 product files plus 57 tests/fixtures; a Runtime addition must use descriptor/conformance work and may still require an explicitly reviewed shipping registration.

## Decisions for implementation

### File write model

- One writer lease per canonical realpath.
- Lock metadata: instance ID, PID, process start identity, acquisition/heartbeat timestamps, schema version, repository generation.
- No automatic takeover. A live or unverifiable holder makes the repository read-only.
- Writes use a same-root transaction directory, prepared journal, fsync where supported, atomic rename, then a committed journal state.
- Expected old hashes are verified immediately before commit.
- Watch events only schedule a rescan. Open, focus, pre-write and explicit refresh compare manifest generation and content hashes.
- Prepared/orphaned transactions are recovered on open; mixed generations are rejected.
- SQLite indexes are cache-only and carry source generation/hash. A mismatch is stale, not current.

### SecretRef

Canonical form:

```text
secret://<namespace>/<percent-encoded-key>?scope=<scope>&v=<version>
```

Namespaces initially registered: `codepilot-setting`, `codepilot-provider`, `environment`, `external-owned`. The parsed contract never contains a resolved value.

### Producer-backed Asset kinds

Initial registered kinds are `image` and `video`. `audio` remains pending until its conformance fixture proves producer, validation, preview and typed-reference behavior. `html_bundle` registers only after B2. Other proposed kinds remain unregistered.

### Design Method evidence

Existing `docs/handover/macos-visual-profile.md` is accepted as a real, implementation-backed source for platform-shell constraints and rejected alternatives. It is not sufficient to manufacture a general CodePilot aesthetic method. Program C may implement evidence/scope/revoke infrastructure, but its built-in method pack and golden set remain a user-review gate.

## Enforcement anchor ledger

| Decision | Current anchor | Target enforcing symbol | Verification |
|----------|----------------|-------------------------|--------------|
| D1 aggregate boundaries | `harness-bundle.ts` mixes layers | `harness-home/contracts.ts` refs/indexes | contract import/source-pin tests |
| D2 file source of truth | assistant files + SQLite/media split | `FileHarnessRepository`; `RepositoryWriterLease` | crash, hash, lock and round-trip tests |
| D3 non-Runtime scope | implicit workspace/project ordering | `scope.ts:compareHarnessScopes / resolveScopedValues` | precedence table tests |
| D4 Full Reference | `HARNESS_CAPABILITIES` status only | `validateCanonicalCapability`; reference conformance | stable/pending rejection tests |
| D5 Artifact/Asset split | Artifact and media separate | `AssetKindRegistry`; materializer terminal contract | kind conformance tests |
| D6 versioned Method | no shared contract | `CreativeMethodDefinition`; evidence model | schema/evidence/revoke tests |
| D7 Secret separation | DB/env/external sources | `SecretRef`, `CompositeSecretStore`, export scanner | leak fixtures and unavailable-store tests |
| L0/L1 boundary | eight-file external scan surface | adapter registry + conformance harness | source-pin and explicit-base changed-files guard |
| Full Reference | three explicit Runtime facades | Runtime descriptor + CodePilot reference validator | descriptor + Runtime smoke |

## Phase 0 conclusion

Shared contracts may start. Program C’s aesthetic quality cannot be closed without user-confirmed briefs and outputs; that is an intentional human gate, not an engineering blocker for Program A.

## A4 implementation delta

The v0.62 observations above remain the historical baseline. Program A4 now
changes the implementation as follows:

- `src/lib/runtime/runtime-catalog.ts` is the compile-time registration source
  for wire IDs, Settings labels, capability exposure keys and packaged driver
  IDs. Existing DB/HTTP values remain unchanged.
- `src/lib/harness-home/runtime/descriptor.ts` derives Runtime capability
  declarations from the existing capability contract/matrix and enforces
  `stable canonical ⊆ CodePilot executable`.
- `src/lib/harness-home/runtime/repository-projection.ts` reads a single
  hash-consistent canonical generation and supplies identity, rules, Memory,
  Methods, matching overlays and Asset refs to all three existing Runtime
  facades.
- Skill/MCP files are visible as catalogued descriptors only. A read succeeds
  without promoting them to executable; their bodies are not injected into
  model context.
- `/api/harness-home/definitions` creates Skills/MCP descriptors in the
  canonical repository first. Same bytes are idempotent; replacing different
  bytes requires an expected hash; external export remains a separate action.
- `GET /api/harness-home` exposes metadata-only diagnostics. `PUT` selects an
  existing validated root and `DELETE` unconfigures it without deleting the
  repository.

This reduces the three fixed Runtime metadata copies, but does not claim that a
fourth chat Runtime is now zero-cost. A fourth packaged Runtime still needs a
driver, event/permission/session/artifact conformance and an explicit shipping
registration. L0/L1 source adapters remain the lightweight path.
