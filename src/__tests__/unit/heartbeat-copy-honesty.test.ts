/**
 * v10 → v13 — Phase 3 IA closure: Settings → Assistant 心跳文案诚实化.
 *
 * History:
 *   v10 (the rev this file used to defend) said heartbeat is "not a
 *   background timer" and "fires when you start a new chat in the
 *   assistant workspace". That was true at the time: heartbeat
 *   ran via the foreground useAssistantTrigger autoTrigger path.
 *
 *   v13 (Phase 3 Step 4 follow-up) moved heartbeat to the background
 *   scheduler-only path: useAssistantTrigger no longer fires it,
 *   /api/settings/workspace no longer returns needsHeartbeat, the
 *   stale-check guard runs against (now - last_run >= interval).
 *   Heartbeat IS a background timer now, scoped to the user's
 *   configured cadence.
 *
 *   Keeping the v10 copy after v13 makes /settings/assistant lie
 *   about how the toggle works — users who saw the previous
 *   "opening a page kicks off heartbeat" behaviour wouldn't know
 *   it had been removed.
 *
 * What this file pins (post-v13):
 *   1. zh + en `heartbeatDesc` describe the new background-timer
 *      reality: "runs automatically in the background at your
 *      configured interval" / "按你设定的频率由后台自动检查".
 *   2. The silent / speak-up contract is preserved (HEARTBEAT_OK
 *      vs writes-into-session) — that part hasn't changed.
 *   3. The OLD v10 strings are explicitly forbidden — "不是后台
 *      定时任务" / "not a background timer" / "新对话" /
 *      "new chat" / "助理工作区" / "assistant workspace" — so a
 *      future "tighten the description" PR can't drift back to
 *      the now-incorrect v10 wording.
 *   4. Title key unchanged — "heartbeat" is still a fine name; the
 *      change is mechanism description only.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ZH = readFileSync(
  path.resolve(__dirname, '../../i18n/zh.ts'),
  'utf-8',
);
const EN = readFileSync(
  path.resolve(__dirname, '../../i18n/en.ts'),
  'utf-8',
);

function extractValue(src: string, key: string): string {
  // Grab the single-quoted value of the key on its line. The i18n
  // bundles are flat key→string objects, so this is robust enough.
  const re = new RegExp(`'${key.replace(/\./g, '\\.')}':\\s*'((?:[^'\\\\]|\\\\.)*)'`);
  const m = src.match(re);
  if (!m) {
    throw new Error(`could not find i18n key '${key}' in bundle`);
  }
  return m[1];
}

describe('heartbeat description must reflect the post-v13 background-scheduler reality', () => {
  it('zh.ts: heartbeatDesc states heartbeat runs in the background on a schedule', () => {
    const zhDesc = extractValue(ZH, 'assistant.heartbeatDesc');
    assert.match(
      zhDesc,
      /后台/,
      'zh assistant.heartbeatDesc must say "后台" — Phase 3 Step 4 made heartbeat a background scheduler-driven check, and the description must match what the toggle actually does.',
    );
    // Must reference cadence (frequency / interval) so the user knows
    // there's a knob in /settings/assistant for it.
    assert.match(
      zhDesc,
      /频率|间隔/,
      'zh assistant.heartbeatDesc must reference 频率 or 间隔 so users link the description to the heartbeatIntervalHours selector below.',
    );
  });

  it('en.ts: heartbeatDesc states heartbeat runs in the background on a schedule', () => {
    const enDesc = extractValue(EN, 'assistant.heartbeatDesc');
    assert.match(
      enDesc,
      /background/i,
      'en assistant.heartbeatDesc must say "background" — heartbeat is a background scheduler-driven check now and the copy must say so.',
    );
    assert.match(
      enDesc,
      /interval|cadence|frequency/i,
      'en assistant.heartbeatDesc must reference interval / cadence / frequency so users connect it to the heartbeatIntervalHours selector below.',
    );
  });

  it('zh.ts: heartbeatDesc retains the silent / speak-up semantics', () => {
    // The whole point of heartbeat is: silent if nothing to report,
    // speaks up if there is. v13 changes how it fires; the OUTCOME
    // description must NOT regress.
    const zhDesc = extractValue(ZH, 'assistant.heartbeatDesc');
    assert.match(
      zhDesc,
      /HEARTBEAT_OK|静默/,
      'zh assistant.heartbeatDesc must keep the "stays silent / HEARTBEAT_OK" half so users know what enabled-and-quiet looks like.',
    );
    assert.match(
      zhDesc,
      /(?:写入|告知|通知|关注)/,
      'zh assistant.heartbeatDesc must keep the speak-up half — "writes into the session / sends a notification / something needs attention".',
    );
  });

  it('en.ts: heartbeatDesc retains the silent / speak-up semantics', () => {
    const enDesc = extractValue(EN, 'assistant.heartbeatDesc');
    assert.match(
      enDesc,
      /HEARTBEAT_OK|stays silent/i,
      'en assistant.heartbeatDesc must keep the "stays silent / HEARTBEAT_OK" half.',
    );
    assert.match(
      enDesc,
      /writes|notifies|notify|speaks up|needs attention/i,
      'en assistant.heartbeatDesc must keep the speak-up half.',
    );
  });

  // ─ Negative pins on the OLD v10 wording ─────────────────────────
  it('zh.ts: heartbeatDesc must NOT keep the old "不是后台定时任务" claim', () => {
    const zhDesc = extractValue(ZH, 'assistant.heartbeatDesc');
    assert.doesNotMatch(
      zhDesc,
      /不是后台定时任务/,
      'zh assistant.heartbeatDesc must not contain "不是后台定时任务" — that claim was true under v10 (foreground autoTrigger) but became a lie after Phase 3 Step 4 moved heartbeat to the background scheduler. Keeping it would mislead users into thinking the old "open page → heartbeat fires" behavior is still around.',
    );
  });

  it('zh.ts: heartbeatDesc must NOT pin the old "新对话" / "助理工作区" trigger story', () => {
    const zhDesc = extractValue(ZH, 'assistant.heartbeatDesc');
    assert.doesNotMatch(
      zhDesc,
      /新对话/,
      'zh assistant.heartbeatDesc must not say heartbeat fires on opening "新对话" — that path was deleted from useAssistantTrigger in Phase 3 Step 4.',
    );
    assert.doesNotMatch(
      zhDesc,
      /助理工作区.*触发|开始.*对话.*触发/,
      'zh assistant.heartbeatDesc must not phrase the trigger as "在助理工作区开始新对话时触发" — heartbeat trigger no longer depends on opening any chat.',
    );
  });

  it('en.ts: heartbeatDesc must NOT keep the old "not a background timer" claim', () => {
    const enDesc = extractValue(EN, 'assistant.heartbeatDesc');
    assert.doesNotMatch(
      enDesc,
      /not a background timer/i,
      'en assistant.heartbeatDesc must not say "not a background timer" — Phase 3 Step 4 made heartbeat exactly that. Keeping the v10 negation would directly contradict the new mechanism and confuse users about what enabling the toggle does.',
    );
  });

  it('en.ts: heartbeatDesc must NOT pin the old "new chat" / "assistant workspace" trigger story', () => {
    const enDesc = extractValue(EN, 'assistant.heartbeatDesc');
    assert.doesNotMatch(
      enDesc,
      /new chat/i,
      'en assistant.heartbeatDesc must not reference "new chat" as the trigger — that fired path is gone (useAssistantTrigger no longer starts heartbeat).',
    );
    assert.doesNotMatch(
      enDesc,
      /(?:starts?|fires?|triggers?)\s+when\s+you\s+(?:start|open).*(?:chat|workspace)/i,
      'en assistant.heartbeatDesc must not phrase the trigger as "fires when you start a new chat in the assistant workspace" — heartbeat trigger no longer depends on opening any chat.',
    );
  });

  it('the title key is unchanged — only the description was rewritten', () => {
    // Sanity guard: this is a description-only fix. A future PR that
    // wants to rename "heartbeat" itself needs to update this test
    // and re-justify the rename.
    assert.match(
      ZH,
      /'assistant\.heartbeatTitle':\s*'心跳检测'/,
      'zh assistant.heartbeatTitle should remain "心跳检测" — v13 is a description-only fix.',
    );
    assert.match(
      EN,
      /'assistant\.heartbeatTitle':\s*'Heartbeat'/,
      'en assistant.heartbeatTitle should remain "Heartbeat" — v13 is a description-only fix.',
    );
  });
});
