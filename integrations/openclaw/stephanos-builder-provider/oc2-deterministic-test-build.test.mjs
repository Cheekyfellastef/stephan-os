import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';

import {
  OPENCLAW_OC2_FIXED_PLAN,
  OPENCLAW_OC2_OPERATION,
  OPENCLAW_OC2_TASK_CLASS,
  executeClaimedOpenClawOc2DeterministicTestBuild,
  validateOpenClawOc2QualificationContext,
} from './lib/oc2-deterministic-test-build.mjs';

const HEAD = 'a'.repeat(40);
const MISSION = 'openclaw-oc2-mission';
const TASK = 'openclaw-oc2-task-0001';

function fixture(overrides = {}) {
  const action = {
    schemaVersion: 'stephanos.mission-worker-action.v1',
    missionId: MISSION,
    actionId: TASK,
    actionKind: 'agent-handoff',
    adapter: 'openclaw-readonly',
    operation: OPENCLAW_OC2_OPERATION,
    executable: true,
    repository: 'Cheekyfellastef/stephan-os',
  };
  const item = {
    schemaVersion: 'stephanos.mission-worker-queue-item.v1',
    adapter: 'openclaw-readonly',
    missionId: MISSION,
    actionId: TASK,
    payload: action,
  };
  const processing = path.resolve('/queue/openclaw-readonly/processing');
  const claim = {
    adapter: 'openclaw-readonly',
    item,
    processingPath: path.resolve(processing, `${TASK}.json`),
    paths: { processing },
  };
  const grant = {
    schemaVersion: 'stephanos.mission-worker-action-grant.v1',
    grantId: `grant-${TASK}`,
    sourceRevision: HEAD,
    missionId: MISSION,
    actionId: TASK,
    actionKind: 'agent-handoff',
    adapter: 'openclaw-readonly',
    operation: OPENCLAW_OC2_OPERATION,
    issueNumber: 1725,
    repository: 'Cheekyfellastef/stephan-os',
    boundedActionCount: 1,
    mergeAuthority: false,
    leaseSeizureAllowed: false,
    ...overrides,
  };
  return { action, item, claim, grant, ...overrides };
}

function qualificationInput(parts) {
  return {
    action: parts.action,
    claim: parts.claim,
    actionGrant: parts.grant,
    taskClass: OPENCLAW_OC2_TASK_CLASS,
    goalId: '#1725',
    taskId: TASK,
    providerVersion: '1.0.0',
    requestedSourceHead: HEAD,
  };
}

test('OC2 admits only the exact canonical claimed action and fixed operation', async () => {
  const parts = fixture();
  const valid = await validateOpenClawOc2QualificationContext(qualificationInput(parts), {
    readFileFn: async () => JSON.stringify(parts.item),
  });
  assert.equal(valid.success, true);
  assert.deepEqual(valid.task.testPlanIds, OPENCLAW_OC2_FIXED_PLAN.map((entry) => entry.testId));
  assert.equal(valid.task.arbitraryCommandAuthority, false);

  const wrong = fixture();
  wrong.grant.operation = 'caller-command';
  wrong.action.operation = 'caller-command';
  const rejected = await validateOpenClawOc2QualificationContext(qualificationInput(wrong), {
    readFileFn: async () => JSON.stringify(wrong.item),
  });
  assert.equal(rejected.success, false);
  assert.equal(rejected.error, 'OPENCLAW_OC2_GRANT_INVALID');
});

