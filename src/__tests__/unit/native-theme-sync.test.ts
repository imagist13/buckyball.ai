import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  isNativeThemeSource,
  toNativeThemeSource,
} from "../../lib/native-theme-source";

const root = path.resolve(__dirname, "../../..");
const readSource = (relativePath: string) =>
  readFileSync(path.join(root, relativePath), "utf8");

describe("native theme synchronization", () => {
  it("accepts only Electron nativeTheme sources", () => {
    for (const source of ["system", "light", "dark"]) {
      assert.equal(isNativeThemeSource(source), true);
      assert.equal(toNativeThemeSource(source), source);
    }
    for (const source of [undefined, null, "", "auto", "sepia", 1]) {
      assert.equal(isNativeThemeSource(source), false);
      assert.equal(toNativeThemeSource(source), "system");
    }
  });

  it("exposes a narrow preload bridge and validates input in the main process", () => {
    const preload = readSource("electron/preload.ts");
    const main = readSource("electron/main.ts");

    assert.match(preload, /theme:\s*\{/);
    assert.match(preload, /ipcRenderer\.invoke\(['"]theme:set-source['"], source\)/);
    assert.match(main, /ipcMain\.handle\(['"]theme:set-source['"]/);
    assert.match(main, /isNativeThemeSource\(source\)/);
    assert.match(main, /nativeTheme\.themeSource\s*=\s*source/);
  });

  it("syncs next-themes changes from inside the provider", () => {
    const provider = readSource("src/components/layout/ThemeProvider.tsx");

    assert.match(provider, /function NativeThemeSync/);
    assert.match(provider, /window\.electronAPI\?\.theme\s*\?\.\s*setSource/);
    assert.match(provider, /toNativeThemeSource\(theme\)/);
    assert.match(provider, /<NativeThemeSync\s*\/>/);
  });
});
