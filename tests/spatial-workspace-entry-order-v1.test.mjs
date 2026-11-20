import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import {
  createHolodeckEntryLifecycle,
  enterHolodeckBaseline,
} from '../apps/spatial-bridge/holodeck-baseline-v0.mjs';

const html = readFileSync(new URL('../apps/spatial-bridge/quest-entry.html', import.meta.url), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function sessionFixture({ referenceSpace, endError } = {}) {
  const session = new EventTarget();
  Object.assign(session, {
    inputSources: [], visibilityState: 'visible', renderState: {},
    endCalls: 0, frameRequests: 0, referenceRequests: 0,
    updateRenderState(value) { Object.assign(this.renderState, value); },
    requestReferenceSpace() { this.referenceRequests += 1; return referenceSpace?.promise ?? Promise.resolve({}); },
    requestAnimationFrame(callback) { this.frameRequests += 1; this.frame = callback; },
    async end() {
      this.endCalls += 1;
      if (endError) throw endError;
      this.dispatchEvent(new Event('end'));
    },
  });
  return session;
}
function recorderFixture({ startGate } = {}) {
  return {
    starts: 0, ends: 0, frames: 0, sessions: [], failures: [],
    attachSession(session) { this.sessions.push(session); },
    start() { this.starts += 1; return startGate?.promise ?? Promise.resolve(); },
    async end() { this.ends += 1; },
    recordFrame() { this.frames += 1; },
    async fail(error) { this.failures.push(error.message); },
  };
}
function fixture({ request, session = sessionFixture(), graphics, rendererError, createTelemetry = async () => null } = {}) {
  const events = [], states = [], telemetryStatuses = [], renderers = [];
  const canvas = { getContext() { events.push('graphics'); return { makeXRCompatible: () => graphics?.promise ?? Promise.resolve() }; } };
  const room = {
    canvas,
    navigatorRef: { xr: { requestSession(mode) {
      assert.equal(mode, 'immersive-vr');
      events.push('request');
      return request ? request() : Promise.resolve(session);
    } } },
    xrWebGLLayerCtor: class {},
    rendererFactory() {
      events.push('renderer');
      if (rendererError) throw rendererError;
      const renderer = { geometry: {}, disposed: 0, draws: 0,
        drawFrame() { this.draws += 1; return { poseAvailable: true, viewCount: 2 }; },
        dispose() { this.disposed += 1; } };
      renderers.push(renderer);
      return renderer;
    },
  };
  const entry = createHolodeckEntryLifecycle({
    enterRoom: options => enterHolodeckBaseline({ ...room, ...options }),
    createTelemetry(options) { events.push('telemetry'); return createTelemetry(options); },
    onState: value => states.push(value),
    onTelemetryStatus: value => telemetryStatuses.push(value),
  });
  return { entry, session, canvas, events, states, telemetryStatuses, renderers, room };
}
function frame(session) {
  return { session, getViewerPose: () => ({ transform: {
    position: { x: 0, y: 1.6, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 },
  } }) };
}

test('immersive entry revokes local audio tests and blocks new tests without touching ChatGPT Voice', () => {
  const start = html.indexOf('    const workspaceEntry = createHolodeckEntryLifecycle({');
  const end = html.indexOf("    enterButton.addEventListener('click'", start);
  assert.ok(start >= 0 && end > start);
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, { disabled: false, textContent: '' });
    return nodes.get(id);
  };
  let onState, micStops = 0, speakerStops = 0, audioRefreshes = 0;
  const page = vm.createContext({
    createHolodeckEntryLifecycle: options => {
      onState = options.onState;
      return { isBusy: () => false };
    },
    enterHolodeckBaseline() {}, createSpatialWorkspaceTelemetryRecorderV1() {},
    enterButton: node('enter-holodeck'), sessionReason: node('session-reason'),
    stopMicTest() { micStops += 1; },
    audio: {
      stopSpeakers() { speakerStops += 1; },
      getState() { return { microphoneActive: false, microphonePending: false }; },
    },
    refreshAudioUI() { audioRefreshes += 1; },
    previewFrame: 19, previewRenderer: { dispose() {} },
    immersiveActive: false, cancelAnimationFrame() {},
    document: { getElementById: node },
  });
  vm.runInContext(html.slice(start, end), page);
  onState({ state: 'requesting' });
  assert.equal(page.immersiveActive, true);
  assert.equal(micStops, 1, 'a pending or active local mic test must be revoked');
  assert.equal(speakerStops, 1, 'a pending or active local speaker tone must be revoked');
  assert.equal(audioRefreshes, 1, 'audio test controls must be refreshed under VR state');

  const controlsStart = html.indexOf("    document.getElementById('audio-test-microphone').addEventListener");
  const controlsEnd = html.indexOf("    document.getElementById('audio-voice-help').addEventListener", controlsStart);
  assert.ok(controlsStart >= 0 && controlsEnd > controlsStart);
  let micStarts = 0, speakerStarts = 0, stopCalls = 0;
  const handlers = new Map();
  const controls = vm.createContext({
    immersiveActive: true,
    document: { getElementById: id => ({
      addEventListener: (_kind, handler) => handlers.set(id, handler),
    }) },
    audio: {
      testMicrophone() { micStarts += 1; },
      testSpeakers() { speakerStarts += 1; },
    },
    stopMicTest() { stopCalls += 1; },
  });
  vm.runInContext(html.slice(controlsStart, controlsEnd), controls);
  handlers.get('audio-test-microphone')();
  handlers.get('audio-test-speakers')();
  assert.equal(micStarts, 0);
  assert.equal(speakerStarts, 0);
  handlers.get('audio-stop-microphone')();
  assert.equal(stopCalls, 1, 'Stop remains usable in VR');
  controls.immersiveActive = false;
  handlers.get('audio-test-microphone')();
  handlers.get('audio-test-speakers')();
  assert.equal(micStarts, 1, 'the explicit local test is available again after exit');
  assert.equal(speakerStarts, 1);
});

