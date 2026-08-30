/**
 * `runtime-permission-modes.md` Phase 0 + Phase 1 — the three-profile
 * semantic contract.
 *
 * The failure this file exists to prevent is not a crash. It's the day
 * `auto_review` and `full_access` quietly become the same code path and the
 * composer keeps promising the user that one of them reviews. Every assertion
 * below is either "these two profiles are DIFFERENT" or "this profile is
 * exactly what the UI says it is".
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PERMISSION_PROFILES,
  isPermissionProfile,
  normalizePermissionProfile,
  getHumanOnlyCategory,
  isHumanOnlyTool,
  isHostAutoApproved,
  isAutoReviewSupportedForVersion,
  resolveClaudeWireOptions,
  resolveEffectiveSkipPermissions,
  resolveHumanOnlyDenyTools,
  toBareToolName,
  AUTO_REVIEW_MIN_SDK_VERSION,
  HOST_AUTO_APPROVED_TOOLS,
  CODEPILOT_MCP_TOOL_SERVERS,
  buildClaudePermissionQueryOptions,
  type SessionPermissionProfile,
} from '@/lib/permission/profile';
import {
  getAgentSdkVersion,
  isAutoReviewSupported,
  getAutoReviewUnavailableReason,
} from '@/lib/permission/sdk-capability';

describe('permission profile union (a01)', () => {
  it('is exactly the three canonical profiles', () => {
    assert.deepEqual([...PERMISSION_PROFILES], ['default', 'auto_review', 'full_access']);
  });

  it('accepts every canonical profile and rejects everything else', () => {
    for (const p of PERMISSION_PROFILES) assert.equal(isPermissionProfile(p), true);
    for (const bad of ['', 'DEFAULT', 'auto', 'autoReview', 'full', 'read_only', null, undefined, 7, {}]) {
      assert.equal(isPermissionProfile(bad), false, `${String(bad)} must not validate`);
    }
  });

  it('normalizes unknown values DOWN to default, never up', () => {
    // The direction is the whole point: a garbled DB value or an old client
    // must never land on an elevated profile.
    for (const bad of ['full', 'auto', 'bypass', '', null, undefined, 42]) {
      assert.equal(normalizePermissionProfile(bad), 'default');
    }
    for (const p of PERMISSION_PROFILES) assert.equal(normalizePermissionProfile(p), p);
  });
});

describe('human-only categories (a04)', () => {
  it('AskUserQuestion is human-only — the answer is meaning, not consent', () => {
    assert.equal(getHumanOnlyCategory('AskUserQuestion'), 'interactive_question');
  });

  it('billing / publish / shell-impact tools are human-only', () => {
    assert.equal(getHumanOnlyCategory('codepilot_generate_image'), 'billing');
    assert.equal(getHumanOnlyCategory('codepilot_notify'), 'external_publish');
    assert.equal(getHumanOnlyCategory('codepilot_cli_tools_install'), 'high_impact');
    assert.equal(getHumanOnlyCategory('codepilot_cli_tools_add'), 'high_impact');
    assert.equal(getHumanOnlyCategory('codepilot_cli_tools_remove'), 'high_impact');
    assert.equal(getHumanOnlyCategory('codepilot_cli_tools_update'), 'high_impact');
  });

  it('credential-shaped tool names are human-only by derivation', () => {
    for (const name of [
      'codepilot_read_credential',
      'codepilot_get_api_key',
      'codepilot_rotate_secret',
      'codepilot_oauth_login',
    ]) {
      assert.equal(getHumanOnlyCategory(name), 'credential', `${name} must be credential-gated`);
    }
  });

  it('every mutating_external tool is human-only, even ones added later', () => {
    // Derivation, not enumeration — a new shell-exec tool is covered the day
    // it declares its mutationLevel, without touching this file.
    assert.equal(getHumanOnlyCategory('codepilot_cli_tools_install'), 'high_impact');
  });

  it('ordinary read tools are NOT human-only', () => {
    for (const name of ['Read', 'Grep', 'codepilot_memory_search', 'codepilot_dashboard_list']) {
      assert.equal(isHumanOnlyTool(name), false, `${name} should be reviewable`);
    }
  });

  it('classification survives the SDK mcp__server__tool prefix', () => {
    assert.equal(toBareToolName('mcp__codepilot-cli-tools__codepilot_cli_tools_install'), 'codepilot_cli_tools_install');
    assert.equal(getHumanOnlyCategory('mcp__codepilot-cli-tools__codepilot_cli_tools_install'), 'high_impact');
    assert.equal(getHumanOnlyCategory('mcp__codepilot-image-gen__codepilot_generate_image'), 'billing');
  });
});

describe('host auto-approval (a05)', () => {
  it('never auto-approves a human-only tool — human-only outranks the host list', () => {
    for (const name of [
      'AskUserQuestion',
      'codepilot_generate_image',
      'codepilot_notify',
      'codepilot_cli_tools_install',
      'codepilot_cli_tools_add',
    ]) {
      assert.equal(isHostAutoApproved(name), false, `${name} must reach the user`);
    }
  });

  it('auto-approves read-only tools via mutationLevel', () => {
    for (const name of ['codepilot_memory_search', 'codepilot_dashboard_list', 'codepilot_cli_tools_list', 'Read']) {
      assert.equal(isHostAutoApproved(name), true, `${name} is safe_read`);
    }
  });

  it('auto-approves the explicit CodePilot-local mutating list', () => {
    for (const name of HOST_AUTO_APPROVED_TOOLS) {
      assert.equal(isHostAutoApproved(name), true, `${name} is on the host list`);
    }
  });

  it('the host list contains no human-only tool — the list cannot drift into one', () => {
    for (const name of HOST_AUTO_APPROVED_TOOLS) {
      assert.equal(isHumanOnlyTool(name), false, `${name} must not be both host-approved and human-only`);
    }
  });

  it('unknown tools are NOT auto-approved (fail-safe: ask)', () => {
    for (const name of ['codepilot_some_future_tool', 'Bash', 'mcp__third-party__anything']) {
      assert.equal(isHostAutoApproved(name), false, `${name} must fall through to the permission path`);
    }
  });
});

describe('auto_review capability gate (a07)', () => {
  it('supports the version that shipped permissionMode auto, and later', () => {
    assert.equal(isAutoReviewSupportedForVersion(AUTO_REVIEW_MIN_SDK_VERSION), true);
    assert.equal(isAutoReviewSupportedForVersion('0.2.112'), true);
    assert.equal(isAutoReviewSupportedForVersion('0.3.0'), true);
    assert.equal(isAutoReviewSupportedForVersion('1.0.0'), true);
  });

  it('refuses older versions', () => {
    for (const v of ['0.2.110', '0.2.9', '0.1.999']) {
      assert.equal(isAutoReviewSupportedForVersion(v), false, `${v} predates permissionMode auto`);
    }
  });

  it('fails closed on a missing or unparseable version', () => {
    for (const v of [undefined, null, '', 'latest', 'not-a-version']) {
      assert.equal(isAutoReviewSupportedForVersion(v), false);
    }
  });

  it('reads a real version off the installed SDK — the probe is not vacuously null', () => {
    // Guards the reverse failure: a probe that always throws would pass every
    // negative test above while silently disabling the feature forever. It
    // caught exactly that — the SDK does not export ./package.json, so the
    // first implementation returned null on every call.
    const version = getAgentSdkVersion();
    assert.ok(version, 'could not read the installed Agent SDK version');
    assert.match(version!, /^\d+\.\d+\.\d+/);
  });

  it('the installed SDK supports auto — the gate is not vacuously false', () => {
    assert.equal(isAutoReviewSupported(), true,
      `installed SDK ${getAgentSdkVersion()} should support auto_review`);
    assert.equal(getAutoReviewUnavailableReason(), null);
  });
});

describe('Claude wire options — 3 profiles x plan/code (a03 + a06)', () => {
  const supported = true;

  type Row = {
    profile: SessionPermissionProfile;
    effectiveMode: string;
    permissionMode: string;
    bypassPermissions: boolean;
  };

  // The whole contract on one screen. If a cell changes, the user-visible
  // meaning of a permission option changed with it.
  const MATRIX: Row[] = [
    { profile: 'default', effectiveMode: 'code', permissionMode: 'acceptEdits', bypassPermissions: false },
    { profile: 'auto_review', effectiveMode: 'code', permissionMode: 'auto', bypassPermissions: false },
    { profile: 'full_access', effectiveMode: 'code', permissionMode: 'bypassPermissions', bypassPermissions: true },
    { profile: 'default', effectiveMode: 'plan', permissionMode: 'plan', bypassPermissions: false },
    { profile: 'auto_review', effectiveMode: 'plan', permissionMode: 'plan', bypassPermissions: false },
    { profile: 'full_access', effectiveMode: 'plan', permissionMode: 'plan', bypassPermissions: false },
  ];

  for (const row of MATRIX) {
    it(`${row.profile} x ${row.effectiveMode} -> ${row.permissionMode} (bypass=${row.bypassPermissions})`, () => {
      const wire = resolveClaudeWireOptions({
        profile: row.profile,
        effectiveMode: row.effectiveMode,
        autoReviewSupported: supported,
      });
      assert.equal(wire.permissionMode, row.permissionMode);
      assert.equal(wire.bypassPermissions, row.bypassPermissions);
    });
  }

  it('auto_review NEVER sets the dangerous bypass flag (a03)', () => {
    for (const effectiveMode of ['code', 'plan', 'anything-else']) {
      const wire = resolveClaudeWireOptions({ profile: 'auto_review', effectiveMode, autoReviewSupported: supported });
      assert.equal(wire.bypassPermissions, false);
      assert.notEqual(wire.permissionMode, 'bypassPermissions');
    }
  });

  it('Plan mode outranks full_access — a profile is not a licence to execute (a09)', () => {
    const wire = resolveClaudeWireOptions({ profile: 'full_access', effectiveMode: 'plan', autoReviewSupported: supported });
    assert.equal(wire.permissionMode, 'plan');
    assert.equal(wire.bypassPermissions, false);
  });

  it('Plan mode outranks even the global skip setting', () => {
    const wire = resolveClaudeWireOptions({
      profile: 'full_access', effectiveMode: 'plan', autoReviewSupported: supported, globalSkip: true,
    });
    assert.equal(wire.permissionMode, 'plan');
    assert.equal(wire.bypassPermissions, false);
  });

  it('auto_review and full_access never resolve to the same wire options', () => {
    // The one assertion that would have caught "they share an elevated branch".
    for (const effectiveMode of ['code', 'plan']) {
      const auto = resolveClaudeWireOptions({ profile: 'auto_review', effectiveMode, autoReviewSupported: supported });
      const full = resolveClaudeWireOptions({ profile: 'full_access', effectiveMode, autoReviewSupported: supported });
      if (effectiveMode === 'plan') {
        // Both collapse to read-only Plan — that IS the contract.
        assert.equal(auto.permissionMode, 'plan');
        assert.equal(full.permissionMode, 'plan');
      } else {
        assert.notDeepEqual(auto, full);
        assert.equal(auto.bypassPermissions, false);
        assert.equal(full.bypassPermissions, true);
      }
    }
  });

  describe('unsupported auto_review degrades loudly, never silently (a07)', () => {
    it('falls back to asking — not to acceptEdits, not to full_access', () => {
      const wire = resolveClaudeWireOptions({ profile: 'auto_review', effectiveMode: 'code', autoReviewSupported: false });
      assert.equal(wire.permissionMode, 'default', 'fail-closed direction is MORE asking');
      assert.equal(wire.bypassPermissions, false);
      assert.notEqual(wire.permissionMode, 'acceptEdits');
      assert.notEqual(wire.permissionMode, 'bypassPermissions');
    });

    it('reports the degrade so the UI can explain it', () => {
      const wire = resolveClaudeWireOptions({ profile: 'auto_review', effectiveMode: 'code', autoReviewSupported: false });
      assert.equal(wire.degradedReason, 'auto_review_unsupported');
    });

    it('does not mark supported profiles as degraded', () => {
      for (const profile of ['default', 'full_access'] as const) {
        const wire = resolveClaudeWireOptions({ profile, effectiveMode: 'code', autoReviewSupported: false });
        assert.equal(wire.degradedReason, undefined);
      }
    });
  });
});

/**
 * Review round #2, P1: the legacy global `dangerously_skip_permissions`
 * setting used to outrank auto_review, so the most dangerous combination
 * (a user who once flipped the global toggle, then picks 替我审批 on a
 * session) silently collapsed the reviewer into a blanket allow. The old
 * suite only ever exercised globalSkip=false, which is exactly why it stayed
 * green through the bug.
 */
