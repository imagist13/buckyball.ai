#!/usr/bin/env node
// GitHub issue backlog dry-run audit — READ ONLY.
// Phase 7A of docs/exec-plans/active/v0.56.x-stability-trust.md.
//
// SAFETY: this script ONLY runs `gh issue list` (read). It never closes,
// labels, comments, or mutates GitHub in any way. Output is a bucketed
// markdown report for HUMAN review — the buckets are heuristic SUGGESTIONS,
// not decisions. Issue bodies are read in-memory for keyword detection but are
// NEVER written to the report (privacy: no user logs /原文 leak).
//
// Usage: node scripts/github-issue-backlog-audit.mjs [--limit N] [--input file.json]
//   --limit N      how many open issues to pull (default 500)
//   --input file   read issues from a JSON file instead of calling gh (for re-runs)

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RESEARCH_DIR = path.join(REPO_ROOT, 'docs', 'research');

const args = process.argv.slice(2);
const limitArg = args.indexOf('--limit');
const LIMIT = limitArg >= 0 ? Number(args[limitArg + 1]) : 500;
const inputArg = args.indexOf('--input');
const INPUT_FILE = inputArg >= 0 ? args[inputArg + 1] : null;

const today = new Date().toISOString().slice(0, 10);
const now = Date.now();

// Current stable line (read from package.json). "old version" = two minors below.
const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
const [curMajor, curMinor] = pkg.version.split('.').map(Number);
const OLD_MINOR_CEILING = curMinor - 2; // e.g. 0.56 → 0.54 and below = old

// Issues already closed-out in local decision logs (fixed-close candidates).
// Kept tiny + explicit; everything else is judged by heuristics, never auto-bucketed as fixed.
const LOCALLY_FIXED = new Set([628, 629]);

function pullIssues() {
  if (INPUT_FILE) return JSON.parse(fs.readFileSync(INPUT_FILE, 'utf8'));
  const fields = 'number,title,labels,milestone,createdAt,updatedAt,author,body';
  const raw = execSync(
    `gh issue list --state open --limit ${LIMIT} --json ${fields}`,
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  );
  return JSON.parse(raw);
}

const daysSince = (iso) => Math.floor((now - new Date(iso).getTime()) / 86_400_000);

// Normalize a GitHub issue title for safe single-line markdown table output:
// collapse ALL whitespace (incl. \n \r \t and runs) to single spaces, trim,
// escape pipes. Fixes embedded-newline titles splitting table rows (e.g. #287)
// and trailing-whitespace lint on the generated report.
function sanitizeTitle(title, max = 80) {
  const clean = String(title || '').replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|');
  return clean.length > max ? clean.slice(0, max - 1) + '…' : clean;
}

// --- heuristic detectors (conservative; only used to SUGGEST a bucket) ---
const labelNames = (i) => (i.labels || []).map((l) => l.name);
const isP0P1 = (i) => labelNames(i).some((n) => /^P0-|^P1-/.test(n));
const text = (i) => `${i.title}\n${i.body || ''}`;

const hasVersion = (i) => /\bv?0\.\d{2}\b|版本号?|version/i.test(text(i));
const hasRepro = (i) => /复现|重现|步骤|reproduce|steps to|repro/i.test(text(i));
const hasEnv = (i) => /windows|macos|mac\b|系统|os\b|runtime|provider|claude code|codex/i.test(text(i));

function detectsOldVersion(i) {
  // any 0.MM version token in title/body whose minor <= OLD_MINOR_CEILING
  const matches = [...text(i).matchAll(/\b0\.(\d{1,2})(?:\.\d+)?\b/g)];
  return matches.some((m) => Number(m[1]) <= OLD_MINOR_CEILING);
}
const isFeature = (i) =>
  labelNames(i).includes('enhancement') ||
  /建议|希望|能不能|可不可以|增加|期望|feature request|feature[: ]|support for|请支持|求.*功能/i.test(i.title);
const isSupport = (i) =>
  /怎么|如何|请问|求助|咨询|为什么|怎样|how (do|to|can)|why does|question/i.test(i.title);

