#!/usr/bin/env node
/**
 * Phase 8 / Phase 0 POC — drive a REAL Codex app-server and inject the
 * fixture MCP via per-thread `config.mcp_servers`.
 *
 * Isolation (REQUIRED): set CODEX_HOME to a throwaway dir; NEVER point at
 * the real ~/.codex. Reads no auth.json / token / credentials.
 *
 * Protocol (per src/lib/codex/app-server-client.ts, which talks to the
 * real binary): JSON-RPC 2.0 over newline-delimited JSON on stdio;
 * handshake = `initialize` request then `initialized` notification;
 * server may originate requests (approvals / elicitation) that the client
 * MUST answer or the call hangs.
 *
 * What this verifies WITHOUT model auth:
 *   - Codex app-server boots a per-thread injected stdio MCP server
 *   - startup lifecycle via the `mcpServer/startupStatus/updated` notification
 *     (starting/ready/failed). NOTE: per-thread injected servers do NOT appear
 *     in `mcpServerStatus/list` (that RPC reflects config.toml servers only).
 *   - mcpServer/tool/call routes to the fixture (memory_search / fail_always)
 *   - ask_user → Codex sends a real elicitation request back to us (round-trip)
 *   - broken server startup is surfaced (status:failed notification), not silent
 * The model-AUTONOMOUS call (turn/start) is the only auth-gated piece; if it
 * needs auth we record getAuthStatus + the error and DO NOT read auth.json.
 *
 * Run:
 *   CODEX_BIN=/Applications/Codex.app/Contents/Resources/codex \
 *   CODEX_HOME=/tmp/codex-mcp-poc/home \
 *   node docs/research/codex-mcp-injection-poc/drive-codex-appserver.mjs
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixture-memory-mcp.mjs');
// node_modules for the fixture's MCP SDK import resolves from the fixture
// file location (worktree root), independent of spawn cwd.
const WORKTREE = path.resolve(HERE, '../../..');
const NODE = process.execPath;

const CODEX_BIN = process.env.CODEX_BIN;
const CODEX_HOME = process.env.CODEX_HOME;
if (!CODEX_BIN || !CODEX_HOME) {
  console.error('Set CODEX_BIN and CODEX_HOME (isolated) env vars.');
  process.exit(2);
}
if (path.resolve(CODEX_HOME) === path.resolve(process.env.HOME ?? '', '.codex')) {
  console.error('REFUSING: CODEX_HOME points at the real ~/.codex.');
  process.exit(2);
}

const WS = path.join(CODEX_HOME, 'ws');
fs.mkdirSync(WS, { recursive: true });

const timeline = [];
const log = (dir, kind, payload) => {
  const entry = { t: Date.now(), dir, kind, payload };
  timeline.push(entry);
  console.error(`[${dir}] ${kind}`, typeof payload === 'string' ? payload : JSON.stringify(payload).slice(0, 400));
};

// ── spawn app-server ──────────────────────────────────────────────────
const child = spawn(CODEX_BIN, ['app-server', '--listen', 'stdio://'], {
  cwd: WS,
  env: { ...process.env, CODEX_HOME },
  stdio: ['pipe', 'pipe', 'pipe'],
});
child.stderr.on('data', (b) => {
  for (const line of b.toString().split('\n')) if (line.trim()) log('server-stderr', 'log', line.slice(0, 300));
});

// ── NDJSON JSON-RPC plumbing ──────────────────────────────────────────
let nextId = 1;
const pending = new Map();
let buf = '';
child.stdout.on('data', (b) => {
  buf += b.toString();
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (line) handleLine(line);
  }
});

function send(obj) {
  child.stdin.write(JSON.stringify(obj) + '\n');
}
function request(method, params, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout: ${method} (>${timeoutMs}ms)`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer, method });
    log('client→', method, params ?? {});
    send({ jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) });
  });
}
function notify(method, params) {
  log('client→', `notify:${method}`, params ?? {});
  send({ jsonrpc: '2.0', method, ...(params !== undefined ? { params } : {}) });
}
function respond(id, body) {
  send({ jsonrpc: '2.0', id, ...body });
}

const serverRequests = [];
function handleLine(line) {
  let m;
  try { m = JSON.parse(line); } catch { log('server→', 'non-json', line.slice(0, 200)); return; }

  if ('id' in m && m.id != null && ('result' in m || 'error' in m)) {
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    clearTimeout(p.timer);
    if ('error' in m) { log('server→', `error:${p.method}`, m.error); p.reject(new Error(`${m.error.code}: ${m.error.message}`)); }
    else { log('server→', `result:${p.method}`, m.result); p.resolve(m.result); }
    return;
  }
  // server-originated request (id + method, no result/error)
  if ('id' in m && m.id != null && 'method' in m) {
    log('server→REQ', m.method, m.params ?? {});
    serverRequests.push({ method: m.method, params: m.params });
    if (m.method === 'mcpServer/elicitation/request') {
      // safe decline — never hang, never auto-accept
      respond(m.id, { result: { action: 'decline', content: null, _meta: null } });
      log('client→', 'elicitation-decline', { id: m.id });
    } else {
      // approvals etc. — answer method-not-found so nothing hangs
      respond(m.id, { error: { code: -32601, message: `POC declines ${m.method}` } });
      log('client→', 'server-req-decline', { method: m.method });
    }
    return;
  }
  // notification
  if ('method' in m) { log('server→NOTE', m.method, m.params ?? {}); return; }
  log('server→', 'unknown-shape', m);
}

// ── run ───────────────────────────────────────────────────────────────
const result = { steps: {}, serverRequests, codexVersion: null };
const step = async (name, fn) => {
  try { const v = await fn(); result.steps[name] = { ok: true, value: v }; return v; }
  catch (e) { result.steps[name] = { ok: false, error: e instanceof Error ? e.message : String(e) }; return undefined; }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FIXTURE_MCP = {
  codepilot_memory_fixture: { command: NODE, args: [FIXTURE], cwd: WORKTREE },
};

let threadId;
await step('initialize', async () => {
  const r = await request('initialize', {
    clientInfo: { name: 'codepilot-poc', title: 'Phase8 POC', version: '0.0.1' },
    capabilities: null,
  });
  result.codexVersion = r?.userAgent ?? r?.version ?? null;
  notify('initialized', {});
  return r;
});

await step('getAuthStatus', () => request('getAuthStatus', {}).catch((e) => ({ note: 'auth probe', error: String(e) })));

await step('thread/start+inject', async () => {
  const r = await request('thread/start', { cwd: WS, config: { mcp_servers: FIXTURE_MCP } });
  threadId = r?.threadId ?? r?.thread?.id ?? r?.id;
  return r;
});

await sleep(2000); // let Codex spawn the MCP server + emit startup notifications

await step('mcpServerStatus/list', () => request('mcpServerStatus/list', { detail: 'full' }));

if (threadId) {
  await step('tool/call:memory_search', () =>
    request('mcpServer/tool/call', { threadId, server: 'codepilot_memory_fixture', tool: 'memory_search', arguments: { query: 'chinese' } }));
  await step('tool/call:fail_always', () =>
    request('mcpServer/tool/call', { threadId, server: 'codepilot_memory_fixture', tool: 'fail_always', arguments: {} }));
  await step('tool/call:ask_user(elicitation)', () =>
    request('mcpServer/tool/call', { threadId, server: 'codepilot_memory_fixture', tool: 'ask_user', arguments: {} }, 20000));
}

// broken server variant — separate thread with a server that exits 1 on start
await step('thread/start+broken', async () => {
  const r = await request('thread/start', {
    cwd: WS,
    config: { mcp_servers: { codepilot_broken: { command: NODE, args: [FIXTURE], env: { FIXTURE_MODE: 'broken' } } } },
  });
  return r?.threadId ?? r;
});
await sleep(1500);
await step('mcpServerStatus/list(after-broken)', () => request('mcpServerStatus/list', { detail: 'full' }));

// autonomous path (model decides to call) — expected auth-gated
if (threadId) {
  await step('turn/start(autonomous, may be auth-gated)', () =>
    request('turn/start', {
      threadId,
      input: [{ type: 'text', text: 'Use the memory_search tool to find what language the user prefers.', text_elements: [] }],
    }, 20000));
}

await child.stdin.end?.();
child.kill('SIGTERM');
await sleep(300);

fs.writeFileSync(path.join(HERE, 'live-run-timeline.json'), JSON.stringify(timeline, null, 2));
console.log('\n===== SUMMARY =====');
console.log(JSON.stringify(result, null, 2));
process.exit(0);
