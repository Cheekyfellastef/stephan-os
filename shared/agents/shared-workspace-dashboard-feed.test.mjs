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
import { SPECIALIZED_NON_DASHBOARD_STATUS_FILES } from './sharedWorkspaceSpecializedStatusRegistryV1.mjs';
import {
  createAgentCapabilityRecord,
  createSharedWorkspaceProofRecord,
  createSharedWorkspaceReceiptRecord,
  createSharedWorkspaceStatusRecord,
} from './sharedAgentWorkspaceStore.mjs';

async function tempWorkspace() {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-dashboard-feed-test-'));
  await Promise.all(['status', 'proof', 'capabilities', 'receipts'].map((directory) => mkdir(join(root, directory), { recursive: true })));
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
  const status = createSharedWorkspaceStatusRecord({ statusId: 'workspace-ready', timestampUtc: now, relatedIssue: '#1290', status: 'CURRENT', summary: '#1290 Shared Workspace current', proofRefs: ['proof/status'] });
  const proof = createSharedWorkspaceProofRecord({ proofId: 'workspace-proof', timestampUtc: now, status: 'PASS', summary: '#1290 proof current', correlationId: 'verification-run', relatedIssue: '#1290', proofRefs: ['proof/shared-workspace'], refs: ['proof/shared-workspace'] });
  const capability = { ...createAgentCapabilityRecord({ agentId: 'openclaw', timestampUtc: now, proofRefs: ['proof/capability'] }), relatedGoal: '#1284 #1286' };
  await writeJson(root, 'status', 'status-1290.json', status);
  await writeJson(root, 'proof', 'proof-1290.json', proof);
  await writeJson(root, 'capabilities', 'openclaw.json', capability);

  const feed = await readSharedWorkspaceDashboardFeed({ root, nowMs: Date.parse(now), staleAfterMs: 60_000 });
  assert.equal(feed.state, DASHBOARD_FEED_STATES.READY);
  assert.equal(feed.readOnly, true);
  assert.equal(feed.projection.goals.find((goal) => goal.issue === '#1290').statusTruth, 'CURRENT');
  assert.equal(feed.projection.goals.find((goal) => goal.issue === '#1287').statusTruth, 'UNKNOWN');
  assert.equal(feed.projection.goals.find((goal) => goal.issue === '#1287').proofTruth, 'UNKNOWN');
  assert.equal(feed.projection.goals.find((goal) => goal.issue === '#1284').capabilityTruth, 'CURRENT');
  assert.equal(feed.operatorAttention.localProofNeeded.includes('#1290'), false);
});

test('shared receipts are exposed to every dashboard-feed participant', async () => {
  const root = await tempWorkspace();
  const now = '2026-07-07T00:00:00.000Z';
  const receipt = {
    ...createSharedWorkspaceReceiptRecord({
      receiptId: 'operator-decision-shared-status',
      participantId: 'operator',
      timestampUtc: now,
      correlationId: 'merge-pr-2034-abcdef12',
      relatedIssue: '#2034',
      relatedPr: '#2034',
      receivedRecordId: 'merge-pr-2034-abcdef12',
      disposition: 'operator-approved-handoff-only',
      summary: 'Operator approved the exact shared decision.',
      proofRefs: ['receipts/operator-decision-shared-status.json'],
    }),
    operatorDecisionSchemaVersion: 'stephanos.operator-decision-receipt.v1',
    decisionId: 'merge-pr-2034-abcdef12',
    action: 'APPROVE',
    resultingStatus: 'APPROVED',
  };
  await writeJson(root, 'receipts', 'operator-decision-shared-status.json', receipt);
  await writeJson(root, 'receipts', 'operator-decision-unrouted.pending.json', {
    ...receipt,
    receiptId: 'operator-decision-unrouted',
    decisionId: 'merge-pr-2034-pending123',
    correlationId: 'merge-pr-2034-pending123',
    receivedRecordId: 'merge-pr-2034-pending123',
    routedToStephanos: false,
  });
  await writeJson(root, 'receipts', 'unrelated-cycle-receipt.json', createSharedWorkspaceReceiptRecord({
    receiptId: 'unrelated-cycle-receipt',
    participantId: 'durable-flywheel-controller',
    timestampUtc: now,
    correlationId: 'unrelated-cycle',
    relatedIssue: '#1497',
    receivedRecordId: 'unrelated-cycle',
    disposition: 'ready',
    summary: 'An unrelated internal receipt is not exposed by the dashboard feed.',
    proofRefs: ['receipts/unrelated-cycle-receipt.json'],
  }));

  const feed = await readSharedWorkspaceDashboardFeed({ root, nowMs: Date.parse(now), staleAfterMs: 60_000 });
  assert.equal(feed.state, DASHBOARD_FEED_STATES.READY);
  assert.equal(feed.records.receiptRecords.length, 1);
  assert.equal(feed.records.receiptRecords[0].action, 'APPROVE');
  assert.equal(feed.records.receiptRecords[0].resultingStatus, 'APPROVED');
  assert.equal(feed.records.receiptRecords[0].decisionId, 'merge-pr-2034-abcdef12');
});

