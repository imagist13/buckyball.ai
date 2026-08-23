import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd(), 'src');
const pageSource = fs.readFileSync(
  path.join(root, 'app/gallery/page.tsx'),
  'utf8',
);
const gridSource = fs.readFileSync(
  path.join(root, 'components/gallery/GalleryGrid.tsx'),
  'utf8',
);
const detailSource = fs.readFileSync(
  path.join(root, 'components/gallery/GalleryDetail.tsx'),
  'utf8',
);
const tagEditorSource = fs.readFileSync(
  path.join(root, 'components/gallery/GalleryTagEditor.tsx'),
  'utf8',
);
const previewSource = fs.readFileSync(
  path.join(root, 'components/layout/panels/PreviewPanel.tsx'),
  'utf8',
);
const diffSummarySource = fs.readFileSync(
  path.join(root, 'components/chat/DiffSummary.tsx'),
  'utf8',
);
const messageItemSource = fs.readFileSync(
  path.join(root, 'components/chat/MessageItem.tsx'),
  'utf8',
);
const archiveClientSource = fs.readFileSync(
  path.join(root, 'lib/archive-html-asset-client.ts'),
  'utf8',
);
const enSource = fs.readFileSync(path.join(root, 'i18n/en.ts'), 'utf8');
const zhSource = fs.readFileSync(path.join(root, 'i18n/zh.ts'), 'utf8');

