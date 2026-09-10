import assert from 'node:assert/strict';
import test from 'node:test';

import { validateExecutionReceipt } from '../../../shared/agents/executionReceiptV1.mjs';
import { validateSharedWorkspaceRecord } from '../../../shared/agents/sharedAgentWorkspaceStore.mjs';
import {
  OPENCLAW_OC1_COMMAND,
  OPENCLAW_OC1_PROVIDER_RESULT_SCHEMA,
  OPENCLAW_OC1_PROVIDER_VERSION,
  OPENCLAW_OC1_TASK_CLASS,
  executeClaimedOpenClawOc1RepositoryScout,
  renderOpenClawBuilderHelp,
  resolveOpenClawBuilderCommand,
  runOpenClawOc1RepositoryScout,
  validateOpenClawOc1QualificationContext,
} from './lib/oc1-repository-scout.mjs';

const HEAD = '8501a5657abe3fc5e815d9b35d9920003a4a1843';
const OTHER_HEAD = '1111111111111111111111111111111111111111';
const NOW = new Date('2026-08-19T15:20:00.000Z');
const USERPROFILE = '/tmp/openclaw-oc1-user';
const REPO_ROOT = '/tmp/openclaw-oc1-user/Documents/GitHub/stephan-os';
const MISSION_ID = 'openclaw-oc1-qualification-mission';
const TASK_ID = 'openclaw-oc1-qualification-r1-task';
const PROCESSING_ROOT = '/tmp/openclaw-oc1-user/Documents/OpenClaw-Standalone/mission-runner/orchestrator/worker-queue/openclaw-readonly/processing';
const PROCESSING_PATH = `${PROCESSING_ROOT}/${TASK_ID}.json`;

function authenticatedContext() {
  return { authenticatedByHost: true, commandName: 'stephanos-builder', command: OPENCLAW_OC1_COMMAND };
}

function fakeFetch() {
  return Promise.resolve({
    ok: true,
    headers: { get: () => 'application/json' },
    json: async () => ({ product: 'OpenClaw', runtimeId: 'openclaw-runtime-oc1-test' }),
  });
}

function createSpawn(statusOutput = '', overrides = {}) {
  const calls = [];
  const fn = (executable, args, options) => {
    calls.push({ executable, args: [...args], options });
    const key = args.join(' ');
    const stdout = overrides[key]
      ?? (key === 'rev-parse --show-toplevel' ? REPO_ROOT
        : key === 'remote get-url origin' ? 'https://github.com/Cheekyfellastef/stephan-os.git'
          : key === 'rev-parse --abbrev-ref HEAD' ? 'main'
            : key === 'rev-parse HEAD' ? HEAD
              : key === 'status --porcelain=v1 --untracked-files=all' ? statusOutput
                : '');
    return { status: 0, stdout: `${stdout}\n`, stderr: '' };
  };
  return { fn, calls };
}

function missionAction(overrides = {}) {
  return {
    schemaVersion: 'stephanos.mission-worker-action.v1',
    missionId: MISSION_ID,
    actionId: TASK_ID,
    actionKind: 'agent-handoff',
    adapter: 'openclaw-readonly',
    repository: 'Cheekyfellastef/stephan-os',
    executable: true,
    ...overrides,
  };
}

function actionGrant(overrides = {}) {
  return {
    schemaVersion: 'stephanos.mission-worker-action-grant.v1',
    grantId: `grant-${TASK_ID}`,
    controllerId: 'durable-flywheel-controller',
    sourceRevision: HEAD,
    missionId: MISSION_ID,
    missionRevision: 1,
    currentPhase: 'LIVE_RUNTIME_INVESTIGATION',
    actionId: TASK_ID,
    actionKind: 'agent-handoff',
    adapter: 'openclaw-readonly',
    operation: '',
    issueNumber: 1725,
    repository: 'Cheekyfellastef/stephan-os',
    boundedActionCount: 1,
    mergeAuthority: false,
    leaseSeizureAllowed: false,
    ...overrides,
  };
}

function claimedTask({ actionOverrides = {}, grantOverrides = {}, itemOverrides = {} } = {}) {
  const action = missionAction(actionOverrides);
  const item = {
    schemaVersion: 'stephanos.mission-worker-queue-item.v1',
    adapter: 'openclaw-readonly',
    missionId: action.missionId,
    actionId: action.actionId,
    payload: action,
    ...itemOverrides,
  };
  const claim = {
    adapter: 'openclaw-readonly',
    item,
    processingPath: PROCESSING_PATH,
    paths: { processing: PROCESSING_ROOT },
  };
  return { action, claim, grant: actionGrant(grantOverrides) };
}

