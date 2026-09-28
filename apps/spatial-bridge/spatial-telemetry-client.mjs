import { requestStephanosBackend } from '../../shared/runtime/backendClient.mjs';
import {
  SPATIAL_WORKSPACE_TELEMETRY_ROUTE,
  SPATIAL_WORKSPACE_TELEMETRY_SCHEMA_V1,
} from '../../shared/vr/spatialWorkspaceTelemetryContractV1.mjs';

const SAMPLE_INTERVAL_MS = 30_000;

function safeRunId(cryptoRef = globalThis.crypto) {
  const random = typeof cryptoRef?.randomUUID === 'function'
    ? cryptoRef.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `spatial-${String(random).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 68)}`;
}

async function resolveBackendHead() {
  try {
    const response = await requestStephanosBackend({ path: '/api/health', timeoutMs: 3500 });
    const head = String(response?.json?.backendIdentity?.sourceHead || '').trim().toLowerCase();
    return /^[0-9a-f]{40}$/.test(head) ? head : '';
  } catch {
    return '';
  }
}

export async function createSpatialWorkspaceTelemetryRecorderV1({
  device = 'browser',
  route = 'Stephanos Spatial Workspace / WebXR',
  room = 'holodeck-starting-chamber',
  sampleIntervalMs = SAMPLE_INTERVAL_MS,
  now = () => Date.now(),
  cryptoRef = globalThis.crypto,
  onStatus = () => {},
} = {}) {
  const runId = safeRunId(cryptoRef);
  const startedAtMs = now();
  const sourceHead = await resolveBackendHead();
  let sequence = 0;
  let frameCount = 0;
  let poseFrames = 0;
  let missingPoseFrames = 0;
  let trackingLossCount = 0;
  let previousPoseAvailable = null;
  let previousFrameTime = null;
  let totalFrameIntervalMs = 0;
  let frameIntervalCount = 0;
  let maxFrameMs = 0;
  let maxViewCount = 0;
  let sourceCountMax = 0;
  let handTrackedSourceCountMax = 0;
  let inputSourceChangeCount = 0;
  let selectCount = 0;
  let squeezeCount = 0;
  let referenceSpace = 'unknown';
  let immersiveSupported = true;
  let ended = false;
  let lastSampleMs = startedAtMs;
  const errors = [];
  let publishChain = Promise.resolve();

  function status(state, detail = '') {
    try { onStatus({ state, detail, runId, sourceHead }); } catch {}
  }

  function snapshot(phase) {
    const durationMs = Math.max(0, now() - startedAtMs);
    const averageFrameMs = frameIntervalCount ? totalFrameIntervalMs / frameIntervalCount : 0;
    const estimatedFps = averageFrameMs > 0 ? 1000 / averageFrameMs : 0;
    return {
      schemaVersion: SPATIAL_WORKSPACE_TELEMETRY_SCHEMA_V1,
      runId,
      phase,
      sequence,
      observedAtUtc: new Date(now()).toISOString(),
      sourceHead,
      device,
      route,
      room,
      durationMs,
      frame: {
        count: frameCount,
        poseFrames,
        missingPoseFrames,
        trackingLossCount,
        averageFrameMs,
        maxFrameMs,
        estimatedFps,
        maxViewCount,
      },
      input: {
        sourceCountMax,
        handTrackedSourceCountMax,
        inputSourceChangeCount,
        selectCount,
        squeezeCount,
      },
      webxr: {
        immersiveSupported,
        referenceSpace,
      },
      errors: errors.slice(-8),
    };
  }

  function queuePublish(phase) {
    sequence += 1;
    const payload = snapshot(phase);
    publishChain = publishChain.then(async () => {
      try {
        const response = await requestStephanosBackend({
          path: SPATIAL_WORKSPACE_TELEMETRY_ROUTE,
          method: 'POST',
          body: payload,
          timeoutMs: 5000,
        });
        status('live', `${phase} · ${response?.json?.reason || 'published'}`);
        return response;
      } catch (error) {
        const message = String(error?.message || 'telemetry-publish-failed').slice(0, 220);
        errors.push(message);
        status('degraded', message);
        return null;
      }
    });
    return publishChain;
  }

  function inspectInputSources(session) {
    const sources = Array.from(session?.inputSources || []);
    sourceCountMax = Math.max(sourceCountMax, sources.length);
    handTrackedSourceCountMax = Math.max(
      handTrackedSourceCountMax,
      sources.filter((source) => source?.hand).length,
    );
  }

  function recordFrame({ time, poseAvailable = false, viewCount = 0 } = {}) {
    frameCount += 1;
    if (poseAvailable) poseFrames += 1;
    else missingPoseFrames += 1;
    if (previousPoseAvailable === true && poseAvailable === false) trackingLossCount += 1;
    previousPoseAvailable = Boolean(poseAvailable);
    maxViewCount = Math.max(maxViewCount, Number(viewCount) || 0);

    const frameTime = Number(time);
    if (Number.isFinite(frameTime) && Number.isFinite(previousFrameTime)) {
      const delta = Math.max(0, frameTime - previousFrameTime);
      totalFrameIntervalMs += delta;
      frameIntervalCount += 1;
      maxFrameMs = Math.max(maxFrameMs, delta);
    }
    if (Number.isFinite(frameTime)) previousFrameTime = frameTime;

    const current = now();
    if (!ended && current - lastSampleMs >= sampleIntervalMs) {
      lastSampleMs = current;
      void queuePublish('sample');
    }
  }

  function attachSession(session, { referenceSpaceType = 'unknown' } = {}) {
    referenceSpace = referenceSpaceType;
    inspectInputSources(session);
    const onInputSourcesChange = () => {
      inputSourceChangeCount += 1;
      inspectInputSources(session);
    };
    const onSelect = () => { selectCount += 1; };
    const onSqueeze = () => { squeezeCount += 1; };
    session.addEventListener('inputsourceschange', onInputSourcesChange);
    session.addEventListener('select', onSelect);
    session.addEventListener('squeeze', onSqueeze);
    session.addEventListener('end', () => {
      session.removeEventListener('inputsourceschange', onInputSourcesChange);
      session.removeEventListener('select', onSelect);
      session.removeEventListener('squeeze', onSqueeze);
      void end();
    }, { once: true });
  }

  function recordError(error) {
    errors.push(String(error?.message || error || 'spatial-runtime-error').slice(0, 220));
  }

  async function start() {
    status(sourceHead ? 'starting' : 'degraded', sourceHead ? 'exact backend head bound' : 'backend head unavailable');
    await queuePublish('start');
  }

  async function end() {
    if (ended) return publishChain;
    ended = true;
    await queuePublish('end');
    return publishChain;
  }

  async function fail(error) {
    recordError(error);
    immersiveSupported = false;
    await queuePublish('error');
  }

  return Object.freeze({
    runId,
    sourceHead,
    start,
    end,
    fail,
    recordFrame,
    recordError,
    attachSession,
    snapshot: () => snapshot('sample'),
  });
}
