/**
 * Local-file link detection — Phase 4 P2.1.
 *
 * The chat renders markdown via streamdown, which turns `[label](path)`
 * into an `<a href="path">label</a>`. When the path points at a local
 * filesystem reference (absolute, file URL, or a relative previewable
 * file/directory), the default behaviour — let the browser navigate — is
 * wrong: the
 * browser tries to follow a relative URL against the current
 * `localhost:3000` page and 404s. The DOM-walk enrichment in
 * `DevOutputChips` instead routes the click through a scoped filesystem
 * probe, but only after these helpers say "yes, this looks like a local
 * filesystem reference."
 *
 * Pure functions so the contract can be unit-tested without jsdom.
 */

import { PREVIEWABLE_FILE_EXTENSIONS } from './dev-output-parser';
import { resolveToolPath } from '../file-write-tools';

/**
 * Return true for hrefs that obviously aren't local file paths and
 * should NOT be intercepted (http/https/mailto/tel/data/javascript/
 * blob/fragment-only-anchors/protocol-relative).
 */
export function looksLikeRemoteHref(href: string): boolean {
  if (!href) return true;
  // A Windows drive letter is a filesystem root, not a URI scheme.
  if (/^[A-Za-z]:[\\/]/.test(href)) return false;
  if (href.startsWith('//')) return true;
  if (href.startsWith('#')) return true;
  return /^[a-z][a-z0-9+.-]*:/i.test(href);
}

export interface LocalMarkdownReference {
  filePath: string;
  anchor?: string;
}

function decodePath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Convert a Markdown href into a local filesystem reference when it is safe
 * to treat it as one. This is deliberately separate from the eventual
 * file-vs-directory decision: only the server may inspect the filesystem.
 *
 * `file://` is accepted here rather than handed to Chromium. It still goes
 * through the same workspace/external trust gate as a plain absolute path,
 * so an AI-authored file URL can never navigate the Electron window.
 */
export function parseLocalMarkdownReference(
  href: string,
): LocalMarkdownReference | null {
  if (!href) return null;

  let rawPath = href;
  let anchor: string | undefined;

  if (/^file:/i.test(href)) {
    try {
      const url = new URL(href);
      if (url.protocol !== 'file:') return null;
      // Remote file hosts are not local paths. `localhost` is the only
      // harmless hostname form browsers commonly emit for local file URLs.
      if (url.hostname && url.hostname !== 'localhost') return null;
      rawPath = decodePath(url.pathname);
      if (/^\/[A-Za-z]:\//.test(rawPath)) rawPath = rawPath.slice(1);
      anchor = url.hash ? url.hash : undefined;
    } catch {
      return null;
    }
  } else {
    if (looksLikeRemoteHref(href)) return null;
    // Imported lazily at module level would create a markdown helper cycle;
    // the two supported anchor forms are small enough to keep local here.
    const hashIndex = href.indexOf('#');
    if (hashIndex >= 0) {
      rawPath = href.slice(0, hashIndex);
      anchor = href.slice(hashIndex) || undefined;
    } else {
      const lineMatch = href.match(/(:\d+(?::\d+)?)$/);
      if (lineMatch) {
        rawPath = href.slice(0, -lineMatch[1].length);
        anchor = lineMatch[1];
      }
    }
    rawPath = decodePath(rawPath);
  }

  if (!isPotentialLocalFile(rawPath)) return null;
  return { filePath: rawPath, ...(anchor ? { anchor } : {}) };
}

/**
 * Return true when the path could be a local filesystem reference the user
 * might want to open. Acceptance rules:
 *   1. Absolute path (POSIX `/foo` or Windows `C:\foo`).
 *   2. Has a previewable extension (`.md`, `.html`, `.json`, etc.).
 *   3. Explicit relative-directory shape (`./docs`, `../docs`, `docs/`).
 *
 * Relative paths without a previewable extension fall through — we
 * don't want every `[link](foo.bar)` to become a file ref.
 */
export function isPotentialLocalFile(path: string): boolean {
  if (!path) return false;
  if (path.startsWith('/')) return true;
  if (/^[A-Za-z]:[\\/]/.test(path)) return true;
  if (/^(?:\.\.?)[\\/]/.test(path)) return true;
  if (/[\\/]$/.test(path)) return true;
  const dot = path.lastIndexOf('.');
  if (dot < 0) return false;
  const ext = path.slice(dot).toLowerCase().replace(/[#:].*$/, '');
  return PREVIEWABLE_FILE_EXTENSIONS.has(ext);
}

type MarkdownLinkNode = {
  type?: string;
  url?: string;
  children?: MarkdownLinkNode[];
};

/**
 * Resolve local Markdown destinations before Streamdown's hardening pass.
 * rehype-harden otherwise blocks bare `README.md` and rewrites `./docs` to
 * `/docs`, losing the workspace-relative meaning before our link component can
 * inspect it. Dangerous protocols are untouched and remain blocked upstream.
 */
export function remarkResolveLocalLinks(options?: { workingDirectory?: string }) {
  return (tree: MarkdownLinkNode): void => {
    const visit = (node: MarkdownLinkNode) => {
      if (node.type === 'link' && typeof node.url === 'string') {
        const reference = parseLocalMarkdownReference(node.url);
        if (reference) {
          const resolvedPath = resolveToolPath(
            reference.filePath,
            options?.workingDirectory,
          );
          if (resolvedPath.startsWith('/') || /^[A-Za-z]:[/\\]/.test(resolvedPath)) {
            node.url = `${resolvedPath}${reference.anchor || ''}`;
          }
        }
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}
