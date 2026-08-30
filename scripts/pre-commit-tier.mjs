// pre-commit-tier.mjs — classify the staged changeset so .husky/pre-commit can
// skip the heavy tsc + unit gate for docs-only commits (unit tests are ~300s).
//
// Contract:
//   classifyCommitTier(files) -> 'docs' | 'code'
// FAIL-CLOSED: only an all-docs, non-empty set returns 'docs'. Empty set, any
// code / dependency / build-script / config / unknown-extension file, or a
// classification error returns 'code' (full gate). The ONLY way to skip the
// heavy gate is an explicit 'docs' verdict — the hook mirrors this with a case
// guard, so no silent skip (guards the pre-2026-05-29 "prerequisite fails but
// commit passes" regression).

import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DOC_EXTENSIONS = new Set(['.md', '.mdx', '.markdown', '.txt', '.rst']);
const DOC_BASENAMES = new Set(['LICENSE', 'NOTICE', 'AUTHORS', 'PATENTS', 'COPYING']);

/** @param {string} file @returns {boolean} */
export function isDocPath(file) {
  const f = String(file).replace(/^\.\//, '').trim();
  if (!f) return false;
  if (f.startsWith('docs/')) return true; // anything under docs/ (incl. screenshots/images)
  const base = f.split('/').pop() || '';
  if (DOC_BASENAMES.has(base)) return true;
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot).toLowerCase() : '';
  return DOC_EXTENSIONS.has(ext);
}

/** @param {string[]} files @returns {'docs' | 'code'} */
export function classifyCommitTier(files) {
  const list = (files || []).map((f) => String(f).trim()).filter(Boolean);
  if (list.length === 0) return 'code'; // nothing/edge → full gate (fail-closed)
  return list.every(isDocPath) ? 'docs' : 'code';
}

function stagedFiles() {
  // NO --diff-filter: a staged DELETION (`git rm src/foo.ts`) must count too.
  // With --diff-filter=ACMR the deletion was invisible, so `docs edit + code
  // deletion` classified as 'docs' and skipped the gate — the exact fail-closed
  // hole Codex flagged (P1). Every staged path is classified; any non-doc → code.
  const out = execSync('git diff --cached --name-only', { encoding: 'utf8' });
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

function isMain() {
  return path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url);
}

if (isMain()) {
  let tier = 'code';
  try {
    tier = classifyCommitTier(stagedFiles());
  } catch {
    tier = 'code'; // fail-closed on any git / classification error
  }
  process.stdout.write(tier + '\n');
}
