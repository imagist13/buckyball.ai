import { NextRequest, NextResponse } from 'next/server';
import * as gitService from '@/lib/git/service';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { cwd?: unknown };
    if (typeof body.cwd !== 'string' || !body.cwd) {
      return NextResponse.json({ error: 'cwd is required' }, { status: 400 });
    }

    const repoRoot = await gitService.initializeRepo(body.cwd);
    return NextResponse.json({ success: true, repoRoot });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Git initialization failed' },
      { status: 500 },
    );
  }
}
