import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { getSetting } from '@/lib/db';

interface OrganizeAction {
  action: 'capture' | 'classify' | 'move' | 'archive' | 'suggest-evolution';
  title?: string;
  content?: string;
  filePath?: string;
  fromPath?: string;
  toPath?: string;
}

/** Pre-validate that user-supplied paths are safe relative paths within the workspace. */
function validateRelativePath(p: string, fieldName: string): NextResponse | null {
  if (!p) return null;
  if (path.isAbsolute(p) || p.startsWith('~') || p.includes('..')) {
    return NextResponse.json(
      { error: `${fieldName} must be a relative path within the workspace (no absolute paths, ~, or ..)` },
      { status: 400 },
    );
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const workspacePath = getSetting('assistant_workspace_path');
    if (!workspacePath) {
      return NextResponse.json({ error: 'No workspace path configured' }, { status: 400 });
    }

    const body: OrganizeAction = await request.json();

    // Path safety checks at API boundary
    if (body.filePath) {
      const err = validateRelativePath(body.filePath, 'filePath');
      if (err) return err;
    }
    if (body.fromPath) {
      const err = validateRelativePath(body.fromPath, 'fromPath');
      if (err) return err;
    }
    if (body.toPath) {
      const err = validateRelativePath(body.toPath, 'toPath');
      if (err) return err;
    }

    const organizer = await import('@/lib/workspace-organizer');

    switch (body.action) {
      case 'capture': {
        if (!body.title || !body.content) {
          return NextResponse.json({ error: 'title and content required' }, { status: 400 });
        }
        const filePath = organizer.captureNote(workspacePath, body.title, body.content);
        return NextResponse.json({ success: true, filePath });
      }

      case 'classify': {
        if (!body.filePath) {
          return NextResponse.json({ error: 'filePath required' }, { status: 400 });
        }
        const result = organizer.classifyAndSuggest(workspacePath, body.filePath);
        return NextResponse.json(result);
      }

      case 'move': {
        if (!body.fromPath || !body.toPath) {
          return NextResponse.json({ error: 'fromPath and toPath required' }, { status: 400 });
        }
        organizer.moveFile(workspacePath, body.fromPath, body.toPath);
        return NextResponse.json({ success: true });
      }

      case 'archive': {
        const result = organizer.archiveDailyMemories(workspacePath);
        return NextResponse.json({ success: true, ...result });
      }

      case 'suggest-evolution': {
        const suggestions = organizer.suggestTaxonomyEvolution(workspacePath);
        return NextResponse.json({ suggestions });
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Organize action failed';
    // Surface containment errors as 400
    if (msg.includes('escapes workspace') || msg.includes('not allowed')) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    console.error('[workspace/organize] POST failed:', e);
    return NextResponse.json({ error: 'Organize action failed' }, { status: 500 });
  }
}
