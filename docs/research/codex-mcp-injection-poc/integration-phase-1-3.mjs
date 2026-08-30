#!/usr/bin/env node
/**
 * Phase 8 Phase 1–3 — end-to-end integration smoke (no model auth needed).
 *
 * Drives a REAL Codex 0.133 app-server against the REAL CodePilot Memory
 * MCP streamable-HTTP route served by the running Next dev server, using a
 * config of the exact shape `buildCodexMemoryMcpConfig` produces. Proves:
 *   thread/start(config.mcp_servers={url,http_headers}) → startupStatus
 *   ready → mcpServer/tool/call codepilot_memory_recent → real memory text.
 *
 * The model-AUTONOMOUS path (turn/start) stays auth-gated and is out of
 * scope here; this validates the injection + route + tool wiring.
 *
 * NOTE (route auth, added with the P1 fix): the Memory MCP route now 403s
 * any workspace that isn't the configured `assistant_workspace_path`. So
 * WORKSPACE here MUST equal the running dev server's configured assistant
 * workspace, otherwise startup/tool-call fail with "Workspace not
 * authorized". (This run originally used an arbitrary temp dir, which the
 * fix now correctly rejects.)
 *
 * Run:
 *   CODEX_BIN=/Applications/Codex.app/Contents/Resources/codex \
 *   CODEX_HOME=/tmp/codex-mcp-poc/home \
 *   MEMORY_URL=http://127.0.0.1:3001/api/codex/mcp/memory \
 *   WORKSPACE=/tmp/some-assistant-ws \
 *   node docs/research/codex-mcp-injection-poc/integration-phase-1-3.mjs
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const { CODEX_BIN, CODEX_HOME, MEMORY_URL, WORKSPACE } = process.env;
if (!CODEX_BIN || !CODEX_HOME || !MEMORY_URL || !WORKSPACE) {
  console.error('Set CODEX_BIN, CODEX_HOME (isolated), MEMORY_URL, WORKSPACE');
  process.exit(2);
}
if (path.resolve(CODEX_HOME) === path.resolve(process.env.HOME ?? '', '.codex')) {
  console.error('REFUSING: CODEX_HOME is the real ~/.codex');
  process.exit(2);
}
const WS = path.join(CODEX_HOME, 'ws-int');
fs.mkdirSync(WS, { recursive: true });

const child = spawn(CODEX_BIN, ['app-server', '--listen', 'stdio://'], {
  cwd: WS, env: { ...process.env, CODEX_HOME }, stdio: ['pipe', 'pipe', 'pipe'],
});
const events = [];
child.stderr.on('data', (b) => { for (const l of b.toString().split('\n')) if (/startupStatus|ERROR/i.test(l)) events.push(l.slice(0, 160)); });

let nextId = 1; const pending = new Map(); let buf = '';
const send = (o) => child.stdin.write(JSON.stringify(o) + '\n');
const req = (method, params, ms = 15000) => new Promise((res, rej) => {
  const id = nextId++; const t = setTimeout(() => { pending.delete(id); rej(new Error(`timeout ${method}`)); }, ms);
  pending.set(id, { res, rej, t }); send({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });
});
child.stdout.on('data', (b) => {
  buf += b.toString(); let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1); if (!line) continue;
    let m; try { m = JSON.parse(line); } catch { continue; }
    if ('id' in m && m.id != null && ('result' in m || 'error' in m)) {
      const p = pending.get(m.id); if (!p) continue; pending.delete(m.id); clearTimeout(p.t);
      'error' in m ? p.rej(new Error(`${m.error.code}: ${m.error.message}`)) : p.res(m.result);
    } else if ('id' in m && m.id != null && 'method' in m) {
      send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'decline' } });
    } else if ('method' in m && /startupStatus/.test(m.method)) {
      events.push(`${m.method} ${JSON.stringify(m.params)}`);
    }
  }
});

const out = { steps: {}, events };
const step = async (n, fn) => { try { out.steps[n] = { ok: true, value: await fn() }; } catch (e) { out.steps[n] = { ok: false, error: String(e) }; } };

await step('initialize', async () => { const r = await req('initialize', { clientInfo: { name: 'int', version: '0.0.1' }, capabilities: null }); send({ jsonrpc: '2.0', method: 'initialized', params: {} }); return r?.userAgent; });
let threadId;
// exact shape buildCodexMemoryMcpConfig produces: { url, http_headers:{x-codepilot-workspace-path} }
await step('thread/start + memory MCP (HTTP route)', async () => {
  const r = await req('thread/start', { cwd: WS, config: { mcp_servers: { codepilot_memory: { url: MEMORY_URL, http_headers: { 'x-codepilot-workspace-path': WORKSPACE } } } } });
  threadId = r?.thread?.id; return { threadId };
});
await new Promise((r) => setTimeout(r, 2500));
if (threadId) {
  await step('tool/call codepilot_memory_recent', () => req('mcpServer/tool/call', { threadId, server: 'codepilot_memory', tool: 'codepilot_memory_recent', arguments: {} }));
  await step('tool/call codepilot_memory_search', () => req('mcpServer/tool/call', { threadId, server: 'codepilot_memory', tool: 'codepilot_memory_search', arguments: { query: 'language' } }));
}
child.kill('SIGTERM');
await new Promise((r) => setTimeout(r, 200));
console.log(JSON.stringify(out, null, 2));
process.exit(0);
