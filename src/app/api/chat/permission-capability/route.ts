import { NextResponse } from 'next/server';
import { PERMISSION_PROFILES } from '@/lib/permission/profile';
import { isAutoReviewSupported, getAutoReviewUnavailableReason } from '@/lib/permission/sdk-capability';
import { probeExternalMcp } from '@/lib/permission/external-mcp';
import { isRuntimeId } from '@/lib/runtime/runtime-id';
import { serverErrorResponse } from '@/lib/api-error';
import { getCodexAutoReviewCapability } from '@/lib/codex/app-server-manager';

/**
 * Which permission profiles this build can actually honour, and why not when
 * it can't (`runtime-permission-modes.md` Phase 1, a07).
 *
 * The composer reads this instead of assuming `auto_review` works. Two
 * independent gates can refuse it, and they are reported as distinct reasons
 * because they have distinct remedies:
 *
 *   1. `runtime`      — Native AI SDK has no session-level model reviewer.
 *      Claude uses Agent SDK `permissionMode:auto`; Codex uses app-server
 *      `approvalsReviewer:auto_review`, so both bypass this refusal. Breadcrumb:
 *      the `runtime` query param (the composer's effective ChatRuntime).
 *   2. `sdk_version`  — the installed Agent SDK has no `permissionMode: 'auto'`.
 *      A fact about node_modules. Breadcrumb: the package manifest.
 *   3. `external_mcp` — an external MCP server could load, and its tools cannot
 *      be classified before the SDK's auto-mode classifier sees them (review
 *      round #4 P1). Breadcrumb: the config files named in `sources`.
 *
 * ## Why this probes the WIDEST settingSources
 *
 * The real per-turn answer depends on the resolved provider (DB providers run
 * `['user']`, env mode `['user','project','local']`), which this endpoint has
 * no request to resolve against. It therefore probes all three layers, which
 * can only over-report presence. That direction is intended: the UI may say
 * "unavailable" for a turn that would have been fine, but it can never offer
 * 替我审批 for a turn that would ship an unclassified external tool. The
 * shipping boundary (`buildClaudePermissionQueryOptions`) re-decides with the
 * turn's real settingSources and is the authority; this endpoint only decides
 * what to show.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    // The chat's working directory. Absent (new chat, no workspace yet) just
    // means the project/local layers aren't probed — user-level still is.
    const cwd = searchParams.get('cwd') ?? undefined;
    // The composer's effective ChatRuntime for this session. The composer always
    // sends it post review-round-6; an absent/unknown value is treated as
    // Claude Code for back-compat with older clients (the server-side shipping
    // boundary in claude-client re-decides against the REAL resolved runtime, so
    // this endpoint only governs what the dropdown shows).
    const runtime = searchParams.get('runtime') ?? undefined;

    // Codex owns an independent reviewer axis and does not depend on the Claude
    // Agent SDK. The option is nevertheless version-gated: older app-server
    // builds may accept an unknown request field without applying it, so an
    // unconditional `supported:true` would turn the selector into a false
    // promise. The runtime separately verifies the thread response echo.
    if (runtime === 'codex_runtime') {
      const codexCapability = getCodexAutoReviewCapability();
      return NextResponse.json({
        profiles: PERMISSION_PROFILES,
        autoReview: {
          supported: codexCapability.supported,
          source: 'codex --version + thread response approvalsReviewer echo',
          runtime,
          minVersion: codexCapability.minVersion,
          installedVersion: codexCapability.installedVersion,
          ...(!codexCapability.supported ? { unavailableReason: 'codex_version' } : {}),
        },
      });
    }

    // Native AI SDK has per-tool approval primitives but no session-level
    // model reviewer. Keep it unavailable rather than presenting ordinary
    // tool approval as the stronger "替我审批" promise.
    if (runtime && isRuntimeId(runtime) && runtime !== 'claude_code') {
      return NextResponse.json({
        profiles: PERMISSION_PROFILES,
        autoReview: {
          supported: false,
          source: 'session.effectiveRuntime',
          unavailableReason: 'runtime',
          runtime,
        },
      });
    }

    const sdkSupported = isAutoReviewSupported();
    const sdkUnavailable = getAutoReviewUnavailableReason();
    const externalMcp = probeExternalMcp({
      workingDirectory: cwd,
      settingSources: ['user', 'project', 'local'],
    });

    // SDK version is reported first when both gates refuse: it's the more
    // fundamental one, and "upgrade the SDK" is actionable even for a user who
    // also has MCP servers configured.
    const unavailableReason = !sdkSupported
      ? 'sdk_version'
      : externalMcp.present
        ? 'external_mcp'
        : undefined;

    return NextResponse.json({
      profiles: PERMISSION_PROFILES,
      autoReview: {
        supported: sdkSupported && !externalMcp.present,
        source: 'claude-agent-sdk/package.json#version + mcp config scan',
        ...(unavailableReason ? { unavailableReason } : {}),
        ...(sdkUnavailable ?? {}),
        externalMcp: externalMcp.present
          ? { present: true, certainty: externalMcp.certainty, sources: externalMcp.sources }
          : { present: false },
      },
    });
  } catch (error) {
    return serverErrorResponse('GET /api/chat/permission-capability', error);
  }
}
