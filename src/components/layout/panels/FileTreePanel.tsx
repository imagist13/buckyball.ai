"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { CodePilotIcon } from "@/components/ui/semantic-icon";
import { Button } from "@/components/ui/button";
import { PromptDialog } from "@/components/ui/prompt-dialog";
import { usePanel } from "@/hooks/usePanel";
import { useTranslation } from "@/hooks/useTranslation";
import type { TranslationKey } from "@/i18n";
import { FileTree } from "@/components/project/FileTree";
import { useFileMutation } from "@/hooks/useFileMutation";
import {
  FileMutationError,
  fileMutationTargetPath,
  pathIsWithin,
  remapMutationPath,
  type FileMutationNodeType,
} from "@/lib/file-mutation";
import type { FileTreeNode } from "@/types";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { showToast } from "@/hooks/useToast";

// Width state moved to PanelZone (Phase 7c-D); these constants now
// live there alongside the CardFrame width prop wiring.

type NewItemMode = "file" | "folder";

/** Files Primary content; WorkspaceSidebar owns resize, pin, and close chrome. */
export function FileTreePanel() {
  const { workingDirectory, previewFile, setPreviewFile } = usePanel();
  const { t } = useTranslation();
  const searchParams = useSearchParams();

  // VS-Code-like "new item" flow. The mode gates a focused modal instead
  // of inserting a low-contrast row above the tree, so the create action
  // cannot be missed in a narrow sidebar.
  const [newItemMode, setNewItemMode] = useState<NewItemMode | null>(null);
  const lastNewItemModeRef = useRef<NewItemMode>("file");
  const [newItemTargetDir, setNewItemTargetDir] = useState<string>("");
  const { runFileMutation, registerParticipant, hasUnsavedChanges } =
    useFileMutation();

  // Folder selection drives the "create inside this folder" default when
  // the user clicks the top-level New File / New Folder icons — if a
  // folder is selected, new items go inside it; otherwise they go at
  // the workspace root. Independent of file selection so clicking a
  // file doesn't clobber the current folder target.
  const [selectedFolderPath, setSelectedFolderPath] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    node: FileTreeNode;
    descendantCount: number;
    dirty: boolean;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(
    () =>
      registerParticipant({
        id: 'file-tree-selection-workspace-sidebar',
        priority: 40,
        matches: () => true,
        commit: (transaction) => {
          setSelectedFolderPath((current) => {
            if (!current || !pathIsWithin(current, transaction.targetPath)) {
              return current;
            }
            if (transaction.kind === "delete") return null;
            return transaction.newPath
              ? remapMutationPath(
                  current,
                  transaction.targetPath,
                  transaction.newPath,
                )
              : current;
          });
        },
      }),
    [registerParticipant],
  );

  const highlightPath = searchParams.get("file") || undefined;
  const highlightSeek = searchParams.get("seek") || undefined;

  const handleFileAdd = useCallback((path: string, nodeType: 'file' | 'directory') => {
    if (nodeType === 'directory') {
      // Folders go through their own attach event so the composer can
      // render them as green capsule chips (same affordance as file
      // attachments) instead of writing `@path/` text into the textarea
      // — that would duplicate the chip visually and create two
      // different display styles for + clicked file vs + clicked folder.
      window.dispatchEvent(
        new CustomEvent('attach-directory-to-chat', { detail: { path } }),
      );
    } else {
      window.dispatchEvent(new CustomEvent('attach-file-to-chat', { detail: { path } }));
    }
  }, []);

  /**
   * Open the new-item dialog in the given mode, targeting a specific
   * directory (or the workspace root when targetDir is undefined).
   */
  const openNewItem = useCallback(
    (mode: NewItemMode, targetDir?: string) => {
      // Precedence: explicit targetDir (from a folder context menu) →
      // currently-selected folder (from click on folder row) → workspace
      // root. This matches the VS-Code feel: click folder, then click
      // New File, new file lands in that folder.
      const effectiveTarget = targetDir ?? selectedFolderPath ?? workingDirectory;
      setNewItemTargetDir(effectiveTarget);
      lastNewItemModeRef.current = mode;
      setNewItemMode(mode);
    },
    [workingDirectory, selectedFolderPath],
  );

  /**
   * Submit the new-item form. Routes to /api/files/write for files or
   * /api/files/mkdir for folders, using workingDirectory as baseDir so
   * the server-side path safety check can enforce the workspace
   * envelope regardless of which subfolder the user targeted.
   */
  const handleCreateItem = useCallback(async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error(t("fileTree.newFileErrorEmpty"));
    }
    if (!workingDirectory) {
      throw new Error(t("fileTree.newFileErrorNoWorkspace"));
    }
    if (!newItemMode) return;
    const targetDir = newItemTargetDir || workingDirectory;
    const separator = targetDir.includes("\\") ? "\\" : "/";
    const targetPath = `${targetDir}${separator}${trimmed}`;
    const endpoint = newItemMode === "folder" ? "/api/files/mkdir" : "/api/files/write";
    const body =
      newItemMode === "folder"
        ? { path: targetPath, baseDir: workingDirectory, createParents: false }
        : {
            path: targetPath,
            baseDir: workingDirectory,
            content: `# ${trimmed.replace(/\.[^.]+$/, "")}\n\n`,
            overwrite: false,
            createParents: false,
          };
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || t("fileTree.newFileErrorGeneric"));
    }
    const data = await res.json();
    window.dispatchEvent(new Event("refresh-file-tree"));
    // Only open a preview for files — folders have nothing to preview.
    // setPreviewFile flows through AppShell.setPreviewSource which on
    // chat-detail routes dispatches a workspace-tab-open event.
    if (newItemMode === "file") {
      setPreviewFile(data.path);
    }
  }, [newItemMode, newItemTargetDir, workingDirectory, t, setPreviewFile]);

  const mutationErrorMessage = useCallback(
    (error: unknown) => {
      if (error instanceof FileMutationError) {
        return t(`fileIO.errors.${error.code}` as TranslationKey);
      }
      return error instanceof Error
        ? error.message
        : t("fileIO.errors.write_failed" as TranslationKey);
    },
    [t],
  );

  const handleRename = useCallback(
    async (
      targetPath: string,
      nextName: string,
      nodeType: FileMutationNodeType,
    ) => {
      const slash = Math.max(
        targetPath.lastIndexOf("/"),
        targetPath.lastIndexOf("\\"),
      );
      const parentPath = slash >= 0 ? targetPath.slice(0, slash) : workingDirectory;
      const newPath = fileMutationTargetPath(parentPath, nextName);
      try {
        await runFileMutation({
          kind: "rename",
          targetPath,
          newPath,
          nodeType,
          baseDir: workingDirectory,
        });
      } catch (error) {
        throw new Error(mutationErrorMessage(error));
      }
    },
    [mutationErrorMessage, runFileMutation, workingDirectory],
  );

  const handleDeleteRequest = useCallback(
    (node: FileTreeNode, descendantCount: number) => {
      const request = {
        kind: "delete" as const,
        targetPath: node.path,
        nodeType: node.type,
        baseDir: workingDirectory,
        recursive: node.type === "directory",
      };
      setDeleteError(null);
      setDeleteTarget({
        node,
        descendantCount,
        dirty: hasUnsavedChanges(request),
      });
    },
    [hasUnsavedChanges, workingDirectory],
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await runFileMutation({
        kind: "delete",
        targetPath: deleteTarget.node.path,
        nodeType: deleteTarget.node.type,
        baseDir: workingDirectory,
        recursive: deleteTarget.node.type === "directory",
      });
      setDeleteTarget(null);
    } catch (error) {
      const message = mutationErrorMessage(error);
      setDeleteError(message);
      showToast({ type: "error", message });
    } finally {
      setDeleting(false);
    }
  }, [
    deleteTarget,
    deleting,
    mutationErrorMessage,
    runFileMutation,
    workingDirectory,
  ]);

  const handleFileSelect = useCallback((path: string) => {
    const ext = path.split(".").pop()?.toLowerCase() || "";
    const NON_PREVIEWABLE = new Set([
      "zip", "tar", "gz", "rar", "7z", "bz2",
      "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
      "exe", "dll", "so", "dylib", "bin", "dmg", "iso",
      "woff", "woff2", "ttf", "otf", "eot",
      "flv", "wmv", "wma",
    ]);
    if (NON_PREVIEWABLE.has(ext)) return;
    // Selecting a file clears folder selection so the next New File /
    // New Folder click lands at workspace root (not the previously-
    // selected folder) unless the user reselects one.
    setSelectedFolderPath(null);
    // Phase 1 sidebar wiring: setPreviewFile flows through AppShell's
    // `setPreviewSource`, which on chat-detail routes dispatches a
    // workspace-tab-open event (Workspace Sidebar opens / focuses the
    // matching dynamic Tab) and on other routes opens the legacy
    // PreviewPanel. Calling `setPreviewOpen(true)` here would force the
    // legacy panel open ON TOP OF the sidebar Tab → double render +
    // shared `previewSource` context that goes blank when one is
    // closed. We let `setPreviewSource` own the open/close gating.
    if (previewFile === path) {
      // Toggle off — clear the source. AppShell will close the legacy
      // panel; the Workspace Sidebar Tab stays (user closes via Tab X).
      setPreviewFile(null);
    } else {
      setPreviewFile(path);
    }
  }, [previewFile, setPreviewFile]);

  const handleSelectFolder = useCallback((folderPath: string) => {
    // Clicking the same folder again deselects (easy way to reset the
    // create target back to workspace root without clicking away).
    setSelectedFolderPath((cur) => (cur === folderPath ? null : folderPath));
  }, []);

  // Relative path hint for the new-item breadcrumb. When target is the
  // workspace root we show "./", otherwise the relative nested path.
  const targetBreadcrumb =
    !newItemTargetDir || newItemTargetDir === workingDirectory
      ? "./"
      : `./${newItemTargetDir.replace(workingDirectory, "").replace(/^[/\\]/, "")}/`;
  const dialogItemMode = newItemMode ?? lastNewItemModeRef.current;

  // The body (action row + new-item input + tree) is identical across
  // both variants. Only the outer chrome (resize handle, title bar,
  // pin / close) differs, so we build the body once and wrap it
  // depending on `variant` at the bottom of this function.
  const body = (
    <>
        {/* Body — Action icons row → FileTree (which hosts the search
            input on its own row).
            April 2026 layout fix:
              - The duplicate "文件" section title above the action bar
                was redundant with the panel header — removed.
              - New File / New Folder / Refresh now sit together on the
                left as one larger-icon group; previously refresh lived
                inside the FileTree's search row, fighting the input.
              - Search input gets its own dedicated row (in FileTree),
                no longer sharing horizontal space with refresh. */}
        <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
          {/* Action icons row. Left-aligned, single group so the user
              reads them as "the things I can do to this tree". Refresh
              dispatches the existing `refresh-file-tree` window event
              that FileTree already listens for (no state lift needed). */}
          <div className="flex shrink-0 items-center gap-0.5 px-2 pb-1">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => openNewItem("file")}
              disabled={!workingDirectory}
              title={t("fileTree.newMarkdown")}
              aria-label={t("fileTree.newMarkdown")}
            >
              <CodePilotIcon name="note" size="md" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => openNewItem("folder")}
              disabled={!workingDirectory}
              title={t("fileTree.newFolder")}
              aria-label={t("fileTree.newFolder")}
            >
              <CodePilotIcon name="folder_add" size="md" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => window.dispatchEvent(new Event("refresh-file-tree"))}
              disabled={!workingDirectory}
              title={t("fileTree.refresh")}
              aria-label={t("fileTree.refresh")}
            >
              <CodePilotIcon name="refresh" size="md" aria-hidden />
            </Button>
          </div>

          {/* File tree preserves its expansion state across refreshes. */}
          <div className="flex-1 min-h-0 overflow-hidden">
            <FileTree
              workingDirectory={workingDirectory}
              onFileSelect={handleFileSelect}
              onFileAdd={handleFileAdd}
              selectedFolderPath={selectedFolderPath ?? undefined}
              onSelectFolder={handleSelectFolder}
              selectedFilePath={previewFile ?? undefined}
              highlightPath={highlightPath}
              highlightSeek={highlightSeek}
              onCreateIn={(mode, directory) => openNewItem(mode, directory)}
              onRename={handleRename}
              onDelete={handleDeleteRequest}
            />
          </div>
        </div>
        <PromptDialog
          open={newItemMode !== null}
          onOpenChange={(open) => {
            if (!open) setNewItemMode(null);
          }}
          title={
            dialogItemMode === "folder"
              ? t("fileTree.newFolder")
              : t("fileTree.newMarkdown")
          }
          description={targetBreadcrumb}
          defaultValue={dialogItemMode === "folder" ? "new-folder" : "untitled.md"}
          placeholder={dialogItemMode === "folder" ? "new-folder" : "untitled.md"}
          selectStem={dialogItemMode === "file"}
          confirmLabel={t("fileTree.createButton")}
          cancelLabel={t("common.cancel")}
          onConfirm={handleCreateItem}
          validate={(value) =>
            value.trim() ? undefined : t("fileTree.newFileErrorEmpty")
          }
        />
        <AlertDialog
          open={!!deleteTarget}
          onOpenChange={(open) => {
            if (!open && !deleting) setDeleteTarget(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("fileTree.delete.title" as TranslationKey, {
                  name: deleteTarget?.node.name ?? "",
                })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {deleteTarget?.node.type === "directory"
                  ? t("fileTree.delete.folderDescription" as TranslationKey, {
                      count: deleteTarget.descendantCount,
                    })
                  : t("fileTree.delete.fileDescription" as TranslationKey)}
              </AlertDialogDescription>
              {deleteTarget?.dirty && (
                <p className="text-sm font-medium text-destructive">
                  {t("fileTree.delete.unsavedWarning" as TranslationKey)}
                </p>
              )}
              {deleteError && (
                <p className="text-sm text-destructive">{deleteError}</p>
              )}
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>
                {t("common.cancel")}
              </AlertDialogCancel>
              <Button
                variant="destructive"
                disabled={deleting}
                onClick={() => void handleConfirmDelete()}
              >
                {deleting
                  ? t("fileTree.delete.deleting" as TranslationKey)
                  : t("fileTree.delete.confirm" as TranslationKey)}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
    </>
  );

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {body}
    </div>
  );
}
