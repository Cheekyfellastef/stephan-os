import { requestStephanosBackend } from '../runtime/backendClient.mjs';

export const VR_PLAYTEST_LIVE_FEED_PATH = '/api/shared-workspace/vr-playtest-feed';
export const VR_PLAYTEST_LIVE_FEED_SCHEMA = 'stephanos.vr-playtest-live-feed.v1';

export async function loadVrPlaytestLiveFeed({ timeoutMs = 3500, runtimeContext, fetchImpl } = {}) {
  const response = await requestStephanosBackend({
    path: VR_PLAYTEST_LIVE_FEED_PATH,
    timeoutMs,
    runtimeContext,
    fetchImpl,
  });
  const feed = response?.json;
  if (feed?.schemaVersion !== VR_PLAYTEST_LIVE_FEED_SCHEMA || feed?.readOnly !== true) {
    throw new Error('vr-playtest-live-feed-invalid');
  }
  return feed;
}

export function summarizeVrPlaytestFeed(feed = {}) {
  const latest = feed?.latest;
  if (!latest) {
    return Object.freeze({
      state: feed?.state || 'unknown',
      hasEvidence: false,
      game: '',
      sessionId: '',
      sequenceFaultCount: 0,
      rollback: 'UNKNOWN',
      nextMode: 'OBSERVE',
      flywheelLessonId: '',
    });
  }
  const current = feed?.state === 'ready' && latest?.current !== false;
  return Object.freeze({
    state: feed?.state || 'ready',
    hasEvidence: true,
    current,
    freshness: latest?.freshness || (current ? 'current' : 'unknown'),
    game: latest.game || '',
    sessionId: latest.sessionId || '',
    sequenceFaultCount: Number(latest?.telemetry?.sequenceFaultCount) || 0,
    rollback: latest?.rollback?.state || 'UNKNOWN',
    nextMode: current ? (latest?.labProjections?.starfieldReferenceLab?.nextMode || 'OBSERVE') : 'OBSERVE',
    flywheelLessonId: latest?.flywheel?.lessonId || '',
  });
}
