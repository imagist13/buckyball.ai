# Meta-harness redesign: Paseo as the runtime, bb-agent (KODE) as a first-class Paseo provider

> **Status:** design proposal. Not yet implemented.
> Replaces bb.ai's current Omnigent-based runtime (FastAPI on `:6767`,
> per-conversation harness subprocesses, Pydantic REST surface, native REPL,
> multi-harness registry) with a **Paseo-hosted meta-harness**. The new
> **bb-bridge** is a TypeScript backend **built directly on
> `@getpaseo/client`** — not an adapter on top of Omnigent, not a
> compatibility shim. It owns the Paseo client and the SSE/WebSocket
> fan-out to the React web UI; it speaks an `omnigent_client`-shaped
> wire protocol so the existing React UI does not move. It **also
> supervises the Paseo daemon itself** — `bb-bridge server` starts
> `paseo` as a child process and lifecycle-binds them. The
> buckyball-aware worker is a **separate, independently switchable
> Paseo provider called `bb-agent`**, built on `@shareai-lab/kode-sdk`
> — peer to `codex`, `claude`, and `opencode` in Paseo's provider
> catalog. Users can switch freely between `codex/…`, `claude/…`,
> `opencode/…`, and `bb-agent/<any-model>` from the web UI on a
> per-session basis. The web UI, the `.mcp.json` + `.claude/skills/`
> discovery, the user-facing product surface, and the deploy targets
> all stay. The Python-side runtime is frozen at the new minor and
> removed in the release after that.

## Why we are doing this

bb.ai currently stands on a fork of Databricks's Omnigent — a heavy Python
runtime that, for *this* product, does much more than we need:

- It maintains **a multi-harness registry** (`omni / claude / codex /
  cursor / gemini / goose / hermes / kimi / kiro / opencode / pi / qwen /
  …` × native and SDK variants — see `omnigent/runtime/harnesses/`,
  `omnigent/claude_native*.py`, `omnigent/codex_native*.py`, …). The
  product actually wants **one** coding harness per session (Paseo already
  picks a `provider/model` for us), plus our own worker.
- It runs **per-conversation subprocesses over Unix sockets**
  (`HarnessProcessManager`, `_executor_adapter.py`, the
  `_HARNESS_MODULES` registry in `omnigent/runtime/harnesses/__init__.py`)
  so each harness can re-implement the server's Pydantic REST surface in a
  subprocess. Paseo already gives us that surface *as a hosted service*
  (its daemon listens on `:6767/ws`; agents survive our process exiting),
  so we can stop paying the subprocess tax.
- It persists sessions into its own sqlite
  (`omnigent/server/{app.py,DBSPEC.md}`, `~/.omnigent/chat.db`) and has its
  own upgrade cycle, version signature, daemon PID file, CLI, REPL,
  update-check, telemetry, account bootstrap, OIDC, devices, presence,
  smart-routing, performance-metrics, scheduled-sessions, dictation…
  (`omni-upgrade-design.md`, `omnigent/server/*.py`). Paseo already has
  agent list / workspaces / timeline / providers / config with the same
  shape, in TypeScript, as a single daemon we connect to.
- It has a hand-rolled **capability matrix / harness bench**
  (`docs/harness-bench-design.md`, `tests/harness_bench/`) that exists
  only because harnesses are pluggable. When the harness surface collapses
  to Paseo + bb-agent, most of that bench goes away; what remains is the
  Paseo conformance contract (`client.providers.waitForReady()`,
  `client.agents.waitForFinish()`) and the bb-agent conformance contract
  (the KODE event-stream contract we settle on).

bb.ai is a *buckyball-aware* AI product, not a multi-harness playground.
The Omnigent surface is a generic agent platform with features
(account/auth, multi-user deploys, scheduled sessions, presence,
dictation, smart routing) we are not using, plus the harness-pluggability
machinery we are explicitly moving away from. Replacing the bottom layer
with Paseo + KODE keeps the product identical and drops roughly 60–70 %
of the Python source tree.

## Goals

- **The user product is unchanged.** A user can still open the React web
  UI, pick a buckyball project, and have an agent that knows about
  `bbdev_*` tools, `waveform-mcp`, the `/ball`, `/bbdev`, `/verify`,
  `/waveform` skills, and the buckyball markdown guides. They get the same
  chat, streaming, tool calls, reasoning, approvals, fork/resume, images.
- **Paseo is the runtime.** Agents live in Paseo, sessions live in
  Paseo's timeline, the daemon is the source of truth. bb.ai connects
  through `@getpaseo/client` (`createPaseoClient` over `ws://…/ws`), one
  long-lived client per bb.ai server process.
- **`bb-agent` is a first-class Paseo provider, peers with `codex`,
  `claude`, and `opencode`.** It is **not** an internal dispatch layer
  — it is a separately installed CLI binary that Paseo launches the
  same way it launches `codex` or `claude`, identified by the provider
  id `bb-agent`. Every session in bb.ai is a Paseo agent created with
  `client.agents.create({ config: { provider: "<id>/<model>" } })`, and
  `<id>` is one of: `codex`, `claude`, `opencode`, `bb-agent`. The web
  UI exposes this as a **provider switcher** — the user picks a
  provider/model per session, mid-session if they want, exactly as they
  would pick a model inside the Paseo app itself.
- **`bb-agent`'s internal model is free.** Because `bb-agent` is its
  own Paseo provider, the model id under `bb-agent/<model>` is whatever
  the user wants — `bb-agent/claude-sonnet-4-5`,
  `bb-agent/gpt-5`, `bb-agent/gemini-3-flash`, even
  `bb-agent/<local-llm>`. We do **not** lock `bb-agent` to a single
  upstream model. The bb-agent binary ships the KODE runtime and the
  buckyball tool surface; the model selection is a deployment-time and
  per-session choice.
- **`bb-bridge` is a thin gateway with no business logic.** It does
  two things only: (a) translates `omnigent_client`-shaped HTTP / SSE /
  WebSocket requests into Paseo SDK calls so the React UI does not
  change, and (b) supervises the Paseo daemon process itself
  (`spawn('paseo', …)`, lifecycle-bind to bb-bridge, restart on
  crash). It does **not** assemble agent configs, load buckyball
  skills, build MCP server manifests, or decide which provider to
  use — all of that lives in `bb-companion` (see next goal).
- **`bb-companion` is a separate TypeScript service that owns bb.ai's
  buckyball-specific business logic.** It reads the user's cwd,
  resolves the buckyball root, loads the buckyball skill catalog and
  MCP server manifests, decides which KODE template to use, composes
  the final Paseo `config` (systemPrompt + mcpServers + options +
  modeId + featureValues), and writes it to the Paseo agent via the
  SDK. It runs as its own process; bb-bridge proxies inbound requests
  to it for any endpoint that requires business logic, and forwards
  the rest directly to Paseo.
- **The Python runtime is frozen and removed.** Once `bb-bridge` is
  feature-complete and the deploy targets (`deploy/docker`, `deploy/k8s`,
  `deploy/railway`, `deploy/render`, `deploy/databricks`, `deploy/tailscale`)
  call `bb-bridge` instead of `omnigent server`, the `omnigent/`,
  `sdks/python-client/`, `sdks/ui/`, and `scripts/` trees become
  no-op shims. They are removed in the release *after* the freeze. The
  harness-bench is also frozen and removed with them.

## Non-goals

- **Not** a multi-harness product. Paseo already selects a provider; we
  do not re-introduce the Omnigent harness registry, the
  `_HARNESS_MODULES` mapping, the `Executor` capability flags
  (`omnigent/inner/executor.py`), or any of the per-harness `*_native.py`
  / `*_native_bridge.py` / `*_native_forwarder.py` families. The
  harness-bench file is the contract for that decision; no probe code
  ports.
