#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Next dev and Next build both mutate `.next`. Running a production build
 * while the desktop dev client is alive can remove dev manifests underneath
 * it, which surfaces as unrelated 500s from routes such as chat/sessions.
 *
 * Next owns `.next/dev/lock` for the lifetime of a dev server and removes it
 * on a clean shutdown. Treat its presence as a hard build boundary. A stale
 * lock after a crash is intentionally fail-closed: the error tells the
 * developer how to verify that dev is stopped before removing that one file.
 */
export function assertNoActiveNextDev(projectDir = process.cwd()) {
  const root = path.resolve(projectDir);
  const lockPath = path.join(root, '.next', 'dev', 'lock');
  if (!fs.existsSync(lockPath)) return;
  throw new Error(
    '[next-build-safety] Refusing to build while `.next/dev/lock` exists. '
    + 'Stop `npm run dev` / `npm run electron:dev` first. If the dev process '
    + 'crashed, verify that it is no longer running, then remove only the '
    + `stale lock file: ${lockPath}`,
  );
}

const isDirectRun = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  assertNoActiveNextDev();
  console.log('[next-build-safety] ok — no active Next dev lock.');
}
