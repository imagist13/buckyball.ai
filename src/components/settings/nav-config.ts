/**
 * Shared Settings nav config — single source of truth for both the
 * desktop sidebar (`src/components/layout/SettingsSidebar.tsx`) and the
 * mobile horizontal tab strip (`src/app/settings/layout.tsx`). Keeping
 * them as two separate literals diverged once (Tasks added to one but
 * the other rendered Bridge in the same slot) and produced a hydration
 * mismatch — server painted one order, client painted another.
 *
 * If you need to add or reorder a Settings section, edit this file
 * and only this file.
 *
 * Phase 7 (2026-05-21): `icon` is now a `CodePilotIconName` semantic
 * alias string, not a Phosphor Icon constructor. Consumers render via
 * `<CodePilotIcon name={item.icon} />`. The previous Brain/Lightning
 * overloading is resolved at the alias layer (model → CubeIcon /
 * runtime → ChipIcon); the nav config itself stays vendor-free.
 */

import type { CodePilotIconName } from "@/components/ui/semantic-icon";
import type { TranslationKey } from "@/i18n";

export type SettingsSection =
  | "overview"
  | "general"
  | "appearance"
  | "providers"
  | "models"
  | "runtime"
  | "health"
  | "usage"
  | "assistant"
  | "tasks"
  | "bridge"
  | "about";

export interface SettingsNavItem {
  id: SettingsSection;
  /** Stable English key; the i18n table maps this to a localized label. */
  label: string;
  /** Semantic icon alias — resolved to a HugeIcons glyph by CodePilotIcon. */
  icon: CodePilotIconName;
  href: string;
  i18nKey: TranslationKey;
}

/**
 * Order matters — this is the visual order in both the desktop
 * sidebar and the mobile horizontal nav. Mirror the route tree under
 * src/app/settings/. Overview (dashboard) at top, About (metadata) at
 * bottom; middle is the three-layer mental model: Providers → Models
 * → Runtime, then Health / Usage / Assistant / Tasks / Bridge.
 */
export const SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
  { id: "overview", label: "Overview", icon: "overview", href: "/settings/overview", i18nKey: "settings.overview" as TranslationKey },
  { id: "general", label: "General", icon: "settings", href: "/settings/general", i18nKey: "settings.general" as TranslationKey },
  { id: "appearance", label: "Appearance", icon: "appearance", href: "/settings/appearance", i18nKey: "settings.appearance" as TranslationKey },
  { id: "providers", label: "Providers", icon: "provider", href: "/settings/providers", i18nKey: "settings.providers" as TranslationKey },
  { id: "models", label: "Models", icon: "model", href: "/settings/models", i18nKey: "settings.models" as TranslationKey },
  { id: "runtime", label: "Runtime", icon: "runtime", href: "/settings/runtime", i18nKey: "settings.runtime" as TranslationKey },
  { id: "health", label: "Health", icon: "health", href: "/settings/health", i18nKey: "settings.health" as TranslationKey },
  { id: "usage", label: "Usage", icon: "usage", href: "/settings/usage", i18nKey: "settings.usage" as TranslationKey },
  { id: "assistant", label: "Assistant", icon: "assistant", href: "/settings/assistant", i18nKey: "settings.assistant" as TranslationKey },
  // Phase 3 Step 3 — global tasks center (independent of Assistant).
  { id: "tasks", label: "Tasks", icon: "task", href: "/settings/tasks", i18nKey: "settings.tasks" as TranslationKey },
  // Bridge moved from top-level rail entry into Settings (2026-05-02).
  { id: "bridge", label: "Bridge", icon: "bridge", href: "/settings/bridge", i18nKey: "settings.bridge" as TranslationKey },
  { id: "about", label: "About", icon: "about", href: "/settings/about", i18nKey: "settings.about" as TranslationKey },
];

export function pathnameToSettingsSection(pathname: string): SettingsSection {
  // Bare /settings is a transient redirect target; treat it as Overview
  // for active-state highlighting so the nav doesn't blink into "no
  // active item" during the redirect bounce.
  if (pathname === "/settings") return "overview";
  const tail = pathname.replace(/^\/settings\/?/, "").split("/")[0];
  if (SETTINGS_NAV_ITEMS.some((item) => item.id === tail)) return tail as SettingsSection;
  return "overview";
}
