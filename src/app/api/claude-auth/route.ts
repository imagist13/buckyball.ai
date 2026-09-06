import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * GET /api/claude-auth — Check Claude Code login status.
 *
 * Reads ~/.claude/.credentials to determine if the user is authenticated.
 * Returns { authenticated, email?, accountType? }.
 */
export async function GET() {
  try {
    const credPath = path.join(os.homedir(), '.claude', '.credentials');

    if (!fs.existsSync(credPath)) {
      return NextResponse.json({ authenticated: false });
    }

    const raw = fs.readFileSync(credPath, 'utf-8');
    const creds = JSON.parse(raw);

    // Claude Code stores OAuth tokens under claudeAiOauth
    const oauth = creds.claudeAiOauth;
    if (!oauth) {
      return NextResponse.json({ authenticated: false });
    }

    return NextResponse.json({
      authenticated: true,
      email: oauth.email || oauth.account?.email || undefined,
      accountType: oauth.accountType || oauth.account?.type || undefined,
      organizationName: oauth.organizationName || oauth.account?.organization || undefined,
    });
  } catch {
    return NextResponse.json({ authenticated: false });
  }
}
