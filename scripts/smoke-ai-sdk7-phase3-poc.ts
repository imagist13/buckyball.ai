/**
 * Phase 3 live smoke — ToolLoopAgent POC path against a real gateway.
 *
 * Companion to src/lib/experimental/agent-loop-toolloop-poc.ts and
 * src/__tests__/unit/toolloop-poc-parity.test.ts: the parity tests prove the
 * POC matches agent-loop on a scripted wire; this script proves the POC path
 * end-to-end (createModel → assembleTools permission wrapping → ToolLoopAgent
 * → SSE) against a REAL gateway channel, reusing the Phase 2-proven channel
 * (OpenRouter app `.chat()` gateway path; fallback OpenCode Go OpenAI skin).
 *
 * Scenarios: (1) text-only, (2) one real tool call (Read, permission-safe),
 * (3) approval denied (Bash → permission_request → programmatic deny).
 *
 * Credential discipline (same as Phase 2 smoke):
 *   - The user's real ~/.codepilot/codepilot.db is opened READ-ONLY, only to
 *     copy the gateway api_key/base_url into an ISOLATED temp data dir; the
 *     app-path code (db.ts and friends) is pointed at that temp dir via
 *     CLAUDE_GUI_DATA_DIR before any app module loads, so all session /
 *     message / permission writes land in the throwaway DB.
 *   - Keys live only in process memory + the temp DB (deleted on exit).
 *     Every string that reaches stdout / the report passes scrub().
 *   - Each scenario retries up to 3 attempts (gateway flakiness discipline).
 *
 * Usage: npx tsx scripts/smoke-ai-sdk7-phase3-poc.ts [--out report.json]
 */

import Database from 'better-sqlite3';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

// ── Isolated app data dir (BEFORE any @/lib import) ─────────────

const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase3-poc-smoke-'));
process.env.CLAUDE_GUI_DATA_DIR = tempDataDir;
process.env.CODEPILOT_DISABLE_DB_MIGRATION_IN_TESTS = '1';
fs.writeFileSync(path.join(tempDataDir, 'codepilot.db'), '');
// Keep reportNativeError's Sentry path disabled (dev-mode contract).
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
    // OpenRouter row in the user DB is configured as the Anthropic Messages
    // skin (…/api). The POC smoke targets the app `.chat()` gateway path the
    // Phase 2 matrix validated, so pin the Chat Completions skin explicitly.
    baseUrl: name === 'OpenRouter' ? 'https://openrouter.ai/api/v1' : base,
    apiKey: row.api_key,
    model: name === 'OpenRouter' ? 'anthropic/claude-haiku-4.5' : 'glm-5',
  });
}

if (channels.length === 0) {
  console.error('No usable gateway channel found (OpenRouter / OpenCode Go (OpenAI)) — aborting without fabricating results.');
  process.exit(2);
}

const SECRETS = channels.map((c) => c.apiKey);
function scrub(value: unknown): string {
  let s = typeof value === 'string' ? value : JSON.stringify(value) ?? String(value);
  for (const k of SECRETS) if (k) s = s.split(k).join('[REDACTED]');
  return s;
}

// ── Scenario harness ────────────────────────────────────────────

interface SseEventRecord { type: string; data: string }

interface ScenarioResult {
  scenario: string;
  channel: string;
  model: string;
  attempts: number;
  ok: boolean;
  eventTypes: string[];
  summary: Record<string, unknown>;
  failure?: string;
}

