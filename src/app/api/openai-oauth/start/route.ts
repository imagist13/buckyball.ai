import { NextResponse } from 'next/server';
import { startOAuthFlow } from '@/lib/openai-oauth-manager';

/**
 * GET /api/openai-oauth/start — Initiate OpenAI OAuth flow.
 *
 * Starts the PKCE flow, launches the local callback server (port 1455),
 * and returns the authorization URL for the browser.
 * The server MUST be listening before we return the URL.
 */
export async function GET() {
  try {
    const { authUrl, completion } = await startOAuthFlow();

    // Don't await completion — it resolves when the user finishes auth.
    // The frontend will poll /api/openai-oauth/status to detect completion.
    completion.catch((err) => {
      console.warn('[openai-oauth] OAuth flow did not complete:', err.message);
    });

    return NextResponse.json({ authUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to start OAuth flow';
    console.error('[openai-oauth] Start failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