describe('legacy global skip cannot widen Plan or auto_review (a03 + a09)', () => {
  it('auto_review x globalSkip stays a reviewer — the combination that used to bypass', () => {
    const wire = resolveClaudeWireOptions({
      profile: 'auto_review', effectiveMode: 'code', autoReviewSupported: true, globalSkip: true,
    });
    assert.equal(wire.permissionMode, 'auto', 'global skip must not collapse the reviewer');
    assert.equal(wire.bypassPermissions, false, 'auto_review must never set the dangerous flag');
    assert.notEqual(wire.permissionMode, 'bypassPermissions');
  });

  it('auto_review x globalSkip still denies the human-only tools', () => {
    const wire = resolveClaudeWireOptions({
      profile: 'auto_review', effectiveMode: 'code', autoReviewSupported: true, globalSkip: true,
    });
    assert.ok(
      wire.disallowedTools.some((d) => d.endsWith('__codepilot_generate_image')),
      'the global toggle must not buy back the money-spending tools',
    );
  });

  it('unsupported auto_review x globalSkip degrades to asking, NOT to bypass', () => {
    const wire = resolveClaudeWireOptions({
      profile: 'auto_review', effectiveMode: 'code', autoReviewSupported: false, globalSkip: true,
    });
    assert.equal(wire.permissionMode, 'default');
    assert.equal(wire.bypassPermissions, false);
    assert.equal(wire.degradedReason, 'auto_review_unsupported');
  });

  it('plan x globalSkip stays read-only for every profile', () => {
    for (const profile of PERMISSION_PROFILES) {
      const wire = resolveClaudeWireOptions({
        profile, effectiveMode: 'plan', autoReviewSupported: true, globalSkip: true,
      });
      assert.equal(wire.permissionMode, 'plan', `${profile} x plan x globalSkip must stay plan`);
      assert.equal(wire.bypassPermissions, false);
    }
  });

  it('globalSkip may still widen the default profile — the setting is not broken, just scoped', () => {
    const wire = resolveClaudeWireOptions({
      profile: 'default', effectiveMode: 'code', autoReviewSupported: true, globalSkip: true,
    });
    assert.equal(wire.permissionMode, 'bypassPermissions');
    assert.equal(wire.bypassPermissions, true);
  });
});

