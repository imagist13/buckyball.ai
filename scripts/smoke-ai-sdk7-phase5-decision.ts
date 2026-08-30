/**
 * Phase 5 decision-gate live smoke — production agent-loop vs ToolLoopAgent
 * POC, side by side, on a REAL gateway channel.
 *
 * Phase 3's smoke proved the POC path works end-to-end; Phase 5's decision
 * gate requires COMPARISON evidence on the three user-trust scenarios from
 * the AI SDK 7 adoption decision criteria:
 *   (1) long-text        — streaming / tail / usage contract on a long reply
 *   (2) tool + approval  — BOTH branches: approved (tool really runs) and
 *                          denied (deny surfaces as tool_result, loop keeps
 *                          going, stream ends cleanly)
 *   (3) abort → continue — user aborts mid-stream, stream must terminate
 *                          with `done`, and a follow-up send in the SAME
 *                          session must complete normally (no stuck state)
 *
 * Each scenario runs through BOTH loops with identical AgentLoopOptions, and
 * the report records per-loop contract facts plus a mechanical comparison
 * verdict. Token counts / text lengths are sampling-nondeterministic and are
 * recorded as informational diffs, never asserted equal.
 *
 * Scope note (recorded honestly): "composer phase not stuck" is a
 * stream-session-manager / UI property; this script proves the loop-level
 * precondition — the aborted stream closes with `done` and the same session
 * accepts and completes the next send.
 *
 * Credential discipline (identical to Phase 2/3 smokes):
 *   - Real ~/.codepilot/codepilot.db opened READ-ONLY, only to copy the
 *     gateway base_url/api_key; app modules are pointed at an isolated temp
 *     data dir via CLAUDE_GUI_DATA_DIR before any @/lib import.
 *   - Every string that reaches stdout / the report passes scrub().
 *   - 3 attempts per scenario-loop run (gateway flakiness discipline).
 *
 * Usage: npx tsx scripts/smoke-ai-sdk7-phase5-decision.ts [--out report.json]
 */

import Database from 'better-sqlite3';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

// ── Isolated app data dir (BEFORE any @/lib import) ─────────────

const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase5-smoke-'));
process.env.CLAUDE_GUI_DATA_DIR = tempDataDir;
process.env.CODEPILOT_DISABLE_DB_MIGRATION_IN_TESTS = '1';
fs.writeFileSync(path.join(tempDataDir, 'codepilot.db'), '');
process.env.NODE_ENV = 'development';

// ── Credential loading (READ-ONLY on the real DB) ───────────────

const REAL_DB = path.join(os.homedir(), '.codepilot', 'codepilot.db');
const CHANNELS = ['OpenRouter', 'OpenCode Go (OpenAI)'] as const;

interface ChannelRow { name: string; baseUrl: string; apiKey: string; model: string }

function looksLikeCredential(u: string | null | undefined): boolean {
  if (!u) return true;
  if (/(sk-[A-Za-z0-9])/.test(u)) return true;
  try { return !new URL(u).hostname.includes('.'); } catch { return true; }
}

const realDb = new Database(REAL_DB, { readonly: true, fileMustExist: true });
const providerRows = realDb
  .prepare('SELECT name, base_url, api_key FROM api_providers')
  .all() as Array<{ name: string; base_url: string | null; api_key: string | null }>;
realDb.close();

const channels: ChannelRow[] = [];
for (const name of CHANNELS) {
  const row = providerRows.find((r) => r.name === name);
  if (!row || !row.api_key || looksLikeCredential(row.base_url)) continue;
  const base = (row.base_url || '').replace(/\/+$/, '');
  channels.push({
    name,
    // OpenRouter row in the user DB is the Anthropic Messages skin; pin the
    // Chat Completions skin the Phase 2 matrix + Phase 3 smoke validated.
    baseUrl: name === 'OpenRouter' ? 'https://openrouter.ai/api/v1' : base,
    apiKey: row.api_key,
    model: name === 'OpenRouter' ? 'anthropic/claude-haiku-4.5' : 'glm-5',
  });
}

if (channels.length === 0) {
  console.error('No usable gateway channel found — aborting without fabricating results.');
  process.exit(2);
}

const SECRETS = channels.map((c) => c.apiKey);
function scrub(value: unknown): string {
  let s = typeof value === 'string' ? value : JSON.stringify(value) ?? String(value);
  for (const k of SECRETS) if (k) s = s.split(k).join('[REDACTED]');
  return s;
}

// ── Contract fact extraction ────────────────────────────────────