test('the actual Enter handler requests XR in the click before any telemetry work; stalled telemetry cannot hold entry', { timeout: 1000 }, async () => {
  const telemetry = deferred(), startGate = deferred(), recorder = recorderFixture({ startGate });
  let activated = false, click;
  const h = fixture({ createTelemetry: () => telemetry.promise,
    request: () => { assert.equal(activated, true); return Promise.resolve(h.session); } });
  const start = html.indexOf("    enterButton.addEventListener('click'");
  const end = html.indexOf("    pingButton.addEventListener('click'", start);
  assert.ok(start > 0 && end > start);
  vm.runInNewContext(html.slice(start, end), {
    workspaceEntry: h.entry, canvas: h.canvas,
    cubeScene: undefined, screen: undefined, comfort: undefined, furniture: undefined,
    lastCapability: { device: 'Quest/browser' }, controllerStatus: {},
    document: { getElementById: () => ({}) },
    enterButton: { addEventListener: (_name, callback) => { click = callback; } },
  });
  activated = true;
  click();
  activated = false;
  assert.deepEqual(h.events, ['request']);
  await flush();
  assert.equal(h.states.at(-1).state, 'active');
  assert.equal(h.entry.isBusy(), true);
  assert.ok(h.events.indexOf('request') < h.events.indexOf('telemetry'));
  telemetry.resolve(recorder);
  await flush();
  assert.equal(recorder.starts, 1);
  assert.deepEqual(recorder.sessions, [h.session]);
  assert.equal(h.states.at(-1).state, 'active');
  await h.session.end();
  startGate.resolve();
  await flush();
  assert.equal(recorder.ends, 1);
  assert.equal(h.entry.isBusy(), false);
});

test('pending and active entries reject overlapping clicks, including a late capability probe', async () => {
  const grant = deferred(), capability = deferred();
  const h = fixture({ request: () => grant.promise });
  const first = h.entry.enter();
  assert.equal((await h.entry.enter()).busy, true);
  let refresh;
  const enterButton = { disabled: false };
  const source = html.slice(html.indexOf('    async function refreshCapabilities('), html.indexOf('    const workspaceEntry ='));
  const context = vm.createContext({ workspaceEntry: h.entry, enterButton, lastCapability: null,
    inspectHolodeckBaselineCapabilities: () => capability.promise,
    webxrStatus: {}, deviceStatus: {}, sessionReason: {} });
  vm.runInContext(source + '\nrefresh = refreshCapabilities;', context);
  refresh = context.refresh();
  capability.resolve({ immersiveSupported: true, device: 'Quest/browser', reason: 'available' });
  await refresh;
  assert.equal(enterButton.disabled, true);
  grant.resolve(h.session);
  assert.equal((await first).ok, true);
  assert.equal((await h.entry.enter()).busy, true);
  assert.equal(h.events.filter(value => value === 'request').length, 1);
  await h.session.end();
  assert.equal(h.entry.isBusy(), false);
});

