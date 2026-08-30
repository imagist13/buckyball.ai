"use client";

import type { HTMLAttributes, ReactNode } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { CaretRight } from "@phosphor-icons/react";
import { CodePilotIcon } from "@/components/ui/semantic-icon";
import { Input } from "@/components/ui/input";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

interface FileTreeContextType {
  expandedPaths: Set<string>;
  togglePath: (path: string) => void;
  selectedPath?: string;
  onSelect?: (path: string) => void;
  /** Context-menu action for adding a file or directory to chat. */
  onAdd?: (path: string, nodeType: 'file' | 'directory') => void;
  /** Localised label used by the context-menu action. */
  addLabel?: string;
  /**
   * Separate selected-folder channel from selectedPath so folder and file
   * selection can coexist without one stomping the other. Folder
   * selection is what drives the "create in this folder" default target.
   */
  selectedFolderPath?: string;
  onSelectFolder?: (folderPath: string) => void;
}

// Module-scope immutable empty Set. Inlining `new Set()` as a destructuring
// default parameter (e.g. `defaultExpanded = new Set()`) triggered a production
// ReferenceError under Next.js 16 + Turbopack in v0.50.2 (Sentry NEXT-PA).
const EMPTY_EXPANDED: Set<string> = new Set();

// Default noop for context default value
// oxlint-disable-next-line eslint(no-empty-function)
const noop = () => {};

const FileTreeContext = createContext<FileTreeContextType>({
  // oxlint-disable-next-line eslint-plugin-unicorn(no-new-builtin)
  expandedPaths: new Set(),
  togglePath: noop,
});

export type FileTreeProps = HTMLAttributes<HTMLDivElement> & {
  expanded?: Set<string>;
  defaultExpanded?: Set<string>;
  selectedPath?: string;
  onSelect?: (path: string) => void;
  onAdd?: (path: string, nodeType: 'file' | 'directory') => void;
  /** Localised label for the add-to-chat context-menu action. */
  addLabel?: string;
  selectedFolderPath?: string;
  onSelectFolder?: (folderPath: string) => void;
  onExpandedChange?: (expanded: Set<string>) => void;
};

export const FileTree = ({
  expanded: controlledExpanded,
  defaultExpanded = EMPTY_EXPANDED,
  selectedPath,
  onSelect,
  onAdd,
  addLabel,
  selectedFolderPath,
  onSelectFolder,
  onExpandedChange,
  className,
  children,
  ...props
}: FileTreeProps) => {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
  const expandedPaths = controlledExpanded ?? internalExpanded;

  const togglePath = useCallback(
    (path: string) => {
      const newExpanded = new Set(expandedPaths);
      if (newExpanded.has(path)) {
        newExpanded.delete(path);
      } else {
        newExpanded.add(path);
      }
      setInternalExpanded(newExpanded);
      onExpandedChange?.(newExpanded);
    },
    [expandedPaths, onExpandedChange]
  );

  const contextValue = useMemo(
    () => ({ expandedPaths, onAdd, addLabel, onSelect, selectedPath, togglePath, selectedFolderPath, onSelectFolder }),
    [expandedPaths, onAdd, addLabel, onSelect, selectedPath, togglePath, selectedFolderPath, onSelectFolder]
  );

  return (
    <FileTreeContext.Provider value={contextValue}>
      <div
        className={cn(
          // File names are panel navigation chrome, not code content. Keeping
          // the whole tree in `font-mono text-sm` makes rows optically larger
          // than the surrounding compact controls. Reserve monospace for full
          // paths and editable technical identifiers instead.
          "rounded-lg border bg-background text-xs font-normal",
          className
        )}
        role="tree"
        {...props}
      >
        <div className="p-2">{children}</div>
      </div>
    </FileTreeContext.Provider>
  );
};

interface FileTreeFolderContextType {
  path: string;
  name: string;
  isExpanded: boolean;
}

const FileTreeFolderContext = createContext<FileTreeFolderContextType>({
  isExpanded: false,
  name: "",
  path: "",
});

