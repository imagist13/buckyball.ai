/**
 * `resolveExactProvider` — fail-closed provider identity (g03).
 *
 * `resolveProvider` is deliberately forgiving: a session pointing at a deleted
 * or deactivated provider silently becomes the user's default one, so the chat
 * keeps working. That is right for answering the user, and WRONG for any
 * background call that carries the user's own text somewhere on its own
 * initiative — there, the same fallback means sending the first message of a
 * conversation to a vendor the user never picked for it.
 *
 * These cases pin the difference directly: same input, forgiving resolver hands
 * back another provider, exact resolver hands back null.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const originalDataDir = process.env.CLAUDE_GUI_DATA_DIR;
const originalApiKey = process.env.ANTHROPIC_API_KEY;
const originalAuthToken = process.env.ANTHROPIC_AUTH_TOKEN;
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;

let tempDataDir: string;
let tempHome: string;

beforeEach(() => {
  tempDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-exactprov-db-'));
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codepilot-exactprov-home-'));
  process.env.CLAUDE_GUI_DATA_DIR = tempDataDir;
  process.env.HOME = tempHome;
  process.env.USERPROFILE = tempHome;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
});

afterEach(() => {
  if (originalDataDir !== undefined) process.env.CLAUDE_GUI_DATA_DIR = originalDataDir;
  else delete process.env.CLAUDE_GUI_DATA_DIR;
  if (originalApiKey !== undefined) process.env.ANTHROPIC_API_KEY = originalApiKey;
  if (originalAuthToken !== undefined) process.env.ANTHROPIC_AUTH_TOKEN = originalAuthToken;
  if (originalHome !== undefined) process.env.HOME = originalHome; else delete process.env.HOME;
  if (originalUserProfile !== undefined) process.env.USERPROFILE = originalUserProfile;
  else delete process.env.USERPROFILE;
  try { fs.rmSync(tempDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  try { fs.rmSync(tempHome, { recursive: true, force: true }); } catch { /* ignore */ }
});

/** Two providers from different vendors, B set as the user's default. */
async function seedTwoProviders() {
  const { createProvider, setDefaultProviderId } = await import('../../lib/db');
  const pinned = createProvider({
    name: 'Pinned Vendor A',
    provider_type: 'anthropic',
    base_url: 'https://api.vendor-a.example.com',
    api_key: 'sk-vendor-a',
  });
  const other = createProvider({
    name: 'Default Vendor B',
    provider_type: 'anthropic',
    base_url: 'https://api.vendor-b.example.com',
    api_key: 'sk-vendor-b',
  });
  setDefaultProviderId(other.id);
  return { pinned, other };
}

describe('resolveExactProvider — fail-closed identity', () => {
  it('returns the provider when it is really that provider', async () => {
    const { pinned } = await seedTwoProviders();
    const { resolveExactProvider } = await import('../../lib/provider-resolver');
    const resolved = resolveExactProvider(pinned.id);
    assert.ok(resolved, 'an existing provider must resolve');
    assert.equal(resolved!.provider?.id, pinned.id);
  });

  it('returns null when the provider was deleted — where resolveProvider returns another vendor', async () => {
    const { pinned, other } = await seedTwoProviders();
    const { deleteProvider } = await import('../../lib/db');
    const { resolveProvider, resolveExactProvider } = await import('../../lib/provider-resolver');

    deleteProvider(pinned.id);

    // The contrast this whole module exists for: the ordinary resolver silently
    // re-targets vendor B...
    const forgiving = resolveProvider({ providerId: pinned.id });
    assert.equal(forgiving.provider?.id, other.id, 'baseline: the ordinary resolver falls back');
    assert.notEqual(forgiving.provider?.base_url, undefined);

    // ...and the exact one refuses instead.
    assert.equal(resolveExactProvider(pinned.id), null, 'exact resolution must fail closed');
  });

  it('returns null for an id that never existed', async () => {
    await seedTwoProviders();
    const { resolveExactProvider } = await import('../../lib/provider-resolver');
    assert.equal(resolveExactProvider('provider-never-existed'), null);
  });

  it('returns null for an empty id instead of picking the default', async () => {
    await seedTwoProviders();
    const { resolveExactProvider } = await import('../../lib/provider-resolver');
    assert.equal(resolveExactProvider(''), null);
  });

  it('a deactivated provider still resolves to itself — is_active is a UI marker, not a delete', async () => {
    // Guard against over-tightening: is_active is a radio-button "currently
    // selected" flag (see activateProvider in db.ts). Treating it as "gone"
    // would silently kill title generation for every non-selected provider.
    const { pinned } = await seedTwoProviders();
    const { resolveExactProvider } = await import('../../lib/provider-resolver');
    const resolved = resolveExactProvider(pinned.id);
    assert.equal(resolved?.provider?.id, pinned.id);
  });
});
