import { NextResponse } from 'next/server';

/**
 * The OAuth callback is handled by the local HTTP server on port 1455.
 * This route exists only as a placeholder — the actual callback goes to localhost:1455.
 */
export async function GET() {
  return NextResponse.json({ message: 'OAuth callback is handled by the local server on port 1455' });
}