export type FileTreeFolderProps = HTMLAttributes<HTMLDivElement> & {
  path: string;
  name: string;
  onCreateFile?: () => void;
  onCreateFolder?: () => void;
  onRename?: (nextName: string) => Promise<void>;
  onDelete?: () => void;
  protectedPath?: boolean;
  labels?: FileTreeActionLabels;
};

export const FileTreeFolder = ({
  path,
  name,
  onCreateFile,
  onCreateFolder,
  onRename,
  onDelete,
  protectedPath,
  labels,
  className,
  children,
  ...props
}: FileTreeFolderProps) => {
  const { expandedPaths, togglePath, selectedFolderPath, onSelectFolder, onAdd, addLabel } =
    useContext(FileTreeContext);
  const isExpanded = expandedPaths.has(path);
  const isSelected = selectedFolderPath === path;
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(name);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renamePending, setRenamePending] = useState(false);
  const contextRenameIntentRef = useRef(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const handleToggle = useCallback(() => {
    togglePath(path);
    // Clicking a folder row both toggles expand/collapse and marks it
    // selected — matches VS Code's Explorer behavior. Selection drives
    // the "create inside this folder" default target in the panel's
    // new-item flow.
    onSelectFolder?.(path);
  }, [togglePath, onSelectFolder, path]);

  const folderContextValue = useMemo(
    () => ({ isExpanded, name, path }),
    [isExpanded, name, path]
  );

  const submitRename = useCallback(async () => {
    const nextName = renameValue.trim();
    if (!onRename || !nextName || nextName === name) {
      setRenaming(false);
      setRenameValue(name);
      setRenameError(null);
      return;
    }
    setRenamePending(true);
    setRenameError(null);
    try {
      await onRename(nextName);
      setRenaming(false);
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : String(error));
    } finally {
      setRenamePending(false);
    }
  }, [name, onRename, renameValue]);

  const beginRename = useCallback(() => {
    setRenameValue(name);
    setRenameError(null);
    setRenaming(true);
  }, [name]);

  const beginContextRename = useCallback(() => {
    contextRenameIntentRef.current = true;
    beginRename();
  }, [beginRename]);

  return (
    <FileTreeFolderContext.Provider value={folderContextValue}>
      <Collapsible onOpenChange={handleToggle} open={isExpanded}>
        <div
          className={cn("", className)}
          role="treeitem"
          aria-selected={isSelected}
          {...props}
        >
          <ContextMenu>
            <CollapsibleTrigger asChild>
              <ContextMenuTrigger asChild>
                <div
              className={cn(
                "group/folder flex w-full cursor-pointer items-center gap-1 rounded py-1 pl-1.5 pr-2 text-left transition-colors hover:bg-muted/50",
                isSelected && "bg-primary/[0.05] text-foreground",
              )}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "F2" && onRename) {
                  e.preventDefault();
                  e.stopPropagation();
                  beginRename();
                } else if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleToggle();
                }
              }}
            >
              <span className="shrink-0 rounded p-0.5">
                <CaretRight
                  size={16}
                  className={cn(
                    "text-muted-foreground transition-transform",
                    isExpanded && "rotate-90"
                  )}
                />
              </span>
              {renaming ? (
                <Input
                  ref={renameInputRef}
                  autoFocus
                  value={renameValue}
                  disabled={renamePending}
                  onChange={(event) => setRenameValue(event.target.value)}
                  onClick={(event) => event.stopPropagation()}
                  onPointerDown={(event) => event.stopPropagation()}
                  onContextMenu={(event) => event.stopPropagation()}
                  onBlur={() => {
                    if (!renamePending) {
                      setRenaming(false);
                      setRenameValue(name);
                      setRenameError(null);
                    }
                  }}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void submitRename();
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      setRenaming(false);
                      setRenameValue(name);
                      setRenameError(null);
                    }
                  }}
                  className="h-6 min-w-0 flex-1 px-1.5 py-0 font-mono text-xs"
                  aria-label={labels?.rename ?? "Rename"}
                />
              ) : (
                <FileTreeName title={path}>{name}</FileTreeName>
              )}
                </div>
              </ContextMenuTrigger>
            </CollapsibleTrigger>
            <ContextMenuContent
              onCloseAutoFocus={(event) => {
                if (!contextRenameIntentRef.current) return;
                event.preventDefault();
                contextRenameIntentRef.current = false;
                requestAnimationFrame(() => {
                  renameInputRef.current?.focus();
                });
              }}
            >
              <ContextMenuItem onSelect={onCreateFile}>
                {labels?.newFile ?? "New file"}
              </ContextMenuItem>
              <ContextMenuItem onSelect={onCreateFolder}>
                {labels?.newFolder ?? "New folder"}
              </ContextMenuItem>
              <ContextMenuSeparator />
              {onAdd && (
                <ContextMenuItem onSelect={() => onAdd(path, "directory")}>
                  {labels?.addToChat ?? addLabel ?? "Add to chat"}
                </ContextMenuItem>
              )}
              <ContextMenuItem
                disabled={!onRename || protectedPath}
                onSelect={beginContextRename}
              >
                {labels?.rename ?? "Rename"}
                <ContextMenuShortcut>F2</ContextMenuShortcut>
              </ContextMenuItem>
              <ContextMenuItem
                variant="destructive"
                disabled={!onDelete || protectedPath}
                onSelect={onDelete}
              >
                {labels?.delete ?? "Delete"}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
          {renameError && (
            <p className="px-8 py-0.5 text-[10px] text-destructive">{renameError}</p>
          )}
          <CollapsibleContent>
            <div className="ml-4 border-l pl-2">{children}</div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </FileTreeFolderContext.Provider>
  );
};

