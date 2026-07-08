import { readSharedWorkspaceDashboardFeed } from '../../shared/agents/shared-workspace-dashboard-feed.mjs';
import { validateExistingSharedWorkspaceRuntimeConfig, SHARED_WORKSPACE_NEXT_ACTION } from '../../shared/agents/sharedWorkspaceRuntimeConfig.mjs';

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
      safeDisplayPath: resolved.safeDisplayPath || 'UNKNOWN',
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
    records: { goalRecords: [], statusRecords: [], proofRecords: [], capabilityRecords: [], eventRecords: [] },
    errors: [validation.reason],
  });
}

export async function readBackendSharedWorkspaceDashboardFeed(input = {}) {
  const validation = await validateSharedWorkspaceFeedConfig(input);
  if (!validation.ok) return unavailableFeed(validation);
  const feed = await readSharedWorkspaceDashboardFeed({ ...input, root: validation.root });
  const recordCount = Object.values(feed.records || {}).reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
  const diagnosticTrace = [
    { hop: 'resolver', state: 'ready', owner: 'Battle Bridge runtime configuration', workspaceRoot: validation.safeDisplayPath },
    { hop: 'publisher-loop', state: recordCount ? 'ready' : 'blocked', owner: 'Battle Bridge Publisher', reason: recordCount ? 'PUBLISHER_RECORDS_VISIBLE' : 'NO_WORKSPACE_RECORDS' },
    { hop: 'workspace-latest-records', state: recordCount ? 'ready' : 'blocked', owner: 'Shared Agent Workspace', recordCount },
    { hop: 'backend-feed-response', state: feed.state, owner: 'Backend API', reason: feed.reason },
    { hop: 'dashboard-feed-rendering-state', state: ['ready', 'stale'].includes(feed.state) ? 'renderable' : 'honest-unavailable', owner: 'Goal Dashboard', reason: feed.reason },
  ];
  return Object.freeze({ ...feed, route: SHARED_WORKSPACE_DASHBOARD_FEED_ROUTE, backendAdapter: 'shared-workspace-dashboard-feed-reader', safeWorkspaceRoot: validation.safeDisplayPath, diagnosticTrace });
}
