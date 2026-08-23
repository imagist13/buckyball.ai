"use client";

/**
 * Settings â?Overview â?the dashboard of the Settings shell.
 *
 * Three layers, top to bottom:
 *
 *   1. Getting Started checklist â?4 items (provider / models / runtime
 *      / workspace). Hidden once 4/4 done. Each pending item carries its
 *      own jump button so the user can pick whichever step they want.
 *   2. 6 status cards in a 2-col grid: Runtime, Providers, Models,
 *      Assistant Workspace, Update / About, Setup / Diagnostics. Cards
 *      that need attention pick up an accent (`status-warning-muted`),
 *      already-configured cards stay flat â?so the page no longer reads
 *      as "all uniform black tiles".
 *   3. Token usage heatmap â?GitHub-style 7ÃN grid + summary stats over
 *      the chosen 30 / 90 / 365 day window. Reuses `/api/usage/stats`.
 *
 * Resolution helpers (`computeEffectiveRuntime`, `resolveNewChatDefault`)
 * are reused from `src/lib/runtime/effective.ts` so this surface and
 * Settings â?Runtime always agree on which runtime is currently in
 * effect and what the next chat would resolve to.
 */

import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "@/hooks/useTranslation";
import { useAccountInfo } from "@/hooks/useAccountInfo";
import { useUpdate } from "@/hooks/useUpdate";
import { useClaudeStatus } from "@/hooks/useClaudeStatus";
import { Button } from "@/components/ui/button";
import { BuckyballIcon } from "@/components/ui/semantic-icon";
import {
  Plug,
  UserCircle,
  CheckCircle,
  Warning,
  ArrowsClockwise,
  Info,
} from "@/components/ui/icon";
import {
  computeEffectiveRuntime,
  runtimeDisplayLabel,
  type AgentRuntime,
} from "@/lib/runtime/effective";
import type { TranslationKey } from "@/i18n";
import { OverviewHeatmap } from "./OverviewHeatmap";
import { OverviewCard } from "./OverviewCard";
import {
  OverviewGettingStartedBar,
  type ChecklistItem,
} from "./OverviewGettingStartedBar";
import { useOverviewData } from "./useOverviewData";

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function OverviewSection() {
  const { t } = useTranslation();
  const isZh = t("nav.chats") === "å¯¹è¯";
  const state = useOverviewData();
  const { accountInfo } = useAccountInfo();
  const { updateInfo, checking, checkForUpdates } = useUpdate();
  const { status: claudeStatus } = useClaudeStatus();

  // Settings is a route-level split now (one page per /settings/<section>),
  // so cross-section jumps must go through the router or they only mutate
  // the URL hash without switching pages. Section IDs match the folder
  // names under src/app/settings/.
  const router = useRouter();
  const navToSection = useCallback((section: string) => {
    router.push(`/settings/${section}`);
  }, [router]);

  const cliConnected = !!claudeStatus?.connected;
  const effectiveRuntime: AgentRuntime = computeEffectiveRuntime(
    state.agentRuntime,
    state.cliEnabled,
    cliConnected,
  );
  const runtimeIsFallback =
    state.agentRuntime === "claude-code-sdk" && effectiveRuntime !== "claude-code-sdk";
  const runtimeLabel = runtimeDisplayLabel(effectiveRuntime);
  const claudeWarnings = !!(claudeStatus?.warnings && claudeStatus.warnings.length > 0);

  // Build the checklist. Tasks resolve once per render; once a task is
  // done it stays "done" until the underlying state changes â?no stuck-
  // checked rows.
  const checklist: ChecklistItem[] = useMemo(() => [
    {
      id: "connect-provider",
      label: t("overview.checklistConnectProvider" as TranslationKey),
      desc: t("overview.checklistConnectProviderDesc" as TranslationKey),
      done: state.providersConfigured > 0,
      actionLabel: t("overview.actionGoConfigure" as TranslationKey),
      onAction: () => navToSection("providers"),
    },
    {
      id: "enable-models",
      label: t("overview.checklistEnableModels" as TranslationKey),
      desc: t("overview.checklistEnableModelsDesc" as TranslationKey),
      // Only ask once a provider exists; "no provider" is covered above.
      done: state.providersConfigured === 0 || state.modelsEnabled > 0,
      actionLabel: t("overview.actionGoConfigure" as TranslationKey),
      onAction: () => navToSection("models"),
    },
    {
      id: "verify-runtime",
      label: t("overview.checklistVerifyRuntime" as TranslationKey),
      desc: t("overview.checklistVerifyRuntimeDesc" as TranslationKey),
      done: !runtimeIsFallback && !claudeWarnings,
      actionLabel: t("overview.actionGoConfigure" as TranslationKey),
      onAction: () => navToSection("runtime"),
    },
    {
      id: "configure-workspace",
      label: t("overview.checklistConfigureWorkspace" as TranslationKey),
      desc: t("overview.checklistConfigureWorkspaceDesc" as TranslationKey),
      done: state.workspaceConfigured,
      actionLabel: t("overview.actionGoConfigure" as TranslationKey),
      onAction: () => navToSection("assistant"),
    },
  ], [
    t, navToSection,
    state.providersConfigured,
    state.modelsEnabled,
    runtimeIsFallback,
    claudeWarnings,
    state.workspaceConfigured,
  ]);

  const allDone = checklist.every((c) => c.done);

  if (state.loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-8">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{t("settings.overview" as TranslationKey)}</h2>
          <p className="text-sm text-muted-foreground mt-1.5">
            {t("settings.overviewDesc" as TranslationKey)}
          </p>
        </div>
        <div className="rounded-lg border border-dashed border-border/50 bg-card/50 p-10 text-center">
          <p className="text-xs text-muted-foreground">{isZh ? "å è½½ä¸­â? : "Loadingâ?}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{t("settings.overview" as TranslationKey)}</h2>
        <p className="text-sm text-muted-foreground mt-1.5">
          {t("settings.overviewDesc" as TranslationKey)}
        </p>
      </div>

      {/* Top â?Getting Started checklist (hidden once everything done) */}
      {!allDone && (
        <OverviewGettingStartedBar items={checklist} isZh={isZh} t={t} />
      )}

      {/* Middle â?6 status cards in a 2-col grid.
          `md:` breakpoint kicks in at 768px so the dashboard shape lands at
          typical settings widths (in-app browser sidebar already eats ~240px,
          so the lg breakpoint was too late â?content area never got there). */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Card 1 â?Runtime status */}
        <OverviewCard
          icon={<BuckyballIcon name="runtime" size="md" strokeWidth={runtimeIsFallback ? undefined : 2} />}
          title={isZh ? "è¿è¡ç¯å¢" : "Runtime"}
          tone={runtimeIsFallback ? "warning" : "success"}
          primaryActionLabel={
            runtimeIsFallback
              ? isZh ? "å»æ§è¡å¼æä¿®å¤? : "Fix in Runtime"
              : isZh ? "ç®¡çæ§è¡å¼æ" : "Manage Runtime"
          }
          onPrimaryAction={() => navToSection("runtime")}
        >
          <p>
            <span className="text-muted-foreground">
              {isZh ? "å½åé»è®¤ï¼? : "Current default: "}
            </span>
            <span className="font-medium">{runtimeLabel}</span>
            {runtimeIsFallback && (
              <span className="ml-1 text-status-warning-foreground">
                {!state.cliEnabled
                  ? (isZh ? "ï¼CLI å·²ç¦ç¨ï¼èªå¨éçº§ï¼? : "(CLI disabled, fallback)")
                  : (isZh ? "ï¼Claude Code ä¸å¯ç¨ï¼èªå¨éçº§ï¼? : "(Claude Code unavailable, fallback)")}
              </span>
            )}
          </p>
          {claudeWarnings && (
            <p className="text-status-warning-foreground flex items-start gap-1">
              <Warning size={12} weight="fill" className="mt-0.5 shrink-0" />
              <span>{isZh ? "Claude Code æå¼å®¹æ§æç¤? : "Claude Code reports compatibility warnings"}</span>
            </p>
          )}
        </OverviewCard>

        {/* Card 2 â?Providers (provider count + new-chat default) */}
        <OverviewCard
          icon={<Plug size={16} />}
          title={isZh ? "æå¡å? : "Providers"}
          tone={state.noCompatibleProvider ? "warning" : "muted"}
          primaryActionLabel={isZh ? "ç®¡çæå¡å? : "Manage providers"}
          onPrimaryAction={() => navToSection("providers")}
        >
          <p>
            <span className="text-muted-foreground">
              {isZh ? "å·²æ¥å¥ï¼" : "Configured: "}
            </span>
            <span className="font-medium">{state.providersConfigured}</span>
          </p>
          {state.noCompatibleProvider ? (
            <p className="text-status-warning-foreground">
              {isZh
                ? `å½åæ§è¡å¼æï¼?{runtimeLabel}ï¼ä¸æ²¡æå¯ç¨ç?provider/modelã`
                : `No provider / model is compatible with the current runtime (${runtimeLabel}).`}
            </p>
          ) : (
            <>
              <p>
                <span className="text-muted-foreground">{isZh ? "é»è®¤æå¡åï¼" : "Default provider: "}</span>
                <span className="font-medium">
                  {state.defaultProviderName ?? (isZh ? "æªéç½? : "Not configured")}
                </span>
              </p>
              <p>
                <span className="text-muted-foreground">{isZh ? "é»è®¤æ¨¡åï¼? : "Default model: "}</span>
                <span className="font-medium">
                  {state.defaultModelLabel ?? (isZh ? "æªéç½? : "Not configured")}
                </span>
              </p>
            </>
          )}
        </OverviewCard>

        {/* Card 3 â?Models exposure */}
        <OverviewCard
          icon={<BuckyballIcon name="model" size="md" />}
          title={isZh ? "æ¨¡åæ´é²" : "Models exposure"}
          tone={state.modelsEnabled === 0 && state.providersConfigured > 0 ? "warning" : "muted"}
          primaryActionLabel={isZh ? "ç®¡çæ¨¡å" : "Manage models"}
          onPrimaryAction={() => navToSection("models")}
        >
          <p>
            <span className="text-muted-foreground">
              {isZh ? "å¯è§ / å¨é¨ï¼? : "Visible / total: "}
            </span>
            <span className="font-medium">
              {state.modelsEnabled} / {state.modelsTotal}
            </span>
          </p>
          {state.modelsEnabled === 0 && state.providersConfigured > 0 ? (
            <p className="text-status-warning-foreground">
              {isZh
                ? "ä½ å·²ç»æ¥å¥äºæå¡åï¼ä½æ²¡æä»»ä½æ¨¡åå¯¹ picker å¯è§ã?
                : "You've connected a provider, but no models are visible to the picker."}
            </p>
          ) : (state.modelsManualEnabled > 0 || state.modelsManualHidden > 0) ? (
            <p className="text-muted-foreground">
              {isZh
                ? `æå¨å¯ç¨ ${state.modelsManualEnabled} Â· æå¨éè ${state.modelsManualHidden}ï¼å·æ°ä¸ä¼è¦çï¼`
                : `${state.modelsManualEnabled} manually enabled Â· ${state.modelsManualHidden} manually hidden (preserved on refresh)`}
            </p>
          ) : null}
        </OverviewCard>

        {/* Card 4 â?Assistant Workspace */}
        <OverviewCard
          icon={<UserCircle size={16} />}
          title={isZh ? "å©çå·¥ä½ç©ºé´" : "Assistant Workspace"}
          tone={state.workspaceConfigured ? "success" : "warning"}
          primaryActionLabel={
            state.workspaceConfigured
              ? isZh ? "ç®¡çå©ç" : "Manage assistant"
              : isZh ? "å»éç½? : "Configure"
          }
          onPrimaryAction={() => navToSection("assistant")}
        >
          {state.workspaceConfigured ? (
            <p>
              <CheckCircle
                size={12}
                weight="fill"
                className="inline-block text-status-success-foreground mr-1 -mt-0.5"
              />
              {state.workspaceName
                ? (isZh ? `å·²éç½®ï¼${state.workspaceName}` : `Configured: ${state.workspaceName}`)
                : (isZh ? "å·²éç½®å·¥ä½ç©ºé? : "Workspace configured")}
            </p>
          ) : (
            <p className="text-muted-foreground">
              {isZh
                ? "å°æªéç½® â?è®¾å®ä¸ä¸ªæ¬å°å·¥ä½ç®å½å¼å§ä½¿ç¨å©ç?
                : "Not yet configured â?pick a local working directory to start"}
            </p>
          )}
        </OverviewCard>

        {/* Card 5 â?Update / About */}
        <OverviewCard
          icon={<Info size={16} />}
          title={isZh ? "çæ¬ä¸è´¦æ? : "Update & About"}
          tone={updateInfo?.updateAvailable ? "warning" : "success"}
          primaryActionLabel={isZh ? "æ¥çå³äº" : "View About"}
          onPrimaryAction={() => navToSection("about")}
          footer={
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2 gap-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={checkForUpdates}
              disabled={checking}
            >
              <ArrowsClockwise size={12} className={checking ? "animate-spin" : undefined} />
              {checking ? (isZh ? "æ£æ¥ä¸­â? : "Checkingâ?) : (isZh ? "æ£æ¥æ´æ? : "Check updates")}
            </Button>
          }
        >
          {updateInfo?.updateAvailable ? (
            <p className="text-status-warning-foreground flex items-start gap-1">
              <Warning size={12} weight="fill" className="mt-0.5 shrink-0" />
              <span>
                {isZh
                  ? `ææ°çæ¬ v${updateInfo.latestVersion} å¯ç¨`
                  : `Update available: v${updateInfo.latestVersion}`}
              </span>
            </p>
          ) : (
            <p className="text-muted-foreground">
              {checking
                ? (isZh ? "æ­£å¨æ£æ¥æ´æ°â? : "Checking for updatesâ?)
                : (isZh ? "å·²æ¯ææ°çæ? : "Up to date")}
            </p>
          )}
          {accountInfo?.email && (
            <p className="text-muted-foreground">
              {isZh ? "è´¦æ·ï¼? : "Account: "}
              <span className="text-foreground/85">{accountInfo.email}</span>
            </p>
          )}
        </OverviewCard>

        {/* Card 6 â?Health entry. Phase 2C.5 redirects this card from
            Setup Center to the new Health page, which is now the single
            "is anything wrong?" surface. Setup Center is still the
            wizard / repair flow but reaches it via Health, not directly
            from Overview, so the Overview index has one consistent
            answer for "where do I check status?". */}
        <OverviewCard
          // Swapped from Phosphor `<Heart weight="fill">` to the
          // BuckyballIcon `health` glyph (HugeIcons HeartCheck â?          // stroked). The other Overview cards already use stroked
          // BuckyballIcon glyphs (runtime / model / provider); the
          // filled Phosphor heart visually broke the row. The
          // health-vs-warning state is already conveyed by `tone` +
          // the warning copy below the card, so we don't need the
          // icon weight to carry that signal too.
          icon={<BuckyballIcon name="health" size="md" />}
          title={isZh ? "å¥åº·æ£æ? : "Health"}
          tone={claudeWarnings ? "warning" : "muted"}
          primaryActionLabel={isZh ? "å»å¥åº·æ£æ? : "Open Health"}
          onPrimaryAction={() => navToSection("health")}
        >
          {claudeWarnings ? (
            <p className="text-status-warning-foreground flex items-start gap-1">
              <Warning size={12} weight="fill" className="mt-0.5 shrink-0" />
              <span>
                {isZh
                  ? "æ£æµå° Claude Code å¼å®¹æ§æç¤ºï¼å»ºè®®å¨å¥åº·æ£æ¥é¡µæ¥ç"
                  : "Claude Code compatibility warnings detected â?see Health"}
              </span>
            </p>
          ) : (
            <p className="text-muted-foreground">
              {isZh
                ? "æå¡åè¿æ¥ãRuntimeãé»è®¤æ¨¡åãæ¨¡åæ´é²ãå·¥ä½ç©ºé´ç¶æä¸ç«å¼æ»è§"
                : "One-page overview of provider connectivity, runtime, default model, exposure, and workspace"}
            </p>
          )}
        </OverviewCard>
      </div>

      {/* Bottom â?Token usage activity heatmap */}
      <OverviewHeatmap isZh={isZh} onJumpToDetails={() => navToSection("usage")} />
    </div>
  );
}
