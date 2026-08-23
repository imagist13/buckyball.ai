import { NextResponse } from "next/server";
import {
  isValidMarketplaceSkillName,
  spawnSkillsProcess,
  validateMarketplaceMutationRequest,
} from "@/lib/skills-marketplace-command";

export async function POST(request: Request) {
  const requestError = validateMarketplaceMutationRequest(request);
  if (requestError) {
    return NextResponse.json(
      { error: requestError.error },
      { status: requestError.status },
    );
  }
  try {
    const body = await request.json().catch(() => null) as {
      skill?: unknown;
      global?: unknown;
    } | null;
    const skill = body?.skill;
    const isGlobal = body?.global;

    if (!isValidMarketplaceSkillName(skill)) {
      return NextResponse.json(
        { error: "skill must be a valid installed marketplace skill name" },
        { status: 400 }
      );
    }
    if (isGlobal !== undefined && typeof isGlobal !== "boolean") {
      return NextResponse.json(
        { error: "global must be a boolean" },
        { status: 400 },
      );
    }

    const args = ["skills", "remove", skill, "-y", "--agent", "claude-code"];
    if (isGlobal !== false) {
      args.splice(3, 0, "-g");
    }

    const child = spawnSkillsProcess(args);

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const send = (event: string, data: string) => {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        };

        child.stdout?.on("data", (chunk: Buffer) => {
          send("output", chunk.toString());
        });

        child.stderr?.on("data", (chunk: Buffer) => {
          send("output", chunk.toString());
        });

        child.on("close", (code) => {
          if (code === 0) {
            send("done", "Uninstall completed successfully");
          } else {
            send("error", `Process exited with code ${code}`);
          }
          controller.close();
        });

        child.on("error", (err) => {
          send("error", err.message);
          controller.close();
        });
      },
      cancel() {
        child.kill();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("[marketplace/remove] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Remove failed" },
      { status: 500 }
    );
  }
}
