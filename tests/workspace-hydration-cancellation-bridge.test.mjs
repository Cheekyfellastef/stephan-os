import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import {
  installWorkspaceHydrationParentBridge, requestWorkspaceHydration,
  WORKSPACE_HYDRATION_CANCEL_MESSAGE_V1, WORKSPACE_HYDRATION_RESPONSE_MESSAGE_V1,
} from '../shared/runtime/workspaceHydrationBridge.mjs';

function bridgeFixture() {
  const origin = 'http://127.0.0.1:4173';
  const parentListeners = new Set(), childListeners = new Set(), calls = [], requests = [];
  const parent = { location: { origin }, addEventListener: (_type, fn) => parentListeners.add(fn), removeEventListener: (_type, fn) => parentListeners.delete(fn) };
  const child = { location: { origin }, parent, setTimeout, clearTimeout, addEventListener: (_type, fn) => childListeners.add(fn), removeEventListener: (_type, fn) => childListeners.delete(fn) };
  const dispatchParent = event => { for (const listener of parentListeners) void listener(event); };
  parent.postMessage = (data, target) => { assert.equal(target, origin); requests.push(data); queueMicrotask(() => dispatchParent({ data, origin, source: child })); };
  child.postMessage = (data, target) => { assert.equal(target, origin); queueMicrotask(() => { for (const listener of childListeners) listener({ data, origin, source: parent }); }); };
  const fetchImpl = (_url, { signal }) => new Promise((resolve, reject) => {
    const call = { signal, resolve: payload => resolve({ ok: true, status: 200, text: async () => JSON.stringify(payload) }) };
    calls.push(call);
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  let activeFrame = child;
  const bridge = installWorkspaceHydrationParentBridge({ windowRef: parent, getActiveIframe: () => ({ contentWindow: activeFrame }), getActiveWorkspaceId: () => 'flywheel', runtimeContext: { frontendOrigin: origin }, fetchImpl });
  return { origin, parent, child, calls, requests, bridge, childListeners, parentListeners, dispatchParent, detach: () => { activeFrame = null; } };
}

async function until(predicate) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await setImmediate(); }
  assert.fail('expected bridge event did not occur');
}

test('unmounted iframe cancels its admitted parent fetch without direct fallback or listener leaks', async () => {
  const f = bridgeFixture(); const controller = new AbortController(); let direct = 0;
  const request = requestWorkspaceHydration({ workspaceId: 'flywheel', windowRef: f.child, signal: controller.signal, fetchImpl: () => { direct++; throw new Error('unexpected fallback'); } });
  try {
    await until(() => f.calls.length === 1);
    f.detach(); controller.abort();
    await assert.rejects(request, { name: 'AbortError' });
    await until(() => f.calls[0].signal.aborted);
    assert.equal(direct, 0);
    assert.equal(f.childListeners.size, 0);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  } finally { f.bridge.dispose(); }
});

test('cancellation requires the original source and origin; disposed parent aborts admitted reads', async () => {
  const f = bridgeFixture(); const controller = new AbortController();
  const request = requestWorkspaceHydration({ workspaceId: 'flywheel', windowRef: f.child, signal: controller.signal });
  await until(() => f.calls.length === 1);
  const data = { type: WORKSPACE_HYDRATION_CANCEL_MESSAGE_V1, requestId: f.requests[0].requestId };
  f.dispatchParent({ data, source: {}, origin: f.origin });
  f.dispatchParent({ data, source: f.child, origin: 'https://untrusted.example' });
  assert.equal(f.calls[0].signal.aborted, false);
  f.bridge.dispose();
  assert.equal(f.calls[0].signal.aborted, true);
  assert.equal(f.parentListeners.size, 0);
  controller.abort(); await assert.rejects(request, { name: 'AbortError' });
});

test('parent timeout cancels its old transport and late old replies cannot settle replacement work', async () => {
  const f = bridgeFixture(); let fallback = 0;
  try {
    const result = await requestWorkspaceHydration({
      workspaceId: 'flywheel', windowRef: f.child, timeoutMs: 25,
      runtimeContext: { frontendOrigin: f.origin },
      fetchImpl: async () => { fallback++; return { ok: true, status: 200, text: async () => '{"replacement":true}' }; },
    });
    assert.equal(result.replacement, true);
    await until(() => f.calls[0]?.signal.aborted);
    assert.equal(fallback, 1);
    assert.equal(f.childListeners.size, 0);
    const oldId = f.requests[0].requestId;
    let completed = false;
    const next = requestWorkspaceHydration({ workspaceId: 'flywheel', windowRef: f.child }).then(value => { completed = true; return value; });
    await until(() => f.calls.length === 2);
    f.child.postMessage({ type: WORKSPACE_HYDRATION_RESPONSE_MESSAGE_V1, requestId: oldId, ok: true, payload: { stale: true } }, f.origin);
    await setImmediate(); assert.equal(completed, false);
    f.calls[1].resolve({ current: true });
    assert.deepEqual(await next, { current: true });
    assert.equal(f.childListeners.size, 0);
  } finally { f.bridge.dispose(); }
});
