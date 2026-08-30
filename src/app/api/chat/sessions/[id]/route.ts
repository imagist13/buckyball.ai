import { NextRequest } from 'next/server';
import { deleteSession, getSession, updateSessionWorkingDirectory, updateSessionTitle, updateSessionMode, updateSessionAccessLevel, updateSessionModel, updateSessionProviderId, clearSessionMessages, updateSdkSessionId, updateSessionPermissionProfile, updateSessionRuntime } from '@/lib/db';
import { sanitizeManualTitle } from '@/lib/conversation-title';
import { autoApprovePendingForSession } from '@/lib/bridge/permission-broker';
import { clearRuntimeSessionRef } from '@/lib/runtime/session-store';
import { isRuntimeId, RUNTIME_IDS } from '@/lib/runtime/runtime-id';
import { isPermissionProfile, normalizePermissionProfile, PERMISSION_PROFILES } from '@/lib/permission/profile';
import path from 'node:path';
import { isExistingDirectory } from '@/lib/working-directory';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = getSession(id);
    if (!session) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }
    return Response.json({ session });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get session';
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = getSession(id);
    if (!session) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    const body = await request.json();

    // Validate the consolidated access-level pair before performing ANY write.
    // The composer sends mode + permission_profile in one PATCH; accepting the
    // mode and only then rejecting a bad profile would leave a partially
    // applied permission transition.
    if (body.mode !== undefined && !['code', 'plan', 'ask'].includes(body.mode)) {
      return Response.json(
        { error: 'mode must be one of: code, plan, ask' },
        { status: 400 },
      );
    }
    if (body.permission_profile !== undefined && !isPermissionProfile(body.permission_profile)) {
      return Response.json(
        { error: `permission_profile must be one of: ${PERMISSION_PROFILES.join(', ')}` },
        { status: 400 },
      );
    }
    const hasConsolidatedAccessPair = body.mode !== undefined
      && body.permission_profile !== undefined;

    if (body.working_directory) {
      const workingDirectory = typeof body.working_directory === 'string'
        ? body.working_directory.trim()
        : '';
      if (!path.isAbsolute(workingDirectory) || !isExistingDirectory(workingDirectory)) {
        return Response.json(
          { error: 'Working directory must be an existing absolute directory', code: 'INVALID_DIRECTORY' },
          { status: 400 },
        );
      }
      updateSessionWorkingDirectory(id, path.normalize(workingDirectory));
    }
    // Rename. `if (body.title)` used to be the whole validation, so a title of
    // "   " or a lone NUL byte was stored verbatim and rendered as a blank sidebar
    // row the user couldn't tell apart from a bug. Validate + canonicalize
    // through the shared pure function, and reject rather than silently
    // storing junk. `undefined` still means "not renaming in this PATCH".
    if (body.title !== undefined) {
      const result = sanitizeManualTitle(body.title);
      if (!result.ok) {
        return Response.json({ error: result.error }, { status: 400 });
      }
      // origin 'manual' with no expectOrigin: the user is explicitly naming
      // this chat, which outranks every automatic writer from now on.
      updateSessionTitle(id, result.title, 'manual');

      // Keep an existing Codex thread label aligned with CodePilot's canonical
      // title. Fire-and-forget so an unavailable/old app-server can never make
      // the local rename spinner wait for its 30s RPC timeout.
      if (session.codex_thread_id) {
        import('@/lib/codex/thread-name')
          .then(({ syncCodexThreadName }) => syncCodexThreadName(id, result.title))
          .catch(() => { /* local manual rename already succeeded */ });
      }
    }
    if (body.mode) {
      if (hasConsolidatedAccessPair) {
        updateSessionAccessLevel(id, body.mode, body.permission_profile);
      } else {
        updateSessionMode(id, body.mode);
      }
    }
    // Track whether provider, model, or runtime_pin actually changed — if so,
    // the old sdk_session_id is stale and must be cleared to prevent resume
    // failures against a different provider/model/runtime (fixes #343, #346;
    // Step 4c extends to runtime_pin since SDK sessions can't survive a
    // runtime swap either).
    const modelChanged = body.model !== undefined && body.model !== session.model;
    const providerChanged = body.provider_id !== undefined && body.provider_id !== session.provider_id;
    let runtimePinChanged = false;
    // Phase 5 review round 4 (2026-05-13) — accept any registered
    // RuntimeId (claude_code / codepilot_runtime / codex_runtime / …)
    // via the canonical isRuntimeId guard. The earlier hard-coded
    // whitelist hard-rejected codex_runtime even though RUNTIME_IDS
    // includes it, so the composer's PATCH from RuntimeSelector
    // silently 400'd and the session ended up with provider_id =
    // codex_account + runtime_pin = codepilot_runtime — exactly the
    // mismatch Codex caught in round 4 review.
    if (body.runtime_pin !== undefined) {
      if (body.runtime_pin !== '' && !isRuntimeId(body.runtime_pin)) {
        return Response.json(
          {
            error: `runtime_pin must be "" or one of: ${RUNTIME_IDS.join(', ')}`,
          },
          { status: 400 },
        );
      }
      runtimePinChanged = body.runtime_pin !== (session.runtime_pin || '');
      if (runtimePinChanged) {
        updateSessionRuntime(id, body.runtime_pin);
      }
    }

    // Phase 5 review round 4 (2026-05-13) — provider/runtime coherence
    // guard. codex_account models flow ONLY through Codex Runtime;
    // persisting (provider_id=codex_account, runtime_pin=other) is a
    // contradiction that the composer's split picker is too easy to
    // produce (provider PATCH fires from the model picker, runtime
    // PATCH fires from the RuntimeSelector — separate user actions).
    // Force runtime_pin to codex_runtime when picking codex_account,
    // so the chat send route resolves a coherent (provider, runtime)
    // pair without needing the client to remember the linkage.
    let coherenceForcedRuntime: 'codex_runtime' | null = null;
    if (body.provider_id === 'codex_account' && body.runtime_pin === undefined) {
      const currentPin = session.runtime_pin || '';
      if (currentPin !== 'codex_runtime') {
        updateSessionRuntime(id, 'codex_runtime');
        coherenceForcedRuntime = 'codex_runtime';
        runtimePinChanged = true;
      }
    }

    if (body.model !== undefined) {
      updateSessionModel(id, body.model);
    }
    if (body.provider_id !== undefined) {
      updateSessionProviderId(id, body.provider_id);
    }
    if (body.sdk_session_id !== undefined) {
      updateSdkSessionId(id, body.sdk_session_id);
    }

    // Server-side guard: when provider, model, or runtime_pin changed and the
    // caller didn't explicitly set sdk_session_id in the same request,
    // force-clear it so the next chat message starts a fresh SDK session
    // instead of trying to resume the old one (which would fail with a
    // different provider/model/runtime).
    //
    // Phase 0.5 Slice C (2026-05-13) — clear through the runtime session
    // store abstraction so future Codex Runtime adds its clearing path
    // here without poking sdk_session_id directly. Only the claude_code
    // ref is cleared; other runtimes (none today; codex_runtime later)
    // keep their refs across this operation per the cross-runtime
    // metadata invariant.
    if ((modelChanged || providerChanged || runtimePinChanged) && body.sdk_session_id === undefined) {
      if (session.sdk_session_id) {
        console.log(
          `[session-api] Provider/model/runtime changed for session ${id}, clearing stale sdk_session_id`,
          { modelChanged, providerChanged, runtimePinChanged, oldSdkSessionId: session.sdk_session_id.slice(0, 8) + '...' }
        );
      }
      clearRuntimeSessionRef(id, 'claude_code');
    }
    if (body.permission_profile !== undefined) {
      // A profile change only governs requests made AFTER it lands — an
      // in-flight prompt keeps the semantics it was raised under. The one
      // exception is the deliberate full_access elevation below: the user
      // asked for "stop asking me", and the request they're staring at is
      // the one they meant. Switching to/from auto_review resolves nothing —
      // the pending prompt stays a human decision.
      const previousProfile = normalizePermissionProfile(session.permission_profile);
      if (!hasConsolidatedAccessPair) {
        updateSessionPermissionProfile(id, body.permission_profile);
      }
      if (previousProfile !== 'full_access' && body.permission_profile === 'full_access') {
        try {
          autoApprovePendingForSession(id);
        } catch (err) {
          console.warn('[session-api] Failed to auto-approve pending permissions:', err);
        }
      }
    }
    if (body.clear_messages) {
      clearSessionMessages(id);
    }

    const updated = getSession(id);
    // Phase 5 review round 4 — surface the coherence force-set so the
    // client can show a small toast ("session switched to Codex Runtime"),
    // mirroring the explicit transcript marker pattern used by the
    // existing RuntimeSelector mid-chat switch.
    return Response.json({
      session: updated,
      ...(coherenceForcedRuntime ? { coherence: { forcedRuntimePin: coherenceForcedRuntime } } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update session';
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = getSession(id);
    if (!session) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }

    deleteSession(id);
    return Response.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete session';
    return Response.json({ error: message }, { status: 500 });
  }
}
