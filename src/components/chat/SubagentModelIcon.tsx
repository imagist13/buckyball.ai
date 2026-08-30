'use client';

import Anthropic from '@lobehub/icons/es/Anthropic/components/Mono';
import DeepSeek from '@lobehub/icons/es/DeepSeek/components/Mono';
import Doubao from '@lobehub/icons/es/Doubao/components/Mono';
import Kimi from '@lobehub/icons/es/Kimi/components/Mono';
import Minimax from '@lobehub/icons/es/Minimax/components/Mono';
import OpenAI from '@lobehub/icons/es/OpenAI/components/Mono';
import Qwen from '@lobehub/icons/es/Qwen/components/Mono';
import XAI from '@lobehub/icons/es/XAI/components/Mono';
import XiaomiMiMo from '@lobehub/icons/es/XiaomiMiMo/components/Mono';
import Zhipu from '@lobehub/icons/es/Zhipu/components/Mono';
import { CodePilotIcon } from '@/components/ui/semantic-icon';
import { subagentModelBrand } from '@/lib/subagent-model-brand';

export function SubagentModelIcon({ model, size = 20 }: { model?: string; size?: number }) {
  const brand = subagentModelBrand(model);
  if (brand === 'xai') return <XAI size={size} aria-hidden />;
  if (brand === 'deepseek') return <DeepSeek size={size} aria-hidden />;
  if (brand === 'kimi') return <Kimi size={size} aria-hidden />;
  if (brand === 'zhipu') return <Zhipu size={size} aria-hidden />;
  if (brand === 'qwen') return <Qwen size={size} aria-hidden />;
  if (brand === 'minimax') return <Minimax size={size} aria-hidden />;
  if (brand === 'mimo') return <XiaomiMiMo size={size} aria-hidden />;
  if (brand === 'doubao') return <Doubao size={size} aria-hidden />;
  if (brand === 'anthropic') return <Anthropic size={size} aria-hidden />;
  if (brand === 'openai') return <OpenAI size={size} aria-hidden />;
  return <CodePilotIcon name="model" size={size <= 16 ? 'sm' : 'lg'} aria-hidden />;
}