/**
 * The resolver's decision has to survive the trip into claude-client, which
 * re-reads the global setting at query-build time. This is the helper that
 * stops it re-widening what the resolver refused.
 */
describe('resolveEffectiveSkipPermissions — the final wire gate (a03)', () => {
  it('refuses to skip for auto, whatever the global setting and session flag say', () => {
    for (const globalSkip of [true, false]) {
      for (const sessionBypassPermissions of [true, false]) {
        assert.equal(
          resolveEffectiveSkipPermissions({ permissionMode: 'auto', sessionBypassPermissions, globalSkip }),
          false,
          `auto must never skip (globalSkip=${globalSkip}, sessionBypass=${sessionBypassPermissions})`,
        );
      }
    }
  });

  it('refuses to skip for plan, whatever the global setting says', () => {
    assert.equal(
      resolveEffectiveSkipPermissions({ permissionMode: 'plan', sessionBypassPermissions: true, globalSkip: true }),
      false,
    );
  });

  it('still honours the session bypass and the global skip for the other modes', () => {
    assert.equal(
      resolveEffectiveSkipPermissions({ permissionMode: 'bypassPermissions', sessionBypassPermissions: true, globalSkip: false }),
      true,
    );
    assert.equal(
      resolveEffectiveSkipPermissions({ permissionMode: 'acceptEdits', sessionBypassPermissions: false, globalSkip: true }),
      true,
    );
    assert.equal(
      resolveEffectiveSkipPermissions({ permissionMode: 'acceptEdits', sessionBypassPermissions: false, globalSkip: false }),
      false,
    );
  });
});

