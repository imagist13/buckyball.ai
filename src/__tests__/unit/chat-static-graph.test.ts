/**
 * Chat first-paint static-graph contract — dev-server memory guardrail.
 *
 * Background (2026-05-09): comparing v0.54.0 (refactor-pre baseline) to
 * the current worktree, every other surface got LIGHTER (root layout
 * 1251→810 KB, AppShell 1066→566 KB), but `/chat` and `/chat/[id]` each
 * gained ~310 KB / 13 modules. The new weight wasn't ChatListPanel — it
 * was `RunCockpit` directly importing `useOverviewData` (the Settings
 * Overview data layer), which transitively pulled `runtime/effective`,
 * the provider-catalog code path, and `useClaudeStatus` into the chat
 * first-paint compile graph.
 *
 * The fix is a render-time split: `RunCockpit.tsx` is now the trigger-
 * only shell. The popover body (which is what actually needs overview
 * data) lives in `RunCockpitPopoverContent.tsx` and is loaded via
 * `next/dynamic({ ssr: false })`. Radix's `<PopoverContent>` only
 * mounts its children when the popover opens, so the chunk only
 * resolves on first user click.
 *
 * This test fails if a regression sneaks `useOverviewData` /
 * `provider-catalog` / `runtime/effective` back into the static
 * graph reachable from the chat entries (page.tsx + ChatView.tsx +
 * RunCockpit.tsx). Comments / JSDoc that mention the modules to
 * explain *why* the split exists are tolerated.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '../..');

function stripComments(src: string): string {
  // Strip line comments first (a `//` line containing `/*` text would
  // otherwise inject a fake block-comment start; see sentry-dev-guard).
  return src
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Resolve a TS module path (`./Foo`, `@/lib/bar`) to its file path. */
function resolveModulePath(fromFile: string, spec: string): string | null {
  let basePath: string;
  if (spec.startsWith('@/')) {
    basePath = path.join(SRC, spec.slice(2));
  } else if (spec.startsWith('./') || spec.startsWith('../')) {
    basePath = path.resolve(path.dirname(fromFile), spec);
  } else {
    return null; // bare package — outside the repo, not what we trace
  }
  for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
    const candidate = basePath + ext;
    if (existsSync(candidate)) return candidate;
  }
  // Already has an extension?
  if (existsSync(basePath)) return basePath;
  return null;
}

/**
 * Walk the static import graph starting from `entry`, depth-first, and
 * return the set of repo files transitively reachable. Stops at bare
 * package specifiers (`react`, `next/dynamic`, etc.) and at
 * `dynamic(() => import(...))` expressions — those are the boundaries
 * we want to enforce, since they DON'T contribute to first-paint
 * compile cost in the same way a static import does.
 */
function staticImportGraph(entry: string): Set<string> {
  const visited = new Set<string>();
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);
    if (!existsSync(file)) continue;
    const raw = readFileSync(file, 'utf-8');
    const stripped = stripComments(raw);
    // Top-level static imports only: `^[ \t]*import\b[^;]*;`. This
    // excludes `dynamic(() => import('...'))` because those expressions
    // never start a line with the bare `import` keyword.
    const stmtRe = /^[ \t]*import\b[^;]*;/gm;
    let m: RegExpExecArray | null;
    while ((m = stmtRe.exec(stripped)) !== null) {
      const stmt = m[0];
      const pathMatch = stmt.match(/from\s+["']([^"']+)["']/);
      const sideEffect = stmt.match(/^\s*import\s+["']([^"']+)["']/);
      const spec = pathMatch?.[1] ?? sideEffect?.[1];
      if (!spec) continue;
      const resolved = resolveModulePath(file, spec);
      if (resolved && !visited.has(resolved)) stack.push(resolved);
    }
  }
  return visited;
}

// Modules that should NOT reach chat first-paint entries via static
// imports. Each entry is paired with the entries it's forbidden from —
// some forbidden modules are scoped (e.g., `ai-elements/context.tsx`
// and `tokenlens` are forbidden in RunCockpit shell only, but the lazy
// popover content is allowed to use them).
//
// The 2026-05-09 second cut moved the heavy half off RunCockpit to a
// lazy chunk AND eliminated `useOverviewData` from the chat entries
// themselves (chat/page + ChatView). Those entries used to call
// `useOverviewData()` for RunCheckpoint signals like `runtimeFallback`;
// the new contract is "RunCheckpoint is session-scoped only", and the
// global health snapshot belongs to /settings/health and the lazy
// RunCockpit popover.

