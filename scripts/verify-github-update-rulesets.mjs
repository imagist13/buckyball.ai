#!/usr/bin/env node

import fs from 'node:fs';

const [mainPath, tagPath, confirmedStateInput] = process.argv.slice(2);
if (!mainPath || !tagPath) {
  throw new Error(
    'Usage: node scripts/verify-github-update-rulesets.mjs <main-ruleset.json> <tag-ruleset.json> [confirmed-state-json|--emit-confirmed-state]',
  );
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function normalizeUpdatedAt(ruleset, label) {
  if (!Number.isInteger(ruleset.id) || ruleset.id <= 0) {
    throw new Error(`${label} ruleset response does not expose a valid id`);
  }
  if (typeof ruleset.updated_at !== 'string') {
    throw new Error(`${label} ruleset response does not expose updated_at`);
  }
  const updatedAt = new Date(ruleset.updated_at);
  if (Number.isNaN(updatedAt.getTime())) {
    throw new Error(`${label} ruleset updated_at is invalid`);
  }
  return updatedAt.toISOString();
}

function verifyRuleset(ruleset, expected) {
  if (!ruleset || typeof ruleset !== 'object') throw new Error(`${expected.label} ruleset is not an object`);
  if (ruleset.target !== expected.target) {
    throw new Error(`${expected.label} ruleset target ${ruleset.target} != ${expected.target}`);
  }
  if (ruleset.enforcement !== 'active') {
    throw new Error(`${expected.label} ruleset must be active, found ${ruleset.enforcement}`);
  }
  const includes = ruleset.conditions?.ref_name?.include;
  if (!Array.isArray(includes) || !expected.refPatterns.some((pattern) => includes.includes(pattern))) {
    throw new Error(`${expected.label} ruleset does not include ${expected.refPatterns.join(' or ')}`);
  }
  const excludes = ruleset.conditions?.ref_name?.exclude;
  if (!Array.isArray(excludes)) {
    throw new Error(`${expected.label} ruleset response does not expose excluded refs`);
  }
  if (excludes.length > 0) {
    throw new Error(`${expected.label} ruleset must not exclude protected refs`);
  }
  const ruleTypes = new Set(Array.isArray(ruleset.rules) ? ruleset.rules.map((rule) => rule?.type) : []);
  for (const required of expected.requiredRules) {
    if (!ruleTypes.has(required)) throw new Error(`${expected.label} ruleset is missing ${required}`);
  }
  const exposesBypassActors = Object.hasOwn(ruleset, 'bypass_actors');
  if (exposesBypassActors && !Array.isArray(ruleset.bypass_actors)) {
    throw new Error(`${expected.label} ruleset bypass actors must be an array`);
  }
  if (exposesBypassActors && ruleset.bypass_actors.length > 0) {
    throw new Error(`${expected.label} ruleset must not define bypass actors`);
  }
  return {
    exposesBypassActors,
    id: ruleset.id,
    updatedAt: normalizeUpdatedAt(ruleset, expected.label),
  };
}

const mainRuleset = readJson(mainPath);
const tagRuleset = readJson(tagPath);
const main = verifyRuleset(mainRuleset, {
  label: 'default branch',
  target: 'branch',
  refPatterns: ['~DEFAULT_BRANCH', 'refs/heads/main'],
  requiredRules: ['deletion', 'non_fast_forward'],
});
const stableTags = verifyRuleset(tagRuleset, {
  label: 'stable release tag',
  target: 'tag',
  refPatterns: ['refs/tags/v*'],
  requiredRules: ['deletion', 'update'],
});

const confirmedState = {
  version: 1,
  noBypass: true,
  main: { id: main.id, updatedAt: main.updatedAt },
  stableTags: { id: stableTags.id, updatedAt: stableTags.updatedAt },
};

if (confirmedStateInput === '--emit-confirmed-state') {
  if (!main.exposesBypassActors || !stableTags.exposesBypassActors) {
    throw new Error('administrator ruleset responses must expose bypass actors before emitting confirmed state');
  }
  process.stdout.write(`${JSON.stringify(confirmedState)}\n`);
  process.exit(0);
}

if (!main.exposesBypassActors || !stableTags.exposesBypassActors) {
  if (!confirmedStateInput) {
    throw new Error(
      'ruleset response does not expose bypass actors; CODEPILOT_RULESETS_CONFIRMED_STATE is required',
    );
  }
  let suppliedState;
  try {
    suppliedState = JSON.parse(confirmedStateInput);
  } catch {
    throw new Error('CODEPILOT_RULESETS_CONFIRMED_STATE must be valid JSON');
  }
  if (JSON.stringify(suppliedState) !== JSON.stringify(confirmedState)) {
    throw new Error(
      'CODEPILOT_RULESETS_CONFIRMED_STATE does not match live ruleset ids/updated_at; administrator reconfirmation is required',
    );
  }
}

console.log(
  'GitHub unsigned-updater rulesets OK: default branch blocks deletion/force-push and v* tags block update/deletion with no bypass/exclude',
);
