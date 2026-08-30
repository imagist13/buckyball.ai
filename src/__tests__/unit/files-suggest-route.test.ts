import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { GET } from '../../app/api/files/suggest/route';

const testRoot = path.join(os.tmpdir(), '.codepilot-test-files-suggest-' + randomUUID());

function req(url: string) {
  return new NextRequest(url);
}

after(() => {
  try {
    fs.rmSync(testRoot, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors in CI
  }
});

describe('/api/files/suggest route', () => {
  it('returns 400 when sessionId and workingDirectory are both missing', async () => {
    const res = await GET(req('http://localhost/api/files/suggest'));
    assert.equal(res.status, 400);
  });

  it('rejects filesystem root workingDirectory', async () => {
    const rootPath = path.parse(process.cwd()).root;
    const res = await GET(
      req(`http://localhost/api/files/suggest?workingDirectory=${encodeURIComponent(rootPath)}`),
    );
    assert.equal(res.status, 403);
  });

  it('accepts workingDirectory outside $HOME when sessionId is not provided', async () => {
    // Before: new-chat @ suggestions rejected anything outside os.homedir(),
    // breaking valid projects on external volumes, /tmp, or mounted
    // workspaces. The workspace the user selected is the trust boundary —
    // only filesystem-root paths should be rejected.
    const outsideHome = path.join(process.cwd(), '.codepilot-non-home-' + randomUUID());
    fs.mkdirSync(outsideHome, { recursive: true });
    try {
      fs.writeFileSync(path.join(outsideHome, 'entry.ts'), '// smoke\n');
      const res = await GET(
        req(`http://localhost/api/files/suggest?workingDirectory=${encodeURIComponent(outsideHome)}`),
      );
      assert.equal(res.status, 200);
      const data = await res.json() as {
        items: Array<{ path: string; type: 'file' | 'directory' }>;
      };
      assert.ok(data.items.some((item) => item.path === 'entry.ts'));
    } finally {
      fs.rmSync(outsideHome, { recursive: true, force: true });
    }
  });

  it('returns relative paths with node type and respects limit', async () => {
    fs.mkdirSync(path.join(testRoot, 'src', 'components'), { recursive: true });
    fs.writeFileSync(path.join(testRoot, 'src', 'app.ts'), 'export const app = 1;\n');
    fs.writeFileSync(path.join(testRoot, 'src', 'components', 'Card.tsx'), 'export default function Card(){}\n');
    fs.writeFileSync(path.join(testRoot, 'README.md'), '# test\n');

    const url = `http://localhost/api/files/suggest?workingDirectory=${encodeURIComponent(testRoot)}&q=src&limit=2`;
    const res = await GET(req(url));
    assert.equal(res.status, 200);

    const data = await res.json() as {
      items: Array<{ path: string; display: string; type: 'file' | 'directory'; nodeType: 'file' | 'directory' }>;
    };
    assert.ok(Array.isArray(data.items));
    assert.ok(data.items.length <= 2);
    assert.ok(data.items.length > 0);

    for (const item of data.items) {
      assert.ok(!path.isAbsolute(item.path), `expected relative path, got ${item.path}`);
      assert.ok(item.type === 'file' || item.type === 'directory');
      assert.equal(item.nodeType, item.type);
      if (item.type === 'directory') {
        assert.ok(item.display.endsWith('/'));
      }
    }
  });
});
