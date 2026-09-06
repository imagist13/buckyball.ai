/**
 * POST /api/codex/login
 *
 * Phase 5 Phase 2 (2026-05-13) — kick off a Codex login flow. The UI
 * caller opens the returned `authUrl` (or shows `verificationUrl` +
 * `userCode` for device code) and then listens for the completion
 * event via /api/codex/account polling.
 *
 * Body (all optional, default = chatgpt streamlined):
 *   - `{ "kind": "chatgpt" }`
 *   - `{ "kind": "chatgptDeviceCode" }`
 *   - `{ "kind": "apiKey", "apiKey": "sk-..." }`
 *
 * Returns the discriminated `CodexLoginStart` shape.
 *
 * Cancel an in-flight login by calling DELETE with the loginId.
 */

import { type NextRequest, NextResponse } from 'next/server';
import { cancelCodexLogin, startCodexLogin } from '@/lib/codex/account';
import { startCodexLoginAndInvalidateModels } from '@/lib/codex/account-transition';

interface LoginBody {
  kind?: 'chatgpt' | 'chatgptDeviceCode' | 'apiKey';
  apiKey?: string;
}

/**
 * POST body, split out so tests can drive the real handler (request parsing,
 * branching, invalidation, response) while replacing only the bottom JSON-RPC
 * call. `perform` defaults to the real login start — the route export below
 * binds production wiring.
 */
export async function handleLoginPost(
  request: NextRequest,
  perform: typeof startCodexLogin = startCodexLogin,
) {
  let body: LoginBody = {};
  try {
    body = (await request.json()) as LoginBody;
  } catch {
    // Empty body is fine — default to chatgpt streamlined.
  }

  try {
    if (body.kind === 'apiKey') {
      if (!body.apiKey || typeof body.apiKey !== 'string') {
        return NextResponse.json(
          { error: 'apiKey login requires `apiKey` string in body' },
          { status: 400 },
        );
      }
      const result = await startCodexLoginAndInvalidateModels(
        { kind: 'apiKey', apiKey: body.apiKey },
        perform,
      );
      return NextResponse.json({ login: result });
    }
    if (body.kind === 'chatgptDeviceCode') {
      const result = await startCodexLoginAndInvalidateModels({ kind: 'chatgptDeviceCode' }, perform);
      return NextResponse.json({ login: result });
    }
    const result = await startCodexLoginAndInvalidateModels({ kind: 'chatgpt' }, perform);
    return NextResponse.json({ login: result });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: reason }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return handleLoginPost(request);
}

export async function DELETE(request: NextRequest) {
  const loginId = request.nextUrl.searchParams.get('loginId');
  if (!loginId) {
    return NextResponse.json({ error: 'loginId required' }, { status: 400 });
  }
  try {
    await cancelCodexLogin(loginId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: reason }, { status: 500 });
  }
}
