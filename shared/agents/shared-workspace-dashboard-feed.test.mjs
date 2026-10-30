import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  DASHBOARD_FEED_STATES,
  MIN_DASHBOARD_FEED_POLL_INTERVAL_MS,
  SHARED_WORKSPACE_FEED_RECORD_SCOPES,
  createLoadingSharedWorkspaceDashboardFeed,
  createSharedWorkspaceDashboardPollingContract,
  readSharedWorkspaceDashboardFeed,
  readSharedWorkspaceRecordDirectory,
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
  await Promise.all(['status', 'proof', 'capabilities', 'receipts', 'events'].map((directory) => mkdir(join(root, directory), { recursive: true })));
  return root;
}

async function writeJson(root, directory, name, record) {
  await writeFile(join(root, directory, name), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

test('history reads overlap within a fixed bound without losing validation, order or fresh changes', async () => {
  const root = await tempWorkspace();
  const now = '2026-07-07T00:00:00.000Z';
  const names = Array.from({ length: 40 }, (_, index) => `status-${String(index).padStart(2, '0')}.json`);
  await Promise.all(names.map((name) => writeJson(root, 'status', name,
    createSharedWorkspaceStatusRecord({ statusId: name, timestampUtc: now, status: 'CURRENT' }))));
  await writeFile(join(root, 'status', names[3]), '{broken', 'utf8');
  await writeJson(root, 'status', names[8], { kind: 'invalid' });
  let active = 0;
  let peak = 0;
  let reads = 0;
  const options = {
    nowMs: Date.parse(now),
    readFile: async (...args) => {
      active += 1;
      peak = Math.max(peak, active);
      reads += 1;
      try {
        // Vary completion order independently of the directory listing.
        if (String(args[0]).endsWith('0.json')) await setImmediate();
        return await readFile(...args);
      } finally { active -= 1; }
    },
  };
  const result = await readSharedWorkspaceRecordDirectory(root, 'status', options);
  assert.ok(peak > 1, 'history I/O must overlap rather than serialize every record');
  assert.ok(peak <= 16, 'one request must not open the whole history at once');
  assert.equal(active, 0);
  assert.equal(reads, names.length);
  const directoryOrder = await readdir(join(root, 'status'));
  assert.deepEqual(result.records.map(record => record.statusId), directoryOrder.filter(name => ![names[3], names[8]].includes(name)));
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0], /status-03\.json:PARSE_FAILED/);
  assert.match(result.errors[1], /status-08\.json:/);
  await writeJson(root, 'status', names[3], createSharedWorkspaceStatusRecord({
    statusId: 'repaired', timestampUtc: now, status: 'CURRENT',
  }));
  const refreshed = await readSharedWorkspaceRecordDirectory(root, 'status', options);
  assert.equal(refreshed.records.length, 39);
  assert.equal(refreshed.records.some(record => record.statusId === 'repaired'), true);
  assert.equal(refreshed.errors.length, 1);
});

test('one stalled file does not hold the next batch and completion order stays deterministic', async () => {
  const root = await tempWorkspace();
  const names = Array.from({ length: 40 }, (_, i) => `status-${String(i).padStart(2, '0')}.json`);
  await Promise.all(names.map(name => writeJson(root, 'status', name,
    createSharedWorkspaceStatusRecord({ statusId: name, timestampUtc: '2026-07-07T00:00:00.000Z' }))));
  let releaseSlow;
  const slow = new Promise(resolve => { releaseSlow = resolve; });
  let reachedTail;
  const tail = new Promise(resolve => { reachedTail = resolve; });
  const reader = async (...args) => {
    if (String(args[0]).endsWith(names[0])) await slow;
    if (String(args[0]).endsWith(names.at(-1))) reachedTail();
    return readFile(...args);
  };
  const reading = readSharedWorkspaceRecordDirectory(root, 'status', { readFile: reader });
  let deadline;
  try {
    // Deadline is only a deadlock guard; progress is asserted while the first
    // read is deliberately unresolved, not against disk timing thresholds.
    await Promise.race([tail, new Promise((_, reject) => {
      deadline = setTimeout(() => reject(new Error('later files blocked behind a slow batch')), 3000);
    })]);
  } finally { clearTimeout(deadline); releaseSlow(); await reading; }
  const result = await reading;
  assert.deepEqual(result.records.map(record => record.statusId), await readdir(join(root, 'status')));
});

