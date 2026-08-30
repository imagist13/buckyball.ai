/**
 * codepilot-image-gen MCP — in-process MCP server for image/video generation.
 *
 * The MCP tool calls generateSingleImage() which saves images to disk and DB.
 * It returns a text result with localPaths — the frontend renders them via
 * the tool_result media field that claude-client.ts injects from the paths.
 *
 * Keyword-gated: co-registered with codepilot-media when the conversation
 * involves media/image/video generation tasks.
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { generateSingleImage, NoImageGeneratedError } from '@/lib/image-generator';
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

export function createImageGenMcpServer(sessionId?: string, workingDirectory?: string) {
  return createSdkMcpServer({
    name: 'codepilot-image-gen',
    version: '1.0.0',
    tools: [
      tool(
        'codepilot_generate_image',
        'Generate or edit an image using the active media provider. Set provider to grok-build when the user explicitly requests Grok Imagine Image 2.0. The generated image appears inline and is saved to the media library.',
        {
          prompt: z.string().describe('Detailed image generation prompt in English'),
          provider: z.enum(['active', 'grok-build']).optional().describe('Use grok-build only for an explicit Grok Imagine request'),
          aspectRatio: z.enum(['1:1', '16:9', '9:16', '4:3', '3:4']).optional().describe('Aspect ratio, defaults to 1:1'),
          imageSize: z.enum(['1K', '2K']).optional().describe('Output resolution, defaults to 1K'),
          referenceImagePaths: z.array(z.string()).optional().describe('Paths to reference images for style/content guidance'),
        },
        async ({ prompt, provider, aspectRatio, imageSize, referenceImagePaths }, extra) => {
          try {
            // generateSingleImage saves to disk + DB internally.
            // We return the localPaths as text so Claude can reference them
            // for continuous editing, and claude-client.ts detects the
            // MEDIA_RESULT_MARKER to inject media blocks into the SSE event.
            const result = await generateSingleImage({
              prompt,
              providerId: provider === 'grok-build' ? 'xai-oauth' : undefined,
              aspectRatio,
              imageSize,
              referenceImagePaths,
              sessionId,
              cwd: workingDirectory,
              abortSignal: extractMcpAbortSignal(extra),
            });

            const mediaInfo = result.images.map(img => ({
              type: 'image' as const,
              mimeType: img.mimeType,
              localPath: img.localPath,
              mediaId: result.mediaGenerationId,
            }));

            const textResult = [
              `Image generated successfully (${result.elapsedMs}ms).`,
              `Local paths: ${result.images.map(img => img.localPath).join(', ')}`,
              `${MEDIA_RESULT_MARKER}${JSON.stringify(mediaInfo)}`,
            ].join('\n');

            return {
              content: [{ type: 'text' as const, text: textResult }],
            };
          } catch (error) {
            const message = NoImageGeneratedError.isInstance(error)
              ? 'Image generation succeeded but no image was returned by the model. Try a different prompt.'
              : error instanceof Error ? error.message : 'Image generation failed';
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ success: false, error: message }) }],
              isError: true,
            };
          }
        },
      ),
      ...(isXaiOAuthUsable() ? [tool(
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
      )] : []),
    ],
  });
}
