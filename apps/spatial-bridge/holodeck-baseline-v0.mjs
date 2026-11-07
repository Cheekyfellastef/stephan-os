import { createHolodeckRoomRenderer } from './holodeck-room-v1.mjs';
import { createHolodeckLocomotion, sampleHolodeckControls } from './holodeck-locomotion-v1.mjs';
import { createHolodeckCubeScene } from './holodeck-cube-scene-v1.mjs';
import { createHolodeckCubeInteraction } from './holodeck-cube-interaction-v1.mjs';
import { createHolodeckScreenInput } from './holodeck-screen-input-v1.mjs';
import { createHolodeckComfortSolids } from './holodeck-comfort-v1.mjs';
import { createHolodeckDynamicObstacles } from './holodeck-collision-v1.mjs';

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
} = {}) {
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

  const gl = canvas?.getContext?.('webgl', { xrCompatible: true, alpha: false, antialias: true });
  if (!gl || typeof xrWebGLLayerCtor !== 'function') {
    try { await session.end(); } catch {}
    return { ok: false, session: null, reason: 'WebXR graphics layer unavailable' };
  }

  try {
    if (typeof gl.makeXRCompatible === 'function') await gl.makeXRCompatible();
    session.updateRenderState({ baseLayer: new xrWebGLLayerCtor(session, gl) });
    let referenceSpaceType = 'local-floor';
    const referenceSpace = await session.requestReferenceSpace(referenceSpaceType)
      .catch(async () => {
        referenceSpaceType = 'local';
        return session.requestReferenceSpace(referenceSpaceType);
      });

    const renderer = rendererFactory({ gl, screen, comfort });
    const locomotion = createHolodeckLocomotion({ room: renderer.geometry.room,
      obstacles: renderer.geometry.obstacles, comfort,
      floorRelativeY: referenceSpaceType === 'local-floor' });
    const cubeInteraction = createHolodeckCubeInteraction({scene:cubeScene});
    const screenInput = createHolodeckScreenInput({screen,comfort});
    let collisionTilt = NaN, environmentSolids = [];
    cubeScene.setEnvironmentSolids?.(() => {
      const tilt = comfort?.getState().keyboardTilt ?? 0;
      if (tilt !== collisionTilt) {
        collisionTilt = tilt;
        environmentSolids = createHolodeckComfortSolids({ keyboardTilt: tilt });
      }
      return environmentSolids;
    });
    let lastCubeStatus = '';
    let lastLocomotionStatus = '';
    let activeController = 'none';
    let active = true;
    session.addEventListener('end', () => {
      active = false;
      renderer.dispose();
      cubeInteraction.stop();
      screenInput.stop();
      comfort?.flush();
      cubeScene.stop();
      try { onLocomotionStatus({ controller: 'No active VR session', state: 'ended' }); } catch {}
    }, { once: true });

    const draw = (time, frame) => {
      if (!active) return;
      let gamepads = [];
      try { gamepads = navigatorRef.getGamepads?.() ?? []; } catch {}
      const pose = frame.getViewerPose(referenceSpace);
      const input = sampleHolodeckControls({ inputSources: session.inputSources, gamepads,
        preferredSource: activeController });
      activeController = input.source;
      const dynamicObstacles = createHolodeckDynamicObstacles(cubeScene.getStates?.() ?? []);
      const navigation = locomotion.update({ time, pose, input:screenInput.isAdjusting()
        ? {...input,moveX:0,moveY:0,turn:0,reset:false}:input,
        visible: session.visibilityState === 'visible', dynamicObstacles });
      const statusKey = `${navigation.controller}:${navigation.state}`;
      if (statusKey !== lastLocomotionStatus) {
        lastLocomotionStatus = statusKey;
        try { onLocomotionStatus({ controller: navigation.controller, state: navigation.state }); } catch {}
      }
      const screenPointers = screenInput.update({time,frame,referenceSpace,pose,navigation,gamepads,visible:session.visibilityState==='visible'});
      const cube = cubeInteraction.update({ time, pose, frame, referenceSpace, navigation, gamepads,
        blockedSources:screenInput.getCapturedSources(),visible: session.visibilityState === 'visible' });
      if(screenPointers.length)cube.pointers=screenPointers;
      const held = cube.cubes.find(c=>c.heldBy);
      const cubeStatus = held ? 'held' : cube.cubes.every(c=>c.sleeping) ? 'resting' : 'falling';
      if (cubeStatus !== lastCubeStatus) {
        lastCubeStatus = cubeStatus;
        try { onCubeStatus({ state: cubeStatus, controller: held?.heldBy }); } catch {}
      }
      const frameTruth = renderer.drawFrame(frame, referenceSpace, { pose, navigation, cube })
        || { poseAvailable: false, viewCount: 0 };
      try {
        onFrame({
          time,
          poseAvailable: frameTruth.poseAvailable === true,
          viewCount: Number(frameTruth.viewCount) || 0,
        });
      } catch {}
      frame.session.requestAnimationFrame(draw);
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
    try { await session.end(); } catch {}
    return {
      ok: false,
      session: null,
      reason: `Holodeck renderer setup failed: ${error?.message || 'unknown error'}`,
    };
  }
}