- **Not** a self-hosted, no-network rewrite. bb.ai still assumes
  Anthropic / OpenAI / Gemini credentials (now via Paseo's provider
  catalog, not Omnigent's `model_catalog.py`). Local sandbox is via
  Paseo's existing `sandbox_mode` / Claude `sandbox` / OpenCode
  `permission` options, not via Omnigent's `sandbox.py` / `_scaffold.py`.
- **Not** a full OM1-rewrite of the React UI. The UI keeps using the
  existing `omnigent_client`-shaped stream protocol; only the transport
  URL changes (from `omnigent server` to `bb-bridge`). The omnigent
  Python client library is replaced by an `omnigent-shim` re-export
  package that maps onto the bridge, so any third-party that imports
  `omnigent_client` keeps working for one release.
- **Not** a feature-add. No new tool, no new skill, no new model.
  Everything that works today works the same; the surface is just thinner
  underneath.

## Key constraints we inherit

These come from the two SDKs we are betting on and are non-negotiable
until the SDKs change:

1. **Paseo needs a running daemon.** `npx @getpaseo/cli` starts a
   WebSocket daemon on `ws://127.0.0.1:6767/ws`. We must always have one
   running per bb.ai deployment (local dev: started by `just dev`; remote
   deploys: started by the `bb-bridge` entrypoint, supervised by the
   same process supervisor that currently supervises `omnigent server`).
2. **Paseo agents are provider-scoped.** `config.provider` is
   `provider/model` (e.g. `codex/gpt-5.5`, `claude/claude-sonnet-5`).
   Providers are discovered via `client.providers.waitForReady()` and
   may be `unavailable` / `error`. The bb-agent must therefore be
   installed as a **custom Paseo provider** (a CLI binary Paseo can
   exec), not as an SDK call.
3. **`bb-agent` must run kode-agent-sdk.** The KODE SDK has three event
   channels (Progress / Control / Monitor) and an 8-stage
   breakpoint state machine (`READY → PRE_MODEL → STREAMING_MODEL →
   TOOL_PENDING → AWAITING_APPROVAL → PRE_TOOL → TOOL_EXECUTING →
   POST_TOOL`). Paseo's provider-options API only exposes a CLI plus a
   few sandbox/permission knobs; the bb-agent must therefore package the
   KODE runtime *as* a CLI that Paseo spawns, with the KODE event stream
   translated into Paseo's `timeline` events on stdout/Paseo-bridge.
4. **Sandbox is provider-native, not bb.ai's.** Codex wants
   `approval_policy` / `sandbox_mode` / `sandbox_workspace_write`;
   Claude wants `sandbox.{enabled,filesystem,network}`; OpenCode wants
   `permission.{read,edit,bash,webfetch,…}`. bb.ai does **not** add its
   own sandbox layer; it forwards the user's buckyball-project
   `BUCKYBALL_ROOT` as `writable_roots` / `allowWrite`, plus a deny list
   for the user's credential directories. The bb-agent uses
   `kode-agent-sdk`'s `LocalSandbox` (or its `SandboxFactory` for E2B /
   OpenSandbox) for *its own* tools; that's a separate decision from
   what the provider CLI sees.
5. **Tool delivery to Paseo agents is `config.mcpServers`** (session-scoped
   MCP servers) or `config.options.mcpServers` plus `config.toolPolicy`
   for preapproval. We render every buckyball `.mcp.json` entry into one
   of these — stdio servers become a Paseo MCP launcher with the same
   `${BUCKYBALL_ROOT}` expansion semantics; HTTP servers pass through.
6. **Permissions are surfaced to Paseo as `permission` events on the
   timeline**, not as a separate `pending_elicitations.py`. The bb-agent
   reports its tool-execution permission needs over KODE's Control
   channel, which the bb-agent CLI translates into Paseo provider-native
   `ask` semantics; the user answers in the Paseo desktop app or
   programmatically via `client.agents.ref(id).decide(...)`.

## Architecture (target)

```
                          ┌─────────────────────┐
                          │   bb.ai Web UI      │  React + Vite + Tailwind
                          │   (unchanged)       │  + shadcn/ui (existing)
                          └──────────┬──────────┘
                                     │  HTTP/SSE/WebSocket
                                     │  omnigent_client-compatible
                                     │  protocol (wire-compatible)
                                     ▼
                ┌────────────────────────────────────────┐
                │           bb-bridge (TS)               │
                │  ─ stateless gateway (no biz logic)     │
                │  ─ translates omnigent_client → Paseo  │
                │  ─ supervises Paseo daemon process     │
                │       spawn / restart / shutdown       │
                └──────┬─────────────────────┬───────────┘
                       │                     │
              pure     │                     │  endpoints that need
              passthrough                    │  buckyball-aware logic
              (list agents,                 │  (skill/MCP compose,
              stream timeline,              │  attach_buckyball,
              list providers,               │  pick template, …)
              …)                            │
                       │                     ▼
                       │        ┌─────────────────────────────┐
                       │        │   bb-companion (TS)         │
                       │        │   ─ buckyball root discovery│
                       │        │   ─ skill catalog loading   │
                       │        │   ─ MCP server assembly     │
                       │        │   ─ config composer         │
                       │        │   ─ writes via Paseo SDK    │
                       │        └────────────┬────────────────┘
                       ▼                     ▼
                ┌────────────────────────────────────────┐
                │     Paseo daemon  (spawn'd by bb-bridge) │
                │  ─ provider catalog                     │
                │    • codex/…                            │
                │    • claude/…                           │
                │    • opencode/…                         │
                │    • bb-agent/<any-model>   ← new        │
                │  ─ workspaces  (per-buckyball-root)    │
                │  ─ agents      (long-running sessions) │
                │  ─ timeline    (events)                │
                │  ─ config      (admin patch surface)   │
                └──┬──────────┬───────────────┬──────────┘
                   │ exec    │ exec          │ exec
                   ▼         ▼               ▼
              codex CLI  claude CLI      bb-agent binary
              (provider) (provider)     ┌──────────────────────┐
                                        │  bb-agent CLI (TS)   │
                                        │  ─ wraps kode-sdk    │
                                        │  ─ AgentTemplate-    │
                                        │    Registry (plan/   │
                                        │    apply/review/     │
                                        │    debug/…)          │
                                        │  ─ publishes Paseo-  │
                                        │    shaped timeline   │
                                        │  ─ exposes 33+ bbdev_*│
                                        │    tools via the      │
                                        │    buckyball-dev MCP  │
                                        │    (stdio subprocess) │
                                        │  ─ model-agnostic:    │
                                        │    Anthropic / OpenAI │
                                        │    / Gemini / local   │
                                        └──────────────────────┘
```

**Process boundaries:**

- **`bb-bridge`** is the only process the deploy targets start.
  `bb-bridge server` does two things at boot:
  1. `spawn('paseo', ['daemon'])` — Paseo daemon as a child process,
     stdio piped, `SIGTERM` on exit.
  2. `createPaseoClient({ url: 'ws://127.0.0.1:6767/ws' })` —
     long-lived client to that daemon; reconnect enabled.
- **`bb-companion`** is a separate TS service (`bb-companion
  server`). bb-bridge proxies the `POST /v1/agents` request (or
  whatever the "create a new agent" path is) to bb-companion via
  internal HTTP, gets back the fully-composed Paseo `config`, and
  forwards it to Paseo via the SDK. Other endpoints (list agents,
  stream timeline, get / decide permissions) stay pure passthrough.
- **`bb-agent`** is a standalone Paseo provider binary installed on
  PATH; Paseo execs it when the chosen `provider` starts with
  `bb-agent/`. bb-bridge / bb-companion never exec it directly.
- **Paseo daemon** is owned by bb-bridge via process supervisor
  semantics — start with bb-bridge, restart on crash, stop on
  bb-bridge `SIGTERM`.

**`bb-agent` is a peer of `codex` and `claude`.** The Paseo daemon
discovers it through `client.providers.waitForReady()` the same way it
discovers any installed provider. A user can switch from
`provider: "codex/gpt-5.5"` to `provider: "bb-agent/claude-sonnet-4-5"`
to `provider: "claude/claude-sonnet-5"` between two adjacent turns or
between two sessions, and Paseo keeps the agents, timelines, and
workspaces independent for each. The web UI's "Agent provider" picker
is a thin wrapper around this provider switch — there is no special
"bb-agent mode."

### The four new components

