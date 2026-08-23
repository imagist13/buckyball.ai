/**
 * RuntimeCapabilityList â?Phase 5e Phase 3 (2026-05-18).
 *
 * Settings â?Runtime page sub-component that surfaces the capability
 * clipboard for each Runtime. Per user decision (B-Settings variant)
 * this is the ONLY place buckyball.ai tells the user "this engine
 * supports X but not Y â?switch to Z to enable Y" â?never a
 * chat-page banner.
 *
 * Phase 5e review round 7 (2026-05-18 user feedback) â?UI reads
 * **user-facing copy** from `capability-display-text.ts`. The
 * `capability-contract.ts` strings (`displayName`,
 * `deferredReason`, `statusLine`) are engineering identifiers and
 * MUST NOT leak into Settings â?words like "MCP" / "bridge not yet
 * implemented" / "permission round-trip design" / "Phase 5d slice 7"
 * are noise for the end user. The display layer keeps the user
 * vocabulary stable (çæ Widget / çæ¿æä½ / ...) while the
 * engineering contract evolves underneath.
 *
 * Phase 5e review round 7 also:
 *   - Removes the underline on the trigger (per user request).
 *   - Removes the explicit footer "Close" button (Radix Dialog
 *     ships its own corner X close button per
 *     `src/components/ui/dialog.tsx:53` â?having two close buttons
 *     was a "å¼¹çªå æé? smell).
 *   - Adds a Codex Account header note when codex_account is the
 *     active provider: Codexâs own plugins / Skills are managed by
 *     Codex itself; the list below ONLY describes buckyball.ai Harness
 *     injection, not Codex native capabilities.
 *
 * Design (sync'd with `docs/design.md` "Click-card â?detail dialog"
 * spec):
 *   - Trigger: ghost-style text button, no underline. Sits inside
 *     the engine card (round 7 user request) so the affordance is
 *     part of the card, not a sibling row.
 *   - Dialog: `sm:max-w-2xl max-h-[85vh] flex flex-col gap-0
 *     overflow-hidden`. Header + scrollable body, no custom footer.
 *
 * Data source is **derived** from `capability-matrix.ts` which
 * derives from `capability-contract.ts`. The contract test in
 * `harness-capability-matrix.test.ts` guarantees every cell shown
 * comes from the catalog.
 */

'use client';

import { useState, type MouseEvent } from 'react';
import { CheckCircle, Circle, XCircle } from '@/components/ui/icon';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { RuntimeId } from '@/lib/runtime/runtime-id';
import { getRuntimeDisplayName } from '@/lib/runtime/runtime-catalog';
import type { CapabilityMatrixCell } from '@/lib/harness/capability-matrix';
import {
  getCapabilityDisplay,
  buildUserReason,
  getCapabilityNote,
  CALLABLE_STATUS_LINE,
  CODEX_ACCOUNT_HEADER_NOTE,
  getUserExtensionsSummary,
  type UserExtensionsStatus,
} from '@/lib/harness/capability-display-text';

interface Props {
  readonly runtimeId: RuntimeId;
  readonly cells: readonly CapabilityMatrixCell[];
  readonly isZh: boolean;
  /** When the active default provider triggers a downgrade (e.g.
   *  codex_account on the Codex Runtime card), the parent passes a
   *  short sentence rendered inside the dialog header note slot. */
  readonly providerNote?: string;
  /** Round 7 user request â?trigger lives inside the picker card.
   *  Clicking it must NOT bubble into the picker's "switch default
   *  runtime" handler. */
  readonly stopPropagationOnTrigger?: boolean;
}

function statusIcon(status: CapabilityMatrixCell['status']) {
  switch (status) {
    case 'executable':
      return <CheckCircle size={14} weight="fill" className="text-status-success-foreground" />;
    case 'perception_only':
      return <Circle size={14} className="text-status-warning-foreground" />;
    case 'unavailable':
      return <XCircle size={14} weight="fill" className="text-muted-foreground" />;
    case 'undetermined':
      return <Circle size={14} className="text-muted-foreground/60" />;
  }
}

function userExtensionsStatusIcon(status: UserExtensionsStatus) {
  switch (status) {
    case 'executable':
      return <CheckCircle size={14} weight="fill" className="text-status-success-foreground" />;
    case 'partial':
      // Same warning tone as perception_only â?"some pieces work, some
      // don't" still means the user shouldn't expect every kind to be
      // callable here.
      return <Circle size={14} className="text-status-warning-foreground" />;
    case 'perception_only':
      return <Circle size={14} className="text-status-warning-foreground" />;
  }
}

