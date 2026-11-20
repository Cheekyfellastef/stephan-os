import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createBuildConciergeGoalRequest,
  readBuildConciergeGoalReceipts,
  validateBuildConciergeGoalRequest,
} from '../stephanos-server/services/buildConciergeGoalService.js';
import { readMissionOperations } from '../stephanos-server/services/missionOperationsService.js';
import { buildGoalDashboardStatusProjection } from '../shared/runtime/goalDashboardStatusProjection.mjs';

async function tempDir() {
  return mkdtemp(join(tmpdir(), 'stephanos-build-concierge-'));
}

test('valid goal create request writes durable receipt', async () => {
  const directory = await tempDir();
  const result = await createBuildConciergeGoalRequest({
    title: 'Harden launcher truth',
    intent: 'Queue a safe implementation goal for operator review.',
    priority: 'high',
    requestedBy: 'Stephan',
    sourceSurface: 'Mission Dashboard',
  }, { directory, now: new Date('2026-07-02T00:00:00.000Z') });

  assert.equal(result.status, 201);
  assert.equal(result.receipt.commandExecutionAllowed, false);
  assert.equal(result.receipt.mergeAllowed, false);
  const persisted = JSON.parse(await readFile(result.receipt.path, 'utf8'));
  assert.equal(persisted.schemaVersion, 'stephanos.build-concierge.goal-request.v1');
  assert.equal(persisted.goal.title, 'Harden launcher truth');
});

test('invalid request with command/path/secret/approval token is rejected', () => {
  for (const body of [
    { title: 'Run command', intent: 'please npm run stephanos:verify', priority: 'normal', requestedBy: 'Stephan', sourceSurface: 'Mission Dashboard' },
    { title: 'Read path', intent: 'inspect /etc/passwd', priority: 'normal', requestedBy: 'Stephan', sourceSurface: 'Mission Dashboard' },
    { title: 'Secret', intent: 'use API_KEY abc', priority: 'normal', requestedBy: 'Stephan', sourceSurface: 'Mission Dashboard' },
    { title: 'Token', intent: 'approval token APPROVE_PR_1402_deadbeef', priority: 'normal', requestedBy: 'Stephan', sourceSurface: 'Mission Dashboard' },
  ]) {
    const validation = validateBuildConciergeGoalRequest(body);
    assert.equal(validation.ok, false);
    assert.match(validation.errors.join('\n'), /blocked command, path, secret, merge, or approval-token text/);
  }
});

test('created goal becomes queued candidate and projects into Mission Operations and Goal Dashboard', async () => {
  const directory = await tempDir();
  const created = await createBuildConciergeGoalRequest({
    title: 'Queue operator-safe goal',
    intent: 'Create a candidate without dispatching Codex.',
    priority: 'normal',
    requestedBy: 'Stephan',
    sourceSurface: 'Mission Operations',
  }, { directory, now: new Date('2026-07-02T00:00:00.000Z') });
  assert.equal(created.queue.queuedCandidates[0].candidateType, 'goal');
  assert.equal(created.queue.queuedCandidates[0].safeToProof, false);

  const receipts = await readBuildConciergeGoalReceipts({ directory });
  const feed = await readMissionOperations({
    directory: await tempDir(),
    buildConciergeGoals: receipts,
    updateStatus: { nextOperatorAction: 'none' },
    now: new Date('2026-07-02T00:00:01.000Z'),
  });
  assert.equal(feed.buildConcierge.createdGoalReceipts[0].receiptId, created.receipt.receiptId);
  assert.equal(feed.buildConcierge.queue.queuedCandidates[0].candidateId, created.candidate.candidateId);

  const dashboard = buildGoalDashboardStatusProjection({
    buildConcierge: { liveAdapter: { available: true }, createdGoalCandidates: receipts.candidates },
  });
  assert.equal(dashboard.buildConcierge.liveAdapter.status, 'available');
  assert.equal(dashboard.buildConcierge.queue.queuedCandidates[0].title, 'Queue operator-safe goal');
});

test('Goal Dashboard projection exposes exact blocker text when live adapter unavailable', () => {
  const dashboard = buildGoalDashboardStatusProjection({ buildConcierge: {} });
  assert.equal(dashboard.buildConcierge.liveAdapter.status, 'blocked_unavailable');
  assert.match(dashboard.buildConcierge.liveAdapter.blockerText, /backend route \/api\/build-concierge\/goals/);
});
