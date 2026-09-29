import { buildHealthDiagnostics } from '../config/runtimeConfig.js';
import { buildConciergeQueue, buildConciergeRoadmap, buildConciergePostMergeSync, buildConciergeAntiStallMergeLane } from '../../shared/agents/battleBridgeBuildConciergeV2.mjs';
import { readWorkspaceUpdateStatus } from './workspaceUpdateStatusService.js';
import { readBuildConciergeGoalReceipts } from './buildConciergeGoalService.js';
import { readMissionOperations } from './missionOperationsService.js';
import { readImportedGoalReceipts } from './goalIngestionService.js';
import { buildExecutionChains, readGithubTelemetry } from './githubTelemetryService.js';
import { buildConciergeExecutionEngineV9 } from '../../shared/agents/buildConciergeExecutionEngineV9.mjs';

function list(value) { return Array.isArray(value) ? value : []; }
function text(value, fallback = 'unknown') { const normalized = String(value ?? '').trim(); return normalized || fallback; }
function unique(values = []) { return [...new Set(values.filter(Boolean).map(String))]; }

export function buildLiveGoalProjection(input = {}) {
  const now = input.now instanceof Date ? input.now : new Date();
  const feed = input.missionOperationsFeed || {};
  const buildConcierge = input.buildConcierge || feed.buildConcierge || {};
  const importedGoals = input.importedGoals || buildConcierge.importedGoals || { receipts: [], candidates: [] };
  const updateStatus = input.updateStatus || feed.updateStatus || {};
  const githubTelemetry = input.githubTelemetry || feed.githubTelemetry || { status: 'adapter_unavailable', adapterAvailable: false, notificationCounts: {}, pullRequests: [], workflows: [], blockers: ['github_adapter_unavailable'] };
  const allCreatedCandidates = [...list(input.createdGoalCandidates), ...list(importedGoals.candidates)];
  const queue = buildConcierge.queue || buildConciergeQueue({ goals: allCreatedCandidates });
  const queuedCandidates = list(queue.queuedCandidates);
  const activeProofLane = list(queue.activeProofLane);
  const blockedCandidates = list(queue.blockedCandidates);
  const completedCandidates = list(queue.completedCandidates);
  const rejectedCandidates = list(queue.rejectedCandidates);
  const receipts = [
    ...list(buildConcierge.createdGoalReceipts),
    ...list(importedGoals.receipts),
    ...list(feed.missions).flatMap((mission) => list(mission.receipts)),
  ];
  const executionEngine = input.executionEngine || buildConcierge.executionEngine || buildConciergeExecutionEngineV9({ receipts });
  const blockers = unique([
    ...list(queue.blockers),
    ...list(executionEngine.blockers),
    ...blockedCandidates.flatMap((candidate) => list(candidate.blockers || candidate.rejectionReasons)),
    ...list(feed.errors).map((error) => error.error || error.message || String(error)),
    ...list(githubTelemetry.blockers),
  ]);
  const backendHealthy = input.backendStatus?.ok === true || input.backendStatus?.status === 'ok' || input.backendStatus?.status === 'live';
  const missionLive = ['ready', 'empty'].includes(text(feed.status, 'unknown'));
  const hasLiveGoalTruth = queuedCandidates.length || receipts.length || list(feed.missions).length;
  const sourceTruth = backendHealthy && missionLive && hasLiveGoalTruth ? 'live' : (backendHealthy ? 'mixed' : 'static-fallback');
  const githubTruth = githubTelemetry.adapterAvailable === true ? 'adapter-provided' : (queue.autoPick?.liveGithubProof === 'adapter-provided' || queue.autoPick?.liveGithubProof === 'receipt-provided' ? queue.autoPick.liveGithubProof : 'unknown');
  const localProofTruth = receipts.some((receipt) => /proof|command/i.test(`${receipt.receiptType || ''} ${receipt.status || ''}`)) ? 'receipt-provided' : 'unknown';
  const browserProofTruth = buildConcierge.browserProofPacket?.browserProofStatus || buildConcierge.proofPacketSummary?.browserProof || 'unknown';
  const staleWarnings = [];
  if (feed.projectionSource === 'static-goal-dashboard-seed' || feed.githubTruth === 'not-live-readonly-static-seed') staleWarnings.push('Static goal-dashboard seed is not presented as live truth.');
  if (githubTruth === 'unknown') staleWarnings.push('GitHub truth is unknown; no receipt/adapter supplied live GitHub proof.');
  if (localProofTruth === 'unknown') staleWarnings.push('Local proof is unknown; no proof receipt supplied local proof.');
  if (browserProofTruth === 'unknown') staleWarnings.push('Browser proof is unknown; no browser proof packet supplied browser proof.');
  return Object.freeze({
    schemaVersion: 'stephanos.live-goal-projection.v1',
    generatedAt: now.toISOString(),
    projectionSource: 'live-goal-projection-service',
    generatedAtAgeSeconds: Math.max(0, Math.floor((Date.now() - now.getTime()) / 1000)),
    heartbeat: {
      generatedAt: now.toISOString(),
      generatedAtAgeSeconds: Math.max(0, Math.floor((Date.now() - now.getTime()) / 1000)),
      backendLive: backendHealthy,
      projectionSource: 'live-goal-projection-service',
      watchedGoals: executionEngine.watchedGoalCount || receipts.length,
      classifiedGoals: executionEngine.classifiedGoalCount || 0,
      manualDispatchRequired: executionEngine.manualDispatchRequiredCount || 0,
      staleUnknownWarnings: unique(staleWarnings),
      githubNotificationCount: list(githubTelemetry.notifications).length,
      githubOpenPrCount: list(githubTelemetry.pullRequests).length,
      githubWorkflowCount: list(githubTelemetry.workflows).length,
    },
    importedGoals: { status: importedGoals.receipts?.length ? 'present' : 'none', verificationState: importedGoals.receipts?.length ? 'imported_unverified' : 'none', receipts: list(importedGoals.receipts), candidates: list(importedGoals.candidates) },
    githubTelemetry,
    executionChains: buildExecutionChains({ goals: queuedCandidates, githubTelemetry }),
    sourceTruth,
    backendStatus: input.backendStatus || { status: backendHealthy ? 'live' : 'unknown', healthRoute: '/api/health' },
    missionOperationsStatus: { status: text(feed.status, 'unknown'), source: text(feed.source, 'unknown'), route: '/api/mission-operations' },
    buildConciergeStatus: { status: text(queue.status, 'unknown'), roadmap: buildConcierge.roadmap || buildConciergeRoadmap(), postMergeSync: buildConcierge.postMergeSync || buildConciergePostMergeSync({}), antiStallMergeLane: buildConcierge.antiStallMergeLane || buildConciergeAntiStallMergeLane({}), executionEngine },
    executionEngine,
    totalGoals: queuedCandidates.length + completedCandidates.length + rejectedCandidates.length,
    activeGoalCount: activeProofLane.length,
    queuedGoalCount: queuedCandidates.length,
    blockedGoalCount: blockedCandidates.length,
    completedGoalCount: completedCandidates.length,
    activeProofLane,
    queuedCandidates,
    blockedCandidates,
    completedCandidates,
    rejectedCandidates,
    nextSafeCandidate: queue.nextSafeCandidate || null,
    currentAgentStates: {
      operator: { state: 'approval_authority', truth: 'intent-authority' },
      stephanos: { state: backendHealthy ? 'backend_reachable' : 'unknown', truth: backendHealthy ? 'live' : 'unknown' },
      codex: { state: 'not_dispatched', truth: 'no-dispatch-from-projection' },
      openclaw: { state: 'unknown', truth: 'no-live-openclaw-proof-without-receipt' },
      github: { state: githubTelemetry.adapterAvailable === true ? 'adapter-provided' : 'adapter_unavailable', truth: githubTruth },
      battleBridge: { state: text(queue.oneActiveLaneGuardrail, 'unknown'), truth: 'build-concierge-queue' },
    },
    approvals: buildConcierge.approvalDecision || { status: 'unknown', mergeAllowed: false },
    proofTruth: { github: githubTruth, local: localProofTruth, browser: browserProofTruth },
    blockers,
    receipts,
    staleWarnings: unique(staleWarnings),
    workspaceUpdateStatus: updateStatus,
    nextOperatorAction: executionEngine.nextOperatorAction || queue.nextOperatorAction || feed.recommendedNextAction || updateStatus.nextOperatorAction || 'Inspect live Mission Control projection; unknown stays unknown.',
    finalVerdict: blockers.length ? 'LIVE_GOAL_PROJECTION_BLOCKED_OR_UNKNOWN' : (sourceTruth === 'live' ? 'LIVE_GOAL_PROJECTION_READY' : 'LIVE_GOAL_PROJECTION_MIXED_OR_STATIC_FALLBACK'),
    commandExecutionAllowed: false,
    mergeAllowed: false,
    codexDispatchAllowed: false,
  });
}

export async function readLiveGoalProjection(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const updateStatus = options.updateStatus || await readWorkspaceUpdateStatus(options.updateStatusOptions || {});
  const buildConciergeGoals = options.buildConciergeGoals || await readBuildConciergeGoalReceipts(options.buildConciergeGoalOptions || {});
  const importedGoals = options.importedGoals || await readImportedGoalReceipts(options.goalIngestionOptions || {});
  const githubTelemetry = options.githubTelemetry || await readGithubTelemetry(options.githubTelemetryOptions || {});
  const missionOperationsFeed = options.missionOperationsFeed || await readMissionOperations({ ...(options.missionOperationsOptions || {}), updateStatus, buildConciergeGoals, importedGoals, githubTelemetry, includeLiveGoalProjection: false, now });
  const backendStatus = options.backendStatus || { status: 'live', ok: true, healthRoute: '/api/health', freshness: 'request-generated', diagnostics: buildHealthDiagnostics(process.env, null, {}) };
  return buildLiveGoalProjection({ now, updateStatus, missionOperationsFeed, backendStatus, buildConcierge: { ...(missionOperationsFeed.buildConcierge || {}), importedGoals }, createdGoalCandidates: buildConciergeGoals.candidates, importedGoals, githubTelemetry });
}
