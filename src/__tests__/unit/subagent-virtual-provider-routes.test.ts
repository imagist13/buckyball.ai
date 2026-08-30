import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { setDefaultProviderId, setSetting } from '@/lib/db';
import {
  listManagedVirtualProviderModelGroups,
} from '@/lib/managed-virtual-provider-models';
import { getModelCompat } from '@/lib/runtime-compat';
import {
  getSubagentRoutingGuidance,
  listSubagentRoutes,
} from '@/lib/subagent-models';
import { listClaudeSubagentRoutes } from '@/lib/claude-subagent-mcp';
import { GET as listProviderModels } from '@/app/api/providers/models/route';

const originalXaiOAuthEnabled = process.env.CODEPILOT_XAI_OAUTH_ENABLED;

function clearVirtualCredentials(): void {
  setSetting('openai_oauth_access_token', '');
  setSetting('openai_oauth_refresh_token', '');
  setSetting('openai_oauth_expires_at', '');
  setSetting('openai_oauth_plan', '');
  setSetting('xai_oauth_bundle', '');
  setDefaultProviderId('');
}

beforeEach(() => {
  process.env.CODEPILOT_XAI_OAUTH_ENABLED = '1';
  clearVirtualCredentials();
});

afterEach(() => {
  clearVirtualCredentials();
  if (originalXaiOAuthEnabled === undefined) {
    delete process.env.CODEPILOT_XAI_OAUTH_ENABLED;
  } else {
    process.env.CODEPILOT_XAI_OAUTH_ENABLED = originalXaiOAuthEnabled;
  }
});

describe('managed virtual providers share picker and Sub-agent route discovery', () => {
  it('keeps unauthenticated OAuth providers out of both managed Runtime route lists', () => {
    assert.deepEqual(listManagedVirtualProviderModelGroups(), []);
    assert.equal(
      listSubagentRoutes('codepilot_runtime').some(route => route.providerId === 'xai-oauth'),
      false,
    );
    assert.equal(
      listSubagentRoutes('codex_runtime').some(route => route.providerId === 'xai-oauth'),
      false,
    );
  });

  it('exposes authenticated Grok Build OAuth with Grok 4.6 first to CodePilot and Codex Sub-agents', async () => {
    setSetting('xai_oauth_bundle', JSON.stringify({
      accessToken: 'xai-test-token-never-send',
      refreshToken: 'xai-test-refresh-never-send',
      expiresAt: Date.now() + 60 * 60 * 1000,
      updatedAt: Date.now(),
    }));

    const virtual = listManagedVirtualProviderModelGroups().find(
      group => group.providerId === 'xai-oauth',
    );
    assert.ok(virtual);
    assert.deepEqual(
      virtual.models.map(model => model.modelId),
      ['grok-4.6', 'grok-4.5'],
    );
    assert.equal(virtual.compat, 'codepilot_only');
    assert.equal(virtual.protocol, 'xai');
    assert.equal(
      getModelCompat({
        modelId: virtual.models[0].modelId,
        providerCompat: virtual.compat,
      }).supportedRuntimes?.includes('claude_code'),
      false,
      'the compatibility matrix, not candidate omission, must exclude xAI from Claude Code',
    );

    for (const runtime of ['codepilot_runtime', 'codex_runtime'] as const) {
      const route = listSubagentRoutes(runtime).find(
        candidate => candidate.providerId === 'xai-oauth'
          && candidate.id === 'grok-4.6',
      );
      assert.ok(route, `${runtime} must expose authenticated xAI OAuth Grok`);
      assert.equal(route.displayName, 'Grok 4.6');
      assert.match(
        getSubagentRoutingGuidance(runtime, [route]),
        /provider_id="xai-oauth", model="grok-4\.6"/,
      );
    }

    const response = await listProviderModels(
      new NextRequest('http://test.local/api/providers/models?runtime=codepilot_runtime'),
    );
    const data = await response.json() as {
      groups: Array<{
        provider_id: string;
        models: Array<{ value: string; supportedRuntimes?: string[] }>;
      }>;
    };
    const pickerGroup = data.groups.find(group => group.provider_id === 'xai-oauth');
    assert.ok(pickerGroup, 'the picker and Sub-agent catalog must share xAI OAuth availability');
    assert.equal(pickerGroup.models[0]?.value, 'grok-4.6');
    assert.ok(pickerGroup.models[0]?.supportedRuntimes?.includes('codepilot_runtime'));

    assert.equal(
      listClaudeSubagentRoutes().some(route => route.providerId === 'xai-oauth'),
      false,
      'Claude route enumeration must consume the virtual catalog and then exclude xAI by compatibility',
    );
  });

  it('removes xAI OAuth from managed routes when the integration is disabled', () => {
    setSetting('xai_oauth_bundle', JSON.stringify({
      accessToken: 'xai-test-token-never-send',
      expiresAt: Date.now() + 60 * 60 * 1000,
      updatedAt: Date.now(),
    }));
    process.env.CODEPILOT_XAI_OAUTH_ENABLED = '0';

    assert.equal(
      listManagedVirtualProviderModelGroups().some(group => group.providerId === 'xai-oauth'),
      false,
    );
    assert.equal(
      listSubagentRoutes('codepilot_runtime').some(route => route.providerId === 'xai-oauth'),
      false,
    );
  });

  it('also restores authenticated OpenAI OAuth routes instead of fixing only Grok by name', () => {
    setSetting('openai_oauth_access_token', 'openai-test-token-never-send');
    setSetting('openai_oauth_expires_at', String(Date.now() + 60 * 60 * 1000));
    setSetting('openai_oauth_plan', 'plus');

    const virtual = listManagedVirtualProviderModelGroups().find(
      group => group.providerId === 'openai-oauth',
    );
    assert.ok(virtual);
    assert.match(virtual.providerName, /plus/);
    assert.equal(virtual.compat, 'codepilot_only');
    assert.equal(virtual.protocol, 'openai-compatible');

    for (const runtime of ['codepilot_runtime', 'codex_runtime'] as const) {
      assert.ok(
        listSubagentRoutes(runtime).some(
          route => route.providerId === 'openai-oauth' && route.id === 'gpt-5.5',
        ),
        `${runtime} must include authenticated managed OpenAI OAuth routes`,
      );
    }
  });
});
