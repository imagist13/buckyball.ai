import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ALLOWED_EXTENSIONS = new Set([
  '.html', '.htm', '.css', '.js', '.mjs', '.json', '.webmanifest', '.txt',
  '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.bmp',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp4', '.webm', '.mp3', '.wav', '.ogg',
]);
const MAX_FILES = 512;
const MAX_SCANNED_ENTRIES = 4_096;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

export interface HtmlBundleInspection {
  readonly root: string;
  readonly entryFile: string;
  readonly files: readonly string[];
  readonly byteSize: number;
  readonly contentHash: string;
  readonly externalUrls: readonly string[];
}

function isHiddenRelativePath(relativePath: string): boolean {
  return relativePath.split(/[/\\]/).some((segment) => segment.startsWith('.'));
}

function assertSafeRelativePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (
    !normalized
    || normalized.startsWith('/')
    || normalized === '..'
    || normalized.startsWith('../')
    || normalized.includes('/../')
  ) {
    throw new Error(`HTML bundle path "${relativePath}" escapes its source root.`);
  }
  return normalized;
}

function collectBundleFiles(root: string): {
  files: string[];
  byteSize: number;
} {
  const files: string[] = [];
  let byteSize = 0;
  let scannedEntries = 0;
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      scannedEntries++;
      if (scannedEntries > MAX_SCANNED_ENTRIES) {
        throw new Error(`HTML bundle exceeds ${MAX_SCANNED_ENTRIES} scanned entries.`);
      }
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute);
      if (isHiddenRelativePath(relative)) continue;
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        throw new Error(`HTML bundle cannot contain symlink "${relative}".`);
      }
      if (stat.isDirectory()) {
        visit(absolute);
        continue;
      }
      if (!stat.isFile()) continue;
      if (!ALLOWED_EXTENSIONS.has(path.extname(relative).toLowerCase())) continue;
      if (stat.size > MAX_FILE_BYTES) {
        throw new Error(`HTML bundle file "${relative}" exceeds ${MAX_FILE_BYTES} bytes.`);
      }
      files.push(relative.replace(/\\/g, '/'));
      byteSize += stat.size;
      if (files.length > MAX_FILES) {
        throw new Error(`HTML bundle exceeds ${MAX_FILES} materialized files.`);
      }
      if (byteSize > MAX_TOTAL_BYTES) {
        throw new Error(`HTML bundle exceeds ${MAX_TOTAL_BYTES} total bytes.`);
      }
    }
  };
  visit(root);
  files.sort();
  return { files, byteSize };
}

