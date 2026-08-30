/**
 * mcp-sdk-adapter-poc.test.ts — AI SDK 7 Phase 4 ④: @ai-sdk/mcp adapter POC
 * evidence (src/lib/experimental/mcp-sdk-adapter-poc.ts).
 *
 * The fixture MCP server is a REAL @modelcontextprotocol/sdk `Server`
 * connected over `InMemoryTransport.createLinkedPair()` — every tool call in
 * this file crosses a genuine MCP JSON-RPC session (initialize handshake,
 * tools/list, tools/call), driven from the @ai-sdk/mcp `createMCPClient`.
 *
 * Coverage per the required check:
 *   - read-only tool (fixture_read_note) executes through the adapter AND
 *     the REAL production permission wrapper (default-ask → approve), and
 *     the approval token issued on the permission_request event verifies
 *     against the persisted expiry (② and ④ compose).
 *   - write/approval tool (fixture_write_note): deny → denial string AND the
 *     server-side write did NOT happen (反例); approve → write happened.
 *   - naming contract `mcp__{server}__{tool}` pinned (permission rules key
 *     on it).
 *   - result-extraction parity with mcp-tool-adapter.ts on canned MCP result
 *     shapes (multi-text join, isError, non-content fallback).
 *
 * Zero-regression for the EXISTING MCP path is carried by the untouched
 * production files (mcp-connection-manager.ts / mcp-tool-adapter.ts — see
 * diff) plus the existing suite (mcp-loader / builtin-mcp-catalog /
 * mcp-config / project-mcp-injection) staying green.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { MCPTransport, MCPClient } from '@ai-sdk/mcp';
import type { ToolSet } from 'ai';

import {
  connectMcpSdkClientPoc,
  buildMcpSdkToolSetPoc,
  wrapMcpSdkToolSetWithProductionPermissions,
  extractMcpResultText,
} from '@/lib/experimental/mcp-sdk-adapter-poc';
import { resolvePendingPermission } from '@/lib/permission-registry';
import { verifyApprovalToken } from '@/lib/permission-approval-token';
import { createSession, getPermissionRequest } from '@/lib/db';
import type { SSEEvent } from '@/types';

// ── Fixture MCP server (real protocol, in-memory pipe) ──────────

const NOTE_CONTENT = 'POC NOTE CONTENT — read-only fixture payload';
const serverWrites: string[] = [];

function buildFixtureServer(): Server {
  const server = new Server(
    { name: 'poc-fixture-server', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'fixture_read_note',
        description: 'Read the fixture note (read-only)',
        inputSchema: { type: 'object', properties: {}, required: [] },
      },
      {
        name: 'fixture_write_note',
        description: 'Append text to the fixture note (write)',
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string', description: 'Text to append' } },
          required: ['text'],
        },
      },
      {
        name: 'fixture_error',
        description: 'Always returns an MCP error result',
        inputSchema: { type: 'object', properties: {}, required: [] },
      },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    switch (req.params.name) {
      case 'fixture_read_note':
        return { content: [{ type: 'text', text: NOTE_CONTENT }] };
      case 'fixture_write_note': {
        const text = String((req.params.arguments as Record<string, unknown>)?.text ?? '');
        serverWrites.push(text);
        return { content: [{ type: 'text', text: `wrote ${text.length} chars` }] };
      }
      case 'fixture_error':
        return { content: [{ type: 'text', text: 'boom from fixture' }], isError: true };
      default:
        return { content: [{ type: 'text', text: `unknown tool ${req.params.name}` }], isError: true };
    }
  });
  return server;
}

let client: MCPClient;
let server: Server;
let pocTools: ToolSet;

before(async () => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  server = buildFixtureServer();
  await server.connect(serverTransport);
  // Structural match: @modelcontextprotocol Transport ⊇ @ai-sdk/mcp MCPTransport
  client = await connectMcpSdkClientPoc(clientTransport as unknown as MCPTransport);
  pocTools = await buildMcpSdkToolSetPoc(client, 'fixture');
});

after(async () => {
  try { await client.close(); } catch { /* already closed */ }
  try { await server.close(); } catch { /* already closed */ }
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function execTool(tools: ToolSet, name: string, input: unknown): Promise<any> {
  const t = tools[name] as { execute?: (input: unknown, opts: unknown) => Promise<unknown> };
  assert.ok(t?.execute, `tool ${name} has execute`);
  return t.execute(input, { toolCallId: `call-${name}-${Date.now()}`, messages: [] });
}

/** Permission harness: real wrapper + real registry + SSE capture. */
function permissionHarness() {
  const session = createSession('mcp-poc-test', 'native');
  const events: SSEEvent[] = [];
  let notify: (() => void) | null = null;
  const nextPermissionRequest = () =>
    new Promise<{ permissionRequestId: string; approvalToken?: string; toolName: string }>((resolve) => {
      notify = () => {
        const e = [...events].reverse().find((ev) => ev.type === 'permission_request');
        if (e) resolve(JSON.parse(e.data));
      };
    });
  const wrapped = wrapMcpSdkToolSetWithProductionPermissions(pocTools, {
    sessionId: session.id,
    permissionMode: 'normal',
    emitSSE: (event) => {
      events.push(event as SSEEvent);
      notify?.();
    },
    abortSignal: new AbortController().signal,
  });
  return { sessionId: session.id, events, wrapped, nextPermissionRequest };
}

