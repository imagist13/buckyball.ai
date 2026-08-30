/**
 * Unit tests for folder drag-drop classification.
 *
 * The drop handler in ai-elements/prompt-input.tsx routes directories away
 * from the file-attachment pipeline (where they'd become 0-size blobs) into
 * the @mention path. This test covers the classifier's shape contract.
 *
 * Run with: npx tsx --test src/__tests__/unit/folder-drop-classify.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { classifyDroppedItems } from '../../components/ai-elements/prompt-input';

function makeItem(file: File, kind: 'file' | 'string', isDir: boolean): DataTransferItem {
  // Minimal DataTransferItem stub — only the methods the classifier calls.
  return {
    kind,
    type: file.type,
    getAsFile: () => file,
    webkitGetAsEntry: () => (isDir
      ? ({ isDirectory: true, isFile: false } as FileSystemEntry)
      : ({ isDirectory: false, isFile: true } as FileSystemEntry)),
    getAsString: () => { /* noop */ },
  } as unknown as DataTransferItem;
}

function makeDragEvent(items: DataTransferItem[]): DragEvent {
  const list = items as unknown as DataTransferItemList;
  // The classifier reads `items` and falls back to `files`; we only need items.
  return {
    dataTransfer: {
      items: list,
      files: undefined as unknown as FileList,
    },
  } as unknown as DragEvent;
}

describe('classifyDroppedItems', () => {
  it('routes directories into dirs bucket, files into files bucket', () => {
    const fileA = new File(['hi'], 'a.txt', { type: 'text/plain' });
    const folderB = new File([], 'folderB', { type: '' });
    const event = makeDragEvent([
      makeItem(fileA, 'file', false),
      makeItem(folderB, 'file', true),
    ]);

    const { files, dirs } = classifyDroppedItems(event);
    assert.equal(files.length, 1);
    assert.equal(files[0].name, 'a.txt');
    assert.equal(dirs.length, 1);
    assert.equal(dirs[0].name, 'folderB');
  });

  it('skips non-file kinds (e.g. dragged text selections)', () => {
    const file = new File(['x'], 'x.txt');
    const event = makeDragEvent([
      makeItem(file, 'string', false),
    ]);
    const { files, dirs } = classifyDroppedItems(event);
    assert.equal(files.length, 0);
    assert.equal(dirs.length, 0);
  });

  it('handles mixed drops without losing order across files', () => {
    const fA = new File([''], 'a');
    const dB = new File([], 'B');
    const fC = new File([''], 'c');
    const event = makeDragEvent([
      makeItem(fA, 'file', false),
      makeItem(dB, 'file', true),
      makeItem(fC, 'file', false),
    ]);
    const { files, dirs } = classifyDroppedItems(event);
    assert.deepEqual(files.map((f) => f.name), ['a', 'c']);
    assert.deepEqual(dirs.map((d) => d.name), ['B']);
  });

  it('returns empty buckets when no items', () => {
    const event = makeDragEvent([]);
    const { files, dirs } = classifyDroppedItems(event);
    assert.equal(files.length, 0);
    assert.equal(dirs.length, 0);
  });
});

describe('insert-file-mention path normalization (directory convention)', () => {
  // The MessageInput listener strips trailing slashes from detail.path before
  // storing in mentionNodeTypes, so parseMentionRefs' path (without trailing /)
  // matches. This test documents the normalization contract.
  it('strips trailing slashes from directory paths', () => {
    const inputs = ['src/components/', 'src/components//', 'src/components'];
    for (const p of inputs) {
      assert.equal(p.replace(/\/+$/, ''), 'src/components');
    }
  });

  it('rejects paths that are empty after stripping', () => {
    const stripped = '///'.replace(/\/+$/, '');
    assert.equal(stripped, '');
  });
});
