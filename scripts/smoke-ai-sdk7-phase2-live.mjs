#!/usr/bin/env node
/**
 * Phase 2 live smoke — AI SDK 7 provider request-shape acceptance probe.
 *
 * Companion smoke for the AI SDK 7 provider request-shape matrix:
 * the fixture matrix proved what we PUT on the wire; this script probes
 * whether real gateways ACCEPT those exact shapes, using the same SDK
 * versions and the same providerOptions the app assembles.
 *
 * Credentials: read from ~/.codepilot/codepilot.db `api_providers`,
 * opened READ-ONLY (better-sqlite3 { readonly: true }); no write
 * statements exist in this file. Keys live only in process memory;
 * every string that reaches stdout/report passes scrub() which replaces
 * any configured api_key occurrence with [REDACTED]. Request headers
 * are never logged.
 *
 * Cost control: max_tokens is minimal per scenario; thinking budget is
 * the Anthropic minimum (1024). Each generateText uses maxRetries: 3
 * (SDK-native exponential backoff on 429/5xx/network errors).
 *
 * Usage: node scripts/smoke-ai-sdk7-phase2-live.mjs [--out report.json]
 */

import Database from 'better-sqlite3';
import os from 'node:os';
import fs from 'node:fs';
import { generateText, tool, jsonSchema } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

// ── Credential loading (READ-ONLY) ─────────────────────────────

const TARGET_NAMES = [
  'OpenCode Go (Anthropic)',
  'OpenCode Go (OpenAI)',
  'ClinePass',
  'OpenRouter',
];

const db = new Database(os.homedir() + '/.codepilot/codepilot.db', { readonly: true });
const providerRows = db
  .prepare('SELECT name, provider_type, base_url, api_key FROM api_providers')
  .all();
db.close();

// Defense in depth: never touch rows whose base_url looks like a pasted
// credential instead of a URL (known bad row: CCsub — config mixup).
function baseUrlLooksLikeCredential(u) {
  if (!u) return true;
  if (/(sk-[A-Za-z0-9])/.test(u)) return true;
  try {
    const parsed = new URL(u);
    return !parsed.hostname.includes('.');
  } catch {
    return true;
  }
}

const rows = {};
const skipped = [];
for (const r of providerRows) {
  if (!TARGET_NAMES.includes(r.name)) continue;
  if (baseUrlLooksLikeCredential(r.base_url)) {
    skipped.push({ name: r.name, reason: 'base_url looks like a credential, not a URL — config mixup, awaiting user fix' });
    continue;
  }
  if (!r.api_key) {
    skipped.push({ name: r.name, reason: 'no api_key configured' });
    continue;
  }
  rows[r.name] = { baseUrl: r.base_url.replace(/\/+$/, ''), apiKey: r.api_key };
}

const SECRETS = Object.values(rows).map((r) => r.apiKey);
function scrub(value) {
  let s = String(value ?? '');
  for (const k of SECRETS) if (k) s = s.split(k).join('[REDACTED]');
  return s;
}

// ── Probe payload (mirrors provider-request-shape.test.ts) ─────

const PROBE_SYSTEM = 'You are a synthetic capability probe. Reply with the word ok.';
const PROBE_PROMPT = 'capability probe ping';

const readFileTool = tool({
  description: 'Read a UTF-8 file from the workspace',
  inputSchema: jsonSchema({
    type: 'object',
    properties: { path: { type: 'string', description: 'workspace-relative path' } },
    required: ['path'],
    additionalProperties: false,
  }),
  // no execute — we only need the provider to emit the tool call
});

// Mirrors ai-provider.ts normaliseBaseUrl (anthropic branch).
function normaliseAnthropicBaseUrl(url) {
  const cleaned = url.replace(/\/+$/, '');
  if (cleaned.endsWith('/v1')) return cleaned;
  try {
    const pathname = new URL(cleaned).pathname;
    if (pathname !== '/' && pathname !== '') return cleaned;
  } catch {
    return cleaned;
  }
  return `${cleaned}/v1`;
}

// ── Scenario runner ─────────────────────────────────────────────

const WIRE_PARAM_KEYS = [
  'model', 'max_tokens', 'max_completion_tokens', 'thinking', 'output_config',
  'reasoning_effort', 'reasoning', 'tool_choice', 'stream',
];

function pickWire(url, body) {
  if (!body) return { url: scrub(url) };
  const params = {};
  for (const k of WIRE_PARAM_KEYS) if (k in body) params[k] = body[k];
  if (Array.isArray(body.tools)) params.tools = body.tools.length + ' tool(s)';
  return { url: scrub(url), params: JSON.parse(scrub(JSON.stringify(params))) };
}

