import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mapAspectToOpenAISize, shouldUseXaiOAuthImageProvider } from '../../lib/image-generator';

// GPT Image 2 constraints, per OpenAI Image generation guide.
const MAX_EDGE = 3840;
const MIN_PIXELS = 655_360;
const MAX_PIXELS = 8_294_400;
const MAX_RATIO = 3;

// Full set of UI-exposed aspect ratios — mirrors
// src/components/chat/ImageGenConfirmation.tsx and BatchPlanRow.tsx. If either
// of those lists gains a new entry, add it here too so the invariants run
// against every value the UI can actually produce.
const UI_ASPECT_RATIOS = [
  '1:1', '16:9', '9:16', '3:2', '2:3', '4:3', '3:4', '4:5', '5:4', '21:9',
] as const;
const UI_SIZES = ['1K', '2K', '4K'] as const;

describe('Grok Build active-image selection precedence', () => {
  it('uses the Settings virtual provider when no provider/model override exists', () => {
    assert.equal(shouldUseXaiOAuthImageProvider({ activeProviderId: 'xai-oauth' }), true);
  });

  it('lets explicit provider and model-family choices override the Settings default', () => {
    assert.equal(shouldUseXaiOAuthImageProvider({
      providerId: 'db-image-provider',
      activeProviderId: 'xai-oauth',
    }), false);
    assert.equal(shouldUseXaiOAuthImageProvider({
      requestedFamily: 'openai',
      activeProviderId: 'xai-oauth',
    }), false);
    assert.equal(shouldUseXaiOAuthImageProvider({ providerId: 'xai-oauth' }), true);
    assert.equal(shouldUseXaiOAuthImageProvider({ requestedFamily: 'xai' }), true);
  });

  it('does not let the text chat provider override the Settings media route', () => {
    assert.equal(shouldUseXaiOAuthImageProvider({ activeProviderId: 'db-image-provider' }), false);
  });
});

function parseSize(s: string): { w: number; h: number } {
  const m = /^(\d+)x(\d+)$/.exec(s);
  if (!m) throw new Error(`invalid size: ${s}`);
  return { w: Number(m[1]), h: Number(m[2]) };
}

function assertSatisfiesConstraints(size: string, label: string) {
  const { w, h } = parseSize(size);
  assert.ok(w <= MAX_EDGE && h <= MAX_EDGE, `${label}: edge > ${MAX_EDGE} (${size})`);
  assert.equal(w % 16, 0, `${label}: width ${w} not a multiple of 16`);
  assert.equal(h % 16, 0, `${label}: height ${h} not a multiple of 16`);
  const total = w * h;
  assert.ok(total >= MIN_PIXELS, `${label}: total pixels ${total} < ${MIN_PIXELS}`);
  assert.ok(total <= MAX_PIXELS, `${label}: total pixels ${total} > ${MAX_PIXELS}`);
  const ratio = Math.max(w, h) / Math.min(w, h);
  assert.ok(ratio <= MAX_RATIO, `${label}: ratio ${ratio.toFixed(3)} > ${MAX_RATIO}`);
}

describe('mapAspectToOpenAISize — legacy models (gpt-image-1*)', () => {
  it('always clamps to the 1024x1024 / 1536x1024 / 1024x1536 trio regardless of imageSize', () => {
    // Legacy GPT Image models only accept these 3 sizes — even if the UI asks
    // for 2K/4K we must not send a size the model will reject.
    const cases = [
      ['1:1', '1K', '1024x1024'],
      ['1:1', '2K', '1024x1024'],
      ['1:1', '4K', '1024x1024'],
      ['16:9', '4K', '1536x1024'],
      ['9:16', '4K', '1024x1536'],
      ['4:3', '2K', '1536x1024'],
      ['3:4', '2K', '1024x1536'],
      ['21:9', '1K', '1536x1024'],
      ['9:21', '1K', '1024x1536'],
    ] as const;
    for (const [ar, sz, expected] of cases) {
      assert.equal(
        mapAspectToOpenAISize(ar, sz, 'gpt-image-1'),
        expected,
        `gpt-image-1 ${ar} ${sz}`,
      );
    }
  });
});

