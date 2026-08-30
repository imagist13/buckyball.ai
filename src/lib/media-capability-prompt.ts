/**
 * Canonical media capability prompt shared by every Runtime.
 *
 * Keep this module dependency-free. Native Runtime loads its built-in media
 * tools synchronously while Next/Turbopack may turn modules that import the
 * Claude Agent SDK into async chunks. Putting the prompt beside the MCP
 * implementation made that SDK dependency leak into `builtin-tools/media.ts`
 * and caused the entire media tool group to be silently omitted at runtime.
 */
export const MEDIA_CAPABILITY_SYSTEM_PROMPT = `<media-capability>
You have access to media tools:
- codepilot_generate_image: Generate or edit images through the active media provider. Set provider=grok-build only when the user explicitly requests Grok Imagine Image 2.0. Images appear inline and are auto-saved.
- codepilot_generate_video: When a Grok Build OAuth account is connected, generate text-to-video, image-to-video, or reference-to-video with Grok Imagine Video 1.5. This tool is unavailable when that authorization is not connected. Videos appear inline and are auto-saved.
- codepilot_import_media: Import an existing local file (image/video/audio) into the media library and display it inline in the chat.

IMPORTANT RULES:
1. After ANY CLI tool (dreamina, comfyui, stable-diffusion, midjourney, etc.) generates a media file, you MUST call codepilot_import_media to display it in the chat. Do NOT use the Read tool — Read only shows images to you (the AI) but does NOT display them to the user.
2. Do NOT use curl or HTTP requests to interact with the media API.
3. When calling codepilot_import_media, ALWAYS extract and fill in ALL available metadata from the CLI tool's output:
   - prompt: the generation prompt that was used
   - model: the model name (e.g. "seedance-2.0", "flux-1", "sdxl")
   - resolution: the output resolution (e.g. "2K", "4096x4096", "1920x1080")
   - aspectRatio: the aspect ratio (e.g. "1:1", "16:9")
   - source: the tool name (e.g. "dreamina", "comfyui")
   These fields are critical for the media library — do not leave them empty if the information is available in the CLI output or from the generation parameters.
</media-capability>`;

const MEDIA_INTENT_PATTERN = new RegExp([
  '生成.{0,12}(?:图片|图像|插图|海报|照片|视频|动画)',
  '(?:画|绘制|创作|做).{0,12}(?:图|图片|图像|插图|海报)',
  '(?:图片|图像|视频|素材).{0,12}(?:生成|编辑|制作|导入|保存)',
  '(?:generate|create|make|draw|render|design|illustrate|edit).{0,40}(?:image|picture|photo|illustration|poster|artwork|video|animation)',
  '(?:image|picture|photo|illustration|poster|artwork|video|animation).{0,40}(?:generate|create|make|draw|render|design|edit|animate)',
  '(?:text|image|reference)[_ -]to[_ -](?:image|video)',
  '(?:import|save).{0,30}(?:media|image|video|audio|library)',
  'codepilot_(?:import_media|generate_image|generate_video)',
].join('|'), 'i');

/** Shared Claude SDK media-MCP gate. Keep English and Chinese intent in one place. */
export function promptNeedsMedia(
  prompt: string,
  conversationHistory?: readonly { content: string }[],
): boolean {
  if (MEDIA_INTENT_PATTERN.test(prompt)) return true;
  return conversationHistory?.some(message => MEDIA_INTENT_PATTERN.test(message.content)) ?? false;
}