async function runScenario({ channel, path, scenario, buildModel, call, note }) {
  let lastRequest = null;
  let attempts = 0;
  const captureFetch = async (url, init) => {
    attempts += 1;
    try {
      lastRequest = { url: String(url), body: init?.body ? JSON.parse(init.body) : null };
    } catch {
      lastRequest = { url: String(url), body: null };
    }
    return fetch(url, init);
  };

  const record = { channel, path, scenario, note, maxRetries: 3 };
  try {
    const result = await generateText({
      model: buildModel(captureFetch),
      maxRetries: 3,
      abortSignal: AbortSignal.timeout(180_000),
      ...call,
    });
    record.ok = true;
    record.attempts = attempts;
    record.wire = pickWire(lastRequest?.url, lastRequest?.body);
    record.response = {
      id: result.response?.id ?? null,
      model: result.response?.modelId ?? null,
      usage: result.usage ?? null,
      finishReason: result.finishReason ?? null,
      textLength: (result.text ?? '').length,
      reasoningTextLength: (result.reasoningText ?? '').length,
      toolCalls: (result.toolCalls ?? []).map((t) => t.toolName),
    };
  } catch (e) {
    record.ok = false;
    record.attempts = attempts;
    record.wire = pickWire(lastRequest?.url, lastRequest?.body);
    record.error = {
      name: e?.name ?? null,
      status: e?.statusCode ?? e?.status ?? null,
      message: scrub(e?.message).slice(0, 400),
      responseBody: scrub(e?.responseBody ?? '').slice(0, 400),
    };
  }
  console.log(JSON.stringify(record));
  return record;
}

// ── Channel builders (mirror ai-provider.ts / fixture test) ────

function anthropicBuilder(baseUrl, apiKey, modelId) {
  // Mirrors ai-provider.ts case 'anthropic': normaliseBaseUrl + the
  // interleaved-thinking beta header the app always sends.
  return (fetchImpl) =>
    createAnthropic({
      apiKey,
      baseURL: normaliseAnthropicBaseUrl(baseUrl),
      headers: { 'anthropic-beta': 'interleaved-thinking-2025-05-14' },
      fetch: fetchImpl,
    })(modelId);
}

function anthropicBuilderExplicitV1(baseUrl, apiKey, modelId) {
  // Fallback: force `${base}/v1` when the app's normaliseBaseUrl keeps a
  // deeper path as-is but the gateway actually serves /v1/messages.
  return (fetchImpl) =>
    createAnthropic({
      apiKey,
      baseURL: baseUrl.replace(/\/+$/, '') + '/v1',
      headers: { 'anthropic-beta': 'interleaved-thinking-2025-05-14' },
      fetch: fetchImpl,
    })(modelId);
}

function gatewayChatBuilder(baseUrl, apiKey, modelId) {
  // Mirrors ai-provider.ts non-OAuth 'openai' branch (.chat()). The app also
  // installs withChatImageDataUrlFetch there; no scenario here carries image
  // parts, so that wrapper is a no-op for these bodies and is omitted (it is
  // TS-only and this script runs under plain node).
  return (fetchImpl) =>
    createOpenAI({ apiKey, baseURL: baseUrl, fetch: fetchImpl }).chat(modelId);
}

function compatBuilder(baseUrl, apiKey, modelId) {
  // NOT an app path — @ai-sdk/openai-compatible candidate adapter
  // (Phase 3 decision input), same construction as the fixture test.
  return (fetchImpl) =>
    createOpenAICompatible({ name: 'openai-compatible', baseURL: baseUrl, apiKey, fetch: fetchImpl })(modelId);
}

// ── Scenario matrix ─────────────────────────────────────────────

const BASIC_CALL = { system: PROBE_SYSTEM, prompt: PROBE_PROMPT, maxOutputTokens: 64 };
const TOOL_CALL = {
  system: PROBE_SYSTEM,
  prompt: PROBE_PROMPT,
  tools: { read_file: readFileTool },
  toolChoice: { type: 'tool', toolName: 'read_file' },
  maxOutputTokens: 256,
};

const report = { startedAt: new Date().toISOString(), skipped, channels: {}, records: [] };

async function firstWorkingModel(channel, path, candidates, makeBuilder) {
  for (const modelId of candidates) {
    const rec = await runScenario({
      channel, path, scenario: 'basic-chat', buildModel: makeBuilder(modelId),
      call: BASIC_CALL, note: `model candidate: ${modelId}`,
    });
    report.records.push(rec);
    if (rec.ok) return modelId;
  }
  return null;
}

