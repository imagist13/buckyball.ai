import { NextRequest, NextResponse } from 'next/server';
import { getSetting, setSetting } from '@/lib/db';

/**
 * Discord Bot bridge settings.
 * Stored in the SQLite settings table (same as other app settings).
 */

const DISCORD_KEYS = [
  'bridge_discord_enabled',
  'bridge_discord_bot_token',
  'bridge_discord_allowed_users',
  'bridge_discord_allowed_channels',
  'bridge_discord_allowed_guilds',
  'bridge_discord_group_policy',
  'bridge_discord_require_mention',
  'bridge_discord_stream_enabled',
  'bridge_discord_stream_interval_ms',
  'bridge_discord_stream_min_delta_chars',
  'bridge_discord_stream_max_chars',
  'bridge_discord_max_attachment_size',
  'bridge_discord_image_enabled',
] as const;

export async function GET() {
  try {
    const result: Record<string, string> = {};
    for (const key of DISCORD_KEYS) {
      const value = getSetting(key);
      if (value !== undefined) {
        // Mask bot token for security (keep last 8 chars)
        if (key === 'bridge_discord_bot_token' && value.length > 8) {
          result[key] = '***' + value.slice(-8);
        } else {
          result[key] = value;
        }
      }
    }

    return NextResponse.json({ settings: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to read Discord settings';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { settings } = body;

    if (!settings || typeof settings !== 'object') {
      return NextResponse.json({ error: 'Invalid settings data' }, { status: 400 });
    }

    for (const [key, value] of Object.entries(settings)) {
      if (!DISCORD_KEYS.includes(key as typeof DISCORD_KEYS[number])) continue;
      const strValue = String(value ?? '').trim();

      // Don't overwrite token if user sent the masked version back
      if (key === 'bridge_discord_bot_token' && strValue.startsWith('***')) {
        continue;
      }

      setSetting(key, strValue);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save Discord settings';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