// crude duplicate clustering by topic keywords
const DUP_TOPICS = [
  { key: 'provider-connect', re: /连接失败|连不上|无法连接|connection (failed|error)|connect.*fail/i },
  { key: 'claude-cli-missing', re: /claude (code )?(cli )?not found|找不到 claude|claude.*未安装|cli.*not found/i },
  { key: 'model-list', re: /模型列表|model list|模型.*(不显示|缺失|加载不出)|no models|模型加载/i },
  { key: 'bridge', re: /bridge|桥接|飞书|telegram|discord|微信|qq/i },
  { key: 'install-update', re: /安装|更新|install|update|安装程序|installer|无法打开/i },
  { key: 'crash-interrupt', re: /闪退|崩溃|crash|中断|interrupt|自动停止/i },
];
function dupTopic(i) {
  // title-only: matching against body produced false clusters (e.g. #624
  // "quota/billing" got pulled into 'bridge' because its body mentioned a bridge).
  const hit = DUP_TOPICS.find((t) => t.re.test(i.title));
  return hit ? hit.key : null;
}

function bucketOf(i) {
  // fixed-close takes precedence over P0/P1: #628/#629 carry a P1 label but are
  // locally closed-out (decision log), so they belong in fixed-close (closable
  // with evidence), NOT埋进 keep-p1-review. Any OTHER P0/P1 stays untouchable.
  if (LOCALLY_FIXED.has(i.number)) return 'fixed-close';
  if (isP0P1(i)) return 'keep-p1-review';
  const stale = daysSince(i.updatedAt) >= 45;
  if (detectsOldVersion(i) && stale) return 'old-version-confirmation';
  if (isFeature(i)) return 'feature-parking-lot';
  if (isSupport(i) && stale) return 'support-question-close';
  if (!hasRepro(i) && !hasEnv(i)) return 'needs-repro';
  return 'uncategorized';
}

// --- run ---
const issues = pullIssues();
const enriched = issues.map((i) => ({
  number: i.number,
  title: i.title,
  labels: labelNames(i),
  milestone: i.milestone?.title || null,
  ageDays: daysSince(i.createdAt),
  idleDays: daysSince(i.updatedAt),
  bucket: bucketOf(i),
  dup: dupTopic(i),
  signals: {
    oldVersion: detectsOldVersion(i),
    hasRepro: hasRepro(i),
    hasEnv: hasEnv(i),
    isFeature: isFeature(i),
    isSupport: isSupport(i),
  },
}));

const count = (pred) => enriched.filter(pred).length;
const byBucket = {};
for (const e of enriched) (byBucket[e.bucket] ||= []).push(e);
const dupClusters = {};
for (const e of enriched) if (e.dup) (dupClusters[e.dup] ||= []).push(e);

// --- markdown report (NO issue bodies, only number+title+derived signals) ---
const BUCKET_ORDER = [
  'keep-p1-review', 'fixed-close', 'old-version-confirmation',
  'needs-repro', 'feature-parking-lot', 'support-question-close', 'uncategorized',
];
const BUCKET_DESC = {
  'keep-p1-review': '挂 P0/P1 label — **绝不自动处理**，留当前主线',
  'fixed-close': '本地决策日志已闭环、可带证据关闭（仅 allowlist）',
  'old-version-confirmation': '疑似旧版本（≤0.' + OLD_MINOR_CEILING + '）+ 45 天无更新 → 打 old-version 先评论复测',
  'needs-repro': '缺复现/环境信息 → 打 needs-repro 补模板',
  'feature-parking-lot': '疑似功能请求 → v0.57+ parking-lot',
  'support-question-close': '疑似 support 提问 + 45 天无更新 → 评论后关闭候选',
  'uncategorized': '启发式未命中 → **必须人工逐条判断**',
};

let md = '';
md += `# GitHub Issue Backlog 审计（dry-run，只读）— ${today}\n\n`;
md += `> 由 \`scripts/github-issue-backlog-audit.mjs\` 生成。**未对 GitHub 做任何改动。**\n`;
md += `> 分桶是启发式**建议**，不是决定；关闭 / 打标签 / 评论前必须人工复核每一条。\n`;
md += `> 报告不含 issue 正文（隐私）——只有编号、标题、派生信号。\n\n`;
md += `当前稳定线 \`${pkg.version}\`；"旧版本"判定 = 提到 ≤ 0.${OLD_MINOR_CEILING} 的版本号。\n\n`;