test('actual pagehide invalidates a pending request and closes a late grant without graphics or adoption', async () => {
  const grant = deferred();
  const h = fixture({ request: () => grant.promise });
  const result = h.entry.enter();
  let pagehide, microphoneStops = 0, speakerStops = 0;
  const source = html.split('\n').find(line => line.includes("window.addEventListener('pagehide'"));
  assert.ok(source);
  vm.runInNewContext(source, {
    workspaceEntry: h.entry, comfort: { flush() {} }, furniture: { flush() {} },
    stopMicTest() { microphoneStops++; }, audio: { stopSpeakers() { speakerStops++; } },
    cubeScene: { stop() {} }, client: { pagehide() {} },
    window: { addEventListener: (_name, callback) => { pagehide = callback; } },
  });
  pagehide({ persisted: true });
  assert.equal(microphoneStops, 1, 'pagehide synchronously revokes any local microphone test');
  assert.equal(speakerStops, 1, 'pagehide synchronously revokes any pending or active speaker test');
  assert.equal(h.entry.isBusy(), true);
  assert.equal((await h.entry.enter()).busy, true);
  grant.resolve(h.session);
  assert.equal((await result).ok, false);
  await flush();
  assert.equal(h.session.endCalls, 1);
  assert.equal(h.events.includes('graphics'), false);
  assert.equal(h.events.includes('renderer'), false);
  assert.equal(h.states.some(value => value.state === 'active'), false);
  assert.equal(h.entry.isBusy(), false);
});

test('stopping during asynchronous graphics setup prevents later reference-space work and rendering', async () => {
  const graphics = deferred();
  const h = fixture({ graphics });
  const result = h.entry.enter();
  await flush();
  assert.equal(h.events.includes('graphics'), true);
  h.entry.stop();
  assert.equal(h.entry.isBusy(), true, 'the setup continuation still owns the pending attempt');
  assert.equal((await result).ok, false);
  assert.equal(h.entry.isBusy(), false, 'proven session closure does not wait for graphics completion');
  assert.equal(h.session.referenceRequests, 0);
  assert.equal(h.renderers.length, 0);
  assert.equal(h.session.endCalls, 1);
  const next = sessionFixture();
  assert.equal((await h.entry.enter({ canvas: { getContext: () => ({}) },
    navigatorRef: { xr: { requestSession: () => Promise.resolve(next) } } })).ok, true);
  graphics.resolve();
  await flush();
  assert.equal(h.renderers.length, 1);
  assert.equal(h.renderers[0].disposed, 0);
  assert.equal(h.entry.isBusy(), true);
  await next.end();
});

test('an external session end during reference-space setup prevents adoption and does not request another space', async () => {
  const referenceSpace = deferred(), session = sessionFixture({ referenceSpace });
  const h = fixture({ session });
  const result = h.entry.enter();
  await flush();
  assert.equal(session.referenceRequests, 1);
  session.dispatchEvent(new Event('end'));
  assert.equal(h.entry.isBusy(), true);
  assert.equal((await result).ok, false);
  referenceSpace.reject(new Error('floor unavailable after end'));
  await flush();
  assert.equal(session.referenceRequests, 1);
  assert.equal(h.renderers.length, 0);
  assert.equal(h.entry.isBusy(), false);
});

test('an actual end event settles cleanup even when the end call itself remains pending', async () => {
  const never = deferred(), session = sessionFixture();
  session.end = function () { this.endCalls += 1; this.dispatchEvent(new Event('end')); return never.promise; };
  const h = fixture({ session, rendererError: new Error('renderer failed') });
  assert.equal((await h.entry.enter()).ok, false);
  assert.equal(h.entry.isBusy(), false);
  never.resolve();
});

