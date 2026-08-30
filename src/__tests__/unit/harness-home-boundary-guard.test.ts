import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  canonicalHarnessFiles,
  checkCanonicalNeutrality,
} from '../../../scripts/check-harness-adapter-boundary.mjs';

function fixture(): string {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'harness-boundary-guard-'),
  );
  fs.mkdirSync(
    path.join(root, 'src/lib/harness-home/repository/nested'),
    { recursive: true },
  );
  fs.mkdirSync(
    path.join(root, 'src/lib/harness-home/adapters/example'),
    { recursive: true },
  );
  fs.mkdirSync(
    path.join(root, 'src/lib/harness-home/runtime'),
    { recursive: true },
  );
  return root;
}

describe('Harness Home canonical neutrality guard', () => {
  it('scans canonical subdirectories recursively and reports framework binding', () => {
    const root = fixture();
    try {
      const poison = path.join(
        root,
        'src/lib/harness-home/repository/nested/poison.ts',
      );
      fs.writeFileSync(
        poison,
        "export const runtime = 'codex_runtime';\n",
      );
      const files = canonicalHarnessFiles(root);
      assert.deepEqual(files, [poison]);
      assert.deepEqual(checkCanonicalNeutrality(root), [{
        file: 'src/lib/harness-home/repository/nested/poison.ts',
        line: 1,
        label: 'framework identity in canonical source',
        match: 'codex_runtime',
      }]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('allows runtime/adapter composition while rejecting canonical imports of it', () => {
    const root = fixture();
    try {
      fs.writeFileSync(
        path.join(root, 'src/lib/harness-home/adapters/example/index.ts'),
        "export const adapter = 'claude-code';\n",
      );
      fs.writeFileSync(
        path.join(root, 'src/lib/harness-home/runtime/index.ts'),
        "export const runtime = 'codepilot_runtime';\n",
      );
      const canonical = path.join(
        root,
        'src/lib/harness-home/contracts.ts',
      );
      fs.writeFileSync(canonical, 'export interface Neutral { id: string }\\n');
      assert.deepEqual(checkCanonicalNeutrality(root), []);

      fs.writeFileSync(
        canonical,
        "export { runtime } from './runtime';\n",
      );
      assert.equal(
        checkCanonicalNeutrality(root)[0]?.label,
        'runtime-specific import',
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('is wired into both npm test and the code pre-commit tier', () => {
    const root = path.resolve(__dirname, '../../..');
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    const hook = fs.readFileSync(
      path.join(root, '.husky/pre-commit'),
      'utf8',
    );
    assert.match(
      packageJson.scripts.test,
      /npm run test:harness-boundary/,
    );
    assert.equal(
      packageJson.scripts['test:harness-boundary'],
      'node scripts/check-harness-adapter-boundary.mjs --check-canonical',
    );
    assert.match(
      hook,
      /node scripts\/check-harness-adapter-boundary\.mjs --check-canonical/,
    );
  });
});