function extractUrls(content: string): Array<{
  url: string;
  context: string;
}> {
  const urls: Array<{ url: string; context: string }> = [];
  let cursor = 0;
  while (cursor < content.length) {
    const tagStart = content.indexOf('<', cursor);
    if (tagStart < 0) break;

    // Find the closing bracket with a quote-aware linear scan. The previous
    // single regex used nested lazy/greedy repetitions and became quadratic
    // when an Agent emitted a long malformed "<img ..." token without ">".
    let quote = '';
    let tagEnd = -1;
    for (let index = tagStart + 1; index < content.length; index++) {
      const character = content[index];
      if (quote) {
        if (character === quote) quote = '';
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '>') {
        tagEnd = index;
        break;
      }
    }
    if (tagEnd < 0) break;
    cursor = tagEnd + 1;

    const tag = content.slice(tagStart + 1, tagEnd);
    let index = 0;
    while (index < tag.length && /\s/.test(tag[index])) index++;
    if (tag[index] === '/' || tag[index] === '!' || tag[index] === '?') continue;
    const nameStart = index;
    while (index < tag.length && /[a-z0-9:-]/i.test(tag[index])) index++;
    const tagName = tag.slice(nameStart, index).toLowerCase();
    if (!['script', 'link', 'img', 'source', 'video', 'audio', 'a'].includes(tagName)) {
      continue;
    }

    const attributes = new Map<string, string>();
    while (index < tag.length) {
      while (index < tag.length && (/\s/.test(tag[index]) || tag[index] === '/')) {
        index++;
      }
      const attributeStart = index;
      while (index < tag.length && !/[\s=/>]/.test(tag[index])) index++;
      if (index === attributeStart) {
        index++;
        continue;
      }
      const attributeName = tag.slice(attributeStart, index).toLowerCase();
      while (index < tag.length && /\s/.test(tag[index])) index++;
      if (tag[index] !== '=') {
        attributes.set(attributeName, '');
        continue;
      }
      index++;
      while (index < tag.length && /\s/.test(tag[index])) index++;
      const delimiter = tag[index] === '"' || tag[index] === "'" ? tag[index++] : '';
      const valueStart = index;
      if (delimiter) {
        while (index < tag.length && tag[index] !== delimiter) index++;
      } else {
        while (index < tag.length && !/[\s>]/.test(tag[index])) index++;
      }
      attributes.set(attributeName, tag.slice(valueStart, index));
      if (delimiter && tag[index] === delimiter) index++;
    }

    const addAttribute = (attribute: string): void => {
      const value = attributes.get(attribute);
      if (value) {
        urls.push({ url: value, context: `${tagName}.${attribute}` });
      }
    };
    if (tagName === 'script') addAttribute('src');
    if (tagName === 'img' || tagName === 'source') {
      addAttribute('src');
      const srcset = attributes.get('srcset');
      if (srcset) {
        for (const candidate of srcset.split(',')) {
          const url = candidate.trim().split(/\s+/)[0];
          if (url) urls.push({ url, context: `${tagName}.srcset` });
        }
      }
    }
    if (tagName === 'video') {
      addAttribute('src');
      addAttribute('poster');
    }
    if (tagName === 'audio') addAttribute('src');
    if (tagName === 'a') addAttribute('href');
    if (tagName === 'link') {
      const rel = (attributes.get('rel') || '')
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
      const href = attributes.get('href');
      const materializedDependency = rel.some((value) => (
        value === 'stylesheet'
        || value === 'icon'
        || value.endsWith('-icon')
        || value === 'manifest'
        || value === 'preload'
        || value === 'modulepreload'
      ));
      if (href && materializedDependency) {
        urls.push({ url: href, context: 'link.href' });
      } else if (
        href
        && rel.some((value) => value === 'preconnect' || value === 'dns-prefetch')
      ) {
        // Connection hints are not files to archive, but their hostnames are
        // still part of the bundle's external-network disclosure.
        urls.push({ url: href, context: 'link.connection-hint' });
      }
    }
  }
  const cssPattern = /(?:url\(\s*|@import\s+)(?:["']?)([^"')\s;]+)(?:["']?)\s*\)?/gi;
  for (const match of content.matchAll(cssPattern)) {
    urls.push({ url: match[1], context: 'css.resource' });
  }
  return urls;
}

