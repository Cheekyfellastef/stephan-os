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

function setupWorker({ switchDuringScreenshot = false, childFrames = false, rejectAllFrames = false, realFrameOrigins,
  captureTransition, screenshotError = false, backgroundWorkspaceCount = 0 } = {}) {
  const listeners = {};
  const calls = { permissions: [], native: [], screenshots: 0, injected: [], domReadOrigins: [] };
  const configuredTab = { id: 7, windowId: 2, url: configuredOrigin + '/apps/music-tile/index.html' };
  const otherTab = { id: 8, windowId: 2, url: 'https://private.example/account' };
  const sameHostOtherPort = { id: 9, windowId: 3, url: 'http://localhost:8787/admin' };
  const backgroundTabs = Array.from({length:backgroundWorkspaceCount},(_,index)=>({
    id:100+index, windowId:2, url:`${configuredOrigin}/workspace/${index}`,
  }));
  const browserListeners = { activated:new Set(), updated:new Set() };
  const event = listeners => ({addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)});
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
      onActivated:event(browserListeners.activated),
      onUpdated:event(browserListeners.updated),
      query: async (args) => {
        if (args.windowId === 2) {
          activeQueries++;
          return [switchDuringScreenshot && activeQueries > 1 ? otherTab : configuredTab];
        }
        if (args.currentWindow) return [configuredTab];
        return [...backgroundTabs, configuredTab, otherTab, sameHostOtherPort];
      },
      captureVisibleTab: async () => {
        calls.screenshots++;
        if(captureTransition==='activation-aba') {
          for(const callback of browserListeners.activated) {
            callback({tabId:otherTab.id,windowId:configuredTab.windowId});
            callback({tabId:configuredTab.id,windowId:configuredTab.windowId});
          }
        }
        if(captureTransition==='navigation-aba') {
          for(const callback of browserListeners.updated) {
            callback(configuredTab.id,{url:otherTab.url,status:'loading'});
            callback(configuredTab.id,{url:configuredTab.url,status:'complete'});
          }
        }
        if(captureTransition==='unrelated') {
          for(const callback of browserListeners.activated) callback({tabId:9,windowId:3});
          for(const callback of browserListeners.updated) callback(9,{url:sameHostOtherPort.url,status:'loading'});
        }
        if(screenshotError) throw new Error('capture failed');
        return 'data:image/jpeg;base64,/9j/2Q==';
      },
    },
    scripting: { executeScript: async ({ target, func, args }) => {
      calls.injected.push({target,args});
      if (rejectAllFrames && target.allFrames) throw new Error('Restricted third-party iframe');
      if (realFrameOrigins) {
        return realFrameOrigins.map((origin,frameId)=>({frameId,result:vm.runInNewContext(
          '('+func.toString()+')(...injectedArgs)', {
            injectedArgs:args, location:new URL(origin+'/private'), URL,
            document:{readyState:'complete',querySelectorAll(){
              calls.domReadOrigins.push(origin); return [];
            }},
          })}));
      }
      const primary = { frameId:0, result:{
        readyState:'complete', imageCount:1, brokenImages:0, unloadedImages:0,
        linkCount:2, genericSpotifyLinks:1, spotifyTrackLinks:0,
        spotifySearchLinks:1, buttonCount:1, disabledButtonCount:0,
        headingCount:1, iframeCount:childFrames?1:0,
      }};
      const child = { frameId:2, result:{
        readyState:'complete', imageCount:2, brokenImages:1, unloadedImages:0,
        linkCount:3, genericSpotifyLinks:0, spotifyTrackLinks:2,
        spotifySearchLinks:0, buttonCount:2, disabledButtonCount:0,
        headingCount:1, iframeCount:0,
      }};
      return target.allFrames && childFrames ? [primary,child] : [primary];
    } },
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
  return { calls, message, listeners, browserListeners };
}