function userExtensionsBadge(status: UserExtensionsStatus, isZh: boolean): { label: string; cls: string } {
  if (isZh) {
    switch (status) {
      case 'executable':
        return { label: 'å¨é¨å¯ç¨', cls: 'bg-status-success-muted text-status-success-foreground' };
      case 'partial':
        return { label: 'é¨åå¯ç¨', cls: 'bg-status-warning-muted text-status-warning-foreground' };
      case 'perception_only':
        return { label: 'ä¸å¯è°ç¨', cls: 'bg-status-warning-muted text-status-warning-foreground' };
    }
  }
  switch (status) {
    case 'executable':
      return { label: 'All wired', cls: 'bg-status-success-muted text-status-success-foreground' };
    case 'partial':
      return { label: 'Partial', cls: 'bg-status-warning-muted text-status-warning-foreground' };
    case 'perception_only':
      return { label: 'Not callable', cls: 'bg-status-warning-muted text-status-warning-foreground' };
  }
}

function statusLabel(status: CapabilityMatrixCell['status'], isZh: boolean): string {
  if (isZh) {
    switch (status) {
      case 'executable':
        return 'å¯è°ç?;
      case 'perception_only':
        return 'ä¸å¯è°ç¨';
      case 'unavailable':
        return 'ä¸æ¯æ?;
      case 'undetermined':
        return 'æªç¡®å®?;
    }
  }
  switch (status) {
    case 'executable':
      return 'Callable';
    case 'perception_only':
      return 'Not callable here';
    case 'unavailable':
      return 'Unsupported';
    case 'undetermined':
      return 'Undetermined';
  }
}

function trustBoundaryLabel(
  boundary: NonNullable<CapabilityMatrixCell['trustBoundary']>,
  isZh: boolean,
): string {
  if (isZh) {
    switch (boundary) {
      case 'auto_safe':
        return 'èªå¨æ§è¡';
      case 'requires_approval':
        return 'éæ¹å';
      case 'side_effect':
        return 'ä¼è§¦åéç¥';
      case 'mixed':
        return 'é¨åéæ¹å';
    }
  }
  switch (boundary) {
    case 'auto_safe':
      return 'Auto';
    case 'requires_approval':
      return 'Approval';
    case 'side_effect':
      return 'Side effect';
    case 'mixed':
      return 'Mixed';
  }
}

function trustBoundaryClass(
  boundary: NonNullable<CapabilityMatrixCell['trustBoundary']>,
): string {
  switch (boundary) {
    case 'auto_safe':
      return 'bg-muted text-muted-foreground';
    case 'requires_approval':
      return 'bg-status-warning-muted text-status-warning-foreground';
    case 'side_effect':
      return 'bg-status-info-muted text-status-info-foreground';
    case 'mixed':
      return 'bg-status-warning-muted/60 text-status-warning-foreground';
  }
}

function runtimeLabel(runtimeId: RuntimeId, isZh: boolean): string {
  return getRuntimeDisplayName(runtimeId, isZh ? 'zh' : 'en');
}

