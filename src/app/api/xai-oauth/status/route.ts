import { NextResponse } from 'next/server';
import {
  cancelXaiOAuthFlow,
  clearXaiOAuthTokens,
  getXaiOAuthStatus,
  isXaiOAuthUsable,
} from '@/lib/xai-oauth-manager';

export async function GET() {
  return NextResponse.json({
    ...getXaiOAuthStatus(),
    // `authenticated` only means a bundle exists. `usable` also accounts for
    // expiry/refreshability and is what media/provider UI actions must trust.
    usable: isXaiOAuthUsable(),
  });
}

export async function DELETE() {
  await cancelXaiOAuthFlow();
  clearXaiOAuthTokens();
  return NextResponse.json({ success: true, accountUrl: 'https://accounts.x.ai' });
}