| Component        | Replaces (Omnigent)                                | Why it exists                                                                                              |
| ---------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `bb-bridge`      | `omnigent/server/{app.py,auth.py,oidc.py,…}`        | Stateless TS API. Owns the Paseo client, buckyball discovery/loading, and SSE/WS fan-out to the web.        |
| Paseo daemon     | `omnigent/server/managed_hosts.py` + `_runner.py`  | Already a hosted WS daemon. Owns provider discovery, agent lifecycle, workspaces, timeline.                  |
| `bb-agent` CLI   | per-harness `*_native*.py` family                  | A standalone Paseo provider binary built on kode-agent-sdk. Installed once; appears in `client.providers.list()` next to `codex`, `claude`, `opencode`. |
| Custom Paseo provider manifest | `omnigent/runtime/harnesses/_HARNESS_MODULES`            | The bb-agent manifest (`{ id: "bb-agent", binary, optionsSchema, capabilities }`) is installed via `client.config.patch` at `bb-bridge` startup. Paseo picks it up on `providers.refresh()`. |

### What disappears

Everything that existed *only* to support multi-harness Omnigent semantics
is deleted in the freeze release after this ships. Concretely:

- `omnigent/runtime/harnesses/`, `omnigent/runtime/inner/`,
  `omnigent/claude_native*.py`, `omnigent/codex_native*.py`,
  `omnigent/cursor_native*.py`, `omnigent/gemini_native*.py`,
  `omnigent/qwen_native*.py`, `omnigent/goose_native*.py`,
  `omnigent/hermes_native*.py`, `omnigent/kimi_native*.py`,
  `omnigent/kiro_native*.py`, `omnigent/opencode_native*.py`,
  `omnigent/pi_native*.py`, `omnigent/antigravity_native*.py`,
  `omnigent/codex_native_*.py`, and the whole `cli_native.py`,
  `native_*_forwarder.py`, `native_*_bridge.py`, `native_*_permissions.py`,
  `native_*_status.py`, `native_*_state.py` families.
- `omnigent/harness_plugins.py`, `omnigent/harness_aliases.py`,
  `omnigent/harness_capabilities.py`, `omnigent/harness_availability.py`,
  `omnigent/harness_install_spec.py`, `omnigent/harness_startup_config.py`,
  `omnigent/model_override.py`, `omnigent/model_catalog.py`,
  `omnigent/model_fallbacks.py`, `omnigent/model_metadata.py`,
  `omnigent/model_resolver.py`, `omnigent/reasoning_effort.py`,
  `omnigent/native_coding_agents.py`, `omnigent/native_dispatch.py`,
  `omnigent/native_policy_hook.py`, `omnigent/native_server_harness.py`,
  `omnigent/native_server_transport.py`, `omnigent/native_terminal.py`.
- `omnigent/inner/executor.py`, the `Executor`-capability flag surface
  (`supports_streaming`, `supports_live_message_queue`,
  `supports_tool_boundary_interrupt`, `supports_stepwise_internal_turns`,
  `handles_tools_internally`), and the `tests/harness_bench/` family
  including `tests/e2e/_harness_probes.py`. The harness-bench's job
  ("empirically prove a harness's flags") has no object now; the new
  contract is "Paseo is the harness, and it's its own conformance test
  suite."
- The Omnigent-side persistence (`~/.omnigent/chat.db`,
  `local_server.pid`, `local_server.sig`,
  `omnigent/host/local_server.py`,
  `omnigent/update_check.py`, `omni upgrade`,
  `omnigent/server/accounts_*`, `omnigent/server/device_grant_store.py`,
  `omnigent/server/oidc*`, `omnigent/server/sharing_settings.py`,
  `omnigent/server/presence.py`, `omnigent/server/dictation*`,
  `omnigent/server/scheduled/`, `omnigent/server/smart_routing*.py`,
  `omnigent/server/performance_metrics.py`,
  `omnigent/server/admin_list.py`, `omnigent/server/bundles.py`,
  `omnigent/server/_runner_*`). Paseo owns its own daemon lifecycle;
  any bb.ai-specific auth/identity is a small `bb-bridge` middleware, not
  a reimplementation.
- `omnigent/server/api/*.py` (REST routes) — replaced by `bb-bridge`'s
  route handlers, which speak the same `omnigent_client` shapes on the
  wire so the web UI is untouched.
- `omnigent/repl/`, `omnigent/terminals/` — `bb-agent`'s REPL becomes
  Paneo's app (or a thin `bb-bridge`-hosted REPL if we still want a
  terminal-only mode).
- `omnigent/skills/buckyball/` — ported into `bb-companion` as
  `bb-companion/buckyball/{discover,load}.ts`. Public symbol stays
  `attach_buckyball_to_spec`, just renamed to
  `attachBuckyballToAgentConfig` and returning a Paseo-shaped payload
  instead of an Omnigent `AgentSpec`. `bb-bridge` knows nothing
  about buckyball — it only knows how to proxy the request to
  bb-companion's `/internal/compose`.
- `sdks/python-client/`, `sdks/ui/` — replaced by an `omnigent-shim`
  PyPI package that re-exports the same `omnigent_client` surface but
  routes every call to `bb-bridge`. Third-party consumers see no break
  for one release, then we delete the shim.
- `docs/harness-bench-design.md`, `docs/omni-upgrade-design.md`,
  `docs/cursor-native-*.md`, `docs/qwen-native-*.md`,
  `docs/kiro-native-elicitation.md`, `docs/openclaw.md`,
  `docs/antigravity-native-rpc-*.md`, `docs/QUEUE_STEER_DESIGN.md`,
  `docs/UNINSTALL_DESIGN.md`, `docs/POLICIES.md`,
  `docs/cursor-native-cost-tracking.md`,
  `docs/model-hardcoding-plan.md`, `docs/OMNIGENT_BOT_SETUP.md`,
  `docs/blog-csdn-intro.md`, and `omnigent/runtime/README.md`,
  `omnigent/server/API.md`, `omnigent/server/DBSPEC.md`,
  `omnigent/spec/AGENTSPEC.md`. A new `docs/meta-harness-design.md`
  (this file) supersedes them.

### bb-bridge: process supervisor + gateway, in code

```ts
// bb-bridge/src/server.ts — the only entrypoint users run.
import { spawn, ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { createPaseoClient, PaseoClient } from "@getpaseo/client";
import { registerRoutes } from "./routes";
import { proxyToBbCompanion } from "./companion-proxy";

const PASEO_DAEMON_BIN = process.env.PASEO_BIN ?? "paseo";
const PASEO_WS_URL = process.env.PASEO_WS_URL ?? "ws://127.0.0.1:6767/ws";
const BB_COMPANION_URL =
  process.env.BB_COMPANION_URL ?? "http://127.0.0.1:6768";
const BB_BRIDGE_PORT = Number(process.env.BB_BRIDGE_PORT ?? 6767);

let paseoProc: ChildProcess | undefined;

async function spawnPaseoDaemon(): Promise<void> {
  paseoProc = spawn(PASEO_DAEMON_BIN, ["daemon"], {
    stdio: ["ignore", "inherit", "inherit"],
    detached: false,
  });
  paseoProc.on("exit", (code, signal) => {
    console.error(`[bb-bridge] paseo daemon exited code=${code} signal=${signal}`);
    if (signal !== "SIGTERM" && signal !== "SIGINT") {
      // Restart with simple backoff; bb-bridge is the supervisor.
      setTimeout(() => spawnPaseoDaemon().then(waitForReady), 1_000);
    }
  });
}

async function waitForReady(): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const ws = new WebSocket(PASEO_WS_URL);
      await new Promise<void>((res, rej) => {
        ws.once("open", () => { ws.close(); res(); });
        ws.once("error", rej);
      });
      return;
    } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error("paseo daemon did not become ready within 10s");
}

let paseo: PaseoClient;
async function main() {
  await spawnPaseoDaemon();
  await waitForReady();
  paseo = createPaseoClient({ url: PASEO_WS_URL, reconnect: { enabled: true } });

  // Confirm bb-companion is reachable. bb-companion is started by the
  // deploy / by `just dev`; bb-bridge does NOT spawn it.
  await fetch(`${BB_COMPANION_URL}/internal/health`).then((r) => {
    if (!r.ok) throw new Error(`bb-companion unhealthy: ${r.status}`);
  });

  const httpServer = createServer((req, res) => {
    // Single forwarder: every /v1/agents goes to bb-companion for
    // composition; every other /v1/* path is passthrough to Paseo.
    if (req.url === "/v1/agents" && req.method === "POST") {
      proxyToBbCompanion(req, res, `${BB_COMPANION_URL}/internal/compose`);
      return;
    }
    registerRoutes(req, res, paseo);
  });
  httpServer.listen(BB_BRIDGE_PORT, () =>
    console.log(`[bb-bridge] listening on :${BB_BRIDGE_PORT}`));
}

process.on("SIGTERM", () => {
  paseoProc?.kill("SIGTERM");
  process.exit(0);
});
process.on("SIGINT", () => {
  paseoProc?.kill("SIGINT");
  process.exit(0);
});

main().catch((err) => {
  console.error("[bb-bridge] fatal:", err);
  paseoProc?.kill("SIGTERM");
  process.exit(1);
});
```

