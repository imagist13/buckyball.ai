/**
 * xai-video-mcp.ts — Grok Imagine Video MCP server (split from image-gen-mcp.ts).
 *
 * After image-generation cleanup (2026-09-04): only the video tool remains.
 * The image tool (`codepilot_generate_image`) was removed because buckyball.ai
 * does not own image-generation capability. Video generation is supported via
 * the user's connected Grok Build OAuth account.
 *
 * Tool calls `generateGrokVideo` (from `@/lib/xai-imagine`) which saves the
 * video to disk and DB. The local path is returned as text so the
 * `MEDIA_RESULT_MARKER` can be parsed by the chat layer to construct
 * MediaBlock[] for the SSE event.
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { isXaiOAuthUsable } from '@/lib/xai-oauth-manager';

/**
 * Marker prefix in tool result text that claude-client.ts detects to construct
 * MediaBlock[] for the SSE event. Format: __MEDIA_RESULT__<JSON array of {type, mimeType, localPath}>
 */
export const MEDIA_RESULT_MARKER = '__MEDIA_RESULT__';

/** Narrow the Claude Agent SDK MCP handler context without trusting its unknown shape. */
export function extractMcpAbortSignal(extra: unknown): AbortSignal | undefined {
  if (!extra || typeof extra !== 'object') return undefined;
  const signal = (extra as { signal?: unknown }).signal;
  if (
    !signal
    || typeof signal !== 'object'
    || typeof (signal as { aborted?: unknown }).aborted !== 'boolean'
    || typeof (signal as { addEventListener?: unknown }).addEventListener !== 'function'
  ) {
    return undefined;
  }
  return signal as AbortSignal;
}

export function createVideoGenMcpServer(sessionId?: string, workingDirectory?: string) {
  if (!isXaiOAuthUsable()) {
    // Video gen requires a connected Grok Build OAuth account. Returning an
    // empty server is intentional — the harness must never expose a tool
    // that the current account cannot perform, since advertised tools
    // become a contract the user can act on.
    return createSdkMcpServer({
      name: 'codepilot-video-gen',
      version: '1.0.0',
      tools: [],
    });
  }
  return createSdkMcpServer({
    name: 'codepilot-video-gen',
    version: '1.0.0',
    tools: [
      tool(
        'codepilot_generate_video',
        'Generate a video with Grok Imagine Video 1.5 through the connected Grok Build OAuth account. Supports text-to-video, a source image as first frame, or multiple reference images. The video appears inline and is saved to Gallery.',
        {
          prompt: z.string().describe('Detailed video generation prompt'),
          imagePath: z.string().optional().describe('Optional source image to animate as the first frame'),
          referenceImagePaths: z.array(z.string()).max(7).optional().describe('Optional style/content reference images'),
          duration: z.union([z.literal(6), z.literal(10)]).optional(),
          aspectRatio: z.enum(['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3']).optional(),
          resolution: z.enum(['480p', '720p']).optional(),
        },
        async ({ prompt, imagePath, referenceImagePaths, duration, aspectRatio, resolution }, extra) => {
          try {
            const { generateGrokVideo } = await import('@/lib/xai-imagine');
            const result = await generateGrokVideo({
              prompt,
              imagePath,
              referenceImagePaths,
              duration,
              aspectRatio,
              resolution,
              sessionId,
              runtimeId: 'claude_code',
              cwd: workingDirectory,
              abortSignal: extractMcpAbortSignal(extra),
            });
            const mediaInfo = [{
              type: 'video' as const,
              mimeType: result.mimeType,
              localPath: result.localPath,
              mediaId: result.mediaGenerationId,
            }];
            return {
              content: [{
                type: 'text' as const,
                text: [
                  `Video generated successfully (${result.elapsedMs}ms).`,
                  `Local path: ${result.localPath}`,
                  `${MEDIA_RESULT_MARKER}${JSON.stringify(mediaInfo)}`,
                ].join('\n'),
              }],
            };
          } catch (error) {
            return {
              content: [{
                type: 'text' as const,
                text: JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Video generation failed' }),
              }],
              isError: true,
            };
          }
        },
      ),
    ],
  });
}
