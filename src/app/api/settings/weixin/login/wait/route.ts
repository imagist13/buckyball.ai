/**
 * Poll WeChat QR login status.
 * POST { session_id } — polls the QR code status
 */

import { NextResponse } from 'next/server';
import { pollQrLoginStatus, cancelQrLoginSession } from '@/lib/bridge/adapters/weixin/weixin-auth';
import { getStatus, restart } from '@/lib/bridge/bridge-manager';

async function restartIfRunning(): Promise<string | null> {
  if (!getStatus().running) {
    return null;
  }
  try {
    const result = await restart();
    return result.started ? null : (result.reason || 'Bridge restart failed');
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const sessionId = body.session_id;
    if (!sessionId) {
      return NextResponse.json({ error: 'Missing session_id' }, { status: 400 });
    }

    const session = await pollQrLoginStatus(sessionId);

    // Clean up completed sessions
    if (session.status === 'confirmed' || session.status === 'failed') {
      // Don't delete immediately — let the client read the final status
      setTimeout(() => cancelQrLoginSession(sessionId), 30_000);
    }

    // Auto-restart bridge when a new account is confirmed so the weixin
    // adapter picks it up without manual stop/start.
    let bridgeRestartError: string | undefined;
    if (session.status === 'confirmed') {
      bridgeRestartError = (await restartIfRunning()) || undefined;
    }

    return NextResponse.json({
      status: session.status,
      qr_image: session.qrImage || undefined,
      account_id: session.accountId || undefined,
      error: session.error || undefined,
      bridge_restart_error: bridgeRestartError,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to poll login status' },
      { status: 500 },
    );
  }
}
