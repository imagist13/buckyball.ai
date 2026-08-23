"use client";

import { useState, useEffect, useCallback, useRef } from "react";

interface FileStatus {
  exists: boolean;
  chars: number;
  preview: string;
}

interface WorkspaceState {
  onboardingComplete: boolean;
  lastHeartbeatDate: string | null;
  /** @deprecated Use lastHeartbeatDate instead */
  lastCheckInDate?: string | null;
  heartbeatEnabled: boolean;
  schemaVersion: number;
}

interface WorkspaceInfo {
  path: string | null;
  valid?: boolean;
  reason?: string;
  exists?: boolean;
  files: Record<string, FileStatus>;
  state: WorkspaceState | null;
}

export function useAssistantWorkspace() {
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const bootstrapAttempted = useRef(false);

  const refetch = useCallback(async () => {
    try {
      setError(null);
      const res = await fetch("/api/settings/workspace");
      if (res.ok) {
        const data = await res.json();
        setWorkspace(data);
      } else {
        setError("Failed to fetch workspace info");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  useEffect(() => {
    if (workspace?.reason !== 'no_path_configured') return;
    if (bootstrapAttempted.current) return;
    const resolver = window.electronAPI?.app?.getDefaultAssistantHome;
    if (!resolver) return;
    bootstrapAttempted.current = true;

    void (async () => {
      try {
        const defaultPath = await resolver();
        const res = await fetch('/api/settings/workspace', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path: defaultPath,
            initialize: true,
            ifUnconfigured: true,
          }),
        });
        if (!res.ok) throw new Error('Failed to initialize the default assistant');
        await refetch();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to initialize the default assistant');
      }
    })();
  }, [workspace?.reason, refetch]);

  const setWorkspacePath = useCallback(async (path: string) => {
    try {
      const res = await fetch("/api/settings/workspace", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      if (res.ok) await refetch();
    } catch (e) {
      console.error("Failed to set workspace path:", e);
    }
  }, [refetch]);

  const initializeWorkspace = useCallback(async () => {
    if (!workspace?.path) return;
    try {
      const res = await fetch("/api/settings/workspace", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: workspace.path, initialize: true }),
      });
      if (res.ok) await refetch();
    } catch (e) {
      console.error("Failed to initialize workspace:", e);
    }
  }, [workspace?.path, refetch]);

  return {
    workspacePath: workspace?.path ?? null,
    fileStatus: workspace?.files ?? {},
    state: workspace?.state ?? null,
    loading,
    error,
    setWorkspacePath,
    initializeWorkspace,
    refetch,
  };
}
