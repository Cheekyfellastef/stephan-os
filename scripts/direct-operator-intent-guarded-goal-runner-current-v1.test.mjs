import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDirectOperatorIntentStandingAuthorityV1 } from '../shared/agents/directOperatorIntentStandingAuthorityV1.mjs';
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

test('current runner consumes the durable direct-request receipt and routes forward without a new click', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'direct-intent-current-'));
  try {
    writeJson(workspace, SUPERVISOR_CURRENT_RELATIVE_PATH, supervisor());
    writeJson(workspace, GUARDED_GOAL_RUNNER_PR_CURRENT_RELATIVE_PATH, prProof());
    const receipt = buildDirectOperatorIntentStandingAuthorityV1({
      requestId: 'request-001',
      goalId: 'goal-1497',
      originSurface: 'chatgpt',
      intent: 'Complete the bounded request through the protected path and guarded live update without repeating my decision.',
    });
    const receiptPath = writeJson(workspace, DIRECT_OPERATOR_INTENT_AUTHORITY_CURRENT_RELATIVE_PATH, receipt);
    const { packet } = runGuardedGoalRunnerCurrent({ repoRoot, sharedWorkspaceRoot: workspace, currentHead: head, now: '2026-09-28T13:55:00.000Z' });
    assert.equal(packet.safeToMerge, true);
    assert.equal(packet.allowedNextStep, 'route-to-protected-merge-controller');
    assert.equal(packet.directOperatorIntentAuthorityPath, receiptPath);
    assert.match(packet.nextOperatorAction, /route automatically/i);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
