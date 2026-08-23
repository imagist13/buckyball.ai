"use client";

/**
 * Settings â?Runtime
 *
 * The single home for runtime explanation. Folds in everything that used
 * to live under the "Claude CLI" sidebar entry plus a parallel CodePilot
 * Runtime card. Sits at the third tier of the user mental model:
 *
 *   Providers (assets) â?Models (exposure) â?Runtime (environment)
 *
 * Phase 2B layout, top to bottom:
 *   1. Default-engine selector â?which runtime owns the next chat
 *   2. Claude Code å¼æ card â?status / reason / impact / recovery,
 *      plus model options (thinking / 1M) and the settings.json editor
 *      (expandable advanced section)
 *   3. bb-agent Runtime card â?capabilities / permissions / context
 *      (medium granularity, three buckets)
 *   4. Session-level read-only explainer â?what a new chat will use
 *   5. Utility: import past chat sessions
 *
 * 2B.6 (`session_events.runtime.selected` minimal write) is deferred to a
 * separate commit â?the read-only session-level explainer below derives
 * the same answer client-side from `/api/providers/models?runtime=auto`
 * + `runtime_applied` + the global default pair, so 2B can ship without
 * the persisted event log. Phase 3 Run Cockpit picks it up.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  ArrowClockwise,
  ArrowsClockwise,
  CaretDown,
  CheckCircle,
  Circle,
  Code,
  SlidersHorizontal,
  SpinnerGap,
  Warning,
  XCircle,
} from "@/components/ui/icon";
import { SaveButton } from "@/components/ui/save-button";
import { BuckyballIcon } from "@/components/ui/semantic-icon";
import { useClaudeStatus } from "@/hooks/useClaudeStatus";
import { useTranslation } from "@/hooks/useTranslation";
import {
  resolveLegacyRuntimeForDisplay,
  isConcreteRuntime,
} from "@/lib/runtime/legacy";
import {
  computeEffectiveRuntime,
  resolveNewChatDefault,
  runtimeDisplayLabel,
  type AgentRuntime,
} from "@/lib/runtime/effective";
import type { TranslationKey } from "@/i18n";
import type { ProviderOptions } from "@/types";
import type { CodexAvailability } from "@/lib/codex/types";
import type { RuntimeProbeSnapshot } from "@/lib/runtime-probe";
import { cn } from "@/lib/utils";
import Anthropic from "@lobehub/icons/es/Anthropic";
import OpenAI from "@lobehub/icons/es/OpenAI";
import { MonolithIcon } from "@/components/brand/MonolithIcon";
import {
  RuntimeCapabilityList,
  codexAccountHeaderNote,
} from "@/components/settings/RuntimeCapabilityList";
import type { CapabilityMatrixCell } from "@/lib/harness/capability-matrix";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// `AgentRuntime` is imported from `@/lib/runtime/effective` so RuntimePanel
// shares the canonical three-engine union ('claude-code-sdk' | 'native'
// | 'codex_runtime'). The local alias used to be a 2-value duplicate;
// Phase 6 IA correction (2026-05-14) consolidated to a single source.

/**
 * Five-state runtime status. Each state pairs with reason / impact /
 * recovery so the panel can answer "why is it this way / what does it
 * mean / what do I do about it" without the user reading source.
 */
type RuntimeState =
  | "selected" // currently the default (active for new chats)
  | "available" // ready, not currently default
  | "degraded" // works but with caveats (version mismatch, warnings, etc.)
  | "blocked" // cannot run (CLI missing / login expired)
  | "disabled"; // user explicitly turned off (cli_enabled=false)

interface RuntimeStatusInfo {
  state: RuntimeState;
  reason: string;
  impact: string;
  recovery?: string; // omitted when no recovery is needed
}

function codexCliInstallRecovery(isZh: boolean, isWindowsElectron: boolean): string {
  if (isWindowsElectron) {
    return isZh
      ? "å?PowerShell è¿è¡ `irm https://chatgpt.com/codex/install.ps1 | iex` å®è£ç¬ç« CLIï¼æè®¾ç½® CODEX_BIN åå·æ?
      : "Run `irm https://chatgpt.com/codex/install.ps1 | iex` in PowerShell, or set CODEX_BIN, then refresh";
  }
  return isZh
    ? "æ?Codex å®æ¹ææ¡£å®è£éç¨äºå½åå¹³å°ç CLIï¼æè®¾ç½® CODEX_BIN æåèªå®ä¹è·¯å¾åå·æ°"
    : "Install the Codex CLI using the official instructions for this platform, or set CODEX_BIN to a custom binary, then refresh";
}

// ---------------------------------------------------------------------------
// Status pill (mirrors design.md "Status pill â?provider runtime state")
// ---------------------------------------------------------------------------

