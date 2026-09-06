import { NextRequest, NextResponse } from 'next/server';
import * as gitService from '@/lib/git/service';

export async function POST(req: NextRequest) {
  try {
    const { cwd } = await req.json();
    if (!cwd) {
      return NextResponse.json({ error: 'cwd is required' }, { status: 400 });
    }

    await gitService.push(cwd);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Push failed' },
      { status: 500 }
    );
  }
}
