/**
 * Unit tests for the file checkpoint system.
 *
 * Run with: npx tsx --test src/__tests__/unit/file-checkpoint.test.ts
 *
 * Tests verify that:
 * 1. createCheckpoint + restoreCheckpoint correctly reverts file modifications
 * 2. Newly created files after a checkpoint are deleted on restore
 * 3. Multiple checkpoints allow restoring to a specific point in time
 * 4. Restoring an unknown session returns an empty array
 * 5. clearCheckpoints removes all checkpoint data for a session
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {
  createCheckpoint,
  recordFileModification,
  restoreCheckpoint,
  clearCheckpoints,
} from '@/lib/file-checkpoint';

describe('createCheckpoint + restoreCheckpoint', () => {
  let tmpDir: string;
  const sessionId = `test-session-${Date.now()}`;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-checkpoint-'));
  });

  // Cleanup helper — called manually at end of each test since node:test
  // beforeEach/afterEach don't share mutable state across describe blocks easily.
  function cleanup() {
    try {
      clearCheckpoints(sessionId);
    } catch {
      // ignore
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }

  it('restores a modified file to its original content', () => {
    try {
      const filePath = path.join(tmpDir, 'hello.txt');
      fs.writeFileSync(filePath, 'original');

      createCheckpoint(sessionId, 'msg1', tmpDir);
      recordFileModification(sessionId, 'hello.txt', tmpDir);

      // Overwrite the file
      fs.writeFileSync(filePath, 'modified');
      assert.equal(fs.readFileSync(filePath, 'utf-8'), 'modified');

      // Restore checkpoint
      const restored = restoreCheckpoint(sessionId, 'msg1', tmpDir);
      assert.deepEqual(restored, ['hello.txt']);
      assert.equal(fs.readFileSync(filePath, 'utf-8'), 'original');
    } finally {
      cleanup();
    }
  });

  it('deletes files that were newly created after checkpoint', () => {
    try {
      createCheckpoint(sessionId, 'msg1', tmpDir);
      recordFileModification(sessionId, 'new.txt', tmpDir);

      // Create a new file after the checkpoint
      const filePath = path.join(tmpDir, 'new.txt');
      fs.writeFileSync(filePath, 'new content');
      assert.equal(fs.existsSync(filePath), true);

      // Restore — new.txt should be deleted since it didn't exist at checkpoint time
      restoreCheckpoint(sessionId, 'msg1', tmpDir);
      assert.equal(fs.existsSync(filePath), false);
    } finally {
      cleanup();
    }
  });

  it('handles multiple checkpoints and restores to specific point', () => {
    try {
      const fileA = path.join(tmpDir, 'a.txt');
      const fileB = path.join(tmpDir, 'b.txt');

      fs.writeFileSync(fileA, 'A-original');
      fs.writeFileSync(fileB, 'B-original');

      // First checkpoint — both files at original state
      createCheckpoint(sessionId, 'msg1', tmpDir);
      recordFileModification(sessionId, 'a.txt', tmpDir);

      // Modify file A
      fs.writeFileSync(fileA, 'A-modified-1');

      // Second checkpoint — A is modified, B is still original
      createCheckpoint(sessionId, 'msg2', tmpDir);
      recordFileModification(sessionId, 'b.txt', tmpDir);

      // Modify file B
      fs.writeFileSync(fileB, 'B-modified');

      // Restore to msg1 — both A and B should be reverted to their original state
      const restored = restoreCheckpoint(sessionId, 'msg1', tmpDir);
      assert.equal(fs.readFileSync(fileA, 'utf-8'), 'A-original');
      assert.equal(fs.readFileSync(fileB, 'utf-8'), 'B-original');
      // Both files should appear in the restored list
      assert.ok(restored.includes('a.txt'));
      assert.ok(restored.includes('b.txt'));
    } finally {
      cleanup();
    }
  });

  it('returns empty array when no checkpoint exists', () => {
    try {
      const result = restoreCheckpoint('nonexistent-session', 'msg-unknown', tmpDir);
      assert.deepEqual(result, []);
    } finally {
      cleanup();
    }
  });

  it('clearCheckpoints removes all checkpoints for session', () => {
    try {
      const filePath = path.join(tmpDir, 'hello.txt');
      fs.writeFileSync(filePath, 'original');

      createCheckpoint(sessionId, 'msg1', tmpDir);
      recordFileModification(sessionId, 'hello.txt', tmpDir);
      fs.writeFileSync(filePath, 'modified');

      // Clear all checkpoints for this session
      clearCheckpoints(sessionId);

      // Now restoring should return empty since checkpoints were cleared
      const result = restoreCheckpoint(sessionId, 'msg1', tmpDir);
      assert.deepEqual(result, []);

      // File should remain in its modified state (not restored)
      assert.equal(fs.readFileSync(filePath, 'utf-8'), 'modified');
    } finally {
      cleanup();
    }
  });
});
