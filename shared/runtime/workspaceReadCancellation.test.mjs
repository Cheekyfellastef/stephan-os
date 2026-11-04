import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import { waitForWorkspaceRead } from './workspaceReadCancellation.mjs';

test('cancelled subscribers leave independently and late rejection remains observed', async () => {
  let reject;
  const operation = new Promise((_, no) => { reject = no; });
  const controller = new AbortController();
  const cancelled = waitForWorkspaceRead(operation, controller.signal);
  const live = waitForWorkspaceRead(operation);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 1);
  controller.abort();
  await assert.rejects(cancelled, { name: 'AbortError' });
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  reject(new Error('late read failure'));
  await assert.rejects(live, /late read failure/);
  await setImmediate();
});

test('already-aborted and repeated completed/cancelled waits retain no abort listeners', async () => {
  for (let i = 0; i < 40; i++) {
    const controller = new AbortController();
    if (i % 2) {
      controller.abort();
      await assert.rejects(waitForWorkspaceRead(Promise.reject(new Error('late')), controller.signal), { name: 'AbortError' });
    } else {
      assert.equal(await waitForWorkspaceRead(Promise.resolve(i), controller.signal), i);
      assert.equal(controller.signal.aborted, false);
    }
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  }
  await setImmediate();
});

test('all subscribers can leave before a late shared rejection without unhandled work', async () => {
  let reject;
  const operation = new Promise((_, no) => { reject = no; });
  const controllers = [new AbortController(), new AbortController()];
  const waits = controllers.map(controller => waitForWorkspaceRead(operation, controller.signal));
  controllers.forEach(controller => controller.abort());
  await Promise.all(waits.map(wait => assert.rejects(wait, { name: 'AbortError' })));
  reject(new Error('failure after all consumers left'));
  await setImmediate();
  await setImmediate();
  controllers.forEach(controller => assert.equal(getEventListeners(controller.signal, 'abort').length, 0));
});
