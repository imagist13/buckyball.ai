import { NextRequest, NextResponse } from 'next/server';
import * as gitService from '@/lib/git/service';

export async function GET(req: NextRequest) {
  const cwd = req.nextUrl.searchParams.get('cwd');
  if (!cwd) {
    return NextResponse.json({ error: 'cwd is required' }, { status: 400 });
  }

  try {
    const worktrees = await gitService.getWorktrees(cwd);
    return NextResponse.json({ worktrees });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to get worktrees' },
      { status: 500 }
    );
  }
}
