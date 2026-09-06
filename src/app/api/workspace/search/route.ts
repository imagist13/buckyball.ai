import { NextRequest, NextResponse } from 'next/server';
import { getSetting } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const workspacePath = getSetting('assistant_workspace_path');
    if (!workspacePath) {
      return NextResponse.json({ error: 'No workspace path configured' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');
    const limit = parseInt(searchParams.get('limit') || '5', 10);

    if (!query) {
      return NextResponse.json({ error: 'Query parameter "q" is required' }, { status: 400 });
    }

    const { searchWorkspace } = await import('@/lib/workspace-retrieval');
    const results = searchWorkspace(workspacePath, query, { limit });

    return NextResponse.json({ results });
  } catch (e) {
    console.error('[workspace/search] GET failed:', e);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
