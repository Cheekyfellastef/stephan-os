import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBuildConciergeGoalRequest, readBuildConciergeGoalReceipts } from '../stephanos-server/services/buildConciergeGoalService.js';
import { buildLiveGoalProjection, readLiveGoalProjection } from '../stephanos-server/services/liveGoalProjectionService.js';

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
  assert.equal(projection.receipts[0].receiptType, 'build-concierge-goal-create');
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
});

test('goal ingestion imports unfinished pasted goals, dedupes, and projects imported_unverified V9 candidates', async () => {
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
    importedGoals,
  });
  assert.equal(projection.importedGoals.verificationState, 'imported_unverified');
  assert.equal(projection.queuedCandidates[0].title, 'Historical Mission Control API');
  assert.equal(projection.executionEngine.watchedGoalCount, 1);
  assert.equal(projection.executionEngine.classifiedGoalCount, 1);
  assert.equal(projection.executionEngine.enrichedCandidates[0].dispatchReadiness, 'MANUAL_DISPATCH_REQUIRED');
  assert.equal(projection.proofTruth.github, 'unknown');
  assert.equal(projection.proofTruth.local, 'unknown');
  assert.equal(projection.proofTruth.browser, 'unknown');
});
