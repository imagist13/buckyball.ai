#!/usr/bin/env node
/**
 * Regenerate the macOS / Windows / Linux app icons from the
 * canonical brand-glyph PNG checked in at `build/icon-source.png`.
 *
 * macOS app icon contract (Big Sur 11+, still current in Tahoe 26):
 *   - Canvas is 1024×1024.
 *   - Icon must be a **squircle**, not a square or right-angle rect.
 *     macOS does NOT auto-mask — whatever alpha shape the PNG has is
 *     what Dock / Launchpad / App Switcher render. A right-angle
 *     master shipped as-is looks visibly larger and chunkier next to
 *     standard apps, because their icons all have a squircle alpha +
 *     ~100 px of bleed inside the 1024 canvas.
 *   - Apple's reference templates keep the icon "live area" at
 *     824×824, centered (100 px on every side), with the squircle
 *     corner radius at ~22.37 % of the live-area edge (≈ 184 px).
 *
 * This script treats the source PNG as a brand glyph (any aspect,
 * including a right-angle master with background gradient) and:
 *   1. resizes/letterboxes it into the 824×824 live area
 *   2. cookie-cuts it with a 184-px-radius squircle alpha mask
 *   3. drops it into the 1024×1024 canvas with 100 px padding
 *
 * Output:
 *   build/icon.png   — masked master, also dev-mode Dock icon
 *   build/icon.icns  — macOS packaged build (iconutil bundle)
 *   build/icon.ico   — Windows packaged build (multi-resolution)
 *
 * Run:
 *   node scripts/generate-app-icon.mjs
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(REPO_ROOT, "build");
const TMP_ICONSET = path.join(BUILD_DIR, "AppIcon.iconset");

const MASTER_PNG = path.join(BUILD_DIR, "icon-source.png");
if (!existsSync(MASTER_PNG)) {
  console.error(`Source master not found: ${MASTER_PNG}`);
  console.error("Drop the 1024×1024 brand PNG at build/icon-source.png and re-run.");
  process.exit(1);
}

const meta = await sharp(MASTER_PNG).metadata();
console.log(`✓ Loaded master ${path.relative(REPO_ROOT, MASTER_PNG)} (${meta.width}×${meta.height})`);

// ────────── 0. Build the 1024×1024 squircle-masked PNG buffer ──────────
// Apple icon-template geometry: 824×824 live area, 100 px bleed each
// side, corner radius ~22.37 % of edge (≈ 184 px). Real Apple icons
// use a superellipse, but a rounded rect at this radius is visually
// indistinguishable from a true squircle at app-icon zoom levels and
// avoids needing a superellipse path renderer.
const CANVAS = 1024;
const LIVE = 824;
const PAD = (CANVAS - LIVE) / 2;       // 100
const RADIUS = Math.round(LIVE * 0.2237); // ≈ 184

// Step A — resize the source PNG into the 824×824 live area. `contain`
// + transparent letterbox keeps the brand glyph's aspect ratio; if
// the source is already 1024×1024 with edge-to-edge content (as the
// current Aura master is), it down-scales to fit 824 and gains its
// own breathing room inside the squircle.
const fittedGlyph = await sharp(MASTER_PNG)
  .resize(LIVE, LIVE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer();

// Step B — squircle alpha mask (white inside, transparent outside).
// Composited via `dest-in` so the fitted glyph keeps only the pixels
// that fall inside the squircle.
const SQUIRCLE_MASK = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${LIVE} ${LIVE}" width="${LIVE}" height="${LIVE}">
  <rect x="0" y="0" width="${LIVE}" height="${LIVE}" rx="${RADIUS}" ry="${RADIUS}" fill="white"/>
</svg>
`;

const maskedGlyph = await sharp(fittedGlyph)
  .composite([{ input: Buffer.from(SQUIRCLE_MASK), blend: "dest-in" }])
  .png()
  .toBuffer();

// Step C — place the masked 824×824 squircle centered in a
// 1024×1024 transparent canvas, leaving 100 px on every side.
const APP_PNG = path.join(BUILD_DIR, "icon.png");
await sharp({
  create: {
    width: CANVAS,
    height: CANVAS,
    channels: 4,
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  },
})
  .composite([{ input: maskedGlyph, top: PAD, left: PAD }])
  .png()
  .toFile(APP_PNG);
console.log(`✓ Wrote ${path.relative(REPO_ROOT, APP_PNG)} — ${CANVAS}×${CANVAS}, squircle live area ${LIVE}, padding ${PAD}, corner radius ${RADIUS}`);

// ────────── 2. macOS .icns ──────────
// iconutil expects an .iconset directory with a fixed naming scheme:
//   icon_16x16.png, icon_16x16@2x.png, icon_32x32.png, icon_32x32@2x.png,
//   icon_128x128.png, icon_128x128@2x.png, icon_256x256.png,
//   icon_256x256@2x.png, icon_512x512.png, icon_512x512@2x.png
// (@2x doubles the listed dimension — so 512@2x = 1024.)
if (existsSync(TMP_ICONSET)) rmSync(TMP_ICONSET, { recursive: true, force: true });
mkdirSync(TMP_ICONSET, { recursive: true });

const ICONSET_SIZES = [
  { name: "icon_16x16.png", size: 16 },
  { name: "icon_16x16@2x.png", size: 32 },
  { name: "icon_32x32.png", size: 32 },
  { name: "icon_32x32@2x.png", size: 64 },
  { name: "icon_128x128.png", size: 128 },
  { name: "icon_128x128@2x.png", size: 256 },
  { name: "icon_256x256.png", size: 256 },
  { name: "icon_256x256@2x.png", size: 512 },
  { name: "icon_512x512.png", size: 512 },
  { name: "icon_512x512@2x.png", size: 1024 },
];

for (const { name, size } of ICONSET_SIZES) {
  await sharp(APP_PNG)
    .resize(size, size)
    .png()
    .toFile(path.join(TMP_ICONSET, name));
}
console.log(`✓ Wrote ${ICONSET_SIZES.length} iconset slices`);

const ICNS_PATH = path.join(BUILD_DIR, "icon.icns");
execFileSync("iconutil", ["-c", "icns", "-o", ICNS_PATH, TMP_ICONSET], { stdio: "inherit" });
console.log(`✓ Wrote ${path.relative(REPO_ROOT, ICNS_PATH)}`);

// Clean up the intermediate iconset — it's already baked into .icns.
rmSync(TMP_ICONSET, { recursive: true, force: true });

// ────────── 3. Windows .ico ──────────
// ICO is a multi-resolution container. We embed 16, 32, 48, 64, 128,
// 256 — the standard set Windows Explorer and Start Menu sample from.
// sharp's `.ico()` output is not directly available, so we hand-build
// the ICO container from PNG buffers (PNG-embedded ICO is the modern
// format Windows Vista+ accepts).
const ICO_SIZES = [16, 32, 48, 64, 128, 256];
const icoSlices = [];
for (const size of ICO_SIZES) {
  const buf = await sharp(APP_PNG)
    .resize(size, size)
    .png()
    .toBuffer();
  icoSlices.push({ size, buf });
}

// ICO file format header (6 bytes) + ICONDIRENTRY×N (16 bytes each).
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);                // Reserved
header.writeUInt16LE(1, 2);                // Type 1 = icon
header.writeUInt16LE(icoSlices.length, 4); // Image count

let imageOffset = 6 + icoSlices.length * 16;
const dir = Buffer.alloc(icoSlices.length * 16);
icoSlices.forEach(({ size, buf }, i) => {
  const off = i * 16;
  dir.writeUInt8(size === 256 ? 0 : size, off + 0);     // Width  (0 = 256)
  dir.writeUInt8(size === 256 ? 0 : size, off + 1);     // Height (0 = 256)
  dir.writeUInt8(0, off + 2);                            // Palette
  dir.writeUInt8(0, off + 3);                            // Reserved
  dir.writeUInt16LE(1, off + 4);                         // Color planes
  dir.writeUInt16LE(32, off + 6);                        // BPP
  dir.writeUInt32LE(buf.length, off + 8);                // Image size
  dir.writeUInt32LE(imageOffset, off + 12);              // Offset
  imageOffset += buf.length;
});

const ICO_PATH = path.join(BUILD_DIR, "icon.ico");
writeFileSync(
  ICO_PATH,
  Buffer.concat([header, dir, ...icoSlices.map((s) => s.buf)]),
);
console.log(`✓ Wrote ${path.relative(REPO_ROOT, ICO_PATH)} (${ICO_SIZES.join(", ")} px)`);

console.log("\nAll done.");
