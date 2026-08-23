import { NextRequest, NextResponse } from 'next/server';
import type { PluginsResponse, ErrorResponse } from '@/types';
import { getPluginInfoList } from '@/lib/plugin-discovery';

export async function GET(request: NextRequest): Promise<NextResponse<PluginsResponse | ErrorResponse>> {
  try {
    // Accept optional cwd for project/local settings layer resolution
    const cwd = request.nextUrl.searchParams.get('cwd') || undefined;
    const plugins = getPluginInfoList(cwd);
    return NextResponse.json({ plugins });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load plugins' },
      { status: 500 }
    );
  }
}
