/**
 * Agent SDK Agents Registry — manages built-in agent definitions that can be
 * injected into SDK query options.
 *
 * Claude Code has two different model-selection surfaces:
 * - AgentInput.model is a provider-relative role alias (sonnet/opus/haiku).
 * - AgentDefinition.model accepts a full model ID.
 *
 * CodePilot no longer turns the second surface into product-visible model
 * profiles: AgentDefinition cannot change the parent Provider endpoint. Exact
 * Provider + Model delegation lives in claude-subagent-mcp.ts instead. This
 * registry remains for explicit SDK Agent definitions and built-in Agent/Task
 * masquerade validation.
 */

import type { AgentDefinition } from '@anthropic-ai/claude-agent-sdk';
import type { CatalogModel, RoleModels } from './provider-catalog';

const GLOBAL_KEY = '__agentSdkAgents__' as const;

/** Per-invocation role aliases accepted by the installed Agent SDK schema. */
export const CLAUDE_SUBAGENT_MODEL_OVERRIDES = ['sonnet', 'opus', 'haiku'] as const;

const MODEL_BRAND_NAME = 'Grok|xAI|Kimi|Moonshot|GLM|Zhipu|DeepSeek|Qwen|MiniMax|MiMo|GPT|Codex';
const MODEL_ROLE_PATTERNS = [
  new RegExp(`(?:你是|你将作为|扮演)\\s*(?:一个|一名)?\\s*(${MODEL_BRAND_NAME})(?:\\s*(?:模型|专家|Agent|智能体))?`, 'i'),
  new RegExp(`(?:启动|调用|创建)\\s*(?:一个|一名)?[^。\\n]{0,30}?(${MODEL_BRAND_NAME})[^。\\n]{0,20}?(?:模型|Agent|智能体|子\\s*Agent)`, 'i'),
  new RegExp(`(?:you are|act as)\\s+(?:an?\\s+)?(${MODEL_BRAND_NAME})(?:[^.\\n]{0,20}?(?:model|expert|agent))?`, 'i'),
  new RegExp(`(?:launch|spawn|run)\\s+(?:an?\\s+)?[^.\\n]{0,30}?(${MODEL_BRAND_NAME})[^.\\n]{0,20}?(?:model|agent|sub-agent)`, 'i'),
];

export interface ClaudeSubagentRoutingContext {
  /** Human-readable provider name; used only for truthful model guidance. */
  providerName?: string;
  /** Parent model selected for this session/turn. */
  parentModel?: string;
  /** Models enabled for the current provider and compatible with Claude Code. */
  availableModels: readonly Pick<CatalogModel, 'modelId' | 'upstreamModelId' | 'displayName'>[];
  /** Provider-relative role aliases injected as ANTHROPIC_DEFAULT_*_MODEL. */
  roleModels?: RoleModels;
  /** False when the selected provider itself is not reachable by Claude Code. */
  providerCompatible: boolean;
}

export type ClaudeSubagentModelValidation =
  | { ok: true }
  | { ok: false; code: 'SUBAGENT_MODEL_UNAVAILABLE'; requestedModel: string; message: string };

/**
 * Shipping-boundary validation for Agent/Task calls. It validates against the
 * current provider catalog and role mapping, not a global brand whitelist.
 */
export function validateClaudeSubagentToolInput(
  toolName: string,
  input: Record<string, unknown>,
  agents: Record<string, AgentDefinition> = getRegisteredAgents(),
  context?: ClaudeSubagentRoutingContext,
): ClaudeSubagentModelValidation {
  if (!/^(agent|task)$/i.test(toolName)) return { ok: true };

  const directModel = typeof input.model === 'string' ? input.model.trim() : '';
  const agentType = typeof input.subagent_type === 'string' ? input.subagent_type.trim() : '';
  const definitionModel = agentType && agents[agentType]?.model
    ? String(agents[agentType].model).trim()
    : '';
  const promptModel = detectModelRoleClaim(input);

  if (context && !context.providerCompatible) {
    return unavailableClaudeSubagentModel(promptModel || directModel || definitionModel || context.providerName || 'current provider');
  }

  // The direct tool field is intentionally narrower than AgentDefinition.model.
  // Reject invented full IDs here even if a similarly named model exists; exact
  // Provider + Model routes must travel through CodePilot's managed sub-agent
  // MCP tool, which owns the separate child subprocess.
  if (directModel && !(CLAUDE_SUBAGENT_MODEL_OVERRIDES as readonly string[]).includes(directModel)) {
    return unavailableClaudeSubagentModel(directModel);
  }

  if (directModel && context && !resolveRoleModel(directModel, context)) {
    return unavailableClaudeSubagentModel(directModel);
  }

  const requestedModel = directModel || definitionModel;
  if (
    definitionModel
    && definitionModel !== 'inherit'
    && !(CLAUDE_SUBAGENT_MODEL_OVERRIDES as readonly string[]).includes(definitionModel)
    && context
    && !findAvailableModel(definitionModel, context)
  ) {
    return unavailableClaudeSubagentModel(definitionModel);
  }

  if (promptModel) {
    const effective = resolveEffectiveModelDescriptor(requestedModel, context);
    if (!effective || !modelBrandMatches(promptModel, effective)) {
      return unavailableClaudeSubagentModel(promptModel);
    }
  }

  // Without a capability snapshot, keep the SDK-schema-safe fallback. Runtime
  // calls always provide a snapshot; this branch serves registry/unit callers.
  if (!context && definitionModel && definitionModel !== 'inherit') {
    const isAlias = (CLAUDE_SUBAGENT_MODEL_OVERRIDES as readonly string[]).includes(definitionModel);
    const isClaudeId = /claude|anthropic/i.test(definitionModel);
    if (!isAlias && !isClaudeId) return unavailableClaudeSubagentModel(definitionModel);
  }

  return { ok: true };
}

