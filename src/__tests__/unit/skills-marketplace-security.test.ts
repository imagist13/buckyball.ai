import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { POST as installSkill } from '@/app/api/skills/marketplace/install/route';
import { POST as removeSkill } from '@/app/api/skills/marketplace/remove/route';
import {
  buildSkillsProcessSpec,
  isValidMarketplaceSkillName,
  isValidMarketplaceSource,
  validateMarketplaceMutationRequest,
} from '@/lib/skills-marketplace-command';

function marketplaceRequest(
  pathname: string,
  body: string,
  headers: Record<string, string> = {},
): Request {
  return new Request(`http://localhost:3000${pathname}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
      'sec-fetch-site': 'same-origin',
      ...headers,
    },
    body,
  });
}

describe('Skills Marketplace process boundary', () => {
  it('builds shell-free argv specs on Unix and a fixed cmd bridge on Windows', () => {
    const args = ['skills', 'add', 'owner/repo', '-g', '-y'];
    assert.deepEqual(buildSkillsProcessSpec(args, 'darwin'), {
      command: 'npx',
      args,
      shell: false,
    });
    const windows = buildSkillsProcessSpec(args, 'win32');
    assert.equal(windows.shell, false);
    assert.match(windows.command.toLowerCase(), /(?:^|[\\/])cmd\.exe$|^cmd\.exe$/);
    assert.deepEqual(windows.args, ['/d', '/s', '/c', 'npx.cmd', ...args]);
  });

  it('accepts marketplace repository/name shapes and rejects command syntax', () => {
    assert.equal(isValidMarketplaceSource('owner/repo'), true);
    assert.equal(
      isValidMarketplaceSource('https://github.com/owner/repo/tree/main/skills/pdf'),
      true,
    );
    assert.equal(isValidMarketplaceSkillName('pdf-tools'), true);
    for (const value of [
      '; touch /tmp/pwned #',
      "owner/repo' && touch /tmp/pwned",
      'owner/repo$(touch /tmp/pwned)',
      '--require=evil',
      'file:///tmp/evil',
    ]) {
      assert.equal(isValidMarketplaceSource(value), false, value);
      assert.equal(isValidMarketplaceSkillName(value), false, value);
    }
  });

  it('rejects cross-origin, missing-origin, and text/plain mutation requests', () => {
    const crossOrigin = marketplaceRequest(
      '/api/skills/marketplace/install',
      JSON.stringify({ source: 'owner/repo' }),
      { origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' },
    );
    assert.equal(validateMarketplaceMutationRequest(crossOrigin)?.status, 403);

    const missingOrigin = marketplaceRequest(
      '/api/skills/marketplace/install',
      JSON.stringify({ source: 'owner/repo' }),
    );
    missingOrigin.headers.delete('origin');
    assert.equal(validateMarketplaceMutationRequest(missingOrigin)?.status, 403);

    const simplePost = marketplaceRequest(
      '/api/skills/marketplace/install',
      JSON.stringify({ source: 'owner/repo' }),
      { 'content-type': 'text/plain' },
    );
    assert.equal(validateMarketplaceMutationRequest(simplePost)?.status, 415);
  });

  it('uses Host as the browser destination when Next canonicalizes request.url', () => {
    const electronRequest = marketplaceRequest(
      '/api/skills/marketplace/install',
      JSON.stringify({ source: 'owner/repo' }),
      { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' },
    );
    assert.equal(validateMarketplaceMutationRequest(electronRequest), null);
  });

  it('rejects matching non-loopback Host and Origin to prevent DNS rebinding', () => {
    const reboundRequest = marketplaceRequest(
      '/api/skills/marketplace/install',
      JSON.stringify({ source: 'owner/repo' }),
      { host: 'attacker.example', origin: 'http://attacker.example' },
    );
    assert.equal(validateMarketplaceMutationRequest(reboundRequest)?.status, 403);
  });

  it('install/remove routes reject hostile values before spawning a process', async () => {
    const installResponse = await installSkill(marketplaceRequest(
      '/api/skills/marketplace/install',
      JSON.stringify({ source: '; touch /tmp/install-pwned #' }),
    ));
    assert.equal(installResponse.status, 400);

    const removeResponse = await removeSkill(marketplaceRequest(
      '/api/skills/marketplace/remove',
      JSON.stringify({ skill: 'x && touch /tmp/remove-pwned' }),
    ));
    assert.equal(removeResponse.status, 400);
  });

  it('routes enforce same-origin JSON before considering a valid command', async () => {
    const crossOrigin = await installSkill(marketplaceRequest(
      '/api/skills/marketplace/install',
      JSON.stringify({ source: 'owner/repo' }),
      { origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' },
    ));
    assert.equal(crossOrigin.status, 403);

    const simplePost = await removeSkill(marketplaceRequest(
      '/api/skills/marketplace/remove',
      JSON.stringify({ skill: 'pdf-tools' }),
      { 'content-type': 'text/plain' },
    ));
    assert.equal(simplePost.status, 415);
  });
});