interface FileTreeFileContextType {
  path: string;
  name: string;
}

const FileTreeFileContext = createContext<FileTreeFileContextType>({
  name: "",
  path: "",
});

export type FileTreeFileProps = HTMLAttributes<HTMLDivElement> & {
  path: string;
  name: string;
  icon?: ReactNode;
  onRename?: (nextName: string) => Promise<void>;
  onDelete?: () => void;
  protectedPath?: boolean;
  labels?: FileTreeActionLabels;
};

export const FileTreeFile = ({
  path,
  name,
  icon,
  onRename,
  onDelete,
  protectedPath,
  labels,
  className,
  children,
  ...props
}: FileTreeFileProps) => {
  const { selectedPath, onSelect, onAdd, addLabel } = useContext(FileTreeContext);
  const isSelected = selectedPath === path;
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(name);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renamePending, setRenamePending] = useState(false);
  const contextRenameIntentRef = useRef(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const handleClick = useCallback(() => {
    onSelect?.(path);
  }, [onSelect, path]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "F2" && onRename) {
        e.preventDefault();
        setRenameValue(name);
        setRenameError(null);
        setRenaming(true);
      } else if (e.key === "Enter" || e.key === " ") {
        onSelect?.(path);
      }
    },
    [name, onRename, onSelect, path]
  );

  const fileContextValue = useMemo(() => ({ name, path }), [name, path]);

  const beginRename = useCallback(() => {
    setRenameValue(name);
    setRenameError(null);
    setRenaming(true);
  }, [name]);

  const beginContextRename = useCallback(() => {
    contextRenameIntentRef.current = true;
    beginRename();
  }, [beginRename]);

  const submitRename = useCallback(async () => {
    const nextName = renameValue.trim();
    if (!onRename || !nextName || nextName === name) {
      setRenaming(false);
      setRenameValue(name);
      setRenameError(null);
      return;
    }
    setRenamePending(true);
    setRenameError(null);
    try {
      await onRename(nextName);
      setRenaming(false);
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : String(error));
    } finally {
      setRenamePending(false);
    }
  }, [name, onRename, renameValue]);

  return (
    <FileTreeFileContext.Provider value={fileContextValue}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={cn(
              "group/file flex cursor-pointer items-center gap-1 rounded py-1 pl-1.5 pr-2 transition-colors hover:bg-muted/50",
              isSelected && "bg-primary/[0.05] text-foreground",
              className
            )}
            onClick={handleClick}
            onKeyDown={handleKeyDown}
            role="treeitem"
            aria-selected={isSelected}
            tabIndex={0}
            {...props}
          >
            {children ?? (
              <>
                <FileTreeIcon>
                  {icon ?? <CodePilotIcon name="file" size="md" className="text-muted-foreground" aria-hidden />}
                </FileTreeIcon>
                {renaming ? (
                  <Input
                    ref={renameInputRef}
                    autoFocus
                    value={renameValue}
                    disabled={renamePending}
                    onChange={(event) => setRenameValue(event.target.value)}
                    onClick={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    onContextMenu={(event) => event.stopPropagation()}
                    onBlur={() => {
                      if (!renamePending) {
                        setRenaming(false);
                        setRenameValue(name);
                        setRenameError(null);
                      }
                    }}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void submitRename();
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        setRenaming(false);
                        setRenameValue(name);
                        setRenameError(null);
                      }
                    }}
                    className="h-6 min-w-0 flex-1 px-1.5 py-0 font-mono text-xs"
                    aria-label={labels?.rename ?? "Rename"}
                  />
                ) : (
                  <FileTreeName title={path}>{name}</FileTreeName>
                )}
              </>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent
          onCloseAutoFocus={(event) => {
            if (!contextRenameIntentRef.current) return;
            event.preventDefault();
            contextRenameIntentRef.current = false;
            requestAnimationFrame(() => {
              renameInputRef.current?.focus();
            });
          }}
        >
          {onAdd && (
            <ContextMenuItem onSelect={() => onAdd(path, "file")}>
              {labels?.addToChat ?? addLabel ?? "Add to chat"}
            </ContextMenuItem>
          )}
          <ContextMenuItem
            disabled={!onRename || protectedPath}
            onSelect={beginContextRename}
          >
            {labels?.rename ?? "Rename"}
            <ContextMenuShortcut>F2</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            disabled={!onDelete || protectedPath}
            onSelect={onDelete}
          >
            {labels?.delete ?? "Delete"}
          </ContextMenuItem>
        </ContextMenuContent>
        {renameError && (
          <p className="px-8 py-0.5 text-[10px] text-destructive">{renameError}</p>
        )}
      </ContextMenu>
    </FileTreeFileContext.Provider>
  );
};

