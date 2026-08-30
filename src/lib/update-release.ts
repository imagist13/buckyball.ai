import type { RuntimeArchitectureInfo } from './platform';

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface ReleaseAssetAvailability {
  recommendedAsset: ReleaseAsset | null;
  /**
   * A newer GitHub Release exists, but it does not contain an installer for
   * this runtime platform. This is expected while official Releases are
   * macOS-only and must not be presented as a downloadable Windows/Linux
   * update.
   */
  platformAssetMissing: boolean;
}

export function releasePlatformLabel(platform: string | undefined): string {
  if (platform === 'darwin') return 'macOS';
  if (platform === 'win32') return 'Windows';
  if (platform === 'linux') return 'Linux';
  return 'this platform';
}

function normalizeArch(value: string | undefined): string {
  if (!value) return '';
  const normalized = value.toLowerCase();
  if (normalized === 'aarch64') return 'arm64';
  if (normalized === 'amd64' || normalized === 'x86_64') return 'x64';
  return normalized;
}

function scoreMacAsset(name: string, targetArch: string): number {
  if (!name.endsWith('.dmg') && !name.endsWith('.zip')) return -1;

  let score = name.endsWith('.dmg') ? 40 : 20;
  if (name.includes(`-${targetArch}.`)) score += 100;
  else if (name.includes(targetArch)) score += 50;

  if (targetArch === 'arm64' && name.includes('universal')) score += 80;
  return score;
}

function scoreWindowsAsset(name: string): number {
  return name.endsWith('.exe') ? 100 : -1;
}

function scoreLinuxAsset(name: string, targetArch: string): number {
  if (!name.endsWith('.appimage') && !name.endsWith('.deb') && !name.endsWith('.rpm')) {
    return -1;
  }

  let score = 0;
  if (name.endsWith('.appimage')) score += 40;
  else if (name.endsWith('.deb')) score += 30;
  else if (name.endsWith('.rpm')) score += 20;

  if (name.includes(targetArch)) score += 100;
  return score;
}

export function selectRecommendedReleaseAsset(
  assets: ReleaseAsset[],
  runtime: Pick<RuntimeArchitectureInfo, 'platform' | 'hostArch' | 'processArch'>,
): ReleaseAsset | null {
  const targetArch = normalizeArch(runtime.hostArch || runtime.processArch);
  const normalizedAssets = assets.filter(
    (asset) => typeof asset.name === 'string' && typeof asset.browser_download_url === 'string',
  );

  let best: ReleaseAsset | null = null;
  let bestScore = -1;

  for (const asset of normalizedAssets) {
    const name = asset.name.toLowerCase();
    let score = -1;

    if (runtime.platform === 'darwin') {
      score = scoreMacAsset(name, targetArch);
    } else if (runtime.platform === 'win32') {
      score = scoreWindowsAsset(name);
    } else if (runtime.platform === 'linux') {
      score = scoreLinuxAsset(name, targetArch);
    }

    if (score > bestScore) {
      best = asset;
      bestScore = score;
    }
  }

  return bestScore >= 0 ? best : null;
}

export function resolveReleaseAssetAvailability(
  assets: ReleaseAsset[],
  runtime: Pick<RuntimeArchitectureInfo, 'platform' | 'hostArch' | 'processArch'>,
  updateAvailable: boolean,
): ReleaseAssetAvailability {
  const recommendedAsset = selectRecommendedReleaseAsset(assets, runtime);
  const platformHasManualReleaseContract = runtime.platform === 'darwin'
    || runtime.platform === 'win32'
    || runtime.platform === 'linux';

  return {
    recommendedAsset,
    platformAssetMissing: updateAvailable
      && platformHasManualReleaseContract
      && recommendedAsset === null,
  };
}