/**
 * Review round #2, P1: `canUseTool` is NOT a pre-review interception under
 * permissionMode 'auto' — the SDK classifier can allow a tool without ever
 * calling it. Deny rules are the only interception that runs first (verified
 * against the shipped cli.js classifier; see resolveHumanOnlyDenyTools).
 */
describe('human-only tools are denied before the SDK classifier (a04 + a09)', () => {
  it('denies billing / publishing / shell tools under auto_review', () => {
    const denied = resolveHumanOnlyDenyTools('auto');
    for (const bare of ['codepilot_generate_image', 'codepilot_notify', 'codepilot_cli_tools_install']) {
      assert.ok(
        denied.some((d) => d.endsWith(`__${bare}`)),
        `${bare} must not be left to the classifier`,
      );
    }
  });

  it('denies EVERY human-only tool in the universe, not a hand-picked few', () => {
    // Review round #3, P1: the deny list used to be six hand-written names
    // while `getHumanOnlyCategory` classified by three rules. They agreed by
    // coincidence. This asserts the invariant that makes the coincidence
    // impossible — derivation over the same universe the wire is built from.
    const denied = resolveHumanOnlyDenyTools('auto');
    for (const bare of Object.keys(CODEPILOT_MCP_TOOL_SERVERS)) {
      if (!isHumanOnlyTool(bare)) continue;
      assert.ok(
        denied.some((d) => d.endsWith(`__${bare}`)),
        `${bare} is human-only but the classifier could still approve it`,
      );
    }
  });

  it('a credential-shaped tool is denied at the wire boundary by derivation alone', () => {
    // The gap that made this a P1: a tool that is human-only ONLY by
    // derivation (name marker / mutating_external) — never added to any
    // explicit table — must still be blocked before the classifier. Injected
    // through the real universe parameter and asserted on the real assembly,
    // so this proves the wire, not a helper's opinion.
    const universe = { codepilot_rotate_api_key: 'codepilot-secrets' };
    assert.equal(getHumanOnlyCategory('codepilot_rotate_api_key'), 'credential',
      'precondition: the name marker classifies it');

    assert.deepEqual(
      resolveHumanOnlyDenyTools('auto', universe),
      ['mcp__codepilot-secrets__codepilot_rotate_api_key'],
    );

    const { disallowedTools } = buildClaudePermissionQueryOptions({
      permissionMode: 'auto',
      sessionBypassPermissions: false,
      globalSkip: false,
      isHeartbeatMode: false,
      toolUniverse: universe,
      // Required for 'auto' to survive at all — see the external-MCP gate.
      externalMcp: { present: false },
    });
    assert.ok(disallowedTools?.includes('mcp__codepilot-secrets__codepilot_rotate_api_key'),
      'a credential-shaped tool must reach disallowedTools on the real wire');
  });

  it('the deny universe matches the servers claude-client actually registers', async () => {
    // Introspects the REAL server instances: if a tool is added to a server and
    // not to CODEPILOT_MCP_TOOL_SERVERS, derivation would silently skip it —
    // which is exactly how the previous hand-written table went stale.
    const [memory, notify, media, imageGen, cliTools, dashboard, widget, subagent] = await Promise.all([
      import('@/lib/memory-search-mcp'), import('@/lib/notification-mcp'),
      import('@/lib/media-import-mcp'), import('@/lib/image-gen-mcp'),
      import('@/lib/cli-tools-mcp'), import('@/lib/dashboard-mcp'),
      import('@/lib/widget-guidelines'), import('@/lib/claude-subagent-mcp'),
    ]);
    const servers: Record<string, { instance: { _registeredTools: Record<string, unknown> } }> = {
      'codepilot-memory': memory.createMemorySearchMcpServer('/tmp') as never,
      'codepilot-notify': notify.createNotificationMcpServer({} as never) as never,
      'codepilot-media': media.createMediaImportMcpServer('s', '/tmp') as never,
      'codepilot-image-gen': imageGen.createImageGenMcpServer('s', '/tmp') as never,
      'codepilot-cli-tools': cliTools.createCliToolsMcpServer() as never,
      'codepilot-dashboard': dashboard.createDashboardMcpServer('s', '/tmp') as never,
      'codepilot-widget': widget.createWidgetMcpServer() as never,
      'codepilot-subagent': subagent.createClaudeSubagentMcpServer({
        sessionId: 's',
        workingDirectory: '/tmp',
        routes: [],
      }) as never,
    };

    for (const [serverKey, server] of Object.entries(servers)) {
      for (const toolName of Object.keys(server.instance._registeredTools)) {
        assert.equal(
          CODEPILOT_MCP_TOOL_SERVERS[toolName], serverKey,
          `${toolName} is registered on ${serverKey} but the deny universe disagrees — ` +
          'add it to CODEPILOT_MCP_TOOL_SERVERS or the auto_review deny list will skip it',
        );
      }
    }
  });

  it('denies nothing in the modes where the tools go to a human anyway', () => {
    for (const mode of ['default', 'acceptEdits', 'plan', 'bypassPermissions'] as const) {
      assert.deepEqual(
        resolveHumanOnlyDenyTools(mode), [],
        `${mode} has no classifier to intercept, so the tools stay available`,
      );
    }
  });

  it('every deny entry is fully qualified — a bare name would never match an MCP rule', () => {
    for (const qualified of resolveHumanOnlyDenyTools('auto')) {
      assert.match(qualified, /^mcp__[^_]+(?:-[^_]+)*__codepilot_/,
        `${qualified} must be mcp__server__tool`);
    }
  });

  it('AskUserQuestion stays available — the SDK already routes it to a human', () => {
    // Deliberately absent from the deny list: the SDK declares it
    // requiresUserInteraction, so the classifier never sees it, and denying it
    // would break the model's ability to ask the user anything at all.
    assert.equal(isHumanOnlyTool('AskUserQuestion'), true, 'it is still human-only...');
    assert.ok(
      !resolveHumanOnlyDenyTools('auto').some((d) => d.endsWith('AskUserQuestion')),
      '...but must never be denied outright',
    );
  });

  it('does not deny the safe read-only tools of the same servers', () => {
    const denied = resolveHumanOnlyDenyTools('auto');
    for (const safe of ['codepilot_cli_tools_list', 'codepilot_dashboard_list', 'codepilot_memory_search']) {
      assert.ok(
        !denied.some((d) => d.endsWith(`__${safe}`)),
        `${safe} is read-only and must stay usable under auto_review`,
      );
    }
  });
});
