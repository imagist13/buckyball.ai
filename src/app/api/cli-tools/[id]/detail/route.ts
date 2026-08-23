import { NextResponse } from 'next/server';
import { CLI_TOOLS_CATALOG } from '@/lib/cli-tools-catalog';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tool = CLI_TOOLS_CATALOG.find(t => t.id === id);
  if (!tool) {
    return NextResponse.json({ error: 'Tool not found' }, { status: 404 });
  }

  return NextResponse.json({
    id: tool.id,
    name: tool.name,
    detailIntro: tool.detailIntro,
    useCases: tool.useCases,
    guideSteps: tool.guideSteps,
    examplePrompts: tool.examplePrompts,
    homepage: tool.homepage,
    repoUrl: tool.repoUrl,
    officialDocsUrl: tool.officialDocsUrl,
  });
}