export function RuntimeCapabilityList({
  runtimeId,
  cells,
  isZh,
  providerNote,
  stopPropagationOnTrigger,
}: Props) {
  const [open, setOpen] = useState(false);
  const executableCount = cells.filter((c) => c.status === 'executable').length;
  const totalCount = cells.length;
  const lang: 'zh' | 'en' = isZh ? 'zh' : 'en';

  const handleTriggerClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (stopPropagationOnTrigger) {
      // Round 7 â?trigger is hosted inside the EnginePickerCard
      // click surface; without stopPropagation a click would both
      // open the dialog AND switch the default runtime.
      e.stopPropagation();
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          onClick={handleTriggerClick}
          data-testid={`runtime-capability-trigger-${runtimeId}`}
          className={cn(
            'inline-flex items-center gap-1 px-2 py-1 rounded text-[11px]',
            'text-muted-foreground hover:text-foreground hover:bg-muted/60',
            'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          {isZh
            ? `æ¥çè½åæ¸åï¼?{executableCount} / ${totalCount}ï¼`
            : `View capabilities (${executableCount} / ${totalCount})`}
        </button>
      </DialogTrigger>
      <DialogContent
        className="sm:max-w-2xl max-h-[85vh] flex flex-col gap-0 overflow-hidden"
        data-testid={`runtime-capability-dialog-${runtimeId}`}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {isZh ? 'è½åæ¯ææ¸å' : 'Capability support'} â?{runtimeLabel(runtimeId, isZh)}
          </DialogTitle>
          <DialogDescription>
            {isZh
              ? `è¿éåªå±ç¤?buckyball.ai æä¾çåç½?Harness è½åãå¼æèªèº«çåçå·¥å·ï¼ä¾å¦?Codex ç?plugins / shellãClaudeCode ç?hooksï¼ç±å¯¹åºå¼æç®¡çï¼ä¸å¨æ­¤åã`
              : `This list only covers CodePilotâs built-in Harness capabilities. Each engineâs own native tools (Codex plugins / shell, ClaudeCode hooks, etc.) are managed by that engine and not shown here.`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto mt-4 space-y-3">
          {providerNote && (
            <p
              data-testid={`provider-note-${runtimeId}`}
              className="text-[11px] leading-snug text-status-warning-foreground bg-status-warning-muted/60 rounded px-3 py-2"
            >
              {providerNote}
            </p>
          )}

          <h4 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mt-1">
            {isZh ? 'buckyball.ai åç½®è½å' : 'Built-in capabilities'}
          </h4>
          <ul className="flex flex-col gap-2">
            {cells.map((cell) => {
              const display = getCapabilityDisplay(cell.capabilityId);
              const label = display?.label[lang] ?? cell.capabilityId;
              const desc = display?.description?.[lang];
              const userStatusLine =
                cell.status === 'executable'
                  ? CALLABLE_STATUS_LINE[lang]
                  : buildUserReason({
                      capabilityId: cell.capabilityId,
                      currentRuntime: runtimeId,
                      suggestedRuntimes: cell.suggestedRuntime ? [cell.suggestedRuntime] : [],
                      lang,
                    });
              return (
                <li
                  key={cell.capabilityId}
                  data-testid={`capability-row-${runtimeId}-${cell.capabilityId}`}
                  data-status={cell.status}
                  data-trust-boundary={cell.trustBoundary ?? ''}
                  className="flex items-start gap-2.5 text-xs"
                >
                  <span className="shrink-0 mt-0.5">{statusIcon(cell.status)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={cn(
                          'font-medium leading-tight',
                          cell.status === 'executable' ? 'text-foreground' : 'text-foreground/70',
                        )}
                      >
                        {label}
                      </span>
                      <span
                        className={cn(
                          'text-[10px] px-1.5 py-0.5 rounded tracking-wide',
                          cell.status === 'executable' && 'bg-status-success-muted text-status-success-foreground',
                          cell.status === 'perception_only' && 'bg-status-warning-muted text-status-warning-foreground',
                          cell.status === 'unavailable' && 'bg-muted text-muted-foreground',
                          cell.status === 'undetermined' && 'bg-muted text-muted-foreground',
                        )}
                      >
                        {statusLabel(cell.status, isZh)}
                      </span>
                      {cell.status === 'executable' && cell.trustBoundary && (
                        <span
                          data-testid={`trust-badge-${runtimeId}-${cell.capabilityId}`}
                          className={cn(
                            'text-[10px] px-1.5 py-0.5 rounded tracking-wide',
                            trustBoundaryClass(cell.trustBoundary),
                          )}
                        >
                          {trustBoundaryLabel(cell.trustBoundary, isZh)}
                        </span>
                      )}
                    </div>
                    {desc && (
                      <p className="mt-0.5 text-[11px] text-muted-foreground/85 leading-snug">
                        {desc}
                      </p>
                    )}
                    {cell.status !== 'executable' && (
                      <p className="mt-0.5 text-[11px] text-muted-foreground leading-snug">
                        {userStatusLine}
                      </p>
                    )}
                    {cell.noteKey && getCapabilityNote(cell.noteKey, lang) && (
                      <p
                        data-testid={`capability-note-${runtimeId}-${cell.capabilityId}`}
                        className="mt-0.5 text-[11px] text-muted-foreground leading-snug"
                      >
                        {getCapabilityNote(cell.noteKey, lang)}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          {/* Phase 5e round 8 (2026-05-18) â?user-extensions section.
              Built-in capabilities above describe buckyball.ai's first-
              party tools; this section describes whether user-defined
              MCP servers / Skills / slash commands / workspace rules
              are honored on the current Runtime. Kept as a separate
              section (not part of the matrix above) because user
              extensions are dynamic and outside the engineering
              HARNESS_CAPABILITIES catalog. */}
          {(() => {
            const summary = getUserExtensionsSummary(runtimeId);
            const badge = userExtensionsBadge(summary.status, isZh);
            return (
              <div className="mt-4 pt-3 border-t border-border/40">
                <h4 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {isZh ? 'ç¨æ·èªå®ä¹? : 'User extensions'}
                </h4>
                <div
                  data-testid={`user-extensions-row-${runtimeId}`}
                  data-status={summary.status}
                  className="mt-2 flex items-start gap-2.5 text-xs"
                >
                  <span className="shrink-0 mt-0.5">{userExtensionsStatusIcon(summary.status)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={cn(
                          'font-medium leading-tight',
                          summary.status === 'executable' ? 'text-foreground' : 'text-foreground/70',
                        )}
                      >
                        {summary.label[lang]}
                      </span>
                      <span
                        className={cn(
                          'text-[10px] px-1.5 py-0.5 rounded tracking-wide',
                          badge.cls,
                        )}
                      >
                        {badge.label}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground/85 leading-snug">
                      {summary.description[lang]}
                    </p>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Standalone export for the Codex Account note so RuntimePanel can
 *  pick the right copy without importing the bilingual constant
 *  directly. */
export function codexAccountHeaderNote(isZh: boolean): string {
  return isZh ? CODEX_ACCOUNT_HEADER_NOTE.zh : CODEX_ACCOUNT_HEADER_NOTE.en;
}
