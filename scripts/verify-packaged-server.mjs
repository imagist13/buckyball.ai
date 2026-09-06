import { spawn } from 'node:child_process';
import { listPackage } from '@electron/asar';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const STARTUP_TIMEOUT_MS = 45_000;
const MAX_CAPTURED_OUTPUT = 64 * 1024;

function usage() {
  return 'Usage: node scripts/verify-packaged-server.mjs <electron-binary> <resources-directory> | --source-maps-only <resources-directory>';
}

function listLooseSourceMaps(root) {
  const found = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(absolute);
      else if (entry.isFile() && entry.name.endsWith('.map')) found.push(absolute);
    }
  }
  return found;
}

export function assertPackageHasNoSourceMaps(resourcesDirectory) {
  if (!fs.statSync(resourcesDirectory, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`Packaged resources directory not found: ${resourcesDirectory}`);
  }
  const asarPath = path.join(resourcesDirectory, 'app.asar');
  if (!fs.statSync(asarPath, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`Packaged app.asar not found: ${asarPath}`);
  }
  const looseMaps = listLooseSourceMaps(resourcesDirectory);
  const asarMaps = listPackage(asarPath).filter((entry) => entry.toLowerCase().endsWith('.map'));
  if (looseMaps.length > 0 || asarMaps.length > 0) {
    const evidence = [
      ...looseMaps.map((entry) => path.relative(resourcesDirectory, entry)),
      ...asarMaps.map((entry) => `app.asar:${entry}`),
    ].slice(0, 20);
    throw new Error(`Packaged source maps are forbidden:\n${evidence.join('\n')}`);
  }
  console.log('Packaged source-map hygiene OK (Resources + app.asar: 0 maps)');
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not reserve an IPv4 port'));
        return;
      }
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

function checkHealth(port) {
  return new Promise((resolve, reject) => {
    const request = http.get(
      {
        hostname: '127.0.0.1',
        port,
        path: '/api/health',
        family: 4,
        timeout: 2_000,
      },
      (response) => {
        response.resume();
        if (response.statusCode === 200) resolve();
        else reject(new Error(`health endpoint returned ${response.statusCode}`));
      },
    );
    request.once('error', reject);
    request.once('timeout', () => {
      request.destroy(new Error('health request timed out'));
    });
  });
}

function appendOutput(current, chunk) {
  const combined = current + chunk.toString();
  return combined.length > MAX_CAPTURED_OUTPUT
    ? combined.slice(combined.length - MAX_CAPTURED_OUTPUT)
    : combined;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function stopChild(child, exited) {
  if (exited.value) return;
  child.kill('SIGTERM');
  const deadline = Date.now() + 3_000;
  while (!exited.value && Date.now() < deadline) await delay(50);
  if (!exited.value) child.kill('SIGKILL');
}

async function main() {
  if (process.argv[2] === '--source-maps-only') {
    const resourcesDirectory = process.argv[3] ? path.resolve(process.argv[3]) : '';
    if (!resourcesDirectory) throw new Error(usage());
    assertPackageHasNoSourceMaps(resourcesDirectory);
    return;
  }
  const electronBinary = process.argv[2] ? path.resolve(process.argv[2]) : '';
  const resourcesDirectory = process.argv[3] ? path.resolve(process.argv[3]) : '';
  if (!electronBinary || !resourcesDirectory) throw new Error(usage());
  if (!fs.existsSync(electronBinary)) throw new Error(`Electron binary not found: ${electronBinary}`);
  assertPackageHasNoSourceMaps(resourcesDirectory);

  const standaloneDirectory = path.join(resourcesDirectory, 'standalone');
  const serverPath = path.join(standaloneDirectory, 'server.js');
  if (!fs.existsSync(serverPath)) throw new Error(`Packaged server not found: ${serverPath}`);

  const port = await reservePort();
  const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-packaged-smoke-'));
  let output = '';
  let spawnError = null;
  const exited = { value: false, code: null, signal: null };

  const child = spawn(electronBinary, [serverPath], {
    cwd: standaloneDirectory,
    env: {
      ...process.env,
      CLAUDE_GUI_DATA_DIR: dataDirectory,
      CODEX_DISABLED: '1',
      ELECTRON_RUN_AS_NODE: '1',
      HOSTNAME: '127.0.0.1',
      NEXT_TELEMETRY_DISABLED: '1',
      NODE_ENV: 'production',
      PORT: String(port),
      RESOURCES_PATH: resourcesDirectory,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => {
    output = appendOutput(output, chunk);
  });
  child.stderr.on('data', (chunk) => {
    output = appendOutput(output, chunk);
  });
  child.once('error', (error) => {
    spawnError = error;
  });
  child.once('exit', (code, signal) => {
    exited.value = true;
    exited.code = code;
    exited.signal = signal;
  });

  try {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    let lastHealthError = 'server did not accept connections';
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (exited.value) {
        throw new Error(`Packaged server exited early (code=${exited.code}, signal=${exited.signal})`);
      }
      try {
        await checkHealth(port);
        console.log(`Packaged server health OK on 127.0.0.1:${port}`);
        return;
      } catch (error) {
        lastHealthError = error instanceof Error ? error.message : String(error);
      }
      await delay(250);
    }
    throw new Error(`Packaged server health timed out: ${lastHealthError}`);
  } catch (error) {
    const details = output.trim() || '(no server output captured)';
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n\n${details}`);
  } finally {
    await stopChild(child, exited);
    fs.rmSync(dataDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
