"use client";

import { useState, useCallback, useSyncExternalStore } from "react";
import { WifiHigh, TelegramLogo, ChatTeardrop, GameController, ChatsCircle, type Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { BridgeSection } from "./BridgeSection";
import { TelegramBridgeSection } from "./TelegramBridgeSection";
import { FeishuBridgeSection } from "./FeishuBridgeSection";
import { DiscordBridgeSection } from "./DiscordBridgeSection";
import { QqBridgeSection } from "./QqBridgeSection";
import { WeixinBridgeSection } from "./WeixinBridgeSection";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/i18n";

type Section = "bridge" | "telegram" | "feishu" | "discord" | "qq" | "weixin";

interface SidebarItem {
  id: Section;
  label: string;
  icon: Icon;
}

const sidebarItems: SidebarItem[] = [
  { id: "bridge", label: "Bridge", icon: WifiHigh },
  { id: "telegram", label: "Telegram", icon: TelegramLogo },
  { id: "feishu", label: "Feishu", icon: ChatTeardrop },
  { id: "discord", label: "Discord", icon: GameController },
  { id: "qq", label: "QQ", icon: ChatsCircle },
  { id: "weixin", label: "WeChat", icon: ChatTeardrop },
];

function getSectionFromHash(): Section {
  if (typeof window === "undefined") return "bridge";
  const hash = window.location.hash.replace("#", "");
  if (sidebarItems.some((item) => item.id === hash)) {
    return hash as Section;
  }
  return "bridge";
}

function subscribeToHash(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}

interface BridgeLayoutProps {
  /**
   * `embedded` mounts BridgeLayout inside another shell (currently the
   * `/settings/bridge` route). In embedded mode:
   *   - The page-level `<h1>` + description are hidden (the host shell
   *     already provides identity).
   *   - The inner sub-nav drives only local state — URL writes are
   *     suppressed so they don't compete with the host route's path.
   *   - The hash is read once on mount but never mirrored back.
   */
  embedded?: boolean;
}

export function BridgeLayout({ embedded = false }: BridgeLayoutProps = {}) {
  const hashSection = useSyncExternalStore(subscribeToHash, getSectionFromHash, () => "bridge" as Section);
  const [overrideSection, setOverrideSection] = useState<Section | null>(
    embedded ? "bridge" : null,
  );
  const activeSection = embedded
    ? (overrideSection ?? "bridge")
    : (overrideSection ?? hashSection);

  const { t } = useTranslation();

  const bridgeLabelKeys: Record<string, TranslationKey> = {
    'Bridge': 'bridge.title',
    'Telegram': 'bridge.telegramSettings',
    'Feishu': 'bridge.feishuSettings',
    'Discord': 'bridge.discordSettings',
    'QQ': 'bridge.qqSettings',
    'WeChat': 'bridge.weixinSettings',
  };

  const handleSectionChange = useCallback((section: Section) => {
    setOverrideSection(section);
    if (!embedded) {
      window.history.replaceState(null, "", `/bridge#${section}`);
      // Standalone path also clears the override so subsequent hash
      // changes (browser back/forward) take effect; embedded path keeps
      // the override sticky since hash isn't the source of truth.
      queueMicrotask(() => setOverrideSection(null));
    }
  }, [embedded]);

  return (
    <div className="flex h-full flex-col">
      {!embedded && (
        <div className="px-4 pt-3 pb-3 md:px-6 md:pt-4 md:pb-4">
          <h1 className="text-xl font-semibold">{t('bridge.title')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('bridge.description')}
          </p>
        </div>
      )}

      <div className="flex min-h-0 flex-1 max-md:flex-col">
        <nav
          className={cn(
            "shrink-0 flex",
            "md:w-52 md:flex-col md:gap-1 md:border-r md:border-border/50 md:p-3",
            "max-md:flex-row max-md:gap-1 max-md:overflow-x-auto max-md:border-b max-md:border-border/50 max-md:px-3 max-md:py-2",
          )}
        >
          {sidebarItems.map((item) => (
            <Button
              key={item.id}
              variant="ghost"
              onClick={() => handleSectionChange(item.id)}
              className={cn(
                "gap-2 text-sm font-medium",
                "md:justify-start md:px-3 md:py-2 md:w-full",
                "max-md:shrink-0 max-md:px-3 max-md:py-1.5 max-md:rounded-full",
                activeSection === item.id
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
              )}
            >
              <item.icon size={16} className="shrink-0" />
              {t(bridgeLabelKeys[item.label])}
            </Button>
          ))}
        </nav>

        <div className="flex-1 overflow-auto p-4 md:p-6">
          {activeSection === "bridge" && <BridgeSection />}
          {activeSection === "telegram" && <TelegramBridgeSection />}
          {activeSection === "feishu" && <FeishuBridgeSection />}
          {activeSection === "discord" && <DiscordBridgeSection />}
          {activeSection === "qq" && <QqBridgeSection />}
          {activeSection === "weixin" && <WeixinBridgeSection />}
        </div>
      </div>
    </div>
  );
}
