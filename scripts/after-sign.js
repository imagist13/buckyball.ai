/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * electron-builder afterSign hook — code signing for macOS.
 *
 * When a real Developer ID certificate is available (CSC_LINK or CSC_NAME env
 * vars are set), electron-builder handles signing automatically. This hook only
 * runs a strict verification to confirm the signature is intact.
 *
 * Distributable builds require a Developer ID signature with the configured
 * Team ID. Ad-hoc signing is available only behind an explicit local-build
 * flag; silently shipping an ad-hoc build changes its designated requirement
 * on every rebuild and makes macOS prompt for the existing Safe Storage item.
 *
 * Ad-hoc signing order (inside-out):
 *   1. All native binaries (.node, .dylib, .so)
 *   2. Extensionless executable helpers inside Frameworks/
 *   3. All Frameworks (*.framework)
 *   4. All Helper apps (*.app inside Frameworks/)
 *   5. The main .app bundle
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveMacosSigningMode } = require('./macos-signing-policy.cjs');

/**
 * Ad-hoc sign a single path. Any failure is fatal: a partially signed package
 * must never be promoted as a usable local smoke artifact.
 */
function runCodesign(args, timeout = 30000) {
  const result = spawnSync('/usr/bin/codesign', args, {
    encoding: 'utf8',
    timeout,
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'codesign failed').trim());
  }
  return `${result.stdout || ''}\n${result.stderr || ''}`;
}

function codesign(targetPath) {
  runCodesign(['--force', '--sign', '-', targetPath]);
}

/**
 * Recursively collect all files matching the given extensions.
 */
function collectFiles(dir, extensions) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Don't descend into .app or .framework bundles — they are signed as a unit
      if (entry.name.endsWith('.app') || entry.name.endsWith('.framework')) {
        continue;
      }
      results.push(...collectFiles(fullPath, extensions));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (extensions.includes(ext)) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

/**
 * Collect executable helper binaries that do not have file extensions, such as
 * Electron Framework.framework/.../Helpers/chrome_crashpad_handler.
 */
function collectExecutableHelpers(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Helper .app bundles are signed as bundles in a later step.
      if (entry.name.endsWith('.app')) {
        continue;
      }
      results.push(...collectExecutableHelpers(fullPath));
    } else if (entry.isFile()) {
      try {
        const mode = fs.statSync(fullPath).mode;
        if ((mode & 0o111) !== 0) {
          results.push(fullPath);
        }
      } catch {
        // Ignore files that disappear during traversal.
      }
    }
  }

  return results;
}

/**
 * Collect bundle directories (.app, .framework) at a given depth.
 */
function collectBundles(dir, extension) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.endsWith(extension)) {
      results.push(path.join(dir, entry.name));
    }
  }
  return results;
}

module.exports = async function afterSign(context) {
  const platform = context.packager.platform.name;
  if (platform !== 'mac') return;

  const appOutDir = context.appOutDir;
  const appName = context.packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  if (!fs.existsSync(appPath)) {
    console.warn(`[afterSign] macOS app not found at ${appPath}, skipping`);
    return;
  }

  let signatureOutput = '';
  try {
    signatureOutput = runCodesign(['-d', '--verbose=4', appPath], 15000);
  } catch {
    // An unsigned bundle is handled by the explicit policy below.
  }
  const signingMode = resolveMacosSigningMode({
    signatureOutput,
    requireDeveloperId: process.env.CODEPILOT_REQUIRE_DEVELOPER_ID === '1',
    allowAdhoc: process.env.CODEPILOT_ALLOW_ADHOC_SIGNING === '1',
    expectedTeamId: process.env.CODEPILOT_APPLE_TEAM_ID?.trim() || '',
  });

  if (signingMode.mode === 'developer_id') {
    console.log(`[afterSign] Developer ID signature detected; team=${signingMode.teamId}.`);
    console.log('[afterSign] Skipping ad-hoc signing to preserve Developer ID signature.');
    runCodesign(['--verify', '--deep', '--strict', '--verbose=4', appPath], 60000);
    console.log('[afterSign] Developer ID signature verification passed.');
    return;
  }

  // ── No certificate — ad-hoc signing fallback ─────────────────────────
  console.log(`[afterSign] Ad-hoc signing ${appPath} (individual component signing)...`);

  const contentsPath = path.join(appPath, 'Contents');
  const frameworksPath = path.join(contentsPath, 'Frameworks');
  let signed = 0;

  // Step 1: Sign all native binaries (.node, .dylib, .so)
  const nativeBinaries = collectFiles(contentsPath, ['.node', '.dylib', '.so']);
  for (const bin of nativeBinaries) {
    codesign(bin);
    signed++;
  }
  if (nativeBinaries.length > 0) {
    console.log(`[afterSign]   Signed ${nativeBinaries.length} native binaries (.node/.dylib/.so)`);
  }

  // Step 2: Sign executable helper binaries inside frameworks before signing
  // framework bundles. Some Electron builds ship extensionless helper binaries
  // (e.g. chrome_crashpad_handler), and codesign requires them to be sealed
  // before the parent framework is signed.
  const executableHelpers = collectExecutableHelpers(frameworksPath);
  for (const helper of executableHelpers) {
    codesign(helper);
    signed++;
  }
  if (executableHelpers.length > 0) {
    console.log(`[afterSign]   Signed ${executableHelpers.length} executable helper binaries`);
  }

  // Step 3: Sign all Frameworks
  const frameworks = collectBundles(frameworksPath, '.framework');
  for (const fw of frameworks) {
    codesign(fw);
    signed++;
  }
  if (frameworks.length > 0) {
    console.log(`[afterSign]   Signed ${frameworks.length} frameworks`);
  }

  // Step 4: Sign all Helper apps
  const helperApps = collectBundles(frameworksPath, '.app');
  for (const helper of helperApps) {
    codesign(helper);
    signed++;
  }
  if (helperApps.length > 0) {
    console.log(`[afterSign]   Signed ${helperApps.length} helper apps`);
  }

  // Step 5: Sign the main app bundle
  codesign(appPath);
  signed++;

  console.log(`[afterSign] Ad-hoc signing complete — ${signed} components signed`);

  runCodesign(['--verify', '--deep', '--strict', appPath]);
  console.log('[afterSign] Signature verification passed (--deep --strict)');
};
