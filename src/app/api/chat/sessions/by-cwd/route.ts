import { NextRequest, NextResponse } from 'next/server';
import { getLatestSessionByWorkingDirectory } from '@/lib/db';

export async function GET(req: NextRequest) {
  const cwd = req.nextUrl.searchParams.get('cwd');
  if (!cwd) {
    return NextResponse.json({ error: 'cwd is required' }, { status: 400 });
  }

  const session = getLatestSessionByWorkingDirectory(cwd);
  if (session) {
    return NextResponse.json({ sessionId: session.id });
  }
  return NextResponse.json({ sessionId: null });
}