const RUN_COCKPIT = path.join(SRC, 'components/chat/RunCockpit.tsx');
const CHAT_PAGE = path.join(SRC, 'app/chat/page.tsx');
const CHAT_VIEW = path.join(SRC, 'components/chat/ChatView.tsx');
const POPOVER = path.join(SRC, 'components/chat/RunCockpitPopoverContent.tsx');

interface ForbiddenRule {
  /** Bare specifier the entry's import statements must not reach. For
   *  the static-graph walker, we resolve to the corresponding repo path. */
  spec: string;
  /** Resolved repo file (relative to SRC). Some specs (`tokenlens`) are
   *  bare packages — graph walker stops at bare packages, so we also
   *  scan import statements in the entry directly. */
  rel?: string;
  /** Entry files this rule applies to. */
  entries: string[];
  /** Why this rule exists, for failure messages. */
  reason: string;
}

const FORBIDDEN: ForbiddenRule[] = [
  {
    spec: '@/components/settings/useOverviewData',
    rel: 'components/settings/useOverviewData.ts',
    entries: [RUN_COCKPIT, CHAT_PAGE, CHAT_VIEW],
    reason:
      'useOverviewData is the Settings Overview snapshot — fans out to ' +
      '/api/settings/app + /api/providers/models?runtime=auto + ' +
      '/api/providers/models + /api/providers/options + ' +
      '/api/settings/workspace + /api/workspace/summary on every chat ' +
      'first paint, and statically pulls runtime/effective into the ' +
      'compile graph. Belongs in /settings or the lazy RunCockpit ' +
      'popover content, never in the chat entry.',
  },
  {
    spec: '@/lib/runtime/effective',
    rel: 'lib/runtime/effective.ts',
    // ChatView only — the new-chat page (CHAT_PAGE) legitimately uses
    // `resolveNewChatDefault` from runtime/effective for its local
    // runtime-aware resolver effect. ChatView (existing-session path)
    // had no need beyond `computeEffectiveRuntime` for the dropped
    // `runtimeFallback` checkpoint, so the import must not return.
    entries: [CHAT_VIEW],
    reason:
      'ChatView no longer needs runtime/effective — the only consumer ' +
      'was computeEffectiveRuntime feeding the now-dropped runtimeFallback ' +
      'checkpoint. Re-introducing the import means RunCheckpoint regrew a ' +
      'global health signal it intentionally shed.',
  },
  {
    spec: '@/lib/provider-catalog',
    rel: 'lib/provider-catalog.ts',
    // RunCockpit shell only. The chat ENTRIES (CHAT_PAGE / CHAT_VIEW)
    // legitimately reach provider-catalog through the model-picker
    // chain (MessageInput → ModelSelectorDropdown → runtime-compat →
    // provider-catalog) — that's the composer's actual model UI, not
    // RunCheckpoint, and out of scope for this contract. The user's
    // explicit forbidden list for chat entries was useOverviewData +
    // runtime/effective only; provider-catalog wasn't on it.
    entries: [RUN_COCKPIT],
    reason:
      'provider-catalog is a ~70KB lookup table for Settings → Providers / ' +
      'Models. The trigger-only RunCockpit shell has no business reaching it.',
  },
  {
    spec: '@/components/ai-elements/context',
    rel: 'components/ai-elements/context.tsx',
    entries: [RUN_COCKPIT],
    reason:
      'The full ai-elements/context.tsx kit drags in tokenlens + ' +
      'HoverCard + Progress + Button. Use ContextProvider from ' +
      '`@/components/ai-elements/context-core` in the trigger shell; ' +
      'the lazy popover content keeps the full ContextContent.* family.',
  },
  {
    spec: 'tokenlens',
    entries: [RUN_COCKPIT],
    reason:
      'tokenlens is consumed exclusively by ContextContentBody / ' +
      'ContextInputUsage / etc. inside the full ai-elements/context.tsx — ' +
      'it must not be reachable from the trigger-only shell.',
  },
];

