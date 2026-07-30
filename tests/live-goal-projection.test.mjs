import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBuildConciergeGoalRequest, readBuildConciergeGoalReceipts } from '../stephanos-server/services/buildConciergeGoalService.js';
import { buildLiveDashboardGoals, buildLiveGoalProjection, readLiveGoalProjection } from '../stephanos-server/services/liveGoalProjectionService.js';
import { readMissionOperations } from '../stephanos-server/services/missionOperationsService.js';

async function tempDir() { return mkdtemp(join(tmpdir(), 'stephanos-live-goal-projection-')); }

test('backend live projection route contract returns schema-valid projection with backend freshness', async () => {
  const projection = await readLiveGoalProjection({
    missionOperationsOptions: { directory: await tempDir() },
    buildConciergeGoals: { receipts: [], candidates: [] },
    updateStatus: { nextOperatorAction: 'Workspace current.' },
    backendStatus: { status: 'live', ok: true, healthRoute: '/api/health', freshness: 'test' },
    now: new Date('2026-07-02T00:00:00.000Z'),
  });
  assert.equal(projection.schemaVersion, 'stephanos.live-goal-projection.v1');
  assert.equal(projection.backendStatus.healthRoute, '/api/health');
  assert.equal(projection.commandExecutionAllowed, false);
  assert.equal(projection.mergeAllowed, false);
  assert.equal(projection.codexDispatchAllowed, false);
});

test('projection aggregates Build Concierge queue state and created goal receipts', async () => {
  const directory = await tempDir();
  await createBuildConciergeGoalRequest({ title: 'Live projection goal', intent: 'Queue without proof claims.', priority: 'high', requestedBy: 'Stephan', sourceSurface: 'Mission Control' }, { directory, now: new Date('2026-07-02T00:00:00.000Z') });
  const goals = await readBuildConciergeGoalReceipts({ directory });
  const projection = buildLiveGoalProjection({
    now: new Date('2026-07-02T00:00:01.000Z'),
    backendStatus: { status: 'live', ok: true, healthRoute: '/api/health' },
    missionOperationsFeed: { status: 'ready', source: 'external-receipt-directory', missions: [], errors: [] },
    buildConcierge: { createdGoalReceipts: goals.receipts },
    createdGoalCandidates: goals.candidates,
  });
  assert.equal(projection.sourceTruth, 'live');
  assert.equal(projection.queuedGoalCount, 1);
  assert.equal(projection.queuedCandidates[0].title, 'Live projection goal');
  assert.equal(projection.queuedCandidates[0].createdAt, '2026-07-02T00:00:00.000Z');
  assert.equal(projection.queuedCandidates[0].updatedAt, '2026-07-02T00:00:00.000Z');
  assert.equal(projection.receipts[0].receiptType, 'build-concierge-goal-create');
  assert.equal(projection.dashboardGoals.cards[0].lastUpdatedAt, '2026-07-02T00:00:00.000Z');
});

test('projection does not claim GitHub local or browser proof without receipts', () => {
  const projection = buildLiveGoalProjection({
    backendStatus: { status: 'live', ok: true, healthRoute: '/api/health' },
    missionOperationsFeed: { status: 'empty', source: 'external-receipt-directory', missions: [], errors: [], projectionSource: 'static-goal-dashboard-seed', githubTruth: 'not-live-readonly-static-seed' },
    buildConcierge: {},
  });
  assert.equal(projection.proofTruth.github, 'unknown');
  assert.equal(projection.proofTruth.local, 'unknown');
  assert.equal(projection.proofTruth.browser, 'unknown');
  assert.equal(projection.currentAgentStates.github.state, 'adapter_unavailable');
  assert.equal(projection.staleWarnings.includes('Static goal-dashboard seed is not presented as live truth.'), true);
  assert.equal(projection.dashboardGoals.sourceTruth, 'UNKNOWN');
});

