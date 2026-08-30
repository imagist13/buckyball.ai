/**
 * Codex namespace-tool compatibility for third-party Provider proxies.
 *
 * OpenAI Responses models understand `{ type: "namespace", tools: [...] }`
 * natively. Other provider protocols generally do not, so expose each nested
 * member as an ordinary definition-only function. Response translators then
 * restore the original `(namespace, name)` pair for Codex's tool router.
 */

import { jsonSchema, tool, type ToolSet } from 'ai';
import type { JSONSchema7 } from '@ai-sdk/provider';
import type { ClassifiedNonFunctionTool } from './types';

export interface CodexNamespaceToolRoute {
  namespace: string;
  name: string;
}

export interface CodexNamespaceTools {
  tools: ToolSet;
  routes: ReadonlyMap<string, CodexNamespaceToolRoute>;
}

/**
 * Codex's native collaboration namespace cannot honour CodePilot's exact
 * cross-Provider routes. Exposing it beside `codepilot_spawn_subagent` lets
 * the parent model launch an inherited-model worker as well as the requested
 * managed child, producing duplicate runs and misleading "Codex worker"
 * capsules. Codex Account bypasses this proxy and keeps its native collab
 * surface; proxied parent/child threads use the managed bridge exclusively.
 */
export const CODEX_NATIVE_COLLAB_NAMESPACE = 'multi_agent_v1';

export function flattenCodexNamespaceToolName(namespace: string, name: string): string {
  return namespace.endsWith('__') ? `${namespace}${name}` : `${namespace}__${name}`;
}

export function translateCodexNamespaceTools(
  passthrough: readonly ClassifiedNonFunctionTool[] | undefined,
): CodexNamespaceTools {
  const tools: ToolSet = {};
  const routes = new Map<string, CodexNamespaceToolRoute>();
  for (const descriptor of passthrough ?? []) {
    if (descriptor.rawType !== 'namespace') continue;
    const namespace = descriptor.name;
    const nested = descriptor.payload.tools;
    if (!namespace || !Array.isArray(nested)) continue;
    if (namespace === CODEX_NATIVE_COLLAB_NAMESPACE) continue;
    for (const raw of nested) {
      if (!raw || typeof raw !== 'object') continue;
      const member = raw as Record<string, unknown>;
      if (member.type !== 'function' || typeof member.name !== 'string') continue;
      const alias = flattenCodexNamespaceToolName(namespace, member.name);
      if (routes.has(alias)) continue;
      const parameters = member.parameters && typeof member.parameters === 'object'
        ? member.parameters as JSONSchema7
        : { type: 'object', properties: {}, additionalProperties: false } as JSONSchema7;
      tools[alias] = tool({
        description: typeof member.description === 'string' ? member.description : '',
        inputSchema: jsonSchema(parameters),
        ...(typeof member.strict === 'boolean' ? { strict: member.strict } : {}),
      });
      routes.set(alias, { namespace, name: member.name });
    }
  }
  return { tools, routes };
}
