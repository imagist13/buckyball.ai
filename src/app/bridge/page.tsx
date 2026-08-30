"use client";

/**
 * Compatibility redirect — the bridge UI moved into Settings on
 * 2026-05-02. This page exists only so old `/bridge` deep links don't
 * 404. Channel-specific deep links (`/bridge#telegram` etc.) resolve to
 * the bridge section's home; users can re-enter the channel sub-nav
 * from there.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { SpinnerGap } from "@/components/ui/icon";

export default function BridgeRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/settings/bridge");
  }, [router]);

  return (
    <div className="flex h-full items-center justify-center">
      <SpinnerGap size={20} className="animate-spin text-muted-foreground" />
    </div>
  );
}
