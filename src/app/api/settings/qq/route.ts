import { NextRequest, NextResponse } from 'next/server';
import { getSetting, setSetting } from '@/lib/db';

/**
 * QQ Bot bridge settings.
 * Stored in the SQLite settings table (same as other app settings).
 */

const QQ_KEYS = [
  'bridge_qq_enabled',
  'bridge_qq_app_id',
  'bridge_qq_app_secret',
  'bridge_qq_allowed_users',
  'bridge_qq_image_enabled',
  'bridge_qq_max_image_size',
] as const;

export async function GET() {
  try {
    const result: Record<string, string> = {};
    for (const key of QQ_KEYS) {
      const value = getSetting(key);
      if (value !== undefined) {
        // Mask app secret for security
        if (key === 'bridge_qq_app_secret' && value.length > 8) {
          result[key] = '***' + value.slice(-8);
        } else {
          result[key] = value;
        }
      }
    }

    return NextResponse.json({ settings: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to read QQ settings';
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
      if (!QQ_KEYS.includes(key as typeof QQ_KEYS[number])) continue;
      const strValue = String(value ?? '').trim();

      // Don't overwrite secret if user sent the masked version back
      if (key === 'bridge_qq_app_secret' && strValue.startsWith('***')) {
        continue;
      }

      setSetting(key, strValue);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save QQ settings';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