function RuntimeStatusPill({
  state,
  isZh,
}: {
  state: RuntimeState;
  isZh: boolean;
}) {
  const tone: Record<RuntimeState, string> = {
    selected: "bg-status-success-muted text-status-success-foreground",
    available: "bg-muted text-muted-foreground",
    degraded: "bg-status-warning-muted text-status-warning-foreground",
    blocked: "bg-status-error-muted text-status-error-foreground",
    disabled: "bg-muted text-muted-foreground",
  };
  const dot: Record<RuntimeState, string> = {
    selected: "bg-status-success-foreground",
    available: "bg-muted-foreground",
    degraded: "bg-status-warning-foreground",
    blocked: "bg-status-error-foreground",
    disabled: "bg-muted-foreground",
  };
  const label: Record<RuntimeState, [string, string]> = {
    selected: ["å½åé»è®¤", "Current default"],
    available: ["å¯ç¨", "Available"],
    degraded: ["å¯ç¨ä½ææç¤º", "Available with warnings"],
    blocked: ["ä¸å¯ç?, "Blocked"],
    disabled: ["å·²å³é?, "Disabled"],
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
        tone[state],
      )}
    >
      <span className={cn("size-1.5 rounded-full", dot[state])} />
      {isZh ? label[state][0] : label[state][1]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Reason / impact / recovery block â?three labelled rows, render only what
// has content. Reason is mandatory; impact/recovery are conditional.
// ---------------------------------------------------------------------------

function RuntimeStatusExplanation({ info, isZh }: { info: RuntimeStatusInfo; isZh: boolean }) {
  const rows: { label: string; value: string }[] = [
    { label: isZh ? "åå " : "Reason", value: info.reason },
    { label: isZh ? "å½±å" : "Impact", value: info.impact },
  ];
  if (info.recovery) {
    rows.push({ label: isZh ? "æä¹æ¢å¤" : "Recovery", value: info.recovery });
  }
  return (
    <div className="rounded-md bg-muted/40 px-3.5 divide-y divide-border/50">
      {rows.map((r) => (
        <div key={r.label} className="py-2.5 flex items-start justify-between gap-3">
          <span className="text-[11px] text-muted-foreground shrink-0">{r.label}</span>
          <span className="text-xs text-foreground/85 text-right">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Outer card shell â?same border weight + radius as Provider Card so the
// page reads as one family.
// ---------------------------------------------------------------------------

function RuntimeCard({
  name,
  state,
  isZh,
  children,
}: {
  name: string;
  state: RuntimeState;
  isZh: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg bg-card border border-border/50 p-5 flex flex-col gap-4">
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="text-sm font-semibold leading-tight">{name}</h3>
        <RuntimeStatusPill state={state} isZh={isZh} />
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Engine picker card â?large, click-anywhere card used at the page top to
// pick the default runtime. Two cards render side by side; the selected
// one carries a primary-tinted border + ring + bg-tint and a filled check
// indicator in the top-right corner. Unselected stays muted with a hollow
// circle indicator that fills on hover so the affordance is obvious.
// ---------------------------------------------------------------------------

function EnginePickerCard({
  engine: _engine, // kept for future telemetry; not read in render today
  selected,
  onSelect,
  title,
  tagline,
  pitch,
  statusKind,
  statusText,
  isZh,
  icon,
  trigger,
}: {
  engine: AgentRuntime;
  selected: boolean;
  onSelect: () => void;
  title: string;
  tagline: string;
  pitch: string;
  /** `ok` â?success-tone status row; `warning` â?warning-tone (e.g. CLI not installed). */
  statusKind: "ok" | "warning";
  statusText: string;
  isZh: boolean;
  icon: React.ReactNode;
  /** Phase 5e review round 7 (2026-05-18 user feedback) â?the
   *  "view capabilities" trigger lives INSIDE the engine card. We
   *  accept it as a prop so the parent can stop event propagation
   *  before the card's click handler fires (otherwise opening the
   *  capability dialog would also switch the default runtime). */
  trigger?: React.ReactNode;
}) {
  void _engine;

  // Phase 5e review round 7 (2026-05-18) â?switched from a single
  // <button> to a div + role=button so the card can host the
  // capability-list trigger (a real <button>) inside without a
  // button-in-button A11y violation. Keyboard handling (Enter /
  // Space) is re-implemented; aria-pressed + focus-visible ring
  // stay the same. The card also collapses from 3 visual rows
  // (title block / pitch / status row) to 2 (title row + body row),
  // matching the design.md "One row vs two rows" Provider card
  // shape â?Row 1 is identity, Row 2 packs description + the
  // operational status + the trigger.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return; // ignore keys on nested controls
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect();
    }
  };

  // Phase 5e round 8 CDP smoke (2026-05-18) â?`stopPropagation` on
  // the trigger button alone was not enough: Radix `DialogTrigger
  // asChild` composes its own click handler onto the same button,
  // and React's synthetic stopPropagation interacted in a way that
  // still let the card's onClick fire (verified via smoke: clicking
  // the trigger switched the default runtime in addition to opening
  // the dialog). Robust guard: in the card's own onClick, check
  // whether the click originated from an interactive descendant. If
  // it did, do NOT treat it as a card-level select. This makes the
  // card behavior independent of how Radix composes events on the
  // nested trigger button.
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest('button, a, [role="button"]') !== e.currentTarget) {
      // Click landed on an interactive descendant (the capability
      // trigger, or any future nested control). Skip the card-level
      // select; let the descendant handle its own action.
      return;
    }
    onSelect();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      aria-pressed={selected}
      aria-label={`${title} â?${tagline}`}
      className={cn(
        "relative w-full text-left rounded-lg border p-5 flex flex-col gap-2 transition-colors cursor-pointer",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected
          ? "border-primary/40 bg-primary/5 ring-1 ring-primary/30"
          : "border-border/50 bg-card hover:bg-muted/40",
      )}
    >
      {/* Top-right indicator. Filled CheckCircle when selected; hollow Circle
          otherwise with a faint hover boost so the click affordance reads. */}
      <span className="absolute top-4 right-4 text-muted-foreground pointer-events-none">
        {selected ? (
          <CheckCircle size={18} weight="fill" className="text-primary" />
        ) : (
          <Circle size={18} className="text-muted-foreground/60" />
        )}
      </span>

      {/* Row 1 â?identity: icon + title + tagline. Selected indicator
          floats top-right above this row. */}
      <div className="pr-8 flex items-start gap-2.5">
        <span className="shrink-0 mt-0.5">{icon}</span>
        <div className="min-w-0">
          <h4 className={cn("text-sm font-semibold", selected ? "text-primary" : "text-foreground")}>
            {title}
          </h4>
          <p className="text-sm text-muted-foreground mt-1.5">{tagline}</p>
        </div>
      </div>

      {/* Row 2 â?body: short pitch (truncates with line-clamp-2 if
          long), with a status pill + capability-list trigger packed
          to the right. The status row used to be a third visual
          block; round 7 merges it inline with the trigger. */}
      <div className="mt-1 flex items-end justify-between gap-3">
        <p className="text-xs text-foreground/85 leading-relaxed line-clamp-2 flex-1">
          {pitch}
        </p>
      </div>

      <div className="flex items-center justify-between gap-2 mt-auto flex-wrap">
        <div className="flex items-center gap-1.5 text-[11px] min-w-0">
          {statusKind === "ok" ? (
            <CheckCircle
              size={12}
              weight="fill"
              className="text-status-success-foreground shrink-0"
            />
          ) : (
            <Warning
              size={12}
              weight="fill"
              className="text-status-warning-foreground shrink-0"
            />
          )}
          <span
            className={cn(
              "truncate",
              statusKind === "ok"
                ? "text-status-success-foreground"
                : "text-status-warning-foreground",
            )}
          >
            {statusText}
          </span>
        </div>
        {trigger && <div className="shrink-0">{trigger}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface SettingsData {
  [key: string]: unknown;
}

const KNOWN_FIELDS = [
  { key: "permissions", label: "Permissions", type: "object" as const },
  { key: "env", label: "Environment Variables", type: "object" as const },
] as const;

export interface RuntimePanelProps {
  /** Phase 5e Phase 3 (2026-05-18) â?server-derived capability matrix
   *  per Runtime. Server passes these in to avoid pulling the
   *  capability-contract â?MCP factory chain (which has Node-only
   *  `child_process` deps) into the browser bundle. The codex_runtime
   *  cells reflect the current provider (e.g. demoted for
   *  codex_account); other Runtimes are provider-agnostic. */
  readonly capabilityCells?: {
    readonly claude_code: readonly CapabilityMatrixCell[];
    readonly bbagent: readonly CapabilityMatrixCell[];
    readonly codex_runtime: readonly CapabilityMatrixCell[];
  };
}

export function RuntimePanel(props: RuntimePanelProps = {}) {
  const { capabilityCells } = props;
  const { t } = useTranslation();
  const isZh = t("nav.chats") === "å¯¹è¯";
  // Settings is route-level split â?jumping to Models must router.push the
  // route path, not just write to window.location.hash (which would only
  // mutate the URL fragment without switching pages on /settings/runtime).
  const router = useRouter();

  // ââ Runtime selection (DB setting) ââ
  // `agentRuntime` is the *stored* preference from the DB. The effective
  // runtime that the chat path actually uses is computed below as
  // `effectiveRuntime` â?`cli_enabled=false` is the highest-priority
  // override in `lib/runtime/registry.ts:resolveRuntime`, so even if
  // `agent_runtime='claude-code-sdk'` is stored, AI SDK is what runs
  // when CLI is disabled. The picker writes both fields together (via
  // `handleRuntimeChange`), so new state stays consistent; this guard
  // only fires for legacy DBs where the two fields drifted apart.
  const [agentRuntime, setAgentRuntime] = useState<AgentRuntime>("claude-code-sdk");
  const [cliEnabled, setCliEnabled] = useState(true);

  // ââ Claude Code status (subprocess detection) ââ
  const { status: claudeStatus, refresh: refreshStatus, invalidateAndRefresh } = useClaudeStatus();
  const [upgrading, setUpgrading] = useState(false);

  // ââ Codex Runtime status (app-server detection) ââ
  // Phase 5 Phase 6 IA correction (2026-05-14) â?Codex Runtime joins
  // Claude Code + bb-agent Runtime as a peer engine. Polling
  // /api/codex/status is non-destructive (doesn't spawn the binary)
  // so the panel can keep state in sync with the user's environment.
  const [codexAvailability, setCodexAvailability] = useState<CodexAvailability>({ kind: "unknown" });
  const [codexProbe, setCodexProbe] = useState<RuntimeProbeSnapshot | null>(null);
  const [codexStatusLoading, setCodexStatusLoading] = useState(false);
  const [codexRecoveryState, setCodexRecoveryState] = useState<
    "idle" | "preparing" | "ready" | "copied_only" | "error"
  >("idle");
  const [codexRecoveryMethod, setCodexRecoveryMethod] = useState<"npm" | "standalone_script" | null>(null);
  const [isWindowsElectron, setIsWindowsElectron] = useState(false);
  useEffect(() => {
    setIsWindowsElectron(window.electronAPI?.versions.platform === "win32");
  }, []);
  useEffect(() => {
    let cancelled = false;
    setCodexStatusLoading(true);
    (async () => {
      try {
        const res = await fetch("/api/codex/status", { cache: "no-store" });
        const json = await res.json();
        if (!cancelled && json?.availability) {
          setCodexAvailability(json.availability as CodexAvailability);
          setCodexProbe((json.probe as RuntimeProbeSnapshot | undefined) ?? null);
        }
      } catch (err) {
        if (!cancelled) {
          const reason = err instanceof Error ? err.message : String(err);
          setCodexAvailability({ kind: "spawn_failed", reason });
        }
      } finally {
        if (!cancelled) setCodexStatusLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const refreshCodexStatus = useCallback(async () => {
    setCodexStatusLoading(true);
    try {
      // POST explicitly invalidates idle resolution/version/failure caches.
      // The server keeps a healthy running app-server pinned, so this is safe
      // to use while chats are active.
      const res = await fetch("/api/codex/status", {
        method: "POST",
        cache: "no-store",
      });
      const json = await res.json();
      if (json?.availability) {
        setCodexAvailability(json.availability as CodexAvailability);
        setCodexProbe((json.probe as RuntimeProbeSnapshot | undefined) ?? null);
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      setCodexAvailability({ kind: "spawn_failed", reason });
    } finally {
      setCodexStatusLoading(false);
    }
  }, []);
  const prepareCodexWindowsRecovery = useCallback(async () => {
    const action = window.electronAPI?.codex?.prepareWindowsRecovery;
    if (!action) {
      setCodexRecoveryState("error");
      return;
    }
    setCodexRecoveryState("preparing");
    try {
      const result = await action();
      setCodexRecoveryMethod(result.installMethod ?? null);
      if (result.copied && result.opened) setCodexRecoveryState("ready");
      else if (result.copied) setCodexRecoveryState("copied_only");
      else setCodexRecoveryState("error");
    } catch {
      setCodexRecoveryState("error");
    }
  }, []);
  const codexConnected = codexAvailability.kind === "ready";
  const codexBinary = "binary" in codexAvailability
    ? codexAvailability.binary ?? null
    : null;

  // ââ Model options (env provider) â?applies when Claude Code å¼æ selected ââ
  const [thinkingMode, setThinkingMode] = useState("adaptive");
  const [context1m, setContext1m] = useState(false);

  // ââ Session-level fields (for the read-only explainer) ââ
  // Sourced from /api/providers/models?runtime=auto + the __global__
  // options (default_model + default_model_provider). This MUST mirror
  // chat/page.tsx's resolution chain â?otherwise we tell the user "new
  // chats use X" and the chat init silently picks Y. See P1 fix below.
  const [defaultProviderName, setDefaultProviderName] = useState<string | null>(null);
  const [defaultModelLabel, setDefaultModelLabel] = useState<string | null>(null);
  /** What the server actually resolved when filtering by runtime=auto.
   *  Echoes `runtime_applied` from the API; null when fetch failed. */
  const [resolvedRuntimeFromApi, setResolvedRuntimeFromApi] = useState<string | null>(null);
  /** True when /api/providers/models?runtime=auto returned an empty
   *  groups list â?i.e. no provider/model is currently runtime-compatible. */
  const [noCompatibleProvider, setNoCompatibleProvider] = useState(false);
  /** Phase 2C: Pinned default not reachable under effective Runtime.
   *  Drives the recovery banner with 4 CTAs (switch Runtime / enable
   *  model / pick another default / revert to Auto). Raw provider/model
   *  ids from resolver so the banner can a) name what's broken and
   *  b) deep-link the "enable this model" action to the right row. */
  const [invalidDefault, setInvalidDefault] = useState<
    | {
        providerId: string;
        providerName: string | null;
        modelValue: string;
        modelLabel: string | null;
        reason: 'provider-missing' | 'model-missing' | 'pin-incomplete';
      }
    | null
  >(null);
  const [revertingToAuto, setRevertingToAuto] = useState(false);

  // ââ Claude settings.json editor state ââ
  const [settings, setSettings] = useState<SettingsData>({});
  const [originalSettings, setOriginalSettings] = useState<SettingsData>({});
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingSaveAction, setPendingSaveAction] = useState<"form" | "json" | null>(null);

  // ââ Dialogs ââ
  const [installWizardOpen, setInstallWizardOpen] = useState(false);

  // ââ Loading ââ
  const [loading, setLoading] = useState(true);

  // i18n key lookup tables for the settings.json form fields
  const knownFieldKeys: Record<string, { label: TranslationKey; description: TranslationKey }> = {
    permissions: { label: "cli.permissions", description: "cli.permissionsDesc" },
    env: { label: "cli.envVars", description: "cli.envVarsDesc" },
  };
  const dynamicFieldLabels: Record<string, TranslationKey> = {
    skipDangerousModePermissionPrompt: "cli.field.skipDangerousModePermissionPrompt",
    verbose: "cli.field.verbose",
    theme: "cli.field.theme",
  };

  // ââ Fetch all data ââ
  const fetchAll = useCallback(async () => {
    try {
      // `?runtime=auto` makes the server filter groups/models the chat
      // path can't reach. Without this filter, the explainer below could
      // confidently report "new chats will use Claude Code / Sonnet 4.6"
      // while chat init actually rejects that combination because the
      // active runtime requires a different provider compat â?the two
      // surfaces would disagree and the user would lose trust.
      //
      // The __global__ options carry the user's chosen default model +
      // provider. We reuse the same resolution chain as `chat/page.tsx`
      // (validate global pair â?fall back to provider-only â?fall back
      // to first compatible group) so this page is the single source of
      // truth for "what does a new chat actually look like."
      const [cliRes, appRes, optRes, modelsRes, globalOptRes] = await Promise.all([
        fetch("/api/settings"),
        fetch("/api/settings/app"),
        fetch("/api/providers/options?providerId=env"),
        fetch("/api/providers/models?runtime=auto"),
        fetch("/api/providers/options?providerId=__global__"),
      ]);

      if (cliRes.ok) {
        const data = await cliRes.json();
        const s = data.settings || {};
        setSettings(s);
        setOriginalSettings(s);
        setJsonText(JSON.stringify(s, null, 2));
      }

      if (appRes.ok) {
        const appData = await appRes.json();
        const appSettings = appData.settings || {};
        setCliEnabled(appSettings.cli_enabled !== "false");
        // agent_runtime: 'claude-code-sdk' | 'native'. Migrate legacy 'auto'
        // values in-place â?same flow as the legacy CliSettingsSection used.
        const saved = appSettings.agent_runtime;
        if (!isConcreteRuntime(saved)) {
          let cliConnected: boolean | null = null;
          try {
            const statusRes = await fetch("/api/claude-status");
            if (statusRes.ok) {
              const s = await statusRes.json();
              cliConnected = !!s?.connected;
            }
          } catch {
            /* ignore â?cliConnected stays null */
          }
          if (cliConnected !== null) {
            const migrated = resolveLegacyRuntimeForDisplay(saved, cliConnected);
            setAgentRuntime(migrated as AgentRuntime);
            fetch("/api/settings/app", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ settings: { agent_runtime: migrated } }),
            }).catch(() => undefined);
          } else {
            setAgentRuntime("claude-code-sdk");
          }
        } else {
          setAgentRuntime(saved as AgentRuntime);
        }
      }

      if (optRes.ok) {
        const optData = await optRes.json();
        const opts: ProviderOptions = optData.options || {};
        setThinkingMode(opts.thinking_mode || "adaptive");
        setContext1m(opts.context_1m || false);
      }

      if (modelsRes.ok) {
        const data = await modelsRes.json() as {
          groups?: Array<{
            provider_id: string;
            provider_name: string;
            models: Array<{ value: string; label: string }>;
          }>;
          default_provider_id?: string;
          runtime_applied?: string;
        };
        setResolvedRuntimeFromApi(data.runtime_applied ?? null);
        const groups = data.groups ?? [];

        // Pull global default mode + pin from the second options request.
        // Phase 2C: 'pinned' demands exact-match resolution, 'auto' walks
        // the chain. The Settings panel must read mode honestly â?Pinned
        // failures here surface as "default invalid" rather than "look,
        // here's a fallback that isn't what you asked for".
        let defaultMode: "auto" | "pinned" = "auto";
        let pinnedProviderId = "";
        let pinnedModel = "";
        if (globalOptRes.ok) {
          const globalData = (await globalOptRes.json()) as {
            options?: {
              default_mode?: "auto" | "pinned";
              default_model?: string;
              default_model_provider?: string;
            };
          };
          defaultMode = globalData.options?.default_mode === "pinned" ? "pinned" : "auto";
          pinnedProviderId = globalData.options?.default_model_provider ?? "";
          pinnedModel = globalData.options?.default_model ?? "";
        }

        let savedProviderId = "";
        let savedModel = "";
        if (typeof window !== "undefined") {
          savedProviderId = localStorage.getItem("codepilot:last-provider-id") ?? "";
          savedModel = localStorage.getItem("codepilot:last-model") ?? "";
        }

        const resolved = resolveNewChatDefault({
          groups,
          apiDefaultProviderId: data.default_provider_id,
          mode: defaultMode,
          pinnedProviderId,
          pinnedModel,
          savedProviderId,
          savedModel,
        });

        if (resolved.status === "no-compatible") {
          setNoCompatibleProvider(true);
          setDefaultProviderName(null);
          setDefaultModelLabel(null);
          setInvalidDefault(null);
        } else if (resolved.status === "invalid-default") {
          // Pinned + unreachable. Drive the recovery banner with raw
          // ids so "enable this model" can deep-link, and friendly
          // labels (when present) so the banner copy still reads well.
          setNoCompatibleProvider(false);
          setDefaultProviderName(resolved.providerName ?? resolved.providerId ?? null);
          setDefaultModelLabel(resolved.modelLabel ?? resolved.modelValue ?? null);
          setInvalidDefault({
            providerId: resolved.providerId ?? "",
            providerName: resolved.providerName ?? null,
            modelValue: resolved.modelValue ?? "",
            modelLabel: resolved.modelLabel ?? null,
            reason: resolved.reason ?? "pin-incomplete",
          });
        } else {
          setNoCompatibleProvider(false);
          setDefaultProviderName(resolved.providerName ?? null);
          setDefaultModelLabel(resolved.modelLabel ?? null);
          setInvalidDefault(null);
        }
      } else {
        // API itself unreachable â?clear the explainer rather than show stale data.
        setResolvedRuntimeFromApi(null);
        setNoCompatibleProvider(false);
        setDefaultProviderName(null);
        setDefaultModelLabel(null);
      }
    } catch {
      setSettings({});
      setOriginalSettings({});
      setJsonText("{}");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Refetch when any provider-changing action elsewhere (Models page
  // toggle, refresh, role-mapping save, runtime switch on this page,
  // etc.) dispatches `provider-changed`. Without this listener the
  // explainer data goes stale: e.g. switching engine from Claude Code
  // to AI SDK clears the picker but `resolvedRuntimeFromApi` and
  // `defaultProviderName` hang on the previous probe's result.
  useEffect(() => {
    const handler = () => { fetchAll(); };
    window.addEventListener("provider-changed", handler);
    return () => window.removeEventListener("provider-changed", handler);
  }, [fetchAll]);

  // ââ Engine selector handler ââ
  const handleRuntimeChange = async (value: AgentRuntime) => {
    setAgentRuntime(value);
    // Phase 5 Phase 6 IA correction (2026-05-14) â?only Claude Code
    // needs the CLI subprocess. bb-agent Runtime AND Codex Runtime
    // both run independently of the Claude CLI; cli_enabled=false in
    // both cases so the registry doesn't spawn it unnecessarily.
    const cliEnabledValue = value === "claude-code-sdk" ? "true" : "false";
    setCliEnabled(cliEnabledValue === "true");

    // Clear stale explainer state immediately so the user doesn't see
    // the previous resolution while the new fetch is in flight. The
    // engine-picker cards already re-paint from local state above; the
    // explainer block needs a server round-trip because runtime=auto
    // filtering happens server-side.
    setResolvedRuntimeFromApi(null);
    setDefaultProviderName(null);
    setDefaultModelLabel(null);
    setNoCompatibleProvider(false);

    try {
      await fetch("/api/settings/app", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: { agent_runtime: value, cli_enabled: cliEnabledValue },
        }),
      });
      // The `provider-changed` event triggers the listener above, which
      // calls `fetchAll` and refreshes the explainer. We don't need to
      // call fetchAll inline â?the listener path is the canonical refetch
      // trigger for any runtime / provider / model change.
      window.dispatchEvent(new Event("provider-changed"));
    } catch {
      /* ignore â?next user action will refetch */
    }
  };

  // ââ Phase 2C.3: invalid-default recovery handlers ââ
  /**
   * Switch to the alternate Runtime so the broken pin (provider+model)
   * has a chance of becoming valid. We don't try to deduce *which*
   * Runtime the pinned model would actually work in (that requires
   * provider compat lookups + model-level checks); we just toggle
   * away from the current effective Runtime. The user can see the
   * banner re-render after the switch â?if pin became valid, the
   * banner disappears; otherwise it stays and the user picks a
   * different recovery path.
   */
  const handleSwitchToAlternateRuntime = useCallback(async () => {
    // Recompute effective runtime locally so the handler doesn't capture
    // a forward-referenced variable (TS temporal dead zone). Cheap call.
    const isConnected = claudeStatus?.connected ?? false;
    const current = computeEffectiveRuntime(agentRuntime, cliEnabled, isConnected);
    const target: AgentRuntime = current === "claude-code-sdk" ? "native" : "claude-code-sdk";
    await handleRuntimeChange(target);
  }, [agentRuntime, cliEnabled, claudeStatus]);

  /** Deep-link to Models page focused on the broken pin â?provider AND
   *  model. Without the model id, Models would only scroll to the
   *  provider section; if the broken pin is `enabled=0`, the default
   *  Enabled filter would hide the row entirely and the user would
   *  have to find it themselves. With both signals + a `filter=all`
   *  hint, Models can flip its filter, scroll to the exact row, and
   *  briefly highlight it. */
  const handleEnableInModels = useCallback(() => {
    if (!invalidDefault?.providerId || typeof window === "undefined") return;
    sessionStorage.setItem("codepilot:models-focus-provider", invalidDefault.providerId);
    if (invalidDefault.modelValue) {
      sessionStorage.setItem("codepilot:models-focus-model", invalidDefault.modelValue);
    }
    sessionStorage.setItem("codepilot:models-focus-filter", "all");
    router.push("/settings/models");
  }, [invalidDefault, router]);

  /** Jump to Models page so the user can pin a different model. The
   *  Models page top status row is already showing this same broken
   *  pin (Phase 2C.2 added that), so the user lands somewhere they
   *  can act without re-reading the problem. */
  const handlePickAnotherDefault = useCallback(() => {
    router.push("/settings/models");
  }, [router]);

  /** Revert to Auto. Single PUT â?storage layer's auto-clears the
   *  pinned values (Phase 2C.1 short-circuit). Same call shape as
   *  Models page + Providers selector for now. */
  const handleRevertToAuto = useCallback(async () => {
    if (revertingToAuto) return;
    setRevertingToAuto(true);
    try {
      await fetch("/api/providers/options", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: "__global__",
          options: { default_mode: "auto", legacy_default_provider_id: "" },
        }),
      });
      window.dispatchEvent(new Event("provider-changed"));
    } finally {
      setRevertingToAuto(false);
    }
  }, [revertingToAuto]);

  // ââ Claude Code å¼æ install / upgrade ââ
  const handleUpgrade = async () => {
    if (!claudeStatus?.installType) return;
    setUpgrading(true);
    try {
      const res = await fetch("/api/claude-upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ installType: claudeStatus.installType }),
      });
      const data = await res.json();
      if (data.success) await invalidateAndRefresh();
    } finally {
      setUpgrading(false);
    }
  };

  // ââ Model options (Claude Code only) ââ
  const saveModelOption = async (key: string, value: string | boolean) => {
    if (key === "thinking_mode") setThinkingMode(value as string);
    if (key === "context_1m") setContext1m(value as boolean);
    try {
      await fetch("/api/providers/options", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: "env", options: { [key]: value } }),
      });
    } catch {
      /* ignore */
    }
  };

  // ââ settings.json editor handlers ââ
  const hasChanges = JSON.stringify(settings) !== JSON.stringify(originalSettings);
  // JSON tab dirty: compare current textarea value to a re-serialised
  // baseline of originalSettings â?matches the formatting we set into
  // jsonText after a fresh load or successful save (see handleSave), so
  // round-tripping the JSON without semantic edits stays "saved".
  const originalJsonText = JSON.stringify(originalSettings, null, 2);
  const jsonDirty = jsonText !== originalJsonText;

  const handleSave = async (source: "form" | "json") => {
    let dataToSave: SettingsData;
    if (source === "json") {
      try {
        dataToSave = JSON.parse(jsonText);
        setJsonError("");
      } catch {
        setJsonError("Invalid JSON format");
        return;
      }
    } else {
      dataToSave = settings;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: dataToSave }),
      });
      if (res.ok) {
        setSettings(dataToSave);
        setOriginalSettings(dataToSave);
        setJsonText(JSON.stringify(dataToSave, null, 2));
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2000);
      }
    } finally {
      setSaving(false);
      setShowConfirmDialog(false);
      setPendingSaveAction(null);
    }
  };

  const handleReset = () => {
    setSettings(originalSettings);
    setJsonText(JSON.stringify(originalSettings, null, 2));
    setJsonError("");
  };

  const handleFormatJson = () => {
    try {
      const parsed = JSON.parse(jsonText);
      setJsonText(JSON.stringify(parsed, null, 2));
      setJsonError("");
    } catch {
      setJsonError(t("cli.formatError"));
    }
  };

  const confirmSave = (source: "form" | "json") => {
    setPendingSaveAction(source);
    setShowConfirmDialog(true);
  };

  const updateField = (key: string, value: unknown) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  // ââ Derived state ââ
  const connected = claudeStatus?.connected ?? false;
  const updateAvailable = claudeStatus?.updateAvailable ?? false;
  const hasWarnings = !!claudeStatus?.warnings && claudeStatus.warnings.length > 0;

  /**
   * What the chat runtime registry will *actually* pick. Delegates to
   * the shared `computeEffectiveRuntime` helper so this surface, the
   * chat header `RuntimeBadge`, and `registry.ts:resolveRuntime` all
   * agree on the same priority chain (`cli_enabled=false` overrides
   * the stored preference).
   *
   * `handleRuntimeChange` keeps both DB fields in sync on every write,
   * so the drift warning below has two known causes:
   *   1. Legacy DB rows where `agent_runtime='claude-code-sdk'` and
   *      `cli_enabled='false'` were saved apart by an earlier build.
   *   2. Stored preference is `'claude-code-sdk'` but CLI isn't
   *      currently detected (never installed / `which claude`
   *      stopped resolving / OAuth expired). The helper falls back
   *      to `'native'` to match registry's `r?.isAvailable()` gate.
   * The conditional render below branches on `cliEnabled` to give the
   * correct cause + recovery path for each.
   */
  const effectiveRuntime: AgentRuntime = computeEffectiveRuntime(
    agentRuntime,
    cliEnabled,
    connected,
  );
  const driftWarning = effectiveRuntime !== agentRuntime;

  /**
   * Compute Claude Code å¼æ status info from current data. Five-state
   * decision tree:
   *
   *   not connected â?blocked    (CLI missing / OAuth expired)
   *   connected + warnings â?degraded    (version mismatch etc.)
   *   connected + selected â?selected
   *   connected + not selected â?available
   *
   * The `disabled` state isn't surfaced for Claude Code in this build â?   * `cli_enabled=false` only flips when the user picks AI SDK as engine,
   * in which case Claude Code reads as `available` + the AI SDK card
   * reads as `selected`.
   */
  const claudeCodeStatus: RuntimeStatusInfo = useMemo(() => {
    if (!connected) {
      return {
        state: "blocked",
        reason: isZh
          ? "æªæ£æµå° Claude Code CLIï¼æ OAuth ç»å½å·²è¿æï¼"
          : "Claude Code CLI not detected (or OAuth login has expired)",
        impact: isZh
          ? "æ æ³ç?Claude Code åæ ¸è·ä¼è¯ï¼éç¨åä¼èªå¨åéå?CodePilot"
          : "Sessions cannot run on Claude Code; selecting it falls back to CodePilot",
        recovery: isZh
          ? "ä¸æ¹ç¹ãå®è£ãå¯å¨ä¸é®å®è£åå¯¼ï¼æåå¨ç³»ç»ç»ç«?`claude /login` å®æææ"
          : "Click Install below to launch the wizard, or run `claude /login` in a terminal",
      };
    }
    if (hasWarnings) {
      return {
        state: "degraded",
        reason: isZh
          ? "Claude Code å·²å®è£ä½æå¼å®¹æ§æç¤ºï¼è¯¦è§ä¸æ¹è­¦ååè¡¨ï¼?
          : "Claude Code is installed but reports compatibility warnings (see below)",
        impact: isZh
          ? "å¯ä»¥è¿è¡ï¼ä½é¨ååè½è¡ä¸ºå¯è½ä¸æ°çæ¬ä¸ä¸è´ï¼å»ºè®®åçº§"
          : "Sessions still run, but some behavior may diverge from the latest version. Upgrade recommended.",
        recovery: updateAvailable
          ? isZh
            ? "ä¸æ¹ç¹ãåçº§ãä¸é®æ´æ°å°ææ°çæ?
            : "Click Upgrade below to update to the latest version"
          : isZh
            ? "å¨ç³»ç»ç»ç«¯è¿è¡?`claude --version` æ£æ¥çæ¬ä¸ SDK å¼å®¹æ?
            : "Run `claude --version` in a terminal to check the version against SDK compatibility",
      };
    }
    if (effectiveRuntime === "claude-code-sdk") {
      return {
        state: "selected",
        reason: isZh
          ? "Claude Code å·²å®è£å¹¶è¢«è®¾ä¸ºé»è®¤å¼æ?
          : "Claude Code is installed and set as the default engine",
        impact: isZh
          ? "æ°ä¼è¯é»è®¤èµ° Claude Code åæ ¸ï¼ä½¿ç?~/.claude/settings.json ä¸­çç¯å¢ä¸æé?
          : "New chats run on the Claude Code engine, honoring ~/.claude/settings.json",
      };
    }
    return {
      state: "available",
      reason: isZh
        ? "Claude Code å·²å®è£ä½æªè¢«è®¾ä¸ºé»è®¤å¼æ"
        : "Claude Code is installed but isn't the default engine",
      impact: isZh
        ? "æ³åå?Claude Code åæ ¸ï¼æä¸æ¹ãé»è®¤å¼æãåå?Claude Code å³å¯"
        : 'Switch the "Default engine" selector above to use Claude Code',
    };
  }, [connected, hasWarnings, updateAvailable, effectiveRuntime, isZh]);

  /**
   * Codex Runtime â?Phase 5 Phase 6 IA correction (2026-05-14).
   * Availability is gated on the codex binary + a successful
   * `initialize` handshake. Codex doesn't fall back; if it's
   * selected but unavailable, send-time fails closed (see
   * claude-client.ts Round 5 guardrail).
   */
  const codexRuntimeStatus: RuntimeStatusInfo = useMemo(() => {
    const isSelected = effectiveRuntime === "codex_runtime";
    const installRecovery = codexCliInstallRecovery(isZh, isWindowsElectron);
    if (codexAvailability.kind === "desktop_only") {
      return {
        state: "blocked",
        reason: isZh
          ? "æ£æµå° ChatGPT/Codex æ¡é¢åºç¨ï¼ä½æ²¡æå¯ä¾ CodePilot å¯å¨çç¬ç«?Codex CLI"
          : "The ChatGPT/Codex desktop app was found, but no standalone Codex CLI is executable by CodePilot",
        impact: isZh
          ? "æ¡é¢åºç¨æ¬èº«ä»å¯ä½¿ç¨ï¼Codex Runtime éè¦è½å¯å¨ app-server ç?CLIï¼å½ååéä¼å¤±è´¥"
          : "The desktop app remains usable, but Codex Runtime needs a CLI that can launch app-server and sends will currently fail",
        recovery: installRecovery,
      };
    }
    if (codexAvailability.kind === "not_installed") {
      return {
        state: "blocked",
        reason: isZh
          ? "æªæ£æµå°å¯ç¨ç?Codex CLI"
          : "No usable Codex CLI was detected",
        impact: isZh
          ? "Codex Runtime æ´ä½æ æ³å¯ç¨ï¼Codex è´¦æ·æ¨¡åï¼gpt-5.5 ç­ï¼å?CodePilot æå¡åç» proxy æ¥å¥ä¸¤æ¡è·¯å¾é½ä¼åéå¤±è´?
          : "Codex Runtime is fully blocked: both Codex Account models (gpt-5.5 etc.) and CodePilot providers via the proxy will fail at send time",
        recovery: installRecovery,
      };
    }
    if (codexAvailability.kind === "too_old") {
      return {
        state: "degraded",
        reason: isZh
          ? `æ£æµå°ç?Codex çæ¬ ${codexAvailability.version} ä½äºæä½?${codexAvailability.minimum}`
          : `Detected Codex ${codexAvailability.version} below required minimum ${codexAvailability.minimum}`,
        impact: isZh
          ? "é¨åè½åå¯è½ä¸å¯ç¨ï¼å»ºè®®åçº§ codex CLI ååä½¿ç¨"
          : "Some capabilities may be unavailable; please upgrade codex CLI",
        recovery: isZh ? "åçº§ codex CLI å°ææ°çæ? : "Upgrade codex CLI to the latest version",
      };
    }
    if (codexAvailability.kind === "spawn_failed") {
      return {
        state: "blocked",
        reason: isZh ? `Codex åºç¨æå¡å¯å¨å¤±è´¥ï¼?{codexAvailability.reason}` : `Codex app-server spawn failed: ${codexAvailability.reason}`,
        impact: isZh
          ? "Codex Runtime æ´ä½ä¸å¯ç¨ï¼Codex è´¦æ·æ¨¡å + CodePilot æå¡åç» proxy æ¥å¥é½åå½±åï¼ï¼æ¥çç»ç«¯æ¥å¿è·åè¯¦ç»éè¯¯"
          : "Codex Runtime is fully unavailable (both Codex Account models and CodePilot providers via the proxy are blocked); check terminal logs for details",
        recovery: isZh ? "ç¹å³ä¸è§å·æ°ï¼éæ°æ«æå·²å®è£ç?CLI" : "Click refresh to rescan installed CLIs",
      };
    }
    if (codexAvailability.kind === "installed_idle") {
      return {
        // "å¯ç¨" not "degraded" â?the binary is installed and the
        // app-server will boot on the first send. "Degraded" reads
        // as "something's broken" which is the wrong frame for this
        // happy-path idle state.
        state: "available",
        reason: isZh ? "å·²å®è£ï¼å¯ç¨" : "Installed, starts on demand",
        impact: isZh
          ? "Codex åºç¨æå¡ä¼å¨é¦æ¬¡åéæ¶æéå¯å¨"
          : "Codex app-server boots on demand when you send your first Codex message",
        recovery: isZh ? "æ éå¤ç" : "No action needed",
      };
    }
    if (codexAvailability.kind === "ready") {
      return isSelected
        ? {
            state: "selected",
            reason: isZh
              ? "Codex åºç¨æå¡å·²å°±ç»ªå¹¶è¢«è®¾ä¸ºé»è®¤å¼æ?
              : "Codex app-server is ready and set as the default engine",
            impact: isZh
              ? "æ°ä¼è¯é»è®¤èµ° Codexï¼Codex è´¦æ·æ¨¡å + å·²éç½?CodePilot æå¡åéè¿ provider proxy æ¥å¥ï¼Claude Code é»è®¤/env æ¨¡å¼é¤å¤ï¼?
              : "New chats run on Codex: Codex Account models AND configured CodePilot providers via the provider proxy (env Claude Code default is excluded)",
          }
        : {
            state: "available",
            reason: isZh ? "Codex åºç¨æå¡å·²å°±ç»ªä½æªè¢«è®¾ä¸ºé»è®¤" : "Codex app-server is ready but not the default engine",
            impact: isZh
              ? "æ³æ Codex è®¾ä¸ºé»è®¤ï¼åæ¶å¯ç?Codex è´¦æ· + CodePilot æå¡å?via proxyï¼ï¼æä¸æ¹ãé»è®¤å¼æãåå?Codex"
              : 'Switch the "Default engine" selector above to make Codex the default for both Codex Account models and CodePilot providers via the proxy',
          };
    }
    // unknown â?initial fetch still pending
    return {
      state: "available",
      reason: isZh ? "æ­£å¨æ£æµ?Codex åºç¨æå¡ç¶æâ? : "Detecting Codex app-server statusâ?,
      impact: isZh ? "ç¶æä¼å¨åå°è½®è¯¢åå·æ°" : "Status updates after background polling",
    };
  }, [codexAvailability, effectiveRuntime, isZh, isWindowsElectron]);

  /**
   * bb-agent Runtime is bundled and always available; the only thing
   * that can change is whether it's selected as default.
   */
  const codepilotStatus: RuntimeStatusInfo = useMemo(() => {
    if (effectiveRuntime === "native") {
      return {
        state: "selected",
        reason: isZh
          ? "CodePilot æ¯é»è®¤åæ ¸ï¼æ é CLIï¼ç´è¿?provider APIï¼?
          : "CodePilot is the default engine (no CLI required, direct provider API)",
        impact: isZh
          ? "æ°ä¼è¯é»è®¤ç¨ CodePilotï¼å·¥å·ãæéåä¸ä¸æç± CodePilot èªå·±ç®¡ç"
          : "New chats run on CodePilot; tools, permissions, and context managed by CodePilot itself",
      };
    }
    return {
      state: "available",
      reason: isZh
        ? "CodePilot åæ ¸éåºç¨èªå¸¦ï¼å§ç»å¯ç¨"
        : "CodePilot ships with the app and is always available",
      impact: isZh
        ? "æ³åå?CodePilot åæ ¸ï¼æä¸æ¹ãé»è®¤å¼æãåå?CodePilot å³å¯"
        : 'Switch the "Default engine" selector above to use CodePilot',
    };
  }, [effectiveRuntime, isZh]);

  /**
   * Session-level resolved engine string for the read-only explainer.
   * Authoritative when the API echoes back `runtime_applied`; otherwise
   * fall back to the locally-computed `effectiveRuntime`. The
   * "fallback â?Claude Code unavailable" annotation only shows when
   * the stored preference says Claude Code but the effective runtime
   * routed elsewhere.
   */
  const resolvedEngineLabel = useMemo(() => {
    // Authoritative source: API `runtime_applied` field. The /api/providers/models
    // server-side filter knows the live state of CLI subprocess + cli_enabled
    // and returns the runtime it actually filtered against. Fall back to the
    // locally-computed effectiveRuntime only when that field is missing
    // (request failed or older API version).
    const apiSaid = resolvedRuntimeFromApi;
    // Normalize the API's underscore form to the canonical agent_runtime spelling.
    // Phase 6 IA correction (2026-05-14): codex_runtime is identity (the
    // canonical RuntimeId matches the registry id for Codex per Phase 3).
    const apiNormalized: AgentRuntime | null =
      apiSaid === "claude_code"
        ? "claude-code-sdk"
        : apiSaid === "bbagent"
          ? "native"
          : apiSaid === "codex_runtime"
            ? "codex_runtime"
            : null;
    const resolvedRuntime = apiNormalized ?? effectiveRuntime;
    const resolvedLabel = runtimeDisplayLabel(resolvedRuntime);

    // Annotate the label when the user's stored preference disagrees
    // with the actually-resolved runtime â?i.e. they picked Claude
    // Code but CLI is missing OR cli_enabled=false routes them away.
    if (agentRuntime === "claude-code-sdk" && resolvedRuntime !== "claude-code-sdk") {
      return isZh
        ? `${resolvedLabel}ï¼Claude Code ä¸å¯ç¨ï¼èªå¨éçº§ï¼`
        : `${resolvedLabel} (fallback â?Claude Code unavailable)`;
    }
    return resolvedLabel;
  }, [resolvedRuntimeFromApi, effectiveRuntime, agentRuntime, isZh]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <SpinnerGap size={20} className="animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">{t("cli.loadingSettings")}</span>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* ââ Page header ââââââââââââââââââââââââââââââââââââââââââââââââ */}
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{t("settings.runtime" as TranslationKey)}</h2>
        <p className="text-sm text-muted-foreground mt-1.5">
          {isZh
            ? "æ¥çå½å Agent ç±è°è¿è¡ãä¸ºä»ä¹æ¯è¿ä¸ªç¶æãå½±åæ¯ä»ä¹ãæä¹æ¢å¤ãProviders ç®¡èµäº§ï¼Models ç®¡æ´é²ï¼Runtime ç®¡è¿è¡ç¯å¢ã?
            : "Inspect which runtime is currently in charge of the Agent â?why it's in this state, what the impact is, and how to recover. Providers govern assets, Models govern exposure, Runtime governs environment."}
        </p>
      </div>

      {/* ââ Default-engine picker (two large cards, mutually exclusive) ââ
          Each card is the entire click target. Selected card carries
          primary-tinted border + bg + ring; unselected stays muted.
          The status hint at the bottom of each card flips based on
          actual reachability (Claude Code: install / OAuth state;
          AI SDK: always ready since it ships in-app). */}
      <div>
        <div className="mb-2">
          <h3 className="text-sm font-semibold">{isZh ? "é»è®¤å¼æ" : "Default engine"}</h3>
        </div>
        <p className="text-[11px] text-muted-foreground mb-3">
          {isZh
            ? "éæ©æ°ä¼è¯é»è®¤ä½¿ç¨åªä¸?Runtimeãå½åæ­£å¨è¿è¡çåå¤ä¸åå½±åï¼åç»­æ¯æ¡æ°æ¶æ¯ä¼æ"
              + "ãé»è®?Runtime + Providerãéæ°è§£æã?
            : "Choose which runtime new chats use by default. Replies already streaming aren't interrupted; every subsequent message re-resolves the default runtime + provider on send."}
        </p>
        {driftWarning && (
          // Two distinct reasons can drive this warning, with different
          // recovery paths. Don't conflate them â?Runtime is the trust
          // page, getting the *cause* wrong (and pointing at the wrong
          // fix) is exactly what we're trying to avoid.
          //
          //   1. cli_enabled=false  â?user explicitly turned off CLI in
          //      a previous build. Recovery: click either card so
          //      handleRuntimeChange writes both fields atomically.
          //   2. !cliConnected      â?CLI never installed (or OAuth
          //      expired, or `which claude` no longer resolves).
          //      Recovery: the Claude Code card below has an Install
          //      button + warning details â?point the user there
          //      instead of asking them to "click either card."
          <div className="mb-3 rounded-md border border-status-warning-muted bg-status-warning-muted/30 px-3 py-2 text-[11px] text-status-warning-foreground flex items-start gap-1.5">
            <Warning size={14} weight="fill" className="mt-0.5 shrink-0" />
            <span>
              {!cliEnabled
                ? (isZh
                    ? "ä¿å­çåå¥½æ¯ Claude Codeï¼ä½ CLI å¨ãè®¾ç½®ãéè¢«æ¾å¼å³é­è¿ï¼è¿è¡æ¶å®éèµ?CodePilotãç¹ä¸é¢ä»»ä¸å¡çå¯ä¸æ¬¡åé½ä¸¤è¾¹è®¾ç½®ã?
                    : "Stored preference is Claude Code but CLI was explicitly disabled in a previous setting, so runtime actually routes to CodePilot. Click either card above to rewrite both fields together.")
                : (isZh
                    ? "ä¿å­çåå¥½æ¯ Claude Codeï¼ä½å½åæ²¡ææ£æµå° Claude Code CLIï¼å¯è½æªå®è£æç»å½å¤±æï¼ï¼è¿è¡æ¶å®éèµ?CodePilotãä¸æ?Claude Code å¡çæä¾å®è£å¥å£ï¼æèæ¹é?CodePilot ä½ä¸ºé»è®¤ã?
                    : "Stored preference is Claude Code but the CLI isn't currently detected (not installed or OAuth expired), so runtime actually routes to CodePilot. Use the Install button on the Claude Code card below â?or pick CodePilot as your default instead.")}
            </span>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <EnginePickerCard
            engine="claude-code-sdk"
            selected={effectiveRuntime === "claude-code-sdk"}
            onSelect={() => handleRuntimeChange("claude-code-sdk")}
            // Phase 6 UIæ¶å£ P1 (2026-05-14): short titles drop the
            // "å¼æ" / "Runtime" suffix â?the page header + picker
            // section header already carry that framing, repeating it
            // on every card makes the picker read as redundant noise.
            title="Claude Code"
            icon={<Anthropic size={20} />}
            tagline={isZh ? "Anthropic å®æ¹ CLI" : "Anthropic official CLI"}
            pitch={isZh
              ? "ç?Anthropic å®æ¹ CLI è·?Agentï¼å®æ´å¼å®?Claude Code çæï¼~/.claude/settings.jsonãhooksãMCP server ç´æ¥å¯ç¨ã?
              : "Runs the Agent through Anthropic's official Claude Code CLI. Fully compatible with the Claude Code ecosystem â?~/.claude/settings.json, hooks, and MCP servers all work as-is."}
            statusKind={connected ? "ok" : "warning"}
            // installType ("native" / "npm" / etc.) is intentionally
            // omitted here â?the word "native" collides with the AI
            // SDK runtime which is internally called `native`, and the
            // install method isn't actionable for the user.
            statusText={connected
              ? `${isZh ? "å·²å®è£? : "Installed"} v${claudeStatus?.version ?? ""}`
              : (isZh ? "æªå®è£?â?éç¨åä¼èªå¨éçº§å?CodePilot" : "Not installed â?selecting it falls back to CodePilot")}
            isZh={isZh}
            trigger={capabilityCells && (
              <RuntimeCapabilityList
                runtimeId="claude_code"
                cells={capabilityCells.claude_code}
                isZh={isZh}
                stopPropagationOnTrigger
              />
            )}
          />
          <EnginePickerCard
            engine="native"
            selected={effectiveRuntime === "native"}
            onSelect={() => handleRuntimeChange("native")}
            title="CodePilot"
            icon={<MonolithIcon size={20} />}
            tagline={isZh ? "CodePilot èªå¸¦åæ ¸" : "CodePilot built-in"}
            pitch={isZh
              ? "CodePilot ç´è¿ provider API è·?Agentãéåå¤?providerãå¯è§å¯ãå¯æ¢å¤ï¼ç± CodePilot èªç®¡ä¸ä¸æåæéï¼ä¸ä¾èµå¤é¨ CLIã?
              : "CodePilot calls provider APIs directly. Built for multi-provider, observable, recoverable runs â?context and permissions stay inside CodePilot, no external CLI required."}
            statusKind="ok"
            statusText={isZh ? "éåºç¨èªå¸¦ï¼å§ç»å¯ç¨" : "Bundled with the app, always available"}
            isZh={isZh}
            trigger={capabilityCells && (
              <RuntimeCapabilityList
                runtimeId="bbagent"
                cells={capabilityCells.bbagent}
                isZh={isZh}
                stopPropagationOnTrigger
              />
            )}
          />
          <EnginePickerCard
            engine="codex_runtime"
            selected={effectiveRuntime === "codex_runtime"}
            onSelect={() => handleRuntimeChange("codex_runtime")}
            title="Codex"
            icon={<OpenAI size={20} />}
            tagline={isZh ? "OpenAI Codex åºç¨æå¡" : "OpenAI Codex app-server"}
            pitch={isZh
              ? "éè¿ Codex åºç¨æå¡è°ç¨ ChatGPT è´¦æ·åç½®æ¨¡åï¼gpt-5.5 ç­ï¼é¢åº¦èµ?ChatGPT å¥é¤ï¼ï¼åæ¶å·²éç½®ç CodePilot æå¡åä¹è½ç» provider proxy å?Codex ä¸ä½¿ç¨ï¼Claude Code é»è®¤ / env æ¨¡å¼é¤å¤ï¼ã?
              : "Routes through the Codex app-server for Codex Account models (gpt-5.5 etc., quota covered by your ChatGPT plan), and also serves configured CodePilot providers via the provider proxy (env Claude Code default is excluded)."}
            statusKind={codexConnected ? "ok" : "warning"}
            statusText={
              codexConnected
                ? (isZh ? "å·²å°±ç»? : "Ready")
                : codexAvailability.kind === "not_installed"
                  ? (isZh ? "æªå®è£?codex CLI â?éç¨åæ æ³åé? : "codex CLI not installed â?sends will fail")
                  : codexAvailability.kind === "desktop_only"
                    ? (isZh ? "ä»æ£æµå°æ¡é¢åºç¨ â?éç¬ç« CLI" : "Desktop app only â?standalone CLI required")
                  : codexAvailability.kind === "installed_idle"
                    ? (isZh ? "å·²å®è£ï¼å¯ç¨" : "Installed, starts on demand")
                  : codexAvailability.kind === "spawn_failed"
                    ? (isZh ? "åºç¨æå¡å¯å¨å¤±è´¥" : "App-server failed to start")
                    : codexAvailability.kind === "too_old"
                      ? (isZh ? "çæ¬è¿æ§" : "Version too old")
                      : (isZh ? "æ£æµä¸­â? : "Detectingâ?)
            }
            isZh={isZh}
            trigger={capabilityCells && (
              <RuntimeCapabilityList
                runtimeId="codex_runtime"
                cells={capabilityCells.codex_runtime}
                isZh={isZh}
                stopPropagationOnTrigger
                // The Codex card always reflects the Codex Account profile
                // (page derives codex_runtime cells from codex_account, per
                // the 2026-05-28 decision), so this scope note always
                // applies: Codexâs own plugins / Skills are Codex-managed,
                // and the list below ONLY describes whether CodePilotâs
                // built-in Harness is injected on this path â?not Codexâs
                // native capabilities.
                providerNote={codexAccountHeaderNote(isZh)}
              />
            )}
          />
        </div>
      </div>

      {/* ââ Session-level read-only explainer ââââââââââââââââââââââââââââââ
          Sits BETWEEN the picker and the Runtime detail cards on
          purpose: this is the answer most users come here for ("what
          will my next chat actually use?"). Putting it below the
          picker means they see the consequence of their selection
          without scrolling, and the detail cards below explain *why*
          if they want to dig deeper. */}
      <div className="rounded-lg bg-card border border-border/50 p-5 flex flex-col gap-3">
        <h3 className="text-sm font-semibold leading-tight">
          {isZh ? "æ°ä¼è¯ä¼ç¨ä»ä¹? : "What a new chat will use"}
        </h3>
        <p className="text-[11px] text-muted-foreground">
          {isZh
            ? "æå½åé»è®¤è®¾ç½®ï¼ä¸ä¸æ¡æ°æ¶æ¯ä¼è§£æä¸ºä»¥ä¸è¿è¡ç»åãæ¯æ¬¡åéåé½ä¼éæ°æ£æ?RuntimeãProvider åæ¨¡åå¼å®¹æ?â?ä¸æä¹ç»å®å°æä¸ªä¼è¯ã?
            : "With the current defaults, your next new message resolves to the combination below. Runtime, provider, and model compatibility are re-checked on every send â?nothing is pinned to a session."}
        </p>
        {noCompatibleProvider ? (
          <div className="rounded-md border border-status-warning-muted bg-status-warning-muted/30 px-3 py-2 text-xs text-status-warning-foreground flex items-start gap-1.5">
            <Warning size={14} weight="fill" className="mt-0.5 shrink-0" />
            <span>
              {isZh
                ? `å½åæ§è¡å¼æï¼?{resolvedEngineLabel}ï¼ä¸æ²¡æå¯ç¨ç?provider/modelãæ°ä¼è¯ä¼è¿å?æ å¼å®¹æå?ç¶æï¼éè¦åå¨ãæå¡å / æ¨¡åãéå¯ç¨ä¸ä¸ªå¹é?Runtime çæ¨¡åã`
                : `No provider/model is compatible with the current runtime (${resolvedEngineLabel}). New chats land in the "no compatible provider" state until you enable a matching model in Providers / Models.`}
            </span>
          </div>
        ) : invalidDefault ? (
          /* Phase 6 UIæ¶å£ fix-up (2026-05-14): pinned-invalid is a
             non-blocking warning, aligned with the chat composer's
             banner copy + tone. The earlier wording ("æ°ä¼è¯ä¸ä¼èªå?             æ¿æ¢ â?è¯·éæ©ä¸æ¹ä¸ç§æ¢å¤æ¹å¼?) and the four-button
             recovery (switch engine / enable model / pick another /
             revert to Auto) directly contradicted the post-P0 chat
             behavior, which now auto-falls-back to a compatible model
             without surprise. Banner now mirrors the chat copy:
             acknowledge the auto-fallback, give one primary action
             (`ä¿®æ¹é»è®¤æ¨¡å â?/settings/models`) and an optional ghost
             "æ¹å Auto" for users who'd rather drop the pin entirely. */
          <div className="rounded-md border border-status-warning-muted bg-status-warning-muted/30 p-3 flex flex-col gap-2.5">
            <div className="flex items-start gap-2">
              <Warning size={14} weight="fill" className="mt-0.5 shrink-0 text-status-warning-foreground" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-status-warning-foreground">
                  {invalidDefault.reason === "pin-incomplete"
                    ? (isZh ? "é»è®¤æ¨¡ååºå®ä¿¡æ¯ä¸å®æ? : "Pinned default is incomplete")
                    : (isZh ? "é»è®¤æ¨¡åå¨å½åæ§è¡ç¯å¢ä¸ä¸å¯ç? : "Default model unavailable under the current engine")}
                </p>
                <p className="text-[11px] text-foreground/80 mt-1 leading-relaxed">
                  {(() => {
                    const provDisplay = invalidDefault.providerName ?? invalidDefault.providerId;
                    const modelDisplay = invalidDefault.modelLabel ?? invalidDefault.modelValue;
                    const pinName = provDisplay && modelDisplay
                      ? `${provDisplay} / ${modelDisplay}`
                      : provDisplay ?? modelDisplay ?? (isZh ? 'å½åé»è®¤' : 'the current default');
                    // #27: pin-incomplete = ç¼?provider ç»å®ï¼æ¨¡åæ¬èº«å¯ç¨ï¼ä¸æ¯
                    // Runtime å¼å®¹é®é¢ââå«è¯?ä¸å¨å¼å®¹èå´å?è¯¯å¯¼ç¨æ·ã?                    if (invalidDefault.reason === "pin-incomplete") {
                      return isZh
                        ? `é»è®¤æ¨¡ååºå®ä¿¡æ¯ä¸å®æ´ï¼ç¼?provider ç»å®ï¼ï¼æ°ä¼è¯ä¼èªå¨ä½¿ç¨å½åç¯å¢ä¸çå¯ç¨æ¨¡åãå°ãæ¨¡åãé¡µéæ°åºå®ä¸ä¸ªé»è®¤å³å¯ã`
                        : `The pinned default is missing its provider binding. New chats auto-use an available model â?re-pin a default in Models to fix.`;
                    }
                    return isZh
                      ? `${pinName} ä¸å¨å½åæ§è¡ç¯å¢ï¼?{resolvedEngineLabel}ï¼çå¼å®¹èå´åï¼æ°ä¼è¯ä¼èªå¨ä½¿ç¨å½åç¯å¢ä¸çå¯ç¨æ¨¡åãéè¦åºå®ä¸ä¸ªæ°çé»è®¤æ¶å°ãæ¨¡åãé¡µä¿®æ¹å³å¯ã`
                      : `${pinName} isn't compatible with the current engine (${resolvedEngineLabel}). New chats fall back to an available model automatically. Pick a new default in Models when you're ready.`;
                  })()}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 pt-0.5">
              <Button
                variant="default"
                size="sm"
                onClick={handlePickAnotherDefault}
                className="text-xs"
                title={isZh
                  ? "å»ãæ¨¡åãé¡µæä¸ä¸ªæ°çåºå®é»è®?
                  : "Open Models to pin a new default"}
              >
                {isZh ? "ä¿®æ¹é»è®¤æ¨¡å" : "Change default"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRevertToAuto}
                disabled={revertingToAuto}
                className="text-xs gap-1.5"
                title={isZh
                  ? "åå Auto â?ä¸ååºå®å°æä¸ªå·ä½æ¨¡åï¼æ¯æ¬¡æ°ä¼è¯ç±ç³»ç»æå½åç¯å¢èªå¨é?
                  : "Revert to Auto â?drop the pin and let the system pick a compatible model per chat"}
              >
                {revertingToAuto ? <SpinnerGap size={12} className="animate-spin" /> : null}
                {isZh ? "æ¹å Auto" : "Revert to Auto"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-md bg-muted/40 px-3.5 divide-y divide-border/50">
            <div className="py-2.5 flex items-center justify-between gap-3">
              <span className="text-[11px] text-muted-foreground shrink-0">
                {isZh ? "Runtime" : "Runtime"}
              </span>
              <span className="text-xs text-foreground/85 text-right">{resolvedEngineLabel}</span>
            </div>
            <div className="py-2.5 flex items-center justify-between gap-3">
              <span className="text-[11px] text-muted-foreground shrink-0">
                {isZh ? "é»è®¤ Provider" : "Default provider"}
              </span>
              <span className="text-xs text-foreground/85 text-right truncate">
                {defaultProviderName ?? (isZh ? "æªéç½? : "Not configured")}
              </span>
            </div>
            <div className="py-2.5 flex items-center justify-between gap-3">
              <span className="text-[11px] text-muted-foreground shrink-0">
                {isZh ? "é»è®¤æ¨¡å" : "Default model"}
              </span>
              <span className="text-xs text-foreground/85 text-right truncate">
                {defaultModelLabel ?? (isZh ? "æªéç½? : "Not configured")}
              </span>
            </div>
            {/* Fallback row â?shown when stored preference is Claude
                Code but effective runtime routed elsewhere (CLI
                missing OR cli_enabled=false). */}
            {agentRuntime === "claude-code-sdk" && effectiveRuntime !== "claude-code-sdk" && (
              <div className="py-2.5 flex items-center justify-between gap-3">
                <span className="text-[11px] text-muted-foreground shrink-0">
                  {isZh ? "éçº§è·¯å¾" : "Fallback"}
                </span>
                <span className="text-xs text-status-warning-foreground text-right">
                  {!cliEnabled
                    ? (isZh
                        ? "CLI å·²ç¦ç?â?èµ?CodePilot"
                        : "CLI disabled â?routes to CodePilot")
                    : (isZh
                        ? "Claude Code ä¸å¯ç?â?èªå¨ç?CodePilot"
                        : "Claude Code unavailable â?falls back to CodePilot")}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ââ Claude Code detail card ââââââââââââââââââââââââââââââââââââ */}
      <RuntimeCard name="Claude Code" state={claudeCodeStatus.state} isZh={isZh}>
        <RuntimeStatusExplanation info={claudeCodeStatus} isZh={isZh} />

        {/* CLI install / version / upgrade row */}
        <div className="rounded-md bg-muted/40 px-3.5 divide-y divide-border/50">
          <div className="py-2.5 flex items-center justify-between gap-3">
            <span className="text-[11px] text-muted-foreground shrink-0">
              {isZh ? "CLI ç¶æ? : "CLI status"}
            </span>
            <div className="flex items-center gap-2">
              {connected ? (
                <>
                  <CheckCircle size={14} className="text-status-success-foreground" />
                  <span className="text-xs text-muted-foreground">
                    v{claudeStatus?.version}
                  </span>
                  {updateAvailable && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-xs gap-1"
                      onClick={handleUpgrade}
                      disabled={upgrading}
                    >
                      {upgrading ? (
                        <SpinnerGap size={12} className="animate-spin" />
                      ) : (
                        <ArrowsClockwise size={12} />
                      )}
                      {t("cli.update")}
                    </Button>
                  )}
                </>
              ) : (
                <>
                  <XCircle size={14} className="text-status-error-foreground" />
                  <span className="text-xs text-muted-foreground">
                    {isZh ? "æªå®è£? : "Not installed"}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 text-xs gap-1"
                    onClick={() => setInstallWizardOpen(true)}
                  >
                    {t("cli.install")}
                  </Button>
                </>
              )}
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={refreshStatus}>
                <ArrowClockwise size={12} />
              </Button>
            </div>
          </div>
        </div>

        {/* Warnings (only when present) */}
        {hasWarnings && (
          <div className="rounded-md border border-status-warning-muted bg-status-warning-muted/30 px-3 py-2">
            <div className="flex items-start gap-2">
              <Warning
                size={14}
                className="text-status-warning-foreground mt-0.5 flex-shrink-0"
              />
              <div className="text-xs text-status-warning-foreground space-y-0.5">
                {claudeStatus!.warnings!.map((w, i) => (
                  <p key={i}>{w}</p>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Model options â?only meaningful when Claude Code is selected and connected */}
        {effectiveRuntime === "claude-code-sdk" && connected && (
          <div className="rounded-md bg-muted/40 px-3.5 divide-y divide-border/50">
            <div className="py-2.5 flex items-center justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-medium">{t("cli.thinkingMode")}</span>
                <span className="text-[11px] text-muted-foreground">{t("cli.thinkingModeDesc")}</span>
              </div>
              <Select value={thinkingMode} onValueChange={(v) => saveModelOption("thinking_mode", v)}>
                <SelectTrigger className="w-[140px] h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="adaptive">{t("settings.thinkingAdaptive" as TranslationKey)}</SelectItem>
                  <SelectItem value="enabled">{t("settings.thinkingEnabled" as TranslationKey)}</SelectItem>
                  <SelectItem value="disabled">{t("settings.thinkingDisabled" as TranslationKey)}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="py-2.5 flex items-center justify-between gap-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-medium">{t("cli.context1m")}</span>
                <span className="text-[11px] text-muted-foreground">{t("cli.context1mDesc")}</span>
              </div>
              <Switch
                checked={context1m}
                onCheckedChange={(c) => saveModelOption("context_1m", c)}
              />
            </div>
          </div>
        )}

        {/* settings.json editor (collapsed by default â?advanced) */}
        <details className="rounded-md bg-muted/40 px-3.5 py-2 group">
          <summary className="flex items-center justify-between gap-2 cursor-pointer text-xs font-medium select-none list-none">
            <span className="flex items-center gap-1.5">
              <Code size={12} className="text-muted-foreground" />
              {t("cli.cliConfig")}
            </span>
            <CaretDown
              size={12}
              className="text-muted-foreground transition-transform group-open:rotate-180"
            />
          </summary>
          <p className="mt-1 mb-3 text-[11px] text-muted-foreground">{t("cli.cliConfigDesc")}</p>
          <Tabs defaultValue="form">
            <TabsList className="mb-3">
              <TabsTrigger value="form" className="gap-2 text-xs">
                <SlidersHorizontal size={14} />
                {t("cli.form")}
              </TabsTrigger>
              <TabsTrigger value="json" className="gap-2 text-xs">
                <Code size={14} />
                {t("cli.json")}
              </TabsTrigger>
            </TabsList>
            <TabsContent value="form">
              <div className="space-y-3">
                {KNOWN_FIELDS.map((field) => (
                  <div key={field.key}>
                    <Label className="text-xs font-medium">
                      {t(knownFieldKeys[field.key]?.label ?? (field.label as TranslationKey))}
                    </Label>
                    <p className="mb-1.5 text-[11px] text-muted-foreground">
                      {t(knownFieldKeys[field.key]?.description ?? ("" as TranslationKey))}
                    </p>
                    <Textarea
                      value={
                        typeof settings[field.key] === "object"
                          ? JSON.stringify(settings[field.key], null, 2)
                          : String(settings[field.key] ?? "")
                      }
                      onChange={(e) => {
                        try {
                          const parsed = JSON.parse(e.target.value);
                          updateField(field.key, parsed);
                        } catch {
                          updateField(field.key, e.target.value);
                        }
                      }}
                      className="font-mono text-xs"
                      rows={4}
                    />
                  </div>
                ))}
                {Object.entries(settings)
                  .filter(([key]) => !KNOWN_FIELDS.some((f) => f.key === key))
                  .map(([key, value]) => (
                    <div key={key}>
                      <Label className="text-xs font-medium">
                        {dynamicFieldLabels[key] ? t(dynamicFieldLabels[key]) : key}
                      </Label>
                      {typeof value === "boolean" ? (
                        <div className="mt-1.5 flex items-center gap-2">
                          <Switch checked={value} onCheckedChange={(c) => updateField(key, c)} />
                          <span className="text-xs text-muted-foreground">
                            {value ? t("common.enabled") : t("common.disabled")}
                          </span>
                        </div>
                      ) : typeof value === "string" ? (
                        <Input
                          value={value}
                          onChange={(e) => updateField(key, e.target.value)}
                          className="mt-1.5 text-xs"
                        />
                      ) : (
                        <Textarea
                          value={JSON.stringify(value, null, 2)}
                          onChange={(e) => {
                            try {
                              updateField(key, JSON.parse(e.target.value));
                            } catch {
                              updateField(key, e.target.value);
                            }
                          }}
                          className="mt-1.5 font-mono text-xs"
                          rows={4}
                        />
                      )}
                    </div>
                  ))}
                <div className="flex items-center gap-2">
                  <SaveButton
                    dirty={hasChanges}
                    saving={saving}
                    onClick={() => confirmSave("form")}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleReset}
                    disabled={!hasChanges}
                    className="gap-1.5"
                  >
                    <ArrowClockwise size={14} />
                    {t("cli.reset")}
                  </Button>
                  {saveSuccess && (
                    <span className="text-xs text-status-success-foreground">
                      {t("cli.settingsSaved")}
                    </span>
                  )}
                </div>
              </div>
            </TabsContent>
            <TabsContent value="json">
              <div className="space-y-3">
                <Textarea
                  value={jsonText}
                  onChange={(e) => {
                    setJsonText(e.target.value);
                    setJsonError("");
                  }}
                  className="min-h-[300px] font-mono text-xs"
                  placeholder='{"key": "value"}'
                />
                {jsonError && <p className="text-xs text-destructive">{jsonError}</p>}
                <div className="flex items-center gap-2">
                  <SaveButton
                    dirty={jsonDirty}
                    saving={saving}
                    onClick={() => confirmSave("json")}
                  />
                  <Button variant="outline" size="sm" onClick={handleFormatJson} className="gap-1.5">
                    <Code size={14} />
                    {t("cli.format")}
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleReset} className="gap-1.5">
                    <ArrowClockwise size={14} />
                    {t("cli.reset")}
                  </Button>
                  {saveSuccess && (
                    <span className="text-xs text-status-success-foreground">
                      {t("cli.settingsSaved")}
                    </span>
                  )}
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </details>
      </RuntimeCard>

      {/* ââ Codex detail card ââââââââââââââââââââââââââââââââââââââââ
           Phase 5 Phase 6 IA correction (2026-05-14). Surfaces the
           app-server detail (binary status / version / Codex home) and
           a jump-link to Providers + Models where Codex Account
           login + models live. Doesn't duplicate that data here. */}
      <RuntimeCard name="Codex" state={codexRuntimeStatus.state} isZh={isZh}>
        <RuntimeStatusExplanation info={codexRuntimeStatus} isZh={isZh} />

        {/* App-server status row */}
        <div className="rounded-md bg-muted/40 px-3.5 divide-y divide-border/50">
          <div className="py-2.5 flex items-center justify-between gap-3">
            <span className="text-[11px] text-muted-foreground shrink-0">
              {isZh ? "åºç¨æå¡" : "App-server"}
            </span>
            <div className="flex items-center gap-2">
              {codexAvailability.kind === "ready" ? (
                <>
                  <CheckCircle size={14} className="text-status-success-foreground" />
                  <span className="text-xs text-muted-foreground font-mono">
                    {codexAvailability.version}
                  </span>
                </>
              ) : codexAvailability.kind === "not_installed" ? (
                <>
                  <XCircle size={14} className="text-status-error-foreground" />
                  <span className="text-xs text-muted-foreground">
                    {isZh ? "æªå®è£? : "Not installed"}
                  </span>
                </>
              ) : codexAvailability.kind === "desktop_only" ? (
                <>
                  <Warning size={14} weight="fill" className="text-status-warning-foreground" />
                  <span className="text-xs text-muted-foreground">
                    {isZh ? "ä»æ¡é¢åºç? : "Desktop app only"}
                  </span>
                </>
              ) : codexAvailability.kind === "installed_idle" ? (
                <>
                  <CheckCircle size={14} className="text-status-success-foreground" />
                  <span className="text-xs text-muted-foreground">
                    {isZh ? "å·²å®è£ï¼å¯ç¨" : "Installed, starts on demand"}
                  </span>
                </>
              ) : codexAvailability.kind === "too_old" ? (
                <>
                  <Warning size={14} weight="fill" className="text-status-warning-foreground" />
                  <span className="text-xs text-muted-foreground font-mono">
                    {codexAvailability.version}
                  </span>
                </>
              ) : codexAvailability.kind === "spawn_failed" ? (
                <>
                  <XCircle size={14} className="text-status-error-foreground" />
                  <span className="text-xs text-muted-foreground">
                    {isZh ? "å¯å¨å¤±è´¥" : "Spawn failed"}
                  </span>
                </>
              ) : (
                <>
                  <SpinnerGap size={14} className="animate-spin text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">
                    {isZh ? "æ£æµä¸­â? : "Detectingâ?}
                  </span>
                </>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={refreshCodexStatus}
                disabled={codexStatusLoading}
                aria-label={isZh ? "å·æ°" : "Refresh"}
              >
                <ArrowClockwise size={12} />
              </Button>
            </div>
          </div>
          {codexBinary && (
            <div className="py-2.5 flex items-start justify-between gap-3">
              <span className="text-[11px] text-muted-foreground shrink-0">
                {isZh ? "CLI æ¥æº" : "CLI source"}
              </span>
              <span className="text-xs text-muted-foreground font-mono break-all text-right">
                {codexBinary}
              </span>
            </div>
          )}
          {codexAvailability.kind === "ready" && (
            <div className="py-2.5 flex items-center justify-between gap-3">
              <span className="text-[11px] text-muted-foreground shrink-0">
                {isZh ? "Codex ç®å½" : "Codex home"}
              </span>
              <span className="text-xs text-muted-foreground font-mono break-all text-right">
                {codexAvailability.codexHome}
              </span>
            </div>
          )}
          {codexProbe && (
            <>
              <div className="py-2.5 flex items-center justify-between gap-3">
                <span className="text-[11px] text-muted-foreground shrink-0">
                  {isZh ? "åéæ¥æº? : "Candidate source"}
                </span>
                <span className="text-xs text-muted-foreground font-mono">
                  {codexProbe.candidateSource}
                </span>
              </div>
              <div className="py-2.5 flex items-start justify-between gap-3">
                <span className="text-[11px] text-muted-foreground shrink-0">
                  {isZh ? "æ²çå°±ç»ªåº? : "Sandbox readiness"}
                </span>
                <span className="text-xs text-muted-foreground text-right">
                  {codexProbe.sandbox?.state === "setup"
                    ? (isZh ? "setup å·²å®æï¼runner / é¦ä¸ªåéå½ä»¤æªéªè¯? : "Setup completed; runner / first restricted command unverified")
                    : codexProbe.sandbox?.state === "error"
                        ? (isZh ? `éè¯¯ Â· ${codexProbe.sandbox.stage ?? "unknown"}` : `Error Â· ${codexProbe.sandbox.stage ?? "unknown"}`)
                        : codexProbe.sandbox?.state === "degraded"
                          ? (isZh ? `æè­¦å?Â· ${codexProbe.sandbox.stage ?? "unknown"}` : `Warning Â· ${codexProbe.sandbox.stage ?? "unknown"}`)
                          : codexProbe.sandbox?.state === "not_applicable"
                            ? (isZh ? "ç­å¾å¯æ§è¡çç¬ç« CLI" : "Waiting for an executable standalone CLI")
                            : (isZh ? "æªè¿è¡?/ æ çå®ä¿¡å? : "Not run / no observed signal")}
                </span>
              </div>
              <div className="py-2.5 flex items-start justify-between gap-3">
                <span className="text-[11px] text-muted-foreground shrink-0">
                  {isZh ? "è¯æ­ CWD" : "Diagnostic CWD"}
                </span>
                <span className="text-xs text-muted-foreground font-mono break-all text-right">
                  {codexProbe.cwd.resolved}
                  <span className="block font-sans text-[10px]">
                    {codexProbe.cwd.source} Â· {codexProbe.cwd.identity.kind}
                  </span>
                </span>
              </div>
            </>
          )}
        </div>

        {(codexAvailability.kind === "desktop_only" || codexAvailability.kind === "not_installed")
          && isWindowsElectron && (
          <div className="rounded-md border border-status-warning/30 bg-status-warning-muted/40 px-3.5 py-3 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-medium">
                  {isZh ? "åå¤å®è£ç¬ç« Codex CLI" : "Prepare the standalone Codex CLI"}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {t("runtime.codexRecoveryNoAutoRun")}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {t("runtime.codexRecoveryNpmHint")}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={codexRecoveryState === "preparing"}
                onClick={prepareCodexWindowsRecovery}
              >
                {codexRecoveryState === "preparing" && (
                  <SpinnerGap size={14} className="animate-spin" />
                )}
                {codexRecoveryState === "preparing"
                  ? t("runtime.codexRecoveryPreparing")
                  : t("runtime.codexRecoveryAction")}
              </Button>
            </div>
            {codexRecoveryState !== "idle" && codexRecoveryState !== "preparing" && (
              <p className={cn(
                "text-xs",
                codexRecoveryState === "error"
                  ? "text-destructive"
                  : "text-status-success-foreground",
              )} role="status">
                {codexRecoveryState === "ready"
                  ? codexRecoveryMethod === "npm"
                    ? t("runtime.codexRecoveryReadyNpm")
                    : t("runtime.codexRecoveryReady")
                  : codexRecoveryState === "copied_only"
                    ? t("runtime.codexRecoveryCopiedOnly")
                    : t("runtime.codexRecoveryFailed")}
              </p>
            )}
          </div>
        )}

        {/* Jump links to where account / models live â?keeps IA flat:
            Codex Account belongs in Providers, Codex Account models in
            Models, not duplicated inside this card. */}
        <div className="flex flex-wrap gap-2 justify-end">
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" asChild>
            <a href="/settings/providers">
              {isZh ? "æ¥ç Codex è´¦æ· â? : "View Codex account â?}
            </a>
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" asChild>
            <a href="/settings/models">
              {isZh ? "æ¥ç Codex æ¨¡å â? : "View Codex models â?}
            </a>
          </Button>
        </div>
      </RuntimeCard>

      {/* ââ CodePilot detail card ââââââââââââââââââââââââââââââââââââââ */}
      <RuntimeCard name="CodePilot" state={codepilotStatus.state} isZh={isZh}>
        <RuntimeStatusExplanation info={codepilotStatus} isZh={isZh} />

        {/* Capabilities / Permissions / Context â?three medium-granularity blocks */}
        <div className="rounded-md bg-muted/40 px-3.5 divide-y divide-border/50">
          <div className="py-2.5 flex items-start justify-between gap-3">
            <div className="flex flex-col gap-0.5 max-w-[55%]">
              <span className="text-xs font-medium">{isZh ? "è½å" : "Capabilities"}</span>
              <span className="text-[11px] text-muted-foreground leading-snug">
                {isZh
                  ? "åç½®å·¥å·ï¼Read / Edit / Bash ç­ï¼ï¼MCP å·¥å·éï¼Chrome DevTools / èªå®ä¹?Serverï¼ï¼æä»¶ / ç»ç«¯ / æµè§å¨å¨å¥æ¯æ?
                  : "Built-in tools (Read / Edit / Bash / etc.), MCP toolsets (Chrome DevTools / custom servers), full file / terminal / browser stack"}
              </span>
            </div>
            <span className="text-[10px] text-muted-foreground/70">
              {isZh ? "éåºç¨æ´æ? : "ships with app"}
            </span>
          </div>
          <div className="py-2.5 flex items-start justify-between gap-3">
            <div className="flex flex-col gap-0.5 max-w-[55%]">
              <span className="text-xs font-medium">{isZh ? "æé" : "Permissions"}</span>
              <span className="text-[11px] text-muted-foreground leading-snug">
                {isZh
                  ? "é»è®¤ exploreï¼è¯» + å®å¨å½ä»¤èªå¨ï¼å / å?/ ç½ç»éç¡®è®¤ï¼ï¼å¯åå?normal / trust / plan"
                  : "Defaults to Explore (auto for reads + safe commands; confirm before write / delete / network). Switchable to Normal / Trust / Plan."}
              </span>
            </div>
            <span className="text-[10px] text-muted-foreground/70">
              {isZh ? "ä¼è¯çº§æ§å? : "per-session"}
            </span>
          </div>
          <div className="py-2.5 flex items-start justify-between gap-3">
            <div className="flex flex-col gap-0.5 max-w-[55%]">
              <span className="text-xs font-medium">{isZh ? "ä¸ä¸æ? : "Context"}</span>
              <span className="text-[11px] text-muted-foreground leading-snug">
                {isZh
                  ? "CodePilot ç®¡çé¡¹ç®å·¥ä½åºãä¼è¯åå²ãæ¨¡åéæ©åæ¬å°ç¶æï¼èªå¨æ?token é¢ç®ä¿®åª / åç¼©"
                  : "CodePilot owns project workspace, session history, model choice, and local state; automatic token-budget prune + compress."}
              </span>
            </div>
            <span className="text-[10px] text-muted-foreground/70">
              {isZh ? "æ¬å°å­å¨" : "local"}
            </span>
          </div>
        </div>
      </RuntimeCard>

      {/* Confirmation dialog for settings.json saves */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("cli.confirmSaveTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("cli.confirmSaveDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => pendingSaveAction && handleSave(pendingSaveAction)}>
              {t("common.save")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Install wizard for Claude Code CLI */}
      {installWizardOpen && (
        <InstallWizardDialog
          open={installWizardOpen}
          onOpenChange={(open) => {
            setInstallWizardOpen(open);
            if (!open) invalidateAndRefresh();
          }}
          onInstallComplete={async () => {
            await invalidateAndRefresh();
            await fetch("/api/settings/app", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ settings: { cli_enabled: "true" } }),
            });
            setInstallWizardOpen(false);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Install wizard â?instructions dialog (matches the legacy implementation).
// Shows the official install command for the user's platform; user runs it
// in their terminal, then clicks "Done" to re-detect.
// ---------------------------------------------------------------------------

function InstallWizardDialog({
  open,
  onOpenChange,
  onInstallComplete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInstallComplete: () => void;
}) {
  const { t } = useTranslation();
  const isWindows = typeof navigator !== "undefined" && /Win/.test(navigator.userAgent);
  const installCommand = isWindows
    ? "irm https://claude.ai/install.ps1 | iex"
    : "curl -fsSL https://claude.ai/install.sh | bash";

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("cli.installTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("cli.installDesc")}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="my-3 rounded-md bg-muted p-3">
          <code className="text-xs font-mono select-all">{installCommand}</code>
        </div>
        <p className="text-xs text-muted-foreground">{t("cli.installAfter")}</p>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction onClick={onInstallComplete}>{t("cli.installDone")}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
