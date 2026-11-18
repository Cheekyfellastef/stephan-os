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
    controllerId: 'oc2-existing-controller',
    missionRevision: 1,
    currentPhase: 'worker-execution-active',
    providerRouteIntent: 'openclaw-standalone',
    capacityRoute: 'openclaw-standalone',
    capacityReceiptId: null,
    capacityProofRefs: [],
    workerId: null,
    laneId: 'oc2-original-lane',
    prNumber: null,
    branch: 'main',
    headSha: null,
    engineeringMemoryPack: null,
    engineeringMemoryPackId: null,
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
  item.actionGrant = structuredClone(grant);
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


test('OC2 claimed source validator refuses incomplete grant and wrong queue adapter', async (t) => {
  for (const [name, corrupt, expected] of [
    ['missing grant id', (value) => { delete value.grant.grantId; }, 'OPENCLAW_OC2_GRANT_INVALID'],
    ['missing mission id', (value) => { delete value.grant.missionId; }, 'OPENCLAW_OC2_GRANT_INVALID'],
    ['wrong grant action kind', (value) => { value.grant.actionKind = 'other'; }, 'OPENCLAW_OC2_GRANT_INVALID'],
    ['wrong claimed queue adapter', (value) => { value.item.adapter = 'other'; }, 'OPENCLAW_OC2_CLAIM_INVALID'],
  ]) {
    await t.test(name, async () => {
      const value = fixture();
      corrupt(value);
      const result = await validateOpenClawOc2QualificationContext(qualificationInput(value), {
        readFileFn: async () => JSON.stringify(value.item),
      });
      assert.equal(result.success, false);
      assert.equal(result.error, expected);
    });
  }
});

