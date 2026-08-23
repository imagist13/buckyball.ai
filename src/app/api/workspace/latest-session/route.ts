import { NextRequest, NextResponse } from 'next/server';
import { getLatestSessionByWorkingDirectory } from '@/lib/db';

export async function GET(request: NextRequest) {
  const workingDirectory = request.nextUrl.searchParams.get('workingDirectory');
  if (!workingDirectory) {
    return NextResponse.json({ error: 'Missing workingDirectory' }, { status: 400 });
  }
  const session = getLatestSessionByWorkingDirectory(workingDirectory);
  return NextResponse.json({ sessionId: session?.id ?? null });
}
