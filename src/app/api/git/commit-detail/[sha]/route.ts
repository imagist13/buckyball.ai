import { NextRequest, NextResponse } from 'next/server';
import * as gitService from '@/lib/git/service';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sha: string }> }
) {
  const { sha } = await params;
  const cwd = req.nextUrl.searchParams.get('cwd');
  if (!cwd) {
    return NextResponse.json({ error: 'cwd is required' }, { status: 400 });
  }

  try {
    const detail = await gitService.getCommitDetail(cwd, sha);
    return NextResponse.json(detail);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to get commit detail' },
      { status: 500 }
    );
  }
}
