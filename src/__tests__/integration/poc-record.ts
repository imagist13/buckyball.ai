/**
 * Minimal shared helper for POC integration tests to append results to
 * docs/research/agent-sdk-0-2-111-capabilities.md.json. Each POC calls
 * recordPocResult(key, value) once and the file accumulates go/no-go
 * evidence across runs.
 *
 * Why a plain JSON file instead of a real reporter:
 *   - Tests skip themselves when CLAUDE_SDK_POC !== '1', so normal
 *     CI never touches the file.
 *   - Hand-writeable JSON is friendlier for future humans comparing
 *     SDK-version behaviors than reconstructing console output.
 *
 * Written synchronously on purpose: test runner may exit before a fire-
 * and-forget async write flushes, and we want the file up-to-date before
 * the assertion line fires.
 */

import fs from 'node:fs';
import path from 'node:path';

const REPORT_PATH = path.resolve(
  __dirname,
  '../../../docs/research/agent-sdk-0-2-111-capabilities.md.json',
);

interface PocReport {
  schema_version: 1;
  last_updated: string;
  results: Record<string, unknown>;
}

function readReport(): PocReport {
  try {
    const raw = fs.readFileSync(REPORT_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<PocReport>;
    if (parsed && parsed.schema_version === 1 && parsed.results && typeof parsed.results === 'object') {
      return { schema_version: 1, last_updated: parsed.last_updated ?? '', results: parsed.results };
    }
  } catch {
    // File missing or malformed — we'll initialize a fresh one.
  }
  return { schema_version: 1, last_updated: '', results: {} };
}

export function recordPocResult(key: string, value: unknown): void {
  const report = readReport();
  report.results[key] = value;
  report.last_updated = new Date().toISOString();
  try {
    fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n', 'utf-8');
  } catch (err) {
    // Don't fail the POC just because we can't persist — log so CI still
    // has the data on stdout.
    console.warn(`[poc-record] failed to write ${REPORT_PATH}:`, err);
  }
}
