/**
 * Runtime capability probe for the `auto_review` profile on the Claude Code
 * path (`runtime-permission-modes.md` Phase 1, a07).
 *
 * Kept out of `profile.ts` so the decision logic there stays pure and
 * table-testable — this module is the only part that touches the installed
 * package on disk.
 *
 * Fail-closed by construction: any failure to read a version means "not
 * supported", so the UI disables the option and says why. It NEVER falls
 * back to acceptEdits or full_access behind the user's back — a permission
 * profile that silently means something else is the exact failure this whole
 * plan exists to prevent.
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { isAutoReviewSupportedForVersion, AUTO_REVIEW_MIN_SDK_VERSION } from './profile';

const SDK_PACKAGE_NAME = '@anthropic-ai/claude-agent-sdk';

let cached: { version: string | null; supported: boolean } | null = null;

/**
 * The SDK does NOT list `./package.json` in its `exports` map, so
 * `require('@anthropic-ai/claude-agent-sdk/package.json')` throws
 * ERR_PACKAGE_PATH_NOT_EXPORTED. Resolve the entry point instead and walk up
 * to the package root — the manifest is readable from disk even when it isn't
 * an allowed subpath import.
 */
function readSdkVersion(): string | null {
  try {
    // Anchor resolution at the runtime application root, not this module's
    // bundled filename. In Next/Turbopack `__filename` points inside a .next
    // chunk, so walking from it can never reach the external SDK package even
    // though node_modules contains 0.2.111. Packaged Electron starts the
    // standalone server with cwd=resources/standalone, where the externalized
    // SDK is copied under node_modules; dev/test cwd is the project root.
    const require_ = createRequire(path.join(process.cwd(), 'package.json'));
    let dir = path.dirname(require_.resolve(SDK_PACKAGE_NAME));
    for (let depth = 0; depth < 8; depth++) {
      const manifest = path.join(dir, 'package.json');
      if (fs.existsSync(manifest)) {
        const pkg = JSON.parse(fs.readFileSync(manifest, 'utf-8')) as { name?: string; version?: string };
        // Only trust the SDK's OWN manifest — walking up from a nested dist/
        // directory can hit an unrelated package.json first.
        if (pkg.name === SDK_PACKAGE_NAME) {
          return typeof pkg.version === 'string' ? pkg.version : null;
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // fall through — unreadable means unsupported, never "assume yes"
  }
  return null;
}

/** Installed `@anthropic-ai/claude-agent-sdk` version, or null if unreadable. */
export function getAgentSdkVersion(): string | null {
  if (cached) return cached.version;
  const version = readSdkVersion();
  cached = { version, supported: isAutoReviewSupportedForVersion(version) };
  return cached.version;
}

/**
 * Whether the installed SDK understands `permissionMode: 'auto'`.
 * Drives both the wire-option resolution and the UI's disabled state.
 */
export function isAutoReviewSupported(): boolean {
  if (!cached) getAgentSdkVersion();
  return cached!.supported;
}

/**
 * Machine-readable reason for the UI when the option is unavailable.
 * `null` when it IS available.
 */
export function getAutoReviewUnavailableReason(): { minVersion: string; installedVersion: string | null } | null {
  if (isAutoReviewSupported()) return null;
  return { minVersion: AUTO_REVIEW_MIN_SDK_VERSION, installedVersion: getAgentSdkVersion() };
}

/** Test-only — drop the memoised probe. */
export function __resetAgentSdkCapabilityCache(): void {
  cached = null;
}