describe('mapAspectToOpenAISize — gpt-image-2 per-ratio/per-size picks', () => {
  it('returns the expected canonical sizes for the most common UI selections', () => {
    // These are hard-coded smoke cases for the common picks. The full-matrix
    // invariants below guarantee everything else is at least valid; this case
    // list pins down the values users see most often so refactors don't
    // silently change them.
    const cases: Array<[string, string, `${number}x${number}`]> = [
      ['1:1', '1K', '1024x1024'],
      ['1:1', '2K', '2048x2048'],
      ['1:1', '4K', '2880x2880'],
      ['16:9', '2K', '2048x1152'],
      ['16:9', '4K', '3840x2160'],
      ['9:16', '2K', '1152x2048'],
      ['9:16', '4K', '2160x3840'],
    ];
    for (const [ar, sz, expected] of cases) {
      assert.equal(
        mapAspectToOpenAISize(ar, sz, 'gpt-image-2'),
        expected,
        `gpt-image-2 ${ar} ${sz}`,
      );
    }
  });

  it('produces a distinct size for each UI aspect ratio at each size tier', () => {
    // Guards against the previous bug where 3:2 / 4:5 / 5:4 / 21:9 all
    // collapsed to the landscape/portrait/square buckets — i.e. the mapper
    // silently dropped the user's selection. We assert that, at a given
    // tier, every UI ratio produces an output whose actual w/h ratio is
    // closer to its own requested ratio than to any other UI ratio.
    for (const sz of UI_SIZES) {
      const outputs = UI_ASPECT_RATIOS.map(ar => {
        const out = mapAspectToOpenAISize(ar, sz, 'gpt-image-2');
        const { w, h } = parseSize(out);
        const [rw, rh] = ar.split(':').map(Number);
        return { ar, expected: rw / rh, actual: w / h, out };
      });
      for (const o of outputs) {
        const myError = Math.abs(Math.log(o.actual) - Math.log(o.expected));
        // For each other ratio, the distance between its *expected* ratio and
        // *our output's* actual ratio must be at least as large as our own
        // error (tie allowed for duplicate targets like 4:5 / 5:4 near 1:1).
        for (const other of outputs) {
          if (other.ar === o.ar) continue;
          const otherError = Math.abs(Math.log(o.actual) - Math.log(other.expected));
          assert.ok(
            otherError + 1e-9 >= myError,
            `${sz} ${o.ar} -> ${o.out}: output ratio ${o.actual.toFixed(3)} is ` +
            `closer to ${other.ar} (${other.expected.toFixed(3)}) than to ${o.ar} ` +
            `(${o.expected.toFixed(3)})`,
          );
        }
      }
    }
  });

  it('every output across all UI ratios × tiers satisfies GPT Image 2 constraints', () => {
    // Exhaustive invariant check. Catches regressions like "4K 21:9 crosses
    // the 3840px edge cap" or "4:3 4K overflows the 8,294,400-pixel budget"
    // that a hand-picked case list would miss.
    for (const ar of UI_ASPECT_RATIOS) {
      for (const sz of UI_SIZES) {
        const out = mapAspectToOpenAISize(ar, sz, 'gpt-image-2');
        assertSatisfiesConstraints(out, `${ar} ${sz}`);
      }
    }
  });

  it('unknown model id (no modelId param) is treated as gpt-image-2-capable', () => {
    // Defensive default: callers that omit modelId are assumed to hit the
    // latest model. The alternative — silently clamping to the legacy trio —
    // would strip 2K/4K from correctly-configured new providers.
    assert.equal(mapAspectToOpenAISize('1:1', '4K'), '2880x2880');
    assert.equal(mapAspectToOpenAISize('16:9', '2K'), '2048x1152');
  });

  it('unrecognized aspect ratio falls through to a safe square at the requested tier', () => {
    assert.equal(mapAspectToOpenAISize('garbage', '1K', 'gpt-image-2'), '1024x1024');
    assert.equal(mapAspectToOpenAISize('', '2K', 'gpt-image-2'), '2048x2048');
    assert.equal(mapAspectToOpenAISize('10:1', '1K', 'gpt-image-2'), '1024x1024');
  });

  it('extreme landscape ratios get their long edge capped at 3840, not the square default', () => {
    // 21:9 at 4K naively wants a width > 3840 — the mapper must cap the long
    // edge and scale the short edge rather than falling back to 2880x2880.
    const out = mapAspectToOpenAISize('21:9', '4K', 'gpt-image-2');
    const { w, h } = parseSize(out);
    assert.ok(w > h, `expected landscape, got ${out}`);
    assert.equal(w, MAX_EDGE, `expected long edge = ${MAX_EDGE}, got ${out}`);
    assertSatisfiesConstraints(out, '21:9 4K');
  });
});
