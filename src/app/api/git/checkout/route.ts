import { NextRequest, NextResponse } from 'next/server';
import * as gitService from '@/lib/git/service';

export async function POST(req: NextRequest) {
  try {
    const { cwd, branch } = await req.json();
    if (!cwd || !branch) {
      return NextResponse.json({ error: 'cwd and branch are required' }, { status: 400 });
    }

    await gitService.checkout(cwd, branch);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Checkout failed' },
      { status: 500 }
    );
  }
}
