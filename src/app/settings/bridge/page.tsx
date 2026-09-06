"use client";

import { BridgeLayout } from "@/components/bridge/BridgeLayout";

export default function SettingsBridgePage() {
  // `embedded` keeps BridgeLayout's inner sub-nav and disables the outer
  // page chrome it would otherwise render at /bridge — same behavior the
  // previous SettingsLayout's "bridge" tab had.
  return <BridgeLayout embedded />;
}
