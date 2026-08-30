/**
 * Phase 4.A Markdown data layer — parsers + rewriters.
 *
 * Coverage:
 *  - frontmatter split (scalar / list / multi-line list / quoted /
 *    coerced scalars / no-frontmatter passthrough)
 *  - outline parser (heading levels / slug collisions / code-fence
 *    skip / non-Latin headings)
 *  - wikilink rewrite (target / alias / heading / code-fence skip /
 *    code-span skip)
 *  - callout rewrite (known types / unknown type fallback / code-fence
 *    skip / no false-positive on plain blockquotes)
 *  - anchor parsing (line / colon / heading / invalid)
 *  - path-and-anchor split (Windows drive, mid-path colon left alone)
 *
 * Run: npx tsx --test src/__tests__/unit/markdown-data-layer.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseFrontmatter,
  formatFrontmatterValue,
} from '../../lib/markdown/frontmatter';
import { parseOutline, slugify } from '../../lib/markdown/outline';
import {
  rewriteWikilinks,
  resolveWikilink,
  extractWikilinks,
  parseWikilinkHref,
  WIKILINK_HREF_PREFIX,
} from '../../lib/markdown/wikilink';
import {
  rewriteCallouts,
  calloutAppearance,
  readCalloutMarker,
  CALLOUT_TYPES,
} from '../../lib/markdown/callout';
import { parseAnchor, splitPathAndAnchor } from '../../lib/markdown/anchor';

describe('frontmatter parser', () => {
  it('returns empty data + verbatim body when no frontmatter', () => {
    const r = parseFrontmatter('# Hello\nWorld');
    assert.deepEqual(r.data, {});
    assert.equal(r.body, '# Hello\nWorld');
    assert.equal(r.lineOffset, 0);
  });

  it('parses scalars + arrays + multi-line lists', () => {
    const src = `---
title: My Note
draft: true
priority: 3
ratio: 1.5
tags: [draft, idea]
authors:
  - Alice
  - Bob
nullish: null
---

# Body`;
    const r = parseFrontmatter(src);
    assert.equal(r.data.title, 'My Note');
    assert.equal(r.data.draft, true);
    assert.equal(r.data.priority, 3);
    assert.equal(r.data.ratio, 1.5);
    assert.deepEqual(r.data.tags, ['draft', 'idea']);
    assert.deepEqual(r.data.authors, ['Alice', 'Bob']);
    assert.equal(r.data.nullish, null);
    // The closing `---\n\n` consumes the trailing whitespace eagerly,
    // so the body starts directly at the first non-whitespace line.
    assert.equal(r.body, '# Body');
    assert.ok(r.lineOffset >= 9);
  });

  it('strips surrounding quotes from string scalars', () => {
    const r = parseFrontmatter(`---
title: "Quoted Title"
slug: 'kebab-case'
---
body`);
    assert.equal(r.data.title, 'Quoted Title');
    assert.equal(r.data.slug, 'kebab-case');
  });

  it('leaves source untouched when frontmatter is unterminated', () => {
    const src = '---\ntitle: x\n# nope';
    const r = parseFrontmatter(src);
    assert.deepEqual(r.data, {});
    assert.equal(r.body, src);
  });

  it('formatFrontmatterValue handles arrays + null', () => {
    assert.equal(formatFrontmatterValue(null), '—');
    assert.equal(formatFrontmatterValue(['a', 'b']), 'a, b');
    assert.equal(formatFrontmatterValue(true), 'true');
    assert.equal(formatFrontmatterValue(42), '42');
  });
});

describe('outline parser', () => {
  it('collects heading levels with slugs and line numbers', () => {
    const src = `# Intro\n\n## Section A\n\n### Subsection\n\n## Section B`;
    const o = parseOutline(src);
    assert.equal(o.length, 4);
    assert.equal(o[0].text, 'Intro');
    assert.equal(o[0].slug, 'intro');
    assert.equal(o[0].level, 1);
    assert.equal(o[0].line, 1);
    assert.equal(o[1].slug, 'section-a');
    assert.equal(o[2].slug, 'subsection');
    assert.equal(o[3].slug, 'section-b');
  });

  it('handles slug collisions with -2, -3 suffixes', () => {
    const src = `# Intro\n\n# Intro\n\n# Intro`;
    const o = parseOutline(src);
    assert.deepEqual(
      o.map((h) => h.slug),
      ['intro', 'intro-2', 'intro-3'],
    );
  });

  it('does not collect headings inside fenced code blocks', () => {
    const src = `# Real\n\n\`\`\`bash\n# fake heading\n\`\`\`\n\n## Real Two`;
    const o = parseOutline(src);
    assert.deepEqual(
      o.map((h) => h.text),
      ['Real', 'Real Two'],
    );
  });

  it('slugifies Unicode (CJK) headings without mangling', () => {
    const src = `# 项目说明`;
    const o = parseOutline(src);
    assert.equal(o[0].slug, '项目说明');
  });

  it('slugify normalizes whitespace + strips punctuation', () => {
    assert.equal(slugify('Hello, World!'), 'hello-world');
    assert.equal(slugify('  Multiple   Spaces  '), 'multiple-spaces');
  });
});

describe('wikilink rewriter', () => {
  it('rewrites [[Foo]] to a fragment href (streamdown-sanitizer-safe)', () => {
    const out = rewriteWikilinks('See [[Foo]] for details.');
    assert.match(out, /\[Foo\]\(#codepilot-wikilink-Foo\)/);
  });

  it('honors alias form [[Foo|Friendly Name]]', () => {
    const out = rewriteWikilinks('Read [[Foo|Friendly Name]].');
    assert.match(out, /\[Friendly Name\]\(#codepilot-wikilink-Foo\)/);
  });

  it('encodes heading fragment in the target', () => {
    const out = rewriteWikilinks('Jump to [[Foo#Heading]].');
    // URL-encoded `#` in payload (after the prefix's literal `#`)
    assert.match(out, /#codepilot-wikilink-Foo%23Heading/);
  });

  it('parseWikilinkHref decodes the round-trip back to the target', () => {
    assert.equal(parseWikilinkHref(`${WIKILINK_HREF_PREFIX}Foo`), 'Foo');
    assert.equal(parseWikilinkHref(`${WIKILINK_HREF_PREFIX}Foo%23Heading`), 'Foo#Heading');
    // Non-wikilink fragments must return null so the click handler ignores them.
    assert.equal(parseWikilinkHref('#some-heading'), null);
    assert.equal(parseWikilinkHref(''), null);
    assert.equal(parseWikilinkHref(null), null);
  });

  it('skips wikilinks inside fenced code blocks', () => {
    const src = '```\n[[Foo]]\n```\n\n[[Bar]]';
    const out = rewriteWikilinks(src);
    assert.ok(out.includes('[[Foo]]'));
    assert.ok(out.includes('[Bar](#codepilot-wikilink-Bar)'));
  });

  it('skips wikilinks inside inline code spans', () => {
    const out = rewriteWikilinks('Use `[[Foo]]` in your notes.');
    assert.ok(out.includes('`[[Foo]]`'));
  });

  it('resolveWikilink joins workingDirectory + .md filename', () => {
    const r = resolveWikilink('MyNote', '/Users/me/proj');
    assert.equal(r?.absolutePath, '/Users/me/proj/MyNote.md');
    assert.equal(r?.anchor, undefined);
  });

  it('resolveWikilink returns null without a workingDirectory', () => {
    assert.equal(resolveWikilink('Foo', null), null);
    assert.equal(resolveWikilink('Foo', undefined), null);
    assert.equal(resolveWikilink('Foo', ''), null);
  });

  it('resolveWikilink preserves heading fragment as anchor', () => {
    const r = resolveWikilink('MyNote#Section', '/Users/me/proj');
    assert.equal(r?.anchor, '#Section');
  });

  it('extractWikilinks returns ordered targets', () => {
    const src = 'A [[Foo]] and a [[Bar|alias]] then a [[Baz#hdg]].';
    const out = extractWikilinks(src);
    assert.equal(out.length, 3);
    assert.equal(out[0].target, 'Foo');
    assert.equal(out[1].display, 'alias');
    assert.equal(out[2].target, 'Baz#hdg');
  });
});

describe('callout rewriter', () => {
  it('emits a blockquote with the type sentinel for known callouts', () => {
    const src = '> [!note]\n> Body line';
    const out = rewriteCallouts(src);
    // Sentinel string survives streamdown render and is detected by
    // PreviewPanel's post-render pass to stamp the class.
    assert.match(out, /⟦codepilot-callout:note⟧/);
    assert.equal(readCalloutMarker(out), 'note');
    // body text preserved
    assert.match(out, /Body line/);
    // Header icon + label rendered as bold markdown
    assert.match(out, /\*\*📝 Note\*\*/);
  });

  it('falls back to note for unknown types', () => {
    const src = '> [!banana] heading\n> body';
    const out = rewriteCallouts(src);
    assert.equal(readCalloutMarker(out), 'note');
    // header still uses note appearance (📝)
    assert.match(out, /\*\*📝 heading\*\*/);
  });

  it('preserves the title text when present', () => {
    const src = '> [!warning] Heads up\n> details';
    const out = rewriteCallouts(src);
    assert.match(out, /Heads up/);
    assert.equal(readCalloutMarker(out), 'warning');
  });

  it('leaves a plain blockquote alone', () => {
    const src = '> Not a callout\n> just a quote';
    const out = rewriteCallouts(src);
    assert.equal(out, src);
  });

  it('skips callout-shaped content inside fenced code blocks', () => {
    const src = '```\n> [!note] in code\n```\n\n> [!tip] real';
    const out = rewriteCallouts(src);
    // The code-fenced version must remain literal
    assert.ok(out.includes('> [!note] in code'));
    assert.equal(readCalloutMarker(out), 'tip');
  });

  it('calloutAppearance returns a stable shape for known + unknown types', () => {
    for (const t of CALLOUT_TYPES) {
      const a = calloutAppearance(t);
      assert.ok(a.icon, `appearance ${t} icon`);
      assert.ok(a.label, `appearance ${t} label`);
      assert.ok(a.className.startsWith('codepilot-callout-'), `appearance ${t} className`);
    }
    const fallback = calloutAppearance('definitely-unknown');
    assert.equal(fallback.className, 'codepilot-callout-note');
  });

  it('readCalloutMarker returns null when no sentinel present', () => {
    assert.equal(readCalloutMarker('plain text'), null);
    assert.equal(readCalloutMarker('> regular blockquote'), null);
  });
});

