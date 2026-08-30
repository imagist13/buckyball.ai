import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { SingleOwnerStreamWriter } from '../../lib/single-owner-stream-writer';

function fakeController(options?: { throwOnEnqueue?: boolean }) {
  const values: string[] = [];
  let closeCount = 0;
  const controller = {
    enqueue(value: string) {
      if (options?.throwOnEnqueue) throw new TypeError('controller is already closed');
      values.push(value);
    },
    close() {
      closeCount += 1;
    },
  } as unknown as ReadableStreamDefaultController<string>;
  return { controller, values, closeCount: () => closeCount };
}

describe('SingleOwnerStreamWriter', () => {
  it('makes callbacks after consumer cancellation harmless', () => {
    const fake = fakeController();
    const writer = new SingleOwnerStreamWriter<string>();
    writer.attach(fake.controller);

    assert.equal(writer.enqueue('before cancel'), true);
    assert.equal(writer.cancel(), true);
    assert.equal(writer.enqueue('buffered stdout'), false);
    assert.equal(writer.close(), false);
    assert.deepEqual(fake.values, ['before cancel']);
    assert.equal(fake.closeCount(), 0);
  });

  it('allows exactly one terminal close', () => {
    const fake = fakeController();
    const writer = new SingleOwnerStreamWriter<string>();
    writer.attach(fake.controller);

    assert.equal(writer.close(), true);
    assert.equal(writer.close(), false);
    assert.equal(writer.cancel(), false);
    assert.equal(fake.closeCount(), 1);
  });

  it('claims terminal ownership when enqueue loses a cancellation race', () => {
    const fake = fakeController({ throwOnEnqueue: true });
    const writer = new SingleOwnerStreamWriter<string>();
    writer.attach(fake.controller);

    assert.equal(writer.enqueue('late write'), false);
    assert.equal(writer.isTerminal, true);
    assert.equal(writer.close(), false);
  });

  it('wires every subprocess/callback route through the tested single-owner contract', () => {
    const fixtures = [
      {
        route: '../../app/api/skills/marketplace/install/route.ts',
        producerStop: /writer\.cancel\(\)[\s\S]*child\.kill\(\)/,
      },
      {
        route: '../../app/api/skills/marketplace/remove/route.ts',
        producerStop: /writer\.cancel\(\)[\s\S]*child\.kill\(\)/,
      },
      {
        route: '../../app/api/cli-tools/[id]/install/route.ts',
        producerStop: /writer\.cancel\(\)[\s\S]*child\.kill\(\)/,
      },
      {
        route: '../../app/api/media/jobs/plan/route.ts',
        producerStop: /writer\.cancel\(\)[\s\S]*cancellation\.abort\(\)/,
      },
    ];

    for (const fixture of fixtures) {
      const route = fs.readFileSync(path.resolve(__dirname, fixture.route), 'utf8');
      assert.match(route, /new SingleOwnerStreamWriter<Uint8Array>/, fixture.route);
      assert.match(route, /writer\.attach\(controller\)/, fixture.route);
      assert.match(route, fixture.producerStop, `${fixture.route}: cancel must claim terminal ownership before stopping the producer`);
      assert.doesNotMatch(route, /controller\.enqueue/, fixture.route);
      assert.doesNotMatch(route, /controller\.close/, fixture.route);
    }

    const mediaRoute = fs.readFileSync(
      path.resolve(__dirname, '../../app/api/media/jobs/plan/route.ts'),
      'utf8',
    );
    assert.match(mediaRoute, /abortSignal,/);
  });
});
