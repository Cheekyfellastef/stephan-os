import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { projectWorkspaceAutonomyBuildTrack } from './autonomyBuildTrackV1.mjs';
import { buildLandingGoalDashboardProjection } from './landingGoalDashboardProjection.mjs';
import {
  LOGICAL_GOAL_CONTROLLER_FABRIC_FILE,
  LOGICAL_GOAL_CONTROLLER_FABRIC_SCHEMA,
} from './logicalGoalControllerFabricV1.mjs';
import { resolveSharedWorkspacePath, validateSharedWorkspaceRecord, DEFAULT_STALE_AFTER_MS } from './sharedAgentWorkspaceStore.mjs';
import {
  SPECIALIZED_NON_DASHBOARD_STATUS_FILES,
  isSharedWorkspaceSpecializedStatusFile,
} from './sharedWorkspaceSpecializedStatusRegistryV1.mjs';

export { SPECIALIZED_NON_DASHBOARD_STATUS_FILES };

export const SHARED_WORKSPACE_DASHBOARD_FEED_SCHEMA_VERSION = 'stephanos.shared-workspace-dashboard-feed.v1';
export const DASHBOARD_FEED_STATES = Object.freeze({
  LOADING: 'loading',
  READY: 'ready',
  STALE: 'stale',
  UNAVAILABLE: 'unavailable',
  ERROR: 'error',
});
export const SHARED_WORKSPACE_FEED_RECORD_SCOPES = Object.freeze({
  CURRENT_STATE: 'current-state',
  FULL_HISTORY: 'full-history',
});
export const MIN_DASHBOARD_FEED_POLL_INTERVAL_MS = 15_000;
export const DEFAULT_DASHBOARD_FEED_POLL_INTERVAL_MS = 30_000;

const DIRECTORY_BY_KIND = Object.freeze({
  goals: 'goalRecords',
  status: 'statusRecords',
  proof: 'proofRecords',
  capabilities: 'capabilityRecords',
  events: 'eventRecords',
  lessons: 'lessonRecords',
  receipts: 'receiptRecords',
});
const HISTORICAL_DIRECTORIES = new Set(['events', 'receipts']);
const DASHBOARD_OPERATOR_DECISION_RECEIPT_SCHEMA = 'stephanos.operator-decision-receipt.v1';
const LOGICAL_FABRIC_FUTURE_SKEW_MS = 60_000;

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const out = String(value).trim();
  return out || fallback;
}

function timestampMs(record) {
  const parsed = Date.parse(text(record?.timestampUtc || record?.checkedAtUtc || record?.publishedAtUtc || record?.createdAt));
  return Number.isFinite(parsed) ? parsed : 0;
}

function safePollIntervalMs(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_DASHBOARD_FEED_POLL_INTERVAL_MS;
  return Math.max(MIN_DASHBOARD_FEED_POLL_INTERVAL_MS, Math.floor(parsed));
}

function safeRecordScope(value) {
  return value === SHARED_WORKSPACE_FEED_RECORD_SCOPES.FULL_HISTORY
    ? SHARED_WORKSPACE_FEED_RECORD_SCOPES.FULL_HISTORY
    : SHARED_WORKSPACE_FEED_RECORD_SCOPES.CURRENT_STATE;
}

function emptyRecords() {
  return { goalRecords: [], statusRecords: [], proofRecords: [], capabilityRecords: [], eventRecords: [], lessonRecords: [], receiptRecords: [] };
}

function classifyFeed({ resolved, records, projection, errors }) {
  if (!resolved.ok) {
    return {
      state: DASHBOARD_FEED_STATES.UNAVAILABLE,
      reason: resolved.reason,
      exactNextAction: 'Set STEPHANOS_SHARED_AGENT_WORKSPACE to the existing Shared Agent Workspace directory outside the repository, then refresh the dashboard feed.',
    };
  }
  if (errors.length) {
    return {
      state: DASHBOARD_FEED_STATES.ERROR,
      reason: errors[0],
      exactNextAction: 'Fix the unreadable or invalid Shared Agent Workspace record named in feed.errors, then refresh the dashboard feed.',
    };
  }
  const count = Object.values(records).reduce((total, list) => total + list.length, 0);
  if (count === 0) {
    return {
      state: DASHBOARD_FEED_STATES.UNAVAILABLE,
      reason: 'NO_WORKSPACE_RECORDS',
      exactNextAction: 'Publish current Shared Agent Workspace status/proof/capability records; missing records remain UNKNOWN.',
    };
  }
  // Feed freshness is workspace-source freshness, not the freshness of every
  // issue-bound dashboard card. Individual stale/unknown goal evidence remains
  // visible in projection.operatorAttention, but must not freeze unrelated live
  // programme authority while current workspace records continue to arrive.
  if (projection.sourceTruth === 'STALE') {
    return {
      state: DASHBOARD_FEED_STATES.STALE,
      reason: 'STALE_WORKSPACE_SOURCE',
      exactNextAction: 'Refresh the Shared Agent Workspace source before claiming live workspace freshness.',
    };
  }
  return {
    state: DASHBOARD_FEED_STATES.READY,
    reason: 'WORKSPACE_RECORDS_CURRENT_OR_UNKNOWN_BY_GOAL',
    exactNextAction: projection.operatorAttention.exactNextAction,
  };
}