test('overlapping directories share one read allowance and failures release their slots', async () => {
  const roots = await Promise.all([tempWorkspace(), tempWorkspace(), tempWorkspace()]);
  await Promise.all(roots.map(root => Promise.all(Array.from({ length: 33 }, (_, i) => writeJson(root, 'status', `status-${i}.json`,
    createSharedWorkspaceStatusRecord({ statusId: `status-${i}`, timestampUtc: '2026-07-07T00:00:00.000Z' }))))));
  let active = 0;
  let peak = 0;
  const reader = async (...args) => {
    active += 1;
    peak = Math.max(peak, active);
    try {
      await setImmediate();
      if (String(args[0]).endsWith('status-0.json')) throw new Error('injected read refusal');
      return await readFile(...args);
    } finally { active -= 1; }
  };
  const results = await Promise.all(roots.map(root => readSharedWorkspaceRecordDirectory(root, 'status', { readFile: reader })));
  assert.ok(peak > 1);
  assert.ok(peak <= 16, `shared read allowance exceeded: ${peak}`);
  assert.equal(active, 0);
  for (const result of results) {
    assert.equal(result.records.length, 32);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /injected read refusal/);
  }
  const again = await readSharedWorkspaceRecordDirectory(roots[0], 'status', { readFile: reader });
  assert.equal(again.records.length, 32, 'failed reads must not strand later polling');
});

test('full feed starts independent directories without changing canonical error order', async () => {
  const root = await tempWorkspace();
  await writeFile(join(root, 'status', 'bad-status.json'), '{broken');
  await writeFile(join(root, 'proof', 'bad-proof.json'), '{broken');
  let releaseStatus;
  const statusGate = new Promise(resolve => { releaseStatus = resolve; });
  let proofStarted;
  const proofGate = new Promise(resolve => { proofStarted = resolve; });
  const reading = readSharedWorkspaceDashboardFeed({ root, readFile: async (...args) => {
    if (String(args[0]).endsWith('bad-status.json')) await statusGate;
    if (String(args[0]).endsWith('bad-proof.json')) proofStarted();
    return readFile(...args);
  } });
  let deadline;
  try {
    await Promise.race([proofGate, new Promise((_, reject) => {
      deadline = setTimeout(() => reject(new Error('independent proof directory did not start')), 3000);
    })]);
  } finally { clearTimeout(deadline); releaseStatus(); await reading; }
  const result = await reading;
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0], /^status\/bad-status.json:PARSE_FAILED/);
  assert.match(result.errors[1], /^proof\/bad-proof.json:PARSE_FAILED/);
});

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
  assert.equal(feed.proofIndex.state, 'UNAVAILABLE');
  assert.match(feed.exactNextAction, /first safe read-only/);
});

test('overlapping polls share pending disk reads but keep independent time validation and records', async () => {
  const root = await tempWorkspace();
  const now = Date.parse('2026-07-07T00:00:00.000Z');
  await writeJson(root, 'status', 'current.json', createSharedWorkspaceStatusRecord({
    statusId: 'shared-read', timestampUtc: new Date(now).toISOString(), status: 'CURRENT',
  }));
  let reads = 0;
  let release;
  let started;
  const gate = new Promise(resolve => { release = resolve; });
  const reading = new Promise(resolve => { started = resolve; });
  const reader = async (...args) => { reads += 1; started(); await gate; return readFile(...args); };
  const current = readSharedWorkspaceRecordDirectory(root, 'status', { readFile: reader, nowMs: now });
  await reading;
  const second = readSharedWorkspaceRecordDirectory(root, 'status', { readFile: reader, nowMs: now });
  const past = readSharedWorkspaceRecordDirectory(root, 'status', { readFile: reader, nowMs: now - 86400000 });
  release();
  const [a, b, c] = await Promise.all([current, second, past]);
  assert.equal(reads, 1);
  assert.equal(a.records.length, 1);
  assert.equal(b.records.length, 1);
  assert.equal(c.records.length, 1, 'directory reads retain timestamp evidence for the projection to adjudicate');
  a.records[0].summary = 'changed by first consumer';
  assert.notEqual(b.records[0].summary, a.records[0].summary);
  await readSharedWorkspaceRecordDirectory(root, 'status', { readFile: reader, nowMs: now });
  assert.equal(reads, 2, 'completed reads must not become a stale evidence cache');
  const [live, stale] = await Promise.all([
    readSharedWorkspaceDashboardFeed({ root, nowMs: now, staleAfterMs: 60000 }),
    readSharedWorkspaceDashboardFeed({ root, nowMs: now + 86400000, staleAfterMs: 60000 }),
  ]);
  assert.equal(live.state, DASHBOARD_FEED_STATES.READY);
  assert.equal(stale.state, DASHBOARD_FEED_STATES.STALE, 'overlapping polls must keep their own time verdict');
});

