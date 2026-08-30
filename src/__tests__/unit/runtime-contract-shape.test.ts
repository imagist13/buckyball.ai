/**
 * Phase 0.5 Slice A guardrail — Runtime compatibility contract shape.
 *
 * Locks `ModelRuntimeCompat` to the supportedRuntimes[] +
 * unsupportedReasonByRuntime contract introduced 2026-05-13. The two
 * legacy booleans (claude_code_compatible / codepilot_runtime_compatible)
 * are kept as `@deprecated` back-compat input; adding a third
 * `*_runtime_compatible` boolean is explicitly forbidden — new runtimes
 * MUST extend the supportedRuntimes array, not bolt another boolean
 * onto the compat record.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const typesSrc = fs.readFileSync(
  path.resolve(__dirname, '../../types/index.ts'),
  'utf8',
);

describe('ModelRuntimeCompat — runtime contract shape', () => {
  it('declares supportedRuntimes as the canonical compat field', () => {
    assert.match(typesSrc, /supportedRuntimes\?\:\s*string\[\]/);
  });

  it('declares unsupportedReasonByRuntime as the per-runtime reason channel', () => {
    assert.match(typesSrc, /unsupportedReasonByRuntime\?\:\s*Record<string,\s*string>/);
  });

  it('keeps the two legacy compat booleans deprecated', () => {
    assert.match(typesSrc, /@deprecated[\s\S]{0,200}claude_code_compatible\?\:\s*boolean/);
    assert.match(typesSrc, /@deprecated[\s\S]{0,200}codepilot_runtime_compatible\?\:\s*boolean/);
  });

  it('does NOT introduce a third runtime-compatible boolean', () => {
    // Legacy ModelRuntimeCompat has exactly two boolean fields whose
    // names end in `_compatible`: claude_code_compatible and
    // codepilot_runtime_compatible. Anything else with that suffix on
    // ModelRuntimeCompat is the regression we want to block — new
    // runtimes MUST extend `supportedRuntimes`, not bolt another
    // boolean onto the compat record.
    const matches = typesSrc.match(/(\w+_compatible)\?\:\s*boolean/g) ?? [];
    const names = matches
      .map((m) => m.replace(/\?\:\s*boolean$/, '').trim())
      .sort();
    assert.deepEqual(
      names,
      ['claude_code_compatible', 'codepilot_runtime_compatible'],
      'Adding a third *_compatible boolean to ModelRuntimeCompat is forbidden — extend supportedRuntimes instead.',
    );
  });
});
