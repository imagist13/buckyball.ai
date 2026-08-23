"use client";

/**
 * Settings â?Health â?read-only daily health overview.
 *
 * Phase 2C.5. Health is the *æ¥å¸¸é®é¢å®ä½* page, not a wizard. It does
 * not run probes on its own and does not write anything; instead it
 * reuses the data the rest of Settings already pulls (`useOverviewData`,
 * `useClaudeStatus`, the runtime resolver) and surfaces five concerns
 * in one place:
 *
 *   1. Provider connectivity
 *   2. æ§è¡å¼æ / CLI
 *   3. Default model validity
 *   4. Models exposure
 *   5. Assistant workspace / local environment
 *
 * Each row shows status + åå  + å½±å + a single primary CTA. Live
 * probes / repair flows stay with Setup Center; Provider Doctor stays
 * with Providers. Health is the index â?it points the user at the
 * right specialist surface, it doesn't try to be one.
 */

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/hooks/useTranslation";
import { useClaudeStatus } from "@/hooks/useClaudeStatus";
import { Button } from "@/components/ui/button";
import {
  CheckCircle,
  Warning,
  XCircle,
  Plug,
  UserCircle,
  CaretRight,
  Info,
} from "@/components/ui/icon";
import { BuckyballIcon } from "@/components/ui/semantic-icon";
import { cn } from "@/lib/utils";
import { useOverviewData } from "./useOverviewData";
import type { TranslationKey } from "@/i18n";

type Severity = "ok" | "warn" | "error";

interface HealthRow {
  id: string;
  icon: React.ReactNode;
  title: string;
  severity: Severity;
  reason: string;
  impact?: string;
  ctaLabel: string;
  ctaOnClick: () => void;
}

const SEVERITY_DOT: Record<Severity, string> = {
  ok: "bg-status-success-foreground",
  warn: "bg-status-warning-foreground",
  error: "bg-destructive",
};

const SEVERITY_ICON: Record<Severity, React.ReactNode> = {
  ok: <CheckCircle size={14} weight="fill" className="text-status-success-foreground shrink-0" />,
  warn: <Warning size={14} weight="fill" className="text-status-warning-foreground shrink-0" />,
  error: <XCircle size={14} weight="fill" className="text-destructive shrink-0" />,
};

