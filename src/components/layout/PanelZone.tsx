"use client";

/**
 * PanelZone — light right-rail container.
 *
 * Mounts AssistantPanel, the assistant-workspace-specific concern.
 *
 * The Git / Widget / Markdown / Artifact / file-preview surfaces all
 * live inside `<WorkspaceSidebar>` as fixed or dynamic Tabs and never
 * render here.
 *
 * Files now lives exclusively in WorkspaceSidebar Primary; the v13
 * standalone FileTree rail was deleted only after Inspector smoke passed.
 */

import dynamic from "next/dynamic";
import { useCallback, useState } from "react";
import { usePanel } from "@/hooks/usePanel";
import { CardFrame, CardSurface, ResizeGutter } from "./card-primitives";

const AssistantPanel = dynamic(
  () => import("./panels/AssistantPanel").then((m) => ({ default: m.AssistantPanel })),
  { ssr: false },
);

const ASSISTANT_MIN_WIDTH = 260;
const ASSISTANT_MAX_WIDTH = 460;
const ASSISTANT_DEFAULT_WIDTH = 320;

export function PanelZone() {
  const { assistantPanelOpen } = usePanel();
  const [assistantWidth, setAssistantWidth] = useState(ASSISTANT_DEFAULT_WIDTH);

  const handleAssistantResize = useCallback((delta: number) => {
    setAssistantWidth((w) => Math.min(ASSISTANT_MAX_WIDTH, Math.max(ASSISTANT_MIN_WIDTH, w - delta)));
  }, []);

  if (!assistantPanelOpen) return null;

  // Phase 7c closeout — AssistantPanel is a row-level floating card
  // with its own ResizeGutter + CardFrame +
  // CardSurface. It used to render bare (its own border-l /
  // bg-background chrome), which left the right rail running two
  // different chrome systems. Both panels now go through the single
  // card primitive; AssistantPanel renders inner content only.
  return (
    <>
      {assistantPanelOpen && (
        <>
          <ResizeGutter
            onResize={handleAssistantResize}
            onReset={() => setAssistantWidth(ASSISTANT_DEFAULT_WIDTH)}
          />
          <CardFrame kind="assistant" width={assistantWidth}>
            <CardSurface kind="assistant">
              <AssistantPanel />
            </CardSurface>
          </CardFrame>
        </>
      )}
    </>
  );
}