test('missing workspace path is unavailable and keeps projection unknown', async () => {
  const feed = await readSharedWorkspaceDashboardFeed({ root: '%USERPROFILE%/Documents/Stephanos-openclaw-workspace', nowMs: Date.parse('2026-07-07T00:00:00.000Z') });
  assert.equal(feed.state, DASHBOARD_FEED_STATES.UNAVAILABLE);
  assert.equal(feed.projection.sourceTruth, 'UNKNOWN');
  assert.equal(feed.records.statusRecords.length, 0);
  assert.equal(feed.proofIndex.state, 'UNAVAILABLE');
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
  assert.equal(feed.recordScope, SHARED_WORKSPACE_FEED_RECORD_SCOPES.CURRENT_STATE);
  assert.equal(feed.proofIndex.state, 'RECORDED');
  assert.equal(feed.proofIndex.visibleCount, 1);
  assert.equal(feed.proofIndex.entries[0].proofId, 'workspace-proof');
  assert.equal(feed.proofIndex.entries[0].verification, 'VALID_WORKSPACE_RECORD_NOT_INDEPENDENTLY_VERIFIED');
  assert.deepEqual(feed.proofIndex.entries[0].links.map(ref => ref.url), ['https://github.com/Cheekyfellastef/stephan-os/issues/1290']);
  assert.equal(feed.proofIndex.grantsExecutionOrMergeAuthority, false);
  assert.equal(feed.projection.goals.find((goal) => goal.issue === '#1290').statusTruth, 'CURRENT');
  assert.equal(feed.projection.goals.find((goal) => goal.issue === '#1287').statusTruth, 'UNKNOWN');
  assert.equal(feed.projection.goals.find((goal) => goal.issue === '#1287').proofTruth, 'UNKNOWN');
  assert.equal(feed.projection.goals.find((goal) => goal.issue === '#1284').capabilityTruth, 'CURRENT');
  assert.equal(feed.operatorAttention.localProofNeeded.includes('#1290'), false);
});

