/**
 * Phase 4.C — Markdown → HTML presentation templates.
 *
 * Coverage:
 *  - all four templates produce valid HTML containing the source body
 *  - source backlink string is present in the footer (the rendered
 *    HTML always shows where it came from)
 *  - frontmatter title overrides body heading
 *  - body heading fallback when no frontmatter title
 *  - filename fallback when no title at all
 *  - basic markdown → html serialization (lists, code, links, bold)
 *
 * Run: npx tsx --test src/__tests__/unit/presentation-templates.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPresentationArtifactPath,
  PRESENTATION_TEMPLATES,
  getTemplate,
  renderMarkdownToHtml,
  renderPresentation,
  slugifyPresentationArtifactName,
} from '../../lib/markdown/presentation-templates';

describe('renderPresentation — template + structure', () => {
  it('every template id resolves to itself', () => {
    for (const t of PRESENTATION_TEMPLATES) {
      assert.equal(getTemplate(t.id).id, t.id);
    }
  });

  it('unknown id falls back to the first template', () => {
    assert.equal(getTemplate('not-a-real-template').id, PRESENTATION_TEMPLATES[0].id);
  });

  it('produces a self-contained HTML document', () => {
    const html = renderPresentation({
      templateId: 'article',
      sourcePath: '/abs/notes.md',
      body: '# Hello\n\nBody line.',
    });
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /<style>/);
    assert.match(html, /<\/html>$/);
  });

  it('all four templates render the body content', () => {
    for (const t of PRESENTATION_TEMPLATES) {
      const html = renderPresentation({
        templateId: t.id,
        sourcePath: '/abs/notes.md',
        body: '# Hello\n\nThis is the body text.',
      });
      assert.match(html, /Hello/, `template ${t.id} should include title`);
      assert.match(html, /This is the body text/, `template ${t.id} should include body`);
      assert.match(html, /codepilot-template-/, `template ${t.id} should set its class`);
    }
  });

  it('renders the source path as a backlink in the footer', () => {
    const html = renderPresentation({
      templateId: 'report',
      sourcePath: '/Users/me/notes/spec.md',
      body: '# Spec',
    });
    // The footer surfaces "Source: <code>...</code>" — escapeHtml
    // doesn't touch alphanumerics + slashes, so the literal substring
    // appears in the output.
    assert.match(html, /Source:.*\/Users\/me\/notes\/spec\.md/);
  });

  it('frontmatter title overrides body heading', () => {
    const html = renderPresentation({
      templateId: 'article',
      sourcePath: '/x/y.md',
      body: '# Body Heading\n\nBody',
      frontmatter: { title: 'Frontmatter Title' },
    });
    // Title appears in the header; body heading appears in the body.
    // We just assert frontmatter title is present.
    assert.match(html, /Frontmatter Title/);
  });

  it('falls back to body heading when frontmatter has no title', () => {
    const html = renderPresentation({
      templateId: 'article',
      sourcePath: '/x/y.md',
      body: '# Body Heading\n\nBody',
    });
    assert.match(html, /<h1>Body Heading<\/h1>/);
  });

  it('falls back to filename when no title or heading present', () => {
    const html = renderPresentation({
      templateId: 'article',
      sourcePath: '/x/notes.md',
      body: 'Just a paragraph.',
    });
    assert.match(html, /notes\.md/);
  });

  it('renders frontmatter metadata strip', () => {
    const html = renderPresentation({
      templateId: 'article',
      sourcePath: '/x/y.md',
      body: '# Title\n\nBody',
      frontmatter: { author: 'Alice', tags: ['note', 'draft'] },
    });
    assert.match(html, /author/);
    assert.match(html, /Alice/);
    assert.match(html, /note, draft/);
  });
});

describe('presentation artifact helpers', () => {
  it('slugifies artifact names conservatively', () => {
    assert.equal(slugifyPresentationArtifactName('My Notes v2'), 'my-notes-v2');
    assert.equal(slugifyPresentationArtifactName(''), 'markdown-artifact');
    assert.equal(slugifyPresentationArtifactName('---'), 'markdown-artifact');
  });

  it('saves derived HTML under the workspace artifact directory', () => {
    assert.equal(
      buildPresentationArtifactPath('/workspace/docs/My Notes.md', '/workspace'),
      '/workspace/.codepilot/artifacts/my-notes.html',
    );
    assert.equal(
      buildPresentationArtifactPath('/workspace/docs/Report.mdx', '/workspace/'),
      '/workspace/.codepilot/artifacts/report.html',
    );
  });
});

describe('renderMarkdownToHtml', () => {
  it('handles headings, paragraphs, lists, blockquotes', () => {
    const html = renderMarkdownToHtml(
      `# A\n\n## B\n\n- one\n- two\n\n1. first\n2. second\n\n> a quote\n\nplain paragraph.`,
    );
    assert.match(html, /<h1>A<\/h1>/);
    assert.match(html, /<h2>B<\/h2>/);
    assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
    assert.match(html, /<ol><li>first<\/li><li>second<\/li><\/ol>/);
    assert.match(html, /<blockquote>a quote<\/blockquote>/);
    assert.match(html, /<p>plain paragraph\.<\/p>/);
  });

  it('renders fenced code with language class', () => {
    const html = renderMarkdownToHtml('```ts\nconst x = 1;\n```');
    assert.match(html, /<pre><code class="language-ts">const x = 1;<\/code><\/pre>/);
  });

  it('renders inline code, bold, italic, links, images', () => {
    const html = renderMarkdownToHtml('Use `npm install`, **strong**, *italic*, [link](https://x), and ![alt](/img.png).');
    assert.match(html, /<code>npm install<\/code>/);
    assert.match(html, /<strong>strong<\/strong>/);
    assert.match(html, /<em>italic<\/em>/);
    assert.match(html, /<a href="https:\/\/x">link<\/a>/);
    assert.match(html, /<img alt="alt" src="\/img\.png">/);
  });

  it('escapes raw HTML in source text', () => {
    const html = renderMarkdownToHtml('Look at <script>alert(1)</script>');
    assert.match(html, /&lt;script&gt;/);
    assert.doesNotMatch(html, /<script>alert/);
  });
});