test('worker rejects other sites and same-host other-port tabs despite broader port-free host permission', async () => {
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

test('permitted child-frame metrics are aggregated while frame completeness remains unknown', async () => {
  const {calls,message} = setupWorker({ childFrames:true });
  const result = await message('witness-scan');
  assert.equal(result.ok,true);
  const record = calls.native.find(item=>item.action==='record').snapshots[0];
  assert.equal(record.metrics.instrumentedFrameCount,2);
  assert.equal(record.metrics.imageCount,3);
  assert.equal(record.metrics.brokenImages,1);
  assert.equal(record.metrics.spotifyTrackLinks,2);
  assert.equal(record.metrics.frameCoverageFullyVerified,false);
  assert.equal(record.screenshot,'');
});
test('restricted child-frame injection safely falls back to top-frame diagnostics', async () => {
  const {calls,message} = setupWorker({ childFrames:true, rejectAllFrames:true });
  const result = await message('witness-scan');
  assert.equal(result.ok,true);
  const record = calls.native.find(item=>item.action==='record').snapshots[0];
  assert.equal(record.metrics.instrumentedFrameCount,1);
  assert.equal(record.metrics.frameCoverageFullyVerified,false);
  assert.equal(record.metrics.iframeCount,1);
  assert.equal(calls.injected.length,2);
  for(const call of calls.injected) assert.deepEqual(Array.from(call.args[0]),[configuredOrigin]);
});
test('exact origin admission runs inside every injected frame before any DOM access', async()=>{
  const {calls,message}=setupWorker({realFrameOrigins:[
    configuredOrigin,'http://localhost:8787','https://private.example',
  ]});
  assert.equal((await message('witness-scan')).ok,true);
  assert.ok(calls.domReadOrigins.length>0);
  assert.deepEqual([...new Set(calls.domReadOrigins)],[configuredOrigin]);
  const record=calls.native.find(item=>item.action==='record').snapshots[0];
  assert.equal(record.metrics.instrumentedFrameCount,1);
  assert.equal(record.metrics.frameCoverageFullyVerified,false);
});
test('navigation to an unapproved origin between tab selection and injection exposes no DOM', async()=>{
  const {calls,message}=setupWorker({realFrameOrigins:['http://localhost:8787']});
  const result=await message('witness-scan');
  assert.equal(result.ok,false);
  assert.equal(result.blocker,'NO_PERMITTED_STEPHANOS_TABS');
  assert.equal(calls.domReadOrigins.length,0);
  assert.equal(calls.native.filter(item=>item.action==='record').length,0);
});
test('capture refuses changed active tab and never sends screenshot bytes to host', async () => {
  const { calls, message } = setupWorker({ switchDuringScreenshot: true });
  const result = await message('witness-capture');
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'BROWSER_ACTIVE_TAB_CHANGED');
  assert.equal(calls.screenshots, 1);
  assert.equal(calls.native.filter((item) => item.action === 'record').length, 0);
});
test('capture reserves a bounded slot for the active workspace after eight background tabs',async()=>{
  const {calls,message}=setupWorker({backgroundWorkspaceCount:8});
  assert.equal((await message('witness-capture')).ok,true);
  assert.equal(calls.screenshots,1);
  const recorded=calls.native.find(item=>item.action==='record');
  assert.equal(recorded.snapshots.length,8);
  assert.equal(recorded.snapshots[0].active,true);
  assert.equal(recorded.snapshots.filter(row=>row.active).length,1);
  assert.equal(recorded.snapshots.filter(row=>row.screenshot).length,1);
  assert.deepEqual(calls.injected.map(call=>call.target.tabId),[7,100,101,102,103,104,105,106]);
});
test('diagnostic scans retain the eight-tab bound without taking a foreground screenshot',async()=>{
  const {calls,message}=setupWorker({backgroundWorkspaceCount:8});
  assert.equal((await message('witness-scan')).ok,true);
  assert.equal(calls.screenshots,0);
  const recorded=calls.native.find(item=>item.action==='record');
  assert.equal(recorded.snapshots.length,8);
  assert.equal(recorded.snapshots.filter(row=>row.screenshot).length,0);
  assert.deepEqual(calls.injected.map(call=>call.target.tabId),[100,101,102,103,104,105,106,107]);
});
for(const captureTransition of ['activation-aba','navigation-aba']) {
  test(`capture discards ${captureTransition} even when before and after tab IDs and URLs match`,async()=>{
    const {calls,message,browserListeners}=setupWorker({captureTransition});
    const result=await message('witness-capture');
    assert.equal(result.ok,false);
    assert.equal(result.blocker,'BROWSER_ACTIVE_TAB_CHANGED');
    assert.equal(calls.screenshots,1);
    assert.equal(calls.native.filter(item=>item.action==='record').length,0);
    assert.equal(browserListeners.activated.size,0);
    assert.equal(browserListeners.updated.size,0);
  });
}
test('capture removes transition listeners after success and a screenshot exception',async()=>{
  for(const screenshotError of [false,true]) {
    const {message,browserListeners}=setupWorker({captureTransition:'unrelated',screenshotError});
    assert.equal((await message('witness-capture')).ok,!screenshotError);
    assert.equal(browserListeners.activated.size,0);
    assert.equal(browserListeners.updated.size,0);
  }
});