Key constraints in the skeleton above:

- **`bb-bridge` only spawns Paseo daemon.** bb-companion is started
  by the deploy (`just dev`, `deploy/docker/Dockerfile`, k8s
  manifest, etc.) as a separate service on a known port. bb-bridge
  treats it as a sibling and proxies to it over loopback HTTP.
- **Paseo is lifecycle-bound.** `SIGTERM` on bb-bridge forwards to
  Paseo. Crashes (non-`SIGTERM` exits) trigger a 1 s backoff
  restart. Daemon and bridge die together.
- **No business logic lives in this file.** The only bb.ai-specific
  branch is `if (req.url === "/v1/agents" && req.method === "POST")`
  → forward to `bb-companion`. Everything else is a `registerRoutes`
  call that translates `omnigent_client`-shaped HTTP to the Paseo
  SDK.

## The Paseo side: meta-harness core

Paseo's SDK ([`@getpaseo/client`](../demo/paseo/public-docs/sdk/index.md) — note:
that path lives in the `demo/` checkout and may not exist in production
trees; we treat it as the canonical reference until bb.ai vendors the
docs) is deliberately thin — `createPaseoClient({ url })`, then
`client.agents.{create,list,ref,subscribe}`, `client.workspaces.*`,
`client.providers.*`, `client.config.{get,patch}`. bb.ai's
meta-harness sits on top.

### bb-bridge ↔ Paseo wiring

One `bb-bridge` process owns **one long-lived Paseo client** for its API
layer (so HTTP requests can map to `agents.ref(id).run(...)` and the
existing omnigent-shaped streaming). bb-agent invocations are
**not** mediated by bb-bridge — Paseo execs the bb-agent CLI directly
based on `provider: "bb-agent/<model>"`. bb-bridge only orchestrates
*Paseo* calls; the Paseo daemon is what supervises bb-agent process
lifecycle. The Paseo client is configured with
`reconnect.enabled: true` so it survives daemon restarts; after a
reconnect bb-bridge reads agent state via `ref(id).refresh()` so it
does not desync from the daemon.

The HTTP API is shaped like the existing `omnigent_client` protocol so
the React UI does not move. Internally, every `/v1/sessions/<id>/send`
maps to `workspace.agents.create({...}).waitForFinish()` (or
`agent.send(...)` / `agent.run(...)` for follow-ups), and every stream
maps onto Paseo timeline events re-emitted as the existing
`ResponseCreated` / `TextDelta` / `ToolCallDone` / `ResponseEnd`
SSE events. A short Python `omnigent-shim` package re-exports
`omnigent_client` and proxies to `bb-bridge` so third-party Python
consumers keep working.

### Workspaces per buckyball project root

Every buckyball project root discovered by
`find_buckyball_roots(cwd, max_depth=8)` becomes a Paseo **workspace**
via `client.workspaces.create({ source: { kind: "directory", path: root
}, title: <root>.name })`. The workspace handle holds `BUCKYBALL_ROOT`,
and any agent created inside it inherits that as its work directory.
That replaces today's `find_buckyball_roots` invocation at every
`AgentSpec` build — the discovery moves to *workspace creation*, which
already deduplicates (one workspace per directory).

### Skills → system prompt fragments, MCP servers → `config.mcpServers`

`load_buckyball_skills(roots)` returns a flat list of `SkillSpec`. For
each one, `bb-bridge` appends its `content` to the Paseo
`config.systemPrompt` under a stable heading (so Paseo still owns the
system-prompt layering). `load_buckyball_mcp_servers(roots)` returns
`MCPServerConfig`s; each `stdio` server is forwarded to Paseo with
`config.mcpServers[name] = { command, args, env }` (env already
expanded against the workspace's `BUCKYBALL_ROOT`), each `http` server
becomes `{ url, headers }`. Paseo's `config.toolPolicy` can preapprove
specific MCP tool names if the user opts in to unattended buckyball
runs.

### Custom Paseo provider for bb-agent

The bb-agent is a **separate, independently switchable Paseo
provider**, peers with `codex`, `claude`, and `opencode`. Once
installed and registered, it appears in `client.providers.list()`
output alongside the others. Users pick it from the web UI the same
way they would pick `claude` or `codex` — by choosing a `provider` on
agent creation — and Paseo handles the rest.

The provider is registered once at `bb-bridge` startup via
`client.config.patch(...)`. The exact shape of the patch payload is
**TBD against Paseo's provider-manifest schema** (the SDK reference
names `config.options` validation as strict and provider-scoped, but
does not document the manifest endpoints). A working first cut is
below; the final shape comes from a short spike with the Paseo team in
Stage 2.

```ts
// bb-bridge/src/providers/bb-agent/register.ts
import { PaseoClient } from "@getpaseo/client";

const bbAgentManifest = {
  id: "bb-agent",
  label: "Buckyball agent (KODE SDK)",
  // Path to the bb-agent binary; Paseo execs it per agent turn.
  binary: resolveBbAgentBinary(),
  // Provider-native options we forward to config.options.
  optionsSchema: bbAgentOptionsSchema,
  // Capabilities Paseo exposes via listFeatures/listModes so the web
  // UI can build its provider picker.
  capabilities: {
    modes: ["plan", "apply", "review", "debug"],
    thinking: ["low", "medium", "high"],
    features: ["buckyball-dev", "waveform-mcp"],
    sandbox: "provider-native",
    multimodal: true,
    resumable: true,
  },
};

await client.config.patch({ providers: { "bb-agent": bbAgentManifest } });
```

After registration, Paseo treats `bb-agent` exactly like any other
provider:

- `client.providers.waitForReady()` reports `bb-agent` as `ready`
  when the binary is on PATH, the credentials are resolvable, and a
  smoke turn completes.
- `client.providers.listModels("bb-agent", { cwd })` returns the model
  ids the bb-agent binary advertises (these come from the bb-agent's
  own diagnostic — see `bb-agent/src/diagnostic.ts`, which lists
  every KODE `ModelProvider` it knows how to drive).
- `client.providers.diagnostic("bb-agent")` returns the bb-agent's
  own diagnostic output (model credential check, sandbox availability,
  buckyball root reachability) for the `bb-bridge` UI.

**Crucially, `bb-agent`'s model catalog is independent of the upstream
vendor catalogs.** The bb-agent binary declares its own model list at
startup based on which provider credentials it can resolve — `claude-*`
if `ANTHROPIC_API_KEY` is set, `gpt-*` if `OPENAI_API_KEY` is set,
`gemini-*` if `GOOGLE_API_KEY` is set, plus whatever local model
endpoints the operator configured. The web UI's "Provider → Model"
dropdown reads `client.providers.listModels(provider)` for whichever
provider the user picked, so the dropdown contents differ by user.

### Agent creation (the product surface)

The web UI's "New session" form exposes **provider** and **model** as
two adjacent dropdowns. The provider dropdown lists every entry from
`client.providers.list()` — typically `codex`, `claude`, `opencode`,
`bb-agent`, plus whatever else the host has installed. The model
dropdown is populated by
`client.providers.listModels(<provider>, { cwd })`, so it changes
based on the provider selection. Both are persisted on the
`AgentSpec` (or its Paseo equivalent) so a session can be reopened
later with the same pairing.

When the user clicks "Start," the request flow is:

