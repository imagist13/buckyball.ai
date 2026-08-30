import '../db-isolation.setup';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  getHtmlBundleDisplayTitle,
  getHtmlBundlePreviewLocation,
  materializeHtmlBundle,
} from '@/lib/assets/html-bundle-materializer';
import { getAssetRecord, reconcileAssetIntegrity, toTypedAssetRef } from '@/lib/assets/service';
import { listAssetKinds } from '@/lib/assets/kind-registry';
import { buildHtmlPreviewUrl } from '@/lib/html-preview-url';
import { getDb } from '@/lib/db';

function createWorkspace(): {
  root: string;
  pageDir: string;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'html-bundle-workspace-'));
  const pageDir = path.join(root, 'site');
  fs.mkdirSync(path.join(pageDir, 'assets'), { recursive: true });
  fs.writeFileSync(
    path.join(pageDir, 'index.html'),
    `<!doctype html>
     <html><head><link rel="stylesheet" href="./styles.css"></head>
     <body><img src="./assets/pixel.png"><a href="https://example.com">Source</a></body></html>`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(pageDir, 'styles.css'),
    'body { color: rebeccapurple; }',
    'utf8',
  );
  fs.writeFileSync(
    path.join(pageDir, 'assets', 'pixel.png'),
    Buffer.from('pixel-bytes'),
  );
  return { root, pageDir };
}