function harness({
  statusOutput = '',
  spawnOverrides = {},
  exists = () => true,
  persistedClaim = null,
} = {}) {
  const spawn = createSpawn(statusOutput, spawnOverrides);
  const writes = [];
  return {
    spawn,
    writes,
    input: {
      platform: 'win32',
      env: { USERPROFILE },
      authenticatedContext: authenticatedContext(),
      hostPid: 4242,
      spawnSyncFn: spawn.fn,
      readFileFn: async (candidate) => {
        if (candidate === PROCESSING_PATH && persistedClaim) return JSON.stringify(persistedClaim);
        return JSON.stringify({ scripts: { test: 'node --test', 'stephanos:build': 'vite build' } });
      },
      existsSyncFn: exists,
      fetchFn: fakeFetch,
      now: NOW,
      randomIdFn: () => '12345678-1234-1234-1234-1234567890ab',
      ensureSharedWorkspaceLayoutFn: async () => ({ ok: true }),
      writeAtomicJsonFn: async (root, segments, record) => {
        writes.push({ root, segments: [...segments], record });
        return { ok: true, path: `${root}/${segments.join('/')}` };
      },
    },
  };
}

function qualificationOptions(current, task, overrides = {}) {
  return {
    ...current.input,
    authenticatedContext: null,
    actionGrant: task.grant,
    taskClass: OPENCLAW_OC1_TASK_CLASS,
    goalId: '#1725',
    providerVersion: OPENCLAW_OC1_PROVIDER_VERSION,
    requestedSourceHead: HEAD,
    ...overrides,
  };
}

test('command surface is closed-world and manual scout is explicitly diagnostic-only', () => {
  assert.deepEqual(resolveOpenClawBuilderCommand('scout'), { ok: true, command: 'scout', mutationAllowed: false });
  assert.deepEqual(resolveOpenClawBuilderCommand('oc1-scout'), { ok: true, command: 'scout', mutationAllowed: false });
  assert.equal(resolveOpenClawBuilderCommand('exec whoami').ok, false);
  assert.match(renderOpenClawBuilderHelp(), /SOURCE_MUTATION=false/);
  assert.match(renderOpenClawBuilderHelp(), /ARBITRARY_SHELL=false/);
  assert.match(renderOpenClawBuilderHelp(), /already-claimed canonical openclaw-readonly Mission Worker task/);
});

test('OC1 diagnostic requires the authenticated OpenClaw plugin host and Windows boundary', async () => {
  const notWindows = harness();
  assert.equal((await runOpenClawOc1RepositoryScout({ ...notWindows.input, platform: 'linux' })).blocker, 'OPENCLAW_OC1_WINDOWS_REQUIRED');

  const unauthenticated = harness();
  unauthenticated.input.fetchFn = async () => ({ ok: false, headers: { get: () => '' } });
  const result = await runOpenClawOc1RepositoryScout({ ...unauthenticated.input, authenticatedContext: null });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'OPENCLAW_OC1_AUTHENTICATED_HOST_REQUIRED');
});

test('free-standing manual OC1 scout can never mint scheduler-qualified execution evidence; QUALIFICATION_ELIGIBLE=false', async () => {
  const current = harness();
  const result = await runOpenClawOc1RepositoryScout(current.input);

  assert.equal(result.ok, true);
  assert.equal(result.qualificationEligible, false);
  assert.equal(result.receiptId, '');
  assert.equal(result.finalVerdict, 'OPENCLAW_OC1_DIAGNOSTIC_SCOUT_COMPLETED');
  assert.equal(result.mutationPerformed, false);
  assert.equal(result.arbitraryShellAllowed, false);
  assert.equal(result.mergeAuthority, false);

  assert.equal(current.spawn.calls.length, 5);
  for (const call of current.spawn.calls) {
    assert.equal(call.executable, 'C:\\Program Files\\Git\\cmd\\git.exe');
    assert.equal(call.options.shell, false);
    assert.equal(call.options.windowsHide, true);
  }
  assert.deepEqual(current.spawn.calls.map((call) => call.args), [
    ['rev-parse', '--show-toplevel'],
    ['remote', 'get-url', 'origin'],
    ['rev-parse', '--abbrev-ref', 'HEAD'],
    ['rev-parse', 'HEAD'],
    ['status', '--porcelain=v1', '--untracked-files=all'],
  ]);

  assert.equal(current.writes.length, 1);
  const proofWrite = current.writes[0];
  assert.deepEqual(proofWrite.segments.slice(0, 2), ['proofs', 'openclaw-oc1']);
  assert.equal(validateSharedWorkspaceRecord(proofWrite.record, { nowMs: NOW.getTime() }).valid, true);
  const proofBody = JSON.parse(proofWrite.record.body);
  assert.equal(proofBody.mode, 'DIAGNOSTIC_NON_QUALIFYING');
  assert.equal(proofBody.qualificationEligible, false);
  assert.equal(proofBody.providerVersion, OPENCLAW_OC1_PROVIDER_VERSION);
  assert.deepEqual(proofBody.packageScripts, ['stephanos:build', 'test']);
});

