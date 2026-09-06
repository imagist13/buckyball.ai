import { NextRequest, NextResponse } from 'next/server';
import { getSetting } from '@/lib/db';

/**
 * POST /api/settings/discord/verify
 *
 * Verifies Discord bot token by calling the Discord API /users/@me endpoint.
 * If bot_token starts with "***" (masked), falls back to the stored token.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    let { bot_token } = body;

    // Fall back to stored value if not provided or masked
    if (!bot_token || bot_token.startsWith('***')) {
      bot_token = getSetting('bridge_discord_bot_token') || '';
    }

    if (!bot_token) {
      return NextResponse.json(
        { verified: false, error: 'Bot token is required' },
        { status: 400 },
      );
    }

    // Call Discord API to verify the token
    const res = await fetch('https://discord.com/api/v10/users/@me', {
      method: 'GET',
      headers: {
        Authorization: `Bot ${bot_token}`,
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      return NextResponse.json({
        verified: false,
        error: errorData.message || `HTTP ${res.status}: Token verification failed`,
      });
    }

    const data = await res.json();

    if (data.id) {
      return NextResponse.json({
        verified: true,
        botName: data.username ? `${data.username}#${data.discriminator || '0'}` : data.id,
      });
    }

    return NextResponse.json({
      verified: false,
      error: 'Could not retrieve bot info',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Verification failed';
    return NextResponse.json({ verified: false, error: message }, { status: 500 });
  }
}
