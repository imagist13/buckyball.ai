import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getSetting, setSetting } from '@/lib/db';
import {
  validateWorkspace,
  initializeWorkspace,
  inspectInstructionMirrors,
  loadState,
  saveState,
} from '@/lib/assistant-workspace';
import {
  ASSISTANT_WORKSPACE_PATH_SETTING,
  bootstrapDefaultAssistantWorkspace,
} from '@/lib/assistant-default-workspace';

export async function GET() {
  try {
    const workspacePath = getSetting(ASSISTANT_WORKSPACE_PATH_SETTING);
    if (!workspacePath) {
      return NextResponse.json({ path: null, valid: false, reason: 'no_path_configured', files: {}, state: null });
    }

    // Check if the path is actually valid before proceeding
    let pathExists = false;
    let isDirectory = false;
    let readable = false;
    try {
      const stat = fs.statSync(workspacePath);
      pathExists = true;
      isDirectory = stat.isDirectory();
    } catch { /* path doesn't exist */ }

    let writable = false;
    if (pathExists && isDirectory) {
      try {
        fs.accessSync(workspacePath, fs.constants.R_OK);
        readable = true;
      } catch { /* not readable */ }
      try {
        fs.accessSync(workspacePath, fs.constants.W_OK);
        writable = true;
      } catch { /* not writable */ }
    }

    if (!pathExists) {
      return NextResponse.json({ path: workspacePath, valid: false, reason: 'path_not_found', files: {}, state: null });
    }
    if (!isDirectory) {
      return NextResponse.json({ path: workspacePath, valid: false, reason: 'not_a_directory', files: {}, state: null });
    }
    if (!readable) {
      return NextResponse.json({ path: workspacePath, valid: false, reason: 'not_readable', files: {}, state: null });
    }
    if (!writable) {
      return NextResponse.json({ path: workspacePath, valid: false, reason: 'not_writable', files: {}, state: null });
    }

    const validation = validateWorkspace(workspacePath);
    const instructionMirrors = inspectInstructionMirrors(workspacePath);
    const state = loadState(workspacePath);

    // Build file status with preview
    const fileStatus: Record<string, { exists: boolean; chars: number; preview: string }> = {};
    for (const [key, info] of Object.entries(validation.files)) {
      let preview = '';
      if (info.exists && info.path) {
        try {
          const content = fs.readFileSync(info.path, 'utf-8');
          preview = content.split('\n').slice(0, 3).join('\n');
        } catch { /* ignore */ }
      }
      fileStatus[key] = {
        exists: info.exists,
        chars: info.size,
        preview,
      };
    }

    // Load taxonomy for UI
    let taxonomy: Array<{ id: string; label: string; role: string; confidence: number; source: string; paths: string[] }> = [];
    try {
      const { loadTaxonomy } = await import('@/lib/workspace-taxonomy');
      const taxData = loadTaxonomy(workspacePath);
      taxonomy = taxData.categories.map(c => ({
        id: c.id,
        label: c.label,
        role: c.role,
        confidence: c.confidence,
        source: c.source,
        paths: c.paths,
      }));
    } catch {
      // taxonomy module not available
    }

    return NextResponse.json({
      path: workspacePath,
      valid: true,
      exists: validation.exists,
      files: fileStatus,
      instructionMirrors,
      state,
      taxonomy,
      heartbeat: await (async () => {
        const { getHeartbeatTask, listTaskRunLogs, listNotificationDeliveries } = await import('@/lib/db');
        const task = getHeartbeatTask();
        const recentRuns = task ? listTaskRunLogs(task.id, 20) : [];
        const latestRun = recentRuns[0];
        const latestAlert = recentRuns.find((run) =>
          run.status === 'succeeded'
          && run.result !== 'silent'
          && !!run.notification_event_id,
        );
        const deliveryEventId = latestRun?.notification_event_id || latestAlert?.notification_event_id;
        const latestDelivery = deliveryEventId
          ? listNotificationDeliveries(deliveryEventId).find((row) => row.channel === 'electron-native')
          : undefined;
        return {
          schedulerSource: 'scheduled_tasks',
          desiredEnabled: state.heartbeatEnabled === true,
          actualStatus: task?.status ?? 'absent',
          taskId: task?.id ?? null,
          nextRun: task?.next_run ?? null,
          lastRunStatus: latestRun?.status ?? null,
          lastRunResult: latestRun?.result ?? null,
          lastRunError: latestRun?.error ?? null,
          lastRunAt: latestRun?.created_at ?? null,
          lastRunDurationMs: latestRun?.duration_ms ?? null,
          lastAttemptSource: latestRun ? 'task_run_logs' : null,
          lastMeaningfulAlert: latestAlert ? {
            source: 'task_run_logs',
            runId: latestAlert.id,
            text: latestAlert.result,
            createdAt: latestAlert.created_at,
            notificationEventId: latestAlert.notification_event_id,
          } : null,
          lastDelivery: latestDelivery ? {
            source: 'notification_deliveries',
            channel: latestDelivery.channel,
            status: latestDelivery.status,
            error: latestDelivery.error,
            attemptCount: latestDelivery.attempt_count,
            lastAttemptAt: latestDelivery.last_attempt_at,
            acceptedAt: latestDelivery.acked_at,
          } : null,
        };
      })(),
      // Codex P1 — heartbeat is now scheduler-only. The
      // `needsHeartbeat` field used to drive the foreground
      // chat-mount auto-trigger via useAssistantTrigger; we removed
      // both the trigger and this signal so no UI surface can
      // accidentally re-introduce mount-time heartbeat firing.
      // shouldRunHeartbeat is still exported for the scheduler
      // stale-check guard but must NOT be exposed over HTTP.
    });
  } catch (e) {
    console.error('[settings/workspace] GET failed:', e);
    return NextResponse.json({ error: 'Failed to load workspace info' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { path: workspacePath, initialize, resetOnboarding, ifUnconfigured } = body as {
      path: string;
      initialize?: boolean;
      resetOnboarding?: boolean;
      ifUnconfigured?: boolean;
    };

    if (!workspacePath || typeof workspacePath !== 'string') {
      return NextResponse.json({ error: 'Invalid workspace path' }, { status: 400 });
    }

    // Automatic bootstrap is a distinct, fail-closed path. It never replaces
    // a non-blank existing value and never creates an onboarding chat.
    if (ifUnconfigured) {
      if (initialize !== true) {
        return NextResponse.json(
          { error: 'Automatic bootstrap requires initialize=true' },
          { status: 400 },
        );
      }
      try {
        const result = await bootstrapDefaultAssistantWorkspace(workspacePath);
        const { reconcileAssistantHeartbeat } = await import('@/lib/assistant-heartbeat');
        const heartbeat = await reconcileAssistantHeartbeat();
        return NextResponse.json({ success: true, ...result, heartbeat });
      } catch (initErr) {
        return NextResponse.json(
          {
            error: `Failed to initialize default workspace: ${initErr instanceof Error ? initErr.message : 'unknown error'}`,
            code: 'default_init_failed',
          },
          { status: 500 },
        );
      }
    }

    // Validate the path before saving
    let pathExists = false;
    let isDirectory = false;
    try {
      const stat = fs.statSync(workspacePath);
      pathExists = true;
      isDirectory = stat.isDirectory();
    } catch { /* path doesn't exist */ }

    if (!pathExists) {
      // Only create directory tree when user explicitly requests initialization
      if (!initialize) {
        return NextResponse.json(
          { error: 'Path does not exist. Set initialize=true to create it.', code: 'path_not_found' },
          { status: 400 }
        );
      }
      // Create the directory for initialization
      try {
        fs.mkdirSync(workspacePath, { recursive: true });
      } catch (mkdirErr) {
        return NextResponse.json(
          { error: `Failed to create directory: ${mkdirErr instanceof Error ? mkdirErr.message : 'unknown error'}`, code: 'mkdir_failed' },
          { status: 400 }
        );
      }
    } else if (!isDirectory) {
      return NextResponse.json(
        { error: 'Path exists but is not a directory.', code: 'not_a_directory' },
        { status: 400 }
      );
    }

    // Check read/write permissions (on existing or newly created directory)
    try {
      fs.accessSync(workspacePath, fs.constants.R_OK | fs.constants.W_OK);
    } catch {
      return NextResponse.json(
        { error: 'Directory is not readable/writable.', code: 'permission_denied' },
        { status: 400 }
      );
    }

    // Perform initialization/reset BEFORE saving the setting (atomic: if init fails, setting is unchanged)
    let createdFiles: string[] = [];
    if (initialize) {
      try {
        createdFiles = initializeWorkspace(workspacePath);
      } catch (initErr) {
        return NextResponse.json(
          { error: `Failed to initialize workspace: ${initErr instanceof Error ? initErr.message : 'unknown error'}`, code: 'init_failed' },
          { status: 500 }
        );
      }
    }

    if (resetOnboarding) {
      try {
        const state = loadState(workspacePath);
        saveState(workspacePath, { ...state, onboardingComplete: false });
      } catch (resetErr) {
        return NextResponse.json(
          { error: `Failed to reset onboarding: ${resetErr instanceof Error ? resetErr.message : 'unknown error'}`, code: 'reset_failed' },
          { status: 500 }
        );
      }
    }

    // All side-effects succeeded — now commit the setting
    setSetting(ASSISTANT_WORKSPACE_PATH_SETTING, workspacePath);

    const { reconcileAssistantHeartbeat } = await import('@/lib/assistant-heartbeat');
    const heartbeat = await reconcileAssistantHeartbeat();

    return NextResponse.json({ success: true, createdFiles, heartbeat });
  } catch (e) {
    console.error('[settings/workspace] PUT failed:', e);
    return NextResponse.json({ error: 'Failed to save workspace settings' }, { status: 500 });
  }
}

/** PATCH — update individual state fields (e.g. heartbeatEnabled toggle) */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const workspacePath = getSetting(ASSISTANT_WORKSPACE_PATH_SETTING);
    if (!workspacePath) {
      return NextResponse.json({ error: 'No workspace configured' }, { status: 400 });
    }

    const state = loadState(workspacePath);

    // Apply supported state patches
    if ('heartbeatEnabled' in body && typeof body.heartbeatEnabled === 'boolean') {
      state.heartbeatEnabled = body.heartbeatEnabled;
    }
    // Phase 3 Step 4 — heartbeat interval (hours). Min 1h to avoid
    // background polling pressure; values < 1 are coerced to 1. Stored
    // alongside heartbeatEnabled so toggling the switch off doesn't
    // clobber the user's chosen interval.
    if ('heartbeatIntervalHours' in body && typeof body.heartbeatIntervalHours === 'number') {
      state.heartbeatIntervalHours = Math.max(1, Math.floor(body.heartbeatIntervalHours));
    }
    // Reset buddy so user can hatch a new one
    if (body.resetBuddy === true) {
      state.buddy = undefined;

      // Also remove the ## Buddy Trait section from soul.md so re-hatch gets a fresh one
      try {
        const soulVariants = ['soul.md', 'Soul.md', 'SOUL.md'];
        for (const variant of soulVariants) {
          const soulPath = path.join(workspacePath, variant);
          if (fs.existsSync(soulPath)) {
            const content = fs.readFileSync(soulPath, 'utf-8');
            // Remove ## Buddy Trait section (everything from the heading to the next ## or end of file)
            const cleaned = content.replace(/\n*## Buddy Trait[\s\S]*?(?=\n## |\n*$)/, '');
            if (cleaned !== content) {
              fs.writeFileSync(soulPath, cleaned.trimEnd() + '\n', 'utf-8');
            }
            break;
          }
        }
      } catch { /* best effort — soul.md cleanup is non-critical */ }
    }
    // Reset heartbeat date to force re-trigger on next session open
    if (body.resetHeartbeat === true) {
      state.lastHeartbeatDate = null;
      state.hookTriggeredSessionId = undefined;
      state.hookTriggeredAt = undefined;
    }

    saveState(workspacePath, state);

    // Desired state is already durable. Reconcile derived scheduler state
    // afterwards; a failure is returned honestly as `blocked` and does not
    // roll back or disguise the user's choice.
    const { reconcileAssistantHeartbeat } = await import('@/lib/assistant-heartbeat');
    const heartbeat = await reconcileAssistantHeartbeat();

    return NextResponse.json({ success: true, state, heartbeat });
  } catch (e) {
    console.error('[settings/workspace] PATCH failed:', e);
    return NextResponse.json({ error: 'Failed to update workspace state' }, { status: 500 });
  }
}
