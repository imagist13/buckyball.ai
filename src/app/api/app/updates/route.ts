import { NextResponse } from "next/server";
import { getRuntimeArchitectureInfo } from "@/lib/platform";
import { selectRecommendedReleaseAsset, type ReleaseAsset } from "@/lib/update-release";
import { compareSemver } from "@/lib/compare-semver";

const GITHUB_REPO = "op7418/CodePilot";

function noUpdatePayload(currentVersion: string, runtimeInfo: ReturnType<typeof getRuntimeArchitectureInfo>) {
  return {
    latestVersion: currentVersion,
    currentVersion,
    updateAvailable: false,
    releaseName: "",
    releaseNotes: "",
    publishedAt: "",
    releaseUrl: "",
    downloadUrl: "",
    downloadAssetName: "",
    detectedPlatform: runtimeInfo.platform,
    detectedArch: runtimeInfo.processArch,
    hostArch: runtimeInfo.hostArch,
    runningUnderRosetta: runtimeInfo.runningUnderRosetta,
  };
}

export async function GET() {
  try {
    const currentVersion = process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0";
    const runtimeInfo = getRuntimeArchitectureInfo();

    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      {
        headers: { Accept: "application/vnd.github.v3+json" },
        next: { revalidate: 300 },
      }
    );

    if (!res.ok) {
      return NextResponse.json(noUpdatePayload(currentVersion, runtimeInfo));
    }

    const release = await res.json();
    const latestVersion = (release.tag_name || "").replace(/^v/, "");
    const updateAvailable = compareSemver(latestVersion, currentVersion) > 0;
    const recommendedAsset = selectRecommendedReleaseAsset(
      Array.isArray(release.assets) ? (release.assets as ReleaseAsset[]) : [],
      runtimeInfo,
    );

    return NextResponse.json({
      latestVersion,
      currentVersion,
      updateAvailable,
      releaseName: release.name || `v${latestVersion}`,
      releaseNotes: release.body || "",
      publishedAt: release.published_at || "",
      releaseUrl: release.html_url || "",
      downloadUrl: recommendedAsset?.browser_download_url || release.html_url || "",
      downloadAssetName: recommendedAsset?.name || "",
      detectedPlatform: runtimeInfo.platform,
      detectedArch: runtimeInfo.processArch,
      hostArch: runtimeInfo.hostArch,
      runningUnderRosetta: runtimeInfo.runningUnderRosetta,
    });
  } catch {
    const currentVersion = process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0";
    const runtimeInfo = getRuntimeArchitectureInfo();
    return NextResponse.json(noUpdatePayload(currentVersion, runtimeInfo));
  }
}
