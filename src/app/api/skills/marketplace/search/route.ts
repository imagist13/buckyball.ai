import { NextRequest, NextResponse } from "next/server";
import { readLockFile } from "@/lib/skills-lock";
import type { MarketplaceSkill } from "@/types";

export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams.get("q") || "";
    const limit = request.nextUrl.searchParams.get("limit") || "20";

    // Skills.sh requires query >= 2 chars; use a popular fallback for empty/short queries
    const query = q.length >= 2 ? q : "claude";

    const url = new URL("https://skills.sh/api/search");
    url.searchParams.set("q", query);
    url.searchParams.set("limit", limit);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    let response: Response;
    try {
      response = await fetch(url.toString(), { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      return NextResponse.json(
        { error: `Skills.sh API returned ${response.status}` },
        { status: 502 }
      );
    }

    const data = await response.json();
    const results: unknown[] = Array.isArray(data) ? data : (data.results || data.skills || []);

    // Read lock file to mark installed skills
    const lockFile = readLockFile();
    const installedSources = new Set(
      Object.values(lockFile.skills).map((entry) => entry.source)
    );

    const skills: MarketplaceSkill[] = results.map((item: unknown) => {
      const r = item as Record<string, unknown>;
      const source = String(r.source || r.slug || r.name || "");
      const installedEntry = Object.values(lockFile.skills).find(
        (entry) => entry.source === source
      );
      return {
        id: String(r.id || r.slug || r.name || ""),
        skillId: String(r.skillId || r.name || r.slug || ""),
        name: String(r.name || r.slug || ""),
        installs: Number(r.installs || r.downloads || 0),
        source,
        isInstalled: installedSources.has(source),
        installedAt: installedEntry?.installedAt,
      };
    });

    return NextResponse.json({ skills });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json(
        { error: "Skills.sh API request timed out" },
        { status: 504 }
      );
    }
    console.error("[marketplace/search] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Search failed" },
      { status: 502 }
    );
  }
}
