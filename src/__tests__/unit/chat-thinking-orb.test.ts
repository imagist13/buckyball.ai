import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ThinkingOrb } from 'thinking-orbs';

const ROOT = path.resolve(__dirname, '../../..');
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');

describe('chat thinking orb', () => {
  it('renders the package inline preset under React 19 with decorative semantics', () => {
    const html = renderToStaticMarkup(
      React.createElement(ThinkingOrb, {
        state: 'working',
        size: 20,
        role: 'presentation',
        'aria-hidden': true,
      }),
    );

    assert.match(html, /<canvas/);
    assert.match(html, /width:20px/);
    assert.match(html, /height:20px/);
    assert.match(html, /role="presentation"/);
    assert.match(html, /aria-hidden="true"/);

    const packageJson = JSON.parse(read('node_modules/thinking-orbs/package.json')) as {
      version?: string;
      license?: string;
    };
    const packageBundle = read('node_modules/thinking-orbs/dist/index.es.js');
    assert.equal(packageJson.version, '0.2.0');
    assert.equal(packageJson.license, 'MIT');
    assert.match(packageBundle, /prefers-reduced-motion: reduce/);
    assert.match(packageBundle, /IntersectionObserver/);
  });

  it('wires working animation to first-token wait and solving animation to live reasoning', () => {
    const streaming = read('src/components/chat/StreamingMessage.tsx');
    const toolGroup = read('src/components/ai-elements/tool-actions-group.tsx');

    assert.match(streaming, /<ThinkingOrb\s+[\s\S]*?state="working"[\s\S]*?size=\{20\}/);
    assert.match(toolGroup, /isStreaming \? \([\s\S]*?<ThinkingOrb\s+[\s\S]*?state="solving"[\s\S]*?size=\{20\}/);
    for (const source of [streaming, toolGroup]) {
      assert.match(source, /role="presentation"/);
      assert.match(source, /aria-hidden="true"/);
    }
  });
});
