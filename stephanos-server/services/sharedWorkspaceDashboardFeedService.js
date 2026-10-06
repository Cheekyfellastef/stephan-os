import {
  readSharedWorkspaceDashboardFeed,
  SHARED_WORKSPACE_FEED_RECORD_SCOPES,
} from '../../shared/agents/shared-workspace-dashboard-feed.mjs';
import { overlayGoalDashboardWithLivePortfolio } from '../../shared/agents/liveGoalDashboardPortfolioOverlay.mjs';
import { buildGoalDashboardEstateSummary } from '../../shared/agents/goalDashboardEstateSummaryV1.mjs';
import { validateExistingSharedWorkspaceRuntimeConfig, SHARED_WORKSPACE_NEXT_ACTION } from '../../shared/agents/sharedWorkspaceRuntimeConfig.mjs';
import { readLiveGoalProjection } from './liveGoalProjectionService.js';
import {
  projectGoalBuildConveyorV1,
  projectGoalBuildJourneyV1,
} from '../../shared/agents/goalBuildConveyorV1.mjs';

export const SHARED_WORKSPACE_DASHBOARD_FEED_ROUTE = '/api/shared-workspace/dashboard-feed';
export const MISSING_WORKSPACE_NEXT_ACTION = SHARED_WORKSPACE_NEXT_ACTION;

export async function validateSharedWorkspaceFeedConfig(input = {}) {
  const resolved = await validateExistingSharedWorkspaceRuntimeConfig(input);
  if (!resolved.ok) {
    return Object.freeze({
      ok: false,
      state: 'unavailable',
      reason: resolved.reason,
      root: resolved.root,
      workspaceRoot: 'UNKNOWN',
      safeDisplayPath: 'UNKNOWN',
      exactNextAction: resolved.exactNextAction || MISSING_WORKSPACE_NEXT_ACTION,
      trace: { hop: 'resolver', state: 'blocked', owner: 'Battle Bridge runtime configuration', reason: resolved.reason },
    });
  }
  return Object.freeze({ ok: true, state: 'ready', reason: resolved.reason, root: resolved.root, workspaceRoot: resolved.root, safeDisplayPath: resolved.safeDisplayPath });
}

function unavailableFeed(validation) {
  return Object.freeze({
    schemaVersion: 'stephanos.backend.shared-workspace-dashboard-feed.v1',
    route: SHARED_WORKSPACE_DASHBOARD_FEED_ROUTE,
    readOnly: true,
    state: validation.state,
    reason: validation.reason,
    workspaceRoot: validation.workspaceRoot || 'UNKNOWN',
    safeWorkspaceRoot: validation.safeDisplayPath || 'UNKNOWN',
    exactNextAction: validation.exactNextAction,
    diagnosticTrace: [validation.trace],
    records: { goalRecords: [], statusRecords: [], proofRecords: [], capabilityRecords: [], eventRecords: [], lessonRecords: [], receiptRecords: [] },
    goalEstate: buildGoalDashboardEstateSummary(),
    errors: [validation.reason],
  });
}

function latest(records = []) {
  return Array.isArray(records) && records.length ? records[0] : null;
}

function latestClosedLoopLearning(records = []) {
  const event = Array.isArray(records)
    ? records.find((record) => record?.closedLoopLearning?.schemaVersion === 'stephanos.closed-loop-learning.v1')
    : null;
  return event?.closedLoopLearning || null;
}

async function resolveLiveProjection(input, nowMs) {
  if (Object.prototype.hasOwnProperty.call(input, 'liveProjection')) {
    return { projection: input.liveProjection || null, state: input.liveProjection ? 'ready' : 'unavailable', reason: input.liveProjection ? 'INJECTED_LIVE_PROJECTION' : 'LIVE_PROJECTION_DISABLED' };
  }
  try {
    const configured = input.liveGoalProjectionOptions || {};
    const projection = await readLiveGoalProjection({
      ...configured,
      now: new Date(nowMs),
      githubTelemetryOptions: {
        ...(configured.githubTelemetryOptions || {}),
        env: configured.githubTelemetryOptions?.env || input.env,
      },
    });
    return { projection, state: projection ? 'ready' : 'unavailable', reason: projection ? 'LIVE_PROJECTION_READ' : 'LIVE_PROJECTION_EMPTY' };
  } catch (error) {
    return { projection: null, state: 'unavailable', reason: `LIVE_PROJECTION_READ_FAILED:${error?.message || 'unknown'}` };
  }
}

function hasRenderableCurrentStateEvidence(feed) {
  const records = feed?.records || {};
  const currentRecordCount = [records.goalRecords, records.statusRecords, records.proofRecords, records.capabilityRecords]
    .reduce((sum, value) => sum + (Array.isArray(value) ? value.length : 0), 0);
  return currentRecordCount > 0 && Array.isArray(feed?.projection?.goals) && feed.projection.goals.length > 0;
}

