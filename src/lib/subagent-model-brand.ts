export type SubagentModelBrand =
  | 'anthropic'
  | 'deepseek'
  | 'doubao'
  | 'kimi'
  | 'minimax'
  | 'mimo'
  | 'openai'
  | 'qwen'
  | 'xai'
  | 'zhipu'
  | 'generic';

export function subagentModelBrand(model: string | undefined): SubagentModelBrand {
  if (!model) return 'generic';
  const value = model.toLowerCase();
  if (/grok|(?:^|[\s/_.-])xai(?:$|[\s/_.-])/.test(value)) return 'xai';
  if (/deepseek/.test(value)) return 'deepseek';
  if (/kimi|moonshot/.test(value)) return 'kimi';
  if (/glm|zhipu|bigmodel/.test(value)) return 'zhipu';
  if (/qwen|tongyi|bailian/.test(value)) return 'qwen';
  if (/minimax/.test(value)) return 'minimax';
  if (/mimo|xiaomi/.test(value)) return 'mimo';
  if (/doubao|volcengine|ark-code/.test(value)) return 'doubao';
  if (/claude|anthropic|sonnet|opus|haiku/.test(value)) return 'anthropic';
  if (/gpt|openai|codex|(?:^|[\s/_.-])o[134](?:$|[\s/_.-])/.test(value)) return 'openai';
  return 'generic';
}
