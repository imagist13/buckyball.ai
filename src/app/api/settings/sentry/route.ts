import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { resolveCodePilotDataDir } from '@/lib/codepilot-data-dir';

/** Path to the Sentry opt-out marker file, read by Electron main process at startup */
function getSentryMarkerPath() {
  return path.join(resolveCodePilotDataDir(), 'sentry-disabled');
}

/** GET /api/settings/sentry — read opt-out state */
export async function GET() {
  try {
    const markerPath = getSentryMarkerPath();
    const disabled = fs.existsSync(markerPath) && fs.readFileSync(markerPath, 'utf-8').trim() === 'true';
    return NextResponse.json({ disabled });
  } catch {
    return NextResponse.json({ disabled: false });
  }
}

/** POST /api/settings/sentry — write opt-out state */
export async function POST(request: NextRequest) {
  try {
    const { disabled } = await request.json();
    const markerPath = getSentryMarkerPath();
    const dir = path.dirname(markerPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(markerPath, disabled ? 'true' : 'false', 'utf-8');
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