1. **Web UI → bb-bridge** posts `POST /v1/agents` with the chosen
   `provider`, `model`, `modeId`, `thinkingOptionId`, prompt, cwd.
   bb-bridge does **no** interpretation; it forwards the request to
   bb-companion's `POST /internal/compose` as the literal body.
2. **bb-companion** resolves the buckyball context (cwd → buckyball
   root → loaded skills / MCP servers), then composes the final
   Paseo `config`:

   ```ts
   const composed = await composeAgentConfig({
     provider: `${selectedProvider}/${selectedModel}`,
     modeId: selectedMode,                     // e.g. "apply"
     thinkingOptionId: selectedThinking,       // e.g. "high"
     cwd,
     buckyballRoot: discoverBuckyballRoot(cwd),
     skills: loadBuckyballSkills(cwd),
     mcpServers: loadBuckyballMcpServers(cwd),
     sandboxPolicy: sandboxOptionsForProvider(selectedProvider, workspace),
     userPrompt: firstUserMessage,
   });
   // composed = { config, title, labels, cwd, prompt }
   ```

3. **bb-companion → Paseo SDK** writes the agent:

   ```ts
   await paseo.workspaces.openOrReuse(workspaceDir).then((ws) =>
     ws.agents.create({
       config: composed.config,
       cwd: composed.cwd,
       title: composed.title,
       labels: composed.labels,                 // bb-source / bb-workspace / bb-provider
       prompt: composed.prompt,
     }),
   );
   ```

4. **bb-companion → bb-bridge** returns the Paseo agent id; bb-bridge
   streams the Paseo timeline events back to the web UI as
   `omnigent_client`-shaped SSE / WS until the agent finishes or the
   user closes the session.

Labels are namespaced (`bb-source`, `bb-workspace`, `bb-provider`)
so bb.ai can filter its own agents out of Paseo's app. The Paseo
`systemPrompt` carries the buckyball skills regardless of provider
(so `codex` and `claude` still get the `/ball` knowledge);
`mcpServers` carries the buckyball MCP servers regardless of
provider (so the bbdev_* tools arrive even if the user picks
`codex`). When the chosen provider is `bb-agent`, bb-companion
additionally sets `modeId` so Paseo passes
`BB_AGENT_TEMPLATE=<modeId>` to the bb-agent CLI; KODE then picks
the matching `AgentTemplateDefinition` from its
`AgentTemplateRegistry`.

### Switching mid-project

The web UI exposes a "Switch provider" affordance on every active
session. Switching does **not** mutate the in-flight Paseo agent —
Paseo's `client.agents` API treats `provider` as an immutable
session-creation property. Instead, switching starts a **new** Paseo
agent with the new `provider/model`, with `parent: <previousAgent>`
so Paseo preserves the lineage and the old agent is kept alive until
the user explicitly archives it. The web UI's UI thread shows the new
agent's stream; the previous one is reachable via the "History" panel.
This is the same pattern the Paseo `agents.md` doc describes for
"subagent via workspace" — we apply it to "user changed their mind
about which provider to use."

### Fork, resume, steer, queue, compact

Paseo's `client.agents.ref(id)` + `agent.run(prompt)` gives us
follow-up turns. `agent.fork()` (parent / child semantics, archival
cascade) gives us session branching. `agent.subscribe()` over `progress`
gives us streaming. The bb-agent itself is a KODE agent, which means
the bb-agent adds its **own** checkpoint / resume / fork on top — useful
for long-running buckyball simulations. The Paseo layer handles the
**agent**; the KODE layer handles the **bb-agent's own state**.

### Permissions

Tool permissions in the product today come from
`omnigent/policies/` + `omnigent/runtime/policies/`. After the cut:

- **Provider-CLI tool permissions** (Codex's `approval_policy`,
  Claude's `sandbox`, OpenCode's `permission`) are passed straight
  through `config.options`. The buckyball project root becomes the
  `writable_roots` / `allowWrite`, plus the user's
  `~/.ssh`, `~/.aws`, `~/.gnupg` become `denyRead` if the user opts in.
- **bb-agent's own tool permissions** (KODE's `permission_required`
  on the Control channel) become `ask` against Paseo's permission
  system. The bb-agent CLI publishes them on stdout as Paseo
  `permission` events; Paseo surfaces them in its app timeline. The
  user answers either in the Paseo app or programmatically via
  `client.agents.ref(agentId).decide(callId, "allow"|"deny")`. For
  web-UI sessions where the user is not in the Paseo app, `bb-bridge`
  proxies the decision through a single `bb-bridge/policies.ts` table
  (a thin TS rewrite of `omnigent/policies/`, kept small because the
  surface is small).

## The bb-agent side: a KODE-built Paseo provider

`bb-agent` is a TypeScript CLI built on `@shareai-lab/kode-sdk`. It is
a **peer Paseo provider**, peers with `codex` and `claude`: Paseo
discovers it as one entry in `client.providers.list()`, execs it for
agents whose `config.provider` starts with `bb-agent/`, streams its
stdout as a timeline, and tears it down when the agent is archived.
The bb-agent binary lives outside `bb-bridge`; it can also be invoked
on the command line (`bb-agent --cwd <project> --template plan
--prompt "..."`) for testing or for users who want a terminal
interface — but in the bb.ai product, Paseo is what calls it.

### Why kode-agent-sdk and not a hand-rolled loop

KODE gives us four things a hand-rolled loop does not give us cheaply,
and three of them are user-facing:

1. **`AgentTemplateRegistry` is the switchable-agent surface.** Every
   `bb-agent` session picks its `templateId` at creation time. The
   registry can be reloaded at runtime (`registry.bulkRegister(...)`),
   so adding a new template is a single PR — no Paseo update, no
   bb-bridge redeploy.
2. **Long-running, resumable agent state.** KODE has the 8-stage
   breakpoint state machine and WAL-backed persistence. A bb-agent
   can be paused mid-simulation (e.g. halfway through a 20-minute
   Verilator run) and resumed from the same breakpoint — across
   process restarts, across `bb-bridge` upgrades, across Paseo
   reconnects.
3. **Three-channel event output.** Progress is the timeline Paseo
   re-emits; Control is the approval surface; the Monitor channel
   is the audit sink.
4. **Tool surface as a first-class concept.** KODE's `defineTool`,
   `ToolRegistry`, `MCPConfig`, and `getMCPTools` make it natural to
   expose the `buckyball-dev` MCP server (33 `bbdev_*` tools +
   `waveform-mcp`) and to layer bb.ai-specific tools on top.

### bb-agent's shape

