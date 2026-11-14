import { createHolodeckRoomRenderer } from './holodeck-room-v1.mjs';
import { createHolodeckLocomotion, sampleHolodeckControls } from './holodeck-locomotion-v1.mjs';
import { createHolodeckCubeScene } from './holodeck-cube-scene-v1.mjs';
import { createHolodeckCubeInteraction } from './holodeck-cube-interaction-v1.mjs';
import { createHolodeckScreenInput } from './holodeck-screen-input-v1.mjs';
import { createHolodeckFurnitureInteraction } from './holodeck-furniture-v1.mjs';
import { createHolodeckComfortSolids } from './holodeck-comfort-v1.mjs';
import { createHolodeckDynamicObstacles } from './holodeck-collision-v1.mjs';

// Held items follow the controller, so they cannot obstruct the operator's
// own virtual walking body. All released objects and fixed room geometry remain solid.
export function createHolodeckNavigationObstacles({cubeStates=[],furnitureObstacles=[],heldFurnitureId=null}={}) {
  const cubes=createHolodeckDynamicObstacles(cubeStates);
  const objects=Array.isArray(furnitureObstacles)?furnitureObstacles:[];
  return [...cubes,...objects.filter(item=>!heldFurnitureId||item.id!==`furniture:${heldFurnitureId}`)];
}

export const HOLODECK_BASELINE_SESSION_MODE = 'immersive-vr';
export const HOLODECK_BASELINE_MODE = 'Holodeck Baseline';

export function classifyHolodeckDevice(userAgent = '') {
  const normalized = String(userAgent).toLowerCase();
  if (normalized.includes('oculusbrowser') || normalized.includes('quest')) return 'Quest/browser';
  return 'browser';
}

export async function inspectHolodeckBaselineCapabilities({
  navigatorRef = globalThis.navigator,
} = {}) {
  const webxrAvailable = Boolean(navigatorRef?.xr);
  let immersiveSupported = false;
  let reason = webxrAvailable ? 'immersive-vr support not yet proven' : 'WebXR API unavailable';

  if (webxrAvailable && typeof navigatorRef.xr.isSessionSupported === 'function') {
    try {
      immersiveSupported = await navigatorRef.xr.isSessionSupported(HOLODECK_BASELINE_SESSION_MODE);
      reason = immersiveSupported ? 'immersive-vr supported' : 'immersive-vr not supported';
    } catch (error) {
      reason = `WebXR capability probe failed: ${error?.message || 'unknown error'}`;
    }
  }

  return {
    webxrAvailable,
    immersiveSupported,
    session: 'fallback',
    device: classifyHolodeckDevice(navigatorRef?.userAgent),
    reason,
  };
}

