import { NextRequest, NextResponse } from 'next/server';
import { getSetting } from '@/lib/db';

/**
 * POST /api/settings/qq/verify
 *
 * Verifies QQ Bot credentials by:
 * 1. Getting an access token via appId + appSecret
 * 2. Fetching the WebSocket gateway URL
 *
 * If both succeed, credentials are valid.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    let { app_id, app_secret } = body;

    // Fall back to stored values if not provided or masked
    if (!app_id) {
      app_id = getSetting('bridge_qq_app_id') || '';
    }
    if (!app_secret || app_secret.startsWith('***')) {
      app_secret = getSetting('bridge_qq_app_secret') || '';
    }

    if (!app_id || !app_secret) {
      return NextResponse.json(
        { verified: false, error: 'App ID and App Secret are required' },
        { status: 400 },
      );
    }

    // Step 1: Get access token
    const tokenRes = await fetch('https://bots.qq.com/app/getAppAccessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: app_id, clientSecret: app_secret }),
      signal: AbortSignal.timeout(10_000),
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return NextResponse.json({
        verified: false,
        error: tokenData.message || 'Failed to get access token',
      });
    }

    // Step 2: Verify gateway is reachable
    const gatewayRes = await fetch('https://api.sgroup.qq.com/gateway', {
      method: 'GET',
      headers: { Authorization: `QQBot ${tokenData.access_token}` },
      signal: AbortSignal.timeout(10_000),
    });

    const gatewayData = await gatewayRes.json();
    if (!gatewayData.url) {
      return NextResponse.json({
        verified: false,
        error: 'Failed to get gateway URL',
      });
    }

    return NextResponse.json({
      verified: true,
      gatewayUrl: gatewayData.url,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Verification failed';
    return NextResponse.json({ verified: false, error: message }, { status: 500 });
  }
}