```ts
// bb-agent/src/main.ts — the entrypoint Paseo execs per agent turn.
import {
  Agent, AnthropicProvider, OpenAIProvider, GeminiProvider,
  JSONStore, builtin, AgentTemplateRegistry, ModelProvider,
} from "@shareai-lab/kode-sdk";
import { buckyballDevMcp, waveformMcp } from "./mcp";
import { buckyballSkillTools } from "./skills";
import { paseoTimelineBridge } from "./paseo-bridge";

// Build the template registry FIRST so we can advertise the catalog
// to Paseo via its diagnostic output.
const templates = new AgentTemplateRegistry();
templates.bulkRegister([
  {
    id: "plan",
    name: "Plan",
    systemPrompt: PLAN_PROMPT,
    tools: ["fs_read", "fs_glob", "fs_grep", "todo_write", "skills"],
    permission: { mode: "auto" },
    metadata: { buckyballModes: ["plan"] },
  },
  {
    id: "apply",
    name: "Apply",
    systemPrompt: APPLY_PROMPT,
    tools: ["fs_read", "fs_write", "fs_edit", "bash_run", "task_run",
            "todo_write", "skills", "buckyball-dev", "waveform-mcp"],
    permission: { mode: "approval", requireApprovalTools: ["bash_run", "fs_write"] },
    runtime: { subagents: { depth: 2, templates: ["review"] } },
    metadata: { buckyballModes: ["apply"] },
  },
  {
    id: "review",
    name: "Review",
    systemPrompt: REVIEW_PROMPT,
    tools: ["fs_read", "fs_glob", "fs_grep", "bash_run", "skills",
            "buckyball-dev", "waveform-mcp"],
    permission: { mode: "auto" },
    metadata: { buckyballModes: ["review"] },
  },
  {
    id: "debug",
    name: "Debug",
    systemPrompt: DEBUG_PROMPT,
    tools: ["fs_read", "fs_write", "fs_edit", "fs_glob", "fs_grep",
            "bash_run", "bash_logs", "bash_kill", "todo_write", "skills",
            "buckyball-dev", "waveform-mcp"],
    permission: { mode: "approval", requireApprovalTools: ["bash_run"] },
    metadata: { buckyballModes: ["debug"] },
  },
]);

// Model factory picks an upstream provider based on config.
// bb-agent is model-agnostic — the same binary works with
// Anthropic / OpenAI / Gemini / local models.
const modelFactory = (config: ModelConfig): ModelProvider => {
  const providerName = config.provider ?? inferFromModelId(config.model);
  switch (providerName) {
    case "anthropic": return new AnthropicProvider(
      config.apiKey ?? process.env.ANTHROPIC_API_KEY!,
      config.model ?? "claude-sonnet-4-5-20250929",
      process.env.ANTHROPIC_BASE_URL,
      process.env.HTTPS_PROXY,
      { thinking: { enabled: true, budgetTokens: 10000 } },
    );
    case "openai": return new OpenAIProvider(
      config.apiKey ?? process.env.OPENAI_API_KEY!,
      config.model ?? "gpt-5",
      process.env.OPENAI_BASE_URL,
      process.env.HTTPS_PROXY,
      { api: "responses", responses: { reasoning: { effort: "medium" } } },
    );
    case "gemini": return new GeminiProvider(
      config.apiKey ?? process.env.GOOGLE_API_KEY!,
      config.model ?? "gemini-3-flash",
      process.env.GOOGLE_BASE_URL,
      process.env.HTTPS_PROXY,
      { thinking: { level: "medium" } },
    );
    default: throw new Error(`bb-agent: unknown provider ${providerName}`);
  }
};

const store = new JSONStore(
  process.env.BB_AGENT_STORE ?? "~/.bb-agent/store",
);

const agent = await Agent.create({
  templateId: process.env.BB_AGENT_TEMPLATE!,   // "plan"|"apply"|"review"|"debug"
  modelConfig: {
    provider: process.env.BB_AGENT_MODEL_PROVIDER!,  // "anthropic"|"openai"|"gemini"
    model: process.env.BB_AGENT_MODEL_ID!,           // free choice per session
    apiKey: process.env.BB_AGENT_API_KEY,
  },
  sandbox: {
    kind: process.env.BB_AGENT_SANDBOX_KIND ?? "local",
    workDir: process.env.BUCKYBALL_ROOT!,
    enforceBoundary: true,
  },
  multimodalContinuation: "history",
  multimodalRetention: { keepRecent: 5 },
  exposeThinking: true,
  retainThinking: true,
}, {
  store,
  templateRegistry: templates,
  toolRegistry: buildToolRegistry(),
  sandboxFactory: buildSandboxFactory(),
  modelFactory,
  skillsManager: process.env.BB_AGENT_SKILLS_DIR
    ? new SkillsManager(process.env.BB_AGENT_SKILLS_DIR)
    : undefined,
});

// Stream Progress events onto stdout as Paseo timeline items.
const bridge = paseoTimelineBridge(process.stdout);
for await (const env of agent.subscribe(["progress"])) {
  bridge.publish(env);
}

// Translate KODE Control events into Paseo provider-native permission asks.
agent.on("permission_required", async (event) => {
  bridge.publishAsk({
    callId: event.call.id,
    tool: event.call.name,
    preview: event.call.inputPreview,
    respond: (decision, opts) => event.respond(decision, opts),
  });
});

// Audit (Monitor) goes to a sidecar JSONL log; Paseo doesn't surface it.
agent.on("tool_executed", (e) => bridge.publishMonitor(e));
```

### Invocation contract with Paseo

`bb-agent` is invoked by Paseo with environment variables the Paseo
daemon already knows how to set on a provider process:

| Env var                       | Meaning                                                       |
| ----------------------------- | ------------------------------------------------------------- |
| `BB_AGENT_AGENT_ID`           | Stable Paseo agent id (passed to `Agent.create({ agentId })`) |
| `BB_AGENT_TEMPLATE`           | The KODE `templateId` Paseo selected via `config.modeId`      |
| `BB_AGENT_MODEL_PROVIDER`     | The upstream provider chosen for this turn                    |
| `BB_AGENT_MODEL_ID`           | The upstream model id chosen for this turn                    |
| `BB_AGENT_API_KEY`            | Optional per-session override of the API key                  |
| `BB_AGENT_SANDBOX_KIND`       | Optional override (`local` / `e2b` / `opensandbox`)           |
| `BB_AGENT_STORE`              | Where KODE persists this agent's checkpoints                  |
| `BB_AGENT_SKILLS_DIR`         | Optional extra KODE skills directory                          |
| `BUCKYBALL_ROOT`              | The buckyball project root the workspace advertised           |
| `BB_AGENT_WORKSPACE_ID`       | The Paseo workspace id                                        |
| `BB_AGENT_SESSION_DIR`        | Per-session scratch directory                                 |

The CLI writes timeline JSON to stdout and reads turns on stdin — a
small line protocol that matches the JSON shape Paseo already accepts
for its built-in providers (one JSON event per line, with
`kind: "text" | "tool_call" | "tool_result" | "permission" | "done"`).

### The template catalog (shipped by default)

| `templateId` | Purpose                                          | Default tools                                                            | Sub-agents            |
| ------------ | ------------------------------------------------ | ------------------------------------------------------------------------ | --------------------- |
| `plan`       | Read-only survey + plan writing                  | `fs_read`, `fs_glob`, `fs_grep`, `todo_write`, `skills`                  | none                  |
| `apply`      | Write code, run verilator/yosys/MLIR, iterate    | file + bash + todo + skills + `buckyball-dev` + `waveform-mcp` + `task_run` | may delegate to `review` |
| `review`     | Critique a diff against buckyball patterns       | `fs_read`, `fs_glob`, `fs_grep`, `bash_run`, `skills`, `buckyball-dev`   | none                  |
| `debug`      | Read waveforms, correlate to source, suggest fix | file + bash (incl. `bash_logs`, `bash_kill`) + todo + skills + `buckyball-dev` + `waveform-mcp` | none                  |

Operators can extend this without changing `bb-agent` itself: a
project can drop a `templates/<id>.yaml` file under
`$BUCKYBALL_ROOT/.bb-agent/` and the bb-agent binary merges it into
its `AgentTemplateRegistry` at startup via `templates.bulkRegister(...)`.
The new template id then appears in `client.providers.listModes("bb-agent")`
without a bb-agent upgrade.

### Why bb-agent does the real work

Two reasons the bb-agent owns tool execution rather than acting as a
pure dispatcher:

