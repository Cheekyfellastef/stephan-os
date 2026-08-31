import { readSharedWorkspaceDashboardFeed } from '../../shared/agents/shared-workspace-dashboard-feed.mjs';
import { overlayGoalDashboardWithLivePortfolio } from '../../shared/agents/liveGoalDashboardPortfolioOverlay.mjs';
import { validateExistingSharedWorkspaceRuntimeConfig, SHARED_WORKSPACE_NEXT_ACTION } from '../../shared/agents/sharedWorkspaceRuntimeConfig.mjs';
import { readLiveGoalProjection } from './liveGoalProjectionService.js';

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
    records: { goalRecords: [], statusRecords: [], proofRecords: [], capabilityRecords: [], eventRecords: [], receiptRecords: [] },
    errors: [validation.reason],
  });
}

function latest(records = []) {
  return Array.isArray(records) && records.length ? records[0] : null;
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

function effectiveFeedClassification(feed, projection) {
  const dynamic = projection?.portfolioSource && projection.portfolioSource !== 'BASE_PROJECTION_FALLBACK';
  if (dynamic && projection.sourceTruth === 'CURRENT') {
    return {
      state: 'ready',
      reason: 'LIVE_PROGRAMME_PORTFOLIO_CURRENT',
      exactNextAction: projection.operatorAttention?.exactNextAction || feed.exactNextAction,
    };
  }
  if (dynamic && projection.sourceTruth === 'STALE') {
    return {
      state: 'stale',
      reason: 'LIVE_PROGRAMME_PORTFOLIO_STALE',
      exactNextAction: projection.operatorAttention?.exactNextAction || 'Refresh the stale programme evidence before claiming current progress.',
    };
  }
  return {
    state: feed.state,
    reason: feed.reason,
    exactNextAction: feed.exactNextAction,
  };
}

export async function readBackendSharedWorkspaceDashboardFeed(input = {}) {
  const validation = await validateSharedWorkspaceFeedConfig(input);
  if (!validation.ok) return unavailableFeed(validation);

  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const feed = await readSharedWorkspaceDashboardFeed({ ...input, root: validation.root });
  const live = await resolveLiveProjection(input, nowMs);
  const records = feed.records || {};
  const projection = overlayGoalDashboardWithLivePortfolio({
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
  const classification = effectiveFeedClassification(feed, projection);
  const recordCount = Object.values(records).reduce((sum, value) => sum + (Array.isArray(value) ? value.length : 0), 0);
  const diagnosticTrace = [
    { hop: 'resolver', state: 'ready', owner: 'Battle Bridge runtime configuration', workspaceRoot: validation.safeDisplayPath },
    { hop: 'publisher-loop', state: recordCount ? 'ready' : 'blocked', owner: 'Battle Bridge Publisher', reason: recordCount ? 'PUBLISHER_RECORDS_VISIBLE' : 'NO_WORKSPACE_RECORDS' },
    { hop: 'workspace-latest-records', state: recordCount ? 'ready' : 'blocked', owner: 'Shared Agent Workspace', recordCount },
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
    operatorAttention: projection.operatorAttention,
    livePortfolio: Object.freeze({
      state: live.state,
      reason: live.reason,
      source: projection.portfolioSource || 'BASE_PROJECTION_FALLBACK',
      observedAtUtc: projection.portfolioObservedAt || new Date(nowMs).toISOString(),
      githubOpenPrCount: projection.liveGithubPrCount || 0,
      workspaceGoalCount: projection.liveWorkspaceGoalCount || 0,
    }),
    diagnosticTrace,
  });
}
