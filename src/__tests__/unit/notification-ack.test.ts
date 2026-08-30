/**
 * Phase 3 Step 3 — `notification_deliveries` UPSERT contract (v5 plan).
 *
 * Asserts:
 *   1. Basic UPSERT: queued → delivered keeps row count at 1.
 *   2. Multi-channel under one event: each channel has its own row;
 *      ack on channel A doesn't change channel B's status.
 *   3. Repeat ack idempotency: posting the same `(event_id, channel,
 *      delivered)` twice still leaves exactly 1 row in `delivered`.
 *   4. Illegal state transitions are rejected:
 *        - delivered → error
 *        - error → delivered
 *      Both should leave the row's status unchanged. The helper
 *      returns `false` to signal the rejection.
 *   5. The `UNIQUE(event_id, channel)` SQL constraint exists in the
 *      schema — even a buggy bare INSERT would fail at the DB layer.
 */

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

let tempDir: string;
let originalDataDir: string | undefined;

before(() => {
  originalDataDir = process.env.CLAUDE_GUI_DATA_DIR;
});

after(() => {
  if (originalDataDir === undefined) {
    delete process.env.CLAUDE_GUI_DATA_DIR;
  } else {
    process.env.CLAUDE_GUI_DATA_DIR = originalDataDir;
  }
});

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-ack-test-'));
  process.env.CLAUDE_GUI_DATA_DIR = tempDir;
});

afterEach(async () => {
  try {
    const { closeDb } = await import('../../lib/db');
    closeDb();
  } catch { /* ignore */ }
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch { /* ignore */ }
});

// Unique per call: the better-sqlite3 module's DB_PATH is computed at
// import time, so subsequent tests in this file share the same DB
// despite per-test temp dirs. Generating fresh event_ids avoids the
// `UNIQUE(event_id)` collision that comes with reusing a literal.
let eventCounter = 0;

async function setupEvent(): Promise<{
  event_id: string;
  insertNotificationEvent: typeof import('../../lib/db').insertNotificationEvent;
  upsertNotificationDelivery: typeof import('../../lib/db').upsertNotificationDelivery;
  listNotificationDeliveries: typeof import('../../lib/db').listNotificationDeliveries;
  getDb: typeof import('../../lib/db').getDb;
}> {
  const db = await import('../../lib/db');
  eventCounter += 1;
  const event_id = `evt-test-${Date.now()}-${eventCounter}`;
  db.insertNotificationEvent({
    event_id,
    task_id: null,
    session_id: null,
    source: 'codepilot',
    title: 'Test',
    body: 'Body',
    priority: 'urgent',
  });
  return {
    event_id,
    insertNotificationEvent: db.insertNotificationEvent,
    upsertNotificationDelivery: db.upsertNotificationDelivery,
    listNotificationDeliveries: db.listNotificationDeliveries,
    getDb: db.getDb,
  };
}

describe('notification_deliveries UPSERT (Phase 3 Step 3 v5)', () => {
  it('queued → delivered keeps the row count at 1', async () => {
    const { event_id, upsertNotificationDelivery, listNotificationDeliveries } = await setupEvent();
    upsertNotificationDelivery({ event_id, channel: 'renderer-toast', status: 'queued' });
    upsertNotificationDelivery({ event_id, channel: 'renderer-toast', status: 'delivered' });
    const rows = listNotificationDeliveries(event_id).filter((r) => r.channel === 'renderer-toast');
    assert.equal(rows.length, 1, 'ack must UPDATE the existing row, not INSERT a duplicate');
    assert.equal(rows[0].status, 'delivered');
    assert.ok(rows[0].acked_at, 'delivered transition must stamp acked_at');
  });

  it('multi-channel acks do not interfere across channels', async () => {
    const { event_id, upsertNotificationDelivery, listNotificationDeliveries } = await setupEvent();
    upsertNotificationDelivery({ event_id, channel: 'renderer-toast', status: 'queued' });
    upsertNotificationDelivery({ event_id, channel: 'electron-native', status: 'queued' });
    upsertNotificationDelivery({ event_id, channel: 'bridge-telegram', status: 'queued' });

    upsertNotificationDelivery({ event_id, channel: 'electron-native', status: 'delivered' });

    const rows = listNotificationDeliveries(event_id);
    assert.equal(rows.length, 3, '3 channels = 3 delivery rows under one event_id');
    const byChannel = Object.fromEntries(rows.map((r) => [r.channel, r.status]));
    assert.equal(byChannel['renderer-toast'], 'queued', 'renderer-toast still queued');
    assert.equal(byChannel['electron-native'], 'delivered');
    assert.equal(byChannel['bridge-telegram'], 'queued');
  });

  it('repeat ack on the same (event_id, channel) is idempotent', async () => {
    const { event_id, upsertNotificationDelivery, listNotificationDeliveries } = await setupEvent();
    upsertNotificationDelivery({ event_id, channel: 'electron-native', status: 'queued' });
    upsertNotificationDelivery({ event_id, channel: 'electron-native', status: 'delivered' });
    upsertNotificationDelivery({ event_id, channel: 'electron-native', status: 'delivered' });
    upsertNotificationDelivery({ event_id, channel: 'electron-native', status: 'delivered' });
    const rows = listNotificationDeliveries(event_id).filter((r) => r.channel === 'electron-native');
    assert.equal(rows.length, 1, 'duplicate acks must not create duplicate rows (v5 idempotency)');
    assert.equal(rows[0].status, 'delivered');
  });

  it('rejects illegal terminal-state transitions (delivered ↔ error)', async () => {
    const { event_id, upsertNotificationDelivery, listNotificationDeliveries } = await setupEvent();
    upsertNotificationDelivery({ event_id, channel: 'bridge-telegram', status: 'queued' });
    upsertNotificationDelivery({ event_id, channel: 'bridge-telegram', status: 'delivered' });

    const rejectedToError = upsertNotificationDelivery({
      event_id,
      channel: 'bridge-telegram',
      status: 'error',
      error: 'late retry that should not flip success',
    });
    assert.equal(rejectedToError, false, 'delivered → error must be rejected by the state guard');

    const rows = listNotificationDeliveries(event_id).filter((r) => r.channel === 'bridge-telegram');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'delivered', 'guard must leave the row in delivered');

    // Same in reverse: error → delivered should also be rejected.
    upsertNotificationDelivery({ event_id, channel: 'renderer-toast', status: 'queued' });
    upsertNotificationDelivery({ event_id, channel: 'renderer-toast', status: 'error', error: 'failed' });
    const rejectedToDelivered = upsertNotificationDelivery({
      event_id,
      channel: 'renderer-toast',
      status: 'delivered',
    });
    assert.equal(rejectedToDelivered, false, 'error → delivered must be rejected too');
  });

  it('schema enforces UNIQUE(event_id, channel)', async () => {
    const { event_id, upsertNotificationDelivery, getDb } = await setupEvent();
    upsertNotificationDelivery({ event_id, channel: 'renderer-toast', status: 'queued' });
    // A buggy bare INSERT must fail at the SQL layer thanks to the
    // UNIQUE constraint, regardless of whether the application-layer
    // helper protects.
    const handle = getDb();
    let rejected = false;
    try {
      handle
        .prepare(
          'INSERT INTO notification_deliveries (id, event_id, channel, status) VALUES (?, ?, ?, ?)',
        )
        .run('dup-id', event_id, 'renderer-toast', 'queued');
    } catch {
      rejected = true;
    }
    assert.equal(rejected, true, 'duplicate INSERT must violate UNIQUE(event_id, channel)');
  });
});
