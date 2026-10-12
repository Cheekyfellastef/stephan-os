import { buildGoalCockpitChatProjection } from '../../shared/agents/goalCockpitChatProjection.mjs';
import { buildCockpitProjection } from '../../shared/runtime/cockpitProjection.mjs';
import { readBackendSharedWorkspaceDashboardFeed } from './sharedWorkspaceDashboardFeedService.js';

function list(value) {
  return Array.isArray(value) ? value : [];
}

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function missingProofFromLiveProjection(liveGoalProjection = {}) {
  const proofTruth = liveGoalProjection.proofTruth || {};
  return Object.entries(proofTruth)
    .filter(([, truth]) => !/current|live|provided/i.test(text(truth)))
    .map(([source]) => `${source}-proof`);
}

export function buildCanonicalCockpitFromLiveGoalProjection(liveGoalProjection = {}) {
  const goals = list(liveGoalProjection.dashboardGoals?.cards);
  const firstGoal = goals[0] || {};
  const missingProof = missingProofFromLiveProjection(liveGoalProjection);
  const nextAction = text(
    liveGoalProjection.nextOperatorAction || liveGoalProjection.dashboardGoals?.nextAction,
    'Inspect canonical goal evidence; unknown stays unknown.',
  );
  return buildCockpitProjection({
    runtimeStatusModel: {
      currentMission: text(firstGoal.title, 'Current Stephanos mission'),
      projectAwarenessProjection: {
        title: text(firstGoal.title, 'Current Stephanos mission'),
        status: text(liveGoalProjection.finalVerdict, 'unknown'),
      },
      missionProofReconciliation: {
        remainingMissingItems: missingProof,
        nextBestAction: nextAction,
      },
      missionEvidenceLedgerProjection: {
        missionTitle: text(firstGoal.title, 'Current Stephanos mission'),
        status: text(liveGoalProjection.finalVerdict, 'unknown'),
        missingProof,
        nextRequiredEvidence: missingProof[0] || 'operator-review',
        nextAction,
        mergeReadiness: 'hold',
        trustedForMerge: false,
        openClawMutationLocked: true,
        codexAutoDispatchAllowed: false,
      },
      prEvidenceModel: {
        mergeReadiness: 'hold',
        missingProof,
      },
    },
  });
}

function sourceFailure(source, reason) {
  return Object.freeze({
    source,
    reason: text(reason, 'READ_FAILED'),
    message: source === 'live_goal_projection'
      ? 'Live goal projection read failed.'
      : 'Shared Workspace projection read failed.',
  });
}

export async function readGoalCockpitChatProjection(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const liveGoalReader = options.liveGoalReader || (await import('./liveGoalProjectionService.js')).readLiveGoalProjection;
  const sharedWorkspaceReader = options.sharedWorkspaceReader || readBackendSharedWorkspaceDashboardFeed;
  const [liveResult, sharedResult] = await Promise.allSettled([
    liveGoalReader({ ...(options.liveGoalReaderOptions || {}), now }),
    sharedWorkspaceReader({
      ...(options.sharedWorkspaceReaderOptions || {}),
      nowMs: now.getTime(),
    }),
  ]);

  const sourceErrors = [];
  const liveGoalProjection = liveResult.status === 'fulfilled' ? liveResult.value : {};
  const sharedWorkspaceFeed = sharedResult.status === 'fulfilled' ? sharedResult.value : {};
  if (liveResult.status === 'rejected') {
    sourceErrors.push(sourceFailure('live_goal_projection', liveResult.reason?.code || liveResult.reason?.name));
  }
  if (sharedResult.status === 'rejected') {
    sourceErrors.push(sourceFailure('shared_workspace', sharedResult.reason?.code || sharedResult.reason?.name));
  }

  const canonicalCockpitProjection = options.canonicalCockpitProjection
    || buildCanonicalCockpitFromLiveGoalProjection(liveGoalProjection);

  return buildGoalCockpitChatProjection({
    liveGoalProjection,
    sharedWorkspaceFeed,
    canonicalCockpitProjection,
    sourceErrors,
    now,
    maxCurrentAgeMs: options.maxCurrentAgeMs,
    maxFutureSkewMs: options.maxFutureSkewMs,
    refreshAfterMs: options.refreshAfterMs,
  });
}