test('machine current-state feed does not walk historical events or receipts', async () => {
  const root = await tempWorkspace();
  const now = '2026-07-07T00:00:00.000Z';
  await writeJson(root, 'status', 'status-current.json', createSharedWorkspaceStatusRecord({
    statusId: 'workspace-current',
    timestampUtc: now,
    status: 'CURRENT',
  }));
  await writeFile(join(root, 'events', 'historical-bad.json'), '{not-json\n', 'utf8');
  await writeFile(join(root, 'receipts', 'historical-bad.json'), '{not-json\n', 'utf8');

  const current = await readSharedWorkspaceDashboardFeed({ root, nowMs: Date.parse(now), staleAfterMs: 60_000 });
  assert.equal(current.recordScope, SHARED_WORKSPACE_FEED_RECORD_SCOPES.CURRENT_STATE);
  assert.equal(current.state, DASHBOARD_FEED_STATES.READY);
  assert.deepEqual(current.errors, []);
  assert.equal(current.records.eventRecords.length, 0);
  assert.equal(current.records.receiptRecords.length, 0);

  const full = await readSharedWorkspaceDashboardFeed({
    root,
    nowMs: Date.parse(now),
    staleAfterMs: 60_000,
    recordScope: SHARED_WORKSPACE_FEED_RECORD_SCOPES.FULL_HISTORY,
  });
  assert.equal(full.recordScope, SHARED_WORKSPACE_FEED_RECORD_SCOPES.FULL_HISTORY);
  assert.equal(full.state, DASHBOARD_FEED_STATES.ERROR);
  assert.equal(full.errors.some((error) => error.includes('historical-bad.json:PARSE_FAILED')), true);
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

  const feed = await readSharedWorkspaceDashboardFeed({
    root,
    nowMs: Date.parse(now),
    staleAfterMs: 60_000,
    recordScope: SHARED_WORKSPACE_FEED_RECORD_SCOPES.FULL_HISTORY,
  });
  assert.equal(feed.state, DASHBOARD_FEED_STATES.READY);
  assert.equal(feed.records.receiptRecords.length, 1);
  assert.equal(feed.records.receiptRecords[0].action, 'APPROVE');
  assert.equal(feed.records.receiptRecords[0].resultingStatus, 'APPROVED');
  assert.equal(feed.records.receiptRecords[0].decisionId, 'merge-pr-2034-abcdef12');
});

test('full-history feed skips unrelated runtime journals before reading while validating operator decisions', async () => {
  const root = await tempWorkspace();
  const now = '2026-07-07T00:00:00.000Z';
  await writeJson(root, 'status', 'workspace-current.json', createSharedWorkspaceStatusRecord({
    statusId: 'workspace-current',
    timestampUtc: now,
    status: 'CURRENT',
  }));
  await Promise.all(Array.from({ length: 256 }, (_, index) =>
    writeFile(join(root, 'receipts', `durable-flywheel-cycle-${index}.json`), '{unrelated-runtime-journal', 'utf8'),
  ));
  await writeFile(join(root, 'receipts', 'operator-decision-unrouted.pending.json'), '{pending-not-published', 'utf8');
  await writeJson(root, 'receipts', 'operator-decision-wrong-schema.json', createSharedWorkspaceReceiptRecord({
    receiptId: 'wrong-schema',
    participantId: 'operator',
    timestampUtc: now,
    correlationId: 'wrong-schema',
    receivedRecordId: 'wrong-schema',
    disposition: 'ready',
  }));

  const input = { root, nowMs: Date.parse(now), staleAfterMs: 60_000, recordScope: SHARED_WORKSPACE_FEED_RECORD_SCOPES.FULL_HISTORY };
  const feed = await readSharedWorkspaceDashboardFeed(input);
  assert.equal(feed.state, DASHBOARD_FEED_STATES.READY);
  assert.deepEqual(feed.errors, []);
  assert.deepEqual(feed.records.receiptRecords, []);

  await writeFile(join(root, 'receipts', 'operator-decision-corrupt.json'), '{broken-published-decision', 'utf8');
  const rejected = await readSharedWorkspaceDashboardFeed(input);
  assert.equal(rejected.state, DASHBOARD_FEED_STATES.ERROR);
  assert.equal(rejected.errors.length, 1);
  assert.match(rejected.errors[0], /receipts\/operator-decision-corrupt\.json:PARSE_FAILED/);
});

test('stale records show stale and exact refresh action', async () => {
  const root = await tempWorkspace();
  await writeJson(root, 'status', 'status-1290.json', createSharedWorkspaceStatusRecord({ statusId: 'workspace-stale', timestampUtc: '2026-07-06T00:00:00.000Z', relatedIssue: '#1290', status: 'CURRENT' }));
  await writeJson(root, 'proof', 'proof-1290.json', createSharedWorkspaceProofRecord({ proofId: 'workspace-proof-stale', timestampUtc: '2026-07-06T00:00:00.000Z', status: 'PASS', correlationId: 'verification-run', relatedIssue: '#1290', proofRefs: ['proof/shared-workspace'] }));

  const feed = await readSharedWorkspaceDashboardFeed({ root, nowMs: Date.parse('2026-07-07T00:00:00.000Z'), staleAfterMs: 60_000 });
  assert.equal(feed.state, DASHBOARD_FEED_STATES.STALE);
  assert.equal(feed.projection.goals.find((goal) => goal.issue === '#1290').statusTruth, 'STALE');
  assert.match(feed.exactNextAction, /Refresh the Shared Agent Workspace source/);
});