test('claimed canonical OC1 task preserves exact mission goal task head provider and output lineage', async () => {
  const task = claimedTask();
  const current = harness({ persistedClaim: task.claim.item });
  const result = await executeClaimedOpenClawOc1RepositoryScout(
    task.action,
    task.claim,
    qualificationOptions(current, task),
  );

  assert.equal(result.success, true);
  assert.equal(result.resultId, TASK_ID);
  assert.equal(result.changedFiles.length, 0);
  assert.equal(result.evidenceReceipts.length, 1);
  assert.equal(current.writes.length, 2);

  const proofWrite = current.writes[0];
  const receiptWrite = current.writes[1];
  assert.equal(validateSharedWorkspaceRecord(proofWrite.record, { nowMs: NOW.getTime() }).valid, true);
  const body = JSON.parse(proofWrite.record.body);
  assert.equal(body.schemaVersion, OPENCLAW_OC1_PROVIDER_RESULT_SCHEMA);
  assert.equal(body.missionId, MISSION_ID);
  assert.equal(body.goalId, '#1725');
  assert.equal(body.taskId, TASK_ID);
  assert.equal(body.taskClass, OPENCLAW_OC1_TASK_CLASS);
  assert.equal(body.repository, 'Cheekyfellastef/stephan-os');
  assert.equal(body.requestedSourceHead, HEAD);
  assert.equal(body.observedSourceHead, HEAD);
  assert.equal(body.provider, 'openclaw-standalone');
  assert.equal(body.providerInstance, 'openclaw-runtime-oc1-test');
  assert.equal(body.providerVersion, OPENCLAW_OC1_PROVIDER_VERSION);
  assert.equal(body.authorityUsed.canonicalMissionWorkerClaim, true);
  assert.equal(body.authorityUsed.mergeAuthority, false);
  assert.equal(body.sourceMutationPerformed, false);
  assert.equal(body.selfQualificationAllowed, false);
  assert.match(body.exactInputIdentity, /^[a-f0-9]{64}$/);
  assert.match(body.exactOutputIdentity, /^[a-f0-9]{64}$/);

  assert.equal(validateSharedWorkspaceRecord(receiptWrite.record, { nowMs: NOW.getTime() }).valid, true);
  assert.equal(validateExecutionReceipt(receiptWrite.record.executionReceipt, {
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 1725,
    expectedHead: HEAD,
    executionId: receiptWrite.record.executionReceipt.executionId,
  }).valid, true);
  assert.equal(receiptWrite.record.executionReceipt.workerType, 'openclaw');
  assert.equal(receiptWrite.record.executionReceipt.state, 'completed');
  assert.equal(receiptWrite.record.executionReceipt.operatorActionRequired, false);
});

test('wrong mission task or persisted claim lineage fails closed before provider qualification', async () => {
  const task = claimedTask();
  const wrongMissionGrant = actionGrant({ missionId: 'wrong-mission' });
  const current = harness({ persistedClaim: task.claim.item });
  const result = await validateOpenClawOc1QualificationContext({
    action: task.action,
    claim: task.claim,
    actionGrant: wrongMissionGrant,
    taskClass: OPENCLAW_OC1_TASK_CLASS,
    goalId: '#1725',
    taskId: TASK_ID,
    providerVersion: OPENCLAW_OC1_PROVIDER_VERSION,
    requestedSourceHead: HEAD,
  }, { readFileFn: current.input.readFileFn });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'OPENCLAW_OC1_CANONICAL_CLAIM_INVALID');

  const mismatchedPersisted = { ...task.claim.item, actionId: 'wrong-task' };
  const persisted = harness({ persistedClaim: mismatchedPersisted });
  const persistedResult = await validateOpenClawOc1QualificationContext({
    action: task.action,
    claim: task.claim,
    actionGrant: task.grant,
    taskClass: OPENCLAW_OC1_TASK_CLASS,
    goalId: '#1725',
    taskId: TASK_ID,
    providerVersion: OPENCLAW_OC1_PROVIDER_VERSION,
    requestedSourceHead: HEAD,
  }, { readFileFn: persisted.input.readFileFn });
  assert.equal(persistedResult.ok, false);
  assert.equal(persistedResult.blocker, 'OPENCLAW_OC1_CLAIM_PROOF_MISMATCH');
});

