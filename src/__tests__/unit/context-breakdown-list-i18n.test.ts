/**
 * context-breakdown-list-i18n.test.ts — Codex P1 finding (2026-05-19) closeout.
 *
 * Pins the i18n contract for ContextBreakdownList so a future refactor can't
 * silently regress to rendering `part.label` directly (which mixed Chinese
 * DEFAULT_LABELS into the English UI).
 *
 * Source-grep tests rather than runtime React rendering — we just need to
 * lock the file shape:
 *   1. Component uses useTranslation
 *   2. Component does not render {part.label}
 *   3. Component maps every ContextBreakdownKind to a runStatus.breakdown* key
 *   4. Both zh.ts and en.ts carry all 10 keys
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const repoRoot = path.join(__dirname, '..', '..');

const KIND_TO_KEY: Record<string, string> = {
  system_prompt: 'runStatus.breakdownSystemPrompt',
  tools: 'runStatus.breakdownTools',
  rules: 'runStatus.breakdownRules',
  skills: 'runStatus.breakdownSkills',
  mcp: 'runStatus.breakdownMcp',
  memory: 'runStatus.breakdownMemory',
  files_attachments: 'runStatus.breakdownFilesAttachments',
  conversation: 'runStatus.breakdownConversation',
  pending_next_turn: 'runStatus.breakdownPendingNextTurn',
  cache_or_previous: 'runStatus.breakdownCacheOrPrevious',
};

describe('ContextBreakdownList — i18n contract (Codex P1 finding 2026-05-19)', () => {
  const src = fs.readFileSync(
    path.join(
      repoRoot,
      'components/chat/context-breakdown/ContextBreakdownList.tsx',
    ),
    'utf8',
  );

  it('imports useTranslation', () => {
    assert.match(
      src,
      /useTranslation/,
      'ContextBreakdownList must import useTranslation hook to drive labels through i18n',
    );
  });

  it('does NOT render `{part.label}` directly', () => {
    // The old form `<span>{part.label}</span>` is exactly what Codex flagged.
    // After P1 closeout the label must come from t(LABEL_KEY[part.kind]).
    assert.doesNotMatch(
      src,
      />\{\s*part\.label\s*\}</,
      'ContextBreakdownList must not render {part.label} — labels must go through t(LABEL_KEY[part.kind])',
    );
  });

  it('renders t(LABEL_KEY[part.kind]) for user-facing labels', () => {
    assert.match(
      src,
      /t\(LABEL_KEY\[part\.kind\]\)/,
      'ContextBreakdownList must call t(LABEL_KEY[part.kind]) so the i18n key drives the rendered label',
    );
  });

  it('LABEL_KEY map covers every ContextBreakdownKind with a runStatus.breakdown* key', () => {
    for (const [kind, expectedKey] of Object.entries(KIND_TO_KEY)) {
      // The map line should read e.g.
      //   system_prompt: 'runStatus.breakdownSystemPrompt' as TranslationKey,
      const re = new RegExp(
        `${kind}\\s*:\\s*['"]${expectedKey.replace('.', '\\.')}['"]`,
      );
      assert.match(
        src,
        re,
        `LABEL_KEY must map ${kind} → ${expectedKey}; missing or mismatched in ContextBreakdownList`,
      );
    }
  });
});

describe('ContextBreakdownList i18n keys — zh + en bundle coverage', () => {
  it('all 10 runStatus.breakdown* keys exist in zh.ts and en.ts', () => {
    const zh = fs.readFileSync(path.join(repoRoot, 'i18n/zh.ts'), 'utf8');
    const en = fs.readFileSync(path.join(repoRoot, 'i18n/en.ts'), 'utf8');
    for (const key of Object.values(KIND_TO_KEY)) {
      const escaped = key.replace('.', '\\.');
      assert.match(
        zh,
        new RegExp(`['"]${escaped}['"]`),
        `${key} missing from zh.ts — i18n bundles must stay in sync`,
      );
      assert.match(
        en,
        new RegExp(`['"]${escaped}['"]`),
        `${key} missing from en.ts — i18n bundles must stay in sync`,
      );
    }
  });

  it('zh and en values are different for non-trivial labels (English is not Chinese fallback)', () => {
    // Sanity check: regression test for "forgot to translate en.ts" — the
    // values for system_prompt / rules / files_attachments etc. should
    // differ between bundles. Keys whose English happens to equal the
    // brand string (Skills / MCP / Memory) are exempt.
    const zh = fs.readFileSync(path.join(repoRoot, 'i18n/zh.ts'), 'utf8');
    const en = fs.readFileSync(path.join(repoRoot, 'i18n/en.ts'), 'utf8');
    const checks: Array<[string, string]> = [
      ['runStatus.breakdownSystemPrompt', '系统提示'],
      ['runStatus.breakdownTools', '工具'],
      ['runStatus.breakdownRules', '规则'],
      ['runStatus.breakdownFilesAttachments', '文件与附件'],
      ['runStatus.breakdownConversation', '对话历史'],
      ['runStatus.breakdownPendingNextTurn', '本次待加入'],
      ['runStatus.breakdownCacheOrPrevious', '缓存 / 上轮'],
    ];
    for (const [key, zhValue] of checks) {
      const escapedKey = key.replace('.', '\\.');
      assert.match(
        zh,
        new RegExp(`['"]${escapedKey}['"]\\s*:\\s*['"]${zhValue}['"]`),
        `${key} must carry the documented Chinese label in zh.ts`,
      );
      // en.ts must NOT have the Chinese value for this key
      assert.doesNotMatch(
        en,
        new RegExp(`['"]${escapedKey}['"]\\s*:\\s*['"]${zhValue}['"]`),
        `${key} must not carry the Chinese label in en.ts — translate it`,
      );
    }
  });
});
