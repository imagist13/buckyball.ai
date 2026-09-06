import { NextResponse } from 'next/server';
import { CLI_TOOLS_CATALOG } from '@/lib/cli-tools-catalog';
import { detectCliTool } from '@/lib/cli-tools-detect';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tool = CLI_TOOLS_CATALOG.find(t => t.id === id);
  if (!tool) {
    return NextResponse.json({ error: 'Tool not found' }, { status: 404 });
  }

  try {
    const info = await detectCliTool(tool);
    return NextResponse.json(info);
  } catch (error) {
    console.error(`[cli-tools/${id}/status] Error:`, error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Detection failed' },
      { status: 500 }
    );
  }
}