test('dashboard goal cards use current GitHub issues and linked PR checks instead of stale seed data', () => {
  const dashboardGoals = buildLiveDashboardGoals({
    observedAt: '2026-07-30T10:00:00.000Z',
    githubTelemetry: {
      adapterAvailable: true,
      issueInventoryObserved: true,
      issueInventoryComplete: true,
      pullRequestInventoryComplete: true,
      issues: [
        { number: 1622, title: 'Canonical programme controller', state: 'open', labels: ['goal', 'P0'], updatedAt: '2026-07-30T09:00:00.000Z', url: 'https://github.com/example/repo/issues/1622' },
        { number: 1497, title: 'Guarded continuous repair', state: 'open', labels: ['goal'], updatedAt: '2026-07-30T08:00:00.000Z', url: 'https://github.com/example/repo/issues/1497' },
      ],
      pullRequests: [
        { number: 1623, relatedIssues: [1622], checksStatus: 'passed', approvalStatus: 'unknown', headSha: 'a'.repeat(40), branch: 'feat/controller', url: 'https://github.com/example/repo/pull/1623', updatedAt: '2026-07-30T09:30:00.000Z' },
        { number: 1621, relatedIssues: [1497], checksStatus: 'failed', approvalStatus: 'unknown', headSha: 'b'.repeat(40), branch: 'feat/repair', url: 'https://github.com/example/repo/pull/1621', updatedAt: '2026-07-30T09:15:00.000Z' },
      ],
    },
  });

  assert.equal(dashboardGoals.sourceTruth, 'LIVE READ-ONLY GITHUB');
  assert.equal(dashboardGoals.cards[0].issue, '#1622');
  assert.equal(dashboardGoals.cards[0].status, 'READY FOR REVIEW');
  assert.equal(dashboardGoals.cards[0].proofTruth.browser, 'unknown');
  assert.equal(dashboardGoals.cards[1].status, 'BLOCKED');
  assert.match(dashboardGoals.cards[1].nextAction, /Repair failing checks/);
  assert.equal(dashboardGoals.blockedCount, 1);
  assert.equal(dashboardGoals.readyCount, 1);
});

test('dashboard goal cards fall back to bounded current receipts without claiming GitHub truth', () => {
  const dashboardGoals = buildLiveDashboardGoals({
    observedAt: '2026-07-30T10:00:00.000Z',
    githubTelemetry: { adapterAvailable: false },
    queue: { queuedCandidates: [{ candidateId: 'goal-receipt-1', title: 'Receipt goal', state: 'QUEUED', nextAction: 'Wait for canonical dispatch.' }] },
  });
  assert.equal(dashboardGoals.sourceTruth, 'READ-ONLY RECEIPTS');
  assert.equal(dashboardGoals.cards[0].sourceTruth, 'READ-ONLY RECEIPT');
  assert.equal(dashboardGoals.cards[0].proofTruth.github, 'unknown');
});