describe('Asset Library UI contract', () => {
  it('derives kind filters from the registry API instead of hard-coded candidates', () => {
    assert.match(pageSource, /fetch\('\/api\/assets\/kinds'\)/);
    assert.match(pageSource, /kinds\.map\(/);
    assert.match(pageSource, /params\.set\('kind', kind\)/);
    assert.match(pageSource, /KIND_ICONS/);
    assert.match(pageSource, /name=\{KIND_ICONS\[entry\.id\] \|\| 'artifact'\}/);
    assert.doesNotMatch(pageSource, /component.*document|document.*component/);
  });

  it('keeps search and primary actions together with kind filters expanded below', () => {
    assert.match(
      pageSource,
      /<Input[\s\S]*gallery\.favoritesOnly[\s\S]*gallery\.newestFirst/,
    );
    assert.match(pageSource, /max-w-sm flex-1/);
    assert.match(pageSource, /ml-auto flex shrink-0/);
    assert.match(pageSource, /gallery\.kindAll[\s\S]*kinds\.map/);
    assert.doesNotMatch(pageSource, /showFilters|gallery\.filters|name="filter"/);
    assert.doesNotMatch(pageSource, /type="date"|dateFrom|dateTo|clearFilters/);
  });

  it('debounces search and prevents stale filter responses from mutating the grid', () => {
    assert.match(pageSource, /setDebouncedQuery\(query\.trim\(\)\)/);
    assert.match(pageSource, /250/);
    assert.match(pageSource, /new AbortController\(\)/);
    assert.match(pageSource, /activeRequestRef\.current\?\.abort\(\)/);
    assert.match(
      pageSource,
      /requestVersion !== requestVersionRef\.current/,
    );
    assert.match(pageSource, /knownIds\.has\(item\.id\)/);
  });

  it('uses a fill-width measured masonry with a bounded 16:9 web preview', () => {
    assert.match(gridSource, /MIN_COLUMN_WIDTH/);
    assert.match(gridSource, /columnCount/);
    assert.match(gridSource, /columnHeights/);
    assert.match(gridSource, /ResizeObserver/);
    assert.match(gridSource, /containerWidth - COLUMN_GAP \* \(columnCount - 1\)/);
    assert.match(gridSource, /className="absolute"/);
    assert.match(gridSource, /className="relative aspect-video w-full overflow-hidden/);
    assert.match(gridSource, /item\.thumbnailUrl/);
    assert.match(gridSource, /\{displayTitle\}/);
  });

  it('uses one stable, visible card outline for hover and keyboard focus', () => {
    assert.match(
      gridSource,
      /ring-0 ring-border[\s\S]*hover:ring-\[3px\][\s\S]*focus-visible:ring-\[3px\]/,
    );
    assert.doesNotMatch(gridSource, /hover:ring-border/);
    assert.doesNotMatch(gridSource, /hover:ring-2/);
    assert.doesNotMatch(gridSource, /transition-shadow/);
  });

  it('renders real audio and static HTML images with an honest failure state', () => {
    assert.match(gridSource, /item\.type === 'audio'/);
    assert.match(gridSource, /item\.type === 'html_bundle'/);
    assert.doesNotMatch(gridSource, /<iframe|sandbox=/);
    assert.doesNotMatch(gridSource, /gallery\.staticWebPreview/);
    assert.match(gridSource, /item\.integrityState === 'missing'/);
    assert.match(detailSource, /<audio/);
    assert.match(detailSource, /item\.thumbnailUrl/);
    assert.doesNotMatch(detailSource, /<iframe|sandbox=|allow-scripts|allow-same-origin/);
    assert.match(detailSource, /gallery\.staticWebPreviewHint/);
  });

  it('archives only explicit HTML previews through the scoped materializer API', () => {
    assert.match(archiveClientSource, /\/api\/assets\/html-bundles/);
    assert.match(archiveClientSource, /ensureHtmlAssetThumbnail/);
    assert.match(previewSource, /archiveHtmlAsset/);
    assert.match(previewSource, /sessionId/);
    assert.match(previewSource, /sourceTrust === 'workspace'/);
    assert.match(previewSource, /filePreview\.archiveAsset\.failed/);
  });

  it('offers the same scoped archive action on workspace HTML chat cards', () => {
    assert.match(diffSummarySource, /onArchiveHtml/);
    assert.match(diffSummarySource, /filePreview\.archiveAsset/);
    assert.match(messageItemSource, /archiveHtmlAsset/);
    assert.match(messageItemSource, /classifyPath\(resolvedPath, workingDirectory\)/);
    assert.match(messageItemSource, /trust === 'workspace'/);
  });

  it('offers a tooltip-labelled system-browser action on workspace HTML chat cards', () => {
    assert.match(diffSummarySource, /onOpenInSystemBrowser/);
    assert.match(diffSummarySource, /file\.archiveable === true/);
    assert.match(diffSummarySource, /diffSummary\.openSystemBrowser/);
    assert.match(diffSummarySource, /name="external"/);
    assert.match(messageItemSource, /inspectLocalPath\([\s\S]{0,120}file\.path/);
    assert.match(messageItemSource, /openHtmlFileWithSystem\(/);
    assert.match(messageItemSource, /inspection\.realPath/);
  });

  it('uses permanent-delete confirmation copy and exposes no Trash/Restore UI', () => {
    for (const source of [enSource, zhSource]) {
      assert.match(source, /'gallery\.deleteFailed'/);
      assert.match(source, /'gallery\.deleteConfirm'/);
      assert.match(source, /'gallery\.deleteBlocked'/);
      assert.doesNotMatch(source, /'gallery\.(?:trash|activeAssets|moveToTrash|recoverableDelete|restore|restoreFailed|trashFailed)'/);
    }
    assert.match(detailSource, /gallery\.deleteConfirm/);
    assert.match(detailSource, /gallery\.confirmDelete/);
    assert.match(detailSource, /name="delete"/);
    assert.match(detailSource, /gallery\.deleteBlocked/);
    assert.doesNotMatch(detailSource, /restore|recoverableDelete|moveToTrash/);
    assert.doesNotMatch(pageSource, /showTrash|lifecycle|restore/);
  });

  it('offers real tag mutation from the context menu and detail panel', () => {
    assert.match(gridSource, /<ContextMenu>/);
    assert.match(gridSource, /onManageTags\(item\)/);
    assert.match(gridSource, /onToggleFavorite\(item\)/);
    assert.match(gridSource, /onRequestDelete\(item\)/);
    assert.match(pageSource, /\/api\/assets\/\$\{encodeURIComponent\(id\)\}\/tags/);
    assert.match(pageSource, /<GalleryTagDialog/);
    assert.match(detailSource, /<GalleryTagEditor/);
    assert.match(tagEditorSource, /gallery\.newTagPlaceholder/);
    assert.match(tagEditorSource, /tags\.filter/);
  });

  it('uses a larger solid favorite mark and distinguishes labels from actions', () => {
    assert.match(gridSource, /left-2\.5 top-2\.5/);
    assert.match(gridSource, /name="favorite"[\s\S]*size="lg"[\s\S]*fill-current/);
    assert.match(detailSource, /variant="outline"[\s\S]*name="favorite"/);
    assert.match(detailSource, /className="gap-1\.5 text-foreground"/);
    assert.doesNotMatch(
      detailSource,
      /<Button[\s\S]{0,300}text-status-error-foreground[\s\S]{0,300}removeFromFavorites/,
    );
    assert.match(detailSource, /<Badge variant="secondary" className="border-0 text-\[10px\]"/);
  });

  it('keeps the detail dialog within the viewport and scrolls the info panel', () => {
    assert.match(detailSource, /h-\[calc\(100dvh-4rem\)\]/);
    assert.match(detailSource, /grid-rows-\[minmax\(0,1fr\)\]/);
    assert.match(detailSource, /flex h-full min-h-0 flex-row overflow-hidden/);
    assert.match(
      detailSource,
      /min-h-0 min-w-0 flex-1[\s\S]*overflow-y-auto overscroll-contain/,
    );
  });

  it('surfaces provenance, integrity, lineage, and consumers from real fields', () => {
    for (const field of [
      'producerId',
      'projectId',
      'runtimeId',
      'methodRef',
      'integrityState',
    ]) {
      assert.match(detailSource, new RegExp(`item\\.${field}`));
    }
    assert.match(detailSource, /assetDetail\.lineage/);
    assert.match(detailSource, /assetDetail\.consumers/);
  });
});
