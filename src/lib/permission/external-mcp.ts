/**
 * External MCP detection for the `auto_review` capability gate
 * (`runtime-permission-modes.md` Phase 1, review round #4 P1).
 *
 * ## The hole this closes
 *
 * `resolveHumanOnlyDenyTools` can only enumerate CodePilot's OWN in-process
 * servers, because that is all that exists at options-build time. A
 * user-configured **external** MCP server ships its tool list at connect time,
 * i.e. after the SDK options are already built — so a credential-shaped tool on
 * a third-party server (`mcp__vault__read_secret`) never reaches the deny list,
 * and under `permissionMode: 'auto'` the model classifier may approve it
 * outright. `canUseTool` does not save us: under `'auto'` an approved call
 * returns `{behavior:'allow'}` without ever prompting, so the callback is not
 * invoked (see the classifier trace documented on `resolveHumanOnlyDenyTools`).
 *
 * The previous round shipped that gap as a documented caveat plus UI copy
 * promising credentials/billing/publishing were "blocked outright". Those two
 * cannot both be true. Rather than weaken the promise, this module makes it
 * true by construction: **if any external MCP could be loaded for this turn,
 * `auto_review` is not offered at all.**
 *
 * ## Fail-closed, deliberately over-reporting
 *
 * Every uncertainty resolves to "present":
 *   - a config file we cannot read or parse → `undetectable` → treated as present
 *   - a server entry we can see → present, regardless of whether the SDK would
 *     really load it (we do not model `mcpServerOverrides` disable state; a
 *     false "present" costs the user the auto_review option, a false "absent"
 *     costs them a secret)
 *
 * The direction of the error matters more than its rate. `default` and
 * `full_access` are untouched — this gate exists only because `auto_review`
 * makes a promise the other two profiles never make.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Whether an external MCP server could reach this turn's tool surface.
 *
 * `certainty` is the breadcrumb the UI needs: 'configured' means we saw real
 * servers and can name them; 'undetectable' means a config file was unreadable
 * and we refused to guess. The user-visible copy differs — telling someone
 * "you have an MCP server configured" when we actually mean "we could not read
 * your settings file" is the kind of confident-wrong status this plan exists to
 * prevent.
 */
export type ExternalMcpStatus =
  | { readonly present: false }
  | {
      readonly present: true;
      readonly certainty: 'configured' | 'undetectable';
      /** Config-source labels (never file contents / server args). */
      readonly sources: readonly string[];
    };

/** Outcome of inspecting ONE config source. Pure input to {@link summarizeExternalMcp}. */
export interface McpConfigProbe {
  /** Stable label for the UI + audit — e.g. `user:~/.claude.json`. */
  readonly label: string;
  readonly outcome: 'absent' | 'empty' | 'has-servers' | 'unreadable';
}

/**
 * ## Why there is no name-based exemption (review round #5, P1)
 *
 * An earlier revision exempted servers named `codepilot-*` from this gate, on
 * the theory that they were CodePilot's own in-process servers. They are not:
 * every name reaching this module comes from a **user-controlled** source — an
 * explicit `mcpServers` record, or an `mcpServers` key in a user/project/local
 * config file. A third party naming their server `codepilot-vault` inherited
 * the exemption and walked straight through the fail-closed gate.
 *
 * CodePilot's real in-process servers are registered by claude-client *after*
 * the permission options are built (`claude-client.ts` — the probe at the
 * options boundary, the `codepilot-memory` / `codepilot-cli-tools` / … merges
 * far below it). They are structurally incapable of appearing in this module's
 * input, so the exemption protected nothing and cost everything: trust here is
 * derived from the *source* of a name, never from the name itself. If an
 * in-process server ever does need to be declared trusted, it must be marked
 * explicitly by the caller against a trusted registry — not inferred.
 *
 * See `docs/guardrails/` — PermissionBoundary: "no prefix-based trust".
 */

/**
 * The pure decision. Kept separate from the filesystem walk so the fail-closed
 * behaviour is table-testable without touching a real HOME.
 *
 * Precedence: a server we can SEE beats a file we cannot read — naming the
 * real cause is more useful than reporting the vaguer one.
 */
