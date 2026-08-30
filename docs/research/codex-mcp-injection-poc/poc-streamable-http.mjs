#!/usr/bin/env node
/**
 * Phase 8 / Phase 0 POC (transport addendum) — validate Codex
 * `config.mcp_servers` STREAMABLE-HTTP injection.
 *
 * Phase 0's main run validated stdio. This addendum checks whether Codex
 * 0.133 can connect to a streamable-HTTP MCP server (so the CodePilot
 * Memory MCP can be served as an in-process Next.js route — reusing the
 * already-running server in dev AND packaged Electron, instead of
 * spawning a TS subprocess).
 *
 * It stands up a STATELESS StreamableHTTPServerTransport MCP server on an
 * ephemeral localhost port, injects `{ url }` (no command) into a Codex
 * thread's config.mcp_servers, and checks startupStatus + tool/call.
 *
 * Isolation: requires CODEX_BIN + an isolated CODEX_HOME (refuses real ~/.codex).
 */

import http from 'node:http';
import { spawn } from 'node:child_process';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import path from 'node:path';
import fs from 'node:fs';

const CODEX_BIN = process.env.CODEX_BIN;
const CODEX_HOME = process.env.CODEX_HOME;
if (!CODEX_BIN || !CODEX_HOME) { console.error('Set CODEX_BIN + isolated CODEX_HOME'); process.exit(2); }
if (path.resolve(CODEX_HOME) === path.resolve(process.env.HOME ?? '', '.codex')) {
  console.error('REFUSING: CODEX_HOME is the real ~/.codex'); process.exit(2);
}
const WS = path.join(CODEX_HOME, 'ws-http');
fs.mkdirSync(WS, { recursive: true });

// ── stateless streamable-HTTP MCP server ──────────────────────────────
function buildMcp() {
  const s = new McpServer({ name: 'codepilot-http-fixture', version: '0.0.1' });
  s.registerTool('memory_search',
    { description: 'HTTP fixture memory search', inputSchema: { query: z.string() } },
    async ({ query }) => ({ content: [{ type: 'text', text: `http-hit for "${query}"` }] }),
  );
  return s;
}
const httpServer = http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST') {
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      const server = buildMcp();
      res.on('close', () => { transport.close(); server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } else {
      res.writeHead(405).end();
    }
  } catch (e) {
    console.error('[http-fixture] error', e);
    if (!res.headersSent) res.writeHead(500).end();
  }
});

// ── minimal NDJSON JSON-RPC codex driver ──────────────────────────────
function runCodex(url) {
  return new Promise((resolve) => {
    const child = spawn(CODEX_BIN, ['app-server', '--listen', 'stdio://'], {
      cwd: WS, env: { ...process.env, CODEX_HOME }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const events = [];
    child.stderr.on('data', (b) => { for (const l of b.toString().split('\n')) if (/startupStatus|error|ERROR/i.test(l)) events.push(['stderr', l.slice(0, 200)]); });
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
          send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'poc declines' } });
        } else if ('method' in m && /startupStatus/.test(m.method)) {
          events.push(['note', m.method, m.params]);
        }
      }
    });
    (async () => {
      const out = { steps: {}, events };
      const step = async (n, fn) => { try { out.steps[n] = { ok: true, value: await fn() }; } catch (e) { out.steps[n] = { ok: false, error: String(e) }; } };
      await step('initialize', async () => { const r = await req('initialize', { clientInfo: { name: 'poc', version: '0.0.1' }, capabilities: null }); send({ jsonrpc: '2.0', method: 'initialized', params: {} }); return r?.userAgent; });
      let threadId;
      await step('thread/start+http-inject', async () => {
        const r = await req('thread/start', { cwd: WS, config: { mcp_servers: { codepilot_http_fixture: { url } } } });
        threadId = r?.thread?.id; return { threadId, model: r?.model };
      });
      await new Promise((r) => setTimeout(r, 2500));
      if (threadId) await step('tool/call:memory_search(http)', () => req('mcpServer/tool/call', { threadId, server: 'codepilot_http_fixture', tool: 'memory_search', arguments: { query: 'chinese' } }));
      child.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 200));
      resolve(out);
    })();
  });
}

httpServer.listen(0, '127.0.0.1', async () => {
  const port = httpServer.address().port;
  const url = `http://127.0.0.1:${port}/mcp`;
  console.error('[http-fixture] listening', url);
  const out = await runCodex(url);
  httpServer.close();
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
});