md += `## 总览\n\n`;
md += `| 指标 | 数量 |\n|------|------|\n`;
md += `| 拉取 open issue | ${enriched.length}${enriched.length >= LIMIT ? `（达到 --limit ${LIMIT}，可能还有更多）` : ''} |\n`;
md += `| 无 label | ${count((e) => e.labels.length === 0)} |\n`;
md += `| 无 milestone | ${count((e) => !e.milestone)} |\n`;
md += `| >30 天未更新 | ${count((e) => e.idleDays > 30)} |\n`;
md += `| >60 天未更新 | ${count((e) => e.idleDays > 60)} |\n`;
md += `| >90 天未更新 | ${count((e) => e.idleDays > 90)} |\n`;
md += `| 疑似旧版本 | ${count((e) => e.signals.oldVersion)} |\n`;
md += `| 疑似 feature | ${count((e) => e.signals.isFeature)} |\n`;
md += `| 命中重复主题 | ${count((e) => e.dup)} |\n\n`;

md += `## 分桶建议\n\n`;
md += `| 桶 | 数量 | 含义 |\n|------|------|------|\n`;
for (const b of BUCKET_ORDER) md += `| \`${b}\` | ${(byBucket[b] || []).length} | ${BUCKET_DESC[b]} |\n`;
md += `\n`;

for (const b of BUCKET_ORDER) {
  const list = byBucket[b] || [];
  if (!list.length) continue;
  md += `### \`${b}\`（${list.length}）\n\n`;
  md += `${BUCKET_DESC[b]}\n\n`;
  md += `| # | idle天 | label数 | 标题 |\n|---|--------|---------|------|\n`;
  for (const e of list.sort((a, b) => b.idleDays - a.idleDays)) {
    const t = sanitizeTitle(e.title, 80);
    md += `| ${e.number} | ${e.idleDays} | ${e.labels.length} | ${t} |\n`;
  }
  md += `\n`;
}

md += `## 重复主题聚类（仅候选，canonical 需人工选）\n\n`;
md += `> 仅按**标题**关键词命中归类（不看正文，避免正文偶然命中误聚）；**不自动推荐 canonical**——同主题下留哪个作主 issue 须人工判断后再评论 / 关闭。\n\n`;
for (const [key, list] of Object.entries(dupClusters)) {
  if (list.length < 2) continue;
  md += `### ${key}（${list.length}）\n\n`;
  const sorted = list.sort((a, b) => a.ageDays - b.ageDays);
  md += sorted.map((e) => `- #${e.number}（idle ${e.idleDays}d）${sanitizeTitle(e.title, 70)}`).join('\n');
  md += `\n\n`;
}

md += `## 下一步（不在本脚本内执行）\n\n`;
md += `1. 人工复核本报告，尤其 \`uncategorized\` 和所有 \`*-close\` 候选。\n`;
md += `2. \`fixed-close\`（#628/#629）可带本地修复证据关闭。\n`;
md += `3. \`old-version-confirmation\` / \`support-question-close\`：先打 label + 评论，14 天宽限后再关（需用户确认）。\n`;
md += `4. P0/P1 一律不在此流程自动处理。\n`;

if (!fs.existsSync(RESEARCH_DIR)) fs.mkdirSync(RESEARCH_DIR, { recursive: true });
const outPath = path.join(RESEARCH_DIR, `github-issue-backlog-audit-${today}.md`);
fs.writeFileSync(outPath, md, 'utf8');

// --- console summary ---
console.log(`[backlog-audit] READ-ONLY — no GitHub mutation.`);
console.log(`[backlog-audit] pulled ${enriched.length} open issues (limit ${LIMIT})`);
console.log(`[backlog-audit] no-label=${count((e) => e.labels.length === 0)} no-milestone=${count((e) => !e.milestone)} idle>90d=${count((e) => e.idleDays > 90)}`);
console.log(`[backlog-audit] buckets:`);
for (const b of BUCKET_ORDER) console.log(`  ${b.padEnd(26)} ${(byBucket[b] || []).length}`);
console.log(`[backlog-audit] report → ${path.relative(REPO_ROOT, outPath)}`);