export interface FileTreeActionLabels {
  newFile: string;
  newFolder: string;
  addToChat: string;
  rename: string;
  delete: string;
}

export type FileTreeIconProps = HTMLAttributes<HTMLSpanElement>;

export const FileTreeIcon = ({
  className,
  children,
  ...props
}: FileTreeIconProps) => (
  <span className={cn("shrink-0", className)} {...props}>
    {children}
  </span>
);

export type FileTreeNameProps = HTMLAttributes<HTMLSpanElement>;

export const FileTreeName = ({
  className,
  children,
  ...props
}: FileTreeNameProps) => (
  <span className={cn("min-w-0 truncate", className)} {...props}>
    {children}
  </span>
);

export type FileTreeActionsProps = HTMLAttributes<HTMLDivElement>;

const stopPropagation = (e: React.SyntheticEvent) => e.stopPropagation();

export const FileTreeActions = ({
  className,
  children,
  ...props
}: FileTreeActionsProps) => (
  // biome-ignore lint/a11y/noNoninteractiveElementInteractions: stopPropagation required for nested interactions
  // biome-ignore lint/a11y/useSemanticElements: fieldset doesn't fit this UI pattern
  <div
    className={cn("ml-auto flex items-center gap-1", className)}
    onClick={stopPropagation}
    onKeyDown={stopPropagation}
    role="group"
    {...props}
  >
    {children}
  </div>
);