function effectiveFeedClassification(feed, projection) {
  if (feed?.state === 'error' && hasRenderableCurrentStateEvidence(feed)) {
    const sourceTruth = String(
      feed?.projection?.sourceFreshness?.truth
        || feed?.projection?.sourceTruth
        || 'UNKNOWN',
    ).toUpperCase();
    if (sourceTruth === 'CURRENT') {
      return {
        state: 'ready',
        reason: 'CURRENT_WORKSPACE_EVIDENCE_WITH_RECORD_WARNINGS',
        exactNextAction: 'Repair the invalid Shared Agent Workspace record; current valid evidence remains fresh and renderable.',
      };
    }
    return {
      state: 'stale',
      reason: 'WORKSPACE_RECORD_ERRORS_WITH_VALID_EVIDENCE',
      exactNextAction: feed.exactNextAction || 'Repair the invalid Shared Agent Workspace record while keeping valid current-state evidence visible as degraded.',
    };
  }
  const dynamic = projection?.portfolioSource && projection.portfolioSource !== 'BASE_PROJECTION_FALLBACK';
  if (dynamic && projection.sourceTruth === 'CURRENT') {
    return { state: 'ready', reason: 'LIVE_PROGRAMME_PORTFOLIO_CURRENT', exactNextAction: projection.operatorAttention?.exactNextAction || feed.exactNextAction };
  }
  if (dynamic && projection.sourceTruth === 'STALE') {
    return { state: 'stale', reason: 'LIVE_PROGRAMME_PORTFOLIO_STALE', exactNextAction: projection.operatorAttention?.exactNextAction || 'Refresh the stale programme evidence before claiming current progress.' };
  }
  return { state: feed.state, reason: feed.reason, exactNextAction: feed.exactNextAction };
}

function autonomyAwareQueue(queueDispatcher = {}, autonomyBuildTrack = null) {
  if (!autonomyBuildTrack?.currentGate) return queueDispatcher;
  return Object.freeze({
    ...queueDispatcher,
    dispatcherState: `AUTONOMY ${autonomyBuildTrack.currentGate}:${autonomyBuildTrack.currentState || 'UNKNOWN'}`,
    autonomyCurrentGate: autonomyBuildTrack.currentGate,
    autonomyCurrentState: autonomyBuildTrack.currentState || 'UNKNOWN',
    autonomyLoopProven: autonomyBuildTrack.autonomousLoopProven === true,
  });
}


function goalKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match = raw.match(/#?(\d+)/);
  return match ? `#${match[1]}` : raw.toLowerCase();
}

function buildTruthAwareGoals(goalEstate, buildTruth, autonomyBuildTrack = null) {
  const goals = Array.isArray(goalEstate?.goals) ? goalEstate.goals : [];
  const truthGoals = Array.isArray(buildTruth?.goals) ? buildTruth.goals : [];
  const byGoal = new Map(truthGoals.map((goal) => [goalKey(goal?.issue), goal]));
  const truthState = String(buildTruth?.state || 'UNKNOWN').toUpperCase();
  return Object.freeze(goals.map((goal) => {
    const live = byGoal.get(goalKey(goal?.issue || goal?.goalId)) || null;
    let buildState = live?.state ? String(live.state).toUpperCase() : '';
    if (!buildState) {
      if (truthState === 'STALE') buildState = 'STALE';
      else if (goal?.bucket === 'parked' || goal?.bucket === 'waitingDependency' || goal?.bucket === 'operatorReady') buildState = 'HELD';
      else if (goal?.bucket === 'eligible' || goal?.bucket === 'active') buildState = 'QUEUED';
      else buildState = 'UNKNOWN';
    }
    const buildTrafficLight = live?.state === 'BUILDING' ? 'GREEN'
      : buildState === 'BLOCKED' ? 'RED'
        : buildState === 'HELD' ? 'AMBER'
          : buildState === 'QUEUED' ? 'BLUE'
            : buildState === 'STALE' ? 'GREY'
              : 'GREY';
    const enriched = {
      ...goal,
      buildState,
      buildTrafficLight,
      autonomous: live?.autonomous === true,
      selectedForAdmission: live?.selectedForAdmission === true,
      controllerId: live?.controllerId || '',
      controllerTitle: live?.controllerTitle || '',
      logicalLaneId: live?.logicalLaneId || '',
      builder: live?.builder || '',
      currentPhase: live?.currentPhase || '',
      lastMaterialProgressAtUtc: live?.lastMaterialProgressAtUtc || '',
      prNumber: live?.prNumber || null,
      buildProofRefs: Object.freeze(Array.isArray(live?.proofRefs) ? live.proofRefs : []),
      buildBlocker: live?.blocker || '',
      buildNextAction: live?.nextAction || '',
    };
    return Object.freeze({
      ...enriched,
      buildJourney: projectGoalBuildJourneyV1(enriched, autonomyBuildTrack),
    });
  }));
}