async function main() {
  const {
    createProvider,
  } = await import('../src/lib/db');
  const { createSession, addMessage } = await import('../src/lib/db');
  const { runToolLoopAgentPoc } = await import('../src/lib/experimental/agent-loop-toolloop-poc');
  const { resolvePendingPermission } = await import('../src/lib/permission-registry');

  const wd = fs.mkdtempSync(path.join(os.tmpdir(), 'phase3-poc-wd-'));
  const notePath = path.join(wd, 'note.txt');
  fs.writeFileSync(notePath, 'SMOKE-NOTE-7431\n');

  const results: ScenarioResult[] = [];

  for (const channel of channels) {
    const provider = createProvider({
      name: `phase3-poc-smoke (${channel.name})`,
      provider_type: 'openai',
      protocol: 'openai-compatible',
      base_url: channel.baseUrl,
      api_key: channel.apiKey,
    } as Parameters<typeof createProvider>[0]);

    interface ScenarioSpec {
      key: string;
      prompt: string;
      onEvent?: (event: SseEventRecord, abort: AbortController) => void;
      validate: (events: SseEventRecord[]) => Record<string, unknown>;
    }

    const scenarios: ScenarioSpec[] = [
      {
        key: 'text-only',
        prompt: 'Reply with exactly: POC OK',
        validate: (events) => {
          const text = events.filter((e) => e.type === 'text').map((e) => e.data).join('');
          const result = events.find((e) => e.type === 'result');
          const error = events.find((e) => e.type === 'error');
          if (error) throw new Error(`error event: ${scrub(error.data).slice(0, 300)}`);
          if (!text.trim()) throw new Error('no text output');
          if (!result) throw new Error('no result event');
          const usage = JSON.parse(result.data).usage;
          return { text: text.slice(0, 80), usage: { input_tokens: usage.input_tokens, output_tokens: usage.output_tokens }, num_turns: JSON.parse(result.data).num_turns };
        },
      },
      {
        key: 'tool-call-read',
        prompt: `Use the Read tool to read the file ${notePath}, then repeat the exact marker string it contains.`,
        validate: (events) => {
          const error = events.find((e) => e.type === 'error');
          if (error) throw new Error(`error event: ${scrub(error.data).slice(0, 300)}`);
          const toolUses = events.filter((e) => e.type === 'tool_use').map((e) => JSON.parse(e.data));
          const readUse = toolUses.find((t) => t.name === 'Read');
          if (!readUse) throw new Error(`model did not call Read (tools called: ${toolUses.map((t) => t.name).join(',') || 'none'})`);
          const toolResults = events.filter((e) => e.type === 'tool_result').map((e) => JSON.parse(e.data));
          const readResult = toolResults.find((r) => r.tool_use_id === readUse.id);
          if (!readResult || !String(readResult.content).includes('SMOKE-NOTE-7431')) {
            throw new Error('Read tool_result missing the marker');
          }
          const finalText = events.filter((e) => e.type === 'text').map((e) => e.data).join('');
          if (!finalText.includes('SMOKE-NOTE-7431')) throw new Error('final answer missing the marker');
          const steps = events
            .filter((e) => e.type === 'status')
            .map((e) => { try { return JSON.parse(e.data); } catch { return {}; } })
            .filter((d) => d.subtype === 'step_complete');
          return {
            toolCallId: readUse.id,
            finishReasons: steps.map((s) => s.finishReason),
            finalText: finalText.slice(0, 100),
          };
        },
      },
      {
        key: 'approval-denied-bash',
        prompt: 'Run the shell command `sleep 1` using the Bash tool, then report whether it succeeded. Do not use any other tool.',
        onEvent: (event) => {
          if (event.type === 'permission_request') {
            const { permissionRequestId } = JSON.parse(event.data);
            setTimeout(() => {
              resolvePendingPermission(permissionRequestId, { behavior: 'deny', message: 'smoke: denied on purpose' });
            }, 50);
          }
        },
        validate: (events) => {
          const error = events.find((e) => e.type === 'error');
          if (error) throw new Error(`error event: ${scrub(error.data).slice(0, 300)}`);
          const perm = events.find((e) => e.type === 'permission_request');
          if (!perm) throw new Error('no permission_request raised (model may not have called Bash)');
          const toolResults = events.filter((e) => e.type === 'tool_result').map((e) => JSON.parse(e.data));
          const denied = toolResults.find((r) => String(r.content).includes('Permission denied by user'));
          if (!denied) throw new Error('deny did not surface as tool_result');
          if (events[events.length - 1].type !== 'done') throw new Error('stream did not terminate with done');
          return {
            permissionToolName: JSON.parse(perm.data).toolName,
            deniedResult: String(denied.content).slice(0, 80),
            modelFollowUp: events.filter((e) => e.type === 'text').map((e) => e.data).join('').slice(0, 100),
          };
        },
      },
    ];

    for (const spec of scenarios) {
      let attempts = 0;
      let lastFailure = '';
      let done = false;
      while (attempts < 3 && !done) {
        attempts++;
        const session = createSession(`phase3-smoke-${spec.key}`, channel.model, '', wd);
        addMessage(session.id, 'user', spec.prompt);
        const abort = new AbortController();
        const events: SseEventRecord[] = [];
        try {
          const stream = runToolLoopAgentPoc({
            prompt: spec.prompt,
            sessionId: session.id,
            providerId: provider.id,
            model: channel.model,
            systemPrompt: 'You are a smoke probe. Follow the user instruction literally and briefly.',
            workingDirectory: wd,
            abortController: abort,
            permissionMode: 'normal',
            maxSteps: 6,
          });
          const reader = stream.getReader();
          const timeout = setTimeout(() => abort.abort(), 120_000);
          try {
            while (true) {
              const { done: rDone, value } = await reader.read();
              if (rDone) break;
              for (const line of value.split('\n')) {
                if (!line.startsWith('data: ')) continue;
                const event = JSON.parse(line.slice(6)) as SseEventRecord;
                if (event.type === 'keep_alive') continue;
                events.push(event);
                spec.onEvent?.(event, abort);
              }
            }
          } finally {
            clearTimeout(timeout);
          }
          const summary = spec.validate(events);
          results.push({
            scenario: spec.key,
            channel: channel.name,
            model: channel.model,
            attempts,
            ok: true,
            eventTypes: events.map((e) => e.type),
            summary: JSON.parse(scrub(summary)),
          });
          done = true;
        } catch (err) {
          lastFailure = scrub(err instanceof Error ? err.message : String(err));
          console.error(`[smoke] ${channel.name} / ${spec.key} attempt ${attempts} failed: ${lastFailure.slice(0, 300)}`);
          if (attempts < 3) await new Promise((r) => setTimeout(r, 1500 * attempts));
        }
      }
      if (!done) {
        results.push({
          scenario: spec.key,
          channel: channel.name,
          model: channel.model,
          attempts,
          ok: false,
          eventTypes: [],
          summary: {},
          failure: lastFailure.slice(0, 500),
        });
      }
    }

    // Primary channel succeeded on all scenarios → no need to burn the fallback.
    if (results.filter((r) => r.channel === channel.name).every((r) => r.ok)) break;
  }

  const outIdx = process.argv.indexOf('--out');
  const report = {
    generatedAt: new Date().toISOString(),
    script: 'scripts/smoke-ai-sdk7-phase3-poc.ts',
    pocModule: 'src/lib/experimental/agent-loop-toolloop-poc.ts',
    dataDirIsolation: tempDataDir.replace(os.tmpdir(), '<TMP>'),
    results,
  };
  const json = scrub(JSON.stringify(report, null, 2));
  if (outIdx > 0 && process.argv[outIdx + 1]) fs.writeFileSync(process.argv[outIdx + 1], json + '\n');
  console.log(json);

  fs.rmSync(tempDataDir, { recursive: true, force: true });
  fs.rmSync(wd, { recursive: true, force: true });
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

main().catch((err) => {
  console.error('[smoke] fatal:', scrub(err instanceof Error ? err.stack || err.message : String(err)));
  process.exit(1);
});
