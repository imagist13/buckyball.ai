import { createHash } from 'node:crypto';
import { classifyBrowserUrl } from '../src/lib/browser-url-policy';

const WORKSPACE_ID_PATTERN = /^[a-f0-9]{64}$/;
const BROWSER_PARTITION_PREFIX = 'persist:codepilot-browser-';
const BROWSER_PARTITION_VERSION = 'browser-profile-v1';

export const BROWSER_WEB_PREFERENCES =
  'contextIsolation=true,sandbox=true,nodeIntegration=false,nodeIntegrationInSubFrames=false,nodeIntegrationInWorker=false,webviewTag=false,webSecurity=true,allowRunningInsecureContent=false';

export function isCanonicalBrowserWorkspaceId(value: unknown): value is string {
  return typeof value === 'string' && WORKSPACE_ID_PATTERN.test(value);
}

export function deriveBrowserPartition(workspaceId: string): string {
  if (!isCanonicalBrowserWorkspaceId(workspaceId)) {
    throw new Error('invalid browser workspace id');
  }
  const digest = createHash('sha256')
    .update(`${BROWSER_PARTITION_VERSION}\0${workspaceId}\0default`, 'utf8')
    .digest('hex')
    .slice(0, 20);
  return `${BROWSER_PARTITION_PREFIX}${digest}`;
}

export function isAllowedBrowserGuestUrl(value: unknown): boolean {
  return typeof value === 'string' && classifyBrowserUrl(value).allowed;
}
