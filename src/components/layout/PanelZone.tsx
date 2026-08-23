"use client";

/**
 * PanelZone â€?light right-rail container.
 *
 * Mounts:
 *   - FileTreePanel â€?independent topbar entry. The file tree is a
 *     high-frequency deterministic tool, kept out of the Workspace
 *     Sidebar so a quick file lookup doesn't drag the user into the
 *     full Tab shell.
 *   - AssistantPanel â€?assistant-workspace surface; doesn't fit the
 *     AI-work-surface Tab model, so it lives here as its own concern.
 *
 * The Git / Widget / Markdown / Artifact / file-preview surfaces all
 * live inside `<WorkspaceSidebar>` as fixed or dynamic Tabs and never
 * render here.
 *
 * v13 â€?FileTreePanel and the Workspace Sidebar are additive: both
 * can be open simultaneously and the chat area shrinks accordingly.
 * Each topbar toggle (UnifiedTopBar) flips its own panel only, with
 * no auto-close of the other. Earlier rounds (and v11) treated them
 * as mutually exclusive; that direction was reversed after the user
 * pointed out the actual product wish was coexistence â€?see the
 * Phase 3 archive's v13 entry for the full rationale.
 *
 * Phase 7c-D â€?width state for the file tree moved up here from
 * FileTreePanel so PanelZone can pass it to the new CardFrame's
 * `width` prop and pair it with a ResizeHandle sibling. FileTreePanel
 * now renders only the inner content (header + body).
 */

import dynamic from "next/dynamic";
import { useCallback, useState } from "react";
import { usePanel } from "@/hooks/usePanel";
import { CardFrame, CardSurface, ResizeGutter } from "./card-primitives";

const FileTreePanel = dynamic(
  () => import("./panels/FileTreePanel").then((m) => ({ default: m.FileTreePanel })),
  { ssr: false },
);
const AssistantPanel = dynamic(
  () => import("./panels/AssistantPanel").then((m) => ({ default: m.AssistantPanel })),
  { ssr: false },
);

const TREE_MIN_WIDTH = 220;
const TREE_MAX_WIDTH = 500;
const TREE_DEFAULT_WIDTH = 280;

const ASSISTANT_MIN_WIDTH = 260;
const ASSISTANT_MAX_WIDTH = 460;
const ASSISTANT_DEFAULT_WIDTH = 320;

export function PanelZone() {
  const { fileTreeOpen, assistantPanelOpen } = usePanel();
  const [treeWidth, setTreeWidth] = useState(TREE_DEFAULT_WIDTH);
  const [assistantWidth, setAssistantWidth] = useState(ASSISTANT_DEFAULT_WIDTH);

  const handleTreeResize = useCallback((delta: number) => {
    // Dragging right on a right-rail handle â†?narrower tree, so subtract.
    setTreeWidth((w) => Math.min(TREE_MAX_WIDTH, Math.max(TREE_MIN_WIDTH, w - delta)));
  }, []);

  const handleAssistantResize = useCallback((delta: number) => {
    setAssistantWidth((w) => Math.min(ASSISTANT_MAX_WIDTH, Math.max(ASSISTANT_MIN_WIDTH, w - delta)));
  }, []);

  const anyOpen = fileTreeOpen || assistantPanelOpen;
  if (!anyOpen) return null;

  // Phase 7c closeout â€?AssistantPanel is now a row-level floating
  // card just like fileTree: its own ResizeGutter + CardFrame +
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
      {fileTreeOpen && (
        <>
          <ResizeGutter
            onResize={handleTreeResize}
            onReset={() => setTreeWidth(TREE_DEFAULT_WIDTH)}
          />
          <CardFrame kind="fileTree" width={treeWidth}>
            <CardSurface kind="fileTree">
              <FileTreePanel />
            </CardSurface>
          </CardFrame>
        </>
      )}
    </>
  );
}
