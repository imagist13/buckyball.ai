import { NextRequest, NextResponse } from "next/server";

// In-memory cache: repo source → Map<skillId, raw-content path>
const treeCache = new Map<string, { paths: Map<string, string>; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Use GitHub Git Trees API to find the actual path of a SKILL.md for a given skillId.
 * Repos have widely varying structures, so we can't guess the path — we scan the tree.
 */
async function findSkillPath(
  source: string,
  skillId: string,
  signal: AbortSignal
): Promise<string | null> {
  const cached = treeCache.get(source);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.paths.get(skillId) ?? null;
  }

  // Fetch the full recursive tree for the repo's default branch
  const treeUrl = `https://api.github.com/repos/${source}/git/trees/HEAD?recursive=1`;
  const res = await fetch(treeUrl, {
    signal,
    headers: { Accept: "application/vnd.github+json" },
  });

  if (!res.ok) return null;

  const data = await res.json();
  const tree: Array<{ path: string; type: string }> = data.tree || [];

  // Index all SKILL.md files by their parent directory name (= skillId)
  const paths = new Map<string, string>();
  for (const item of tree) {
    if (item.type !== "blob") continue;
    if (!item.path.endsWith("/SKILL.md")) continue;
    // Extract the folder name right before SKILL.md
    const parts = item.path.split("/");
    const folder = parts[parts.length - 2];
    if (folder) {
      // If there are duplicates, prefer shorter paths (closer to root)
      if (!paths.has(folder) || item.path.length < (paths.get(folder)?.length ?? Infinity)) {
        paths.set(folder, item.path);
      }
    }
  }

  treeCache.set(source, { paths, ts: Date.now() });
  return paths.get(skillId) ?? null;
}

export async function GET(request: NextRequest) {
  try {
    const source = request.nextUrl.searchParams.get("source") || "";
    const skillId = request.nextUrl.searchParams.get("skillId") || "";

    if (!source || !skillId) {
      return NextResponse.json(
        { error: "source and skillId are required" },
        { status: 400 }
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      // 1. Find the actual path via tree API (cached per repo)
      const skillPath = await findSkillPath(source, skillId, controller.signal);

      if (!skillPath) {
        return NextResponse.json({ content: null }, { status: 200 });
      }

      // 2. Fetch the raw SKILL.md content
      const rawUrl = `https://raw.githubusercontent.com/${source}/HEAD/${skillPath}`;
      const res = await fetch(rawUrl, { signal: controller.signal });

      if (!res.ok) {
        return NextResponse.json({ content: null }, { status: 200 });
      }

      const content = await res.text();
      return NextResponse.json({ content });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json({ content: null }, { status: 200 });
    }
    return NextResponse.json({ content: null }, { status: 200 });
  }
}
