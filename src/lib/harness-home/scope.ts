import type {
  BaseHarnessScope,
  HarnessScope,
  RuntimeIdRef,
} from './contracts';
import { validateHarnessScope } from './validation';

export interface HarnessScopeContext {
  readonly userId?: string;
  readonly assistantId?: string;
  readonly projectId?: string;
  readonly runtimeId?: RuntimeIdRef;
}

export interface ScopedValue<T> {
  readonly scope: HarnessScope;
  readonly value: T;
}

const BASE_SCOPE_RANK: Record<BaseHarnessScope['kind'], number> = {
  builtin: 0,
  user: 10,
  assistant: 20,
  project: 30,
};

function baseScope(scope: HarnessScope): BaseHarnessScope {
  validateHarnessScope(scope);
  return scope.kind === 'runtime_overlay' ? scope.base : scope;
}

export function harnessScopeRank(scope: HarnessScope): number {
  const baseRank = BASE_SCOPE_RANK[baseScope(scope).kind];
  return scope.kind === 'runtime_overlay' ? baseRank + 100 : baseRank;
}

export function compareHarnessScopes(a: HarnessScope, b: HarnessScope): number {
  return harnessScopeRank(a) - harnessScopeRank(b);
}

function baseScopeMatches(
  scope: BaseHarnessScope,
  context: HarnessScopeContext,
): boolean {
  switch (scope.kind) {
    case 'builtin':
      return true;
    case 'user':
      return !scope.userId || scope.userId === context.userId;
    case 'assistant':
      return scope.assistantId === context.assistantId;
    case 'project':
      return scope.projectId === context.projectId;
  }
}

export function harnessScopeApplies(
  scope: HarnessScope,
  context: HarnessScopeContext,
): boolean {
  validateHarnessScope(scope);
  if (scope.kind === 'runtime_overlay') {
    return scope.runtimeId === context.runtimeId
      && baseScopeMatches(scope.base, context);
  }
  return baseScopeMatches(scope, context);
}

/**
 * Returns applicable values from least to most specific. Consumers may
 * reduce the array in order; a Runtime overlay is applied last but never
 * becomes the canonical base value.
 */
export function resolveScopedValues<T>(
  candidates: readonly ScopedValue<T>[],
  context: HarnessScopeContext,
): readonly ScopedValue<T>[] {
  return candidates
    .filter((candidate) => harnessScopeApplies(candidate.scope, context))
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => {
      const rank = compareHarnessScopes(a.candidate.scope, b.candidate.scope);
      return rank === 0 ? a.index - b.index : rank;
    })
    .map(({ candidate }) => candidate);
}

export function highestPrecedenceValue<T>(
  candidates: readonly ScopedValue<T>[],
  context: HarnessScopeContext,
): ScopedValue<T> | undefined {
  const resolved = resolveScopedValues(candidates, context);
  return resolved.at(-1);
}
