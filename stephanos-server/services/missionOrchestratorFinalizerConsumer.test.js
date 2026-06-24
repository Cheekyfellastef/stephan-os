import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { createMissionRecord } from './missionOrchestratorStore.js';
import { processNextVerificationItem } from './missionOrchestratorFinalizerConsumer.js';

const intent = {
  missionId: 'mission-finalizer-consumer',
  operatorIntent: 'Implement and deploy a bounded change.',
  intendedOutcome: 'The merged change is locally synchronized, built, verified, and restarted.',
  missionKind: 'implementation',
  repository: 'Cheekyfellastef/stephan-os',
  repositoryRoot: 'C:\\repo',
  branch: 'openclaw/mission-finalizer-consumer',
  worktreePath: 'C:\\worktree',
  allowedFiles: ['shared/agents/**'],
  requiredEvidence: ['focused test output'],
  requiredTests: ['node --test focused.test.mjs'],
};

async function runtime() {
  const parent = await mkdtemp(join(tmpdir(), 'mission-finalizer-consumer-'));
  return { root: join(parent, 'state'), snapshotRoot: join(parent, 'proof'), queueRoot: join(parent, 'queue'), now: new Date('2026-06-24T23:58:00.000Z') };
}

async function queue(options, adapter, action) {
  const pending = join(options.queueRoot, adapter, 'pending');
  await mkdir(pending, { recursive: true });
  await writeFile(join(pending, `${action.actionId}.json`), `${JSON.stringify({ schemaVersion: 'stephanos.mission-worker-queue-item.v1', adapter, actionId: action.actionId, missionId: action.missionId, payload: action })}\n`, 'utf8');
}

test('verification blocks the mission when deterministic evidence is missing', async () => {
  const options = await runtime();
  const created = await createMissionRecord(intent, options);
  const state = {
    ...created.state,
    currentPhase: 'VERIFYING',
    blockers: [],
    git: { ...created.state.git, worktreeReady: true },
    dispatch: { ...created.state.dispatch, status: 'complete', startedAt: created.state.createdAt, completedAt: created.state.createdAt },
  };
  await writeFile(created.statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await queue(options, 'verification', { actionKind: 'evidence-judgment', actionId: 'verification-action-001', missionId: intent.missionId, requiredEvidence: intent.requiredEvidence, receipts: [] });
  const processed = await processNextVerificationItem(options);
  assert.equal(processed.processed, true);
  assert.equal(processed.judgment.success, false);
  assert.equal(processed.applied.state.currentPhase, 'BLOCKED');
  assert.match(processed.applied.state.blockers.join(' '), /focused test output/);
  assert.match(processed.resultPath.replace(/\\/g, '/'), /\/failed\//);
});