export function HealthSection() {
  const { t } = useTranslation();
  const isZh = t("nav.chats") === "å¯¹è¯";
  const state = useOverviewData();
  const { status: claudeStatus } = useClaudeStatus();
  // Settings is route-level split â?cross-section CTAs must router.push
  // a route path; otherwise clicking a Health row only mutates the URL
  // hash without switching pages. See `settings-link-migration.test.ts`.
  const router = useRouter();
  const navToSection = useCallback((section: string) => {
    router.push(`/settings/${section}`);
  }, [router]);

  // While `useOverviewData` is still hydrating its first fetch, every
  // counter sits at the initial-state default (0). Rendering health
  // rows on those zeros would falsely report "no providers / no
  // models" for ~200ms after mount; show a loading shell until the
  // first fetch resolves.
  if (state.loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-8">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">
            {t("settings.health" as TranslationKey)}
          </h2>
          <p className="text-sm text-muted-foreground mt-1.5">
            {t("settings.healthDesc" as TranslationKey)}
          </p>
        </div>
        <div className="rounded-lg border border-dashed border-border/50 bg-card/50 p-10 text-center">
          <p className="text-xs text-muted-foreground">{isZh ? "å è½½ä¸­â? : "Loadingâ?}</p>
        </div>
      </div>
    );
  }

  const rows: HealthRow[] = [];

  // ââ 1. Provider connectivity âââââââââââââââââââââââââââââââââ
  rows.push((() => {
    const count = state.providersConfigured;
    if (count === 0) {
      return {
        id: "providers",
        icon: <Plug size={16} />,
        title: isZh ? "æå¡åè¿æ? : "Provider connectivity",
        severity: "error",
        reason: isZh ? "å°æªéç½®ä»»ä½ provider" : "No providers configured",
        impact: isZh
          ? "chat æ æ³åé?â?éè¦è³å°æ·»å ä¸ä¸?provider"
          : "Chat cannot start without a connected provider",
        ctaLabel: isZh ? "å?Providers" : "Open Providers",
        ctaOnClick: () => navToSection("providers"),
      };
    }
    return {
      id: "providers",
      icon: <Plug size={16} />,
      title: isZh ? "æå¡åè¿æ? : "Provider connectivity",
      severity: "ok",
      reason: isZh
        ? `å·²éç½?${count} ä¸?provider`
        : `${count} provider${count === 1 ? "" : "s"} configured`,
      // Phase 2C.6 follow-up: the CTA was "è¿è¡è¯æ­" but it just
      // navigated to #providers (Provider Doctor lives behind a
      // separate button there). Renaming to match the actual destination
      // â?the doctor flow is no longer the headline action since
      // health/issue-filing is now log-driven, not auto-diagnose-driven.
      ctaLabel: isZh ? "æ¥ç Providers" : "Open Providers",
      ctaOnClick: () => navToSection("providers"),
    };
  })());

  // ââ 2. æ§è¡å¼æ / CLI âââââââââââââââââââââââââââââââââââââââââ
  rows.push((() => {
    const cliConnected = !!claudeStatus?.connected;
    const cliEnabled = state.cliEnabled;
    const warnCount = claudeStatus?.warnings?.length ?? 0;

    if (state.agentRuntime === "claude-code-sdk" && !cliEnabled) {
      return {
        id: "runtime",
        icon: <BuckyballIcon name="runtime" size="md" />,
        title: isZh ? "æ§è¡å¼æ / CLI" : "æ§è¡å¼æ / CLI",
        severity: "warn",
        reason: isZh
          ? "Claude Code CLI å·²ç¦ç¨ï¼è¿è¡æ¶å·²éçº§å?CodePilot"
          : "Claude Code CLI disabled â?runtime fell back to CodePilot",
        impact: isZh
          ? "ä»?CodePilot å¼å®¹çæå¡å/æ¨¡åå¯æ§è¡?
          : "Only CodePilot-compatible providers/models will run",
        ctaLabel: isZh ? "å»æ§è¡å¼æ? : "Open Runtime",
        ctaOnClick: () => navToSection("runtime"),
      };
    }
    if (state.agentRuntime === "claude-code-sdk" && !cliConnected) {
      return {
        id: "runtime",
        icon: <BuckyballIcon name="runtime" size="md" />,
        title: isZh ? "æ§è¡å¼æ / CLI" : "æ§è¡å¼æ / CLI",
        severity: "error",
        reason: isZh
          ? "Claude Code CLI æªæ£æµå°ï¼è¿è¡æ¶å·²éçº?
          : "Claude Code CLI not detected â?runtime fell back",
        impact: isZh
          ? "æ°ä¼è¯ä½¿ç?CodePilotï¼ä½ Claude Code ä¸å±è½åä¸å¯ç?
          : "New chats use CodePilot; Claude Code-only features are unavailable",
        ctaLabel: isZh ? "å»æ§è¡å¼æ? : "Open Runtime",
        ctaOnClick: () => navToSection("runtime"),
      };
    }
    if (warnCount > 0) {
      return {
        id: "runtime",
        icon: <BuckyballIcon name="runtime" size="md" />,
        title: isZh ? "æ§è¡å¼æ / CLI" : "æ§è¡å¼æ / CLI",
        severity: "warn",
        reason: isZh
          ? `Claude Code æ¥å ${warnCount} æ¡å¼å®¹æ§æç¤º`
          : `Claude Code reports ${warnCount} compatibility warning${warnCount === 1 ? "" : "s"}`,
        ctaLabel: isZh ? "å»æ§è¡å¼æ? : "Open Runtime",
        ctaOnClick: () => navToSection("runtime"),
      };
    }
    return {
      id: "runtime",
      icon: <BuckyballIcon name="runtime" size="md" strokeWidth={2} />,
      title: isZh ? "æ§è¡å¼æ / CLI" : "æ§è¡å¼æ / CLI",
      severity: "ok",
      reason: state.agentRuntime === "claude-code-sdk"
        ? (isZh ? "Claude Code å·²å°±ç»? : "Claude Code ready")
        : (isZh ? "CodePilot å·²å°±ç»? : "CodePilot ready"),
      ctaLabel: isZh ? "å»æ§è¡å¼æ? : "Open Runtime",
      ctaOnClick: () => navToSection("runtime"),
    };
  })());

  // ââ 3. Default model validity ââââââââââââââââââââââââââââââââ
  rows.push((() => {
    if (state.noCompatibleProvider) {
      return {
        id: "default-model",
        icon: <BuckyballIcon name="model" size="md" />,
        title: isZh ? "é»è®¤æ¨¡åæææ? : "Default model validity",
        severity: "error",
        reason: isZh
          ? "å½åæ§è¡å¼æ ä¸æ²¡æå¯ç?provider/model"
          : "No compatible provider under current Runtime",
        impact: isZh
          ? "æ°ä¼è¯è¿å?æ å¼å®¹æå?ç¶æï¼æ æ³åé?
          : "New chats land in the 'no compatible provider' state",
        ctaLabel: isZh ? "å»æ§è¡å¼æ? : "Open Runtime",
        ctaOnClick: () => navToSection("runtime"),
      };
    }
    if (state.defaultInvalid) {
      const provDisplay = state.defaultProviderName ?? "?";
      const modelDisplay = state.defaultModelLabel ?? "?";
      // #27: pin-incomplete = åºå®ä¿¡æ¯åæªï¼ç¼º provider ç»å®ï¼ï¼æ¨¡åæ¬èº«å¯ç¨ï¼?      // ä¸æ¯ Runtime å¼å®¹é®é¢ãå¶ä½ï¼provider/model-missingï¼ææ¯åºå®ç®æ ä¸å?      // å½åå¼æå¯è¾¾èå´ãä¸¤èé½æ?*éé»æ?*ï¼chat ä¼èªå?fallbackï¼ï¼ç»ä¸éä¸º
      // warningï¼ä¸åè¯´"é»æ­"ââä¸ RuntimePanel banner å£å¾ä¸è´ã?      if (state.defaultInvalidReason === "pin-incomplete") {
        return {
          id: "default-model",
          icon: <BuckyballIcon name="model" size="md" />,
          title: isZh ? "é»è®¤æ¨¡åæææ? : "Default model validity",
          severity: "warn",
          reason: isZh
            ? "é»è®¤æ¨¡ååºå®ä¿¡æ¯ä¸å®æ´ï¼ç¼?provider ç»å®ï¼?
            : "Pinned default is incomplete (missing provider binding)",
          impact: isZh
            ? "æ°ä¼è¯ä¼èªå¨ä½¿ç¨å½åç¯å¢ä¸çå¯ç¨æ¨¡åï¼å°ãæ¨¡åãé¡µéæ°åºå®å³å¯"
            : "New chats auto-use an available model; re-pin in Models to fix",
          ctaLabel: isZh ? "å?Models" : "Open Models",
          ctaOnClick: () => navToSection("models"),
        };
      }
      return {
        id: "default-model",
        icon: <BuckyballIcon name="model" size="md" />,
        title: isZh ? "é»è®¤æ¨¡åæææ? : "Default model validity",
        severity: "warn",
        reason: isZh
          ? `å·²åºå®?${provDisplay} / ${modelDisplay} â?ä¸å¨å½åæ§è¡å¼æçå¼å®¹èå´å`
          : `Pinned ${provDisplay} / ${modelDisplay} â?not compatible with the current Runtime`,
        impact: isZh
          ? "æ°ä¼è¯ä¼èªå¨ä½¿ç¨å½åç¯å¢ä¸çå¯ç¨æ¨¡åï¼å¯å»ãæ¨¡åãé¡µæ¹é»è®¤æåå Auto"
          : "New chats fall back to an available model; change the default in Models or revert to Auto",
        ctaLabel: isZh ? "å?Models" : "Open Models",
        ctaOnClick: () => navToSection("models"),
      };
    }
    if (state.defaultMode === "pinned") {
      return {
        id: "default-model",
        icon: <BuckyballIcon name="model" size="md" />,
        title: isZh ? "é»è®¤æ¨¡åæææ? : "Default model validity",
        severity: "ok",
        reason: isZh
          ? `å·²åºå®?${state.defaultProviderName ?? "?"} / ${state.defaultModelLabel ?? "?"}`
          : `Pinned ${state.defaultProviderName ?? "?"} / ${state.defaultModelLabel ?? "?"}`,
        ctaLabel: isZh ? "å?Models" : "Open Models",
        ctaOnClick: () => navToSection("models"),
      };
    }
    return {
      id: "default-model",
      icon: <BuckyballIcon name="model" size="md" />,
      title: isZh ? "é»è®¤æ¨¡åæææ? : "Default model validity",
      severity: "ok",
      reason: isZh
        ? `Auto â?å½åè§£æå?${state.defaultProviderName ?? "?"} / ${state.defaultModelLabel ?? "?"}`
        : `Auto â?currently resolves to ${state.defaultProviderName ?? "?"} / ${state.defaultModelLabel ?? "?"}`,
      ctaLabel: isZh ? "å?Models" : "Open Models",
      ctaOnClick: () => navToSection("models"),
    };
  })());

  // ââ 4. Models exposure âââââââââââââââââââââââââââââââââââââââ
  rows.push((() => {
    if (state.providersConfigured === 0) {
      return {
        id: "models-exposure",
        icon: <BuckyballIcon name="model" size="md" />,
        title: isZh ? "æ¨¡åæ´é²" : "Models exposure",
        severity: "ok",
        reason: isZh
          ? "å°æªéç½® provider â?è¯¦è§ä¸æ¹"
          : "No providers configured yet â?see above",
        ctaLabel: isZh ? "å?Models" : "Open Models",
        ctaOnClick: () => navToSection("models"),
      };
    }
    if (state.modelsEnabled === 0) {
      return {
        id: "models-exposure",
        icon: <BuckyballIcon name="model" size="md" />,
        title: isZh ? "æ¨¡åæ´é²" : "Models exposure",
        severity: "error",
        reason: isZh
          ? "å·²æ¥å?providerï¼ä½æ²¡æä»»ä½æ¨¡åå¯?picker å¯è§"
          : "Providers connected, but no models visible to the picker",
        impact: isZh
          ? "chat picker ä¸ºç©ºï¼æ æ³éæ©æ¨¡å"
          : "Chat picker is empty",
        ctaLabel: isZh ? "å?Models" : "Open Models",
        ctaOnClick: () => navToSection("models"),
      };
    }
    const manualNote = (state.modelsManualEnabled > 0 || state.modelsManualHidden > 0)
      ? (isZh
          ? `ï¼æå¨å¯ç?${state.modelsManualEnabled} Â· æå¨éè ${state.modelsManualHidden}ï¼`
          : ` (${state.modelsManualEnabled} manual on Â· ${state.modelsManualHidden} manual off)`)
      : "";
    return {
      id: "models-exposure",
      icon: <BuckyballIcon name="model" size="md" />,
      title: isZh ? "æ¨¡åæ´é²" : "Models exposure",
      severity: "ok",
      reason: isZh
        ? `${state.modelsEnabled} / ${state.modelsTotal} ä¸ªæ¨¡åå·²å¯?picker æ´é²${manualNote}`
        : `${state.modelsEnabled} of ${state.modelsTotal} models exposed to picker${manualNote}`,
      ctaLabel: isZh ? "å?Models" : "Open Models",
      ctaOnClick: () => navToSection("models"),
    };
  })());

  // ââ 5. Assistant workspace / local environment âââââââââââââââ
  rows.push((() => {
    if (state.workspaceConfigured) {
      return {
        id: "workspace",
        icon: <UserCircle size={16} />,
        title: isZh ? "å©çå·¥ä½ç©ºé´" : "Assistant workspace",
        severity: "ok",
        reason: state.workspaceName
          ? (isZh ? `å·²éç½®ï¼${state.workspaceName}` : `Configured: ${state.workspaceName}`)
          : (isZh ? "å·²éç½®å·¥ä½ç©ºé? : "Workspace configured"),
        ctaLabel: isZh ? "å»å©ç? : "Open Assistant",
        ctaOnClick: () => navToSection("assistant"),
      };
    }
    return {
      id: "workspace",
      icon: <UserCircle size={16} />,
      title: isZh ? "å©çå·¥ä½ç©ºé´" : "Assistant workspace",
      severity: "warn",
      reason: isZh ? "å°æªéç½®å©çå·¥ä½ç©ºé´" : "Assistant workspace not configured",
      impact: isZh
        ? "å©çæ æ³å¨æ¬å°ç®å½ä¸åä½"
        : "Assistant cannot collaborate on local files",
      ctaLabel: isZh ? "å»å©ç? : "Open Assistant",
      ctaOnClick: () => navToSection("assistant"),
    };
  })());

  // Overall severity = max across rows.
  const overallSeverity: Severity = rows.reduce<Severity>((acc, r) => {
    if (r.severity === "error") return "error";
    if (r.severity === "warn" && acc === "ok") return "warn";
    return acc;
  }, "ok");

  const overallTone =
    overallSeverity === "ok"
      ? (isZh ? "ä¸åæ­£å¸? : "All systems healthy")
      : overallSeverity === "warn"
        ? (isZh ? "å­å¨ 1 é¡¹ä»¥ä¸æç¤? : "One or more warnings")
        : (isZh ? "å­å¨é»å¡é®é¢" : "Blocking issues detected");

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight">
            {t("settings.health" as TranslationKey)}
          </h2>
          <p className="text-sm text-muted-foreground mt-1.5">
            {t("settings.healthDesc" as TranslationKey)}
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <span className={cn("size-1.5 rounded-full", SEVERITY_DOT[overallSeverity])} />
          <span className="text-[11px] text-muted-foreground">{overallTone}</span>
        </div>
      </div>

      {/* 5 rows of health checks */}
      <div className="rounded-lg border border-border/50 bg-card divide-y divide-border/50 overflow-hidden">
        {rows.map((row) => (
          <HealthRowItem key={row.id} row={row} />
        ))}
      </div>

      {/* "Need to investigate further?" â?Phase 2C.6 reframing. The
          previous wording ("æ·±åº¦è¯æ­ä¸ä¿®å¤?) promised auto-detection of
          root causes and an auto-repair path; in practice the doctor
          can't always identify the root cause and "repair" sometimes
          misleads. Honest framing: Health gives status; if status
          doesn't explain it, grab a diagnostic bundle and inspect /
          share. Setup Center stays an entry on the About page (as the
          install / wizard flow), not the headline action here. */}
      <div className="rounded-lg border border-border/50 bg-card p-5 flex flex-col sm:flex-row items-start sm:items-center sm:justify-between gap-3">
        <div className="min-w-0 flex items-start gap-3">
          <Info size={16} className="text-foreground/60 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <h3 className="text-sm font-medium">
              {isZh ? "éè¦è¿ä¸æ­¥ææ¥ï¼" : "Need to investigate further?"}
            </h3>
            <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
              {isZh
                ? "å¦æä¸æ¹ç¶ææ²¡æè§£éä½ éå°çé®é¢ï¼å?å³äº é¡µé¢å¯¼åºè¯æ­åï¼éé¢åå«è¿è¡æ¥å¿ãprovider è§£æé¾ä¸è¿æ¥æ¢æµç»æï¼ä¾¿äºæ¬å°ææ¥æé?issue ä¸èµ·åé¦ã?
                : "If the rows above don't explain what you're seeing, head to About to export a diagnostic bundle â?it includes runtime logs, the provider-resolution chain, and probe results for local investigation or issue filing."}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 gap-1.5"
          onClick={() => navToSection("about")}
        >
          {isZh ? "å?About" : "Open About"}
          <CaretRight size={12} weight="bold" />
        </Button>
      </div>
    </div>
  );
}

function HealthRowItem({ row }: { row: HealthRow }) {
  return (
    <div className="px-4 py-3.5 flex items-start gap-3">
      <span className="shrink-0 mt-1 text-foreground/60">{row.icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {SEVERITY_ICON[row.severity]}
          <h3 className="text-sm font-medium leading-tight">{row.title}</h3>
        </div>
        <p className="text-xs text-foreground/85 mt-1 leading-relaxed">{row.reason}</p>
        {row.impact && (
          <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
            {row.impact}
          </p>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="shrink-0 gap-1 text-xs text-muted-foreground hover:text-foreground"
        onClick={row.ctaOnClick}
      >
        {row.ctaLabel}
        <CaretRight size={12} weight="bold" />
      </Button>
    </div>
  );
}
