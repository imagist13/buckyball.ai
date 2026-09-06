"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Phase 2D.4 (2026-05-01): `/cli-tools` is now a deep link into the
 * unified `/plugins` page. Kept as a thin redirect for one release;
 * the file will be deleted in the next cleanup.
 */
export default function CliToolsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/plugins#cli");
  }, [router]);
  return null;
}