// A. OpenCode Go (Anthropic) — @ai-sdk/anthropic Messages wire vs anthropic-skin gateway
if (rows['OpenCode Go (Anthropic)']) {
  const { baseUrl, apiKey } = rows['OpenCode Go (Anthropic)'];
  const candidates = ['glm-5', 'deepseek-v4-flash', 'kimi-k2.5'];
  let model = await firstWorkingModel(
    'OpenCode Go (Anthropic)', 'app:anthropic(normaliseBaseUrl)', candidates,
    (m) => anthropicBuilder(baseUrl, apiKey, m),
  );
  let builderFor = (m) => anthropicBuilder(baseUrl, apiKey, m);
  if (!model) {
    // app normaliseBaseUrl keeps deep paths as-is → POST {base}/messages;
    // if the gateway only serves /v1/messages, this fallback documents it.
    model = await firstWorkingModel(
      'OpenCode Go (Anthropic)', 'fallback:anthropic(base+/v1)', candidates,
      (m) => anthropicBuilderExplicitV1(baseUrl, apiKey, m),
    );
    builderFor = (m) => anthropicBuilderExplicitV1(baseUrl, apiKey, m);
  }
  if (model) {
    report.channels['OpenCode Go (Anthropic)'] = { model };
    for (const [scenario, call, note] of [
      ['reasoning-thinking-enabled',
        { ...BASIC_CALL, maxOutputTokens: 1200, providerOptions: { anthropic: { thinking: { type: 'enabled', budgetTokens: 1024 } } } },
        'fixture anthropic-reasoning-thinking-enabled: body.thinking {type:enabled,budget_tokens}'],
      ['effort-output-config',
        { ...BASIC_CALL, providerOptions: { anthropic: { thinking: { type: 'adaptive' }, effort: 'high' } } },
        'fixture anthropic-effort-high: body.output_config.effort + thinking adaptive (发现 1)'],
      ['tool-choice-named', TOOL_CALL,
        'fixture anthropic-tool-choice-named: tool_choice {type:tool,name}; SDK auto-adds structured-outputs beta (发现 2 — proxy acceptance probe)'],
    ]) {
      report.records.push(await runScenario({
        channel: 'OpenCode Go (Anthropic)', path: 'app:anthropic', scenario,
        buildModel: builderFor(model), call, note,
      }));
    }
  }
}

// B. OpenCode Go (OpenAI) — @ai-sdk/openai-compatible candidate adapter
if (rows['OpenCode Go (OpenAI)']) {
  const { baseUrl, apiKey } = rows['OpenCode Go (OpenAI)'];
  const candidates = ['glm-5', 'deepseek-v4-flash', 'kimi-k2.5'];
  const model = await firstWorkingModel(
    'OpenCode Go (OpenAI)', 'candidate:openai-compatible', candidates,
    (m) => compatBuilder(baseUrl, apiKey, m),
  );
  if (model) {
    report.channels['OpenCode Go (OpenAI)'] = { model };
    for (const [scenario, call, note] of [
      ['reasoning-effort',
        { ...BASIC_CALL, providerOptions: { 'openai-compatible': { reasoningEffort: 'low' } } },
        'fixture compat-reasoning-effort: body.reasoning_effort (fixture used high; low here to cap cost — same param)'],
      ['tool-choice-named', TOOL_CALL,
        'fixture compat-tool-choice-named: tool_choice {type:function,function:{name}}'],
    ]) {
      report.records.push(await runScenario({
        channel: 'OpenCode Go (OpenAI)', path: 'candidate:openai-compatible', scenario,
        buildModel: compatBuilder(baseUrl, apiKey, model), call, note,
      }));
    }
  }
}

// C. ClinePass — app .chat() path against api.cline.bot
if (rows['ClinePass']) {
  const { baseUrl, apiKey } = rows['ClinePass'];
  const candidates = ['x-ai/grok-code-fast-1', 'anthropic/claude-haiku-4.5', 'openai/gpt-5-mini', 'minimax/minimax-m2.5'];
  const model = await firstWorkingModel(
    'ClinePass', 'app:openai.chat', candidates,
    (m) => gatewayChatBuilder(baseUrl, apiKey, m),
  );
  if (model) {
    report.channels['ClinePass'] = { model };
    for (const [scenario, call, note] of [
      ['reasoning-effort',
        { ...BASIC_CALL, providerOptions: { openai: { reasoningEffort: 'low' } } },
        'fixture openai-chat-reasoning-effort: body.reasoning_effort (fixture used high; low here to cap cost — same param)'],
      ['tool-choice-named', TOOL_CALL,
        'fixture openai-chat-tool-choice-named: tool_choice {type:function,function:{name}}'],
    ]) {
      report.records.push(await runScenario({
        channel: 'ClinePass', path: 'app:openai.chat', scenario,
        buildModel: gatewayChatBuilder(baseUrl, apiKey, model), call, note,
      }));
    }
  }
}

