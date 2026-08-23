/**
 * POST /api/bridge/feishu/register/start
 *
 * Begin a Feishu App Registration device flow.
 * Returns a session_id and verification_url for the frontend to open in a browser.
 */

import { NextResponse } from 'next/server';
import { startRegistration } from '@/lib/bridge/feishu-app-registration';

export async function POST() {
  try {
    const { sessionId, verificationUrl } = await startRegistration();
    return NextResponse.json({ session_id: sessionId, verification_url: verificationUrl });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to start registration' },
      { status: 500 },
    );
  }
}
