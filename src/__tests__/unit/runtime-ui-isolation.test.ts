/**
 * Phase 0.5 Slice A guardrail — UI must not consume Codex-specific
 * (or any runtime-specific) event / metadata names.
 *
 * Chat / Run / Preview surfaces speak in the canonical
 * `RuntimeRunEvent` / `RuntimePermissionEvent` union. Codex
 * app-server's native event names (`thread/started`, `turn/started`,
 * `item/agentMessage`, `app-server`, etc.) are adapter-internal —
 * they translate into the canonical union inside `src/lib/codex/` (or
 * any other runtime adapter), not in UI components.
 *
 * RuntimeSelector is the only allowed exception: it may render a
 * runtime id as a user-facing label. The exception is location-scoped
 * (separate test file would whitelist it explicitly), but for now
 * RuntimeSelector lives outside the 5 components this test scans.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const UI_FILES = [
  'components/chat/ChatView.tsx',
  'components/chat/MessageInput.tsx',
  'components/chat/RunCockpit.tsx',
  'components/chat/RunCheckpoint.tsx',
  'components/layout/panels/PreviewPanel.tsx',
];

// Codex / runtime-specific tokens that must never appear in these UI files.
// Adapter implementations (src/lib/codex/...) MAY use these freely — UI
// must consume the translated canonical union.
const FORBIDDEN_TOKENS = [
  'thread/started',
  'thread/completed',
  'turn/started',
  'turn/completed',
  'item/agentMessage',
  'item/started',
  'item/completed',
  'app-server',
  'codex_thread_id',
  'codex_turn_id',
  // ClaudeCode SDK private session id should also stay out of these
  // files — adapters expose it via `RuntimeSessionRef.token` instead.
  'sdkSessionId',
  'claude_sdk_session_id',
];

describe('UI components must not branch on runtime-specific names', () => {
  for (const rel of UI_FILES) {
    it(`${rel} has no runtime-private tokens`, () => {
      const abs = path.resolve(__dirname, '../..', rel);
      if (!fs.existsSync(abs)) {
        // Some files may not exist in all worktrees / branches; skip
        // missing files rather than failing — the test is a regression
        // guard for files that do exist.
        return;
      }
      const src = fs.readFileSync(abs, 'utf8');
      for (const token of FORBIDDEN_TOKENS) {
        assert.ok(
          !src.includes(token),
          `${rel} references runtime-private token \`${token}\`. ` +
            `Move the branch into an adapter layer (src/lib/runtime/* or src/lib/codex/*) and ` +
            `expose canonical RuntimeRunEvent / RuntimePermissionEvent to the UI.`,
        );
      }
    });
  }
});
