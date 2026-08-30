/**
 * Canonical CodePilot permission profile → Codex app-server wire mapping.
 *
 * Source: codex-cli 0.145.0-alpha.18 generated app-server schema:
 * - thread/start + thread/resume: approvalPolicy, approvalsReviewer, sandbox
 * - turn/start: approvalPolicy, approvalsReviewer, sandboxPolicy
 * - ApprovalsReviewer: user | auto_review | guardian_subagent
 *
 * The reviewer axis and sandbox axis stay separate. In particular,
 * auto_review is a workspace sandbox with model-reviewed escalation; it is
 * never the danger-full-access bypass.
 */

export type CodexApprovalPolicy = 'untrusted' | 'on-request' | 'never';
export type CodexApprovalsReviewer = 'user' | 'auto_review';
export type CodexThreadSandbox = 'read-only' | 'workspace-write' | 'danger-full-access';

// Codex app-server 0.145.0-alpha.27 generates `networkAccess: boolean`
// for both constrained sandbox variants. Network access is an independent
// axis from local filesystem write scope, so keeping a workspace/read-only
// sandbox does not require silently disabling the native network tool path.
export type CodexSandboxPolicy =
  | { type: 'readOnly'; networkAccess: boolean }
  | { type: 'workspaceWrite'; writableRoots: string[]; networkAccess: boolean }
  | { type: 'dangerFullAccess' };

export interface CodexPermissionWire {
  readonly thread: {
    readonly approvalPolicy: CodexApprovalPolicy;
    readonly approvalsReviewer: CodexApprovalsReviewer;
    readonly sandbox: CodexThreadSandbox;
  };
  readonly turn: {
    readonly approvalPolicy: CodexApprovalPolicy;
    readonly approvalsReviewer: CodexApprovalsReviewer;
    readonly sandboxPolicy: CodexSandboxPolicy;
  };
}

export interface CodexThreadPermissionEcho {
  readonly approvalsReviewer?: unknown;
}

export interface CodexPermissionEchoDecision {
  readonly wire: CodexPermissionWire;
  readonly degraded: boolean;
  readonly actualReviewer: string | null;
}

export function resolveCodexPermissionWire(input: {
  readonly permissionMode?: string;
  readonly bypassPermissions?: boolean;
}): CodexPermissionWire {
  const { permissionMode, bypassPermissions = false } = input;

  if (permissionMode === 'plan') {
    return {
      thread: {
        approvalPolicy: 'never',
        approvalsReviewer: 'user',
        sandbox: 'read-only',
      },
      turn: {
        approvalPolicy: 'never',
        approvalsReviewer: 'user',
        sandboxPolicy: { type: 'readOnly', networkAccess: true },
      },
    };
  }

  if (permissionMode === 'bypassPermissions' || bypassPermissions) {
    return {
      thread: {
        approvalPolicy: 'never',
        approvalsReviewer: 'user',
        sandbox: 'danger-full-access',
      },
      turn: {
        approvalPolicy: 'never',
        approvalsReviewer: 'user',
        sandboxPolicy: { type: 'dangerFullAccess' },
      },
    };
  }

  if (permissionMode === 'auto') {
    return {
      thread: {
        approvalPolicy: 'on-request',
        approvalsReviewer: 'auto_review',
        sandbox: 'workspace-write',
      },
      turn: {
        approvalPolicy: 'on-request',
        approvalsReviewer: 'auto_review',
        sandboxPolicy: { type: 'workspaceWrite', writableRoots: [], networkAccess: true },
      },
    };
  }

  return {
    thread: {
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      sandbox: 'workspace-write',
    },
    turn: {
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      sandboxPolicy: { type: 'workspaceWrite', writableRoots: [], networkAccess: true },
    },
  };
}

/**
 * Treat the app-server thread response as the authority for auto-review.
 *
 * Older Codex builds may ignore an unknown `approvalsReviewer` request field.
 * A successful JSON-RPC response therefore proves only that the method ran,
 * not that the reviewer was installed. Current app-server responses echo the
 * effective reviewer; anything other than the requested `auto_review` is a
 * loud, fail-closed downgrade to ordinary user approval for this turn.
 */
export function reconcileCodexPermissionEcho(input: {
  readonly requested: CodexPermissionWire;
  readonly response: CodexThreadPermissionEcho;
}): CodexPermissionEchoDecision {
  const actualReviewer = typeof input.response.approvalsReviewer === 'string'
    ? input.response.approvalsReviewer
    : null;
  if (input.requested.thread.approvalsReviewer !== 'auto_review' || actualReviewer === 'auto_review') {
    return { wire: input.requested, degraded: false, actualReviewer };
  }
  return {
    wire: resolveCodexPermissionWire({ permissionMode: 'default' }),
    degraded: true,
    actualReviewer,
  };
}
