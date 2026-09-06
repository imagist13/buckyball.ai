import { NextRequest, NextResponse } from 'next/server';
import { getSetting } from '@/lib/db';

/**
 * POST /api/settings/feishu/verify
 *
 * Verifies Feishu app credentials by calling the bot info API.
 * If app_secret starts with "***" (masked), falls back to the stored secret.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    let { app_id, app_secret } = body;
    const domainSetting = body.domain || getSetting('bridge_feishu_domain') || 'feishu';

    // Fall back to stored values if not provided or masked
    if (!app_id) {
      app_id = getSetting('bridge_feishu_app_id') || '';
    }
    if (!app_secret || app_secret.startsWith('***')) {
      app_secret = getSetting('bridge_feishu_app_secret') || '';
    }

    if (!app_id || !app_secret) {
      return NextResponse.json(
        { verified: false, error: 'App ID and App Secret are required' },
        { status: 400 },
      );
    }

    const baseUrl = domainSetting === 'lark'
      ? 'https://open.larksuite.com'
      : 'https://open.feishu.cn';

    // Get tenant access token
    const tokenRes = await fetch(`${baseUrl}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id, app_secret }),
      signal: AbortSignal.timeout(10_000),
    });
    const tokenData = await tokenRes.json();

    if (!tokenData.tenant_access_token) {
      return NextResponse.json({
        verified: false,
        error: tokenData.msg || 'Failed to get access token',
      });
    }

    // Get bot info
    const botRes = await fetch(`${baseUrl}/open-apis/bot/v3/info/`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${tokenData.tenant_access_token}` },
      signal: AbortSignal.timeout(10_000),
    });
    const botData = await botRes.json();

    if (botData?.bot?.open_id) {
      return NextResponse.json({
        verified: true,
        botName: botData.bot.app_name || botData.bot.open_id,
      });
    }

    return NextResponse.json({
      verified: false,
      error: botData?.msg || 'Could not retrieve bot info',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Verification failed';
    return NextResponse.json({ verified: false, error: message }, { status: 500 });
  }
}
