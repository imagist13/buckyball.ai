/**
 * Phase 5b smoke round 9 (2026-05-16) — Codex media import bridge.
 *
 * Codex's `imageGeneration.savedPath` and `imageView.path` are
 * arbitrary filesystem paths (e.g. `/tmp/codex-out.png`,
 * `~/.codex/...`, project-relative paths). The chat-side
 * `MediaPreview` component requests these through
 * `/api/media/serve?path=...`, which deliberately allows ONLY paths
 * inside `~/.codepilot/.codepilot-media/` (directory-traversal
 * protection — see `src/app/api/media/serve/route.ts`). So a
 * MediaBlock with a `localPath` outside that directory gets a 403
 * from the serve route, and the image never renders.
 *
 * This module imports each foreign-path MediaBlock into the local
 * media library via `importFileToLibrary` (copy + DB row), then
 * rewrites the block's `localPath` to the imported path and stamps
 * in the new `mediaId`. The result is safe for the serve route.
 *
 * Failures (source file missing, copy fails, DB write fails) are
 * caught per-block: the offending block is dropped from the output
 * with a `console.warn`, and the rest of the event flows through
 * unchanged. Pre-fix this layer didn't exist, so the silent failure
 * mode was "tool completed, image card rendered as broken
 * <img src=403>".
 *
 * Pure-base64 MediaBlocks (no `localPath`, only `data`) are passed
 * through untouched — `MediaPreview` renders those via `data:` URL
 * and never hits the serve route.
 *
 * Already-imported blocks (those whose `localPath` is already inside
 * `MEDIA_DIR`) are also passed through. This avoids re-importing on
 * a noop re-emit.
 */

import path from 'path';
import {
  findReusableImportedFile,
  importFileToLibrary,
  stageFileForMediaPreview,
} from '@/lib/media-saver';
import { resolveCodePilotDataDir } from '@/lib/codepilot-data-dir';
import type { MediaBlock } from '@/types';
import type { RuntimeRunEvent } from '@/lib/runtime/contract';

interface MaterializeOptions {
  sessionId: string;
  /** Working directory for resolving relative paths Codex hands us.
   *  Codex's savedPath is usually absolute, but imageView.path can be
   *  a workspace-relative path. */
  cwd?: string;
}

function getMediaDir(): string {
  return path.resolve(resolveCodePilotDataDir(), '.codepilot-media');
}

function isInsideMediaDir(filePath: string): boolean {
  const mediaDir = getMediaDir();
  const resolved = path.resolve(filePath);
  return resolved === mediaDir || resolved.startsWith(mediaDir + path.sep);
}

/**
 * Walk `event.media[]` and import any block whose `localPath` points
 * outside the media library. Returns a NEW event with rewritten media
 * — never mutates the input. If a block fails to import the function
 * drops just that block; if every block fails the event is returned
 * with `media: undefined` so the chat side falls back to the
 * structured output card.
 */
export function materializeCodexEventMedia(
  event: RuntimeRunEvent,
  opts: MaterializeOptions,
): RuntimeRunEvent {
  if (event.type !== 'tool_completed') return event;
  const media = event.media;
  if (!media || media.length === 0) return event;

  const imported: MediaBlock[] = [];
  for (const block of media) {
    // Pure-base64 blocks: pass through. `MediaPreview` renders these
    // via `data:` URL without touching /api/media/serve.
    if (!block.localPath) {
      imported.push(block);
      continue;
    }
    const outputType = (
      event.output
      && typeof event.output === 'object'
      && 'type' in event.output
      && typeof event.output.type === 'string'
    )
      ? event.output.type
      : '';
    const persistence = block.sourceMetadata?.persistence
      ?? (outputType === 'imageView' ? 'preview_only' : 'durable_asset');
    // Foreign path → import into the library. Pull `prompt` + `model` from
    // the block's sourceMetadata so a Codex-generated image lands in the
    // gallery with its real revised prompt + a recognizable model tag
    // ('codex-image'), not the meaningless temp filename.
    try {
      const reusable = findReusableImportedFile(block.localPath, {
        sessionId: opts.sessionId,
        source: 'codex',
        cwd: opts.cwd,
      });
      if (reusable) {
        imported.push({
          ...block,
          localPath: reusable.localPath,
          mediaId: reusable.mediaId,
        });
        continue;
      }
      if (persistence === 'preview_only') {
        const preview = stageFileForMediaPreview(block.localPath, {
          mimeType: block.mimeType,
          cwd: opts.cwd,
        });
        imported.push({
          ...block,
          localPath: preview.localPath,
        });
        continue;
      }
      // Already-imported durable blocks with a media id need no work. A path
      // inside the media dir but without an id may be a preview cache entry,
      // so it still goes through the durable import boundary.
      if (isInsideMediaDir(block.localPath) && block.mediaId) {
        imported.push(block);
        continue;
      }
      const result = importFileToLibrary(block.localPath, {
        sessionId: opts.sessionId,
        source: 'codex',
        producerId: 'codex-media-import',
        runtimeId: 'codex_runtime',
        mimeType: block.mimeType,
        cwd: opts.cwd,
        prompt: block.sourceMetadata?.prompt,
        model: block.sourceMetadata?.model,
        parentAssetIds: block.sourceMetadata?.parentAssetIds,
      });
      imported.push({
        ...block,
        localPath: result.localPath,
        mediaId: result.mediaId,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(
        `[codex.media-import] failed to import "${block.localPath}" into the media library; ` +
          `dropping this MediaBlock from the tool result so MediaPreview doesn't hit 403. Reason: ${reason}`,
      );
      // Drop this block; keep going.
    }
  }

  if (imported.length === 0) {
    // Every block failed → emit the event without media so the chat
    // side renders the structured output card instead of an empty
    // grid of broken images.
    const { media: _dropped, ...rest } = event;
    void _dropped;
    return rest as RuntimeRunEvent;
  }

  return { ...event, media: imported };
}
