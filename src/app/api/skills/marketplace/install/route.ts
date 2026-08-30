import { NextResponse } from "next/server";
import {
  isValidMarketplaceSource,
  spawnSkillsProcess,
  validateMarketplaceMutationRequest,
} from "@/lib/skills-marketplace-command";
import { SingleOwnerStreamWriter } from "@/lib/single-owner-stream-writer";

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
      source?: unknown;
      global?: unknown;
    } | null;
    const source = body?.source;
    const isGlobal = body?.global;

    if (!isValidMarketplaceSource(source)) {
      return NextResponse.json(
        { error: "source must be a valid GitHub marketplace repository" },
        { status: 400 }
      );
    }
    if (isGlobal !== undefined && typeof isGlobal !== "boolean") {
      return NextResponse.json(
        { error: "global must be a boolean" },
        { status: 400 },
      );
    }

    const args = ["skills", "add", source, "-y", "--agent", "claude-code"];
    if (isGlobal !== false) {
      args.splice(3, 0, "-g");
    }

    const child = spawnSkillsProcess(args);

    const encoder = new TextEncoder();
    const writer = new SingleOwnerStreamWriter<Uint8Array>();
    const stream = new ReadableStream({
      start(controller) {
        writer.attach(controller);
        const send = (event: string, data: string) => {
          writer.enqueue(
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
            send("done", "Install completed successfully");
          } else {
            send("error", `Process exited with code ${code}`);
          }
          writer.close();
        });

        child.on("error", (err) => {
          send("error", err.message);
          writer.close();
        });
      },
      cancel() {
        writer.cancel();
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
    console.error("[marketplace/install] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Install failed" },
      { status: 500 }
    );
  }
}
