"use client";

import { createContext, useContext } from "react";
import type {
  UpdaterErrorCode,
  UpdaterPhase,
  UpdaterSnapshot,
  UpdaterUnsupportedReason,
} from '@/lib/updater-contract';

export interface UpdateInfo {
  updateAvailable: boolean;
  latestVersion: string;
  currentVersion: string;
  releaseName: string;
  releaseNotes: string;
  releaseUrl: string;
  downloadUrl?: string;
  downloadAssetName?: string;
  /** A newer release exists, but it has no installer for detectedPlatform. */
  platformAssetMissing?: boolean;
  publishedAt: string;
  downloadProgress: number | null;
  readyToInstall: boolean;
  isNativeUpdate: boolean;
  lastError: string | null;
  lastErrorCode?: UpdaterErrorCode | null;
  nativeSupported?: boolean;
  nativeUnsupportedReason?: UpdaterUnsupportedReason;
  nativePhase?: UpdaterPhase;
  nativePackageType?: UpdaterSnapshot['packageType'];
  nativePublisherVerification?: UpdaterSnapshot['publisherVerification'];
  detectedPlatform?: string;
  detectedArch?: string;
  hostArch?: string;
  runningUnderRosetta?: boolean;
}

export interface UpdateContextValue {
  updateInfo: UpdateInfo | null;
  checking: boolean;
  checkForUpdates: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  dismissUpdate: () => void;
  showDialog: boolean;
  setShowDialog: (v: boolean) => void;
  quitAndInstall: () => Promise<void>;
}

export const UpdateContext = createContext<UpdateContextValue | null>(null);

export function useUpdate(): UpdateContextValue {
  const ctx = useContext(UpdateContext);
  if (!ctx) {
    throw new Error("useUpdate must be used within an UpdateProvider");
  }
  return ctx;
}
