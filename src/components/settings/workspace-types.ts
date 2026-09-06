export interface FileStatus {
  exists: boolean;
  chars: number;
  preview: string;
}

export interface WorkspaceState {
  onboardingComplete: boolean;
  lastHeartbeatDate: string | null;
  /** @deprecated Use lastHeartbeatDate instead */
  lastCheckInDate?: string | null;
  schemaVersion: number;
  heartbeatEnabled: boolean;
  /** Phase 3 Step 4 — heartbeat interval (in hours). */
  heartbeatIntervalHours?: number;
  /** @deprecated Use heartbeatEnabled instead */
  dailyCheckInEnabled?: boolean;
}

export interface TaxonomyCategoryInfo {
  id: string;
  label: string;
  role: string;
  confidence: number;
  source: string;
  paths: string[];
}

export interface IndexStats {
  fileCount: number;
  chunkCount: number;
  lastIndexed: number;
  staleCount: number;
}

export interface WorkspaceInfo {
  path: string | null;
  valid?: boolean;
  reason?: string;
  exists?: boolean;
  files: Record<string, FileStatus>;
  instructionMirrors?: {
    canonicalExists: boolean;
    mirrors: Array<{
      fileName: 'CLAUDE.md' | 'AGENTS.md';
      status: 'missing' | 'synced' | 'stale' | 'modified' | 'unmanaged';
    }>;
    conflicts: string[];
  };
  state: WorkspaceState | null;
  heartbeat?: {
    desiredEnabled: boolean;
    actualStatus: string;
    taskId: string | null;
    nextRun: string | null;
    lastRunStatus: string | null;
    lastRunResult: string | null;
    lastRunError: string | null;
    lastRunAt: string | null;
    lastRunDurationMs: number | null;
    lastMeaningfulAlert: {
      text: string;
      createdAt: string;
    } | null;
    lastDelivery: {
      status: string;
      error: string | null;
      attemptCount: number;
      acceptedAt: string | null;
    } | null;
  };
}

export type TabId = 'files' | 'taxonomy' | 'index' | 'organize';