test('stale issue-bound cards do not stale a live workspace source', async () => {
  const root = await tempWorkspace();
  const now = '2026-07-07T00:00:00.000Z';
  await writeJson(root, 'status', 'status-1290.json', createSharedWorkspaceStatusRecord({
    statusId: 'workspace-stale',
    timestampUtc: '2026-07-06T00:00:00.000Z',
    relatedIssue: '#1290',
    status: 'CURRENT',
  }));
  await writeJson(root, 'proof', 'proof-1290.json', createSharedWorkspaceProofRecord({
    proofId: 'workspace-proof-stale',
    timestampUtc: '2026-07-06T00:00:00.000Z',
    status: 'PASS',
    correlationId: 'verification-run',
    relatedIssue: '#1290',
    proofRefs: ['proof/shared-workspace'],
  }));
  await writeJson(root, 'status', 'live-controller.json', createSharedWorkspaceStatusRecord({
    statusId: 'live-controller',
    timestampUtc: now,
    status: 'READY',
    summary: 'A current unrelated status record proves the workspace source itself is live.',
  }));

  const feed = await readSharedWorkspaceDashboardFeed({ root, nowMs: Date.parse(now), staleAfterMs: 60_000 });
  assert.equal(feed.state, DASHBOARD_FEED_STATES.READY);
  assert.equal(feed.projection.sourceTruth, 'CURRENT');
  assert.equal(feed.projection.goals.find((goal) => goal.issue === '#1290').statusTruth, 'STALE');
  assert.equal(feed.projection.operatorAttention.blockers.includes('STALE_STATUS_RECORD'), true);
});

test('invalid record produces error with exact next action', async () => {
  const root = await tempWorkspace();
  await writeJson(root, 'status', 'bad.json', { kind: 'not-valid', timestampUtc: '2026-07-07T00:00:00.000Z' });
  const feed = await readSharedWorkspaceDashboardFeed({ root, nowMs: Date.parse('2026-07-07T00:00:00.000Z') });
  assert.equal(feed.state, DASHBOARD_FEED_STATES.ERROR);
  assert.equal(feed.errors.length, 1);
  assert.match(feed.exactNextAction, /fix the unreadable or invalid/i);
});