export async function enterHolodeckBaseline({
  navigatorRef = globalThis.navigator,
  canvas,
  xrWebGLLayerCtor = globalThis.XRWebGLLayer,
  rendererFactory = createHolodeckRoomRenderer,
  onFrame = () => {},
  onLocomotionStatus = () => {},
  onCubeStatus = () => {},
  cubeScene = createHolodeckCubeScene(),
  screen,
  comfort=screen?.comfort,
  furniture=null,
  signal,
  onSession = () => {},
  onSessionEnd = () => {},
} = {}) {
  if (signal?.aborted) return { ok: false, session: null, reason: 'Immersive entry cancelled.' };
  if (!navigatorRef?.xr || typeof navigatorRef.xr.requestSession !== 'function') {
    return { ok: false, session: null, reason: 'WebXR immersive session API unavailable' };
  }

  let session;
  try {
    session = await navigatorRef.xr.requestSession(HOLODECK_BASELINE_SESSION_MODE, {
      optionalFeatures: ['local-floor'],
    });
  } catch (error) {
    return {
      ok: false,
      session: null,
      reason: `immersive-vr session rejected: ${error?.message || 'unknown error'}`,
    };
  }

  let active = true, ended = false, sharedStateStopped = false, endPromise;
  let resolveClosed;
  const sessionClosed = new Promise(resolve => { resolveClosed = resolve; });
  let renderer, cubeInteraction, screenInput, furnitureInput;
  function releaseResources() {
    active = false;
    for (const value of [renderer, cubeInteraction, screenInput, furnitureInput]) {
      try { if (value === renderer) value?.dispose(); else value?.stop(); } catch {}
    }
    renderer = cubeInteraction = screenInput = furnitureInput = null;
    if (sharedStateStopped) return;
    sharedStateStopped = true;
    for (const value of [furniture, comfort]) try { value?.flush(); } catch {}
    try { cubeScene.stop(); } catch {}
    try { onLocomotionStatus({ controller: 'No active VR session', state: 'ended' }); } catch {}
  }
  function sessionEnded() {
    if (ended) return;
    ended = true;
    resolveClosed();
    signal?.removeEventListener('abort', abortEntry);
    session.removeEventListener?.('end', sessionEnded);
    releaseResources();
    try { onSessionEnd(session); } catch {}
  }
  function endSession() {
    releaseResources();
    if (ended) return Promise.resolve();
    endPromise ??= (async () => {
      try { await Promise.race([session.end(), sessionClosed]); sessionEnded(); } catch {}
    })();
    return endPromise;
  }
  function abortEntry() { void endSession(); }
  function requireActive() {
    if (!active || signal?.aborted || ended) throw new Error('Immersive session ended or entry was cancelled during setup.');
  }

  try {
    // Observe cancellation/end before any asynchronous graphics setup. A grant
    // received after pagehide belongs to this attempt and must only be ended.
    session.addEventListener('end', sessionEnded, { once: true });
    signal?.addEventListener('abort', abortEntry, { once: true });
    onSession(session);
    requireActive();
    const gl = canvas?.getContext?.('webgl', { xrCompatible: true, alpha: false, antialias: true });
    if (!gl || typeof xrWebGLLayerCtor !== 'function') throw new Error('WebXR graphics layer unavailable');
    if (typeof gl.makeXRCompatible === 'function') await Promise.race([gl.makeXRCompatible(), sessionClosed]);
    requireActive();
    session.updateRenderState({ baseLayer: new xrWebGLLayerCtor(session, gl) });
    let referenceSpaceType = 'local-floor';
    const referenceSpace = await Promise.race([session.requestReferenceSpace(referenceSpaceType)
      .catch(async () => {
        requireActive();
        referenceSpaceType = 'local';
        return session.requestReferenceSpace(referenceSpaceType);
      }), sessionClosed]);
    requireActive();

    renderer = rendererFactory({ gl, screen, comfort, furniture });
    requireActive();
    const locomotion = createHolodeckLocomotion({ room: renderer.geometry.room,
      obstacles: furniture?[]:renderer.geometry.obstacles, comfort,
      floorRelativeY: referenceSpaceType === 'local-floor' });
    cubeInteraction = createHolodeckCubeInteraction({scene:cubeScene});
    screenInput = createHolodeckScreenInput({screen,comfort,furniture});
    furnitureInput = createHolodeckFurnitureInteraction({furniture,cubeScene});
    let collisionKey = '', environmentSolids = [];
    cubeScene.setEnvironmentSolids?.(() => {
      const tilt = comfort?.getState().keyboardTilt ?? 0;
      const offset=furniture?.getOffset?.('keyboard')??[0,0,0];
      const key=tilt+':'+offset.join(',');
      if (key !== collisionKey) {
        collisionKey = key;
        environmentSolids = createHolodeckComfortSolids({ keyboardTilt: tilt, furnitureOffset: offset });
      }
      return environmentSolids;
    });
    let lastCubeStatus = '';
    let lastLocomotionStatus = '';
    let activeController = 'none';
    const draw = (time, frame) => {
      if (!active) return;
      let gamepads = [];
      try { gamepads = navigatorRef.getGamepads?.() ?? []; } catch {}
      const pose = frame.getViewerPose(referenceSpace);
      const input = sampleHolodeckControls({ inputSources: session.inputSources, gamepads,
        preferredSource: activeController });
      activeController = input.source;
      const dynamicObstacles=createHolodeckNavigationObstacles({
        cubeStates:cubeScene.getStates?.()??[],furnitureObstacles:furniture?.obstacles?.()??[],
        heldFurnitureId:furnitureInput.getHeldId(),
      });
      // Gripping a cube, furniture or dial never commandeers the sticks.
      const navigation = locomotion.update({ time, pose, input,
        visible: session.visibilityState === 'visible', dynamicObstacles });
      const statusKey = `${navigation.controller}:${navigation.state}`;
      if (statusKey !== lastLocomotionStatus) {
        lastLocomotionStatus = statusKey;
        try { onLocomotionStatus({ controller: navigation.controller, state: navigation.state }); } catch {}
      }
      if (!active) return;
      const screenPointers = screenInput.update({time,frame,referenceSpace,pose,navigation,gamepads,visible:session.visibilityState==='visible'});
      if (!active) return;
      furnitureInput.update({time,frame,referenceSpace,pose,navigation,gamepads,
        blockedSources:screenInput.getCapturedSources(),visible:session.visibilityState==='visible'});
      if (!active) return;
      const cube = cubeInteraction.update({ time, pose, frame, referenceSpace, navigation, gamepads,
        blockedSources:new Set([...screenInput.getCapturedSources(),...furnitureInput.getCapturedSources()]),
        visible: session.visibilityState === 'visible' });
      if (!active) return;
      if(screenPointers.length)cube.pointers=screenPointers;
      const held = cube.cubes.find(c=>c.heldBy);
      const cubeStatus = held ? 'held' : cube.cubes.every(c=>c.sleeping) ? 'resting' : 'falling';
      if (cubeStatus !== lastCubeStatus) {
        lastCubeStatus = cubeStatus;
        try { onCubeStatus({ state: cubeStatus, controller: held?.heldBy }); } catch {}
      }
      if (!active) return;
      const frameTruth = renderer.drawFrame(frame, referenceSpace, { pose, navigation, cube })
        || { poseAvailable: false, viewCount: 0 };
      if (!active) return;
      try {
        onFrame({
          time,
          poseAvailable: frameTruth.poseAvailable === true,
          viewCount: Number(frameTruth.viewCount) || 0,
        });
      } catch {}
      if (active) frame.session.requestAnimationFrame(draw);
    };
    session.requestAnimationFrame(draw);

    return {
      ok: true,
      session,
      referenceSpace,
      referenceSpaceType,
      room: renderer.geometry.room,
      ideaCube: renderer.geometry.ideaCube,
      reason: 'Stephanos Spatial Workspace chamber started; physical headset acceptance remains unproven',
    };
  } catch (error) {
    await endSession();
    return {
      ok: false,
      session: null,
      reason: `Holodeck renderer setup failed: ${error?.message || 'unknown error'}`,
    };
  }
}