test('wrong requested source head or provider version closes qualification', async () => {
  const task = claimedTask();
  const wrongHeadHarness = harness({ persistedClaim: task.claim.item });
  const wrongHead = await executeClaimedOpenClawOc1RepositoryScout(
    task.action,
    task.claim,
    qualificationOptions(wrongHeadHarness, task, { requestedSourceHead: OTHER_HEAD }),
  );
  assert.equal(wrongHead.success, false);
  assert.equal(wrongHead.error, 'OPENCLAW_OC1_REQUESTED_HEAD_BINDING_INVALID');
  assert.equal(wrongHeadHarness.spawn.calls.length, 0);

  const wrongVersionHarness = harness({ persistedClaim: task.claim.item });
  const wrongVersion = await executeClaimedOpenClawOc1RepositoryScout(
    task.action,
    task.claim,
    qualificationOptions(wrongVersionHarness, task, { providerVersion: '0.0.0-wrong' }),
  );
  assert.equal(wrongVersion.success, false);
  assert.equal(wrongVersion.error, 'OPENCLAW_OC1_QUALIFICATION_BINDING_INVALID');
  assert.equal(wrongVersionHarness.spawn.calls.length, 0);
});

test('actual canonical head mismatch closes qualification even with otherwise valid task lineage', async () => {
  const task = claimedTask();
  const current = harness({
    persistedClaim: task.claim.item,
    spawnOverrides: { 'rev-parse HEAD': OTHER_HEAD },
  });
  const result = await executeClaimedOpenClawOc1RepositoryScout(
    task.action,
    task.claim,
    qualificationOptions(current, task),
  );
  assert.equal(result.success, false);
  assert.equal(result.error, 'OPENCLAW_OC1_REQUESTED_HEAD_MISMATCH');
  assert.equal(current.writes.length, 0);
});

test('source dirt can be observed diagnostically but cannot produce a completed qualification receipt', async () => {
  const diagnostic = harness({ statusOutput: ' M shared/agents/openClawLocalAdapter.mjs' });
  const diagnosticResult = await runOpenClawOc1RepositoryScout(diagnostic.input);
  assert.equal(diagnosticResult.ok, true);
  assert.equal(diagnosticResult.qualificationEligible, false);
  assert.equal(diagnostic.writes.length, 1);

  const task = claimedTask();
  const qualified = harness({ statusOutput: ' M shared/agents/openClawLocalAdapter.mjs', persistedClaim: task.claim.item });
  const qualifiedResult = await executeClaimedOpenClawOc1RepositoryScout(
    task.action,
    task.claim,
    qualificationOptions(qualified, task),
  );
  assert.equal(qualifiedResult.success, false);
  assert.equal(qualifiedResult.error, 'OPENCLAW_OC1_DIRTY_SOURCE_BLOCKS_QUALIFICATION');
  assert.equal(qualified.writes.length, 1);
  assert.deepEqual(qualified.writes[0].segments.slice(0, 2), ['proofs', 'openclaw-oc1']);
});

test('runtime-only dirt does not masquerade as source dirt and path details stay out of diagnostic proof', async () => {
  const current = harness({ statusOutput: ' M apps/stephanos/dist/assets/runtime.js' });
  const result = await runOpenClawOc1RepositoryScout(current.input);
  assert.equal(result.ok, true);
  const proofBody = JSON.parse(current.writes[0].record.body);
  assert.equal(proofBody.dirt.runtimeOnlyCount, 1);
  assert.equal('runtimeOnly' in proofBody.dirt, false);
  assert.doesNotMatch(current.writes[0].record.body, /apps\/stephanos\/dist/);
});

test('foreign origin, non-main branch and missing canonical checkout fail closed before qualification', async () => {
  const foreign = harness({ spawnOverrides: { 'remote get-url origin': 'https://example.invalid/stephan-os.git' } });
  assert.equal((await runOpenClawOc1RepositoryScout(foreign.input)).blocker, 'OPENCLAW_OC1_ORIGIN_MISMATCH');

  const branch = harness({ spawnOverrides: { 'rev-parse --abbrev-ref HEAD': 'feature/not-main' } });
  assert.equal((await runOpenClawOc1RepositoryScout(branch.input)).blocker, 'OPENCLAW_OC1_NON_MAIN_BRANCH');

  const missing = harness({ exists: (candidate) => candidate !== REPO_ROOT });
  assert.equal((await runOpenClawOc1RepositoryScout(missing.input)).blocker, 'OPENCLAW_OC1_CANONICAL_REPOSITORY_MISSING');
});

test('unsafe or sensitive changed paths are never emitted into bounded diagnostic proof', async () => {
  const current = harness({ statusOutput: '?? credentials/private-key.txt' });
  const result = await runOpenClawOc1RepositoryScout(current.input);
  assert.equal(result.ok, true);
  const proof = current.writes[0].record;
  assert.doesNotMatch(proof.body, /private-key/i);
  const body = JSON.parse(proof.body);
  assert.equal(body.dirt.untrackedSourceCount, 1);
  assert.deepEqual(body.dirt.untrackedSource, []);
});