function unavailableClaudeSubagentModel(requestedModel: string): ClaudeSubagentModelValidation {
  return {
    ok: false,
    code: 'SUBAGENT_MODEL_UNAVAILABLE',
    requestedModel,
    message:
      `SUBAGENT_MODEL_UNAVAILABLE: the current Claude Code Runtime/Provider cannot route sub-agent model "${requestedModel}". `
      + 'Do not continue as if the sub-agent ran. Tell the user it is unavailable on the current route and ask whether to choose an available child model or switch Runtime/Provider.',
  };
}

function detectModelRoleClaim(input: Record<string, unknown>): string {
  const text = [input.prompt, input.task, input.description]
    .filter((value): value is string => typeof value === 'string')
    .join('\n');
  for (const pattern of MODEL_ROLE_PATTERNS) {
    const match = pattern.exec(text);
    if (match?.[1]) return match[1];
  }
  return '';
}

function resolveEffectiveModelDescriptor(
  requestedModel: string,
  context?: ClaudeSubagentRoutingContext,
): string {
  if (!context) return requestedModel;
  const selected = !requestedModel || requestedModel === 'inherit'
    ? context.parentModel || ''
    : requestedModel;
  const roleResolved = resolveRoleModel(selected, context);
  const entry = findAvailableModel(roleResolved || selected, context)
    || findAvailableModel(selected, context);
  return [
    selected,
    roleResolved,
    entry?.modelId,
    entry?.upstreamModelId,
    entry?.displayName,
    context.availableModels.length === 1 ? context.providerName : undefined,
  ].filter(Boolean).join(' ');
}

function resolveRoleModel(alias: string, context: ClaudeSubagentRoutingContext): string | undefined {
  if (!(CLAUDE_SUBAGENT_MODEL_OVERRIDES as readonly string[]).includes(alias)) return alias || undefined;
  const mapped = context.roleModels?.[alias as 'sonnet' | 'opus' | 'haiku'];
  if (mapped) return mapped;
  const entry = context.availableModels.find(model => model.modelId === alias);
  return entry?.upstreamModelId || entry?.modelId;
}

function findAvailableModel(
  reference: string,
  context: ClaudeSubagentRoutingContext,
): ClaudeSubagentRoutingContext['availableModels'][number] | undefined {
  return context.availableModels.find(model =>
    model.modelId === reference || model.upstreamModelId === reference,
  );
}

function modelBrandMatches(claim: string, descriptor: string): boolean {
  const claimTokens = brandFamilyTokens(claim);
  const descriptorKey = normalizeBrand(descriptor);
  return claimTokens.some(token => descriptorKey.includes(token));
}

function brandFamilyTokens(value: string): string[] {
  const key = normalizeBrand(value);
  if (key === 'glm' || key === 'zhipu') return ['glm', 'zhipu'];
  if (key === 'kimi' || key === 'moonshot') return ['kimi', 'moonshot'];
  if (key === 'grok' || key === 'xai') return ['grok', 'xai'];
  return [key];
}

function normalizeBrand(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function getRegistry(): Map<string, AgentDefinition> {
  if (!(globalThis as Record<string, unknown>)[GLOBAL_KEY]) {
    (globalThis as Record<string, unknown>)[GLOBAL_KEY] = new Map<string, AgentDefinition>();
  }
  return (globalThis as Record<string, unknown>)[GLOBAL_KEY] as Map<string, AgentDefinition>;
}

export function registerAgent(name: string, definition: AgentDefinition): void {
  getRegistry().set(name, definition);
}

export function unregisterAgent(name: string): void {
  getRegistry().delete(name);
}

/** Get only explicitly registered SDK Agent definitions. */
export function getRegisteredAgents(_context?: ClaudeSubagentRoutingContext): Record<string, AgentDefinition> {
  const result: Record<string, AgentDefinition> = {};
  for (const [name, def] of getRegistry()) result[name] = def;
  return result;
}

export function getAgent(name: string): AgentDefinition | undefined {
  return getRegistry().get(name);
}

export function hasRegisteredAgents(): boolean {
  return getRegistry().size > 0;
}