function enrichProjectionWithCompleteEstate(portfolioProjection, goalEstate) {
  const autonomyBuildTrack = portfolioProjection.autonomyBuildTrack || null;
  const queueDispatcher = autonomyAwareQueue(portfolioProjection.queueDispatcher || {}, autonomyBuildTrack);
  if (!goalEstate?.totalOpenGoals || !Array.isArray(goalEstate.goals)) {
    return Object.freeze({ ...portfolioProjection, queueDispatcher, goalEstate });
  }
  const goals = buildTruthAwareGoals(goalEstate, portfolioProjection.stephanosBuildTruth, autonomyBuildTrack);
  const estateBlockers = goals.flatMap((goal) => Array.isArray(goal.blockers) ? goal.blockers : []);
  const existingAttention = portfolioProjection.operatorAttention || {};
  const blockers = [...new Set([...(Array.isArray(existingAttention.blockers) ? existingAttention.blockers : []), ...estateBlockers].filter(Boolean))];
  return Object.freeze({
    ...portfolioProjection,
    goals,
    queueDispatcher,
    goalEstate,
    goalBuildConveyor: projectGoalBuildConveyorV1(goals),
    operatorAttention: Object.freeze({ ...existingAttention, blockers }),
  });
}

export async function readBackendSharedWorkspaceDashboardFeed(input = {}) {
  const validation = await validateSharedWorkspaceFeedConfig(input);
  if (!validation.ok) return unavailableFeed(validation);

  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const feed = await readSharedWorkspaceDashboardFeed({
    ...input,
    root: validation.root,
    recordScope: input.recordScope || SHARED_WORKSPACE_FEED_RECORD_SCOPES.CURRENT_STATE,
  });
  const live = await resolveLiveProjection(input, nowMs);
  const records = feed.records || {};
  const goalEstate = buildGoalDashboardEstateSummary({
    goalRecords: records.goalRecords,
    proofRecords: records.proofRecords,
    nowMs,
    staleAfterMs: input.staleAfterMs,
  });
  const portfolioProjection = overlayGoalDashboardWithLivePortfolio({
    baseProjection: feed.projection,
    liveProjection: live.projection,
    goalRecords: records.goalRecords,
    statusRecords: records.statusRecords,
    proofRecords: records.proofRecords,
    capabilityRecords: records.capabilityRecords,
    nowMs,
    staleAfterMs: input.staleAfterMs,
    sharedWorkspace: {
      latest: {
        goal: latest(records.goalRecords),
        status: latest(records.statusRecords),
        proof: latest(records.proofRecords),
        capability: latest(records.capabilityRecords),
      },
    },
  });
  const projectionBase = enrichProjectionWithCompleteEstate(portfolioProjection, goalEstate);
  const projection = Object.freeze({
    ...projectionBase,
    closedLoopLearning: latestClosedLoopLearning(records.eventRecords),
    operationalFacts: feed.operationalFacts,
  });
  const classification = effectiveFeedClassification(feed, projection);
  const recordCount = Object.values(records).reduce((sum, value) => sum + (Array.isArray(value) ? value.length : 0), 0);
  const diagnosticTrace = [
    { hop: 'resolver', state: 'ready', owner: 'Battle Bridge runtime configuration', workspaceRoot: validation.safeDisplayPath },
    { hop: 'publisher-loop', state: recordCount ? 'ready' : 'blocked', owner: 'Battle Bridge Publisher', reason: recordCount ? 'PUBLISHER_RECORDS_VISIBLE' : 'NO_WORKSPACE_RECORDS' },
    { hop: 'workspace-latest-records', state: recordCount ? 'ready' : 'blocked', owner: 'Shared Agent Workspace', recordCount },
    { hop: 'goal-estate-summary', state: goalEstate.totalOpenGoals ? 'ready' : 'empty', owner: 'Goal Dashboard', openGoalCount: goalEstate.totalOpenGoals, reason: goalEstate.totalOpenGoals ? 'ALL_NON_TERMINAL_GOAL_RECORDS_PROJECTED' : 'NO_OPEN_GOAL_RECORDS' },
    { hop: 'live-programme-projection', state: live.state, owner: 'Mission Scheduler / GitHub read model', reason: live.reason, portfolioSource: projection.portfolioSource || 'BASE_PROJECTION_FALLBACK' },
    { hop: 'backend-feed-response', state: classification.state, owner: 'Backend API', reason: classification.reason },
    { hop: 'dashboard-feed-rendering-state', state: ['ready', 'stale'].includes(classification.state) ? 'renderable' : 'honest-unavailable', owner: 'Goal Dashboard', reason: classification.reason },
  ];
  return Object.freeze({
    ...feed,
    state: classification.state,
    reason: classification.reason,
    exactNextAction: classification.exactNextAction,
    route: SHARED_WORKSPACE_DASHBOARD_FEED_ROUTE,
    backendAdapter: 'shared-workspace-dashboard-feed-reader',
    safeWorkspaceRoot: validation.safeDisplayPath,
    projection,
    operationalFacts: feed.operationalFacts,
    goalEstate,
    operatorAttention: projection.operatorAttention,
    livePortfolio: Object.freeze({
      state: live.state,
      reason: live.reason,
      source: projection.portfolioSource || 'BASE_PROJECTION_FALLBACK',
      observedAtUtc: projection.portfolioObservedAt || new Date(nowMs).toISOString(),
      githubOpenPrCount: projection.liveGithubPrCount || 0,
      workspaceGoalCount: goalEstate.totalOpenGoals,
    }),
    diagnosticTrace,
  });
}
