import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf-8');

describe('assistant rules effective injection owner', () => {
  it('interactive and bridge callers identify each native project-rules owner', () => {
    const chat = read('src/app/api/chat/route.ts');
    const bridge = read('src/lib/bridge/conversation-engine.ts');
    for (const source of [chat, bridge]) {
      assert.match(source, /nativeProjectRulesOwner/);
      assert.match(source, /=== ['"]claude_code['"]\s*&&\s*!resolved\.provider/);
      assert.match(source, /=== ['"]codex_runtime['"]/);
    }
  });

  it('Context Assembler delegates omission to the evidence-backed ownership policy', () => {
    const source = read('src/lib/context-assembler.ts');
    const workspace = read('src/lib/assistant-workspace.ts');
    assert.match(source, /shouldOmitCanonicalRules\(nativeProjectRulesOwner, files\)/);
    assert.match(workspace, /nativeProjectRulesOwner === 'claude_code' && files\.rulesFileNativeClaude === true/);
    assert.doesNotMatch(workspace, /nativeProjectRulesOwner === 'codex_runtime' && files\.rulesFileNativeCodex === true/);
  });

  it('heartbeat SDK calls keep settingSources empty', () => {
    const source = read('src/lib/claude-client.ts');
    assert.match(source, /settingSources:\s*isHeartbeatMode\s*\?\s*\(\[\]/);
  });
});