describe('anchor parser', () => {
  it('parses #L12 → line', () => {
    assert.deepEqual(parseAnchor('#L12'), { kind: 'line', line: 12 });
    assert.deepEqual(parseAnchor('#l12'), { kind: 'line', line: 12 });
  });

  it('parses :12 / :12:5 → line (column dropped)', () => {
    assert.deepEqual(parseAnchor(':12'), { kind: 'line', line: 12 });
    assert.deepEqual(parseAnchor(':42:7'), { kind: 'line', line: 42 });
  });

  it('parses #heading-slug → heading', () => {
    assert.deepEqual(parseAnchor('#intro'), { kind: 'heading', slug: 'intro' });
    assert.deepEqual(parseAnchor('#section-a'), { kind: 'heading', slug: 'section-a' });
  });

  it('rejects empty / invalid / out-of-range anchors', () => {
    assert.equal(parseAnchor('').kind, 'invalid');
    assert.equal(parseAnchor(null).kind, 'invalid');
    assert.equal(parseAnchor(undefined).kind, 'invalid');
    assert.equal(parseAnchor('#').kind, 'invalid');
    assert.equal(parseAnchor('#L0').kind, 'invalid');
    assert.equal(parseAnchor(':0').kind, 'invalid');
    assert.equal(parseAnchor('garbage').kind, 'invalid');
  });

  it('splitPathAndAnchor pulls trailing :N off a path', () => {
    assert.deepEqual(splitPathAndAnchor('/abs/foo.md:12'), { filePath: '/abs/foo.md', anchor: ':12' });
    assert.deepEqual(splitPathAndAnchor('foo.md:12:7'), { filePath: 'foo.md', anchor: ':12:7' });
  });

  it('splitPathAndAnchor pulls #L12 / #heading off a path', () => {
    assert.deepEqual(splitPathAndAnchor('/abs/foo.md#L12'), { filePath: '/abs/foo.md', anchor: '#L12' });
    assert.deepEqual(splitPathAndAnchor('/abs/foo.md#intro'), { filePath: '/abs/foo.md', anchor: '#intro' });
  });

  it('splitPathAndAnchor leaves Windows drive letters intact', () => {
    // Mid-path colon must not be treated as a line anchor.
    assert.deepEqual(splitPathAndAnchor('C:\\Users\\me\\notes.md'), { filePath: 'C:\\Users\\me\\notes.md' });
  });

  it('splitPathAndAnchor leaves bare strings without anchor untouched', () => {
    assert.deepEqual(splitPathAndAnchor('/abs/foo.md'), { filePath: '/abs/foo.md' });
  });
});
