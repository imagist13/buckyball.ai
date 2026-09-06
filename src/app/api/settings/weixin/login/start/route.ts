/**
 * Start WeChat QR code login.
 * POST — generates a QR code for scanning
 */

import { NextResponse } from 'next/server';
import { startQrLoginSession } from '@/lib/bridge/adapters/weixin/weixin-auth';

export async function POST() {
  try {
    const { sessionId, qrImage } = await startQrLoginSession();
    return NextResponse.json({ session_id: sessionId, qr_image: qrImage });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to start QR login' },
      { status: 500 },
    );
  }
}
