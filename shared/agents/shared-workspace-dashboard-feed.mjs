import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { buildLandingGoalDashboardProjection } from './landingGoalDashboardProjection.mjs';
import { resolveSharedWorkspacePath, validateSharedWorkspaceRecord, DEFAULT_STALE_AFTER_MS } from './sharedAgentWorkspaceStore.mjs';

export const SHARED_WORKSPACE_DASHBOARD_FEED_SCHEMA_VERSION = 'stephanos.shared-workspace-dashboard-feed.v1';
export const DASHBOARD_FEED_STATES = Object.freeze({
  LOADING: 'loading',
  READY: 'ready',
  STALE: 'stale',
  UNAVAILABLE: 'unavailable',
  ERROR: 'error',
});
export const MIN_DASHBOARD_FEED_POLL_INTERVAL_MS = 15_000;
export const DEFAULT_DASHBOARD_FEED_POLL_INTERVAL_MS = 30_000;

const DIRECTORY_BY_KIND = Object.freeze({
  goals: 'goalRecords',
  status: 'statusRecords',
  proof: 'proofRecords',
  capabilities: 'capabilityRecords',
  events: 'eventRecords',
});

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

function emptyRecords() {
  return { goalRecords: [], statusRecords: [], proofRecords: [], capabilityRecords: [], eventRecords: [] };
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
  if (projection.sourceTruth === 'STALE' || projection.operatorAttention.blockers.some((blocker) => blocker.includes('STALE'))) {
    return {
      state: DASHBOARD_FEED_STATES.STALE,
      reason: 'STALE_WORKSPACE_RECORDS',
      exactNextAction: 'Refresh stale Shared Agent Workspace records and attach current proof refs before claiming live progress.',
    };
  }
  return {
    state: DASHBOARD_FEED_STATES.READY,
    reason: 'WORKSPACE_RECORDS_CURRENT_OR_UNKNOWN_BY_GOAL',
    exactNextAction: projection.operatorAttention.exactNextAction,
  };
}

async function readRecordDirectory(root, directory, options) {
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
  for (const name of names.filter((item) => item.endsWith('.json'))) {
    try {
      const record = JSON.parse(await readFile(join(resolved.path, name), 'utf8'));
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

export function createLoadingSharedWorkspaceDashboardFeed(input = {}) {
  const polling = createSharedWorkspaceDashboardPollingContract(input);
  return Object.freeze({
    schemaVersion: SHARED_WORKSPACE_DASHBOARD_FEED_SCHEMA_VERSION,
    kind: 'stephanos.shared_workspace.dashboard_feed',
    state: DASHBOARD_FEED_STATES.LOADING,
    reason: 'INITIAL_POLL_PENDING',
    exactNextAction: 'Wait for the first safe read-only Shared Agent Workspace poll.',
    polling,
    records: emptyRecords(),
    projection: buildLandingGoalDashboardProjection({ nowMs: input.nowMs, staleAfterMs: input.staleAfterMs }),
    errors: [],
  });
}

export async function readSharedWorkspaceDashboardFeed(input = {}) {
  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const staleAfterMs = Number.isFinite(input.staleAfterMs) ? input.staleAfterMs : DEFAULT_STALE_AFTER_MS;
  const polling = createSharedWorkspaceDashboardPollingContract(input);
  const resolved = resolveSharedWorkspacePath({ root: input.root, repoRoot: input.repoRoot, segments: [] });
  const records = emptyRecords();
  const errors = [];
  if (resolved.ok) {
    for (const [directory, key] of Object.entries(DIRECTORY_BY_KIND)) {
      const result = await readRecordDirectory(resolved.root, directory, { repoRoot: input.repoRoot, nowMs, staleAfterMs });
      records[key] = result.records;
      errors.push(...result.errors);
    }
  }
  const latest = {
    goal: records.goalRecords[0] || null,
    status: records.statusRecords[0] || null,
    proof: records.proofRecords[0] || null,
    capability: records.capabilityRecords[0] || null,
  };
  const projection = buildLandingGoalDashboardProjection({
    nowMs,
    staleAfterMs,
    timestampUtc: new Date(nowMs).toISOString(),
    goalRecords: records.goalRecords,
    statusRecords: records.statusRecords,
    proofRecords: records.proofRecords,
    capabilityRecords: records.capabilityRecords,
    sharedWorkspace: { latest },
  });
  const classification = classifyFeed({ resolved, records, projection, errors });
  return Object.freeze({
    schemaVersion: SHARED_WORKSPACE_DASHBOARD_FEED_SCHEMA_VERSION,
    kind: 'stephanos.shared_workspace.dashboard_feed',
    readOnly: true,
    state: classification.state,
    reason: classification.reason,
    exactNextAction: classification.exactNextAction,
    polling,
    workspaceRoot: resolved.ok ? resolved.root : 'UNKNOWN',
    records,
    projection,
    operatorAttention: projection.operatorAttention,
    errors,
  });
}
