import { NextRequest, NextResponse } from 'next/server';
import * as gitService from '@/lib/git/service';

export async function GET(req: NextRequest) {
  const cwd = req.nextUrl.searchParams.get('cwd');
  if (!cwd) {
    return NextResponse.json({ error: 'cwd is required' }, { status: 400 });
  }

  try {
    const branches = await gitService.getBranches(cwd);
    return NextResponse.json({ branches });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to get branches' },
      { status: 500 }
    );
  }
}
