/**
 * Strict parser/comparator for `codex --version` output.
 *
 * Accepted forms are the actual CLI output (`codex-cli 0.145.0-alpha.18`),
 * the app-server user agent (`Codex Desktop/0.147.0-alpha.6.5 (...)`), and a
 * bare release used by constants/tests. Anchoring and the explicit product
 * prefix are intentional: an unrelated user-agent or diagnostic string that
 * happens to contain another semver must never satisfy a capability gate.
 */

export interface ParsedCodexRelease {
  readonly core: [number, number, number];
  /** `null` is a stable release and therefore newer than any prerelease. */
  readonly prerelease: readonly string[] | null;
}

const RELEASE_SOURCE = '(\\d+)\\.(\\d+)\\.(\\d+)(?:-([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?';
const CODEX_CLI_RELEASE_PATTERN = new RegExp(`^(?:codex-cli\\s+)?${RELEASE_SOURCE}$`);
const CODEX_DESKTOP_RELEASE_PATTERN = new RegExp(
  `^Codex Desktop/${RELEASE_SOURCE}(?:\\s+\\([^()\\r\\n]*\\))?(?:\\s+[0-9A-Za-z_-]+(?:\\s+\\([^()\\r\\n]*\\))?)?$`,
);

export function parseCodexRelease(
  versionOutput: string | null | undefined,
): ParsedCodexRelease | null {
  if (!versionOutput) return null;
  const normalized = versionOutput.trim();
  const match = normalized.match(CODEX_CLI_RELEASE_PATTERN)
    ?? normalized.match(CODEX_DESKTOP_RELEASE_PATTERN);
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split('.') : null,
  };
}

function compareCodexCore(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

export function compareCodexRelease(
  a: ParsedCodexRelease,
  b: ParsedCodexRelease,
): number {
  const core = compareCodexCore(a.core, b.core);
  if (core !== 0) return core;
  if (a.prerelease === null && b.prerelease === null) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;

  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const left = a.prerelease[index];
    const right = b.prerelease[index];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    if (left === right) continue;
    const leftNumber = /^\d+$/.test(left) ? Number(left) : null;
    const rightNumber = /^\d+$/.test(right) ? Number(right) : null;
    if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber;
    if (leftNumber !== null) return -1;
    if (rightNumber !== null) return 1;
    return left.localeCompare(right);
  }
  return 0;
}

export function codexReleaseAtLeast(
  versionOutput: string | null | undefined,
  minimumVersion: string,
): boolean {
  const installed = parseCodexRelease(versionOutput);
  const minimum = parseCodexRelease(minimumVersion);
  return installed !== null
    && minimum !== null
    && compareCodexRelease(installed, minimum) >= 0;
}
