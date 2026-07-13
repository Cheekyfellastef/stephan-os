import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  DASHBOARD_FEED_STATES,
  MIN_DASHBOARD_FEED_POLL_INTERVAL_MS,
  createLoadingSharedWorkspaceDashboardFeed,
  createSharedWorkspaceDashboardPollingContract,
  readSharedWorkspaceDashboardFeed,
} from './shared-workspace-dashboard-feed.mjs';
import {
  createAgentCapabilityRecord,
  createSharedWorkspaceProofRecord,
  createSharedWorkspaceStatusRecord,
} from './sharedAgentWorkspaceStore.mjs';

async function tempWorkspace() {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-dashboard-feed-test-'));
  await Promise.all(['status', 'proof', 'capabilities'].map((directory) => mkdir(join(root, directory), { recursive: true })));
  return root;
}

async function writeJson(root, directory, name, record) {
  await writeFile(join(root, directory, name), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

test('polling contract clamps to safe read-only interval and loading state is explicit', () => {
  const contract = createSharedWorkspaceDashboardPollingContract({ pollIntervalMs: 100 });
  assert.equal(contract.readOnly, true);
  assert.equal(contract.shellAllowed, false);
  assert.equal(contract.browserAutomationAllowed, false);
  assert.equal(contract.dashboardWritesAllowed, false);
  assert.equal(contract.repoMutationAllowed, false);
  assert.equal(contract.fakeLiveProofAllowed, false);
  assert.equal(contract.pollIntervalMs, MIN_DASHBOARD_FEED_POLL_INTERVAL_MS);

  const feed = createLoadingSharedWorkspaceDashboardFeed({ pollIntervalMs: 100, nowMs: Date.parse('2026-07-07T00:00:00.000Z') });
  assert.equal(feed.state, DASHBOARD_FEED_STATES.LOADING);
  assert.match(feed.exactNextAction, /first safe read-only/);
});

test('missing workspace path is unavailable and keeps projection unknown', async () => {
  const feed = await readSharedWorkspaceDashboardFeed({ root: '%USERPROFILE%/Documents/Stephanos-openclaw-workspace', nowMs: Date.parse('2026-07-07T00:00:00.000Z') });
  assert.equal(feed.state, DASHBOARD_FEED_STATES.UNAVAILABLE);
  assert.equal(feed.projection.sourceTruth, 'UNKNOWN');
  assert.equal(feed.records.statusRecords.length, 0);
  assert.match(feed.exactNextAction, /Set STEPHANOS_SHARED_AGENT_WORKSPACE/);
});

test('current shared workspace records produce ready feed and refresh operator attention', async () => {
  const root = await tempWorkspace();
  const now = '2026-07-07T00:00:00.000Z';
  const status = { ...createSharedWorkspaceStatusRecord({ statusId: 'status-1290', timestampUtc: now, status: 'CURRENT', summary: '#1290 Shared Workspace current', proofRefs: ['proof/status'] }), relatedGoal: '#1290' };
  const proof = { ...createSharedWorkspaceProofRecord({ proofId: 'proof-1290', timestampUtc: now, status: 'PASS', summary: '#1290 proof current', correlationId: 'issue-1290', relatedIssue: '#1290', proofRefs: ['proof/shared-workspace'], refs: ['proof/shared-workspace'] }), relatedGoal: '#1290' };
  const capability = { ...createAgentCapabilityRecord({ agentId: 'openclaw', timestampUtc: now, proofRefs: ['proof/capability'] }), relatedGoal: '#1284 #1286' };
  await writeJson(root, 'status', 'status-1290.json', status);
  await writeJson(root, 'proof', 'proof-1290.json', proof);
  await writeJson(root, 'capabilities', 'openclaw.json', capability);

  const feed = await readSharedWorkspaceDashboardFeed({ root, nowMs: Date.parse(now), staleAfterMs: 60_000 });
  assert.equal(feed.state, DASHBOARD_FEED_STATES.READY);
  assert.equal(feed.readOnly, true);
  assert.equal(feed.projection.goals.find((goal) => goal.issue === '#1290').statusTruth, 'CURRENT');
  assert.equal(feed.projection.goals.find((goal) => goal.issue === '#1284').capabilityTruth, 'CURRENT');
  assert.equal(feed.operatorAttention.localProofNeeded.includes('#1290'), false);
});

test('stale records show stale and exact refresh action', async () => {
  const root = await tempWorkspace();
  await writeJson(root, 'status', 'status-1290.json', { ...createSharedWorkspaceStatusRecord({ statusId: 'status-1290', timestampUtc: '2026-07-06T00:00:00.000Z', status: 'CURRENT' }), relatedGoal: '#1290' });
  await writeJson(root, 'proof', 'proof-1290.json', { ...createSharedWorkspaceProofRecord({ proofId: 'proof-1290', timestampUtc: '2026-07-06T00:00:00.000Z', status: 'PASS', correlationId: 'issue-1290', relatedIssue: '#1290', proofRefs: ['proof/shared-workspace'] }), relatedGoal: '#1290' });

  const feed = await readSharedWorkspaceDashboardFeed({ root, nowMs: Date.parse('2026-07-07T00:00:00.000Z'), staleAfterMs: 60_000 });
  assert.equal(feed.state, DASHBOARD_FEED_STATES.STALE);
  assert.equal(feed.projection.goals.find((goal) => goal.issue === '#1290').statusTruth, 'STALE');
  assert.match(feed.exactNextAction, /Refresh stale Shared Agent Workspace records/);
});

test('invalid record produces error with exact next action', async () => {
  const root = await tempWorkspace();
  await writeJson(root, 'status', 'bad.json', { kind: 'not-valid', timestampUtc: '2026-07-07T00:00:00.000Z' });
  const feed = await readSharedWorkspaceDashboardFeed({ root, nowMs: Date.parse('2026-07-07T00:00:00.000Z') });
  assert.equal(feed.state, DASHBOARD_FEED_STATES.ERROR);
  assert.equal(feed.errors.length, 1);
  assert.match(feed.exactNextAction, /fix the unreadable or invalid/i);
});
