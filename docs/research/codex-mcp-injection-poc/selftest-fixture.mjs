#!/usr/bin/env node
/**
 * Phase 8 / Phase 0 POC — fixture self-test (Codex NOT required).
 *
 * Drives `fixture-memory-mcp.mjs` with the MCP SDK's own stdio client to
 * prove the fixture is a protocol-correct, spawnable stdio MCP server:
 *   initialize → tools/list → tools/call (happy / error / elicitation).
 * Plus a broken-startup probe (FIXTURE_MODE=broken).
 *
 * This isolates "is the fixture a valid MCP server?" from "does Codex's
 * per-thread config.mcp_servers actually boot + call it?" — so when a
 * runnable codex binary is available, any failure points at the injection
 * path, not the fixture.
 *
 * Run:  node docs/research/codex-mcp-injection-poc/selftest-fixture.mjs
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixture-memory-mcp.mjs');

const results = {};
let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; results[name] = { ok: true, detail }; }
  else { fail++; results[name] = { ok: false, detail }; }
}

async function happyPath() {
  const transport = new StdioClientTransport({
    command: process.execPath, // absolute node path — the wrapper-resolution point
    args: [FIXTURE],
    env: getDefaultEnvironment(),
  });
  const client = new Client({ name: 'poc-selftest', version: '0.0.1' });
  await client.connect(transport);

  const init = client.getServerVersion();
  check('initialize', init?.name === 'codepilot-memory-fixture', init);

  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  check(
    'tools/list',
    ['ask_user', 'fail_always', 'memory_recent', 'memory_search'].every((n) => tools.includes(n)),
    tools,
  );

  const search = await client.callTool({ name: 'memory_search', arguments: { query: 'chinese' } });
  const searchText = search.content?.[0]?.text ?? '';
  check('memory_search→mem-1', searchText.includes('mem-1') && !search.isError, searchText.slice(0, 80));

  const recent = await client.callTool({ name: 'memory_recent', arguments: {} });
  check('memory_recent→3 entries', (recent.content?.[0]?.text ?? '').split('mem-').length - 1 === 3, undefined);

  const failed = await client.callTool({ name: 'fail_always', arguments: {} });
  check('fail_always→isError', failed.isError === true, failed.content?.[0]?.text);

  // Client did NOT declare elicitation capability → server elicitInput must
  // not hang; fixture should surface a safe tool error.
  const elicit = await client.callTool({ name: 'ask_user', arguments: {} });
  check('ask_user→safe decline (no hang)', elicit.isError === true, elicit.content?.[0]?.text);

  await client.close();
}

async function brokenStartup() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [FIXTURE],
    env: { ...getDefaultEnvironment(), FIXTURE_MODE: 'broken' },
  });
  const client = new Client({ name: 'poc-selftest', version: '0.0.1' });
  try {
    await client.connect(transport);
    await client.close();
    check('broken-startup→connect fails', false, 'connect unexpectedly succeeded');
  } catch (err) {
    check('broken-startup→connect fails', true, err instanceof Error ? err.message : String(err));
  }
}

await happyPath();
await brokenStartup();

console.log(JSON.stringify({ pass, fail, results }, null, 2));
process.exit(fail === 0 ? 0 : 1);