interface SseEventRecord { type: string; data: string }

/** Collapse consecutive same-type events: text,text,text → "text*". */
function normalizedShape(events: SseEventRecord[]): string[] {
  const out: string[] = [];
  for (const e of events) {
    const label = e.type;
    const prev = out[out.length - 1];
    if (prev === label || prev === `${label}*`) {
      out[out.length - 1] = `${label}*`;
    } else {
      out.push(label);
    }
  }
  return out;
}

interface ContractFacts {
  eventShape: string[];
  hasResult: boolean;
  doneLast: boolean;
  errorEvents: string[];
  usage?: { input_tokens: number; output_tokens: number };
  numTurns?: number;
  textLength: number;
  textSample: string;
  toolsCalled: string[];
  permissionRequests: Array<{ toolName: string }>;
  toolResultSamples: string[];
  stepFinishReasons: string[];
}

function extractFacts(events: SseEventRecord[]): ContractFacts {
  const text = events.filter((e) => e.type === 'text').map((e) => e.data).join('');
  const result = events.find((e) => e.type === 'result');
  const resultData = result ? JSON.parse(result.data) : undefined;
  return {
    eventShape: normalizedShape(events),
    hasResult: !!result,
    doneLast: events.length > 0 && events[events.length - 1].type === 'done',
    errorEvents: events.filter((e) => e.type === 'error').map((e) => scrub(e.data).slice(0, 200)),
    usage: resultData?.usage
      ? { input_tokens: resultData.usage.input_tokens, output_tokens: resultData.usage.output_tokens }
      : undefined,
    numTurns: resultData?.num_turns,
    textLength: text.length,
    textSample: text.slice(0, 120),
    toolsCalled: events.filter((e) => e.type === 'tool_use').map((e) => JSON.parse(e.data).name),
    permissionRequests: events
      .filter((e) => e.type === 'permission_request')
      .map((e) => ({ toolName: JSON.parse(e.data).toolName })),
    toolResultSamples: events
      .filter((e) => e.type === 'tool_result')
      .map((e) => String(JSON.parse(e.data).content).slice(0, 120)),
    stepFinishReasons: events
      .filter((e) => e.type === 'status')
      .map((e) => { try { return JSON.parse(e.data); } catch { return {}; } })
      .filter((d) => d.subtype === 'step_complete')
      .map((d) => String(d.finishReason)),
  };
}

// ── Runner ──────────────────────────────────────────────────────

type LoopFn = (options: import('../src/lib/agent-loop').AgentLoopOptions) => ReadableStream<string>;

interface RunSpec {
  prompt: string;
  sessionId: string;
  providerId: string;
  model: string;
  workingDirectory: string;
  timeoutMs: number;
  onEvent?: (event: SseEventRecord, abort: AbortController) => void;
}

async function runLoopOnce(loop: LoopFn, spec: RunSpec): Promise<SseEventRecord[]> {
  const abort = new AbortController();
  const events: SseEventRecord[] = [];
  const stream = loop({
    prompt: spec.prompt,
    sessionId: spec.sessionId,
    providerId: spec.providerId,
    model: spec.model,
    systemPrompt: 'You are a smoke probe. Follow the user instruction literally.',
    workingDirectory: spec.workingDirectory,
    abortController: abort,
    permissionMode: 'normal',
    maxSteps: 6,
  });
  const reader = stream.getReader();
  const hardTimeout = setTimeout(() => abort.abort(), spec.timeoutMs);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const line of value.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const event = JSON.parse(line.slice(6)) as SseEventRecord;
        if (event.type === 'keep_alive') continue;
        events.push(event);
        spec.onEvent?.(event, abort);
      }
    }
  } finally {
    clearTimeout(hardTimeout);
  }
  return events;
}

// ── Scenarios ───────────────────────────────────────────────────

interface LoopRunReport {
  attempts: number;
  ok: boolean;
  facts?: Record<string, unknown>;
  failure?: string;
}

interface ScenarioReport {
  scenario: string;
  channel: string;
  model: string;
  loops: Record<string, LoopRunReport>;
  comparison?: { contractMatch: boolean; notes: string[] };
}

