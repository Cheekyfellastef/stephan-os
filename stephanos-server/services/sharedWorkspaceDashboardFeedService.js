import { readSharedWorkspaceDashboardFeed } from '../../shared/agents/shared-workspace-dashboard-feed.mjs';
import { resolveExistingSharedWorkspace } from '../../shared/agents/battleBridgePublisherLoop.mjs';

export const SHARED_WORKSPACE_DASHBOARD_FEED_ROUTE = '/api/shared-workspace/dashboard-feed';
export const MISSING_WORKSPACE_NEXT_ACTION = 'Set STEPHANOS_SHARED_AGENT_WORKSPACE to an existing external Shared Agent Workspace directory, then restart Battle Bridge startup supervision.';

function configuredRoot(env = process.env) {
  const raw = env.STEPHANOS_SHARED_AGENT_WORKSPACE;
  return typeof raw === 'string' ? raw.trim() : '';
}

export async function validateSharedWorkspaceFeedConfig(input = {}) {
  const root = configuredRoot(input.env);
  if (!root) {
    return Object.freeze({
      ok: false,
      state: 'unavailable',
      reason: 'SHARED_WORKSPACE_PATH_UNCONFIGURED',
      workspaceRoot: 'UNKNOWN',
      exactNextAction: MISSING_WORKSPACE_NEXT_ACTION,
    });
  }
  const resolved = await resolveExistingSharedWorkspace(root, { repoRoot: input.repoRoot });
  if (!resolved.ok) {
    return Object.freeze({
      ok: false,
      state: 'unavailable',
      reason: resolved.reason,
      workspaceRoot: 'UNKNOWN',
      exactNextAction: MISSING_WORKSPACE_NEXT_ACTION,
    });
  }
  return Object.freeze({ ok: true, state: 'ready', reason: resolved.reason, root: resolved.root, workspaceRoot: resolved.root });
}

export async function readBackendSharedWorkspaceDashboardFeed(input = {}) {
  const validation = await validateSharedWorkspaceFeedConfig(input);
  if (!validation.ok) {
    return Object.freeze({
      schemaVersion: 'stephanos.backend.shared-workspace-dashboard-feed.v1',
      route: SHARED_WORKSPACE_DASHBOARD_FEED_ROUTE,
      readOnly: true,
      state: validation.state,
      reason: validation.reason,
      workspaceRoot: 'UNKNOWN',
      exactNextAction: validation.exactNextAction,
      records: { goalRecords: [], statusRecords: [], proofRecords: [], capabilityRecords: [], eventRecords: [] },
      errors: [validation.reason],
    });
  }
  const feed = await readSharedWorkspaceDashboardFeed({ ...input, root: validation.root });
  return Object.freeze({ ...feed, route: SHARED_WORKSPACE_DASHBOARD_FEED_ROUTE, backendAdapter: 'shared-workspace-dashboard-feed-reader' });
}