1. **Buckyball skills are conversational, not just metadata.** The
   `/ball` and `/waveform` skills include procedural Markdown
   instructions ("run `bbdev_bebop_verilator_run`, then read the
   waveform at `…`, then summarize"). KODE's `SkillsManager` +
   `createSkillsTool` is a natural fit; we register each buckyball
   skill as a KODE skill and Paseo sees it as part of the bb-agent
   provider's `featureValues`.
2. **Stateful, long-running simulations belong on the worker.**
   Verilator runs and FPGA synthesis take minutes. KODE's persistence
   (`JSONStore` for dev, `SqliteStore` for production,
   `PostgresStore` for multi-worker) and 8-stage breakpoint state
   machine let the bb-agent survive a Paseo reconnect, a worker
   restart, and a 30-minute timeout without losing the simulation's
   half-finished state.

## Paseo + bb-agent API surface mapping

The product surface today is the `omnigent_client` Python SDK and the
React UI that talks to it. We keep that surface identical at the
boundary; here is the per-call mapping the bridge implements:

| Today's call (omnigent_client)          | Paseo / KODE primitive                                                              |
| --------------------------------------- | ---------------------------------------------------------------------------------- |
| `client.agents.list()`                  | `client.agents.list({ filter: { labels: { "bb-source": "web-ui" } } })`            |
| `client.agents.create(spec)`            | `workspace.agents.create({ config, … })` with `spec` rewritten to Paseo shape      |
| `session.send(text)`                    | `agent.run(text)`                                                                  |
| `session.send(text, stream=True)`       | `agent.subscribe(['progress'])` re-emitted as SSE                                  |
| `session.send(image=…, file=…)`         | `agent.send([{ type:'image', base64, mime }, …])` via KODE multimodal              |
| `session.fork()`                        | `workspace.agents.create({ parent, … })` — Paseo owns the parent link              |
| `session.resume(id)`                    | `client.agents.ref(id).refresh()` then `agent.run(followUp)`                       |
| `session.list_models()`                 | `client.providers.listModels(provider, { cwd })`                                   |
| `session.list_modes()`                  | `client.providers.listModes(provider, { cwd })`                                    |
| tool call approval (`pending_elicitations`) | KODE `permission_required` → Paseo provider-native `ask`                     |
| `/v1/agents/{name}/spec`                | Paseo `agent.workspaceId` + bb-agent `templateId` + composed `systemPrompt`        |
| Server-side cost tracking               | Paseo `result.lastMessage.usage` + KODE `token_usage` on Monitor                   |
| `/v1/agents/{name}/policies`            | `client.agents.ref(id).decide(callId, 'allow'/'deny')` (delegated to bb-agent)     |

## Migration plan (5 stages, all additive)

Each stage is independently shippable. Each stage replaces a *slice* of
Omnigent with the Paseo / KODE equivalent, and adds a **compatibility
flag** so users with the old path keep working until the cutover.

### Stage 1 — bb-bridge skeleton + Paseo daemon supervisor

- Add `bb-bridge/` (TypeScript, Fastify or Hono) plus a `bin/bb-bridge`
  entrypoint. On `bb-bridge server`:
  1. `spawn('paseo', ['daemon'])` — Paseo as a child process, stdio
     piped to bb-bridge's log, `SIGTERM` on bb-bridge exit,
     auto-restart on crash.
  2. Wait until `ws://127.0.0.1:6767/ws` answers (poll every 100 ms
     up to 10 s), then `createPaseoClient({ url })`.
  3. Mount a single handler for `GET /v1/health` returning `{ ok: true,
     paseo: "ready" }`. No `/v1/agents` proxy yet — that's Stage 2.
- Web UI is still pointed at `omnigent server` in dev. **No
  production rollout**, no Paseo schema learned yet — the only
  runtime exercised is the `paseo daemon` process lifecycle.
- CI: spawn `bb-bridge server`, hit `/v1/health`, kill the process,
  assert Paseo daemon exited cleanly (signal propagation).

### Stage 2 — bb-companion (read-only product surface)

- Add `bb-companion/` (TypeScript, Fastify / Hono, separate
  `bin/bb-companion` entrypoint). It listens on an internal port
  (e.g. `127.0.0.1:6768`) and exposes:
  - `POST /internal/compose` — body in, Paseo-shaped `config` + labels
    out. Reads buckyball root, loads skills / MCP servers, picks the
    right `modeId`, fills the systemPrompt.
  - `POST /internal/attach-skill` — turns a buckyball skill spec
    fragment into a systemPrompt block.
  - `GET /internal/health` — same shape as bb-bridge.
- Port `omnigent/skills/buckyball/{discovery,loader}.py` to
  `bb-companion/buckyball/{discover,load}.ts`. The Python files are
  kept as load-test fixtures but no longer invoked at runtime.
- bb-bridge adds one forward route: `POST /v1/agents` →
  `POST http://127.0.0.1:6768/internal/compose`. All other endpoints
  (`GET /v1/agents`, `GET /v1/sessions/:id`, `WS /v1/sessions/stream`,
  `GET /v1/providers`, etc.) stay pure passthrough to Paseo.
- Internal Canary: single-user Databricks / Fly target with
  bb-bridge + bb-companion + Paseo daemon in the same container.

### Stage 3 — bb-agent (the buckyball worker)

- Add `bb-agent/` (TypeScript CLI, `@shareai-lab/kode-sdk`-based).
  Ships as a single `bb-agent` binary.
- bb-bridge adds a startup hook that calls
  `client.config.patch({ providers: { "bb-agent": bbAgentManifest }})`
  once Paseo reports `ready`. The manifest advertises
  `modes: ["plan", "apply", "review", "debug"]`.
- bb-companion's `composeAgentConfig(...)` adds a branch:
  when the chosen provider is `bb-agent`, it injects `modeId` and
  the KODE-template-shaped options; for `codex` / `claude` /
  `opencode`, it falls back to `systemPrompt` + `mcpServers` only.
- Internal Canary: dogfood bb-agent for buckyball tasks on real
  DangoSys/buckyball repos. Compare tool-call traces against the
  prior Omnigent sessions; confirm output parity for 10–20
  representative prompts.

### Stage 4 — Freeze and switch

- Deploy `bb-bridge` (which starts Paseo daemon and bb-companion
  itself) to every target (`deploy/docker`, `deploy/k8s`,
  `deploy/railway`, `deploy/render`, `deploy/databricks`,
  `deploy/tailscale`). The current `just dev` recipe becomes
  `bb-bridge server` + `bb-companion server` + `bb-agent` binary
  on PATH; `omnigent server` is removed from the recipe.
- All `omnigent/`, `sdks/python-client/`, `sdks/ui/`, `scripts/`
  files are tagged `@deprecated` with a target-removal version.
  `omni` CLI still works via the shim.
- `docs/harness-bench-design.md`, `docs/omni-upgrade-design.md`,
  `docs/cursor-native-*.md`, `docs/qwen-native-*.md`,
  `docs/kiro-native-elicitation.md`, `docs/openclaw.md`,
  `docs/antigravity-native-rpc-*.md`, `docs/QUEUE_STEER_DESIGN.md`,
  `docs/UNINSTALL_DESIGN.md`, `docs/POLICIES.md`,
  `docs/cursor-native-cost-tracking.md`,
  `docs/model-hardcoding-plan.md`, `docs/OMNIGENT_BOT_SETUP.md`,
  `docs/blog-csdn-intro.md` are moved under `docs/_frozen/`.

### Stage 5 — Remove the frozen tree

- One minor version after Stage 4, delete the frozen tree.
- The `omnigent-shim` package becomes a 5-line
  `import omnigent_client as _; _.base_url = …; del _; from
  omnigent_client import *` re-export for one more release, then
  is removed.
- Update README + contributing guide to point at `bb-bridge`,
  `bb-companion`, and `bb-agent` only.

## Decisions (and what we are explicitly not deciding yet)

| Decision                                       | Choice                                                                                                | Rationale (one line)                                                                                              |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Runtime position                               | **Paseo owns the runtime; bb-bridge supervises Paseo; bb-companion owns bb.ai's business logic.**     | Paseo gives us the runtime for free; bb-bridge stays a pure gateway + process supervisor; bb-companion carries the buckyball-aware code so bb-bridge doesn't grow into another Omnigent. |
| bb-agent position                              | **A first-class Paseo provider, peer with `codex` / `claude` / `opencode`. User picks it freely per session via `provider: "bb-agent/<model>"`.** | The product's "switchable agent" promise is met by making bb-agent one row in Paneo's catalog, not an internal dispatch layer. |
| bb-bridge role                                 | **Pure gateway + Paseo daemon supervisor. Zero business logic.**                                      | Keeps the gateway small and replaceable; any logic that touches buckyball lives in bb-companion instead.          |
| bb-companion role                              | **Owns bb.ai-specific agent-config composition: cwd → buckyball root → skills / MCP / modeId → Paseo `config`.** | Concentrates buckyball-aware logic in one service so bb-bridge can stay dumb.                                     |
| Web ↔ bb-bridge wire protocol                  | **Wire-compatible with the existing `omnigent_client` shape (REST + SSE + WS). React UI does not move.** | Touching the React app expands the migration 10×; the bridge's job is to translate on the inside, not to redesign the wire. |
| bb-bridge ↔ bb-companion wire protocol         | **Internal HTTP (`POST /internal/compose`, `POST /internal/attach-skill`, `GET /internal/health`).**   | Stays an in-process / loopback HTTP contract; no SDK lock-in between the two services.                            |
| Paseo daemon lifecycle                         | **Spawned as a child process by `bb-bridge server`. Lifecycle-bound: SIGTERM on bb-bridge exit, auto-restart on crash.** | bb-bridge is the single deployable entrypoint; the daemon is implementation detail, not a separate service.       |
| bb-agent's "modes"                             | **KODE `AgentTemplateRegistry` (plan / apply / review / debug / …); Paseo `config.modeId` selects the template.** | KODE already gives us per-template `systemPrompt` + tool allowlist + permission policy; Paseo already has `modeId`. |
| bb-agent's underlying model                    | **Model-agnostic — Anthropic / OpenAI / Gemini / local. Chosen per session via `BB_AGENT_MODEL_PROVIDER` + `BB_AGENT_MODEL_ID`.** | The provider id `bb-agent/<model>` already separates "which harness" from "which model"; users pick freely.          |
| Existing Python layer                          | **Freeze after cutover, remove one release later.**                                                    | Migration is too big to do in one PR; freeze gives us a safety net.                                              |
| Web UI                                         | **Keep web UI, swap API layer only.**                                                                 | React app is the product surface; touching it expands the migration 10×.                                          |
| Skill delivery                                 | **Append `SkillSpec.content` to `config.systemPrompt` (works for any provider); KODE skills for bb-agent only.** | Skills are conversational hints, not callable tools in the product today. They travel with every provider via `systemPrompt` and the bb-agent additionally registers them as KODE skills. |
| MCP delivery                                   | **Forward to `config.mcpServers` (and `config.toolPolicy` for preapproval).**                         | That is Paneo's first-class MCP surface; no need to re-route.                                                    |
| Sandbox                                        | **Provider-native (Codex `sandbox_mode`, Claude `sandbox`, OpenCode `permission`); `bb-agent` uses KODE `SandboxFactory` (`local` / `e2b` / `opensandbox`).** | Paseo validates provider-native options; KODE has its own sandbox layer for bb-agent's tools.                       |
| Persistence                                    | **`bb-agent` uses `JSONStore` (dev) / `SqliteStore` (single node) / `PostgresStore` (multi). Paseo daemon persists the agent list / timeline / workspaces itself.** | KODE store tiering maps to bb.ai's deploy targets 1:1; Paseo covers session metadata.                              |
| Provider customisation                         | **Custom Paseo provider manifest; one provider id `bb-agent`.**                                        | No need for a per-template provider; bb-agent chooses its KODE template via `BB_AGENT_TEMPLATE` env var.            |
| Identities / accounts                          | **Out of scope.** `bb-bridge` is single-tenant; multi-user identity stays with the host (K8s/Fly/Render). | Paseo does not ship accounts. Re-introducing Omnigent's accounts_store was the wrong default.                     |
| Smart routing / scheduling                     | **Out of scope.** Drop entirely.                                                                       | Not part of bb.ai's product. Paseo covers basic `agents.list({ filter, sort })` for free.                          |
| Capability matrix / harness bench              | **Drop.** Replaced by Paseo's own conformance plus the bb-agent contract.                             | There is no longer a pluggable harness registry to bench.                                                         |

## Risks and how we are mitigating them

| Risk                                                                                                | Mitigation                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Paseo daemon dies and we lose all running sessions.                                                 | Paseo persists agent timelines itself; `client.agents.ref(id).refresh()` reconnects across daemon restarts. `bb-bridge` runs the daemon as a supervised sibling process with `auto-restart`. A Paseo upgrade only requires a daemon restart; agents reattach by ID.  |
| kode-agent-sdk is not 1:1 with Paseo timeline events.                                               | The bb-agent CLI publishes a small line protocol on stdout; the bridge parses it into Paseo timeline items. If a new KODE event type shows up, the bridge adds an adapter — no bb.ai code touches it.                                                                  |
| A buckyball MCP tool needs approval mid-turn and the user is on the web, not in Paseo app.         | `bb-bridge` exposes an in-product approval UI that calls `client.agents.ref(id).decide(callId, 'allow')` on behalf of the user. The bb-agent's Control `permission_required` event reaches the bridge within ~1 s.                                                |
| Provider-native sandbox differs per provider and confuses users.                                    | We document the chosen sandbox at workspace-creation time (`workspace.agents.create({ config: { options: buckyballSandboxOptions(workspace) } })`) and surface the effective policy in the UI's "agent details" panel. No user-facing UX change beyond a tooltip.   |
| Paseo uses TypeScript types and we are porting Python logic (`attach_buckyball_to_spec`).          | The `attach_buckyball_to_spec` algorithm is small (~150 LOC) and has unit tests. Porting to TS is a single PR with 100 % test parity. YAML / JSON parsing is direct (`yaml`, `JSON.parse`). UTF-8 Windows code-page concern is irrelevant in Node.js.                |
| `omnigent-shim` semantics drift over time.                                                          | The shim is a single package with the public `omnigent_client` API surface; we lock it to the *last* Omnigent minor and bump a major version when bb-bridge diverges. We delete the shim in Stage 5.                                                                  |
| A community buckyball user adds a new MCP tool that requires bb.ai-specific routing.                | Paseo already routes any `config.mcpServers` entry; we forward `BUCKYBALL_ROOT` to the stdio env. No bb.ai change required to onboard a new tool — the same is true today in `loader.py`.                                                                           |
| The bb-agent becomes the single point of failure for the product.                                   | The bb-agent is a per-provider CLI; it does not store its own agent state outside the Paseo workspace. Re-running `bb-agent` after a crash resumes from the KODE breakpoint (`Agent.resume(agentId, deps)`), which `paseo` reattaches transparently.                 |

## What "done" looks like

A user running `just dev` in `buckyball.ai/` today sees three things
change:

   - The dev server starts `paseo daemon` and `bb-bridge` instead of
     `omnigent server` (the `just dev` recipe changes).
   - The React UI's "dev tools" panel shows "Runtime: Paseo" instead of
     "Runtime: Omni".
   - The agent that answers "Run a vecunit matmul simulation on the toy
     chip" is a bb-agent (KODE) running inside a Paseo workspace whose
     `BUCKYBALL_ROOT` is the user's `~/bb-work/buckyball` checkout. The
     trace in the dev tools panel shows KODE Progress events bridged
     into Paseo timeline items, bridged back into `omnigent_client`
     SSE events, bridged back into the React UI's block stream.

Everything else — every prompt, every skill, every tool call, every
deploy target, every env var (`BUCKYBALL_ROOT` is still the contract) —
is identical.

## Open items

These are intentionally not answered in this design; they want their
own ADR once we start Stage 3:

- **Provider binary distribution.** npm-packaged `bb-agent` vs. a single
  Go-Rust binary vs. a `pnpm` pack that Paseo wraps. Paseo's custom
  provider spec allows both; we pick once we see Stage 2 latency.
- **Sandbox policy UX.** Should the buckyball project get a "Buckyball
  Safety" preset (write to `BUCKYBALL_ROOT` only, deny `~/.ssh` /
  `~/.aws`, allow `registry.npmjs.org` + `github.com` + the DangoSys
  buckyball git remote), or do we expose the raw provider options? The
  current docs do not commit to either; we will after Stage 3 dogfood.
- **Multi-user / accounts.** Single-tenant remains the default; if a
  multi-user host (Databricks Apps, Render) wants to add per-user
  Paseo workspaces, we add a `bb-bridge/accounts.ts` thin layer that
  scopes a `client.agents.list({ filter: { labels: { "bb-user":
  userId } } })` per request. Defer until asked for.
- **Telemetry / cost.** Paseo's `result.usage` plus KODE's
  `token_usage` Monitor event give us what we need; the existing
  `omnigent/server/performance_metrics.py` is replaced by a
  `bb-bridge/metrics.ts` sink that ships to the same Datadog / OTLP
  endpoint. Wire-shape is forward-compatible.
- **Skill-as-tool (the KODE `createSkillsTool` path).** Today skills
  are loaded as system-prompt fragments. If we want `/ball` to be a
  first-class invokable tool (so the web UI can show a "Skills used:
  ball, verify" badge), we move them into the bb-agent as KODE skills
  and surface `toolPolicy` to Paseo. Defer to Stage 3.