/**
 * composer-first-message-clear.test.ts — #4/#5 (v0.56.x Phase 2).
 *
 * Bug (reproduced via CDP): in the FIRST-message flow, the composer text lingers
 * in the box through the entire streaming turn ("content sent but text still
 * there"). Basic + image sends in ChatView clear fine; only the first message
 * doesn't.
 *
 * Root cause (CDP-instrumented): at send-accept page.tsx flips `isStreaming`,
 * which switches the hero→active layout branch and REMOUNTS the composer (the
 * keyed MessageInput identity doesn't survive the branch switch — instrumentation
 * showed ComposerResetSignal mounts++ with the new nonce already set, so any
 * in-component "clear on signal change" guard early-returns). The remount already
 * resets attachments / badges / directory refs; the ONE piece of composer state
 * that survives it is the persisted `sessionStorage` draft, which the remounted
 * MessageInput re-seeds `inputValue` from — so the just-sent text reappears.
 *
 * Fix: page.tsx clears the draft (`composerDraftKey()`) at accept, so the
 * remounted composer comes up empty. Source-pins (React-coupled).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (rel: string) => readFileSync(path.resolve(__dirname, '../..', rel), 'utf8');

describe('first-message composer clears at accept (#4/#5)', () => {
  it('MessageInput exports composerDraftKey and uses it for its draft bucket', () => {
    const src = read('components/chat/MessageInput.tsx');
    assert.match(
      src,
      /export const composerDraftKey = \(sessionId\?: string\): string =>\s*`codepilot:draft:\$\{sessionId \|\| 'new'\}`/,
      'composerDraftKey must be the single source of the draft sessionStorage key',
    );
    assert.match(
      src,
      /const draftKey = composerDraftKey\(sessionId\)/,
      'MessageInput must derive its draftKey from composerDraftKey (no re-hardcoded format)',
    );
  });

  it('page.tsx clears the persisted draft at accept (so the remounted composer is empty)', () => {
    const src = read('app/chat/page.tsx');
    assert.match(src, /import \{ MessageInput, composerDraftKey \} from '@\/components\/chat\/MessageInput'/);
    // the clear must sit right at/after `accepted = true` (the committed point),
    // BEFORE the stream loop / redirect — clearing late is the original bug.
    assert.match(
      src,
      /accepted = true;[\s\S]{0,600}sessionStorage\.removeItem\(composerDraftKey\(\)\)/,
      'the draft must be cleared immediately after accepted = true',
    );
  });

  it('the defeated ComposerResetSignal nonce mechanism is gone', () => {
    // It could never fire — the accept-time remount re-initialised its
    // last-seen-nonce ref to the new value (CDP: fires=0). Guard against it
    // being reintroduced as a "fix" that silently does nothing.
    const partsSrc = read('components/chat/MessageInputParts.tsx');
    assert.doesNotMatch(partsSrc, /ComposerResetSignal/);
    const pageSrc = read('app/chat/page.tsx');
    assert.doesNotMatch(pageSrc, /composerResetNonce|resetSignal=/);
  });

  it('page.tsx also clears the URL prefill at accept (Codex P2 — initialValue outranks the draft)', () => {
    // The first-message composer remount re-reads initialValue (= URL prefill)
    // BEFORE the draft, so the draft-clear alone leaves a prefill-sourced text
    // re-seeding. Track + zero the consumed prefill so the remount comes up empty.
    const src = read('app/chat/page.tsx');
    assert.match(src, /const \[consumedPrefill, setConsumedPrefill\] = useState/);
    assert.match(
      src,
      /const effectivePrefill = prefillText && prefillText !== consumedPrefill \? prefillText : ''/,
      'effectivePrefill must blank out an already-sent prefill while still showing a new one',
    );
    assert.match(src, /if \(prefillTextRef\.current\) setConsumedPrefill\(prefillTextRef\.current\)/, 'accept must mark the CURRENT prefill consumed');
    assert.match(src, /initialValue=\{effectivePrefill\}/);
    assert.doesNotMatch(src, /initialValue=\{prefillText\}/);
  });

  it('BOTH send paths clear the composer OPTIMISTICALLY, with a guarded restore (P2/P3)', () => {
    // THE actual lingering-text fix. The single stable-keyed composer no longer
    // remounts at the isStreaming flip (#615 — see the "Single composer stack"
    // note in page.tsx), and sendFirstMessage doesn't resolve until the whole
    // stream ends — so the old post-await `setInputValue('')` left the sent text
    // in the box for the entire turn. handleSend now clears before `await onSend`
    // (matching ChatView's accept-time clear) and restores only when the send is
    // gated. Codex P2: the badge (skill/slash) path needed the same treatment.
    const src = read('components/chat/MessageInput.tsx');
    const count = (re: RegExp) => (src.match(re) ?? []).length;
    // Both the normal AND badge paths clear before awaiting onSend.
    assert.ok(
      count(/setInputValue\(''\);[\s\S]{0,90}const delivered = await onSend\(/g) >= 2,
      'both send paths (normal + badge) must clear the composer BEFORE awaiting onSend',
    );
    // cliBadge is cleared optimistically too (before the await), not post-stream (P3a).
    assert.match(
      src,
      /if \(cliBadge\) setCliBadge\(null\);\s+const delivered = await onSend\(/,
      'cliBadge must be cleared BEFORE awaiting onSend (send-immediately, not post-stream)',
    );
    // Restores read the LIVE value (functional updater / ref) so a gated send
    // never clobbers a new message the user started during the failure window (P3).
    assert.ok(
      count(/setInputValue\(\(cur\) => \(cur \? cur : restoreInput\)\)/g) >= 2,
      'each gated restore must use a functional updater (do not clobber new input)',
    );
    assert.match(
      src,
      /if \(restoreCli && !cliBadgeRef\.current\) setCliBadge\(restoreCli\)/,
      'cliBadge restore must be guarded by the live ref (P3a)',
    );
    assert.match(
      src,
      /if \(badgesRef\.current\.length === 0\) restoreBadges\.forEach\(\(b\) => addBadgeWithOrder\(b\)\)/,
      'badge re-add must be guarded by the live ref so a newly-picked badge survives (P3b)',
    );
    assert.doesNotMatch(
      src,
      /if \(delivered === false\) \{\s*setInputValue\(restoreInput\)/,
      'must not restore unconditionally (that would clobber a newly-typed message)',
    );
  });

  it('the prefill consume reads a live ref, not a stale send-closure (Codex P2 warm-nav)', () => {
    // Warm navigation (/chat already mounted → router.push /chat?prefill=abc)
    // changes prefillText WITHOUT recreating the stable sendFirstMessage
    // useCallback (prefillText is deliberately not in its deps; adding it would
    // churn identity and cascade through handleCommand). If accept read
    // prefillText from the callback closure it would see the OLD value (often
    // '') and never consume the new prefill, so the accept-time remount
    // re-seeded the just-sent text. Fix: a ref synced to the live prefill,
    // read at accept.
    const src = read('app/chat/page.tsx');
    assert.match(src, /const prefillTextRef = useRef\(prefillText\)/, 'must hold a ref to the prefill');
    assert.match(src, /prefillTextRef\.current = prefillText/, 'the ref must track the LIVE url prefill every render');
    assert.match(src, /setConsumedPrefill\(prefillTextRef\.current\)/, 'accept must consume via the live ref');
    assert.doesNotMatch(
      src,
      /if \(prefillText\) setConsumedPrefill\(prefillText\)/,
      'must not read the stale closure prefillText',
    );
  });
});