test('OC2 executes only fixed node test IDs and proves source state unchanged', async () => {
  const parts = fixture();
  const userProfile = '/tmp/stephanos-oc2-user';
  const repoRoot = path.resolve(userProfile, 'Documents', 'GitHub', 'stephan-os');
  const calls = [];
  const status = ' M apps/stephanos/dist/index.html\n';
  const spawnSyncFn = (executable, args, options) => {
    calls.push({ executable, args: [...args], options });
    if (String(executable).toLowerCase().endsWith('git.exe')) {
      const key = args.join(' ');
      if (key === 'rev-parse --show-toplevel') return { status: 0, stdout: `${repoRoot}\n`, stderr: '' };
      if (key === 'remote get-url origin') return { status: 0, stdout: 'https://github.com/Cheekyfellastef/stephan-os.git\n', stderr: '' };
      if (key === 'rev-parse --abbrev-ref HEAD') return { status: 0, stdout: 'main\n', stderr: '' };
      if (key === 'rev-parse HEAD') return { status: 0, stdout: `${HEAD}\n`, stderr: '' };
      if (key === 'status --porcelain=v1 --untracked-files=all') return { status: 0, stdout: status, stderr: '' };
      return { status: 1, stdout: '', stderr: 'unexpected git operation' };
    }
    return { status: 0, stdout: 'ok\n', stderr: '' };
  };
  const writes = [];
  const result = await executeClaimedOpenClawOc2DeterministicTestBuild(parts.action, parts.claim, {
    actionGrant: parts.grant,
    taskClass: OPENCLAW_OC2_TASK_CLASS,
    goalId: '#1725',
    providerVersion: '1.0.0',
    requestedSourceHead: HEAD,
    providerInstance: 'openclaw-gateway:4242',
    platform: 'win32',
    env: { USERPROFILE: userProfile },
    existsSyncFn: () => true,
    spawnSyncFn,
    readFileFn: async () => JSON.stringify(parts.item),
    ensureSharedWorkspaceLayoutFn: async () => ({ ok: true }),
    writeAtomicJsonFn: async (_root, segments, record) => {
      writes.push({ segments, record });
      return { ok: true };
    },
    now: new Date('2026-08-21T00:00:00.000Z'),
  });

  assert.equal(result.success, true);
  assert.equal(result.qualificationEligible, true);
  assert.deepEqual(result.changedFiles, []);
  assert.equal(result.receipt.verified, true);
  assert.equal(result.evidenceReceipts.length, 1);
  assert.equal(writes.length, 2);
  const nodeCalls = calls.filter((call) => String(call.executable).toLowerCase().endsWith('node.exe'));
  assert.deepEqual(nodeCalls.map((call) => call.args), OPENCLAW_OC2_FIXED_PLAN.map((plan) => [...plan.args]));
  assert.ok(nodeCalls.every((call) => call.options.shell === false));
});

test('OC2 fails closed if a fixed test changes repository source state', async () => {
  const parts = fixture();
  const userProfile = '/tmp/stephanos-oc2-dirty';
  const repoRoot = path.resolve(userProfile, 'Documents', 'GitHub', 'stephan-os');
  let statusReads = 0;
  const spawnSyncFn = (executable, args) => {
    if (String(executable).toLowerCase().endsWith('git.exe')) {
      const key = args.join(' ');
      if (key === 'rev-parse --show-toplevel') return { status: 0, stdout: `${repoRoot}\n`, stderr: '' };
      if (key === 'remote get-url origin') return { status: 0, stdout: 'https://github.com/Cheekyfellastef/stephan-os.git\n', stderr: '' };
      if (key === 'rev-parse --abbrev-ref HEAD') return { status: 0, stdout: 'main\n', stderr: '' };
      if (key === 'rev-parse HEAD') return { status: 0, stdout: `${HEAD}\n`, stderr: '' };
      if (key === 'status --porcelain=v1 --untracked-files=all') {
        statusReads += 1;
        return { status: 0, stdout: statusReads === 1 ? '' : ' M shared/agents/unsafe.mjs\n', stderr: '' };
      }
    }
    return { status: 0, stdout: 'ok\n', stderr: '' };
  };
  const result = await executeClaimedOpenClawOc2DeterministicTestBuild(parts.action, parts.claim, {
    actionGrant: parts.grant,
    taskClass: OPENCLAW_OC2_TASK_CLASS,
    goalId: '#1725',
    providerVersion: '1.0.0',
    requestedSourceHead: HEAD,
    providerInstance: 'openclaw-gateway:4242',
    platform: 'win32',
    env: { USERPROFILE: userProfile },
    existsSyncFn: () => true,
    spawnSyncFn,
    readFileFn: async () => JSON.stringify(parts.item),
  });
  assert.equal(result.success, false);
  assert.equal(result.error, 'OPENCLAW_OC2_SOURCE_STATE_CHANGED');
});
