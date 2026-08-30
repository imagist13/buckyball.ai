/**
 * Phase 0.5 Slice A guardrail — Session / Tab / Panel state must only
 * carry the canonical `RuntimeSessionRef` shape (runtimeId + opaque
 * token + adapter-private metadata).
 *
 * Concrete runtime-side identifiers (Claude SDK session id, future
 * Codex thread id, Native internal state) must live inside
 * `RuntimeSessionRef.metadata` (adapter-owned namespace) — never as
 * top-level fields on the chat session row, the workspace Tab
 * metadata, the PreviewSource union, or the panel state.
 *
 * Slice C migrates the runtime adapters to honor this; Slice A
 * locks the contract type itself and asserts the shape is reachable
 * from the runtime barrel.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const contractSrc = fs.readFileSync(
  path.resolve(__dirname, '../../lib/runtime/contract.ts'),
  'utf8',
);

const panelStateFiles = [
  'lib/workspace-sidebar.ts',
  'lib/preview-source.ts',
  'hooks/usePanel.ts',
];

describe('Runtime session metadata contract', () => {
  it('RuntimeSessionRef declares runtimeId + opaque token + private metadata bag', () => {
    assert.match(contractSrc, /interface\s+RuntimeSessionRef\b/);
    assert.match(contractSrc, /readonly\s+runtimeId\s*:\s*RuntimeId/);
    assert.match(contractSrc, /readonly\s+token\s*:\s*string/);
    assert.match(contractSrc, /readonly\s+metadata\?\s*:\s*Readonly<Record<string,\s*unknown>>/);
  });

  it('panel / tab / preview state files do not carry runtime-private session ids', () => {
    const forbiddenInPanelState = [
      'sdkSessionId',
      'claude_sdk_session_id',
      'codex_thread_id',
      'codex_turn_id',
    ];
    for (const rel of panelStateFiles) {
      const abs = path.resolve(__dirname, '../..', rel);
      if (!fs.existsSync(abs)) continue;
      const src = fs.readFileSync(abs, 'utf8');
      for (const token of forbiddenInPanelState) {
        assert.ok(
          !src.includes(token),
          `${rel} references runtime-private session field \`${token}\`. ` +
            `Move it into the adapter's RuntimeSessionRef.metadata bag.`,
        );
      }
    }
  });
});
