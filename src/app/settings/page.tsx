"use client";

/**
 * /settings root — pure client redirect, no section imports.
 *
 * Memory contract: this page must NOT import any settings section. The
 * Overview dashboard moved to /settings/overview specifically so old hash
 * deep links (`/settings#providers`, `/settings#models`, …) can land here
 * and bounce to the right route WITHOUT first paying the OverviewSection
 * compile cost (which transitively pulls
 * `useOverviewData → @/lib/runtime/effective`'s provider catalog + model
 * discovery + runtime resolver into the dev graph). See
 * `src/__tests__/unit/settings-routes-shape.test.ts` and
 * `settings-link-migration.test.ts`.
 *
 * Behavior:
 * - URL has hash matching a known section → router.replace to /settings/<hash>
 * - URL has no hash (or unknown hash) → router.replace to /settings/overview
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const SECTION_HASH_TO_PATH: Record<string, string> = {
  overview: "/settings/overview",
  general: "/settings/general",
  appearance: "/settings/appearance",
  providers: "/settings/providers",
  models: "/settings/models",
  runtime: "/settings/runtime",
  health: "/settings/health",
  usage: "/settings/usage",
  assistant: "/settings/assistant",
  tasks: "/settings/tasks",
  bridge: "/settings/bridge",
  about: "/settings/about",
};

export default function SettingsRootRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash.replace("#", "");
    const target = SECTION_HASH_TO_PATH[hash] ?? "/settings/overview";
    router.replace(target);
  }, [router]);

  return null;
}
