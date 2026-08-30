"use client";

import {
  CaretDown,
  CaretRight,
  FolderMinus,
  DotsThree,
  ArrowSquareOut,
} from "@/components/ui/icon";
import { CodePilotIcon } from "@/components/ui/semantic-icon";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { useTranslation } from '@/hooks/useTranslation';
import { copyWithToast } from "@/lib/clipboard";
import type { TranslationKey } from "@/i18n";
import { useState } from "react";
import { SPECIES_IMAGE_URL, EGG_IMAGE_URL, type Species } from "@/lib/buddy";

interface ProjectGroupHeaderProps {
  workingDirectory: string;
  sessionId: string;
  displayName: string;
  isCollapsed: boolean;
  isFolderHovered: boolean;
  isWorkspace: boolean;
  /** Hide the caret/chevron prefix (Codex-style flat folders, expansion indicated by Folder/FolderOpen icon swap only). */
  hideCaret?: boolean;
  onToggle: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onCreateSession: (e: React.MouseEvent) => void;
  onRemoveProject?: (workingDirectory: string) => void;
  assistantName?: string;
  assistantMemoryCount?: number;
  lastHeartbeatDate?: string;
  buddyEmoji?: string;
  buddyName?: string;
  buddySpecies?: string;
}

export function ProjectGroupHeader({
  workingDirectory,
  sessionId,
  displayName,
  isCollapsed,
  isFolderHovered,
  isWorkspace,
  hideCaret = false,
  onToggle,
  onMouseEnter,
  onMouseLeave,
  onCreateSession,
  onRemoveProject,
  assistantName,
  assistantMemoryCount,
  lastHeartbeatDate,
  buddyEmoji,
  buddyName,
  buddySpecies,
}: ProjectGroupHeaderProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const showActions = isFolderHovered || menuOpen;

  const handleOpenFolder = () => {
    if (window.electronAPI?.shell?.revealPath) {
      void window.electronAPI.shell.revealPath({ path: workingDirectory, sessionId });
    } else {
      fetch('/api/files/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: workingDirectory, sessionId }),
      }).catch(() => {});
    }
  };

  const handleCopyFolderPath = () => {
    // v11 fix — see lib/clipboard.ts for why fire-and-forget writeText
    // fails in Electron renderers after a popup menu loses focus.
    void copyWithToast({ text: workingDirectory, t });
  };

  const withProjectContextMenu = (content: React.ReactElement) => {
    if (!workingDirectory) return content;
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>{content}</ContextMenuTrigger>
        <ContextMenuContent className="min-w-[180px]" onClick={(e) => e.stopPropagation()}>
          <ContextMenuItem
            onSelect={(event) =>
              onCreateSession(event as unknown as React.MouseEvent)
            }
          >
            <CodePilotIcon name="edit" size="sm" aria-hidden />
            <span>{t('chatList.newConversation')}</span>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={handleOpenFolder}>
            <ArrowSquareOut size={14} />
            <span>{t('chatList.openFolder' as TranslationKey)}</span>
          </ContextMenuItem>
          <ContextMenuItem onSelect={handleCopyFolderPath}>
            <CodePilotIcon name="copy" size="sm" aria-hidden />
            <span>{t('chatList.copyFolderPath' as TranslationKey)}</span>
          </ContextMenuItem>
          {onRemoveProject && !isWorkspace && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem
                variant="destructive"
                onSelect={() => onRemoveProject(workingDirectory)}
              >
                <FolderMinus size={14} />
                <span>{t('chatList.removeProject' as TranslationKey)}</span>
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
    );
  };

  const actionButtons = workingDirectory !== "" && (
    <div className={cn(
      "flex items-center gap-0.5 transition-opacity",
      showActions ? "opacity-100" : "opacity-0 pointer-events-none"
    )}>
      {/* New chat button — a "写新对话" pencil/compose icon (clearer than a
          bare +, which read ambiguously as "add what?"). */}
      <Button
        variant="ghost"
        size="icon-xs"
        className="h-5 w-5 shrink-0 text-muted-foreground hover:text-foreground"
        tabIndex={showActions ? 0 : -1}
        onClick={onCreateSession}
        title={t('chatList.newConversation')}
      >
        <CodePilotIcon name="edit" size="sm" aria-hidden />
      </Button>
      {/* Three-dot menu */}
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            className="h-5 w-5 shrink-0 text-muted-foreground hover:text-foreground"
            tabIndex={showActions ? 0 : -1}
            aria-label={t('chatList.moreActions' as TranslationKey)}
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <DotsThree size={14} weight="bold" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[160px]" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem onClick={handleOpenFolder}>
            <ArrowSquareOut size={14} />
            <span>{t('chatList.openFolder' as TranslationKey)}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleCopyFolderPath}>
            <CodePilotIcon name="copy" size="sm" aria-hidden />
            <span>{t('chatList.copyFolderPath' as TranslationKey)}</span>
          </DropdownMenuItem>
          {onRemoveProject && !isWorkspace && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => onRemoveProject(workingDirectory)}
              >
                <FolderMinus size={14} />
                <span>{t('chatList.removeProject' as TranslationKey)}</span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  if (isWorkspace) {
    const statusParts: string[] = [];
    if (assistantMemoryCount) {
      statusParts.push(t('assistant.memoryCount' as TranslationKey, { count: String(assistantMemoryCount) }));
    }
    if (lastHeartbeatDate) {
      statusParts.push(t('assistant.lastHeartbeat' as TranslationKey, { date: lastHeartbeatDate }));
    }

    const folderName = displayName;
    const nameDisplay = buddyEmoji
      ? (buddyName || assistantName || t('assistant.defaultName' as TranslationKey))
      : t('buddy.adoptPrompt' as TranslationKey);

    return withProjectContextMenu(
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg px-2 py-1.5 cursor-pointer select-none transition-colors",
          isCollapsed
            ? "hover:bg-accent/50"
            : "bg-primary/[0.06] hover:bg-primary/[0.10]"
        )}
        onClick={onToggle}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        {buddySpecies ? (
          <img
            src={SPECIES_IMAGE_URL[buddySpecies as Species] || ''}
            alt="" width={24} height={24}
            className="shrink-0 rounded"
          />
        ) : (
          <img src={EGG_IMAGE_URL} alt="egg" width={24} height={24} className="shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <span className="truncate text-[13px] font-medium text-sidebar-foreground">
              {nameDisplay}
            </span>
            {isCollapsed ? (
              <CaretRight size={12} className="shrink-0 text-muted-foreground" />
            ) : (
              <CaretDown size={12} className="shrink-0 text-muted-foreground" />
            )}
          </div>
          <span className="block truncate text-[11px] text-muted-foreground/50 leading-tight">
            / {folderName}
          </span>
        </div>
        {actionButtons}
      </div>
    );
  }

  return withProjectContextMenu(
    <div
      className={cn(
        "flex items-center gap-2 rounded-xl px-3 h-8 cursor-pointer select-none transition-colors",
        "hover:bg-sidebar-accent"
      )}
      onClick={onToggle}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {!hideCaret && (
        isCollapsed ? (
          <CaretRight size={14} className="shrink-0 text-muted-foreground" />
        ) : (
          <CaretDown size={14} className="shrink-0 text-muted-foreground" />
        )
      )}
      {isCollapsed ? (
        <CodePilotIcon name="folder" size="md" className="shrink-0 text-muted-foreground" aria-hidden />
      ) : (
        <CodePilotIcon name="folder_open" size="md" className="shrink-0 text-muted-foreground" aria-hidden />
      )}
      <span className="flex-1 truncate text-[13px] font-normal text-sidebar-foreground/70">
        {displayName}
      </span>
      {actionButtons}
    </div>
  );
}