async function main() {
  const { createProvider, createSession, addMessage } = await import('../src/lib/db');
  const { runAgentLoop } = await import('../src/lib/agent-loop');
  const { runToolLoopAgentPoc } = await import('../src/lib/experimental/agent-loop-toolloop-poc');
  const { resolvePendingPermission } = await import('../src/lib/permission-registry');

  const wd = fs.mkdtempSync(path.join(os.tmpdir(), 'phase5-smoke-wd-'));
  const loops: Record<string, LoopFn> = {
    prod: runAgentLoop as LoopFn,
    poc: runToolLoopAgentPoc as LoopFn,
  };

  const reports: ScenarioReport[] = [];

  for (const channel of channels) {
    const provider = createProvider({
      name: `phase5-smoke (${channel.name})`,
      provider_type: 'openai',
      protocol: 'openai-compatible',
      base_url: channel.baseUrl,
      api_key: channel.apiKey,
    } as Parameters<typeof createProvider>[0]);

    // ── Scenario harness: run one spec through both loops, 3 attempts each ──

    interface ScenarioSpec {
      key: string;
      timeoutMs: number;
      /** Build events for one attempt on one loop; throw on invariant failure. */
      run: (loop: LoopFn, loopName: string) => Promise<Record<string, unknown>>;
    }

    const runScenario = async (spec: ScenarioSpec) => {
      const report: ScenarioReport = {
        scenario: spec.key,
        channel: channel.name,
        model: channel.model,
        loops: {},
      };
      for (const [loopName, loop] of Object.entries(loops)) {
        let attempts = 0;
        let lastFailure = '';
        let facts: Record<string, unknown> | undefined;
        while (attempts < 3 && !facts) {
          attempts++;
          try {
            facts = await spec.run(loop, loopName);
          } catch (err) {
            lastFailure = scrub(err instanceof Error ? err.message : String(err));
            console.error(`[smoke] ${channel.name} / ${spec.key} / ${loopName} attempt ${attempts} failed: ${lastFailure.slice(0, 300)}`);
            if (attempts < 3) await new Promise((r) => setTimeout(r, 1500 * attempts));
          }
        }
        report.loops[loopName] = facts
          ? { attempts, ok: true, facts: JSON.parse(scrub(facts)) }
          : { attempts, ok: false, failure: lastFailure.slice(0, 500) };
      }
      report.comparison = compare(spec.key, report.loops);
      reports.push(report);
      console.log(scrub(`[smoke] ${channel.name} / ${spec.key}: prod=${report.loops.prod?.ok} poc=${report.loops.poc?.ok} match=${report.comparison?.contractMatch}`));
    };

    const newSessionRun = async (
      loop: LoopFn,
      key: string,
      prompt: string,
      timeoutMs: number,
      onEvent?: (event: SseEventRecord, abort: AbortController) => void,
    ) => {
      const session = createSession(`phase5-${key}`, channel.model, '', wd);
      addMessage(session.id, 'user', prompt);
      const events = await runLoopOnce(loop, {
        prompt,
        sessionId: session.id,
        providerId: provider.id,
        model: channel.model,
        workingDirectory: wd,
        timeoutMs,
        onEvent,
      });
      return { session, events };
    };

    // (1) long-text — long streamed reply; tail must be result → done, no error.
    await runScenario({
      key: 'long-text',
      timeoutMs: 180_000,
      run: async (loop, loopName) => {
        const prompt = 'Write a detailed explanation (at least 500 words) of how TCP congestion control works, covering slow start, congestion avoidance, fast retransmit and fast recovery. Plain prose, no tools.';
        const { events } = await newSessionRun(loop, `long-text-${loopName}`, prompt, 180_000);
        const facts = extractFacts(events);
        if (facts.errorEvents.length > 0) throw new Error(`error event: ${facts.errorEvents[0]}`);
        if (facts.textLength < 1200) throw new Error(`text too short for long-text probe: ${facts.textLength} chars`);
        if (!facts.hasResult) throw new Error('no result event');
        if (!facts.doneLast) throw new Error('stream did not terminate with done');
        if (!facts.usage || facts.usage.output_tokens < 150) throw new Error(`usage missing or implausibly small: ${JSON.stringify(facts.usage)}`);
        return { ...facts };
      },
    });

    // (2a) tool + approval, APPROVED branch — Bash really executes. NB: the
    // command must NOT match the auto-allow rules (echo/ls/cat/... — see
    // permission-checker.ts DEFAULT_RULES) or no permission_request is raised;
    // `printf` falls through to the Bash '*'→ask rule.
    const APPROVE_MARKER = 'APPROVAL-MARKER-9152';
    await runScenario({
      key: 'tool-approval-approved',
      timeoutMs: 120_000,
      run: async (loop, loopName) => {
        const prompt = `Run the shell command \`printf ${APPROVE_MARKER}\` using the Bash tool, then report its output. Do not use any other tool.`;
        const { events } = await newSessionRun(loop, `approve-${loopName}`, prompt, 120_000, (event) => {
          if (event.type === 'permission_request') {
            const { permissionRequestId } = JSON.parse(event.data);
            setTimeout(() => {
              resolvePendingPermission(permissionRequestId, { behavior: 'allow' });
            }, 50);
          }
        });
        const facts = extractFacts(events);
        if (facts.errorEvents.length > 0) throw new Error(`error event: ${facts.errorEvents[0]}`);
        if (facts.permissionRequests.length === 0) throw new Error('no permission_request raised');
        if (!facts.toolsCalled.includes('Bash')) throw new Error(`Bash not called (tools: ${facts.toolsCalled.join(',') || 'none'})`);
        if (!facts.toolResultSamples.some((s) => s.includes(APPROVE_MARKER))) {
          throw new Error('approved Bash did not surface the marker in tool_result');
        }
        if (!facts.hasResult || !facts.doneLast) throw new Error('tail contract violated (result/done)');
        return { ...facts };
      },
    });

    // (2b) tool + approval, DENIED branch — deny surfaces as tool_result.
    await runScenario({
      key: 'tool-approval-denied',
      timeoutMs: 120_000,
      run: async (loop, loopName) => {
        const prompt = 'Run the shell command `sleep 1` using the Bash tool, then report whether it succeeded. Do not use any other tool.';
        const { events } = await newSessionRun(loop, `deny-${loopName}`, prompt, 120_000, (event) => {
          if (event.type === 'permission_request') {
            const { permissionRequestId } = JSON.parse(event.data);
            setTimeout(() => {
              resolvePendingPermission(permissionRequestId, { behavior: 'deny', message: 'smoke: denied on purpose' });
            }, 50);
          }
        });
        const facts = extractFacts(events);
        if (facts.errorEvents.length > 0) throw new Error(`error event: ${facts.errorEvents[0]}`);
        if (facts.permissionRequests.length === 0) throw new Error('no permission_request raised');
        if (!facts.toolResultSamples.some((s) => s.includes('Permission denied by user'))) {
          throw new Error('deny did not surface as tool_result');
        }
        if (!facts.doneLast) throw new Error('stream did not terminate with done');
        return { ...facts };
      },
    });

    // (3) abort → continue — abort mid-text, then send again in the SAME session.
    await runScenario({
      key: 'abort-continue',
      timeoutMs: 120_000,
      run: async (loop, loopName) => {
        const session = createSession(`phase5-abort-${loopName}`, channel.model, '', wd);
        const abortPrompt = 'Count from 1 to 200 in English words, one number per line. Do not use tools.';
        addMessage(session.id, 'user', abortPrompt);
        let abortScheduled = false;
        const abortedEvents = await runLoopOnce(loop, {
          prompt: abortPrompt,
          sessionId: session.id,
          providerId: provider.id,
          model: channel.model,
          workingDirectory: wd,
          timeoutMs: 120_000,
          onEvent: (event, abort) => {
            if (event.type === 'text' && !abortScheduled) {
              abortScheduled = true;
              setTimeout(() => abort.abort(), 400);
            }
          },
        });
        const abortedFacts = extractFacts(abortedEvents);
        if (!abortScheduled) throw new Error('no text event arrived before abort could be scheduled');
        if (!abortedFacts.doneLast) throw new Error('aborted stream did not terminate with done');
        if (abortedFacts.errorEvents.length > 0) throw new Error(`aborted stream surfaced error bubble: ${abortedFacts.errorEvents[0]}`);

        // Continue: same session must accept and complete the next send.
        const continuePrompt = 'IMPORTANT: abandon the counting task from the previous message entirely. Your whole reply must be exactly the two words: RESUMED OK';
        addMessage(session.id, 'user', continuePrompt);
        const continueEvents = await runLoopOnce(loop, {
          prompt: continuePrompt,
          sessionId: session.id,
          providerId: provider.id,
          model: channel.model,
          workingDirectory: wd,
          timeoutMs: 120_000,
        });
        const continueFacts = extractFacts(continueEvents);
        const continueFullText = continueEvents.filter((e) => e.type === 'text').map((e) => e.data).join('');
        if (continueFacts.errorEvents.length > 0) throw new Error(`continue turn error: ${continueFacts.errorEvents[0]}`);
        if (!/RESUMED OK/i.test(continueFullText)) throw new Error(`continue turn did not produce the marker (got: ${continueFullText.slice(0, 120)})`);
        if (!continueFacts.hasResult || !continueFacts.doneLast) throw new Error('continue turn tail contract violated');
        return {
          aborted: {
            eventShape: abortedFacts.eventShape,
            hasResult: abortedFacts.hasResult,
            doneLast: abortedFacts.doneLast,
            textLength: abortedFacts.textLength,
          },
          continued: { ...continueFacts },
        };
      },
    });

    // Primary channel green across the board → skip the fallback channel.
    if (reports.filter((r) => r.channel === channel.name).every((r) => r.loops.prod?.ok && r.loops.poc?.ok)) break;
  }

  // ── Report ───────────────────────────────────────────────────

  const outIdx = process.argv.indexOf('--out');
  const report = {
    generatedAt: new Date().toISOString(),
    script: 'scripts/smoke-ai-sdk7-phase5-decision.ts',
    prodModule: 'src/lib/agent-loop.ts (runAgentLoop)',
    pocModule: 'src/lib/experimental/agent-loop-toolloop-poc.ts (runToolLoopAgentPoc)',
    dataDirIsolation: tempDataDir.replace(os.tmpdir(), '<TMP>'),
    scopeNote: 'composer/phase recovery is a stream-session-manager+UI property; this smoke proves the loop-level precondition (aborted stream closes with done; same session completes the next send).',
    scenarios: reports,
  };
  const json = scrub(JSON.stringify(report, null, 2));
  if (outIdx > 0 && process.argv[outIdx + 1]) fs.writeFileSync(process.argv[outIdx + 1], json + '\n');
  console.log(json);

  fs.rmSync(tempDataDir, { recursive: true, force: true });
  fs.rmSync(wd, { recursive: true, force: true });
  const allOk = reports.every((r) => r.loops.prod?.ok && r.loops.poc?.ok && r.comparison?.contractMatch);
  process.exit(allOk ? 0 : 1);
}

