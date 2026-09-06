/**
 * Generate the macOS menubar Tray TEMPLATE icons from the brand mark.
 *
 * A macOS template image is monochrome: macOS ignores RGB and renders the
 * ALPHA channel in the system menubar color (black in light mode, white in
 * dark mode). So we turn the dark-on-light brand glyph (build/icon-source.png)
 * into black pixels whose alpha = inverted luminance — the dark dot-matrix
 * becomes opaque, the light background becomes transparent. This keeps the
 * brand's fade while satisfying the template-image contract, instead of
 * resizing the full-color app icon (icon.icns) — which renders as an
 * unbranded blob and ignores dark/light menubar adaptation.
 *
 * One-off / regen-on-rebrand. Outputs:
 *   build/trayTemplate.png      (16x16, @1x)
 *   build/trayTemplate@2x.png   (32x32, retina)
 *
 * Run from repo root:  node scripts/gen-tray-icon.mjs
 *
 * Dependency note: this uses `sharp`, which is NOT a declared dependency — it
 * ships transitively via Next.js's image optimization (same pattern as the
 * existing scripts/generate-app-icon.mjs). The generated PNGs are committed and
 * the BUILD does not run this script, so a fresh `npm ci --omit=optional` env
 * that lacks sharp won't break packaging — only a manual rebrand re-run. If you
 * hit "sharp not found", run `npm i -D sharp` once, then re-run this script.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Dynamic import so a missing `sharp` (e.g. omitted optional deps) fails with an
// actionable message instead of an opaque module-resolution error.
let sharp;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.error(
    '[gen-tray-icon] `sharp` not found. It normally ships transitively via Next.js; ' +
    'if it is missing (e.g. after `npm ci --omit=optional`), run `npm i -D sharp` then re-run. ' +
    'This is a one-off regen-on-rebrand script and is NOT part of the build.',
  );
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'build', 'icon-source.png');

async function genTemplate(size, outFile) {
  // Flatten any app-icon transparency onto white so the rounded-corner mask
  // doesn't read as "shape", grayscale, then read raw luminance.
  const { data, info } = await sharp(SRC)
    .flatten({ background: '#ffffff' })
    .resize(size, size, { fit: 'contain', background: '#ffffff' })
    .toColourspace('b-w')
    .raw()
    .toBuffer({ resolveWithObject: true });

  const px = size * size;
  const ch = info.channels; // 1 for b-w
  const rgba = Buffer.alloc(px * 4);
  for (let i = 0; i < px; i++) {
    const lum = data[i * ch];
    rgba[i * 4 + 0] = 0;
    rgba[i * 4 + 1] = 0;
    rgba[i * 4 + 2] = 0;
    rgba[i * 4 + 3] = 255 - lum; // dark glyph → opaque, light bg → transparent
  }
  await sharp(rgba, { raw: { width: size, height: size, channels: 4 } })
    .png()
    .toFile(path.join(root, 'build', outFile));
  console.log('wrote build/' + outFile + ` (${size}x${size})`);
}

await genTemplate(16, 'trayTemplate.png');
await genTemplate(32, 'trayTemplate@2x.png');
console.log('[gen-tray-icon] done');
