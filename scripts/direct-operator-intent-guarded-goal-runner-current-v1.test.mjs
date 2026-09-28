import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDirectOperatorIntentStandingAuthorityV1 } from '../shared/agents/directOperatorIntentStandingAuthorityV1.mjs';
import { createSharedWorkspaceGoalRecord } from '../shared/agents/sharedAgentWorkspaceStore.mjs';
import {
  DIRECT_OPERATOR_INTENT_AUTHORITY_CURRENT_RELATIVE_PATH,
  GUARDED_GOAL_RUNNER_PR_CURRENT_RELATIVE_PATH,
  SUPERVISOR_CURRENT_RELATIVE_PATH,
  runGuardedGoalRunnerCurrent,
} from './guarded-goal-runner-current.mjs';

const head = 'baad917bebc836004b4f5665c0099fade8ae04cc';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function writeJson(root, relativePath, value) {
  const file = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
  return file;
}

function supervisor() {
  return {
    currentPhase: 'ready',
    trafficLight: 'green',
    services: {
      backend8787: { ready: true },
      openClaw18789: { ready: true },
      stephanosUi4173: { ready: true, servedRuntimeProof: { ready: true, currentHead: head, expectedHead: head } },
    },
  };
}

function prProof() {
  return {
    issue: 1497,
    publicationState: 'published',
    prNumber: 1497,
    prUrl: 'https://github.com/example/repo/pull/1497',
    baseBranch: 'main',
    baseSha: 'd7fb4c67bfd6e15f25507150373ecc4d5fd00e0c',
    expectedBaseSha: 'd7fb4c67bfd6e15f25507150373ecc4d5fd00e0c',
    headSha: head,
    expectedHeadSha: head,
    mergeable: true,
    conflicting: false,
    draft: false,
    changedFiles: { count: 1 },
    testsRun: { allGreen: true },
    operatorApprovalRequired: true,
  };
}

function receipt() {
  return buildDirectOperatorIntentStandingAuthorityV1({
    requestId: 'request-001',
    goalId: 'goal-1497',
    originSurface: 'chatgpt',
    intent: 'Complete the bounded request through the protected path and guarded live update without repeating my decision.',
  });
}

test('current runner consumes direct-request provenance from the exact canonical goal record', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'direct-intent-current-'));
  try {
    writeJson(workspace, SUPERVISOR_CURRENT_RELATIVE_PATH, supervisor());
    writeJson(workspace, GUARDED_GOAL_RUNNER_PR_CURRENT_RELATIVE_PATH, prProof());
    const goalRecord = createSharedWorkspaceGoalRecord({
      goalId: 'goal-1497',
      participantId: 'chatgpt-bridge',
      timestampUtc: '2026-09-28T13:54:00.000Z',
      title: 'Bounded direct request',
      status: 'READY',
      directOperatorIntentAuthority: receipt(),
    });
    const goalPath = writeJson(workspace, path.join('goals', 'goal-1497.json'), goalRecord);
    const { packet } = runGuardedGoalRunnerCurrent({ repoRoot, sharedWorkspaceRoot: workspace, currentHead: head, now: '2026-09-28T13:55:00.000Z' });
    assert.equal(packet.safeToMerge, true);
    assert.equal(packet.allowedNextStep, 'stop-and-report');
    assert.equal(packet.directOperatorIntentAuthorityPath, goalPath);
    assert.match(packet.nextOperatorAction, /external exact-head guarded merge step/i);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('legacy loose authority sidecar is ignored and cannot mint protected continuation', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'direct-intent-sidecar-'));
  try {
    writeJson(workspace, SUPERVISOR_CURRENT_RELATIVE_PATH, supervisor());
    writeJson(workspace, GUARDED_GOAL_RUNNER_PR_CURRENT_RELATIVE_PATH, prProof());
    writeJson(workspace, DIRECT_OPERATOR_INTENT_AUTHORITY_CURRENT_RELATIVE_PATH, receipt());
    const { packet } = runGuardedGoalRunnerCurrent({ repoRoot, sharedWorkspaceRoot: workspace, currentHead: head, now: '2026-09-28T13:55:00.000Z' });
    assert.equal(packet.safeToMerge, true);
    assert.equal(packet.allowedNextStep, 'stop-and-report');
    assert.equal(packet.directOperatorIntentAuthorityPath, null);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