// D. OpenRouter — DB row base_url is the Anthropic-Messages skin
// (https://openrouter.ai/api → app routes via claude-code-compat); the
// fixture matrix's OpenRouter-class column is the Chat Completions skin.
// Probe the chat skin (matrix-aligned) as primary; one raw Messages call
// against the configured skin as informational evidence.
if (rows['OpenRouter']) {
  const { baseUrl, apiKey } = rows['OpenRouter'];
  const chatBase = 'https://openrouter.ai/api/v1';
  const candidates = ['anthropic/claude-haiku-4.5', 'z-ai/glm-5.2', 'openai/gpt-chat-latest'];
  const model = await firstWorkingModel(
    'OpenRouter', 'matrix:openai.chat(v1 chat skin)', candidates,
    (m) => gatewayChatBuilder(chatBase, apiKey, m),
  );
  if (model) {
    report.channels['OpenRouter'] = { model };
    for (const [scenario, call, note] of [
      ['reasoning-effort',
        { ...BASIC_CALL, maxOutputTokens: 1200, providerOptions: { openai: { reasoningEffort: 'low' } } },
        'fixture openai-chat-reasoning-effort: body.reasoning_effort passthrough on OpenRouter'],
      ['tool-choice-named', TOOL_CALL,
        'fixture openai-chat-tool-choice-named: tool_choice {type:function,function:{name}}'],
    ]) {
      report.records.push(await runScenario({
        channel: 'OpenRouter', path: 'matrix:openai.chat', scenario,
        buildModel: gatewayChatBuilder(chatBase, apiKey, model), call, note,
      }));
    }

    // Informational: the skin actually configured in the DB row (Anthropic
    // Messages). Raw fetch with manual 3-retry exponential backoff.
    const msgUrl = baseUrl + '/v1/messages';
    const rec = { channel: 'OpenRouter', path: 'as-configured:anthropic-skin(raw Messages)', scenario: 'basic-chat', maxRetries: 3 };
    let attempts = 0;
    for (let i = 0; i <= 3; i++) {
      attempts += 1;
      try {
        const res = await fetch(msgUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model, max_tokens: 64, system: PROBE_SYSTEM, messages: [{ role: 'user', content: PROBE_PROMPT }] }),
          signal: AbortSignal.timeout(60_000),
        });
        const text = await res.text();
        if (res.status === 429 || res.status >= 500) throw new Error(`retryable ${res.status}: ${text.slice(0, 200)}`);
        rec.attempts = attempts;
        rec.wire = { url: msgUrl, params: { model, max_tokens: 64 } };
        if (res.ok) {
          const j = JSON.parse(text);
          rec.ok = true;
          rec.response = { id: j.id ?? null, model: j.model ?? null, usage: j.usage ?? null, stopReason: j.stop_reason ?? null };
        } else {
          rec.ok = false;
          rec.error = { status: res.status, responseBody: scrub(text).slice(0, 400) };
        }
        break;
      } catch (e) {
        if (i === 3) {
          rec.ok = false;
          rec.attempts = attempts;
          rec.error = { status: null, message: scrub(e?.message).slice(0, 400) };
        } else {
          await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
        }
      }
    }
    console.log(JSON.stringify(rec));
    report.records.push(rec);
  }
}

// ── Report ──────────────────────────────────────────────────────

report.finishedAt = new Date().toISOString();
const outIdx = process.argv.indexOf('--out');
if (outIdx !== -1 && process.argv[outIdx + 1]) {
  const outPath = process.argv[outIdx + 1];
  const serialized = scrub(JSON.stringify(report, null, 2));
  fs.writeFileSync(outPath, serialized);
  console.error(`report written: ${outPath}`);
}
const okCount = report.records.filter((r) => r.ok).length;
console.error(`done: ${okCount}/${report.records.length} scenarios ok; skipped rows: ${skipped.map((s) => s.name).join(', ') || 'none'}`);