// ── Contract point 1: naming + schema ────────────────────────────

describe('@ai-sdk/mcp adapter POC — tool naming contract', () => {
  it('exposes fully qualified mcp__{server}__{tool} names with descriptions', () => {
    assert.deepEqual(
      Object.keys(pocTools).sort(),
      ['mcp__fixture__fixture_error', 'mcp__fixture__fixture_read_note', 'mcp__fixture__fixture_write_note'],
    );
    const read = pocTools['mcp__fixture__fixture_read_note'] as { description?: string };
    assert.equal(read.description, 'Read the fixture note (read-only)');
  });
});

// ── Read-only tool through real permission flow (approve) ────────

describe('@ai-sdk/mcp adapter POC — read-only tool', () => {
  it('default-ask is preserved; approve executes over the real MCP session', async () => {
    const h = permissionHarness();
    const pending = h.nextPermissionRequest();
    const resultP = execTool(h.wrapped, 'mcp__fixture__fixture_read_note', {});

    const req = await pending;
    assert.equal(req.toolName, 'mcp__fixture__fixture_read_note');
    // ② composes with ④: the event carries a verifying approval token.
    const dbRow = getPermissionRequest(req.permissionRequestId);
    assert.ok(dbRow, 'permission request persisted');
    assert.ok(
      verifyApprovalToken(req.permissionRequestId, dbRow.expires_at, req.approvalToken),
      'permission_request event carries a verifying approval token',
    );

    assert.ok(resolvePendingPermission(req.permissionRequestId, { behavior: 'allow' }));
    const result = await resultP;
    assert.equal(result, NOTE_CONTENT, 'read-only tool round-tripped through real MCP JSON-RPC');
    assert.equal(getPermissionRequest(req.permissionRequestId)?.status, 'allow');
  });
});

// ── Write tool: deny blocks the server-side effect (反例) ────────

describe('@ai-sdk/mcp adapter POC — write/approval tool', () => {
  it('deny returns the denial string AND the server-side write does not happen', async () => {
    const before_ = serverWrites.length;
    const h = permissionHarness();
    const pending = h.nextPermissionRequest();
    const resultP = execTool(h.wrapped, 'mcp__fixture__fixture_write_note', { text: 'should-not-land' });

    const req = await pending;
    assert.ok(resolvePendingPermission(req.permissionRequestId, { behavior: 'deny', message: 'nope' }));
    const result = await resultP;
    assert.equal(result, 'Permission denied by user: nope');
    assert.equal(serverWrites.length, before_, '反例: denied write must not reach the MCP server');
    assert.equal(getPermissionRequest(req.permissionRequestId)?.status, 'deny');
  });

  it('approve executes the write on the server and returns its result text', async () => {
    const h = permissionHarness();
    const pending = h.nextPermissionRequest();
    const resultP = execTool(h.wrapped, 'mcp__fixture__fixture_write_note', { text: 'landed-via-poc' });

    const req = await pending;
    assert.ok(resolvePendingPermission(req.permissionRequestId, { behavior: 'allow' }));
    const result = await resultP;
    assert.equal(result, 'wrote 14 chars');
    assert.ok(serverWrites.includes('landed-via-poc'), 'approved write reached the MCP server');
  });
});

// ── Contract point 2: result-extraction parity ───────────────────

describe('@ai-sdk/mcp adapter POC — result extraction parity with mcp-tool-adapter', () => {
  it('joins multiple text blocks with newline (production behavior)', () => {
    assert.equal(
      extractMcpResultText({ content: [{ type: 'text', text: 'a' }, { type: 'image', data: 'x' }, { type: 'text', text: 'b' }] }),
      'a\nb',
    );
  });

  it('prefixes Error: on isError results — live via the real fixture_error tool too', async () => {
    assert.equal(
      extractMcpResultText({ content: [{ type: 'text', text: 'boom' }], isError: true }),
      'Error: boom',
    );
    // Live path: real MCP call returning isError, unwrapped (no permission).
    const result = await execTool(pocTools, 'mcp__fixture__fixture_error', {});
    assert.equal(result, 'Error: boom from fixture');
  });

  it('falls back to JSON.stringify for non-content results and passes strings through', () => {
    assert.equal(extractMcpResultText({ weird: true }), '{"weird":true}');
    assert.equal(extractMcpResultText('plain'), 'plain');
    assert.equal(
      extractMcpResultText({ content: [], isError: false }),
      JSON.stringify({ content: [], isError: false }),
      'empty content falls back to JSON (same as production)',
    );
  });
});
