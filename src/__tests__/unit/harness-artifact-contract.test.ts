/**
 * Phase 5d Phase 4 (2026-05-17) — Artifact Contract drift tests.
 *
 * The artifact contract (`src/lib/harness/artifact-contract.ts`) names
 * every artifact the chat surface can produce + its parser + its
 * renderer + a canonical example. These tests pin that registry
 * against the actual source files so:
 *
 *   - A future rename / move of `parseAllShowWidgets` is caught here
 *     before it breaks UI smoke.
 *   - A new artifact added without registering through this contract
 *     can't claim "live across runtimes" status (Phase 5 playbook
 *     requirement).
 *   - The `widget` artifact's canonical example stays byte-identical
 *     to the capability contract's `CANONICAL_SHOW_WIDGET_JSON`
 *     (drift between widget capability prompt and widget renderer
 *     example was the Phase 5c slice 6 failure mode).
 *
 * Anti-pattern these tests guard against (per
 * `feedback_no_live_smoke_driven_patching`): a new agent runtime
 * ships, smoke fails, someone patches the parser to accept a NEW
 * fence variant without updating the contract. Next runtime then
 * inherits the patch but not the documented invariant. Contract
 * tests force "registry-first, parser-second" ordering.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ARTIFACT_CONTRACTS,
  type ArtifactContract,
  getArtifact,
  artifactsBySource,
  artifactsForCapability,
} from '@/lib/harness/artifact-contract';
import {
  HARNESS_CAPABILITIES,
  getCapability,
} from '@/lib/harness/capability-contract';
import { CANONICAL_SHOW_WIDGET_JSON } from '@/lib/widget-guidelines';
import { parseAllShowWidgets } from '@/components/chat/MessageItem';
import { isFileChangedDetail } from '@/lib/file-changed-event';

const REPO_ROOT = path.resolve(__dirname, '../../..');

function readSource(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf-8');
}

function fileExists(rel: string): boolean {
  try {
    fs.accessSync(path.join(REPO_ROOT, rel));
    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────
// (1) Catalog hygiene
// ─────────────────────────────────────────────────────────────────────

describe('Artifact contract — catalog hygiene', () => {
  it('every contract id is unique', () => {
    const ids = new Set<string>();
    for (const a of ARTIFACT_CONTRACTS) {
      assert.equal(ids.has(a.id), false, `duplicate artifact id "${a.id}"`);
      ids.add(a.id);
    }
  });

  it('every contract declares a non-empty parser + renderer', () => {
    for (const a of ARTIFACT_CONTRACTS) {
      assert.ok(a.parser.module.length > 0, `${a.id} parser.module empty`);
      assert.ok(a.parser.export.length > 0, `${a.id} parser.export empty`);
      assert.ok(a.renderer.module.length > 0, `${a.id} renderer.module empty`);
      assert.ok(a.renderer.export.length > 0, `${a.id} renderer.export empty`);
    }
  });

  it('every relatedCapabilities id resolves in the capability catalog', () => {
    for (const a of ARTIFACT_CONTRACTS) {
      for (const capId of a.relatedCapabilities) {
        const cap = getCapability(capId);
        assert.ok(
          cap !== undefined,
          `artifact "${a.id}" → relatedCapabilities entry "${capId}" does not exist in HARNESS_CAPABILITIES`,
        );
      }
    }
  });

  it('every parser + renderer module file actually exists on disk', () => {
    for (const a of ARTIFACT_CONTRACTS) {
      assert.ok(
        fileExists(a.parser.module),
        `${a.id} parser.module "${a.parser.module}" not found on disk`,
      );
      assert.ok(
        fileExists(a.renderer.module),
        `${a.id} renderer.module "${a.renderer.module}" not found on disk`,
      );
    }
  });

  it('every non-inline parser/renderer export is grep-findable in its module', () => {
    for (const a of ARTIFACT_CONTRACTS) {
      for (const sym of [a.parser, a.renderer]) {
        if (sym.export === '<inline>') continue;
        const src = readSource(sym.module);
        // Accept any of: `export const X`, `export function X`,
        // `export type X`, `export interface X`, `export class X`,
        // `export { ..., X, ... }`, `export default function X`.
        const re = new RegExp(
          `export\\s+(?:const|function|class|interface|type|default\\s+function|default\\s+class|\\{[^}]*?\\b${sym.export}\\b[^}]*\\})\\s*${
            sym.export === ''
              ? ''
              : '(?:' + sym.export + '\\b)?'
          }`,
          'm',
        );
        // Above is loose; just confirm symbol shows up after `export`.
        const found =
          new RegExp(`export\\s+(?:const|function|class|interface|type|default\\s+function|default\\s+class)\\s+${sym.export}\\b`, 'm').test(src) ||
          new RegExp(`export\\s*\\{[^}]*\\b${sym.export}\\b[^}]*\\}`).test(src);
        assert.ok(
          found,
          `${a.id}: export "${sym.export}" not found in "${sym.module}". RegExp tried: ${re}`,
        );
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// (2) Fence-source descriptors must appear in their parser file
// ─────────────────────────────────────────────────────────────────────

describe('Artifact contract — fence source descriptors', () => {
  it('every fence-source artifact has its fenceLanguage referenced in the parser module', () => {
    const fenceArtifacts = artifactsBySource('fence');
    for (const a of fenceArtifacts) {
      if (a.sourceDescriptor.kind !== 'fence') continue;
      const src = readSource(a.parser.module);
      assert.ok(
        src.includes(a.sourceDescriptor.fenceLanguage),
        `${a.id}: fenceLanguage "${a.sourceDescriptor.fenceLanguage}" not mentioned in "${a.parser.module}"`,
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// (3) SSE event descriptors trace to handler arms in useSSEStream.ts
// ─────────────────────────────────────────────────────────────────────

describe('Artifact contract — SSE event descriptors', () => {
  it('every SSE-source artifact has its event type referenced in a useSSEStream / event source file', () => {
    const sseArtifacts = artifactsBySource('sse_event');
    for (const a of sseArtifacts) {
      if (a.sourceDescriptor.kind !== 'sse_event') continue;
      // The descriptor labels event paths like `tool_result.media` or
      // `file_changed`. The contract test confirms either
      //   - The exact dotted path is mentioned in the parser module,
      //     OR
      //   - The base event (`tool_result` / `file_changed`) is a case
      //     arm inside the parser module — that's how useSSEStream
      //     dispatches.
      const src = readSource(a.parser.module);
      const eventType = a.sourceDescriptor.eventType;
      const baseEvent = eventType.split('.')[0];
      const hasDotted = src.includes(eventType);
      const hasCaseArm = new RegExp(`case ['"]${baseEvent}['"]:`).test(src);
      assert.ok(
        hasDotted || hasCaseArm,
        `${a.id}: event "${eventType}" not referenced in parser module "${a.parser.module}"`,
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// (4) PreviewSource descriptors are valid kinds in the union type
// ─────────────────────────────────────────────────────────────────────

describe('Artifact contract — PreviewSource descriptors', () => {
  it('every preview_source-source artifact uses a kind declared in usePanel.ts PreviewSource union', () => {
    const previewArtifacts = artifactsBySource('preview_source');
    const usePanelSrc = readSource('src/hooks/usePanel.ts');
    for (const a of previewArtifacts) {
      if (a.sourceDescriptor.kind !== 'preview_source') continue;
      const kind = a.sourceDescriptor.previewKind;
      // `<component>` is an opt-out for component-driven artifacts
      // (e.g. ErrorBanner) that don't go through PreviewSource at
      // all — they are listed for completeness.
      if (kind === '<component>') continue;
      // Confirm the kind appears as a `kind: "<kind>"` literal in
      // the PreviewSource union.
      const re = new RegExp(`kind:\\s*["']${kind}["']`);
      assert.ok(
        re.test(usePanelSrc),
        `${a.id}: previewKind "${kind}" not found in PreviewSource union (src/hooks/usePanel.ts)`,
      );
    }
  });

  it('every inline-* kind in the PreviewSource union has a matching ARTIFACT_CONTRACTS entry (completeness pin)', () => {
    // Phase 5d Phase 3 review fix (P1 #2, 2026-05-17). Pre-fix the
    // contract registry missed `inline-diff` + `inline-jsx`. We pin
    // the inverse direction: scan PreviewSource for every `kind:
    // "inline-*"` literal, and assert each has an artifact entry.
    // The next time someone adds an inline-* arm to PreviewPanel
    // without registering through this contract, the test fails
    // before that arm reaches users.
    const usePanelSrc = readSource('src/hooks/usePanel.ts');
    const matches = [...usePanelSrc.matchAll(/kind:\s*["'](inline-[a-z-]+)["']/g)];
    const inlineKinds = new Set(matches.map((m) => m[1]));
    assert.ok(
      inlineKinds.size > 0,
      'PreviewSource union should contain at least one inline-* kind — if this fails the regex needs updating',
    );
    const registeredPreviewKinds = new Set(
      ARTIFACT_CONTRACTS.filter(
        (a) => a.sourceDescriptor.kind === 'preview_source',
      ).map((a) =>
        a.sourceDescriptor.kind === 'preview_source'
          ? a.sourceDescriptor.previewKind
          : '',
      ),
    );
    for (const kind of inlineKinds) {
      assert.ok(
        registeredPreviewKinds.has(kind),
        `PreviewSource declares "${kind}" but ARTIFACT_CONTRACTS has no entry — every inline-* kind must be registered (see Phase 5d Phase 4 contract)`,
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// (5) Canonical examples round-trip through their parsers
// ─────────────────────────────────────────────────────────────────────

describe('Artifact contract — canonical examples round-trip', () => {
  it('widget canonicalExample → parseAllShowWidgets → returns a `widget` segment', () => {
    const widget = getArtifact('widget')!;
    assert.ok(widget.canonicalExample, 'widget canonicalExample missing');
    const segs = parseAllShowWidgets(widget.canonicalExample!);
    const widgetSeg = segs.find((s) => s.type === 'widget');
    assert.ok(widgetSeg, `widget canonicalExample did not parse: ${JSON.stringify(segs)}`);
  });

  it('malformed_widget canonicalExample → parseAllShowWidgets → returns a `malformed_widget` segment', () => {
    const mw = getArtifact('malformed_widget')!;
    assert.ok(mw.canonicalExample, 'malformed_widget canonicalExample missing');
    const segs = parseAllShowWidgets(mw.canonicalExample!);
    const mwSeg = segs.find((s) => s.type === 'malformed_widget');
    assert.ok(mwSeg, `malformed_widget canonicalExample did not surface as malformed: ${JSON.stringify(segs)}`);
  });

  it('json canonicalExample is JSON.parse-safe', () => {
    const j = getArtifact('json')!;
    assert.ok(j.canonicalExample);
    // Must not throw.
    const parsed = JSON.parse(j.canonicalExample!);
    assert.equal(typeof parsed, 'object');
  });

  it('markdown canonicalExample is non-empty plain text', () => {
    const md = getArtifact('markdown')!;
    assert.ok(md.canonicalExample);
    assert.ok(md.canonicalExample!.length > 0);
  });

  it('html canonicalExample contains an HTML tag (renderer assumes string with markup)', () => {
    const h = getArtifact('html')!;
    assert.ok(h.canonicalExample);
    assert.match(h.canonicalExample!, /<\w+[^>]*>/);
  });

  it('inline_diff canonicalExample looks like a unified diff (--- / +++ / @@ markers)', () => {
    const d = getArtifact('inline_diff')!;
    assert.ok(d.canonicalExample);
    assert.match(d.canonicalExample!, /^---\s/m);
    assert.match(d.canonicalExample!, /^\+\+\+\s/m);
    assert.match(d.canonicalExample!, /^@@\s/m);
  });

  it('inline_jsx canonicalExample contains JSX-shaped markup', () => {
    const j = getArtifact('inline_jsx')!;
    assert.ok(j.canonicalExample);
    // JSX is a string that contains a tag-shaped substring; the
    // renderer (Sandpack) does the parse, the contract just pins
    // that we put something parser-shaped in.
    assert.match(j.canonicalExample!, /<\w+[^>]*\/?>/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// (6) Cross-contract identity: widget example must be byte-identical
//     to the capability contract's CANONICAL_SHOW_WIDGET_JSON (post-
//     wrapper-stripping).
// ─────────────────────────────────────────────────────────────────────

describe('Artifact contract — widget canonical identity', () => {
  it('artifact contract widget example wraps the EXACT capability CANONICAL_SHOW_WIDGET_JSON between fence markers', () => {
    const widget = getArtifact('widget')!;
    assert.ok(widget.canonicalExample);
    const ex = widget.canonicalExample!;
    // Strip the ```show-widget\n …\n``` wrapper.
    const stripped = ex.replace(/^```show-widget\n/, '').replace(/\n```$/, '');
    assert.equal(
      stripped,
      CANONICAL_SHOW_WIDGET_JSON,
      'artifact-contract widget example must wrap the same CANONICAL_SHOW_WIDGET_JSON the capability contract exports — drift here means a future change to widget-guidelines.ts will silently break the artifact contract test',
    );
  });

  it('artifactsForCapability("widget") contains both widget + malformed_widget', () => {
    const arts = artifactsForCapability('widget');
    const ids = arts.map((a) => a.id);
    assert.ok(ids.includes('widget'));
    assert.ok(ids.includes('malformed_widget'));
  });

  it('artifactsForCapability("image_generation") AND artifactsForCapability("media_import") both resolve `media` (multi-capability artifact)', () => {
    // Phase 5d Phase 3 review fix (P2, 2026-05-17) — `media` is
    // produced by EITHER image_generation or media_import. The
    // multi-valued `relatedCapabilities` ensures both lookups
    // surface the shared artifact, instead of forcing the contract
    // to pick a single capability id.
    const imageGenArts = artifactsForCapability('image_generation');
    const mediaImportArts = artifactsForCapability('media_import');
    assert.ok(
      imageGenArts.some((a) => a.id === 'media'),
      'image_generation must resolve the shared `media` artifact',
    );
    assert.ok(
      mediaImportArts.some((a) => a.id === 'media'),
      'media_import must resolve the shared `media` artifact',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// (7) Cross-table consistency with capability-contract.ts
//     Capabilities that DECLARE an artifactContract must have a
//     matching ARTIFACT_CONTRACTS entry with the same fenceLanguage.
// ─────────────────────────────────────────────────────────────────────

describe('Artifact contract — capability ↔ artifact cross-table consistency', () => {
  it('every capability with an artifactContract has a matching ARTIFACT_CONTRACTS entry with the same fenceLanguage', () => {
    for (const cap of HARNESS_CAPABILITIES) {
      if (!cap.artifactContract) continue;
      const matching = artifactsForCapability(cap.id).filter(
        (a) => a.source === 'fence',
      );
      assert.ok(
        matching.length > 0,
        `capability "${cap.id}" declares an artifactContract but no fence-source ARTIFACT_CONTRACTS entry points back at it`,
      );
      // At least one matching artifact uses the declared
      // fenceLanguage.
      const fenceMatch = matching.find(
        (a) =>
          a.sourceDescriptor.kind === 'fence' &&
          a.sourceDescriptor.fenceLanguage === cap.artifactContract!.fenceLanguage,
      );
      assert.ok(
        fenceMatch,
        `capability "${cap.id}" declares fenceLanguage "${cap.artifactContract.fenceLanguage}" but no ARTIFACT_CONTRACTS entry matches`,
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// (8) Real-runtime smoke: file_changed parser actually decodes a
//     well-formed payload (proves the registry's parser export
//     points at a working symbol, not just a name that exists).
// ─────────────────────────────────────────────────────────────────────

describe('Artifact contract — parser real-runtime invocation', () => {
  // `diff` artifact's SSE arm is inline in useSSEStream.ts, so we can't
  // import it directly. We instead pin the secondary `file-changed-event`
  // dispatch helper that surfaces the payload to PreviewPanel after the
  // SSE arm fires — proving the secondary handler matches the shape
  // useSSEStream actually emits.
  it('file-changed-event: isFileChangedDetail accepts a well-formed payload', () => {
    const ok = isFileChangedDetail({
      paths: ['/tmp/test.ts'],
      source: 'ai-tool',
    });
    assert.equal(ok, true);
  });

  it('file-changed-event: isFileChangedDetail rejects a malformed payload', () => {
    const ok = isFileChangedDetail({ noise: true });
    assert.equal(ok, false);
  });
});