export async function readSharedWorkspaceRecordDirectory(root, directory, options = {}) {
  const resolved = resolveSharedWorkspacePath({ root, repoRoot: options.repoRoot, segments: [directory] });
  if (!resolved.ok) return { records: [], errors: [`${directory}:${resolved.reason}`] };
  let names = [];
  try {
    names = await readdir(resolved.path);
  } catch (error) {
    if (error?.code === 'ENOENT') return { records: [], errors: [] };
    return { records: [], errors: [`${directory}:READ_FAILED:${error?.code || error?.message || 'unknown'}`] };
  }
  const records = [];
  const errors = [];
  for (const name of names.filter((item) => (
    item.endsWith('.json')
    && !(directory === 'receipts' && item.endsWith('.pending.json'))
    && !isSharedWorkspaceSpecializedStatusFile({ directory, fileName: item })
  ))) {
    try {
      const record = JSON.parse(await readFile(join(resolved.path, name), 'utf8'));
      if (
        directory === 'receipts'
        && record?.operatorDecisionSchemaVersion !== DASHBOARD_OPERATOR_DECISION_RECEIPT_SCHEMA
      ) continue;
      const validation = validateSharedWorkspaceRecord(record, options);
      if (validation.valid) records.push(record);
      else errors.push(`${directory}/${name}:${validation.errors.join(',')}`);
    } catch (error) {
      errors.push(`${directory}/${name}:PARSE_FAILED:${error?.message || 'unknown'}`);
    }
  }
  records.sort((a, b) => timestampMs(b) - timestampMs(a));
  return { records, errors };
}


