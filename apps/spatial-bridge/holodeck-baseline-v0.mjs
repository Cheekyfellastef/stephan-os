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
    const referenceSpace = await session.requestReferenceSpace('local-floor')
      .catch(() => session.requestReferenceSpace('local'));

    let active = true;
    session.addEventListener('end', () => { active = false; }, { once: true });

    const draw = (_time, frame) => {
      if (!active) return;
      const layer = frame.session.renderState.baseLayer;
      gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
      gl.clearColor(0.01, 0.025, 0.055, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      frame.session.requestAnimationFrame(draw);
    };
    session.requestAnimationFrame(draw);

    return {
      ok: true,
      session,
      referenceSpace,
      reason: 'immersive-vr session started; physical headset acceptance remains unproven',
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
