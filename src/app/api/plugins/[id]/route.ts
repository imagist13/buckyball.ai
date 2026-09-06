import { NextRequest, NextResponse } from 'next/server';
import type { PluginInfo, ErrorResponse, SuccessResponse } from '@/types';
import { getPluginInfoList, setPluginEnabled } from '@/lib/plugin-discovery';

/**
 * Plugin ID format: "name@marketplace" (URL-encoded in the path segment).
 * This matches the official Claude enabledPlugins key format.
 */
function parsePluginId(rawId: string): { name: string; marketplace: string } | null {
  const decoded = decodeURIComponent(rawId);
  const atIdx = decoded.lastIndexOf('@');
  if (atIdx <= 0) return null; // no @ or @ at start
  return {
    name: decoded.slice(0, atIdx),
    marketplace: decoded.slice(atIdx + 1),
  };
}

function findPlugin(plugins: PluginInfo[], name: string, marketplace: string): PluginInfo | undefined {
  return plugins.find((p) => p.name === name && p.marketplace === marketplace);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<{ plugin: PluginInfo } | ErrorResponse>> {
  const { id } = await params;
  const parsed = parsePluginId(id);

  if (!parsed) {
    return NextResponse.json(
      { error: 'Invalid plugin ID format. Expected: name@marketplace' },
      { status: 400 },
    );
  }

  // Accept optional cwd for project/local settings layer resolution
  const cwd = request.nextUrl.searchParams.get('cwd') || undefined;
  const plugins = getPluginInfoList(cwd);
  const plugin = findPlugin(plugins, parsed.name, parsed.marketplace);

  if (!plugin) {
    return NextResponse.json({ error: 'Plugin not found' }, { status: 404 });
  }

  return NextResponse.json({ plugin });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<(SuccessResponse & { layer?: string; escalated?: boolean }) | ErrorResponse>> {
  try {
    const { id } = await params;
    const parsed = parsePluginId(id);

    if (!parsed) {
      return NextResponse.json(
        { error: 'Invalid plugin ID format. Expected: name@marketplace' },
        { status: 400 },
      );
    }

    const body = await request.json();
    const { enabled, cwd } = body as { enabled: boolean; cwd?: string };

    if (typeof enabled !== 'boolean') {
      return NextResponse.json(
        { error: 'enabled must be a boolean' },
        { status: 400 },
      );
    }

    const plugins = getPluginInfoList(cwd);
    const plugin = findPlugin(plugins, parsed.name, parsed.marketplace);

    if (!plugin) {
      return NextResponse.json({ error: 'Plugin not found' }, { status: 404 });
    }

    if (plugin.blocked) {
      return NextResponse.json(
        { error: 'Plugin is blocked and cannot be enabled' },
        { status: 403 },
      );
    }

    const pluginKey = `${parsed.name}@${parsed.marketplace}`;
    const result = setPluginEnabled(pluginKey, enabled, cwd);
    return NextResponse.json({
      success: true,
      layer: result.layer,
      escalated: result.escalated,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update plugin' },
      { status: 500 },
    );
  }
}
