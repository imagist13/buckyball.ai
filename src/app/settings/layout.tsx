"use client";

/**
 * Shared shell for the /settings route tree.
 *
 * The shell is intentionally *empty* of section imports: route-level split
 * pushes each section into its own page.tsx so Next dev only compiles the
 * one Settings subgraph the user actually opens. The desktop sidebar lives
 * in AppShell → SettingsSidebar; this layout only provides the narrow-
 * viewport horizontal tab strip and the scrolling content slot.
 *
 * Memory contract: this file must NEVER statically or dynamically import
 * any section component. See `src/__tests__/unit/settings-routes-shape.test.ts`.
 *
 * v6 fix (P2): the nav items list is shared with `SettingsSidebar.tsx`
 * via `@/components/settings/nav-config` — having two parallel
 * literals diverged once (Tasks ended up in different slots) and
 * produced a hydration mismatch. One source of truth now.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/hooks/useTranslation";
import {
  SETTINGS_NAV_ITEMS,
  pathnameToSettingsSection,
} from "@/components/settings/nav-config";
import { CodePilotIcon } from "@/components/ui/semantic-icon";

export default function SettingsRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const activeSection = pathnameToSettingsSection(pathname);
  const { t } = useTranslation();

  // Bridge owns its own h-full + inner sub-nav, so it needs to flex-fill
  // the section without our default p-4/lg:p-6 padding (its sub-nav
  // already brings border-r + p-3). All other sections keep the standard
  // padding via the layout to avoid each page restating it.
  const isBridge = activeSection === "bridge";

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Narrow viewport fallback: horizontal tab strip.
          On lg+ the section navigation lives in AppShell's <SettingsSidebar/>. */}
      <nav
        className={cn(
          "shrink-0 flex flex-row gap-1 overflow-x-auto border-b border-border/50 px-3 py-2",
          "lg:hidden",
        )}
      >
        {SETTINGS_NAV_ITEMS.map((item) => {
          const isActive = activeSection === item.id;
          return (
            <Link
              key={item.id}
              href={item.href}
              prefetch={false}
              className={cn(
                "shrink-0 inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-full",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
              )}
            >
              <CodePilotIcon name={item.icon} size="md" className="shrink-0 text-inherit" aria-hidden />
              {t(item.i18nKey)}
            </Link>
          );
        })}
      </nav>

      {/* Content slot — children come from the active /settings/<section>/page.tsx.
          Round 12 (2026-05-23): padding bumped from p-4/lg:p-6 to
          p-6/lg:p-10 — the previous values left the page title sitting
          almost flush with the topbar, which user feedback flagged as
          cramped. */}
      <div className="flex min-h-0 flex-1">
        <div
          className={cn(
            "flex-1 overflow-auto",
            isBridge ? "" : "p-6 lg:p-10",
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