test('stale records show stale and exact refresh action', async () => {
  const root = await tempWorkspace();
  await writeJson(root, 'status', 'status-1290.json', createSharedWorkspaceStatusRecord({ statusId: 'workspace-stale', timestampUtc: '2026-07-06T00:00:00.000Z', relatedIssue: '#1290', status: 'CURRENT' }));
  await writeJson(root, 'proof', 'proof-1290.json', createSharedWorkspaceProofRecord({ proofId: 'workspace-proof-stale', timestampUtc: '2026-07-06T00:00:00.000Z', status: 'PASS', correlationId: 'verification-run', relatedIssue: '#1290', proofRefs: ['proof/shared-workspace'] }));

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

test('known specialized status projections stay outside dashboard authority without weakening invalid-record failure', async () => {
  const root = await tempWorkspace();
  const now = '2026-07-07T00:00:00.000Z';
  await writeJson(root, 'status', 'status-1290.json', createSharedWorkspaceStatusRecord({
    statusId: 'status-1290',
    timestampUtc: now,
    status: 'CURRENT',
  }));

  await Promise.all(SPECIALIZED_NON_DASHBOARD_STATUS_FILES.map((name) => writeFile(
    join(root, 'status', name),
    '\uFEFF{"schemaVersion":"specialized-subsystem-record.v1","logPath":"must-not-enter-dashboard-authority"}\n',
    'utf8',
  )));

  const accepted = await readSharedWorkspaceDashboardFeed({ root, nowMs: Date.parse(now), staleAfterMs: 60_000 });
  assert.equal(accepted.state, DASHBOARD_FEED_STATES.READY);
  assert.deepEqual(accepted.errors, []);
  assert.equal(accepted.records.statusRecords.length, 1);
  assert.equal(accepted.records.statusRecords[0].statusId, 'status-1290');
  assert.equal(SPECIALIZED_NON_DASHBOARD_STATUS_FILES.includes('guarded-goal-runner-pr-current.json'), true);
  assert.equal(SPECIALIZED_NON_DASHBOARD_STATUS_FILES.includes('ignition-browser-surfaces-current.json'), true);
  assert.equal(SPECIALIZED_NON_DASHBOARD_STATUS_FILES.includes('battle-bridge-recovery-mesh-state.json'), true);
  assert.equal(SPECIALIZED_NON_DASHBOARD_STATUS_FILES.includes('battle-bridge-break-glass-nonce.json'), true);

  await writeFile(
    join(root, 'status', 'attacker-selected-specialized-record.json'),
    '\uFEFF{"schemaVersion":"specialized-subsystem-record.v1"}\n',
    'utf8',
  );
  const rejected = await readSharedWorkspaceDashboardFeed({ root, nowMs: Date.parse(now), staleAfterMs: 60_000 });
  assert.equal(rejected.state, DASHBOARD_FEED_STATES.ERROR);
  assert.equal(rejected.errors.length, 1);
  assert.match(rejected.errors[0], /attacker-selected-specialized-record\.json:PARSE_FAILED/);
});