export function summarizeExternalMcp(input: {
  /**
   * Server record keys explicitly passed to `streamClaude`. Every one of these
   * is external by construction — see the note above on why no name is trusted.
   */
  readonly explicitServerNames?: readonly string[];
  readonly probes?: readonly McpConfigProbe[];
}): ExternalMcpStatus {
  const explicit = input.explicitServerNames ?? [];
  const probes = input.probes ?? [];

  const configured = [
    ...explicit.map((name) => `explicit:${name}`),
    ...probes.filter((p) => p.outcome === 'has-servers').map((p) => p.label),
  ];
  if (configured.length > 0) {
    return { present: true, certainty: 'configured', sources: configured.sort() };
  }

  const unreadable = probes.filter((p) => p.outcome === 'unreadable').map((p) => p.label);
  if (unreadable.length > 0) {
    return { present: true, certainty: 'undetectable', sources: unreadable.sort() };
  }

  return { present: false };
}

/** `mcpServers` present and non-empty, ignoring entries explicitly disabled in the file. */
function inspectConfigFile(filePath: string, label: string): McpConfigProbe {
  let raw: string;
  try {
    if (!fs.existsSync(filePath)) return { label, outcome: 'absent' };
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    // Exists but unreadable (permissions, race, IO error). We do NOT know what
    // is in it, so we must not report 'empty'.
    return { label, outcome: 'unreadable' };
  }

  try {
    const parsed = JSON.parse(raw) as { mcpServers?: Record<string, { enabled?: boolean }> };
    const servers = parsed?.mcpServers;
    if (!servers || typeof servers !== 'object') return { label, outcome: 'empty' };
    // No name filter: a key in a user/project/local config file is external no
    // matter what it is called (review round #5, P1).
    const live = Object.entries(servers).filter(([, cfg]) => cfg?.enabled !== false);
    return { label, outcome: live.length > 0 ? 'has-servers' : 'empty' };
  } catch {
    // Malformed JSON. mcp-loader's readJson() swallows this as `{}` because for
    // its purposes "cannot load" and "nothing to load" are the same. Here they
    // are opposites, which is why this module does not reuse it.
    return { label, outcome: 'unreadable' };
  }
}

/**
 * Every config source the SDK could pull an external MCP server from for this
 * turn, given the resolved `settingSources`.
 *
 * `<cwd>/.mcp.json` is scanned unconditionally: claude-client re-injects it by
 * hand for DB-provider requests (which run with `settingSources: ['user']`), so
 * "project is not in settingSources" does NOT mean project MCP servers are
 * absent. Missing that is exactly how a gate becomes theatre.
 */
export function collectMcpConfigProbes(input: {
  readonly workingDirectory?: string;
  readonly settingSources?: readonly string[];
  readonly homeDir?: string;
}): McpConfigProbe[] {
  const home = input.homeDir ?? os.homedir();
  const sources = input.settingSources ?? [];
  const cwd = input.workingDirectory;
  const probes: McpConfigProbe[] = [];

  if (sources.includes('user')) {
    probes.push(inspectConfigFile(path.join(home, '.claude.json'), 'user:~/.claude.json'));
    probes.push(inspectConfigFile(path.join(home, '.claude', 'settings.json'), 'user:~/.claude/settings.json'));
  }
  if (cwd) {
    if (sources.includes('project')) {
      probes.push(inspectConfigFile(path.join(cwd, '.claude', 'settings.json'), 'project:.claude/settings.json'));
    }
    if (sources.includes('local')) {
      probes.push(inspectConfigFile(path.join(cwd, '.claude', 'settings.local.json'), 'local:.claude/settings.local.json'));
    }
    // Unconditional — see the doc note above.
    probes.push(inspectConfigFile(path.join(cwd, '.mcp.json'), 'project:.mcp.json'));
  }

  return probes;
}

/**
 * The shipping-boundary probe: "could an external MCP server reach this turn?"
 *
 * Called by claude-client immediately before the SDK options are assembled,
 * with the same `settingSources` / `mcpServers` / cwd that turn will actually
 * use — an answer derived from anything else would be about a different turn.
 */
export function probeExternalMcp(input: {
  readonly workingDirectory?: string;
  readonly settingSources?: readonly string[];
  readonly explicitServerNames?: readonly string[];
  readonly homeDir?: string;
}): ExternalMcpStatus {
  try {
    return summarizeExternalMcp({
      explicitServerNames: input.explicitServerNames,
      probes: collectMcpConfigProbes(input),
    });
  } catch {
    // The walk itself blew up (homedir() throwing, a pathological path). We
    // know nothing, so we claim nothing.
    return { present: true, certainty: 'undetectable', sources: ['probe:failed'] };
  }
}
