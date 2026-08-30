#!/usr/bin/env node
/**
 * #632 / Phase 2 #3 POC — discover the wire format the Codex app-server's
 * `turn/start` accepts for IMAGE input blocks.
 *
 * WHY: src/lib/codex/runtime.ts:940 sends `input: [{ type:'text', text }]` only,
 * so image attachments are silently dropped under Codex Runtime. To wire images
 * we need the exact `input[]` image-block shape the app-server accepts — which is
 * NOT in the repo (we drive the raw codex binary via JSON-RPC; no SDK source).
 *
 * BOUNDARY (per user/Codex): probe ONLY. Do NOT change product code. Record
 * candidate formats, app-server responses, and (separately, needs auth) whether
 * the model actually sees the image.
 *
 * KEY INSIGHT: the app-server is Rust/serde. It deserializes `turn/start` params
 * BEFORE the auth-gated handler runs, so a malformed image block returns a
 * JSON-RPC -32602 "invalid params" (often *enumerating the valid variants* or
 * naming a missing field) WITHOUT needing model auth. So we can map the schema
 * with an ISOLATED throwaway CODEX_HOME (never the real ~/.codex):
 *   - params/deserialize error  → format REJECTED (message reveals the schema)
 *   - turn id returned / auth error / other → format ACCEPTED (passed schema)
 *
 * Run:
 *   CODEX_BIN=/Applications/Codex.app/Contents/Resources/codex \
 *   CODEX_HOME=/tmp/codex-image-poc/home \
 *   node docs/research/codex-image-input-poc/probe-image-format.mjs
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CODEX_BIN = process.env.CODEX_BIN;
const CODEX_HOME = process.env.CODEX_HOME;
if (!CODEX_BIN || !CODEX_HOME) {
  console.error('Set CODEX_BIN and CODEX_HOME (isolated, NOT ~/.codex).');
  process.exit(2);
}
if (path.resolve(CODEX_HOME) === path.resolve(process.env.HOME ?? '', '.codex')) {
  console.error('REFUSING: CODEX_HOME points at the real ~/.codex.');
  process.exit(2);
}

const WS = path.join(CODEX_HOME, 'ws');
fs.mkdirSync(WS, { recursive: true });

// 1x1 transparent PNG — used both as a data URL and written to disk for path-based candidates.
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const DATA_URL = `data:image/png;base64,${PNG_B64}`;
const IMG_PATH = path.join(WS, 'probe.png');
fs.writeFileSync(IMG_PATH, Buffer.from(PNG_B64, 'base64'));

const timeline = [];
const log = (dir, kind, payload) => {
  timeline.push({ t: Date.now(), dir, kind, payload });
  console.error(`[${dir}] ${kind}`, typeof payload === 'string' ? payload : JSON.stringify(payload).slice(0, 500));
};

// codex app-server stdio contract (matches src/lib/codex/app-server-manager.ts:
// `app-server`, default stdio — never `--listen`).
const child = spawn(CODEX_BIN, ['app-server'], {
  cwd: WS,
  env: { ...process.env, CODEX_HOME },
  stdio: ['pipe', 'pipe', 'pipe'],
});
child.stderr.on('data', (b) => {
  for (const line of b.toString().split('\n')) if (line.trim()) log('server-stderr', 'log', line.slice(0, 280));
});

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
const send = (obj) => child.stdin.write(JSON.stringify(obj) + '\n');
function request(method, params, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`__timeout__ ${method} (>${timeoutMs}ms)`)); }, timeoutMs);
    pending.set(id, { resolve, reject, timer, method });
    log('client→', method, params ?? {});
    send({ jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) });
  });
}
const notify = (method, params) => { log('client→', `notify:${method}`, params ?? {}); send({ jsonrpc: '2.0', method, ...(params !== undefined ? { params } : {}) }); };
const respond = (id, body) => send({ jsonrpc: '2.0', id, ...body });

function handleLine(line) {
  let m;
  try { m = JSON.parse(line); } catch { log('server→', 'non-json', line.slice(0, 200)); return; }
  if ('id' in m && m.id != null && ('result' in m || 'error' in m)) {
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id); clearTimeout(p.timer);
    if ('error' in m) { log('server→', `error:${p.method}`, m.error); p.reject(Object.assign(new Error(m.error.message), { rpc: m.error })); }
    else { log('server→', `result:${p.method}`, m.result); p.resolve(m.result); }
    return;
  }
  if ('id' in m && m.id != null && 'method' in m) {
    log('server→REQ', m.method, m.params ?? {});
    // Decline everything so nothing hangs (approvals / elicitation).
    respond(m.id, { error: { code: -32601, message: `POC declines ${m.method}` } });
    return;
  }
  if ('method' in m) { log('server→NOTE', m.method, m.params ?? {}); return; }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = { codexBin: CODEX_BIN, codexHome: CODEX_HOME, version: null, auth: null, threadId: null, probes: [] };

const TEXT = { type: 'text', text: 'Describe the attached image in one word.' };

// Candidate image blocks to probe. The bogus one is first so the serde
// "unknown variant" error enumerates the real variant names in one shot.
const CANDIDATES = [
  { name: 'bogus-variant (enumerate valid types)', block: { type: '__codepilot_probe_unknown__' } },
  { name: 'image + image_url(dataUrl)', block: { type: 'image', image_url: DATA_URL } },
  { name: 'image + image_url{url}', block: { type: 'image', image_url: { url: DATA_URL } } },
  { name: 'image + image(dataUrl)', block: { type: 'image', image: DATA_URL } },
  { name: 'input_image + image_url(dataUrl)', block: { type: 'input_image', image_url: DATA_URL } },
  { name: 'image + url(dataUrl)', block: { type: 'image', url: DATA_URL } },
  { name: 'localImage + path', block: { type: 'localImage', path: IMG_PATH } },
  { name: 'local_image + path', block: { type: 'local_image', path: IMG_PATH } },
  { name: 'image + path', block: { type: 'image', path: IMG_PATH } },
];

// Classify a turn/start outcome: did the image block pass schema deserialization?
function classify(outcome) {
  if (outcome.ok) return { accepted: true, why: 'turn/start returned (turn started) → input schema accepted' };
  const msg = (outcome.error || '').toLowerCase();
  const code = outcome.rpc?.code;
  // -32602 / deserialize / unknown variant / missing field / invalid type → schema REJECTED.
  if (code === -32602 || /invalid params|unknown variant|unknown field|missing field|invalid type|expected|deserialize|failed to parse/.test(msg)) {
    return { accepted: false, why: 'params/deserialize error → image block shape rejected by schema' };
  }
  if (outcome.error?.startsWith('__timeout__')) {
    return { accepted: true, why: 'no params error before timeout → schema likely accepted (turn running/awaiting)' };
  }
  // auth / not-logged-in / model errors mean we got PAST schema validation.
  if (/auth|login|token|unauthor|credential|api key|model/.test(msg)) {
    return { accepted: true, why: 'non-schema error (auth/model) → input schema accepted' };
  }
  return { accepted: null, why: `inconclusive (code=${code} msg=${outcome.error})` };
}

try {
  const init = await request('initialize', { clientInfo: { name: 'codepilot-image-poc', version: '0.0.1' }, capabilities: null }).catch((e) => ({ __err: e.message }));
  results.version = init?.userAgent ?? init?.version ?? null;
  notify('initialized', {});

  results.auth = await request('getAuthStatus', {}).catch((e) => ({ error: e.message }));

  const ts = await request('thread/start', { cwd: WS }).catch((e) => ({ __err: e.message, rpc: e.rpc }));
  results.threadId = ts?.threadId ?? ts?.thread?.id ?? ts?.id ?? null;
  results.threadStartRaw = ts;

  if (!results.threadId) {
    console.error('thread/start did not yield a threadId; cannot probe turn/start. Raw:', JSON.stringify(ts));
  } else {
    for (const c of CANDIDATES) {
      let outcome;
      try {
        const r = await request('turn/start', { threadId: results.threadId, input: [TEXT, c.block] }, 7000);
        outcome = { ok: true, result: r };
        // If a turn actually started, interrupt it so the model call (if any) doesn't run away.
        const turnId = r?.turn?.id ?? r?.turnId;
        if (turnId) { await request('turn/interrupt', { threadId: results.threadId, turnId }, 3000).catch(() => {}); }
      } catch (e) {
        outcome = { ok: false, error: e.message, rpc: e.rpc };
      }
      const verdict = classify(outcome);
      results.probes.push({ candidate: c.name, block: c.block, outcome, verdict });
      console.error(`\n=== PROBE: ${c.name} → ${verdict.accepted === true ? 'ACCEPTED' : verdict.accepted === false ? 'REJECTED' : 'INCONCLUSIVE'} (${verdict.why})\n`);
      await sleep(300);
    }
  }
} catch (e) {
  results.fatal = e instanceof Error ? e.message : String(e);
} finally {
  try { child.stdin.end?.(); } catch { /* noop */ }
  child.kill('SIGTERM');
  await sleep(300);
  fs.writeFileSync(path.join(HERE, 'probe-timeline.json'), JSON.stringify(timeline, null, 2));
  fs.writeFileSync(path.join(HERE, 'probe-results.json'), JSON.stringify(results, null, 2));
  console.log('\n===== SUMMARY =====');
  console.log(JSON.stringify({
    version: results.version,
    auth: results.auth,
    threadId: results.threadId,
    probes: results.probes.map((p) => ({ candidate: p.candidate, accepted: p.verdict.accepted, why: p.verdict.why, error: p.outcome.error, rpc: p.outcome.rpc })),
  }, null, 2));
  process.exit(0);
}