test('logical goal controller specialized status is read explicitly without entering generic dashboard authority', async () => {
  const root = await tempWorkspace();
  const now = '2026-10-01T20:30:00.000Z';
  await writeJson(root, 'status', 'live-controller.json', createSharedWorkspaceStatusRecord({
    statusId: 'live-controller',
    timestampUtc: now,
    status: 'READY',
    summary: 'Current generic workspace status.',
  }));
  await writeJson(root, 'status', 'logical-goal-controller-fabric-current.json', {
    schemaVersion: 'stephanos.logical-goal-controller-fabric.v1',
    valid: true,
    observedAtUtc: now,
    controllers: [
      {
        schemaVersion: 'stephanos.logical-goal-controller.v1',
        logicalControllerId: 'logical-goal-2314',
        goalIssueNumber: 2314,
        goalTitle: 'Canary Goal: Prove multiplexer-backed autonomous goal build V1',
        lifecycle: 'ACTIVE',
        continuityState: 'ACTIVE',
        route: 'OPENCLAW_LOCAL',
        hostControllerId: '6a9067ac08bc8191b2d78fae5d2bfd01',
        hostControllerTitle: 'Stephanos Autonomous Goal Builder',
        selectedForAdmission: true,
        resourceIds: ['repo:path:docs/architecture/multiplexer-autonomous-goal-build-v1.md'],
        retired: false,
      },
      {
        schemaVersion: 'stephanos.logical-goal-controller.v1',
        logicalControllerId: 'logical-goal-2519',
        goalIssueNumber: 2519,
        goalTitle: 'Build Sovereign Commander as the unmetered Battle Bridge control surface',
        lifecycle: 'READY',
        continuityState: 'TRACKING',
        route: 'STEPHANOS_NATIVE',
        hostControllerId: '6ac3999164b88191a1c866c70ab51bd7',
        hostControllerTitle: 'Stephanos Continuous Foreman',
        selectedForAdmission: false,
        resourceIds: [],
        retired: false,
      },
    ],
    blockers: [],
  });

  const feed = await readSharedWorkspaceDashboardFeed({ root, nowMs: Date.parse(now), staleAfterMs: 60_000 });
  assert.equal(feed.state, DASHBOARD_FEED_STATES.READY);
  assert.equal(feed.records.statusRecords.length, 1, 'specialized logical fabric must stay outside generic status authority');
  assert.equal(feed.logicalGoalControllers.truth, 'CURRENT');
  assert.equal(feed.logicalGoalControllers.logicalControllerCount, 2);
  assert.equal(feed.logicalGoalControllers.activeMaterialLaneCount, 1);
  assert.equal(feed.logicalGoalControllers.trackingLaneCount, 1);
  assert.equal(feed.logicalGoalControllers.selectedForAdmissionCount, 1);
  assert.deepEqual(feed.logicalGoalControllers.selectedIssueNumbers, [2314]);
  assert.equal(feed.logicalGoalControllers.controllers[0].goalRef, '#2314');
});

