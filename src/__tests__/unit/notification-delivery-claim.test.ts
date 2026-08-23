import '../db-isolation.setup';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let tempDir: string;
let originalDataDir: string | undefined;
let db: typeof import('../../lib/db');
let counter = 0;

before(async () => {
  originalDataDir = process.env.CLAUDE_GUI_DATA_DIR;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-notify-claim-'));
  process.env.CLAUDE_GUI_DATA_DIR = tempDir;
  db = await import('../../lib/db');
});

after(() => {
  db?.closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.CLAUDE_GUI_DATA_DIR;
  else process.env.CLAUDE_GUI_DATA_DIR = originalDataDir;
});

function queued(channel = 'electron-native'): string {
  const event_id = `evt-claim-${Date.now()}-${counter += 1}`;
  db.insertNotificationEvent({
    event_id,
    task_id: null,
    session_id: null,
    source: 'codepilot',
    title: 'Claim test',
    body: 'Body',
    priority: channel === 'renderer-toast' ? 'low' : 'normal',
  });
  db.upsertNotificationDelivery({ event_id, channel, status: 'queued' });
  return event_id;
}

describe('durable notification delivery claims', () => {
  it('gives one queued row to at most one live owner', () => {
    queued();
    const now = new Date('2026-08-03T10:00:00.000Z');
    const first = db.claimNotificationDelivery({ channel: 'electron-native', owner: 'owner-a', now });
    const second = db.claimNotificationDelivery({ channel: 'electron-native', owner: 'owner-b', now });
    assert.ok(first);
    assert.equal(second, null);
    assert.equal(first!.attempt_count, 1);
    db.settleClaimedNotificationDelivery({
      deliveryId: first!.delivery_id,
      owner: 'owner-a',
      outcome: 'delivered',
      now,
    });
  });

  it('reclaims a stale lease and rejects a stale owner ack', () => {
    queued();
    const firstAt = new Date('2026-08-03T11:00:00.000Z');
    const first = db.claimNotificationDelivery({ channel: 'electron-native', owner: 'owner-old', now: firstAt });
    assert.ok(first);
    const second = db.claimNotificationDelivery({
      channel: 'electron-native',
      owner: 'owner-new',
      now: new Date(firstAt.getTime() + 31_000),
      staleAfterMs: 30_000,
    });
    assert.equal(second?.delivery_id, first?.delivery_id);
    assert.equal(second?.attempt_count, 2);
    assert.deepEqual(
      db.settleClaimedNotificationDelivery({
        deliveryId: first!.delivery_id,
        owner: 'owner-old',
        outcome: 'delivered',
      }),
      { written: false, status: 'queued' },
    );
    db.settleClaimedNotificationDelivery({
      deliveryId: second!.delivery_id,
      owner: 'owner-new',
      outcome: 'delivered',
      now: new Date(firstAt.getTime() + 31_000),
    });
  });

  it('keeps retryable failures queued with backoff, then reaches terminal error', () => {
    queued();
    const at = new Date('2026-08-03T12:00:00.000Z');
    const first = db.claimNotificationDelivery({ channel: 'electron-native', owner: 'retry-owner', now: at });
    const retry = db.settleClaimedNotificationDelivery({
      deliveryId: first!.delivery_id,
      owner: 'retry-owner',
      outcome: 'error',
      error: 'temporary',
      retryable: true,
      now: at,
      maxAttempts: 2,
    });
    assert.deepEqual(retry, { written: true, status: 'queued' });
    assert.equal(
      db.claimNotificationDelivery({ channel: 'electron-native', owner: 'too-early', now: at }),
      null,
    );
    const secondAt = new Date(at.getTime() + 2_001);
    const second = db.claimNotificationDelivery({
      channel: 'electron-native',
      owner: 'retry-owner-2',
      now: secondAt,
    });
    assert.equal(second?.delivery_id, first?.delivery_id);
    assert.deepEqual(
      db.settleClaimedNotificationDelivery({
        deliveryId: second!.delivery_id,
        owner: 'retry-owner-2',
        outcome: 'error',
        error: 'still broken',
        retryable: true,
        now: secondAt,
        maxAttempts: 2,
      }),
      { written: true, status: 'error' },
    );
  });

  it('delivered is terminal and restart-safe', () => {
    const eventId = queued('renderer-toast');
    const claim = db.claimNotificationDelivery({ channel: 'renderer-toast', owner: 'renderer-a' });
    assert.ok(claim);
    assert.deepEqual(
      db.settleClaimedNotificationDelivery({
        deliveryId: claim!.delivery_id,
        owner: 'renderer-a',
        outcome: 'delivered',
      }),
      { written: true, status: 'delivered' },
    );
    assert.equal(db.claimNotificationDelivery({ channel: 'renderer-toast', owner: 'renderer-b' }), null);
    assert.equal(db.listNotificationDeliveries(eventId)[0].status, 'delivered');
  });

  it('new lease columns preserve legacy insert defaults', () => {
    const columns = db.getDb().prepare('PRAGMA table_info(notification_deliveries)').all() as Array<{ name: string }>;
    for (const name of ['claim_owner', 'claimed_at', 'attempt_count', 'last_attempt_at', 'next_attempt_at']) {
      assert.ok(columns.some((column) => column.name === name), `missing migration column ${name}`);
    }
    const eventId = queued();
    const row = db.getDb().prepare(`
      SELECT claim_owner, claimed_at, attempt_count, last_attempt_at, next_attempt_at
      FROM notification_deliveries WHERE event_id = ?
    `).get(eventId) as Record<string, unknown>;
    assert.equal(row.claim_owner, null);
    assert.equal(row.claimed_at, null);
    assert.equal(row.attempt_count, 0);
    assert.equal(row.last_attempt_at, null);
    assert.equal(row.next_attempt_at, null);
  });

  it('skips stale pre-durable backlog once without deleting its audit trail', () => {
    const oldEventId = queued('renderer-toast');
    const recentEventId = queued('renderer-toast');
    const sql = db.getDb();
    sql.prepare("DELETE FROM settings WHERE key = 'notification_delivery_legacy_backlog_v1'").run();
    sql.prepare("UPDATE notification_deliveries SET created_at = ? WHERE event_id = ?")
      .run('2026-08-03T08:00:00.000Z', oldEventId);
    sql.prepare("UPDATE notification_deliveries SET created_at = ? WHERE event_id = ?")
      .run('2026-08-03T09:30:00.000Z', recentEventId);

    assert.equal(
      db.suppressLegacyQueuedNotificationBacklog(sql, new Date('2026-08-03T10:00:00.000Z')),
      1,
    );
    const oldDelivery = db.listNotificationDeliveries(oldEventId)[0];
    const recentDelivery = db.listNotificationDeliveries(recentEventId)[0];
    assert.equal(oldDelivery.status, 'skipped');
    assert.equal(oldDelivery.error, 'legacy_backlog_suppressed');
    assert.ok(oldDelivery.acked_at);
    assert.equal(recentDelivery.status, 'queued');
    assert.ok(db.getNotificationEvent(oldEventId), 'migration must preserve the historical event');

    assert.equal(
      db.suppressLegacyQueuedNotificationBacklog(sql, new Date('2026-08-04T10:00:00.000Z')),
      0,
      'the migration marker must make subsequent starts a no-op',
    );
    assert.equal(db.listNotificationDeliveries(recentEventId)[0].status, 'queued');
  });
});