describe('Chat first-paint static-graph contract — RunCockpit + chat entries', () => {
  it('every guarded entry exists and resolves cleanly', () => {
    for (const entry of [RUN_COCKPIT, CHAT_PAGE, CHAT_VIEW, POPOVER]) {
      assert.ok(existsSync(entry), `${path.relative(SRC, entry)} not found`);
    }
    const graph = staticImportGraph(RUN_COCKPIT);
    assert.ok(
      graph.size > 5,
      `RunCockpit static graph has only ${graph.size} files — graph walker is likely broken`,
    );
  });

  for (const rule of FORBIDDEN) {
    for (const entry of rule.entries) {
      const entryRel = path.relative(SRC, entry);
      it(`${entryRel} static graph must not reach ${rule.spec}`, () => {
        // For bare packages (like `tokenlens`) the graph walker stops
        // at bare specifiers, so reachability via path alone won't
        // catch them. Scan the entry's source for an `import` statement
        // referencing the spec — that's a sufficient stand-in because
        // package imports always start at a `.ts/.tsx` file in our
        // own tree (no re-export indirection through a repo file
        // would import a bare package without us seeing it).
        const isBare = !rule.spec.startsWith('@/') && !rule.spec.startsWith('.');
        if (isBare) {
          // Walk the graph and grep each visited file for the bare spec.
          const graph = staticImportGraph(entry);
          for (const file of graph) {
            const src = readFileSync(file, 'utf-8');
            const stmtRe = /^[ \t]*import\b[^;]*;/gm;
            let m: RegExpExecArray | null;
            while ((m = stmtRe.exec(src)) !== null) {
              const stmt = m[0];
              const pathMatch = stmt.match(/from\s+["']([^"']+)["']/);
              const sideEffect = stmt.match(/^\s*import\s+["']([^"']+)["']/);
              const importedSpec = pathMatch?.[1] ?? sideEffect?.[1];
              if (importedSpec === rule.spec) {
                assert.fail(
                  `${entryRel} reaches '${rule.spec}' via ${path.relative(SRC, file)}.\n${rule.reason}`,
                );
              }
            }
          }
          return;
        }
        // Non-bare: graph walker can resolve to a concrete file.
        if (!rule.rel) {
          throw new Error(`Forbidden rule for ${rule.spec} missing rel`);
        }
        const target = path.join(SRC, rule.rel);
        const graph = staticImportGraph(entry);
        if (graph.has(target)) {
          assert.fail(`${entryRel} statically reaches ${rule.rel}.\n${rule.reason}`);
        }
      });
    }
  }

  it('chat entries still wire RunCockpit (split must not silently drop the surface)', () => {
    for (const rel of ['app/chat/page.tsx', 'components/chat/ChatView.tsx']) {
      const src = readFileSync(path.join(SRC, rel), 'utf-8');
      assert.match(
        src,
        /<RunCockpit[\s>]/,
        `${rel} must still render <RunCockpit/> — the split moves the data layer, the surface stays`,
      );
    }
  });

  it('chat entries use the lightweight useGlobalAgentRuntime hook (not useOverviewData)', () => {
    // After the cut, RuntimeSelector display still needs the global
    // agent_runtime label. The lightweight hook is the single
    // sanctioned source — verify both call sites use it.
    for (const rel of ['app/chat/page.tsx', 'components/chat/ChatView.tsx']) {
      const src = readFileSync(path.join(SRC, rel), 'utf-8');
      assert.match(
        src,
        /from\s+["']@\/hooks\/useGlobalAgentRuntime["']/,
        `${rel} must import useGlobalAgentRuntime — the heavy useOverviewData was the previous source and is now forbidden in chat first paint`,
      );
    }
  });

  it('RunCockpitPopoverContent IS still allowed to import the heavy data layer', () => {
    // Positive sanity: the lazy chunk WHERE these modules legitimately
    // live should reach them via static imports. If a refactor moved
    // them out of the popover content too, the popover would be
    // missing functionality. We just check the grep — full graph walk
    // not needed.
    const popover = readFileSync(
      path.join(SRC, 'components/chat/RunCockpitPopoverContent.tsx'),
      'utf-8',
    );
    assert.match(
      popover,
      /from\s+["']@\/components\/settings\/useOverviewData["']/,
      'RunCockpitPopoverContent must keep its useOverviewData import — ' +
        'that is the whole point of the split (heavy half lives here, ' +
        'shell stays light)',
    );
    assert.match(
      popover,
      /from\s+["']@\/lib\/runtime\/effective["']/,
      'RunCockpitPopoverContent must keep its runtime/effective import',
    );
  });

  it('RunCockpit shell loads the popover content via next/dynamic with ssr:false', () => {
    const shell = readFileSync(
      path.join(SRC, 'components/chat/RunCockpit.tsx'),
      'utf-8',
    );
    assert.match(
      shell,
      /import\s+dynamic\s+from\s+["']next\/dynamic["']/,
      'RunCockpit shell must import next/dynamic',
    );
    assert.match(
      shell,
      /dynamic\([\s\S]*?import\(\s*["']\.\/RunCockpitPopoverContent["']\s*\)[\s\S]*?ssr:\s*false/,
      'RunCockpit shell must lazy-load RunCockpitPopoverContent via next/dynamic with ssr:false. ' +
        'Without ssr:false the chunk would still resolve server-side on every request and the ' +
        'overview data layer would re-enter the chat first-paint graph.',
    );
  });
});
