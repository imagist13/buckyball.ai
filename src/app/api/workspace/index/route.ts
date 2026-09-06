import { NextResponse } from 'next/server';
import { getSetting } from '@/lib/db';

export async function GET() {
  try {
    const workspacePath = getSetting('assistant_workspace_path');
    if (!workspacePath) {
      return NextResponse.json({ error: 'No workspace path configured' }, { status: 400 });
    }

    const { getIndexStats } = await import('@/lib/workspace-indexer');
    const stats = getIndexStats(workspacePath);

    return NextResponse.json(stats);
  } catch (e) {
    console.error('[workspace/index] GET failed:', e);
    return NextResponse.json({ error: 'Failed to get index stats' }, { status: 500 });
  }
}

export async function POST() {
  try {
    const workspacePath = getSetting('assistant_workspace_path');
    if (!workspacePath) {
      return NextResponse.json({ error: 'No workspace path configured' }, { status: 400 });
    }

    const { indexWorkspace } = await import('@/lib/workspace-indexer');
    const result = indexWorkspace(workspacePath, { force: true });

    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    console.error('[workspace/index] POST failed:', e);
    return NextResponse.json({ error: 'Indexing failed' }, { status: 500 });
  }
}
