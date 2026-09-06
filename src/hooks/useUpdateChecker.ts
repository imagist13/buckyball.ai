"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import type { UpdateInfo, UpdateContextValue } from "@/hooks/useUpdate";
import type { UpdaterErrorCode, UpdaterSnapshot } from '@/lib/updater-contract';

const CHECK_INTERVAL = 8 * 60 * 60 * 1000;
const DISMISSED_VERSION_KEY = "codepilot_dismissed_update_version";
const SESSION_DISMISSED_VERSION_KEY = "codepilot_session_dismissed_update_version";
const RELEASE_URL = 'https://github.com/op7418/CodePilot/releases/latest';

function isVersionDismissed(version: string | undefined | null): boolean {
  if (!version || typeof window === "undefined") return false;
  if (localStorage.getItem(DISMISSED_VERSION_KEY) === version) return true;
  if (sessionStorage.getItem(SESSION_DISMISSED_VERSION_KEY) === version) return true;
  return false;
}

function fromNativeSnapshot(snapshot: UpdaterSnapshot): UpdateInfo {
  const updateAvailable = Boolean(snapshot.targetVersion)
    && snapshot.targetVersion !== snapshot.currentVersion;
  return {
    updateAvailable,
    latestVersion: snapshot.targetVersion ?? snapshot.currentVersion,
    currentVersion: snapshot.currentVersion,
    releaseName: snapshot.releaseName || (snapshot.targetVersion ? `CodePilot v${snapshot.targetVersion}` : ''),
    releaseNotes: snapshot.releaseNotes,
    releaseUrl: RELEASE_URL,
    publishedAt: snapshot.releaseDate,
    downloadProgress: snapshot.phase === 'downloading' ? snapshot.progressPercent : null,
    readyToInstall: snapshot.phase === 'downloaded' || snapshot.phase === 'installing',
    isNativeUpdate: snapshot.supported,
    lastError: null,
    lastErrorCode: snapshot.errorCode,
    nativeSupported: snapshot.supported,
    nativeUnsupportedReason: snapshot.unsupportedReason,
    nativePhase: snapshot.phase,
    nativePackageType: snapshot.packageType,
    nativePublisherVerification: snapshot.publisherVerification,
  };
}

export function useUpdateChecker(): UpdateContextValue {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const [nativeSupported, setNativeSupported] = useState<boolean | null>(null);
  const hasNativeBridge = typeof window !== "undefined" && !!window.electronAPI?.updater;

  const checkForUpdatesBrowser = useCallback(async (nativeErrorCode: UpdaterErrorCode | null = null) => {
    setChecking(true);
    try {
      const res = await fetch("/api/app/updates");
      if (!res.ok) return;
      const data = await res.json();
      const info: UpdateInfo = {
        ...data,
        downloadProgress: null,
        readyToInstall: false,
        isNativeUpdate: false,
        lastError: null,
        lastErrorCode: nativeErrorCode,
        nativeSupported: false,
      };
      setUpdateInfo(info);
      if (info.updateAvailable && !isVersionDismissed(info.latestVersion)) setShowDialog(true);
    } catch {
      // Manual GitHub fallback remains available from Settings.
    } finally {
      setChecking(false);
    }
  }, []);

  const applyNativeSnapshot = useCallback((snapshot: UpdaterSnapshot) => {
    setNativeSupported(snapshot.supported);
    setChecking(snapshot.phase === 'checking');
    if (!snapshot.supported) return;
    const info = fromNativeSnapshot(snapshot);
    setUpdateInfo(info);
    if (info.updateAvailable && !isVersionDismissed(info.latestVersion)) setShowDialog(true);
    if (snapshot.phase === 'error' && snapshot.errorCode !== 'active_work') {
      void checkForUpdatesBrowser(snapshot.errorCode);
    }
  }, [checkForUpdatesBrowser]);

  useEffect(() => {
    if (!hasNativeBridge) {
      setNativeSupported(false);
      return;
    }
    const updater = window.electronAPI!.updater!;
    const cleanup = updater.onStatus(applyNativeSnapshot);
    void updater.getStatus().then((status) => {
      if (status) applyNativeSnapshot(status);
      else setNativeSupported(false);
    }).catch(() => setNativeSupported(false));
    return cleanup;
  }, [hasNativeBridge, applyNativeSnapshot]);

  const checkForUpdates = useCallback(async () => {
    if (hasNativeBridge) {
      try {
        const status = await window.electronAPI!.updater!.checkForUpdates();
        applyNativeSnapshot(status);
        if (status.supported) return;
      } catch {
        // Fall through to the platform-aware GitHub download page.
      }
    }
    await checkForUpdatesBrowser();
  }, [hasNativeBridge, applyNativeSnapshot, checkForUpdatesBrowser]);

  useEffect(() => {
    if (nativeSupported !== false) return;
    void checkForUpdatesBrowser();
    const id = setInterval(checkForUpdatesBrowser, CHECK_INTERVAL);
    return () => clearInterval(id);
  }, [nativeSupported, checkForUpdatesBrowser]);

  const dismissUpdate = useCallback(() => {
    setShowDialog(false);
    if (typeof window !== "undefined") {
      const version = updateInfo?.latestVersion;
      if (version) {
        try { sessionStorage.setItem(SESSION_DISMISSED_VERSION_KEY, version); }
        catch { /* storage unavailable */ }
      }
    }
  }, [updateInfo]);

  const downloadUpdate = useCallback(async () => {
    if (!hasNativeBridge || nativeSupported !== true) return;
    const status = await window.electronAPI!.updater!.downloadUpdate();
    applyNativeSnapshot(status);
  }, [hasNativeBridge, nativeSupported, applyNativeSnapshot]);

  const quitAndInstall = useCallback(async () => {
    if (!hasNativeBridge || nativeSupported !== true) return;
    const result = await window.electronAPI!.updater!.quitAndInstall();
    if (!result.ok) {
      setUpdateInfo((previous) => previous ? {
        ...previous,
        lastErrorCode: result.errorCode ?? 'internal',
      } : previous);
    }
  }, [hasNativeBridge, nativeSupported]);

  return useMemo(() => ({
    updateInfo,
    checking,
    checkForUpdates,
    downloadUpdate,
    dismissUpdate,
    showDialog,
    setShowDialog,
    quitAndInstall,
  }), [
    updateInfo,
    checking,
    checkForUpdates,
    downloadUpdate,
    dismissUpdate,
    showDialog,
    quitAndInstall,
  ]);
}
