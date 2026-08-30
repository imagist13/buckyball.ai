'use client';

import { useSyncExternalStore } from 'react';

const subscribeToBrowserBridge = () => () => {};
const getBrowserBridgeSnapshot = () => Boolean(window.electronAPI?.browser);
const getServerBrowserBridgeSnapshot = () => false;

export function useEmbeddedBrowserAvailability(): boolean {
  return useSyncExternalStore(
    subscribeToBrowserBridge,
    getBrowserBridgeSnapshot,
    getServerBrowserBridgeSnapshot,
  );
}
