"use client";

import { useState } from "react";
import { CaretDown } from "@/components/ui/icon";
import { CodePilotIcon } from "@/components/ui/semantic-icon";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/i18n";
import type { CliToolDefinition, CliToolRuntimeInfo, CliToolPlatform } from "@/types";

/** Compute agent compatibility score (0-5) from tool definition fields */
export function computeAgentScore(tool: { agentFriendly?: boolean; supportsJson?: boolean; supportsSchema?: boolean; supportsDryRun?: boolean; contextFriendly?: boolean }): number {
  let score = 0;
  if (tool.agentFriendly) score++;
  if (tool.supportsJson) score++;
  if (tool.supportsSchema) score++;
  if (tool.supportsDryRun) score++;
  if (tool.contextFriendly) score++;
  return score;
}

interface CliToolCardProps {
  tool: CliToolDefinition;
  runtimeInfo?: CliToolRuntimeInfo;
  variant: 'installed' | 'recommended';
  autoDescription?: { zh: string; en: string };
  onDetail: () => void;
  onInstall?: (tool: CliToolDefinition, method: string) => void;
  locale: string;
  platform: string;
}

export function CliToolCard({
  tool,
  runtimeInfo,
  variant,
  autoDescription,
  onDetail,
  onInstall,
  locale,
  platform,
}: CliToolCardProps) {
  const { t } = useTranslation();
  const [showMethodPicker, setShowMethodPicker] = useState(false);
  const isZh = locale === 'zh';

  const availableMethods = tool.installMethods.filter(
    m => m.platforms.includes(platform as CliToolPlatform)
  );

  const summary = autoDescription
    ? (isZh ? autoDescription.zh : autoDescription.en)
    : (isZh ? tool.summaryZh : tool.summaryEn);

  const handleInstallClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (availableMethods.length === 1) {
      onInstall?.(tool, availableMethods[0].method);
    } else if (availableMethods.length > 1) {
      setShowMethodPicker(!showMethodPicker);
    }
  };

  const handleMethodSelect = (e: React.MouseEvent, method: string) => {
    e.stopPropagation();
    setShowMethodPicker(false);
    onInstall?.(tool, method);
  };

  const score = computeAgentScore(tool);
  const showInstallButton =
    variant === 'recommended' && onInstall && availableMethods.length > 0;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onDetail}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onDetail();
        }
      }}
      aria-label={`${tool.name} — ${summary || t('cliTools.noDescription' as TranslationKey)}`}
      // Canonical Settings card chrome (`docs/design.md` § Card system):
      // rounded-lg + soft border + p-5 + bg-card. Same as Skills + MCP
      // cards so the three plugin lists read as one continuous catalogue.
      className="rounded-lg bg-card border border-border/50 p-5 cursor-pointer transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="font-medium text-sm truncate min-w-0 max-w-full">{tool.name}</h3>
        {tool.categories.map(cat => (
          <span
            key={cat}
            className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground shrink-0"
          >
            {t(`cliTools.category.${cat}` as TranslationKey)}
          </span>
        ))}
        {variant === 'installed' && runtimeInfo?.version && (
          <span className="text-[10px] text-muted-foreground shrink-0">
            v{runtimeInfo.version}
          </span>
        )}
      </div>

      <p className="text-xs text-muted-foreground mt-2 leading-relaxed line-clamp-3">
        {summary || t('cliTools.noDescription' as TranslationKey)}
      </p>

      {(score > 0 || showInstallButton) && (
        <div className="flex items-center justify-between mt-3 gap-2">
          {score > 0 ? (
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-muted-foreground">{t('cliTools.agentFriendliness' as TranslationKey)}</span>
              <div className="flex gap-0.5">
                {[1, 2, 3, 4, 5].map(i => (
                  <CodePilotIcon
                    key={i}
                    name="rating"
                    size={10}
                    strokeWidth={i <= score ? 2 : undefined}
                    className={i <= score ? 'text-primary' : 'text-muted-foreground/30'}
                    aria-hidden
                  />
                ))}
              </div>
            </div>
          ) : (
            <span />
          )}
          {showInstallButton && (
            <div className="shrink-0 relative">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={handleInstallClick}
                title={`${t('cliTools.install')} ${tool.name}`}
                aria-label={`${t('cliTools.install')} ${tool.name}`}
              >
                {availableMethods.length > 1
                  ? <CaretDown size={16} />
                  : <CodePilotIcon name="plus" size="md" aria-hidden />}
              </Button>
              {showMethodPicker && availableMethods.length > 1 && (
                <div className="absolute right-0 top-8 z-10 rounded-md border bg-popover p-1 shadow-md min-w-[140px]">
                  {availableMethods.map(m => (
                    <Button
                      key={m.method}
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start px-2 py-1 text-xs h-auto"
                      onClick={(e) => handleMethodSelect(e, m.method)}
                    >
                      {m.method}: {m.command}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