test('a reentrant stop from active publication cannot return successful entry, while a healthy entry can', async () => {
  const session = sessionFixture();
  let entry;
  entry = createHolodeckEntryLifecycle({
    enterRoom: options => enterHolodeckBaseline({ ...options,
      navigatorRef: { xr: { requestSession: () => Promise.resolve(session) } },
      canvas: { getContext: () => ({}) }, xrWebGLLayerCtor: class {},
      rendererFactory: () => ({ geometry: {}, dispose() {} }),
    }),
    onState: ({ state }) => { if (state === 'active') entry.stop(); },
  });
  assert.equal((await entry.enter()).ok, false);
  assert.equal(session.endCalls, 1);
  assert.equal(entry.isBusy(), false);
  const healthy = fixture();
  assert.equal((await healthy.entry.enter()).ok, true);
  await healthy.session.end();
});

test('late telemetry cannot attach to an ended session or overwrite a newer session status', async () => {
  const oldFactory = deferred(), oldRecorder = recorderFixture(), newRecorder = recorderFixture();
  const sessions = [sessionFixture(), sessionFixture()];
  let telemetryCount = 0, requestCount = 0, oldStatus;
  const h = fixture({ request: () => Promise.resolve(sessions[requestCount++]),
    createTelemetry: options => {
      if (telemetryCount++ === 0) { oldStatus = options.onStatus; return oldFactory.promise; }
      return newRecorder;
    } });
  await h.entry.enter();
  await sessions[0].end();
  await h.entry.enter();
  await flush();
  oldFactory.resolve(oldRecorder);
  await flush();
  oldStatus({ state: 'live', detail: 'obsolete session' });
  assert.equal(oldRecorder.starts, 0);
  assert.equal(oldRecorder.ends, 1);
  assert.deepEqual(oldRecorder.sessions, []);
  assert.deepEqual(newRecorder.sessions, [sessions[1]]);
  assert.equal(newRecorder.ends, 0);
  assert.equal(h.telemetryStatuses.some(value => value.detail === 'obsolete session'), false);
  assert.equal(h.states.at(-1).state, 'active');
  sessions[0].dispatchEvent(new Event('end'));
  assert.equal(h.entry.isBusy(), true);
  assert.equal(h.renderers[1].disposed, 0);
  await sessions[1].end();
});

test('telemetry factory and start failures degrade observation without preventing or stopping the room', async t => {
  for (const point of ['factory-throw', 'factory-reject', 'start-throw', 'start-reject']) {
    await t.test(point, async () => {
      const recorder = recorderFixture();
      if (point === 'start-throw') recorder.start = () => { throw new Error(point); };
      if (point === 'start-reject') recorder.start = () => Promise.reject(new Error(point));
      const h = fixture({ createTelemetry: () => {
        if (point === 'factory-throw') throw new Error(point);
        if (point === 'factory-reject') return Promise.reject(new Error(point));
        return recorder;
      } });
      assert.equal((await h.entry.enter()).ok, true);
      await flush();
      assert.equal(h.entry.isBusy(), true);
      assert.equal(h.session.endCalls, 0);
      assert.equal(h.states.at(-1).state, 'active');
      assert.match(h.telemetryStatuses.at(-1).detail, new RegExp(point));
      await h.session.end();
    });
  }
});

test('unavailable XR, synchronous request errors and rejected permission keep failure reasons and release entry', async t => {
  for (const point of ['unavailable', 'request-throw', 'request-reject']) {
    await t.test(point, async () => {
      const h = fixture({ request: () => {
        if (point === 'request-throw') throw new Error(point);
        return Promise.reject(new Error(point));
      } });
      const options = point === 'unavailable' ? { navigatorRef: {} } : {};
      const result = await h.entry.enter(options);
      assert.equal(result.ok, false);
      assert.match(result.reason, point === 'unavailable' ? /unavailable/ : new RegExp(point));
      assert.equal(h.states.at(-1).state, 'failed');
      assert.equal(h.entry.isBusy(), false);
      assert.equal(h.renderers.length, 0);
    });
  }
});

test('synchronous canvas and renderer failures close the granted session and keep the concrete error', async t => {
  for (const point of ['canvas', 'renderer']) {
    await t.test(point, async () => {
      const h = fixture({ rendererError: point === 'renderer' ? new Error('renderer failed') : null });
      const options = point === 'canvas' ? { canvas: { getContext() { throw new Error('canvas failed'); } } } : {};
      const result = await h.entry.enter(options);
      assert.equal(result.ok, false);
      assert.match(result.reason, new RegExp(point + ' failed'));
      assert.equal(h.session.endCalls, 1);
      assert.equal(h.entry.isBusy(), false);
      assert.equal(h.states.at(-1).state, 'failed');
    });
  }
});

