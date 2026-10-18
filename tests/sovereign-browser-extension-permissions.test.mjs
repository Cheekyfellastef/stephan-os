import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const popupSource = await readFile(new URL('../apps/sovereign-browser-bridge/popup.js', import.meta.url), 'utf8');
const workerSource = await readFile(new URL('../apps/sovereign-browser-bridge/service-worker.js', import.meta.url), 'utf8');
const configuredOrigin = 'http://localhost:4173';

function tick() { return new Promise((resolve) => setImmediate(resolve)); }

test('permission request is synchronous with click, uses port-free pattern, and revokes same scope', async () => {
  const nodes = new Map();
  const node = (id) => {
    if (!nodes.has(id)) nodes.set(id, {
      disabled: false, textContent: '',
      listeners: new Map(),
      addEventListener(name, cb) { this.listeners.set(name, cb); },
    });
    return nodes.get(id);
  };
  const requested = [], removed = [];
  const chrome = {
    tabs: { query: async () => [{ url: configuredOrigin + '/apps/goal-dashboard/index.html' }] },
    runtime: { sendMessage: async () => ({ ok: true, allowedOrigins: [configuredOrigin] }) },
    permissions: {
      request: (args) => { requested.push(args); return Promise.resolve(true); },
      remove: (args) => { removed.push(args); return Promise.resolve(true); },
    },
  };
  vm.runInNewContext(popupSource, { chrome, document: { querySelector: node }, URL });
  await tick();
  assert.equal(node('#grant').disabled, false);
  node('#grant').listeners.get('click')();
  // Must be called in the same synchronous user gesture.
  assert.equal(requested.length, 1);
  assert.equal(requested[0].origins[0], 'http://localhost/*');
  node('#revoke').listeners.get('click')();
  assert.equal(removed[0].origins[0], 'http://localhost/*');
});

function setupWorker({ switchDuringScreenshot = false } = {}) {
  const listeners = {};
  const calls = { permissions: [], native: [], screenshots: 0 };
  const configuredTab = { id: 7, windowId: 2, url: configuredOrigin + '/apps/music-tile/index.html' };
  const otherTab = { id: 8, windowId: 2, url: 'https://private.example/account' };
  let activeQueries = 0;
  const chrome = {
    runtime: {
      id: 'test-extension',
      lastError: null,
      sendNativeMessage: (host, message, callback) => {
        calls.native.push(message);
        callback(message.action === 'config'
          ? { schemaVersion: 'stephanos.browser-native-message.v1', ok: true, allowedOrigins: [configuredOrigin] }
          : { schemaVersion: 'stephanos.browser-native-message.v1', ok: true, observedTabCount: 1 });
      },
      onMessage: { addListener: (cb) => { listeners.message = cb; } },
    },
    tabs: {
      query: async (args) => {
        if (args.windowId === 2) {
          activeQueries++;
          return [switchDuringScreenshot && activeQueries > 1 ? otherTab : configuredTab];
        }
        if (args.currentWindow) return [configuredTab];
        return [configuredTab, otherTab];
      },
      captureVisibleTab: async () => { calls.screenshots++; return 'data:image/jpeg;base64,/9j/2Q=='; },
    },
    scripting: { executeScript: async () => [{ result: {
      readyState: 'complete', images: [], links: [], imageCount: 1,
      brokenImages: 0, genericSpotifyLinks: 1,
    } }] },
    permissions: {
      contains: async (args) => { calls.permissions.push(args); return true; },
    },
    alarms: { onAlarm: { addListener: (cb) => { listeners.alarm = cb; } }, create: async () => {}, clear: async () => {} },
    storage: { local: { get: async () => ({}), set: async () => {} } },
  };
  vm.runInNewContext(workerSource, { chrome, URL, document: {}, location: {}, console });
  const message = async (type) => new Promise((resolve) => {
    const handled = listeners.message({ type }, { id: 'test-extension' }, resolve);
    assert.equal(handled, true);
  });
  return { calls, message, listeners };
}

test('worker uses port-free host permission but enforces exact-origin admission before inspection', async () => {
  const { calls, message } = setupWorker();
  const result = await message('witness-scan');
  assert.equal(result.ok, true);
  assert.equal(calls.permissions.length, 1);
  assert.equal(calls.permissions[0].origins[0], 'http://localhost/*');
  const recorded = calls.native.find((item) => item.action === 'record');
  assert.equal(recorded.snapshots.length, 1);
  assert.equal(recorded.snapshots[0].origin, configuredOrigin);
  assert.equal(recorded.snapshots[0].screenshot, '');
  assert.equal(calls.screenshots, 0);
});

test('capture refuses changed active tab and never sends screenshot bytes to host', async () => {
  const { calls, message } = setupWorker({ switchDuringScreenshot: true });
  const result = await message('witness-capture');
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'BROWSER_ACTIVE_TAB_CHANGED');
  assert.equal(calls.screenshots, 1);
  assert.equal(calls.native.filter((item) => item.action === 'record').length, 0);
});
