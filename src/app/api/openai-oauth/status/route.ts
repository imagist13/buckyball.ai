import { NextResponse } from 'next/server';
import { getOAuthStatus, clearOAuthTokens, cancelOAuthFlow } from '@/lib/openai-oauth-manager';

/**
 * GET /api/openai-oauth/status — Check OpenAI OAuth login status.
 */
export async function GET() {
  return NextResponse.json(getOAuthStatus());
}

/**
 * DELETE /api/openai-oauth/status — Logout: clear tokens AND cancel any pending OAuth flow.
 */
export async function DELETE() {
  clearOAuthTokens();
  await cancelOAuthFlow();
  return NextResponse.json({ success: true });
}
