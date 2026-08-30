/**
 * Phase 5c slice 6 (2026-05-16, post-smoke) — widget format
 * contract.
 *
 * Smoke evidence (S4 + S4b sessions):
 *   - Natural-prompt S4: GLM called codepilot_load_widget_guidelines,
 *     then called codepilot_generate_image, then emitted a raw HTML
 *     `show-widget` fence — UI saw no widget.
 *   - Explicit-JSON-wrapper S4b: same prompt with "must be JSON
 *     wrapper" → rendered fine.
 *
 * Diagnosis: the original guidelines didn't make the wire format
 * loud enough, and never forbade the image-gen tool during widget
 * tasks. Slice 6 hardens four things — this test pins each:
 *
 *   1. WIDGET_WIRE_FORMAT_SPEC is the single source of truth for the
 *      `show-widget {…JSON…}` wire format. Both the always-injected
 *      system prompt and the on-demand `getGuidelines()` output must
 *      embed it verbatim.
 *
 *   2. `getGuidelines()` output explicitly tells the model the
 *      HTML/SVG examples below go INSIDE widget_code, not as the
 *      wire format. This is the gap that let S4 happen.
 *
 *   3. The system prompt + the bridge's WIDGET_PROMPT both explicitly
 *      forbid `codepilot_generate_image` while building a widget
 *      (unless the user asked for an image separately).
 *
 *   4. Renderer-layer: parseAllShowWidgets emits a
 *      `malformed_widget` segment for the three failure modes
 *      (raw HTML body, missing widget_code, malformed JSON) instead
 *      of dropping silently.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  WIDGET_SYSTEM_PROMPT,
  WIDGET_WIRE_FORMAT_SPEC,
  getGuidelines,
} from '@/lib/widget-guidelines';
import { parseAllShowWidgets } from '@/components/chat/MessageItem';

// ─────────────────────────────────────────────────────────────────────
// (1) Single source of truth for the wire format
// ─────────────────────────────────────────────────────────────────────

describe('Widget wire format — single source of truth', () => {
  it('WIDGET_WIRE_FORMAT_SPEC declares the show-widget JSON wrapper as non-negotiable', () => {
    assert.match(WIDGET_WIRE_FORMAT_SPEC, /FINAL OUTPUT FORMAT — non-negotiable/);
    assert.match(WIDGET_WIRE_FORMAT_SPEC, /```show-widget/);
    assert.match(WIDGET_WIRE_FORMAT_SPEC, /widget_code/);
    // Explicit anti-pattern callouts the model needs to read.
    assert.match(WIDGET_WIRE_FORMAT_SPEC, /raw HTML fence/i);
    assert.match(WIDGET_WIRE_FORMAT_SPEC, /NEVER rendered as a widget/i);
    // The "JSON-encoded string" framing is what stops the model from
    // emitting raw HTML inside the show-widget fence.
    assert.match(WIDGET_WIRE_FORMAT_SPEC, /JSON-encoded string/i);
  });

  it('WIDGET_SYSTEM_PROMPT references the wire-format spec WITHOUT embedding its literal text (slice 2c)', () => {
    // Phase 5d Phase 2 slice 2c (2026-05-17) — the artifactContract
    // in capability-contract.ts is now the sole holder of the wire
    // spec + canonical JSON. The system prompt no longer embeds the
    // SPEC literal; it references that the format is documented in
    // the "FINAL OUTPUT FORMAT block above this section" so the
    // model knows to look for it. The compiler's
    // `detectWireFormatDuplication` sanity check enforces this at
    // compile time.
    assert.equal(
      WIDGET_SYSTEM_PROMPT.includes(WIDGET_WIRE_FORMAT_SPEC),
      false,
      'WIDGET_SYSTEM_PROMPT must NOT embed WIDGET_WIRE_FORMAT_SPEC after slice 2c — that would duplicate the spec in compiled prompts',
    );
    // It DOES still reference the format by name + tells the model
    // the spec lives elsewhere in the compiled prompt.
    assert.match(
      WIDGET_SYSTEM_PROMPT,
      /FINAL OUTPUT FORMAT/,
      'WIDGET_SYSTEM_PROMPT must still tell the model where to look for the wire format',
    );
  });

  it('getGuidelines() output prepends the same wire-format spec — model re-reads it alongside design examples', () => {
    const text = getGuidelines(['chart']);
    assert.ok(
      text.includes(WIDGET_WIRE_FORMAT_SPEC),
      'on-demand guidelines must lead with the wire-format spec; otherwise the model forgets it between the system prompt and the design examples',
    );
    // The spec must come BEFORE any of the design-system sections,
    // otherwise the Chart.js raw-HTML example might be the model's
    // last reference point.
    const specIdx = text.indexOf(WIDGET_WIRE_FORMAT_SPEC);
    const chartExampleIdx = text.indexOf('Chart.js');
    assert.ok(specIdx >= 0 && chartExampleIdx > specIdx, 'wire-format spec must precede design examples');
  });
});

// ─────────────────────────────────────────────────────────────────────
// (2) Internal-example framing — HTML below is INSIDE widget_code
// ─────────────────────────────────────────────────────────────────────

describe('Widget on-demand guidelines — internal-example framing', () => {
  it('getGuidelines() output explicitly tells the model the snippets below go INSIDE widget_code', () => {
    const text = getGuidelines(['interactive', 'chart']);
    assert.match(
      text,
      /INTERNAL EXAMPLE/,
      'guidelines must mark code snippets as INTERNAL EXAMPLE so the model does not mistake them for the wire format',
    );
    assert.match(text, /INSIDE.*widget_code|widget_code.*INSIDE/i);
  });
});

// ─────────────────────────────────────────────────────────────────────
// (3) No codepilot_generate_image during widget tasks
// ─────────────────────────────────────────────────────────────────────

describe('Widget guidance forbids the image-gen tool while building a widget', () => {
  it('WIDGET_SYSTEM_PROMPT explicitly tells the model NOT to call codepilot_generate_image during widget work', () => {
    // Negative phrasing is intentional — "do NOT call X" reads as
    // a hard rule rather than a suggestion. Pre-fix the prompt
    // didn't mention image-gen at all; S4 model chained them
    // anyway because the design examples implied "rich visuals".
    // Note: the prompt may format `NOT` with markdown bold (`**NOT**`),
    // so allow either rendered or raw markdown forms.
    assert.match(WIDGET_SYSTEM_PROMPT, /codepilot_generate_image/);
    // Bold wraps "do NOT" together as `**do NOT**` — optional `**`
    // anchors allow plain or bold form on either side.
    assert.match(WIDGET_SYSTEM_PROMPT, /(?:\*\*)?do\s+NOT(?:\*\*)?\s+call/i);
  });

  it('Codex bridge no longer holds local Widget prompt; compiler imports canonical (slice 2e)', () => {
    // Phase 5d Phase 2 slice 2e (2026-05-17) — bridge no longer
    // declares WIDGET_PROMPT, MEDIA_PROMPT, MEMORY_PROMPT, or
    // NOTIFY_PROMPT scalars. The Context Compiler is the sole
    // producer of capability prompts.
    const bridgeSrc = fs.readFileSync(
      path.resolve(__dirname, '../../lib/codex/proxy/builtin-bridge.ts'),
      'utf-8',
    );
    assert.equal(
      /^const\s+(WIDGET_PROMPT|MEDIA_PROMPT|MEMORY_PROMPT|NOTIFY_PROMPT)\s*=/m.test(bridgeSrc),
      false,
      'bridge must not declare any of WIDGET_PROMPT / MEDIA_PROMPT / MEMORY_PROMPT / NOTIFY_PROMPT — those scalars belong in the compiler-consumed canonical files',
    );

    // The compiler imports the canonical widget prompt.
    const compilerSrc = fs.readFileSync(
      path.resolve(__dirname, '../../lib/harness/context-compiler.ts'),
      'utf-8',
    );
    assert.match(
      compilerSrc,
      /import\s*\{[^}]*WIDGET_WIRE_FORMAT_SPEC[^}]*\}\s*from\s*'@\/lib\/widget-guidelines'/,
      'compiler must import WIDGET_WIRE_FORMAT_SPEC from widget-guidelines.ts (the canonical source)',
    );

    // Cross-pin on the canonical source: the canonical prompt must
    // carry the show-widget format declaration + image-gen rule.
    const canonicalSrc = fs.readFileSync(
      path.resolve(__dirname, '../../lib/widget-guidelines.ts'),
      'utf-8',
    );
    assert.match(canonicalSrc, /codepilot_generate_image/);
    assert.match(canonicalSrc, /(?:\*\*)?do\s+NOT(?:\*\*)?\s+call/i);
    assert.match(canonicalSrc, /show-widget/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// (4) Renderer surfaces malformed fences instead of dropping silently
// ─────────────────────────────────────────────────────────────────────

describe('parseAllShowWidgets — three malformed-fence failure modes surface as visible error segments', () => {
  it('raw HTML body (the S4 failure mode) → malformed_widget segment with "raw HTML" reason', () => {
    const text = [
      'Here is the widget:',
      '```show-widget',
      '<div>hello</div>',
      '```',
    ].join('\n');
    const segs = parseAllShowWidgets(text);
    const malformed = segs.find((s) => s.type === 'malformed_widget');
    assert.ok(malformed, 'raw-HTML-body S4 case must produce a visible malformed_widget segment');
    if (malformed?.type !== 'malformed_widget') return;
    assert.match(malformed.reason, /No JSON wrapper/i);
    assert.match(malformed.reason, /widget_code/);
    assert.match(malformed.raw, /<div>hello<\/div>/, 'raw fence body must be preserved so the user can read what the model produced');
  });

  it('JSON parses but missing widget_code → malformed_widget with "missing widget_code" reason', () => {
    const text = [
      '```show-widget',
      '{"title":"oops","other_field":"value"}',
      '```',
    ].join('\n');
    const segs = parseAllShowWidgets(text);
    const malformed = segs.find((s) => s.type === 'malformed_widget');
    assert.ok(malformed, 'JSON-without-widget_code must produce a visible error');
    if (malformed?.type !== 'malformed_widget') return;
    assert.match(malformed.reason, /widget_code/);
  });

  it('malformed JSON (balanced braces but invalid syntax) → malformed_widget with parse-error reason', () => {
    // Need balanced braces so findJsonEnd succeeds AND JSON.parse
    // throws. A double-comma satisfies both: braces stay balanced,
    // but `,,` is not valid JSON. The "unclosed string" form trips
    // the truncated-JSON branch instead.
    const text = [
      '```show-widget',
      '{"title":"oops",,"widget_code":"<div>x</div>"}',
      '```',
    ].join('\n');
    const segs = parseAllShowWidgets(text);
    const malformed = segs.find((s) => s.type === 'malformed_widget');
    assert.ok(malformed, 'malformed JSON must produce a visible error');
    if (malformed?.type !== 'malformed_widget') return;
    assert.match(malformed.reason, /failed to parse|JSON/i);
  });

  it('valid widget still renders as `widget` segment (regression check)', () => {
    const text = [
      '```show-widget',
      '{"title":"ok","widget_code":"<div>hi</div>"}',
      '```',
    ].join('\n');
    const segs = parseAllShowWidgets(text);
    const widget = segs.find((s) => s.type === 'widget');
    assert.ok(widget, 'happy-path widget must still parse — the malformed path additions cannot regress the success path');
    if (widget?.type !== 'widget') return;
    assert.equal(widget.data.title, 'ok');
    assert.equal(widget.data.widget_code, '<div>hi</div>');
  });

  it('mixed valid + malformed widgets in one message — each lands as its own segment', () => {
    const text = [
      'First widget:',
      '```show-widget',
      '{"title":"good","widget_code":"<div>1</div>"}',
      '```',
      'Second widget (broken):',
      '```show-widget',
      '<div>raw html, no json</div>',
      '```',
      'Third widget:',
      '```show-widget',
      '{"title":"also good","widget_code":"<div>3</div>"}',
      '```',
    ].join('\n');
    const segs = parseAllShowWidgets(text);
    const widgets = segs.filter((s) => s.type === 'widget');
    const malformed = segs.filter((s) => s.type === 'malformed_widget');
    assert.equal(widgets.length, 2, 'two valid widgets must render');
    assert.equal(malformed.length, 1, 'one malformed widget must surface');
  });

  it('truncated `raw` is capped (no unbounded persisted payload)', () => {
    const huge = '<div>' + 'x'.repeat(5000) + '</div>';
    const text = ['```show-widget', huge, '```'].join('\n');
    const segs = parseAllShowWidgets(text);
    const malformed = segs.find((s) => s.type === 'malformed_widget');
    if (malformed?.type !== 'malformed_widget') {
      assert.fail('expected a malformed segment for the huge HTML body');
    }
    assert.ok(malformed.raw.length <= 2100, `clipped raw must stay under ~2KB; got ${malformed.raw.length}`);
    assert.match(malformed.raw, /truncated/i, 'truncation marker must appear so the user knows there is more');
  });
});
