"use client";

/**
 * Codex Account models â?read-only block for Settings â?Models.
 *
 * Phase 5 Phase 6 IA correction (2026-05-14). Codex Account is a
 * virtual provider; its models come from upstream Codex
 * `model/list` (not from buckyball.ai's DB), so they're NOT toggleable
 * here. The block surfaces them in the same canvas as DB providers so
 * users know which models are available without having to leave
 * Models page â?addresses the user's "Codex Account æ¨¡åæ¾å° Models é?
 * spec without rebuilding ModelsSection's section system.
 *
 * Hidden states:
 *   - Codex app-server not ready             â?block hidden
 *   - Codex Account not logged in            â?block hidden
 *   - /api/codex/models returns empty group  â?block hidden
 *
 * No write actions â?switching default model, enable/disable, role
 * mapping etc. don't apply to Codex Account models (they're served
 * directly through Codex Runtime). The block carries a clear
 * "ä»?Codex" / "Codex only" badge so users understand the constraint.
 */

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowSquareOut } from "@/components/ui/icon";
import { BuckyballIcon } from "@/components/ui/semantic-icon";
import { cn } from "@/lib/utils";
import type { ProviderModelGroup } from "@/types";

interface CodexAccountModelsBlockProps {
  isZh: boolean;
}

export function CodexAccountModelsBlock({ isZh }: CodexAccountModelsBlockProps) {
  const [group, setGroup] = useState<ProviderModelGroup | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchModels = async () => {
      try {
        const res = await fetch("/api/codex/models", { cache: "no-store" });
        const json = await res.json();
        if (!cancelled) {
          setGroup((json?.group ?? null) as ProviderModelGroup | null);
          setLoaded(true);
        }
      } catch {
        if (!cancelled) setLoaded(true);
      }
    };
    fetchModels();
    const handler = () => fetchModels();
    window.addEventListener("provider-changed", handler);
    return () => {
      cancelled = true;
      window.removeEventListener("provider-changed", handler);
    };
  }, []);

  if (!loaded) return null;
  if (!group || !group.models?.length) return null;

  return (
    <section className="space-y-3" aria-labelledby="codex-account-models-heading">
      <div className="rounded-lg border border-border/50 bg-card p-5 flex flex-col gap-3.5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <BuckyballIcon name="model" size="md" className="text-muted-foreground shrink-0" aria-hidden />
            <h3 id="codex-account-models-heading" className="text-sm font-semibold leading-tight">
              {isZh ? "Codex è´¦æ·" : "Codex Account"}
            </h3>
            <span
              className={cn(
                "inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-medium",
                "bg-status-warning-muted text-status-warning-foreground",
              )}
            >
              {isZh ? "ä»?Codex" : "Codex only"}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {isZh
                ? `${group.models.length} ä¸ªæ¨¡å`
                : `${group.models.length} model${group.models.length === 1 ? "" : "s"}`}
            </span>
          </div>
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" asChild>
            <a href="/settings/providers">
              <ArrowSquareOut size={12} />
              {isZh ? "ç®¡çè´¦æ·" : "Manage account"}
            </a>
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {isZh
            ? "Codex è´¦æ·æ¨¡åç?ChatGPT å¥é¤æ¿æï¼æ é API Keyï¼åªå¨ãæ§è¡å¼æ?â?Codexãä¸å¯ç¨ãæ¨¡ååè¡¨ç± Codex èªå¨ç»´æ¤ï¼æ éå¨è¿éå¯ç?éèã?
            : "Codex Account models are covered by your ChatGPT plan â?no API key required. They run only under Settings â?Runtime â?Codex. The list is maintained by Codex; nothing to toggle here."}
        </p>
        <ul className="flex flex-col divide-y divide-border/40 rounded-md bg-muted/30 px-3.5">
          {group.models.map((m) => (
            <li key={m.value} className="py-2 flex items-center justify-between gap-3 text-xs">
              <span className="font-mono truncate">{m.label}</span>
              <span className="font-mono text-[10px] text-muted-foreground truncate max-w-[40%]">
                {m.value}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
