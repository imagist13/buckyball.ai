/**
 * Phase 4 ④ smoke — @ai-sdk/mcp adapter POC over a REAL stdio transport.
 *
 * Companion to src/__tests__/unit/mcp-sdk-adapter-poc.test.ts: the unit test
 * proves the adapter + production permission wrapper over an in-memory MCP
 * pipe; this script proves the same contract against a REAL child-process
 * MCP server (scripts/fixture-mcp-stdio-server.mjs) over
 * @ai-sdk/mcp/mcp-stdio's StdioMCPTransport — real spawn, real pipes, real
 * initialize handshake.
 *
 * Scenarios:
 *   1. read-only tool, approval approved → note content round-trips
 *   2. write tool, approval DENIED → denial string AND the on-disk write log
 *      (checked from OUTSIDE the server process) stays empty  ← 反例
 *   3. write tool, approval approved → write lands in the log
 *
 * Safety: no network, no credentials (the fixture server is local and
 * deterministic); app data dir isolated to a temp dir BEFORE any @/lib
 * import, so permission rows land in a throwaway DB.
 *
 * Usage: npx tsx scripts/smoke-ai-sdk7-phase4-mcp-poc.ts [--out report.json]
 */

import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

// ── Isolated app data dir (BEFORE any @/lib import) ─────────────

const tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase4-mcp-poc-smoke-'));
process.env.CLAUDE_GUI_DATA_DIR = tempDataDir;
process.env.CODEPILOT_DISABLE_DB_MIGRATION_IN_TESTS = '1';
fs.writeFileSync(path.join(tempDataDir, 'codepilot.db'), '');
process.env.NODE_ENV = 'development';

const writeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase4-mcp-writes-'));
const writeLog = path.join(writeDir, 'fixture-writes.log');

async function main() {
  const { Experimental_StdioMCPTransport: StdioMCPTransport } = await import('@ai-sdk/mcp/mcp-stdio');
  const {
    connectMcpSdkClientPoc,
    buildMcpSdkToolSetPoc,
    wrapMcpSdkToolSetWithProductionPermissions,
  } = await import('@/lib/experimental/mcp-sdk-adapter-poc');
  const { resolvePendingPermission } = await import('@/lib/permission-registry');
  const { verifyApprovalToken } = await import('@/lib/permission-approval-token');
  const { createSession, getPermissionRequest } = await import('@/lib/db');

  const transport = new StdioMCPTransport({
    command: process.execPath,
    args: [path.join(process.cwd(), 'scripts', 'fixture-mcp-stdio-server.mjs')],
    env: { FIXTURE_WRITE_DIR: writeDir },
  });

  const client = await connectMcpSdkClientPoc(transport);
  const tools = await buildMcpSdkToolSetPoc(client, 'fixture');

  const session = createSession('phase4-mcp-poc-smoke', 'native');
  interface PermReq { permissionRequestId: string; approvalToken?: string; toolName: string }
  let pendingResolve: ((req: PermReq) => void) | null = null;
  const wrapped = wrapMcpSdkToolSetWithProductionPermissions(tools, {
    sessionId: session.id,
    permissionMode: 'normal',
    emitSSE: (event) => {
      const e = event as { type: string; data: string };
      if (e.type === 'permission_request') pendingResolve?.(JSON.parse(e.data) as PermReq);
    },
    abortSignal: new AbortController().signal,
  });

  const exec = (name: string, input: unknown) => {
    const t = wrapped[name] as { execute?: (input: unknown, opts: unknown) => Promise<unknown> };
    if (!t?.execute) throw new Error(`tool ${name} missing execute`);
    return t.execute(input, { toolCallId: `smoke-${Date.now()}`, messages: [] });
  };
  const nextPermission = () => new Promise<PermReq>((resolve) => { pendingResolve = resolve; });

  const results: Array<Record<string, unknown>> = [];

  // 1. read-only + approve
  {
    const pending = nextPermission();
    const resultP = exec('mcp__fixture__fixture_read_note', {});
    const req = await pending;
    const dbRow = getPermissionRequest(req.permissionRequestId);
    const tokenOk = !!dbRow && verifyApprovalToken(req.permissionRequestId, dbRow.expires_at, req.approvalToken);
    resolvePendingPermission(req.permissionRequestId, { behavior: 'allow' });
    const result = await resultP;
    const pass = result === 'POC NOTE CONTENT — stdio fixture payload' && tokenOk;
    results.push({ scenario: 'read-only approve', pass, tokenVerified: tokenOk, resultPreview: String(result).slice(0, 60) });
  }

  // 2. write + DENY (反例: on-disk log must stay absent/empty)
  {
    const pending = nextPermission();
    const resultP = exec('mcp__fixture__fixture_write_note', { text: 'denied-should-not-land' });
    const req = await pending;
    resolvePendingPermission(req.permissionRequestId, { behavior: 'deny', message: 'smoke deny' });
    const result = await resultP;
    const logExists = fs.existsSync(writeLog) && fs.readFileSync(writeLog, 'utf8').trim().length > 0;
    const pass = result === 'Permission denied by user: smoke deny' && !logExists;
    results.push({ scenario: 'write DENIED (反例)', pass, denialString: result, serverSideWriteHappened: logExists });
  }

  // 3. write + approve
  {
    const pending = nextPermission();
    const resultP = exec('mcp__fixture__fixture_write_note', { text: 'approved-landed' });
    const req = await pending;
    resolvePendingPermission(req.permissionRequestId, { behavior: 'allow' });
    const result = await resultP;
    const logContent = fs.existsSync(writeLog) ? fs.readFileSync(writeLog, 'utf8') : '';
    const pass = result === 'wrote 15 chars' && logContent.includes('approved-landed');
    results.push({ scenario: 'write approved', pass, result, logContent: logContent.trim() });
  }

  await client.close();

  const report = {
    smoke: 'ai-sdk7-phase4-mcp-poc',
    timestamp: new Date().toISOString(),
    transport: 'stdio (child process via @ai-sdk/mcp/mcp-stdio StdioMCPTransport)',
    server: 'scripts/fixture-mcp-stdio-server.mjs (@modelcontextprotocol/sdk Server)',
    allPass: results.every((r) => r.pass === true),
    results,
  };

  const outFlag = process.argv.indexOf('--out');
  const outPath = outFlag > -1 ? process.argv[outFlag + 1] : null;
  const json = JSON.stringify(report, null, 2);
  if (outPath) fs.writeFileSync(outPath, json);
  console.log(json);

  fs.rmSync(tempDataDir, { recursive: true, force: true });
  fs.rmSync(writeDir, { recursive: true, force: true });
  process.exit(report.allPass ? 0 : 1);
}

main().catch((err) => {
  console.error('[phase4-mcp-poc-smoke] fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