test('OC2 claimed validator rejects another task filename in the same processing directory before reading', async (t) => {
  for (const [name, filename] of [
    ['different task identity', 'other-oc2-task-0001.json'],
    ['extra filename suffix', `${TASK}.backup.json`],
    ['noncanonical case', `${TASK.toUpperCase()}.json`],
  ]) {
    await t.test(name, async () => {
      const parts = fixture();
      parts.claim.processingPath = path.resolve(parts.claim.paths.processing, filename);
      let fileReads = 0;
      const result = await validateOpenClawOc2QualificationContext(qualificationInput(parts), {
        readFileFn: async () => {
          fileReads += 1;
          return JSON.stringify(parts.item);
        },
      });
      assert.equal(result.success, false);
      assert.equal(result.qualificationEligible, false);
      assert.equal(result.error, 'OPENCLAW_OC2_CLAIM_INVALID');
      assert.equal(fileReads, 0, 'wrong claimed file must be rejected before persisted I/O');
    });
  }
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

test('OC2 workspace I/O exceptions fail closed without a qualifying result', async (t) => {
  for (const [scenario, expectedError, expectedWrites] of [
    ['workspace layout throws', 'OPENCLAW_OC2_SHARED_WORKSPACE_UNAVAILABLE', 0],
    ['proof write throws', 'OPENCLAW_OC2_PROOF_WRITE_FAILED', 1],
    ['execution receipt write throws', 'OPENCLAW_OC2_EXECUTION_RECEIPT_WRITE_FAILED', 2],
  ]) {
    await t.test(scenario, async () => {
      const parts = fixture();
      const userProfile = '/tmp/stephanos-oc2-workspace-failure';
      const repoRoot = path.resolve(userProfile, 'Documents', 'GitHub', 'stephan-os');
      let writes = 0;
      const spawnSyncFn = (executable, args) => {
        if (String(executable).toLowerCase().endsWith('git.exe')) {
          const key = args.join(' ');
          if (key === 'rev-parse --show-toplevel') return { status: 0, stdout: `${repoRoot}\n`, stderr: '' };
          if (key === 'remote get-url origin') return { status: 0, stdout: 'https://github.com/Cheekyfellastef/stephan-os.git\n', stderr: '' };
          if (key === 'rev-parse --abbrev-ref HEAD') return { status: 0, stdout: 'main\n', stderr: '' };
          if (key === 'rev-parse HEAD') return { status: 0, stdout: `${HEAD}\n`, stderr: '' };
          if (key === 'status --porcelain=v1 --untracked-files=all') return { status: 0, stdout: '', stderr: '' };
          return { status: 1, stdout: '', stderr: 'unexpected git command' };
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
        ensureSharedWorkspaceLayoutFn: async () => {
          if (scenario === 'workspace layout throws') throw new Error('simulated missing workspace');
          return { ok: true };
        },
        writeAtomicJsonFn: async () => {
          writes += 1;
          if (scenario === 'proof write throws' && writes === 1) throw new Error('simulated proof I/O failure');
          if (scenario === 'execution receipt write throws' && writes === 2) throw new Error('simulated receipt I/O failure');
          return { ok: true };
        },
        now: new Date('2026-08-21T00:00:00.000Z'),
      });
      assert.equal(result.success, false);
      assert.equal(result.qualificationEligible, false);
      assert.equal(result.error, expectedError);
      assert.deepEqual(result.changedFiles, []);
      assert.deepEqual(result.evidenceReceipts, []);
      assert.equal(result.receipt, undefined);
      assert.equal(writes, expectedWrites);
    });
  }
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


test('OC2 fixed test invocation exceptions and oversized output yield typed blockers without false proof', async (t) => {
  for (const scenario of ['runner throws', 'runner exceeds output limit']) {
    await t.test(scenario, async () => {
      const parts = fixture();
      const userProfile = '/tmp/stephanos-oc2-runner-failure';
      const repoRoot = path.resolve(userProfile, 'Documents', 'GitHub', 'stephan-os');
      let nodeRuns = 0;
      let writes = 0;
      const spawnSyncFn = (executable, args) => {
        if (String(executable).toLowerCase().endsWith('git.exe')) {
          const key = args.join(' ');
          if (key === 'rev-parse --show-toplevel') return { status: 0, stdout: `${repoRoot}\n`, stderr: '' };
          if (key === 'remote get-url origin') return { status: 0, stdout: 'https://github.com/Cheekyfellastef/stephan-os.git\n', stderr: '' };
          if (key === 'rev-parse --abbrev-ref HEAD') return { status: 0, stdout: 'main\n', stderr: '' };
          if (key === 'rev-parse HEAD') return { status: 0, stdout: `${HEAD}\n`, stderr: '' };
          if (key === 'status --porcelain=v1 --untracked-files=all') return { status: 0, stdout: '', stderr: '' };
          return { status: 1, stdout: '', stderr: 'unexpected git command' };
        }
        nodeRuns += 1;
        if (scenario === 'runner throws') throw new Error('simulated node runner exception');
        return { status: 0, stdout: 'x'.repeat(1024 * 1024 + 1), stderr: '' };
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
        ensureSharedWorkspaceLayoutFn: async () => { writes += 1; return { ok: true }; },
        writeAtomicJsonFn: async () => { writes += 1; return { ok: true }; },
      });
      assert.equal(result.success, false);
      assert.equal(result.qualificationEligible, false);
      assert.equal(result.error, 'OPENCLAW_OC2_FIXED_TEST_INVOCATION_FAILED');
      assert.equal(result.failedTestId, OPENCLAW_OC2_FIXED_PLAN[0].testId);
      assert.deepEqual(result.testResults, []);
      assert.equal(nodeRuns, 1);
      assert.equal(writes, 0, 'failed invocation must never write qualifying evidence');
    });
  }
});

test('OC2 refuses an unbound, forged or incomplete persisted worker grant before file I/O', async (t) => {
  for (const [name, corrupt] of [
    ['missing persisted grant', (value) => { delete value.item.actionGrant; }],
    ['different grant ID', (value) => { value.item.actionGrant.grantId = 'grant-competing-oc2-task'; }],
    ['different source revision', (value) => { value.item.actionGrant.sourceRevision = 'b'.repeat(40); }],
    ['different capacity evidence', (value) => { value.item.actionGrant.capacityProofRefs = ['competing-capacity']; }],
    ['incomplete controller identity', (value) => { delete value.item.actionGrant.controllerId; }],
  ]) {
    await t.test(name, async () => {
      const value = fixture();
      corrupt(value);
      let reads = 0;
      const result = await validateOpenClawOc2QualificationContext(qualificationInput(value), {
        readFileFn: async () => { reads++; return JSON.stringify(value.item); },
      });
      assert.equal(result.success, false);
      assert.equal(result.qualificationEligible, false);
      assert.equal(result.error, 'OPENCLAW_OC2_GRANT_CUSTODY_MISMATCH');
      assert.equal(reads, 0, 'unbound grant must fail before persisted claim read');
    });
  }
});

test('OC2 rejects absent action context with a typed blocker and no persisted I/O', async () => {
  const parts = fixture();
  parts.action = null;
  let reads = 0;
  const result = await validateOpenClawOc2QualificationContext(qualificationInput(parts), {
    readFileFn: async () => { reads++; return JSON.stringify(parts.item); },
  });
  assert.equal(result.success, false);
  assert.equal(result.error, 'OPENCLAW_OC2_LINEAGE_INVALID');
  assert.equal(reads, 0);
});

test('OC2 rejects embedded commands and privilege escalation before persisted claim I/O', async (t) => {
  const commandFields = [
    'command', 'commands', 'args', 'argv', 'script', 'shell', 'executablePath',
    'worktreePath', 'allowedFiles', 'requiredTests',
  ];
  for (const field of commandFields) {
    await t.test('unexpected command field ' + field, async () => {
      const parts = fixture();
      parts.action[field] = field === 'args' || field === 'argv' ? ['--eval', 'untrusted'] : 'untrusted';
      let reads = 0;
      const result = await validateOpenClawOc2QualificationContext(qualificationInput(parts), {
        readFileFn: async () => { reads++; return JSON.stringify(parts.item); },
      });
      assert.equal(result.success, false);
      assert.equal(result.qualificationEligible, false);
      assert.equal(result.error, 'OPENCLAW_OC2_ACTION_SCOPE_INVALID');
      assert.equal(reads, 0, 'unexpected executable field must not reach claimed file I/O');
    });
  }
  const authorityFields = [
    'sourceMutationAuthority', 'arbitraryShellAuthority', 'arbitraryCommandAuthority',
    'mergeAuthority', 'deploymentAuthority', 'selfQualificationAuthority', 'leaseSeizureAllowed',
  ];
  for (const field of authorityFields) {
    for (const value of [true, 'false', null]) {
      await t.test('invalid authority ' + field + '=' + String(value), async () => {
        const parts = fixture();
        parts.action[field] = value;
        let reads = 0;
        const result = await validateOpenClawOc2QualificationContext(qualificationInput(parts), {
          readFileFn: async () => { reads++; return JSON.stringify(parts.item); },
        });
        assert.equal(result.error, 'OPENCLAW_OC2_ACTION_SCOPE_INVALID');
        assert.equal(result.qualificationEligible, false);
        assert.equal(reads, 0, 'non-false authority must be rejected before persisted file I/O');
      });
    }
  }
});

test('OC2 retains compatibility with explicitly false action authority declarations', async () => {
  const parts = fixture();
  for (const field of [
    'sourceMutationAuthority', 'arbitraryShellAuthority', 'arbitraryCommandAuthority',
    'mergeAuthority', 'deploymentAuthority', 'selfQualificationAuthority', 'leaseSeizureAllowed',
  ]) parts.action[field] = false;
  const result = await validateOpenClawOc2QualificationContext(qualificationInput(parts), {
    readFileFn: async () => JSON.stringify(parts.item),
  });
  assert.equal(result.success, true);
  assert.equal(result.qualificationEligible, true);
});
