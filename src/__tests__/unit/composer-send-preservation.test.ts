/**
 * #615 — screenshots eaten on a no-op send. Generalizes the run-checkpoint
 * preservation contract: the composer must keep the user's text + attachments
 * whenever a submit is NOT actually delivered, not just on the checkpoint block.
 *
 * Two halves:
 *   1. MessageInput routes EVERY file-carrying no-send branch through
 *      abortComposerSubmit() (which throws → PromptInput's reject branch keeps
 *      text/files) instead of a bare `return` (which resolves → PromptInput
 *      clears). The normal + badge sends now AWAIT onSend and abort when it
 *      reports the send was gated.
 *   2. The onSend providers (ChatView.sendMessage for subsequent messages,
 *      page.tsx sendFirstMessage for the first) RETURN false on every
 *      provider/runtime gate, so MessageInput can tell a gated send from a real
 *      one. Before this, onSend was `void` and those gates fired *after*
 *      MessageInput had already let PromptInput clear the screenshot.
 *
 * Source-level pins (the send path is React-coupled; no renderer here). They
 * also guard against a future no-send branch being written as a bare `return`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (rel: string) => readFileSync(path.resolve(__dirname, '../..', rel), 'utf8');
const countMatches = (src: string, re: RegExp) => (src.match(re) ?? []).length;

describe('MessageInput: no-send branches preserve the composer (#615)', () => {
  const src = read('components/chat/MessageInput.tsx');

  it('has the shared abortComposerSubmit() throw helper', () => {
    assert.match(src, /function abortComposerSubmit\(reason: string\): never\s*\{\s*throw new Error\(reason\)/);
  });

  it('awaits onSend and aborts when the send was not delivered (normal + badge paths)', () => {
    // Both file-carrying sends must await the delivery signal …
    assert.ok(
      countMatches(src, /const delivered = await onSend\(/g) >= 2,
      'both the normal and badge send paths must await onSend for the delivery signal',
    );
    // … and abort (preserve) when it comes back false. The badge path aborts
    // inline; the normal path now clears the composer optimistically before the
    // await and RESTORES it inside the `delivered === false` block before
    // aborting (so the box empties immediately on a real send — the lingering-
    // text fix — without losing a gated send's text). Both still gate on
    // `delivered === false` and still call abortComposerSubmit to preserve.
    assert.ok(
      countMatches(src, /if \(delivered === false\)/g) >= 2,
      'each awaited send must gate the preserve on delivered === false',
    );
    assert.ok(
      countMatches(src, /abortComposerSubmit\('composer-send-not-delivered'\)/g) >= 2,
      'each awaited send must preserve the composer (abortComposerSubmit) when delivered === false',
    );
  });

  it('badge-during-streaming and disabled-with-content preserve instead of bare return', () => {
    assert.match(src, /if \(isStreaming\) abortComposerSubmit\('composer-badge-streaming'\)/);
    assert.match(src, /if \(disabled\) abortComposerSubmit\('composer-disabled'\)/);
  });

  it('the old screenshot-eating bare returns are gone (no `|| disabled) return;`)', () => {
    assert.doesNotMatch(src, /\|\| disabled\)\s*return;/);
  });

  it('QuickActions awaits onSend and clears ONLY on delivery (Codex P3 — gated send keeps the composer)', () => {
    // Was `onSend(text); setInputValue('')` — fire-and-forget, no await, no
    // delivery check, so a gated send (provider/model/runtime not ready) still
    // ate the user's text. Must mirror handleSubmit's await + `!== false` gate.
    assert.match(
      src,
      /onAction=\{async \(text\) => \{[\s\S]*?const delivered = await onSend\(text\)[\s\S]*?if \(delivered !== false\) setInputValue\(''\)/,
      'QuickActions onAction must await onSend and only setInputValue("") when delivered !== false',
    );
  });
});

describe('ChatView.sendMessage signals not-delivered on every provider gate (#615)', () => {
  const src = read('components/chat/ChatView.tsx');

  it('provider-feed-loading gate returns false', () => {
    assert.match(src, /providerFetchState === 'idle'\)[\s\S]{0,200}return false/);
  });

  it('no-compatible-provider gate returns false', () => {
    assert.match(src, /sendMessage suppressed: no provider compatible[\s\S]{0,120}return false/);
  });

  it('runtime-incompatible gate returns false', () => {
    assert.match(src, /sendMessage suppressed: session provider not compatible[\s\S]{0,160}return false/);
  });
});

describe('page.tsx sendFirstMessage signals not-delivered on its gates (#615)', () => {
  const src = read('app/chat/page.tsx');

  it('model-not-ready gate returns false', () => {
    assert.match(src, /if \(!modelReady\) return false/);
  });

  it('no-compatible-provider gate returns false', () => {
    assert.match(src, /if \(noCompatibleProvider\)[\s\S]{0,200}return false/);
  });

  it('cannot-send-with-current-provider gate returns false', () => {
    assert.match(src, /if \(!canSendWithCurrentProvider\)[\s\S]{0,200}return false/);
  });

  it('pre-delivery failure (session create / POST rejected) preserves the composer via the accepted flag (#615 Codex smoke)', () => {
    // Codex's real UI smoke: inject a 500 into POST /api/chat/sessions → error
    // banner shows, text stays, but the screenshot was eaten because the catch
    // only set a banner (no return false). The `accepted` flag fixes it: only
    // true once the backend accepts the message; the catch returns false otherwise.
    assert.match(src, /let accepted = false/);
    assert.match(src, /accepted = true/);
    assert.match(src, /if \(!accepted\) return false/);
  });

  it('defers the isStreaming flip until after accept so a pre-accept failure does not remount the composer (#615 remount fix)', () => {
    // Root cause beyond the return value: the isNewChat ternary renders the
    // composer under two different parents (centered hero vs active layout).
    // Flipping isStreaming before accept swaps the parent → MessageInput remounts
    // → PromptInput loses the attachment BEFORE we learn the send failed. So the
    // layout-driving flip must happen only after `accepted = true`, guarded
    // against double-submit by an in-flight ref. (Source-pin only — the real
    // proof is Codex's inject-500 UI smoke; this just guards the structure.)
    assert.match(src, /const firstSendInFlightRef = useRef\(false\)/);
    assert.match(src, /if \(firstSendInFlightRef\.current\) return false/);
    assert.equal(countMatches(src, /setIsStreaming\(true\)/g), 1, 'isStreaming must be flipped in exactly one place (deferred to post-accept)');
    // setIsStreaming(true) must come AFTER `accepted = true` (deferred to
    // post-accept). Order-based, not distance-based: more #4/#5 post-accept work
    // (draft-clear, prefill-consume) legitimately accrues between them, and a
    // tight char-distance bound kept false-failing as that grew.
    const acceptIdx = src.indexOf('accepted = true;');
    const streamIdx = src.indexOf('setIsStreaming(true)');
    assert.ok(acceptIdx > 0, 'expected an `accepted = true;` commit point');
    assert.ok(streamIdx > acceptIdx, 'setIsStreaming(true) must come after accepted = true (deferred to post-accept)');
  });

  it('composer-stack siblings are keyed so an ErrorBanner toggle keeps MessageInput identity (#615)', () => {
    assert.match(src, /<MessageInput\s+key="composer-message-input"/);
  });
});
