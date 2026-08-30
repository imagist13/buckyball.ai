import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';
import {
  BROWSER_WEB_PREFERENCES,
  deriveBrowserPartition,
  isAllowedBrowserGuestUrl,
  isCanonicalBrowserWorkspaceId,
} from '../../../electron/browser-surface-security';
import {
  classifyBrowserUrl,
  isSafeExternalBrowserUrl,
  resolveBrowserAddressInput,
} from '@/lib/browser-url-policy';

const browserPanelSource = fs.readFileSync(new URL(
  '../../components/layout/WorkspaceSidebar/BrowserPanel.tsx',
  import.meta.url,
), 'utf8');
const sidebarTabBarSource = fs.readFileSync(new URL(
  '../../components/layout/WorkspaceSidebar/TabBar.tsx',
  import.meta.url,
), 'utf8');

describe('embedded browser partition contract', () => {
  it('derives a stable opaque partition from a canonical workspace id', () => {
    const firstWorkspace = 'a'.repeat(64);
    const secondWorkspace = 'b'.repeat(64);
    assert.equal(isCanonicalBrowserWorkspaceId(firstWorkspace), true);
    assert.equal(isCanonicalBrowserWorkspaceId('/Users/private/project'), false);
    assert.match(deriveBrowserPartition(firstWorkspace), /^persist:codepilot-browser-[a-f0-9]{20}$/);
    assert.equal(deriveBrowserPartition(firstWorkspace), deriveBrowserPartition(firstWorkspace));
    assert.notEqual(deriveBrowserPartition(firstWorkspace), deriveBrowserPartition(secondWorkspace));
    assert.throws(() => deriveBrowserPartition('not-an-opaque-workspace-id'));
  });

  it('pins hardened guest preferences with no Node capability', () => {
    assert.equal(
      BROWSER_WEB_PREFERENCES,
      'contextIsolation=true,sandbox=true,nodeIntegration=false,nodeIntegrationInSubFrames=false,nodeIntegrationInWorker=false,webviewTag=false,webSecurity=true,allowRunningInsecureContent=false',
    );
  });
});

describe('embedded browser URL policy', () => {
  it('allows HTTPS, localhost HTTP and only the exact blank page', () => {
    for (const url of [
      'https://example.com/path?q=1',
      'http://localhost:3000/',
      'http://127.0.0.1:5173/',
      'http://[::1]:8080/',
      'about:blank',
    ]) {
      assert.equal(isAllowedBrowserGuestUrl(url), true, url);
    }
  });

  it('blocks remote plaintext HTTP, credentials, local files and executable schemes', () => {
    assert.deepEqual(classifyBrowserUrl('http://example.com/'), {
      allowed: false,
      reason: 'insecure_remote_http',
    });
    assert.equal(isAllowedBrowserGuestUrl('https://user:pass@example.com/'), false);
    assert.equal(isAllowedBrowserGuestUrl('file:///etc/passwd'), false);
    assert.equal(isAllowedBrowserGuestUrl('javascript:alert(1)'), false);
    assert.equal(isAllowedBrowserGuestUrl('data:text/html,hello'), false);
    assert.equal(isAllowedBrowserGuestUrl('about:srcdoc'), false);
  });

  it('normalizes address-bar input without turning arbitrary schemes into HTTPS', () => {
    assert.deepEqual(resolveBrowserAddressInput('localhost:3000'), {
      allowed: true,
      url: 'http://localhost:3000/',
    });
    assert.deepEqual(resolveBrowserAddressInput('example.com/docs'), {
      allowed: true,
      url: 'https://example.com/docs',
    });
    assert.equal(resolveBrowserAddressInput('file:///tmp/private').allowed, false);
    assert.equal(resolveBrowserAddressInput('javascript:alert(1)').allowed, false);
  });

  it('limits system handoff to credential-free HTTP(S)', () => {
    assert.equal(isSafeExternalBrowserUrl('https://example.com/'), true);
    assert.equal(isSafeExternalBrowserUrl('http://example.com/'), true);
    assert.equal(isSafeExternalBrowserUrl('https://u:p@example.com/'), false);
    assert.equal(isSafeExternalBrowserUrl('mailto:test@example.com'), false);
  });
});

describe('embedded browser sidebar composition', () => {
  it('uses the sidebar Tab as the browser page identity and renders a loading progress bar', () => {
    assert.match(browserPanelSource, /data-browser-single-page/);
    assert.match(browserPanelSource, /data-browser-progress/);
    assert.match(browserPanelSource, /role=\{view\.loading \? 'progressbar'/);
    assert.doesNotMatch(browserPanelSource, /browser\.tabs|browser\.newTab|MAX_BROWSER_TABS/);
  });

  it('keeps per-Tab close but removes the redundant sidebar-level collapse button', () => {
    assert.match(sidebarTabBarSource, /closeTab\(entry\.id\)/);
    assert.doesNotMatch(sidebarTabBarSource, /workspaceSidebar\.collapse|setOpen\(false\)/);
  });
});