test('unproven session closure holds entry until the actual end event, instead of permitting an overlapping grant', async () => {
  const session = sessionFixture({ endError: new Error('end failed') });
  const h = fixture({ session, rendererError: new Error('setup failed') });
  assert.equal((await h.entry.enter()).ok, false);
  assert.equal(h.entry.isBusy(), true);
  assert.equal(h.states.at(-1).state, 'stopping');
  assert.equal((await h.entry.enter()).busy, true);
  assert.equal(h.events.filter(value => value === 'request').length, 1);
  session.dispatchEvent(new Event('end'));
  assert.equal(h.entry.isBusy(), false);
});

test('stopping inside a frame callback disposes only that room and never rearms its frame loop', async () => {
  const recorder = recorderFixture();
  const h = fixture({ createTelemetry: async () => recorder });
  await h.entry.enter({ onFrame: () => h.entry.stop() });
  await flush();
  const oldFrame = h.session.frame;
  const before = h.session.frameRequests;
  oldFrame(0, frame(h.session));
  await flush();
  assert.equal(h.session.frameRequests, before);
  assert.equal(h.renderers[0].disposed, 1);
  assert.equal(recorder.frames, 1);
  assert.equal(recorder.ends, 1);
  oldFrame(16, frame(h.session));
  assert.equal(h.renderers[0].draws, 1);
  assert.equal(recorder.frames, 1);
});

test('WebGL context loss makes flat preview fail closed and rebuilds its renderer on restoration', () => {
  // Execute the original page's preview lifecycle with synthetic GPU state,
  // without a real microphone, XR grant, remote app input or user conversation.
  const start = html.indexOf('    let inspectCube = false;');
  const end = html.indexOf("    window.addEventListener('resize', drawPreview);", start);
  assert.ok(start >= 0 && end > start, 'original flat preview lifecycle present');

  const gl = { lost: false, isContextLost() { return this.lost; } };
  const canvas = new EventTarget();
  Object.assign(canvas, { width: 840, height: 420, clientWidth: 840, clientHeight: 420,
    getContext() { return gl; } });
  const status = { textContent: '' };
  let rendererCreates = 0, draws = 0, resumes = 0;
  const page = vm.createContext({
    canvas, previewReady: true, immersiveActive: false, previewRenderer: null,
    inspectKeyboard: false, window: { devicePixelRatio: 1 },
    document: { hidden: false, getElementById(id) {
      assert.equal(id, 'preview-status');
      return status;
    } },
    screen: { render() {} },
    cubeScene: { getStates: () => [{ position: [0, 1, 0] }, { position: [0, 1, 0] }] },
    comfort: { getState: () => ({ heightOffset: 0 }) },
    furniture: {},
    createHolodeckRoomRenderer() {
      rendererCreates += 1;
      return { drawPreview() { draws += 1; } };
    },
    playPreview() { resumes += 1; },
  });
  vm.runInContext(html.slice(start, end) + '\nglobalThis.previewDraw = drawPreview;', page);

  assert.equal(page.previewDraw(), true);
  assert.equal(rendererCreates, 1);
  assert.equal(draws, 1);

  gl.lost = true;
  const loss = new Event('webglcontextlost', { cancelable: true });
  assert.equal(canvas.dispatchEvent(loss), false, 'request browser restoration');
  assert.equal(loss.defaultPrevented, true);
  assert.match(status.textContent, /preview paused: graphics context lost/i);
  assert.equal(page.previewDraw(), false, 'lost GPU context never counts as visible room');
  assert.equal(draws, 1, 'do not draw with stale GPU objects');

  gl.lost = false;
  canvas.dispatchEvent(new Event('webglcontextrestored'));
  assert.equal(resumes, 1, 'resumes only after genuine restoration');
  assert.equal(page.previewDraw(), true);
  assert.equal(rendererCreates, 2, 'old renderer is not reused after context restoration');
  assert.equal(draws, 2);

  gl.lost = true;
  canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
  page.immersiveActive = true;
  gl.lost = false;
  canvas.dispatchEvent(new Event('webglcontextrestored'));
  assert.equal(resumes, 1, 'do not restart flat preview over immersive Quest session');
  assert.equal(page.previewDraw(), false);
});