test('stale logical goal controller fabric fails closed without staling unrelated live workspace truth', async () => {
  const root = await tempWorkspace();
  const now = '2026-10-01T20:30:00.000Z';
  await writeJson(root, 'status', 'live-controller.json', createSharedWorkspaceStatusRecord({
    statusId: 'live-controller',
    timestampUtc: now,
    status: 'READY',
  }));
  await writeJson(root, 'status', 'logical-goal-controller-fabric-current.json', {
    schemaVersion: 'stephanos.logical-goal-controller-fabric.v1',
    valid: true,
    observedAtUtc: '2026-10-01T20:00:00.000Z',
    controllers: [],
    blockers: [],
  });
  const feed = await readSharedWorkspaceDashboardFeed({ root, nowMs: Date.parse(now), staleAfterMs: 60_000 });
  assert.equal(feed.state, DASHBOARD_FEED_STATES.READY);
  assert.equal(feed.logicalGoalControllers.truth, 'STALE');
  assert.equal(feed.logicalGoalControllers.logicalControllerCount, 0);
  assert.equal(feed.logicalGoalControllers.blocker, 'LOGICAL_GOAL_CONTROLLER_FABRIC_STALE');
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
  const launchIdentityFile = `mission-orchestrator-worker-launch-identity-${'a'.repeat(64)}.json`;
  await writeFile(
    join(root, 'status', launchIdentityFile),
    JSON.stringify({ schemaVersion: 'stephanos.mission-worker-launch-identity.v1', launchIdentityId: 'a'.repeat(64) }),
    'utf8',
  );
  const restartCancelFile = `mission-orchestrator-worker-restart-cancel-${'b'.repeat(64)}.json`;
  await writeFile(
    join(root, 'status', restartCancelFile),
    JSON.stringify({ schemaVersion: 'stephanos.mission-worker-restart-cancel.v1', restartInvocationId: 'b'.repeat(64) }),
    'utf8',
  );

  const accepted = await readSharedWorkspaceDashboardFeed({ root, nowMs: Date.parse(now), staleAfterMs: 60_000 });
  assert.equal(accepted.state, DASHBOARD_FEED_STATES.READY);
  assert.deepEqual(accepted.errors, []);
  assert.equal(accepted.records.statusRecords.length, 1);
  assert.equal(accepted.records.statusRecords[0].statusId, 'status-1290');
  assert.equal(SPECIALIZED_NON_DASHBOARD_STATUS_FILES.includes('github-goal-estate-shared-snapshot.json'), true);
  assert.equal(SPECIALIZED_NON_DASHBOARD_STATUS_FILES.includes('guarded-goal-runner-pr-current.json'), true);
  assert.equal(SPECIALIZED_NON_DASHBOARD_STATUS_FILES.includes('ignition-browser-surfaces-current.json'), true);
  assert.equal(SPECIALIZED_NON_DASHBOARD_STATUS_FILES.includes('monitor-admission-registry.json'), true);
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


test('maintenance custody envelopes stay with their specialized owner and cannot grant dashboard authority', async () => {
  const root = await tempWorkspace();
  const now = '2026-10-26T00:00:00.000Z';
  await writeJson(root, 'status', 'status-current.json', createSharedWorkspaceStatusRecord({
    statusId: 'workspace-current', timestampUtc: now, status: 'CURRENT',
  }));
  // Native custody is MAC-wrapped, not a generic shared status record. Its
  // authentication and ACTIVE/IDLE admission remain the custody owner's job.
  const envelope = {
    record: {
      schemaVersion: 'stephanos.sovereign-maintenance-custody.v1',
      phase: 'ACTIVE', reservationId: 'fixture-reservation', operation: 'fleet-goal-supervisor',
      ownerId: 'fixture-owner', ownerPid: 1234, nonce: 'fixture-nonce', startedAtUtc: now,
      bootWitness: { bootStartedAtUtc: '2026-10-25T23:00:00.000Z' },
    },
    mac: 'a'.repeat(64),
  };
  const fileName = 'sovereign-commander-maintenance-custody.json';
  await writeJson(root, 'status', fileName, envelope);
  const accepted = await readSharedWorkspaceDashboardFeed({ root, nowMs: Date.parse(now), staleAfterMs: 60_000 });
  assert.equal(accepted.state, DASHBOARD_FEED_STATES.READY);
  assert.deepEqual(accepted.errors, []);
  assert.deepEqual(accepted.records.statusRecords.map(record => record.statusId), ['workspace-current']);
  assert.deepEqual(accepted.records.proofRecords, []);

  // Neither a similar filename nor the same filename in proof is exempt.
  await writeJson(root, 'status', 'sovereign-commander-maintenance-custody-other.json', envelope);
  await writeJson(root, 'proof', fileName, envelope);
  const rejected = await readSharedWorkspaceDashboardFeed({ root, nowMs: Date.parse(now), staleAfterMs: 60_000 });
  assert.equal(rejected.state, DASHBOARD_FEED_STATES.ERROR);
  assert.equal(rejected.errors.length, 2);
  assert.ok(rejected.errors.some(error => error.startsWith('status/sovereign-commander-maintenance-custody-other.json:')));
  assert.ok(rejected.errors.some(error => error.startsWith('proof/sovereign-commander-maintenance-custody.json:')));
});

test('live feed observes the clock after asynchronous record reads and retains explicit future refusal', async t => {
  const start = Date.parse('2026-07-07T00:00:00.000Z');
  const root = await tempWorkspace();
  await writeJson(root, 'status', 'status-current.json', createSharedWorkspaceStatusRecord({
    statusId: 'workspace-current', timestampUtc: new Date(start + 90000).toISOString(), status: 'CURRENT',
  }));
  t.mock.timers.enable({ apis: ['Date'], now: start });
  const reading = readSharedWorkspaceDashboardFeed({ root });
  t.mock.timers.tick(90000);
  const live = await reading;
  assert.equal(live.state, DASHBOARD_FEED_STATES.READY, 'a record read after admission was called future-dated');
  const frozen = await readSharedWorkspaceDashboardFeed({ root, nowMs: start });
  assert.equal(frozen.state, DASHBOARD_FEED_STATES.STALE, 'an explicit observation snapshot must stay strict');
  await writeJson(root, 'status', 'status-current.json', createSharedWorkspaceStatusRecord({
    statusId: 'workspace-current', timestampUtc: new Date(start + 180000).toISOString(), status: 'CURRENT',
  }));
  const future = await readSharedWorkspaceDashboardFeed({ root });
  assert.equal(future.state, DASHBOARD_FEED_STATES.STALE, 'genuinely future-dated evidence must remain refused');
});
