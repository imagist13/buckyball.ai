import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { resolve } from "node:path";
import { resolveFileTypeIcon } from "@/components/ui/FileTypeIcon";

describe("FileTypeIcon resolution", () => {
  it("distinguishes same-stem Markdown, TypeScript, and HTML files", () => {
    assert.equal(resolveFileTypeIcon("/workspace/page.md"), "markdown");
    assert.equal(resolveFileTypeIcon("/workspace/page.ts"), "typescript");
    assert.equal(resolveFileTypeIcon("/workspace/page.html"), "html");
  });

  it("prefers exact filenames over their ordinary extension", () => {
    assert.equal(resolveFileTypeIcon("package.json"), "nodejs");
    assert.equal(resolveFileTypeIcon("tsconfig.json"), "tsconfig");
    assert.equal(resolveFileTypeIcon("Dockerfile"), "docker");
    assert.equal(resolveFileTypeIcon(".env.production"), "tune");
  });

  it("prefers compound suffixes before ordinary suffixes", () => {
    assert.equal(resolveFileTypeIcon("types.d.ts"), "typescript-def");
    assert.equal(resolveFileTypeIcon("button.test.tsx"), "test-ts");
    assert.equal(resolveFileTypeIcon("button.spec.jsx"), "test-jsx");
  });

  it("falls back to the generic file artwork", () => {
    assert.equal(resolveFileTypeIcon("unknown.custom-extension"), "file");
    assert.equal(resolveFileTypeIcon("NO_EXTENSION"), "file");
  });
});

describe("material-icon-theme attribution manifest", () => {
  it("covers every emitted SVG with version, source, repository, and MIT license", () => {
    const root = process.cwd();
    const manifest = JSON.parse(
      readFileSync(
        resolve(
          root,
          "src/components/ui/file-type-icons/file-type-icons.manifest.json",
        ),
        "utf8",
      ),
    ) as {
      sourceVersion: string;
      upstreamRepository: string;
      license: string;
      trademarkNotice: string;
      icons: Array<{
        iconId: string;
        sourceFile: string;
        outputFile: string;
        sourceVersion: string;
        upstreamRepository: string;
        license: string;
      }>;
    };
    assert.equal(manifest.license, "MIT");
    assert.match(manifest.sourceVersion, /^\d+\.\d+\.\d+$/);
    assert.match(manifest.upstreamRepository, /^https:\/\/github\.com\//);
    assert.match(manifest.trademarkNotice, /trademark/i);
    assert.equal(manifest.icons.length, 50);
    for (const icon of manifest.icons) {
      assert.equal(icon.sourceVersion, manifest.sourceVersion);
      assert.equal(icon.upstreamRepository, manifest.upstreamRepository);
      assert.equal(icon.license, "MIT");
      assert.match(icon.sourceFile, /^icons\/.+\.svg$/);
      assert.equal(
        readFileSync(resolve(root, icon.outputFile), "utf8").includes("<svg"),
        true,
      );
    }
    assert.match(
      readFileSync(
        resolve(
          root,
          "src/components/ui/file-type-icons/LICENSE.material-icon-theme",
        ),
        "utf8",
      ),
      /MIT License/,
    );
  });
});