export async function readLogicalGoalControllerFabricStatus(root, options = {}) {
  const resolved = resolveSharedWorkspacePath({
    root,
    repoRoot: options.repoRoot,
    segments: ['status', LOGICAL_GOAL_CONTROLLER_FABRIC_FILE],
  });
  if (!resolved.ok) {
    return Object.freeze({ truth: 'UNKNOWN', blocker: resolved.reason, record: null });
  }
  let record;
  try {
    record = JSON.parse(await readFile(resolved.path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return Object.freeze({ truth: 'UNKNOWN', blocker: 'LOGICAL_GOAL_CONTROLLER_FABRIC_NOT_FOUND', record: null });
    }
    return Object.freeze({ truth: 'UNKNOWN', blocker: 'LOGICAL_GOAL_CONTROLLER_FABRIC_READ_FAILED', record: null });
  }
  if (record?.schemaVersion !== LOGICAL_GOAL_CONTROLLER_FABRIC_SCHEMA || record?.valid !== true) {
    return Object.freeze({ truth: 'UNKNOWN', blocker: 'LOGICAL_GOAL_CONTROLLER_FABRIC_INVALID', record: null });
  }
  const observedMs = Date.parse(text(record.observedAtUtc));
  if (!Number.isFinite(observedMs)) {
    return Object.freeze({ truth: 'UNKNOWN', blocker: 'LOGICAL_GOAL_CONTROLLER_FABRIC_TIMESTAMP_INVALID', record: null });
  }
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
  const staleAfterMs = Number.isFinite(options.staleAfterMs) ? options.staleAfterMs : DEFAULT_STALE_AFTER_MS;
  if (observedMs - nowMs > LOGICAL_FABRIC_FUTURE_SKEW_MS) {
    return Object.freeze({ truth: 'STALE', blocker: 'LOGICAL_GOAL_CONTROLLER_FABRIC_FUTURE_DATED', record: null });
  }
  if (Math.max(0, nowMs - observedMs) > staleAfterMs) {
    return Object.freeze({ truth: 'STALE', blocker: 'LOGICAL_GOAL_CONTROLLER_FABRIC_STALE', record: null });
  }
  return Object.freeze({ truth: 'CURRENT', blocker: '', record });
}

export function createSharedWorkspaceDashboardPollingContract(input = {}) {
  return Object.freeze({
    readOnly: true,
    shellAllowed: false,
    browserAutomationAllowed: false,
    dashboardWritesAllowed: false,
    repoMutationAllowed: false,
    fakeLiveProofAllowed: false,
    pollIntervalMs: safePollIntervalMs(input.pollIntervalMs),
    minimumPollIntervalMs: MIN_DASHBOARD_FEED_POLL_INTERVAL_MS,
    exactNextActionOnError: 'Keep the dashboard read-only; fix the Shared Agent Workspace record/path and wait for the next safe poll.',
  });
}

function withAutonomyTrack(projection, statusRecords, nowMs, staleAfterMs) {
  return Object.freeze({
    ...projection,
    autonomyBuildTrack: projectWorkspaceAutonomyBuildTrack({ statusRecords, nowMs, staleAfterMs }),
  });
}

export function createLoadingSharedWorkspaceDashboardFeed(input = {}) {
  const polling = createSharedWorkspaceDashboardPollingContract(input);
  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const staleAfterMs = Number.isFinite(input.staleAfterMs) ? input.staleAfterMs : DEFAULT_STALE_AFTER_MS;
  const projection = withAutonomyTrack(
    buildLandingGoalDashboardProjection({ nowMs, staleAfterMs }),
    [],
    nowMs,
    staleAfterMs,
  );
  return Object.freeze({
    schemaVersion: SHARED_WORKSPACE_DASHBOARD_FEED_SCHEMA_VERSION,
    kind: 'stephanos.shared_workspace.dashboard_feed',
    state: DASHBOARD_FEED_STATES.LOADING,
    reason: 'INITIAL_POLL_PENDING',
    exactNextAction: 'Wait for the first safe read-only Shared Agent Workspace poll.',
    polling,
    records: emptyRecords(),
    projection,
    logicalGoalControllers: projection.logicalGoalControllers,
    autonomyBuildTrack: projection.autonomyBuildTrack,
    errors: [],
  });
}

export async function readSharedWorkspaceDashboardFeed(input = {}) {
  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const staleAfterMs = Number.isFinite(input.staleAfterMs) ? input.staleAfterMs : DEFAULT_STALE_AFTER_MS;
  const polling = createSharedWorkspaceDashboardPollingContract(input);
  const recordScope = safeRecordScope(input.recordScope);
  const resolved = resolveSharedWorkspacePath({ root: input.root, repoRoot: input.repoRoot, segments: [] });
  const records = emptyRecords();
  const errors = [];
  if (resolved.ok) {
    for (const [directory, key] of Object.entries(DIRECTORY_BY_KIND)) {
      if (
        recordScope === SHARED_WORKSPACE_FEED_RECORD_SCOPES.CURRENT_STATE
        && HISTORICAL_DIRECTORIES.has(directory)
      ) continue;
      const result = await readSharedWorkspaceRecordDirectory(resolved.root, directory, { repoRoot: input.repoRoot, nowMs, staleAfterMs });
      records[key] = result.records;
      errors.push(...result.errors);
    }
  }
  const logicalGoalControllerFabricStatus = resolved.ok
    ? await readLogicalGoalControllerFabricStatus(resolved.root, { repoRoot: input.repoRoot, nowMs, staleAfterMs })
    : Object.freeze({ truth: 'UNKNOWN', blocker: resolved.reason, record: null });
  const latest = {
    goal: records.goalRecords[0] || null,
    status: records.statusRecords[0] || null,
    proof: records.proofRecords[0] || null,
    capability: records.capabilityRecords[0] || null,
  };
  const projection = withAutonomyTrack(buildLandingGoalDashboardProjection({
    nowMs,
    staleAfterMs,
    timestampUtc: new Date(nowMs).toISOString(),
    goalRecords: records.goalRecords,
    statusRecords: records.statusRecords,
    proofRecords: records.proofRecords,
    capabilityRecords: records.capabilityRecords,
    sharedWorkspace: { latest },
    logicalGoalControllerFabricStatus,
  }), records.statusRecords, nowMs, staleAfterMs);
  const classification = classifyFeed({ resolved, records, projection, errors });
  return Object.freeze({
    schemaVersion: SHARED_WORKSPACE_DASHBOARD_FEED_SCHEMA_VERSION,
    kind: 'stephanos.shared_workspace.dashboard_feed',
    readOnly: true,
    recordScope,
    state: classification.state,
    reason: classification.reason,
    exactNextAction: classification.exactNextAction,
    polling,
    workspaceRoot: resolved.ok ? resolved.root : 'UNKNOWN',
    records,
    projection,
    logicalGoalControllers: projection.logicalGoalControllers,
    autonomyBuildTrack: projection.autonomyBuildTrack,
    operatorAttention: projection.operatorAttention,
    errors,
  });
}
