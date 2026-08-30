import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { getSession } from '@/lib/db';
import { scanDirectory, isRootPath } from '@/lib/files';
import type { MentionNodeType } from '@/types';

interface SuggestItem {
  path: string;
  display: string;
  type: MentionNodeType;
  nodeType: MentionNodeType;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const SCAN_DEPTH = 4;

function normalizeRelPath(input: string): string {
  return input.replace(/\\/g, '/').replace(/^\/+/, '');
}

function flattenTree(
  nodes: Array<{ name: string; path: string; type: 'file' | 'directory'; children?: unknown[] }>,
  baseDir: string,
  out: SuggestItem[],
) {
  for (const node of nodes) {
    const rel = normalizeRelPath(path.relative(baseDir, node.path));
    if (!rel) continue;
    const nodeType: MentionNodeType = node.type === 'directory' ? 'directory' : 'file';
    out.push({
      path: rel,
      display: nodeType === 'directory' ? `${rel}/` : rel,
      type: nodeType,
      nodeType,
    });
    if (node.type === 'directory' && node.children) {
      flattenTree(node.children as typeof nodes, baseDir, out);
    }
  }
}

function score(item: SuggestItem, q: string): number {
  const candidate = item.path.toLowerCase();
  if (!q) return 0;
  if (candidate === q) return 0;
  if (candidate.startsWith(q)) return 1;
  const slashIdx = candidate.lastIndexOf('/');
  const basename = slashIdx >= 0 ? candidate.slice(slashIdx + 1) : candidate;
  if (basename === q) return 2;
  if (basename.startsWith(q)) return 3;
  return 10;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const sessionId = searchParams.get('sessionId') || '';
  const workingDirectory = searchParams.get('workingDirectory') || '';
  const query = (searchParams.get('q') || '').trim().toLowerCase();
  const limitRaw = Number.parseInt(searchParams.get('limit') || '', 10);
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(limitRaw, MAX_LIMIT))
    : DEFAULT_LIMIT;

  let baseDir = '';
  if (sessionId) {
    const session = getSession(sessionId);
    if (!session?.working_directory) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    baseDir = path.resolve(session.working_directory);
  } else if (workingDirectory) {
    baseDir = path.resolve(workingDirectory);
  } else {
    return NextResponse.json({ error: 'Missing sessionId or workingDirectory' }, { status: 400 });
  }

  // The workspace chosen by the user IS the trust boundary — same model
  // /api/files uses. Filesystem-root paths (/, C:\) would greenlight a
  // full-disk scan, so reject those. Otherwise accept, including workspaces
  // on external volumes, /tmp, or mounts outside $HOME — a common case
  // that the earlier HOME-only check rejected only on the new-chat first
  // message (sessions had no such restriction), making the same project
  // fail intermittently.
  if (isRootPath(baseDir)) {
    return NextResponse.json({ error: 'Invalid working directory' }, { status: 403 });
  }

  const tree = await scanDirectory(baseDir, SCAN_DEPTH);
  const all: SuggestItem[] = [];
  flattenTree(tree, baseDir, all);

  const filtered = all
    .filter((item) => {
      if (!query) return true;
      const p = item.path.toLowerCase();
      const d = item.display.toLowerCase();
      return p.includes(query) || d.includes(query);
    })
    .sort((a, b) => {
      const scoreDiff = score(a, query) - score(b, query);
      if (scoreDiff !== 0) return scoreDiff;
      if (a.nodeType !== b.nodeType) return a.nodeType === 'directory' ? -1 : 1;
      return a.path.localeCompare(b.path);
    })
    .slice(0, limit);

  return NextResponse.json({ items: filtered, root: baseDir });
}