// One pending grant or active room per entry surface. enter() deliberately calls
// the room adapter before scheduling telemetry or returning to the event loop.
export function createHolodeckEntryLifecycle({
  enterRoom = enterHolodeckBaseline,
  createTelemetry = async () => null,
  onState = () => {},
  onTelemetryStatus = () => {},
} = {}) {
  let current = null;
  const notify = (callback, value) => { try { callback(value); } catch {} };
  const owns = run => current === run && !run.controller.signal.aborted && !run.sessionEnded;
  function telemetryFailure(run, error) {
    if (owns(run)) notify(onTelemetryStatus, { state: 'degraded', detail: `Telemetry unavailable: ${error?.message || 'unknown error'}` });
  }
  function endTelemetry(run) {
    if (!run.telemetry || run.telemetryClosed) return;
    run.telemetryClosed = true;
    void Promise.resolve().then(() => run.telemetry.end?.()).catch(error => telemetryFailure(run, error));
  }
  function finish(run, state, result) {
    if (current !== run) return;
    current = null;
    if (state !== 'failed') endTelemetry(run);
    notify(onState, { state, result });
  }
  function onEnded(run) {
    run.sessionEnded = true;
    endTelemetry(run);
    if (run.settled) finish(run, run.result.ok ? 'ended' : 'failed', run.result);
  }
  function enter(roomOptions = {}, telemetryOptions = {}) {
    if (current) return Promise.resolve({ ok: false, busy: true, session: null, reason: 'A Spatial Workspace session is already pending or active.' });
    const run = { controller: new AbortController(), session: null, sessionEnded: false,
      settled: false, result: null, telemetry: null, telemetryClosed: false, telemetryAttached: false };
    current = run;
    let pending;
    try {
      pending = enterRoom({
        ...roomOptions, signal: run.controller.signal,
        onSession: session => { run.session = session; },
        onSessionEnd: session => { if (session === run.session) onEnded(run); },
        onFrame: frame => {
          if (!owns(run)) return;
          try { if (run.telemetryAttached && !run.telemetryClosed) run.telemetry?.recordFrame(frame); } catch (error) { telemetryFailure(run, error); }
          try { roomOptions.onFrame?.(frame); } catch {}
        },
      });
    } catch (error) {
      pending = Promise.reject(error);
    }
    notify(onState, { state: 'requesting' });
    run.promise = Promise.resolve(pending).catch(error => ({ ok: false, session: null,
      reason: `Immersive entry failed: ${error?.message || 'unknown error'}` })).then(result => {
      if (result.ok && !owns(run)) result = { ok: false, session: null, reason: 'Immersive entry ended or was cancelled before setup completed.' };
      run.settled = true;
      run.result = result;
      if (!result.ok || !owns(run)) {
        if (!result.ok && run.session && !run.sessionEnded) run.controller.abort();
        if (!run.session || run.sessionEnded) finish(run, result.ok ? 'ended' : 'failed', result);
        else if (current === run) notify(onState, { state: 'stopping', result });
      } else {
        notify(onState, { state: 'active', result });
        if (!owns(run)) {
          result = { ok: false, session: null, reason: 'Immersive entry ended or was cancelled before entry completed.' };
          run.result = result;
        }
      }
      return result;
    });
    void Promise.resolve().then(async () => {
      const telemetry = await createTelemetry({ ...telemetryOptions,
        onStatus: status => { if (owns(run) && !run.telemetryClosed) notify(onTelemetryStatus, status); } });
      run.telemetry = telemetry;
      if (!telemetry) return;
      if (run.controller.signal.aborted || run.sessionEnded) { endTelemetry(run); return; }
      const result = await run.promise;
      if (!result.ok && !run.telemetryClosed) { await telemetry.fail?.(new Error(result.reason)); endTelemetry(run); return; }
      if (!owns(run)) { endTelemetry(run); return; }
      telemetry.attachSession(result.session, { referenceSpaceType: result.referenceSpaceType });
      if (!owns(run)) { endTelemetry(run); return; }
      run.telemetryAttached = true;
      await telemetry.start();
    }).catch(error => { telemetryFailure(run, error); endTelemetry(run); });
    return run.promise;
  }
  function stop() {
    const run = current;
    if (!run) return;
    run.controller.abort();
    endTelemetry(run);
    if (current === run) notify(onState, { state: 'stopping', result: run.result });
  }
  return Object.freeze({ enter, stop, isBusy: () => current !== null });
}