describe('HTML bundle materialization conformance', () => {
  it('registers html_bundle only with a complete producer/validator/preview chain', () => {
    const descriptor = listAssetKinds().find((kind) => kind.id === 'html_bundle');
    assert.ok(descriptor);
    assert.deepEqual(descriptor.producers, [
      'html-bundle:workspace-materializer',
      'html-bundle:user-selected-inline',
    ]);
    assert.match(descriptor.trustPolicy, /sandbox/);
    assert.match(descriptor.trustPolicy, /CSP/);
  });

  it('copies a bounded workspace bundle, hashes all files, and is idempotent', () => {
    const workspace = createWorkspace();
    try {
      const input = {
        terminalState: 'completed' as const,
        source: {
          kind: 'workspace' as const,
          sourceDir: workspace.pageDir,
          entryFile: 'index.html',
          scopeRoot: workspace.root,
        },
        sessionId: 'session-html-workspace',
        projectId: 'project-html-workspace',
        runtimeId: 'codepilot_runtime',
        providerId: 'provider-test',
        modelId: 'model-test',
        prompt: 'A durable web page',
        methodRef: 'method:web-v1',
      };
      const first = materializeHtmlBundle(input);
      const retry = materializeHtmlBundle(input);
      assert.equal(retry.id, first.id);
      assert.equal(first.kind, 'html_bundle');
      assert.equal(first.integrity_state, 'valid');
      assert.equal(first.runtime_id, 'codepilot_runtime');
      assert.equal(first.method_ref, 'method:web-v1');
      assert.match(first.content_hash, /^sha256:[a-f0-9]{64}$/);
      assert.deepEqual(toTypedAssetRef(first), {
        assetId: first.id,
        kind: 'html_bundle',
        contentHash: first.content_hash,
      });

      const preview = getHtmlBundlePreviewLocation(first);
      assert.equal(fs.existsSync(preview.entryPath), true);
      assert.equal(fs.existsSync(path.join(preview.bundleRoot, 'styles.css')), true);
      const previewUrl = buildHtmlPreviewUrl(
        preview.entryPath,
        { kind: 'workspace', baseDir: preview.bundleRoot },
      );
      assert.match(previewUrl, /^\/api\/files\/html-preview\/ws\./);
      assert.ok(!previewUrl.includes('interactive=1'));

      const metadata = JSON.parse(first.metadata) as {
        fileCount: number;
        externalUrls: string[];
      };
      assert.equal(metadata.fileCount, 3);
      assert.deepEqual(metadata.externalUrls, ['https://example.com']);

      fs.writeFileSync(
        path.join(workspace.pageDir, 'styles.css'),
        'body { color: steelblue; }',
        'utf8',
      );
      const changed = materializeHtmlBundle(input);
      assert.notEqual(changed.id, first.id);
      assert.notEqual(changed.content_hash, first.content_hash);
    } finally {
      fs.rmSync(workspace.root, { recursive: true, force: true });
    }
  });

  it('archives a workspace page without sweeping unrelated project files', () => {
    const workspace = fs.mkdtempSync(
      path.join(os.tmpdir(), 'html-entry-closure-'),
    );
    try {
      fs.writeFileSync(
        path.join(workspace, 'index.html'),
        '<!doctype html><html><body><h1>Focused bundle</h1></body></html>',
        'utf8',
      );
      const unrelated = path.join(workspace, 'unrelated');
      fs.mkdirSync(unrelated);
      for (let index = 0; index < 520; index++) {
        fs.writeFileSync(
          path.join(unrelated, `note-${index}.txt`),
          `unrelated ${index}`,
          'utf8',
        );
      }

      const asset = materializeHtmlBundle({
        terminalState: 'completed',
        source: {
          kind: 'workspace',
          sourceDir: workspace,
          entryFile: 'index.html',
          scopeRoot: workspace,
        },
        sessionId: 'session-entry-closure',
      });
      const metadata = JSON.parse(asset.metadata) as {
        bundleRoot: string;
        fileCount: number;
      };
      assert.equal(metadata.fileCount, 1);
      assert.equal(
        fs.existsSync(path.join(metadata.bundleRoot, 'unrelated')),
        false,
      );
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('archives manifest/icon links and discloses external connection hints', () => {
    const workspace = fs.mkdtempSync(
      path.join(os.tmpdir(), 'html-link-rel-closure-'),
    );
    try {
      fs.writeFileSync(
        path.join(workspace, 'index.html'),
        `<!doctype html><html><head>
          <link rel="manifest" href="./app.webmanifest">
          <link rel="apple-touch-icon" href="./touch.png">
          <link rel="preconnect" href="https://cdn.example.com">
          <link rel="dns-prefetch" href="https://fonts.example.com">
        </head><body>Archived app</body></html>`,
        'utf8',
      );
      fs.writeFileSync(
        path.join(workspace, 'app.webmanifest'),
        '{"name":"Archived app"}',
        'utf8',
      );
      fs.writeFileSync(path.join(workspace, 'touch.png'), 'png-bytes', 'utf8');

      const asset = materializeHtmlBundle({
        terminalState: 'completed',
        source: {
          kind: 'workspace',
          sourceDir: workspace,
          entryFile: 'index.html',
          scopeRoot: workspace,
        },
        sessionId: 'session-link-rel-closure',
      });
      const metadata = JSON.parse(asset.metadata) as {
        bundleRoot: string;
        fileCount: number;
        externalUrls: string[];
      };
      assert.equal(metadata.fileCount, 3);
      assert.equal(
        fs.existsSync(path.join(metadata.bundleRoot, 'app.webmanifest')),
        true,
      );
      assert.equal(
        fs.existsSync(path.join(metadata.bundleRoot, 'touch.png')),
        true,
      );
      assert.deepEqual(metadata.externalUrls, [
        'https://cdn.example.com',
        'https://fonts.example.com',
      ]);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('removes bidi and invisible control characters from HTML display titles', () => {
    const asset = materializeHtmlBundle({
      terminalState: 'completed',
      source: {
        kind: 'inline',
        html: '<!doctype html><title>Quarterly \u202Egpj.exe\u202C\u200B Report</title>',
      },
      sessionId: 'session-bidi-title',
    });
    const metadata = JSON.parse(asset.metadata) as { pageTitle: string };
    assert.equal(metadata.pageTitle, 'Quarterly gpj.exe Report');
    assert.equal(getHtmlBundleDisplayTitle(asset), 'Quarterly gpj.exe Report');

    const poisonedMetadata = {
      ...JSON.parse(asset.metadata),
      pageTitle: 'Trusted\u2066 disguised.exe\u2069',
    };
    getDb().prepare(
      'UPDATE asset_records SET metadata = ? WHERE id = ?',
    ).run(JSON.stringify(poisonedMetadata), asset.id);
    assert.equal(
      getHtmlBundleDisplayTitle(getAssetRecord(asset.id)!),
      'Trusted disguised.exe',
    );
  });

  it('does not materialize local anchor targets as bundle dependencies', () => {
    const workspace = fs.mkdtempSync(
      path.join(os.tmpdir(), 'html-anchor-closure-'),
    );
    try {
      fs.writeFileSync(
        path.join(workspace, 'index.html'),
        '<a href="./">Home</a><a href="./missing.json">Missing</a>'
          + '<a href="%23section">Section</a>',
        'utf8',
      );
      const asset = materializeHtmlBundle({
        terminalState: 'completed',
        source: {
          kind: 'workspace',
          sourceDir: workspace,
          entryFile: 'index.html',
          scopeRoot: workspace,
        },
      });
      const metadata = JSON.parse(asset.metadata) as { fileCount: number };
      assert.equal(metadata.fileCount, 1);
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('scans a large malformed tag in bounded linear time', () => {
    const malformed = `<img src="${'x'.repeat(768 * 1024)}`;
    const startedAt = Date.now();
    const asset = materializeHtmlBundle({
      terminalState: 'completed',
      source: {
        kind: 'inline',
        html: `<!doctype html><html><body>${malformed}</body></html>`,
      },
      sessionId: 'session-malformed-linear-scan',
    });
    const elapsedMs = Date.now() - startedAt;
    assert.equal(asset.kind, 'html_bundle');
    assert.ok(
      elapsedMs < 1_500,
      `malformed 768 KiB tag took ${elapsedMs}ms; scanner may have regressed`,
    );
  });

  it('ignores encoded document fragments nested inside a data SVG', () => {
    const workspace = fs.mkdtempSync(
      path.join(os.tmpdir(), 'html-data-svg-fragment-'),
    );
    try {
      fs.writeFileSync(
        path.join(workspace, 'index.html'),
        `<!doctype html>
<html>
  <style>
    .noise {
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'/%3E%3Crect filter='url(%23n)'/%3E%3C/svg%3E");
    }
  </style>
</html>`,
        'utf8',
      );

      const asset = materializeHtmlBundle({
        terminalState: 'completed',
        source: {
          kind: 'workspace',
          sourceDir: workspace,
          entryFile: 'index.html',
          scopeRoot: workspace,
        },
        sessionId: 'session-data-svg-fragment',
      });
      const metadata = JSON.parse(asset.metadata) as { fileCount: number };
      assert.equal(metadata.fileCount, 1);
      assert.equal(asset.integrity_state, 'valid');
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('archives an explicit inline snapshot as a single-file static bundle', () => {
    const asset = materializeHtmlBundle({
      terminalState: 'completed',
      source: {
        kind: 'inline',
        html: '<!doctype html><html><body><h1>Snapshot</h1></body></html>',
      },
      sessionId: 'session-inline',
      prompt: 'Selected inline artifact',
    });
    assert.equal(asset.producer_id, 'html-bundle:user-selected-inline');
    assert.equal(asset.trust_tier, 'user_selected_inline');
    assert.equal(fs.readFileSync(asset.stable_path, 'utf8').includes('Snapshot'), true);
    const preview = getHtmlBundlePreviewLocation(asset);
    assert.equal(
      fs.existsSync(path.join(path.dirname(preview.bundleRoot), 'inline-source')),
      false,
    );
  });

  it('never creates success Assets for partial or failed output', () => {
    const countBefore = (
      getDb().prepare(
        "SELECT COUNT(*) AS count FROM asset_records WHERE kind = 'html_bundle'",
      ).get() as { count: number }
    ).count;
    for (const terminalState of ['partial', 'failed'] as const) {
      assert.throws(
        () => materializeHtmlBundle({
          terminalState,
          source: { kind: 'inline', html: '<h1>Incomplete</h1>' },
        }),
        /cannot materialize/,
      );
    }
    const countAfter = (
      getDb().prepare(
        "SELECT COUNT(*) AS count FROM asset_records WHERE kind = 'html_bundle'",
      ).get() as { count: number }
    ).count;
    assert.equal(countAfter, countBefore);
  });

  it('rejects source-scope escape, symlinks, dangerous URLs, and embedded navigation', () => {
    const workspace = createWorkspace();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'html-bundle-outside-'));
    fs.writeFileSync(path.join(outside, 'index.html'), '<h1>Outside</h1>', 'utf8');
    assert.throws(
      () => materializeHtmlBundle({
        terminalState: 'completed',
        source: {
          kind: 'workspace',
          sourceDir: outside,
          entryFile: 'index.html',
          scopeRoot: workspace.root,
        },
      }),
      /outside the session workspace/,
    );

    fs.writeFileSync(path.join(outside, 'styles.css'), 'body { color: red; }', 'utf8');
    const linkedAssets = path.join(workspace.pageDir, 'linked-assets');
    // A directory junction needs no Developer Mode/admin privilege on Windows,
    // so this security assertion runs there instead of silently disappearing
    // on EPERM from an unprivileged file-symlink fixture.
    fs.symlinkSync(outside, linkedAssets, process.platform === 'win32' ? 'junction' : 'dir');
    fs.writeFileSync(
      path.join(workspace.pageDir, 'index.html'),
      '<html><head><link rel="stylesheet" href="./linked-assets/styles.css"></head></html>',
      'utf8',
    );
    assert.throws(
      () => materializeHtmlBundle({
        terminalState: 'completed',
        source: {
          kind: 'workspace',
          sourceDir: workspace.pageDir,
          entryFile: 'index.html',
          scopeRoot: workspace.root,
        },
      }),
      /symlink/,
    );
    fs.unlinkSync(linkedAssets);

    for (const html of [
      '<html><script src="https://example.com/evil.js"></script></html>',
      '<html><img src="file:///etc/passwd"></html>',
      '<html><iframe src="https://example.com"></iframe></html>',
      '<html><meta http-equiv="refresh" content="0;url=https://example.com"></html>',
    ]) {
      assert.throws(
        () => materializeHtmlBundle({
          terminalState: 'completed',
          source: { kind: 'inline', html },
        }),
        /External scripts|unsafe URL|unsupported embedded|meta refresh/,
      );
    }

    fs.rmSync(workspace.root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it('reconciles the aggregate bundle hash instead of only the entry file', () => {
    const workspace = createWorkspace();
    try {
      const asset = materializeHtmlBundle({
        terminalState: 'completed',
        source: {
          kind: 'workspace',
          sourceDir: workspace.pageDir,
          entryFile: 'index.html',
          scopeRoot: workspace.root,
        },
      });
      const preview = getHtmlBundlePreviewLocation(asset);
      fs.writeFileSync(
        path.join(preview.bundleRoot, 'styles.css'),
        'body { color: tomato; }',
        'utf8',
      );
      assert.equal(reconcileAssetIntegrity(asset.id).integrity_state, 'modified');
      assert.equal(getAssetRecord(asset.id)?.lifecycle_state, 'active');
    } finally {
      fs.rmSync(workspace.root, { recursive: true, force: true });
    }
  });
});