function validateMarkupStructure(content: string, relativePath: string): void {
  if (/<\s*(iframe|object|embed|base|form)\b/i.test(content)) {
    throw new Error(
      `HTML bundle "${relativePath}" contains an unsupported embedded or navigational element.`,
    );
  }
  if (/<meta\b[^>]*http-equiv=["']?refresh/i.test(content)) {
    throw new Error(`HTML bundle "${relativePath}" contains a meta refresh.`);
  }
}

function validateResourceUrl(input: {
  url: string;
  context: string;
  sourceFile: string;
  root: string;
  includedFiles: ReadonlySet<string>;
  externalUrls: Set<string>;
}): void {
  const relative = resolveLocalResourceUrl(input);
  if (relative && !input.includedFiles.has(relative)) {
    throw new Error(
      `HTML bundle resource "${input.url.trim()}" from "${input.sourceFile}" was not materialized.`,
    );
  }
}

function resolveLocalResourceUrl(input: {
  url: string;
  context: string;
  sourceFile: string;
  root: string;
  externalUrls: Set<string>;
}): string | null {
  const raw = input.url.trim();
  if (!raw || raw.startsWith('#')) return null;
  const lowered = raw.toLowerCase();
  if (
    lowered.startsWith('javascript:')
    || lowered.startsWith('vbscript:')
    || lowered.startsWith('file:')
    || lowered.startsWith('data:text/html')
    || lowered.startsWith('//')
  ) {
    throw new Error(`HTML bundle contains unsafe URL "${raw}".`);
  }
  if (/^https?:/i.test(raw)) {
    if (input.context === 'script.src') {
      throw new Error('External scripts are not allowed in archived HTML bundles.');
    }
    input.externalUrls.add(raw);
    return null;
  }
  if (input.context === 'link.connection-hint') return null;
  if (
    lowered.startsWith('data:')
    || lowered.startsWith('blob:')
    || lowered.startsWith('mailto:')
    || lowered.startsWith('tel:')
  ) {
    return null;
  }
  // Links are navigation, not materialized dependencies. Keeping a local
  // <a href="./"> or a dead documentation link must not sweep unrelated files
  // into an Asset or make the entire archive fail.
  if (input.context === 'a.href') return null;
  if (raw.startsWith('/')) {
    throw new Error(`Root-relative URL "${raw}" is outside the archived bundle.`);
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw.split(/[?#]/, 1)[0]);
  } catch {
    throw new Error(`HTML bundle contains malformed URL "${raw}".`);
  }
  // Encoded SVG/CSS fragments such as url(%23noise) are still document-local
  // references. The regex scanner can encounter them inside a data: SVG after
  // it has already ignored the outer data URL, so apply fragment semantics
  // again after decoding rather than treating "#noise" as a local filename.
  if (!decoded || decoded.startsWith('#')) return null;
  const resolved = path.resolve(
    input.root,
    path.dirname(input.sourceFile),
    decoded,
  );
  const relative = path.relative(input.root, resolved).replace(/\\/g, '/');
  assertSafeRelativePath(relative);
  return relative;
}

function inspectReferencedFile(root: string, relativePath: string): {
  relativePath: string;
  byteSize: number;
} {
  const relative = assertSafeRelativePath(relativePath);
  if (isHiddenRelativePath(relative)) {
    throw new Error(`HTML bundle cannot materialize hidden resource "${relative}".`);
  }
  let current = root;
  const segments = relative.split('/');
  for (let index = 0; index < segments.length; index++) {
    current = path.join(current, segments[index]);
    if (!fs.existsSync(current)) {
      throw new Error(`HTML bundle resource "${relative}" does not exist.`);
    }
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new Error(`HTML bundle cannot contain symlink "${relative}".`);
    }
    if (index < segments.length - 1 && !stat.isDirectory()) {
      throw new Error(`HTML bundle resource "${relative}" has an invalid path.`);
    }
    if (index === segments.length - 1) {
      if (!stat.isFile()) {
        throw new Error(`HTML bundle resource "${relative}" is not a file.`);
      }
      if (!ALLOWED_EXTENSIONS.has(path.extname(relative).toLowerCase())) {
        throw new Error(`HTML bundle resource "${relative}" is not materializable.`);
      }
      if (stat.size > MAX_FILE_BYTES) {
        throw new Error(`HTML bundle file "${relative}" exceeds ${MAX_FILE_BYTES} bytes.`);
      }
      return { relativePath: relative, byteSize: stat.size };
    }
  }
  throw new Error(`HTML bundle resource "${relative}" is invalid.`);
}

/**
 * Inspect only the entry document and the local resources it actually
 * references. A workspace root is not a bundle root: recursively sweeping it
 * can capture unrelated user files and makes a one-file page fail merely
 * because its project contains more than MAX_FILES files.
 */
export function inspectHtmlEntryClosure(
  sourceRoot: string,
  entryFileInput: string,
): HtmlBundleInspection {
  const root = fs.realpathSync.native(path.resolve(sourceRoot));
  const entryFile = assertSafeRelativePath(entryFileInput);
  if (!['.html', '.htm'].includes(path.extname(entryFile).toLowerCase())) {
    throw new Error('HTML bundle entry file must be .html or .htm.');
  }

  const queue = [entryFile];
  const includedFiles = new Set<string>();
  const externalUrls = new Set<string>();
  let byteSize = 0;
  while (queue.length > 0) {
    const candidate = queue.shift()!;
    const inspected = inspectReferencedFile(root, candidate);
    if (includedFiles.has(inspected.relativePath)) continue;
    includedFiles.add(inspected.relativePath);
    byteSize += inspected.byteSize;
    if (includedFiles.size > MAX_FILES) {
      throw new Error(`HTML bundle exceeds ${MAX_FILES} materialized files.`);
    }
    if (byteSize > MAX_TOTAL_BYTES) {
      throw new Error(`HTML bundle exceeds ${MAX_TOTAL_BYTES} total bytes.`);
    }

    const ext = path.extname(inspected.relativePath).toLowerCase();
    if (!['.html', '.htm', '.css'].includes(ext)) continue;
    const content = fs.readFileSync(
      path.join(root, inspected.relativePath),
      'utf8',
    );
    if (ext === '.html' || ext === '.htm') {
      validateMarkupStructure(content, inspected.relativePath);
    }
    for (const resource of extractUrls(content)) {
      const localResource = resolveLocalResourceUrl({
        ...resource,
        sourceFile: inspected.relativePath,
        root,
        externalUrls,
      });
      if (localResource && !includedFiles.has(localResource)) {
        queue.push(localResource);
      }
    }
  }

  const files = Array.from(includedFiles).sort();
  const hash = crypto.createHash('sha256');
  for (const relative of files) {
    hash.update(relative);
    hash.update('\0');
    hash.update(fs.readFileSync(path.join(root, relative)));
    hash.update('\0');
  }
  return {
    root,
    entryFile,
    files,
    byteSize,
    contentHash: `sha256:${hash.digest('hex')}`,
    externalUrls: Array.from(externalUrls).sort(),
  };
}

export function inspectHtmlBundle(
  sourceRoot: string,
  entryFileInput: string,
): HtmlBundleInspection {
  const root = fs.realpathSync.native(path.resolve(sourceRoot));
  const entryFile = assertSafeRelativePath(entryFileInput);
  if (!['.html', '.htm'].includes(path.extname(entryFile).toLowerCase())) {
    throw new Error('HTML bundle entry file must be .html or .htm.');
  }
  const entryPath = path.resolve(root, entryFile);
  const entryRelative = path.relative(root, entryPath).replace(/\\/g, '/');
  assertSafeRelativePath(entryRelative);
  if (!fs.existsSync(entryPath) || !fs.statSync(entryPath).isFile()) {
    throw new Error(`HTML bundle entry "${entryFile}" does not exist.`);
  }

  const { files, byteSize } = collectBundleFiles(root);
  const includedFiles = new Set(files);
  if (!includedFiles.has(entryFile)) {
    throw new Error(`HTML bundle entry "${entryFile}" is not materializable.`);
  }
  const externalUrls = new Set<string>();
  for (const relative of files) {
    const ext = path.extname(relative).toLowerCase();
    if (!['.html', '.htm', '.css'].includes(ext)) continue;
    const content = fs.readFileSync(path.join(root, relative), 'utf8');
    if (ext === '.html' || ext === '.htm') {
      validateMarkupStructure(content, relative);
    }
    for (const candidate of extractUrls(content)) {
      validateResourceUrl({
        ...candidate,
        sourceFile: relative,
        root,
        includedFiles,
        externalUrls,
      });
    }
  }

  const hash = crypto.createHash('sha256');
  for (const relative of files) {
    hash.update(relative);
    hash.update('\0');
    hash.update(fs.readFileSync(path.join(root, relative)));
    hash.update('\0');
  }
  return {
    root,
    entryFile,
    files,
    byteSize,
    contentHash: `sha256:${hash.digest('hex')}`,
    externalUrls: Array.from(externalUrls).sort(),
  };
}

export function copyInspectedHtmlBundle(
  inspection: HtmlBundleInspection,
  destinationRoot: string,
): void {
  for (const relative of inspection.files) {
    const destination = path.join(destinationRoot, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(inspection.root, relative), destination);
  }
}
