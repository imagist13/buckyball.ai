/**
 * Phase 0.5 follow-up guardrail (2026-05-13) — forbid new hand-rolled
 * `'claude_code' | 'codepilot_runtime'` type unions in the small set
 * of files that were previously the source of Codex P1.1 finding.
 *
 * The canonical contract is: `RuntimeId` from
 * `src/lib/runtime/runtime-id.ts` is the single source of truth.
 * Anywhere that takes / returns / stores a runtime label must type
 * against `RuntimeId`, not a literal union — otherwise Codex Runtime
 * (or future Gemini etc.) can't be added with a single-place edit.
 *
 * The three files scanned here had hard-coded unions at review time;
 * if a future change reintroduces one, this test fails and points
 * the implementer back at `RuntimeId`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const SCANNED_FILES = [
  'hooks/useProviderModels.ts',
  'components/chat/ModelSelectorDropdown.tsx',
  '__tests__/unit/chat-runtime.test.ts',
];

// Token patterns that signal a hand-rolled two-state union. Each is
// matched against the file source; any match means the file
// regressed to literal-union typing instead of the canonical
// `RuntimeId`.
//
// The patterns deliberately match the type-position form (with
// quotes + a pipe) — string literals like `'claude_code'` used as
// values are still fine (e.g. invoking `onRuntimePinChange('claude_code')`).
const FORBIDDEN_PATTERNS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /'claude_code'\s*\|\s*'codepilot_runtime'/,
    reason: "literal union 'claude_code' | 'codepilot_runtime'",
  },
  {
    pattern: /'codepilot_runtime'\s*\|\s*'claude_code'/,
    reason: "literal union 'codepilot_runtime' | 'claude_code'",
  },
];

describe('Hand-rolled RuntimeId union — guardrail', () => {
  for (const rel of SCANNED_FILES) {
    it(`${rel} does not reintroduce a hand-rolled RuntimeId union`, () => {
      const abs = path.resolve(__dirname, '../..', rel);
      const src = fs.readFileSync(abs, 'utf8');
      for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
        assert.ok(
          !pattern.test(src),
          `${rel} reintroduces ${reason}. ` +
            `Use \`RuntimeId\` from \`@/lib/runtime/runtime-id\` instead — ` +
            `the canonical union grows automatically when RUNTIME_IDS gains a new id.`,
        );
      }
    });
  }
});
