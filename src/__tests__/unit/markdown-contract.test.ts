/**
 * RC-5: chat and file preview must share one neutral Markdown contract.
 *
 * Chat may override interactive chrome for tables/code, but typography and
 * structural elements must be the exact same component identities.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { defaultRemarkPlugins, Streamdown } from 'streamdown';

import { CHAT_MARKDOWN_COMPONENTS } from '../../components/chat/markdown-components';
import { DevOutputMarkdownLink } from '../../components/chat/DevOutputChips';
import {
  BASE_MARKDOWN_COMPONENTS,
  MARKDOWN_LINK_CLASS_NAME,
  PREVIEW_MARKDOWN_COMPONENTS,
  resolveMarkdownImageSrc,
} from '../../components/markdown/markdown-contract';
import { remarkResolveLocalLinks } from '../../lib/markdown/local-link-detector';

const sharedKeys = [
  'h1',
  'h2',
  'h3',
  'h4',
  'p',
  'ul',
  'ol',
  'li',
  'blockquote',
  'hr',
  'a',
  'strong',
  'img',
  'thead',
  'tbody',
  'pre',
] as const;

describe('CodePilot Markdown component contract', () => {
  it('uses the neutral contract directly in file previews', () => {
    assert.equal(PREVIEW_MARKDOWN_COMPONENTS, BASE_MARKDOWN_COMPONENTS);
  });

  it('keeps chat and preview typography/structure on identical components', () => {
    for (const key of sharedKeys) {
      assert.equal(
        CHAT_MARKDOWN_COMPONENTS[key],
        PREVIEW_MARKDOWN_COMPONENTS[key],
        `${key} should not fork between chat and preview`,
      );
    }
  });

  it('renders the representative typography fixture with CodePilot classes', () => {
    const h1 = renderToStaticMarkup(
      createElement(PREVIEW_MARKDOWN_COMPONENTS.h1, null, 'Heading'),
    );
    const paragraph = renderToStaticMarkup(
      createElement(PREVIEW_MARKDOWN_COMPONENTS.p, null, 'Paragraph'),
    );
    const quote = renderToStaticMarkup(
      createElement(PREVIEW_MARKDOWN_COMPONENTS.blockquote, null, 'Quote'),
    );
    const link = renderToStaticMarkup(
      createElement(PREVIEW_MARKDOWN_COMPONENTS.a, { href: 'https://example.com' }, 'Link'),
    );
    const inlineCode = renderToStaticMarkup(
      createElement(PREVIEW_MARKDOWN_COMPONENTS.code, null, 'const x = 1'),
    );

    assert.match(h1, /text-2xl/);
    assert.match(paragraph, /leading-7/);
    assert.match(quote, /border-l-4/);
    assert.match(link, /target="_blank"/);
    assert.match(link, /text-blue-600/);
    assert.match(link, /dark:text-blue-400/);
    assert.match(inlineCode, /font-mono/);
  });

  it('routes managed absolute media paths through the allowlisted serve endpoint', () => {
    const localPath = '/Users/test/.codepilot/.codepilot-media/generated kitten.png';
    const expected = `/api/media/serve?path=${encodeURIComponent(localPath)}`;
    assert.equal(resolveMarkdownImageSrc(localPath), expected);

    const image = renderToStaticMarkup(
      createElement(PREVIEW_MARKDOWN_COMPONENTS.img, {
        src: localPath,
        alt: 'generated kitten',
      }),
    );
    assert.match(image, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  it('supports file URLs and Windows managed media paths without rewriting normal URLs', () => {
    assert.equal(
      resolveMarkdownImageSrc('file:///Users/test/.codepilot/.codepilot-media/cat%20one.png'),
      `/api/media/serve?path=${encodeURIComponent('/Users/test/.codepilot/.codepilot-media/cat one.png')}`,
    );
    assert.equal(
      resolveMarkdownImageSrc('C:\\Users\\test\\.codepilot\\.codepilot-media\\cat.png'),
      `/api/media/serve?path=${encodeURIComponent('C:\\Users\\test\\.codepilot\\.codepilot-media\\cat.png')}`,
    );
    assert.equal(resolveMarkdownImageSrc('https://cdn.example.com/cat.png'), 'https://cdn.example.com/cat.png');
    assert.equal(resolveMarkdownImageSrc('/images/cat.png'), '/images/cat.png');
    const blob = new Blob(['image']);
    assert.equal(resolveMarkdownImageSrc(blob), blob);
  });

  it('keeps links visibly blue while preserving caller classes', () => {
    const link = renderToStaticMarkup(
      createElement(
        PREVIEW_MARKDOWN_COMPONENTS.a,
        { href: 'README.md', className: 'caller-link-class' },
        'Local file',
      ),
    );

    assert.match(MARKDOWN_LINK_CLASS_NAME, /text-blue-600/);
    assert.match(MARKDOWN_LINK_CLASS_NAME, /hover:text-blue-700/);
    assert.match(MARKDOWN_LINK_CLASS_NAME, /focus-visible:ring-2/);
    assert.match(link, /text-blue-600/);
    assert.match(link, /caller-link-class/);
  });

  it('uses the same blue contract for Codex remote and local links', () => {
    const remoteLink = renderToStaticMarkup(
      createElement(DevOutputMarkdownLink, { href: 'https://example.com' }, 'Remote'),
    );
    const localLink = renderToStaticMarkup(
      createElement(DevOutputMarkdownLink, { href: '/tmp/example.md' }, 'Local'),
    );

    assert.match(remoteLink, /text-blue-600/);
    assert.match(remoteLink, /target="_blank"/);
    assert.match(localLink, /text-blue-600/);
    assert.match(localLink, /data-codepilot-fileref-path="\/tmp\/example.md"/);
  });

  it('preserves Streamdown navigation attributes after the custom renderer runs', () => {
    const localLink = renderToStaticMarkup(
      createElement(
        DevOutputMarkdownLink,
        {
          href: '/workspace/README.md',
          target: '_blank',
          rel: 'noreferrer',
          title: '/workspace/README.md',
        },
        'README',
      ),
    );

    assert.match(localLink, /href="\/workspace\/README.md"/);
    assert.match(localLink, /target="_blank"/);
    assert.match(localLink, /rel="noreferrer"/);
    assert.match(localLink, /title="\/workspace\/README.md"/);
  });

  it('renders dangerous schemes as inert text even if upstream hardening changes', () => {
    const blocked = renderToStaticMarkup(
      createElement(DevOutputMarkdownLink, { href: 'javascript:alert(1)' }, 'Blocked'),
    );
    assert.match(blocked, /<span/);
    assert.doesNotMatch(blocked, /href=/);
    assert.doesNotMatch(blocked, /javascript:/);
  });

  it('routes a real Markdown parse through relative resolution and protocol hardening', () => {
    const markup = renderToStaticMarkup(
      createElement(
        Streamdown,
        {
          mode: 'static',
          components: { a: DevOutputMarkdownLink },
          remarkPlugins: [
            ...Object.values(defaultRemarkPlugins),
            [remarkResolveLocalLinks, { workingDirectory: '/workspace' }],
          ],
        },
        '[README](README.md) [Danger](javascript:alert(1))',
      ),
    );

    assert.match(markup, /href="\/workspace\/README.md"/);
    assert.match(markup, /data-codepilot-fileref-path="\/workspace\/README.md"/);
    assert.match(markup, /title="\/workspace\/README.md"/);
    assert.match(markup, /target="_blank"/);
    assert.doesNotMatch(markup, /href="javascript:/);
  });
});
