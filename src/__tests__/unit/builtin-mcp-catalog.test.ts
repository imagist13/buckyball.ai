/**
 * Drift detector for `BUILTIN_MCP_CATALOG`.
 *
 * The MCP Tab renders the catalog as a read-only listing of every built-in
 * capability. If a new `tool('codepilot_*')` lands in one of the MCP source
 * files but the catalog isn't updated, the UI will under-report — and we'd
 * rather fail CI than silently lie to users (Phase 2D.2, 2026-04-30).
 *
 * Strategy: parse each MCP source file with a regex tuned for the exact
 * `tool('name', ...)` shape used in `src/lib/*-mcp.ts` + `widget-guidelines.ts`,
 * then assert the set of tool names matches what the catalog declares for
 * the corresponding server. Order doesn't matter; uniqueness does.
 *
 * Run with: npx tsx --test src/__tests__/unit/builtin-mcp-catalog.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  BUILTIN_MCP_CATALOG,
  BUILTIN_MCP_NAMES,
} from '../../lib/builtin-mcp-catalog';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

// Map every catalog entry to the source file that defines its tools.
// Keep this in sync if a new MCP file is added.
const SOURCE_FILES: Record<string, string> = {
  'codepilot-memory': 'src/lib/memory-search-mcp.ts',
  'codepilot-notify': 'src/lib/notification-mcp.ts',
  'codepilot-cli-tools': 'src/lib/cli-tools-mcp.ts',
  'codepilot-dashboard': 'src/lib/dashboard-mcp.ts',
  'codepilot-media': 'src/lib/media-import-mcp.ts',
  'codepilot-image-gen': 'src/lib/image-gen-mcp.ts',
  'codepilot-widget': 'src/lib/widget-guidelines.ts',
};

function extractToolNames(filePath: string): Set<string> {
  const absolute = path.join(REPO_ROOT, filePath);
  const source = fs.readFileSync(absolute, 'utf8');
  // tool('codepilot_xxx', ...). We only care about the leading literal
  // string identifier — schemas / handlers can wrap to many lines.
  const re = /tool\(\s*['"](codepilot_[a-z0-9_]+)['"]/g;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) out.add(m[1]);
  return out;
}

describe('BUILTIN_MCP_CATALOG — drift', () => {
  it('every catalog entry has a known source file mapping', () => {
    for (const entry of BUILTIN_MCP_CATALOG) {
      assert.ok(
        SOURCE_FILES[entry.name],
        `${entry.name}: add an entry to SOURCE_FILES in this test`,
      );
    }
  });

  for (const entry of BUILTIN_MCP_CATALOG) {
    it(`${entry.name}: catalog tools match the actual tool() calls`, () => {
      const actual = extractToolNames(SOURCE_FILES[entry.name]);
      const declared = new Set(entry.toolNames);
      assert.deepEqual(
        Array.from(actual).sort(),
        Array.from(declared).sort(),
        `Drift detected: ${entry.name} catalog ${JSON.stringify(
          [...declared].sort(),
        )} vs source ${JSON.stringify([...actual].sort())}`,
      );
    });
  }

  it('BUILTIN_MCP_NAMES is the set of catalog names (no typos / duplicates)', () => {
    const fromCatalog = new Set(BUILTIN_MCP_CATALOG.map((e) => e.name));
    assert.deepEqual(
      Array.from(BUILTIN_MCP_NAMES).sort(),
      Array.from(fromCatalog).sort(),
    );
    assert.equal(BUILTIN_MCP_NAMES.size, BUILTIN_MCP_CATALOG.length);
  });

  it('all catalog tool names follow the codepilot_* prefix convention', () => {
    for (const entry of BUILTIN_MCP_CATALOG) {
      for (const tool of entry.toolNames) {
        assert.match(
          tool,
          /^codepilot_[a-z0-9_]+$/,
          `${entry.name}: tool ${tool} doesn't match codepilot_* convention`,
        );
      }
    }
  });
});