// ── Mechanical comparison ───────────────────────────────────────

function compare(scenario: string, loops: Record<string, LoopRunReport>): { contractMatch: boolean; notes: string[] } {
  const notes: string[] = [];
  const prod = loops.prod;
  const poc = loops.poc;
  if (!prod?.ok || !poc?.ok) {
    return { contractMatch: false, notes: ['one or both loops failed all attempts'] };
  }
  const p = prod.facts as Record<string, unknown>;
  const q = poc.facts as Record<string, unknown>;

  const pick = (f: Record<string, unknown>, key: string) =>
    scenario === 'abort-continue' ? (f.continued as Record<string, unknown>)?.[key] : f[key];

  let match = true;
  for (const key of ['hasResult', 'doneLast'] as const) {
    const a = pick(p, key);
    const b = pick(q, key);
    if (a !== b) { match = false; notes.push(`${key} differs: prod=${a} poc=${b}`); }
  }
  if (scenario === 'abort-continue') {
    const pa = (p.aborted as Record<string, unknown>);
    const qa = (q.aborted as Record<string, unknown>);
    for (const key of ['hasResult', 'doneLast'] as const) {
      if (pa?.[key] !== qa?.[key]) { match = false; notes.push(`aborted.${key} differs: prod=${pa?.[key]} poc=${qa?.[key]}`); }
    }
  }
  const shapeA = JSON.stringify(pick(p, 'eventShape') ?? p.eventShape);
  const shapeB = JSON.stringify(pick(q, 'eventShape') ?? q.eventShape);
  if (shapeA !== shapeB) {
    // Shape differences can be legitimate nondeterminism (extra step, status
    // notification ordering) — record them, but only fail the match when the
    // tail contract facts above also diverge.
    notes.push(`normalized event shape differs (informational): prod=${shapeA} poc=${shapeB}`);
  }
  const usageA = pick(p, 'usage') as { output_tokens?: number } | undefined;
  const usageB = pick(q, 'usage') as { output_tokens?: number } | undefined;
  if (!!usageA !== !!usageB) { match = false; notes.push(`usage presence differs: prod=${!!usageA} poc=${!!usageB}`); }
  else if (usageA && usageB) notes.push(`usage (informational, sampling-nondeterministic): prod=${JSON.stringify(usageA)} poc=${JSON.stringify(usageB)}`);
  return { contractMatch: match, notes };
}

main().catch((err) => {
  console.error('[smoke] fatal:', scrub(err instanceof Error ? err.stack || err.message : String(err)));
  process.exit(1);
});
