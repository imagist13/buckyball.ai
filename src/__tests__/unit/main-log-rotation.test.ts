/**
 * B-025: the persistent main log must rotate by size instead of appending
 * forever (a user hit 12.5 GB). Real-fs temp-dir tests.
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rotateLogFiles, createRotatingLogWriter } from '../../lib/logging/main-log-rotation';

const tmpDirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'b025-rot-'));
  tmpDirs.push(d);
  return d;
}
// createRotatingLogWriter now writes synchronously (openSync/writeSync), so file
// content is on disk the instant we read it — these tests exercise the REAL
// writer against real files, not a fake stream (B-025 review finding).
after(() => {
  for (const d of tmpDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe('createRotatingLogWriter (B-025 size-based rotation)', () => {
  it('rotates a leftover over-cap active file before the session marker is written', () => {
    const dir = tmp();
    const active = path.join(dir, 'codepilot-main.log');
    fs.writeFileSync(active, 'X'.repeat(2000)); // already over a 1000-byte cap
    const writer = createRotatingLogWriter({ activeLogFile: active, maxBytes: 1000, maxArchives: 5 });
    writer.write('=== session start (sanitized) ===\n');
    writer.end();
    assert.ok(fs.existsSync(`${active}.1`), 'the over-cap leftover should be archived to .1');
    assert.equal(fs.readFileSync(`${active}.1`, 'utf8').length, 2000);
    const fresh = fs.readFileSync(active, 'utf8');
    assert.ok(
      fresh.startsWith('=== session start'),
      `the new session must land in a fresh file, got: ${fresh.slice(0, 40)}`,
    );
  });

  it('rotates mid-stream once the active file exceeds the cap, keeping the active file bounded', () => {
    const dir = tmp();
    const active = path.join(dir, 'codepilot-main.log');
    const writer = createRotatingLogWriter({ activeLogFile: active, maxBytes: 500, maxArchives: 3 });
    for (let i = 0; i < 100; i++) writer.write('y'.repeat(100) + '\n'); // 101 bytes each
    writer.end();
    assert.ok(fs.existsSync(`${active}.1`), 'should have rotated at least once');
    assert.ok(fs.statSync(active).size <= 500 + 101, 'active file must stay near the cap, not grow unbounded');
  });
});

describe('rotateLogFiles (B-025 archive ring)', () => {
  it('shifts archives and drops the oldest beyond maxArchives', () => {
    const dir = tmp();
    const active = path.join(dir, 'app.log');
    fs.writeFileSync(active, 'active');
    fs.writeFileSync(`${active}.1`, 'a1');
    fs.writeFileSync(`${active}.2`, 'a2');
    rotateLogFiles(active, 2); // maxArchives=2 → .2 dropped, .1→.2, active→.1
    assert.equal(fs.readFileSync(`${active}.1`, 'utf8'), 'active');
    assert.equal(fs.readFileSync(`${active}.2`, 'utf8'), 'a1');
    assert.ok(!fs.existsSync(`${active}.3`), 'must not keep more than maxArchives');
    assert.ok(!fs.existsSync(active), 'active was rotated away');
  });
});