test('dashboard conservatively aggregates every unsuperseded PR linked to one goal', () => {
  const dashboardGoals = buildLiveDashboardGoals({
    observedAt: '2026-07-30T10:00:00.000Z',
    githubTelemetry: {
      adapterAvailable: true,
      issueInventoryObserved: true,
      issueInventoryComplete: true,
      pullRequestInventoryComplete: true,
      issues: [{ number: 1650, title: 'Goal with parallel PR history', state: 'open', updatedAt: '2026-07-30T09:00:00.000Z' }],
      pullRequests: [
        { number: 1651, relatedIssues: [1650], checksStatus: 'passed', headSha: 'a'.repeat(40), updatedAt: '2026-07-30T09:30:00.000Z', url: 'https://github.com/example/repo/pull/1651' },
        { number: 1652, relatedIssues: [1650], checksStatus: 'failed', headSha: 'b'.repeat(40), updatedAt: '2026-07-30T08:30:00.000Z', url: 'https://github.com/example/repo/pull/1652' },
        { number: 1653, relatedIssues: [1650], checksStatus: 'failed', supersededStatus: 'superseded', headSha: 'c'.repeat(40), updatedAt: '2026-07-30T08:00:00.000Z' },
      ],
    },
  });
  assert.equal(dashboardGoals.cards.length, 1);
  assert.equal(dashboardGoals.cards[0].status, 'BLOCKED');
  assert.deepEqual(dashboardGoals.cards[0].linkedPullRequests.map((pr) => pr.number), [1651, 1652]);
  assert.equal(dashboardGoals.cards[0].linkedPr.number, 1652);
  assert.equal(dashboardGoals.activePrCount, 2);
  assert.equal(dashboardGoals.readyCount, 0);
  assert.match(dashboardGoals.cards[0].nextAction, /#1651, #1652/);
  assert.match(dashboardGoals.cards[0].nextAction, /Repair failing checks on PR #1652/);
});

test('dashboard surfaces open PRs without a durable issue link as an explicit blocker', () => {
  const dashboardGoals = buildLiveDashboardGoals({
    observedAt: '2026-07-30T10:00:00.000Z',
    githubTelemetry: {
      adapterAvailable: true,
      issueInventoryObserved: true,
      issueInventoryComplete: true,
      pullRequestInventoryComplete: true,
      issues: [],
      pullRequests: [{ number: 1700, title: 'Unlinked implementation', relatedIssues: [], checksStatus: 'passed', approvalStatus: 'unknown', headSha: 'c'.repeat(40), url: 'https://github.com/example/repo/pull/1700' }],
    },
  });
  assert.equal(dashboardGoals.cards[0].status, 'BLOCKED · DURABLE GOAL LINK UNKNOWN');
  assert.match(dashboardGoals.cards[0].nextAction, /durable GitHub goal issue/);
  assert.equal(dashboardGoals.activePrCount, 1);
  assert.equal(dashboardGoals.blockedCount, 1);
});

test('GitHub review approval never fabricates runtime proof or exact-head operator approval', () => {
  const dashboardGoals = buildLiveDashboardGoals({
    observedAt: '2026-07-30T10:00:00.000Z',
    githubTelemetry: {
      adapterAvailable: true,
      issueInventoryObserved: true,
      issueInventoryComplete: true,
      pullRequestInventoryComplete: true,
      issues: [{ number: 1800, title: 'Goal: reviewed change', state: 'open', labels: ['goal'], updatedAt: '2026-07-30T09:00:00.000Z' }],
      pullRequests: [{ number: 1801, relatedIssues: [1800], checksStatus: 'passed', approvalStatus: 'approved', headSha: 'd'.repeat(40) }],
    },
  });
  assert.equal(dashboardGoals.cards[0].status, 'REVIEW PASSED · RUNTIME PROOF UNKNOWN');
  assert.equal(dashboardGoals.cards[0].proofIndex, 5);
  assert.equal(dashboardGoals.cards[0].operatorNeeded, 'No');
  assert.match(dashboardGoals.cards[0].nextAction, /does not grant operator approval/);
});

test('passing exact-head checks never promote a draft PR out of building state', () => {
  const dashboardGoals = buildLiveDashboardGoals({
    observedAt: '2026-07-30T10:00:00.000Z',
    githubTelemetry: {
      adapterAvailable: true,
      issueInventoryObserved: true,
      issueInventoryComplete: true,
      pullRequestInventoryComplete: true,
      issues: [{ number: 1810, title: 'Goal: draft build', state: 'open', labels: ['goal'], updatedAt: '2026-07-30T09:00:00.000Z' }],
      pullRequests: [{ number: 1811, relatedIssues: [1810], draft: true, checksStatus: 'passed', approvalStatus: 'unknown', headSha: 'e'.repeat(40) }],
    },
  });
  assert.equal(dashboardGoals.cards[0].status, 'BUILDING');
  assert.equal(dashboardGoals.readyCount, 0);
  assert.match(dashboardGoals.cards[0].nextAction, /draft PR #1811/);
  assert.match(dashboardGoals.cards[0].nextAction, /do not declare it ready/);
});

test('GitHub adapter availability without an observed issue inventory cannot claim current goal truth', () => {
  const dashboardGoals = buildLiveDashboardGoals({
    observedAt: '2026-07-30T10:00:00.000Z',
    githubTelemetry: {
      adapterAvailable: true,
      issueInventoryObserved: false,
      issues: [],
      pullRequests: [{ number: 1900, title: 'Unscoped PR', relatedIssues: [] }],
    },
  });
  assert.equal(dashboardGoals.sourceTruth, 'UNKNOWN');
  assert.deepEqual(dashboardGoals.cards, []);
});

test('incomplete GitHub inventories fail closed instead of claiming a current goal estate', () => {
  const dashboardGoals = buildLiveDashboardGoals({
    observedAt: '2026-07-30T10:00:00.000Z',
    githubTelemetry: {
      adapterAvailable: true,
      issueInventoryObserved: true,
      issueInventoryComplete: false,
      pullRequestInventoryComplete: true,
      issues: [{ number: 2000, title: 'Only the first page', state: 'open' }],
      pullRequests: [],
    },
  });
  assert.equal(dashboardGoals.sourceTruth, 'UNKNOWN');
  assert.deepEqual(dashboardGoals.cards, []);
});

test('imported historical candidates remain explicit references and never become current receipt cards', () => {
  const dashboardGoals = buildLiveDashboardGoals({
    observedAt: '2026-07-30T10:00:00.000Z',
    githubTelemetry: { adapterAvailable: false },
    queue: { queuedCandidates: [{ candidateId: 'queue-relabelled-1', title: 'Old imported goal', state: 'QUEUED' }] },
    historicalCandidates: [{ candidateId: 'historical-1', title: 'Old imported goal', importedAt: '2026-06-01T00:00:00.000Z' }],
  });
  assert.equal(dashboardGoals.sourceTruth, 'UNKNOWN');
  assert.deepEqual(dashboardGoals.cards, []);
  assert.equal(dashboardGoals.historicalReferenceCount, 1);
  assert.equal(dashboardGoals.historicalReferences[0].verificationState, 'imported_unverified');
  assert.match(dashboardGoals.nextAction, /excluded from current cards/);
});

test('goal ingestion imports unfinished pasted goals as history without projecting current queue or execution authority', async () => {
  const { importGoalSummaries, readImportedGoalReceipts } = await import('../stephanos-server/services/goalIngestionService.js');
  const directory = await tempDir();
  const payload = { goals: [{ title: 'Historical Mission Control API', intent: 'Add backend API projection for old goals.', source: 'operator-paste', status: 'blocked', lastKnownPR: '#123', blockers: ['needs proof'], nextAction: 'Inspect receipts.' }] };
  const first = await importGoalSummaries(payload, { directory, now: new Date('2026-07-02T00:00:00.000Z') });
  const second = await importGoalSummaries(payload, { directory, now: new Date('2026-07-02T00:00:01.000Z') });
  assert.equal(first.imported.length, 1);
  assert.equal(second.duplicates.length, 1);
  const importedGoals = await readImportedGoalReceipts({ directory });
  const projection = buildLiveGoalProjection({
    now: new Date('2026-07-02T00:00:02.000Z'),
    backendStatus: { status: 'live', ok: true, healthRoute: '/api/health' },
    missionOperationsFeed: { status: 'ready', source: 'external-receipt-directory', missions: [], errors: [] },
    buildConcierge: {
      queue: {
        status: 'implemented_guarded',
        queuedCandidates: importedGoals.candidates,
        activeProofLane: importedGoals.candidates,
        blockedCandidates: importedGoals.candidates,
        completedCandidates: importedGoals.candidates,
        rejectedCandidates: importedGoals.candidates,
        nextSafeCandidate: importedGoals.candidates[0],
        blockers: ['Imported history must not become a current blocker.'],
      },
      executionEngine: { watchedGoalCount: 99, classifiedGoalCount: 99, blockers: ['Imported history drove this engine.'] },
    },
    executionEngine: { watchedGoalCount: 100, classifiedGoalCount: 100 },
    importedGoals,
  });
  assert.equal(projection.importedGoals.verificationState, 'imported_unverified');
  assert.deepEqual(projection.queuedCandidates, []);
  assert.equal(projection.totalGoals, 0);
  assert.equal(projection.heartbeat.watchedGoals, 0);
  assert.equal(projection.executionEngine.watchedGoalCount, 0);
  assert.equal(projection.executionEngine.classifiedGoalCount, 0);
  assert.deepEqual(projection.executionChains, []);
  assert.deepEqual(projection.receipts, []);
  assert.equal(projection.blockers.includes('Imported history must not become a current blocker.'), false);
  assert.equal(projection.blockers.includes('Imported history drove this engine.'), false);
  assert.equal(projection.dashboardGoals.sourceTruth, 'UNKNOWN');
  assert.deepEqual(projection.dashboardGoals.cards, []);
  assert.equal(projection.dashboardGoals.historicalReferenceCount, 1);
  assert.equal(projection.sourceTruth, 'mixed');
  assert.equal(projection.proofTruth.github, 'unknown');
  assert.equal(projection.proofTruth.local, 'unknown');
  assert.equal(projection.proofTruth.browser, 'unknown');

  const missionFeed = await readMissionOperations({
    directory,
    now: new Date('2026-07-02T00:00:03.000Z'),
    buildConciergeGoals: { receipts: [], candidates: [] },
    importedGoals,
    updateStatus: {},
  });
  assert.equal(missionFeed.status, 'empty');
  assert.deepEqual(missionFeed.buildConcierge.queue.queuedCandidates, []);
  assert.equal(missionFeed.buildConcierge.executionEngine.watchedGoalCount, 0);
  assert.equal(missionFeed.buildConcierge.importedGoals.candidates.length, 1);
});
