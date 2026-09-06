"use client";

import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { useEffect, type ReactNode } from "react";
import { toNativeThemeSource } from "@/lib/native-theme-source";

function NativeThemeSync() {
  const { theme } = useTheme();

  useEffect(() => {
    if (!theme) return;
    // Dev builds can briefly load a rebuilt preload before the Electron main
    // process restarts. Ignore that transient "handler not registered" skew;
    // production ships main + preload atomically.
    void window.electronAPI?.theme
      ?.setSource(toNativeThemeSource(theme))
      .catch(() => undefined);
  }, [theme]);

  return null;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <NativeThemeSync />
      {children}
    </NextThemesProvider>
  );
}
