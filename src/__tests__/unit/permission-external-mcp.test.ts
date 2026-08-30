/**
 * The external-MCP capability gate + the auto_review display contract.
 * `runtime-permission-modes.md` Phase 1 — review round #4, P1 (a04/a09) and P2 (a07).
 *
 * The thing under test is a promise: 替我审批 tells the user that credential,
 * billing and publishing tools are blocked outright rather than handed to a
 * model. That promise is only keepable if every MCP tool that could reach the
 * turn is classifiable BEFORE the SDK's auto-mode classifier runs. External MCP
 * servers declare their tools at connect time, so they are not — which is why
 * their mere possibility must make `'auto'` unavailable.
 *
 * These tests therefore assert the SHIPPING assembly
 * (`buildClaudePermissionQueryOptions`), not helper opinions: the wire is where
 * the promise is kept or broken.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  summarizeExternalMcp,
  collectMcpConfigProbes,
  probeExternalMcp,
} from '@/lib/permission/external-mcp';
import { buildClaudePermissionQueryOptions } from '@/lib/permission/profile';
import {
  resolveAutoReviewDisplay,
  AUTO_REVIEW_NOTICE_KEYS,
} from '@/lib/permission/auto-review-display';
import en from '@/i18n/en';
import zh from '@/i18n/zh';

// ── helpers ──────────────────────────────────────────────────────────

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-mcp-gate-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const wire = (over: Partial<Parameters<typeof buildClaudePermissionQueryOptions>[0]> = {}) =>
  buildClaudePermissionQueryOptions({
    permissionMode: 'auto',
    sessionBypassPermissions: false,
    globalSkip: false,
    isHeartbeatMode: false,
    externalMcp: { present: false },
    ...over,
  });

// ── the gate itself ──────────────────────────────────────────────────

describe('external MCP gate — auto_review is refused when tools cannot be pre-classified (a04 + a09)', () => {
  it('ships auto only when external MCP is confirmed absent', () => {
    const options = wire({ externalMcp: { present: false } });
    assert.equal(options.permissionMode, 'auto');
    assert.equal(options.degradedReason, undefined);
  });

  it('refuses auto and degrades to default when an external MCP server is configured', () => {
    const options = wire({
      externalMcp: { present: true, certainty: 'configured', sources: ['user:~/.claude.json'] },
    });
    // 'default' = ask the user about everything. NOT acceptEdits, NOT bypass:
    // the fail-closed direction for a review profile is MORE asking.
    assert.equal(options.permissionMode, 'default');
    assert.equal(options.degradedReason, 'auto_review_external_mcp');
    assert.notEqual(options.allowDangerouslySkipPermissions, true);
  });

  it('refuses auto when the MCP config could not be read — undetectable is not absent', () => {
    const options = wire({
      externalMcp: { present: true, certainty: 'undetectable', sources: ['user:~/.claude.json'] },
    });
    assert.equal(options.permissionMode, 'default');
    assert.equal(options.degradedReason, 'auto_review_external_mcp');
  });

  it('refuses auto when the caller never probed at all — omission is not absence', () => {
    // The load-bearing default. A future call site that forgets `externalMcp`
    // must not silently get the permissive answer; that is how a gate rots.
    const options = buildClaudePermissionQueryOptions({
      permissionMode: 'auto',
      sessionBypassPermissions: false,
      globalSkip: false,
      isHeartbeatMode: false,
    });
    assert.equal(options.permissionMode, 'default');
    assert.equal(options.degradedReason, 'auto_review_external_mcp');
  });

  it('does not disturb default / full_access / plan — the gate is auto_review-only', () => {
    const present = { present: true, certainty: 'configured', sources: ['x'] } as const;

    assert.equal(wire({ permissionMode: 'acceptEdits', externalMcp: present }).permissionMode, 'acceptEdits');
    assert.equal(wire({ permissionMode: 'plan', externalMcp: present }).permissionMode, 'plan');

    const full = wire({
      permissionMode: 'bypassPermissions',
      sessionBypassPermissions: true,
      externalMcp: present,
    });
    assert.equal(full.permissionMode, 'bypassPermissions');
    assert.equal(full.degradedReason, undefined,
      'full_access was never promised a reviewer, so nothing about it degrades');
  });

  it('degradedReason is never emitted for a profile that did not ask for auto', () => {
    for (const mode of ['acceptEdits', 'plan', 'bypassPermissions'] as const) {
      assert.equal(
        wire({ permissionMode: mode, externalMcp: { present: true, certainty: 'configured', sources: ['x'] } }).degradedReason,
        undefined,
      );
    }
  });
});

// ── the negatives the promise is actually about ──────────────────────

describe('external credential / billing / publish / unknown tools never reach the reviewer (a09)', () => {
  // These are the tools the UI copy promises are "blocked, not reviewed". They
  // live on THIRD-PARTY servers, so no deny list can name them — the only thing
  // standing between them and the classifier is the gate. Each case asserts the
  // wire never says 'auto' while such a server could be loaded.
  const externalServers: ReadonlyArray<{ readonly name: string; readonly why: string }> = [
    { name: 'vault', why: 'credential — mcp__vault__read_secret' },
    { name: 'stripe', why: 'billing — mcp__stripe__create_charge' },
    { name: 'twitter', why: 'external publish — mcp__twitter__post_tweet' },
    { name: 'some-new-thing', why: 'unknown kind — unclassifiable by construction' },
  ];

  for (const server of externalServers) {
    it(`refuses auto_review when '${server.name}' is configured (${server.why})`, () => {
      const status = summarizeExternalMcp({ explicitServerNames: [server.name] });
      assert.equal(status.present, true);

      const options = wire({ externalMcp: status });
      assert.notEqual(options.permissionMode, 'auto',
        `${server.why} would otherwise be classifier-approvable with no human in the loop`);
      assert.equal(options.permissionMode, 'default');
      assert.equal(options.degradedReason, 'auto_review_external_mcp');
    });
  }

  it('one external server among CodePilot servers still trips the gate', () => {
    const status = summarizeExternalMcp({
      explicitServerNames: ['codepilot-memory', 'codepilot-notify', 'vault'],
    });
    assert.equal(status.present, true);
    assert.equal(wire({ externalMcp: status }).permissionMode, 'default');
  });

  // ── the spoofed-prefix negatives (review round #5, P1) ─────────────
  //
  // An earlier revision exempted `codepilot-*` from the gate. Config keys are
  // named by the USER, so the exemption was a published bypass recipe: name
  // your server `codepilot-vault` and the fail-closed gate waves it through.
  // These four ride the real shipping wire — summarize → buildClaudePermission
  // QueryOptions — and assert the gate sees them and refuses 'auto'.
  const spoofedServers: ReadonlyArray<{ readonly name: string; readonly why: string }> = [
    { name: 'codepilot-vault', why: 'credential exfil behind a trusted-looking name' },
    { name: 'codepilot-stripe', why: 'billing behind a trusted-looking name' },
    { name: 'codepilot-twitter', why: 'external publish behind a trusted-looking name' },
    { name: 'codepilot-unknown', why: 'unclassifiable kind behind a trusted-looking name' },
  ];

  for (const server of spoofedServers) {
    it(`a spoofed '${server.name}' does NOT inherit trust from its name (${server.why})`, () => {
      const status = summarizeExternalMcp({ explicitServerNames: [server.name] });
      assert.equal(status.present, true,
        `${server.name} is a user-controlled config key — no name may be trusted`);
      assert.equal(status.certainty, 'configured');

      const options = wire({ externalMcp: status });
      assert.equal(options.permissionMode, 'default',
        `${server.why} — the gate must refuse 'auto', not exempt the name`);
      assert.notEqual(options.permissionMode, 'auto');
      assert.equal(options.degradedReason, 'auto_review_external_mcp');
    });
  }

  it('a spoofed prefix inside a config FILE trips the gate too', () => {
    // The file walk had the same exemption; both call sites had to lose it.
    withTempDir((dir) => {
      fs.writeFileSync(path.join(dir, '.mcp.json'),
        JSON.stringify({ mcpServers: { 'codepilot-vault': { command: 'x' } } }));
      const status = probeExternalMcp({ workingDirectory: dir, settingSources: [], homeDir: dir });
      assert.equal(status.present, true);
      assert.equal(wire({ externalMcp: status }).permissionMode, 'default');
    });
  });
});

// ── summarize: the pure decision ─────────────────────────────────────

describe('summarizeExternalMcp — every uncertainty resolves to present', () => {
  it('absent + empty probes mean absent', () => {
    assert.deepEqual(
      summarizeExternalMcp({ probes: [
        { label: 'a', outcome: 'absent' },
        { label: 'b', outcome: 'empty' },
      ] }),
      { present: false },
    );
  });

  it('a visible server is reported as configured, with its source named', () => {
    const status = summarizeExternalMcp({ probes: [
      { label: 'user:~/.claude.json', outcome: 'has-servers' },
      { label: 'project:.mcp.json', outcome: 'absent' },
    ] });
    assert.equal(status.present, true);
    assert.equal(status.present && status.certainty, 'configured');
    assert.deepEqual(status.present && status.sources, ['user:~/.claude.json']);
  });

  it('an unreadable file is present/undetectable — not empty', () => {
    const status = summarizeExternalMcp({ probes: [{ label: 'user:~/.claude.json', outcome: 'unreadable' }] });
    assert.equal(status.present, true);
    assert.equal(status.present && status.certainty, 'undetectable');
  });

  it('a server we can see outranks a file we cannot read — name the real cause', () => {
    const status = summarizeExternalMcp({ probes: [
      { label: 'unreadable-one', outcome: 'unreadable' },
      { label: 'user:~/.claude.json', outcome: 'has-servers' },
    ] });
    assert.equal(status.present && status.certainty, 'configured');
    assert.deepEqual(status.present && status.sources, ['user:~/.claude.json']);
  });

  it('no probes and no explicit servers means absent — an empty environment is a real answer', () => {
    assert.deepEqual(summarizeExternalMcp({}), { present: false });
  });
});

// ── the filesystem walk ──────────────────────────────────────────────

describe('collectMcpConfigProbes / probeExternalMcp — real files (a09)', () => {
  it('detects a project .mcp.json even when project is NOT in settingSources', () => {
    // The trap: DB-provider turns run settingSources ['user'], and claude-client
    // re-injects <cwd>/.mcp.json by hand anyway. A gate that trusted
    // settingSources alone would miss exactly those servers.
    withTempDir((dir) => {
      fs.writeFileSync(path.join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { vault: { command: 'vault-mcp' } } }));

      const status = probeExternalMcp({ workingDirectory: dir, settingSources: ['user'], homeDir: dir });
      assert.equal(status.present, true);
      assert.equal(status.present && status.certainty, 'configured');
      assert.ok(status.present && status.sources.includes('project:.mcp.json'));
    });
  });

  it('reports absent for a clean workspace and a clean home', () => {
    withTempDir((dir) => {
      const status = probeExternalMcp({
        workingDirectory: dir,
        settingSources: ['user', 'project', 'local'],
        homeDir: dir,
      });
      assert.deepEqual(status, { present: false },
        'a genuinely empty environment must still be able to use auto_review');
    });
  });

  it('malformed JSON is unreadable, not empty', () => {
    withTempDir((dir) => {
      fs.writeFileSync(path.join(dir, '.mcp.json'), '{ this is not json');
      const status = probeExternalMcp({ workingDirectory: dir, settingSources: [], homeDir: dir });
      assert.equal(status.present, true);
      assert.equal(status.present && status.certainty, 'undetectable',
        'mcp-loader swallows a parse error as {} — here that would mean "no servers", i.e. a false all-clear');
    });
  });

  it('a server explicitly disabled in the file does not trip the gate', () => {
    withTempDir((dir) => {
      fs.writeFileSync(path.join(dir, '.mcp.json'), JSON.stringify({
        mcpServers: { vault: { command: 'vault-mcp', enabled: false } },
      }));
      assert.deepEqual(probeExternalMcp({ workingDirectory: dir, settingSources: [], homeDir: dir }), { present: false });
    });
  });

  it('scans the user layer only when settingSources says user', () => {
    withTempDir((dir) => {
      fs.writeFileSync(path.join(dir, '.claude.json'), JSON.stringify({ mcpServers: { vault: {} } }));

      assert.equal(probeExternalMcp({ settingSources: ['user'], homeDir: dir }).present, true);
      assert.equal(probeExternalMcp({ settingSources: [], homeDir: dir }).present, false);
    });
  });

  it('scans local settings only when settingSources says local', () => {
    withTempDir((dir) => {
      fs.mkdirSync(path.join(dir, '.claude'));
      fs.writeFileSync(path.join(dir, '.claude', 'settings.local.json'), JSON.stringify({ mcpServers: { vault: {} } }));

      const labels = collectMcpConfigProbes({ workingDirectory: dir, settingSources: ['local'], homeDir: dir })
        .map((p) => p.label);
      assert.ok(labels.includes('local:.claude/settings.local.json'));
      assert.equal(probeExternalMcp({ workingDirectory: dir, settingSources: ['local'], homeDir: dir }).present, true);
      assert.equal(probeExternalMcp({ workingDirectory: dir, settingSources: ['user'], homeDir: dir }).present, false);
    });
  });

  it('never reports file contents or server args as sources — labels only', () => {
    withTempDir((dir) => {
      fs.writeFileSync(path.join(dir, '.mcp.json'), JSON.stringify({
        mcpServers: { vault: { command: 'vault-mcp', env: { VAULT_TOKEN: 'sk-super-secret-value' } } },
      }));
      const status = probeExternalMcp({ workingDirectory: dir, settingSources: [], homeDir: dir });
      const serialized = JSON.stringify(status);
      assert.ok(!serialized.includes('sk-super-secret-value'),
        'the gate must not leak credentials into an event or a log line');
      assert.ok(!serialized.includes('vault-mcp'));
    });
  });
});

// ── the display contract (P2) ────────────────────────────────────────

describe('auto_review display — no placeholder ever stands in for a fact (a07)', () => {
  it('while checking: unselectable, and says it is checking', () => {
    const display = resolveAutoReviewDisplay({ probe: { status: 'checking' }, permissionProfile: 'default' });
    assert.equal(display.selectable, false);
    assert.equal(display.notice?.key, AUTO_REVIEW_NOTICE_KEYS.checking);
    assert.equal(display.notice?.params, undefined, 'nothing to interpolate — nothing is known yet');
    assert.equal(display.degraded, false, 'an unfinished probe is not a confirmed degradation');
  });

  it('when the probe fails: unselectable, and says the probe failed', () => {
    const display = resolveAutoReviewDisplay({ probe: { status: 'failed' }, permissionProfile: 'default' });
    assert.equal(display.selectable, false);
    assert.equal(display.notice?.key, AUTO_REVIEW_NOTICE_KEYS.probeFailed);
    assert.notEqual(display.notice?.key, AUTO_REVIEW_NOTICE_KEYS.sdkVersion,
      'a failed probe must never masquerade as a version mismatch — we never learned a version');
  });

  it('when supported: selectable, no notice', () => {
    const display = resolveAutoReviewDisplay({
      probe: { status: 'ready', capability: { supported: true } },
      permissionProfile: 'default',
    });
    assert.equal(display.selectable, true);
    assert.equal(display.notice, null);
    assert.equal(display.degraded, false);
  });

  it('on a low SDK version: quotes both real versions', () => {
    const display = resolveAutoReviewDisplay({
      probe: { status: 'ready', capability: {
        supported: false, unavailableReason: 'sdk_version', minVersion: '0.2.111', installedVersion: '0.2.100',
      } },
      permissionProfile: 'default',
    });
    assert.equal(display.selectable, false);
    assert.deepEqual(display.notice, {
      key: AUTO_REVIEW_NOTICE_KEYS.sdkVersion,
      params: { minVersion: '0.2.111', installedVersion: '0.2.100' },
    });
  });

  it('when the installed version is unreadable: says unknown, does not invent one', () => {
    const display = resolveAutoReviewDisplay({
      probe: { status: 'ready', capability: {
        supported: false, unavailableReason: 'sdk_version', minVersion: '0.2.111', installedVersion: null,
      } },
      permissionProfile: 'default',
    });
    assert.equal(display.notice?.key, AUTO_REVIEW_NOTICE_KEYS.sdkVersionUnknown);
    assert.deepEqual(display.notice?.params, { minVersion: '0.2.111' });
  });

  it('uses Codex-specific version copy for an old Codex binary', () => {
    const display = resolveAutoReviewDisplay({
      probe: { status: 'ready', capability: {
        supported: false,
        unavailableReason: 'codex_version',
        minVersion: '0.145.0-alpha.18',
        installedVersion: 'codex-cli 0.135.0-alpha.1',
      } },
      permissionProfile: 'default',
    });
    assert.deepEqual(display.notice, {
      key: AUTO_REVIEW_NOTICE_KEYS.codexVersion,
      params: {
        minVersion: '0.145.0-alpha.18',
        installedVersion: 'codex-cli 0.135.0-alpha.1',
      },
    });
  });

  it('when an external MCP is configured: says so, with the external-MCP reason', () => {
    const display = resolveAutoReviewDisplay({
      probe: { status: 'ready', capability: {
        supported: false,
        unavailableReason: 'external_mcp',
        externalMcp: { present: true, certainty: 'configured', sources: ['user:~/.claude.json'] },
      } },
      permissionProfile: 'default',
    });
    assert.equal(display.selectable, false);
    assert.equal(display.notice?.key, AUTO_REVIEW_NOTICE_KEYS.externalMcp);
  });

  it('when the MCP config is unreadable: says unreadable, not "you have servers configured"', () => {
    const display = resolveAutoReviewDisplay({
      probe: { status: 'ready', capability: {
        supported: false,
        unavailableReason: 'external_mcp',
        externalMcp: { present: true, certainty: 'undetectable', sources: ['user:~/.claude.json'] },
      } },
      permissionProfile: 'default',
    });
    assert.equal(display.notice?.key, AUTO_REVIEW_NOTICE_KEYS.externalMcpUnknown,
      '"could not read your config" and "you have an MCP server" are different facts');
  });

  it('a saved auto_review session reports degraded only once the probe answers', () => {
    const capability = { supported: false, unavailableReason: 'sdk_version', minVersion: '0.2.111', installedVersion: '0.1.0' } as const;

    assert.equal(
      resolveAutoReviewDisplay({ probe: { status: 'checking' }, permissionProfile: 'auto_review' }).degraded,
      false, 'must not claim degradation mid-probe');
    assert.equal(
      resolveAutoReviewDisplay({ probe: { status: 'ready', capability }, permissionProfile: 'auto_review' }).degraded,
      true, 'the chip must stop claiming a reviewer is running when none is');
    assert.equal(
      resolveAutoReviewDisplay({ probe: { status: 'ready', capability }, permissionProfile: 'default' }).degraded,
      false, 'a session that never asked for auto_review has nothing to degrade');
  });

  it('cannot produce an em-dash placeholder in any state — the P2 regression', () => {
    const states: Parameters<typeof resolveAutoReviewDisplay>[0]['probe'][] = [
      { status: 'checking' },
      { status: 'failed' },
      { status: 'ready', capability: { supported: true } },
      { status: 'ready', capability: { supported: false, unavailableReason: 'sdk_version' } },
      { status: 'ready', capability: { supported: false, unavailableReason: 'sdk_version', minVersion: '0.2.111' } },
      { status: 'ready', capability: { supported: false, unavailableReason: 'codex_version', minVersion: '0.145.0-alpha.18' } },
      { status: 'ready', capability: { supported: false, unavailableReason: 'external_mcp' } },
    ];
    for (const probe of states) {
      for (const permissionProfile of ['default', 'auto_review']) {
        const { notice } = resolveAutoReviewDisplay({ probe, permissionProfile });
        for (const value of Object.values(notice?.params ?? {})) {
          assert.ok(value && value !== '—' && value.trim().length > 0,
            `interpolated a placeholder for ${JSON.stringify(probe)}`);
        }
      }
    }
  });

  it('a capability payload with no minVersion falls back to the probe-failed sentence', () => {
    // The exact shape that produced "requires SDK — (installed: —)".
    const display = resolveAutoReviewDisplay({
      probe: { status: 'ready', capability: { supported: false, unavailableReason: 'sdk_version' } },
      permissionProfile: 'default',
    });
    assert.equal(display.notice?.key, AUTO_REVIEW_NOTICE_KEYS.probeFailed);
    assert.equal(display.notice?.params, undefined);
  });
});

describe('auto_review notice copy is real in both locales (a07)', () => {
  for (const key of Object.values(AUTO_REVIEW_NOTICE_KEYS)) {
    it(`${key} exists in en + zh`, () => {
      const enText = (en as Record<string, string>)[key];
      const zhText = (zh as Record<string, string>)[key];
      assert.ok(enText && enText.trim().length > 0, `missing en copy for ${key}`);
      assert.ok(zhText && zhText.trim().length > 0, `missing zh copy for ${key}`);
    });
  }

  it('the version sentences interpolate the params the resolver actually sends', () => {
    for (const locale of [en, zh] as ReadonlyArray<Record<string, string>>) {
      assert.ok(locale[AUTO_REVIEW_NOTICE_KEYS.sdkVersion].includes('{minVersion}'));
      assert.ok(locale[AUTO_REVIEW_NOTICE_KEYS.sdkVersion].includes('{installedVersion}'));
      assert.ok(locale[AUTO_REVIEW_NOTICE_KEYS.sdkVersionUnknown].includes('{minVersion}'));
      assert.ok(!locale[AUTO_REVIEW_NOTICE_KEYS.sdkVersionUnknown].includes('{installedVersion}'),
        'the unknown-version sentence must not have a hole we never fill');
      assert.ok(locale[AUTO_REVIEW_NOTICE_KEYS.codexVersion].includes('{minVersion}'));
      assert.ok(locale[AUTO_REVIEW_NOTICE_KEYS.codexVersion].includes('{installedVersion}'));
      assert.ok(locale[AUTO_REVIEW_NOTICE_KEYS.codexVersionUnknown].includes('{minVersion}'));
      assert.ok(!locale[AUTO_REVIEW_NOTICE_KEYS.codexVersionUnknown].includes('{installedVersion}'));
    }
  });

  it('the param-free notices contain no interpolation holes', () => {
    const paramFree = [
      AUTO_REVIEW_NOTICE_KEYS.checking,
      AUTO_REVIEW_NOTICE_KEYS.probeFailed,
      AUTO_REVIEW_NOTICE_KEYS.externalMcp,
      AUTO_REVIEW_NOTICE_KEYS.externalMcpUnknown,
    ];
    for (const locale of [en, zh] as ReadonlyArray<Record<string, string>>) {
      for (const key of paramFree) {
        assert.ok(!/\{[a-zA-Z]+\}/.test(locale[key]),
          `${key} has an unfilled placeholder — the resolver sends it no params`);
      }
    }
  });
});
