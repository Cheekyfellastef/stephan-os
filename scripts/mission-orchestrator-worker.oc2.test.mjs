import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';

import {
  executeOpenClawReadonlyAction,
} from './mission-orchestrator-worker.mjs';
import {
  OPENCLAW_OC2_FIXED_PLAN,
  OPENCLAW_OC2_PROVIDER,
  OPENCLAW_OC2_PROVIDER_VERSION,
  OPENCLAW_OC2_RESULT_SCHEMA,
  OPENCLAW_OC2_OPERATION,
  OPENCLAW_OC2_TASK_CLASS,
} from '../integrations/openclaw/stephanos-builder-provider/lib/oc2-deterministic-test-build.mjs';
import {
  OPENCLAW_OC2_GATEWAY_METHOD,
  OPENCLAW_OC2_GATEWAY_REQUEST_SCHEMA,
  OPENCLAW_OC2_GATEWAY_RESULT_SCHEMA,
} from '../integrations/openclaw/stephanos-builder-provider/lib/oc2-gateway-provider.mjs';

const HEAD = 'c'.repeat(40);
const MISSION = 'openclaw-oc2-worker-mission';
const TASK = 'openclaw-oc2-worker-task-0001';
const CLAIM_HASH = createHash('sha256')
  .update(JSON.stringify([MISSION, TASK, `grant-${TASK}`, HEAD]), 'utf8')
  .digest('hex').slice(0, 32);
const EXACT_INPUT_IDENTITY = createHash('sha256').update(JSON.stringify({
  missionId: MISSION,
  goalId: '#1725',
  taskId: TASK,
  taskClass: OPENCLAW_OC2_TASK_CLASS,
  repository: 'Cheekyfellastef/stephan-os',
  requestedSourceHead: HEAD,
  provider: OPENCLAW_OC2_PROVIDER,
  providerVersion: OPENCLAW_OC2_PROVIDER_VERSION,
  operation: OPENCLAW_OC2_OPERATION,
  testPlanIds: OPENCLAW_OC2_FIXED_PLAN.map((entry) => entry.testId),
  grantId: `grant-${TASK}`,
  sourceMutationAuthority: false,
  arbitraryShellAuthority: false,
  arbitraryCommandAuthority: false,
  mergeAuthority: false,
  deploymentAuthority: false,
  selfQualificationAuthority: false,
}), 'utf8').digest('hex');
const PROOF_REF = `proofs/openclaw-oc2/oc2-${CLAIM_HASH}.json`;
const PROOF_RECEIPT_ID = `openclaw-oc2-proof-${createHash('sha256').update(PROOF_REF, 'utf8').digest('hex').slice(0, 20)}`;

function grant(overrides = {}) {
  return {
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
}

function gatewayResult() {
  const outputProofCore = {
    schemaVersion: OPENCLAW_OC2_RESULT_SCHEMA,
    missionId: MISSION,
    goalId: '#1725',
    taskId: TASK,
    taskClass: OPENCLAW_OC2_TASK_CLASS,
    repository: 'Cheekyfellastef/stephan-os',
    requestedSourceHead: HEAD,
    observedSourceHead: HEAD,
    exactInputIdentity: EXACT_INPUT_IDENTITY,
    provider: OPENCLAW_OC2_PROVIDER,
    providerInstance: 'openclaw-gateway:4242',
    providerVersion: OPENCLAW_OC2_PROVIDER_VERSION,
    operation: OPENCLAW_OC2_OPERATION,
    testResults: OPENCLAW_OC2_FIXED_PLAN.map((item) => ({
      testId: item.testId, status: 0, outputSha256: 'a'.repeat(64),
    })),
    changedFiles: [],
    sourceMutationPerformed: false,
    arbitraryShellAllowed: false,
    arbitraryCommandAllowed: false,
    mergeAllowed: false,
    deploymentAllowed: false,
    selfQualificationAllowed: false,
    finalVerdict: 'OPENCLAW_OC2_PROVIDER_TASK_COMPLETED',
    completedAtUtc: '2026-08-21T00:00:00.000Z',
  };
  const outputIdentity = createHash('sha256').update(JSON.stringify(outputProofCore), 'utf8').digest('hex');
  return {
    schemaVersion: OPENCLAW_OC2_GATEWAY_RESULT_SCHEMA,
    success: true,
    error: '',
    missionId: MISSION,
    goalId: '#1725',
    taskId: TASK,
    taskClass: OPENCLAW_OC2_TASK_CLASS,
    repository: 'Cheekyfellastef/stephan-os',
    requestedSourceHead: HEAD,
    provider: 'openclaw-standalone',
    providerInstance: 'openclaw-gateway:4242',
    providerVersion: '1.0.0',
    executionSurface: 'openclaw-gateway-plugin',
    qualificationEligible: true,
    result: {
      success: true,
      error: '',
      resultId: TASK,
      changedFiles: [],
      completedAt: '2026-08-21T00:00:00.000Z',
      qualificationEligible: true,
      missionId: MISSION,
      goalId: '#1725',
      taskId: TASK,
      taskClass: OPENCLAW_OC2_TASK_CLASS,
      repository: 'Cheekyfellastef/stephan-os',
      requestedSourceHead: HEAD,
      observedSourceHead: HEAD,
      provider: 'openclaw-standalone',
      providerVersion: '1.0.0',
      operation: OPENCLAW_OC2_OPERATION,
      providerInstance: 'openclaw-gateway:4242',
      exactInputIdentity: EXACT_INPUT_IDENTITY,
      outputProofCore,
      exactOutputIdentity: outputIdentity,
      receipt: {
        receiptId: `openclaw-oc2-result-${CLAIM_HASH.slice(0, 20)}`,
        source: 'openclaw-standalone-oc2',
        evidenceType: 'provider-neutral-task-result',
        commandOutputHash: outputIdentity,
        verified: true,
      },
      evidenceReceipts: [{
        receiptId: PROOF_RECEIPT_ID,
        source: 'openclaw-standalone-oc2',
        evidenceType: 'shared-workspace-proof',
        sha256: outputIdentity,
        receiptPath: PROOF_REF,
        verified: true,
      }],
    },
  };
}

test('OC2 Mission Worker contract is fixed and carries no caller command surface', () => {
  assert.equal(OPENCLAW_OC2_TASK_CLASS, 'OC2_DETERMINISTIC_TEST_BUILD');
  assert.equal(OPENCLAW_OC2_OPERATION, 'oc2-provider-regression-v1');
  assert.equal(OPENCLAW_OC2_GATEWAY_METHOD, 'stephanos-builder-provider.oc2Qualification');
  assert.equal(OPENCLAW_OC2_GATEWAY_REQUEST_SCHEMA, 'stephanos.openclaw-oc2-gateway-request.v1');
  assert.equal(OPENCLAW_OC2_GATEWAY_RESULT_SCHEMA, 'stephanos.openclaw-oc2-gateway-result.v1');
  assert.deepEqual(OPENCLAW_OC2_FIXED_PLAN.map((entry) => entry.testId), [
    'OC2_PROVIDER_SOURCE_PARSE_V1',
    'OC2_PROVIDER_REGRESSION_V1',
  ]);
  for (const entry of OPENCLAW_OC2_FIXED_PLAN) {
    assert.ok(Object.isFrozen(entry));
    assert.ok(Object.isFrozen(entry.args));
    assert.ok(entry.args.every((arg) => typeof arg === 'string'));
    assert.ok(entry.args.every((arg) => !/powershell|cmd\.exe|bash|sh\s+-c/i.test(arg)));
  }
});

test('exact #1725 OC2 grant selects only the fixed OC2 Gateway method', async () => {
  const calls = [];
  const actionGrant = grant();
  const result = await executeOpenClawReadonlyAction({
    schemaVersion: 'stephanos.mission-worker-action.v1',
    actionKind: 'agent-handoff',
    adapter: 'openclaw-readonly',
    operation: OPENCLAW_OC2_OPERATION,
    actionId: TASK,
    missionId: MISSION,
    repository: 'Cheekyfellastef/stephan-os',
    repositoryRoot: 'C:/Users/test/Documents/GitHub/stephan-os',
  }, { processingPath: 'C:/queue/processing/claim.json' }, {
    actionGrant,
    runCommand(executable, args, options) {
      calls.push({ executable, args, options });
      return { status: 0, stdout: JSON.stringify(gatewayResult()), stderr: '' };
    },
  });

  assert.equal(result.success, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args.slice(0, 3), ['gateway', 'call', OPENCLAW_OC2_GATEWAY_METHOD]);
  assert.equal(calls[0].args[3], '--params');
  const request = JSON.parse(calls[0].args[4]);
  assert.deepEqual(Object.keys(request).sort(), ['actionGrant', 'schemaVersion']);
  assert.equal(request.schemaVersion, OPENCLAW_OC2_GATEWAY_REQUEST_SCHEMA);
  assert.equal(request.actionGrant.operation, OPENCLAW_OC2_OPERATION);
  assert.equal(calls[0].options.env, process.env);
});


test('OC2 refuses contradictory queue action and grant before Gateway invocation', async (t) => {
  const base = {
    schemaVersion: 'stephanos.mission-worker-action.v1',
    actionKind: 'agent-handoff',
    adapter: 'openclaw-readonly',
    operation: OPENCLAW_OC2_OPERATION,
    actionId: TASK,
    missionId: MISSION,
    repository: 'Cheekyfellastef/stephan-os',
    repositoryRoot: 'C:/Users/test/Documents/GitHub/stephan-os',
  };
  const cases = [
    ['different task', (value) => { value.actionId = 'competing-task'; }],
    ['missing task', (value) => { delete value.actionId; }],
    ['different mission', (value) => { value.missionId = 'competing-mission'; }],
    ['missing mission', (value) => { delete value.missionId; }],
    ['different repository', (value) => { value.repository = 'other/repository'; }],
    ['different operation', (value) => { value.operation = 'caller-selected-command'; }],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      const action = { ...base };
      mutate(action);
      let calls = 0;
      const response = await executeOpenClawReadonlyAction(action, {
        processingPath: 'C:/queue/processing/claim.json',
      }, {
        actionGrant: grant(),
        runCommand() {
          calls += 1;
          return { status: 0, stdout: JSON.stringify(gatewayResult()), stderr: '' };
        },
      });
      assert.equal(calls, 0, 'a mismatched action must not invoke OpenClaw Gateway');
      assert.equal(response.success, false);
      assert.equal(response.error, 'OPENCLAW_OC2_ACTION_GRANT_MISMATCH');
    });
  }
});

test('OC2 result-consumer rejects contradictory producer and receipt lineage', async (t) => {
  const rehash = (value) => {
    const h = createHash('sha256').update(JSON.stringify(value.result.outputProofCore), 'utf8').digest('hex');
    value.result.exactOutputIdentity = h;
    value.result.receipt.commandOutputHash = h;
    value.result.evidenceReceipts[0].sha256 = h;
  };
  const corruptions = [
    ['inner mission mismatch', (value) => { value.result.missionId = 'other-mission'; }],
    ['inner mission absent', (value) => { delete value.result.missionId; }],
    ['inner task mismatch', (value) => { value.result.taskId = 'other-task'; }],
    ['inner task absent', (value) => { delete value.result.taskId; }],
    ['inner requested head mismatch', (value) => { value.result.requestedSourceHead = 'd'.repeat(40); }],
    ['inner observed head mismatch', (value) => { value.result.observedSourceHead = 'd'.repeat(40); }],
    ['inner source head absent', (value) => { delete value.result.observedSourceHead; }],
    ['inner provider name mismatch', (value) => { value.result.provider = 'other-provider'; }],
    ['inner provider version mismatch', (value) => { value.result.providerVersion = 'another-version'; }],
    ['inner operation mismatch', (value) => { value.result.operation = 'caller-command'; }],
    ['inner task class mismatch', (value) => { value.result.taskClass = 'other-class'; }],
    ['inner repository mismatch', (value) => { value.result.repository = 'other/repository'; }],
    ['inner goal mismatch', (value) => { value.result.goalId = '#9999'; }],
    ['inner provider mismatch', (value) => { value.result.providerInstance = 'openclaw-gateway:2'; }],
    ['inner provider absent', (value) => { delete value.result.providerInstance; }],
    ['input identity absent', (value) => { delete value.result.exactInputIdentity; }],
    ['input identity malformed', (value) => { value.result.exactInputIdentity = 'invalid'; }],
    ['input identity well-formed but forged', (value) => { value.result.exactInputIdentity = 'd'.repeat(64); }],
    ['output identity absent', (value) => { delete value.result.exactOutputIdentity; }],
    ['output identity malformed', (value) => { value.result.exactOutputIdentity = 'invalid'; }],
    ['three matching but invented output hashes', (value) => {
      value.result.exactOutputIdentity = 'd'.repeat(64);
      value.result.receipt.commandOutputHash = 'd'.repeat(64);
      value.result.evidenceReceipts[0].sha256 = 'd'.repeat(64);
    }],
    ['output proof core missing', (value) => { delete value.result.outputProofCore; }],
    ['output proof core another mission', (value) => { value.result.outputProofCore.missionId = 'other-mission'; rehash(value); }],
    ['output proof core omitted fixed test', (value) => { value.result.outputProofCore.testResults.pop(); rehash(value); }],
    ['output proof core failed test', (value) => { value.result.outputProofCore.testResults[0].status = 1; rehash(value); }],
    ['output proof core invented test digest', (value) => { value.result.outputProofCore.testResults[0].outputSha256 = 'invalid'; rehash(value); }],
    ['output proof core source mutation', (value) => { value.result.outputProofCore.sourceMutationPerformed = true; rehash(value); }],
    ['output proof core arbitrary shell', (value) => { value.result.outputProofCore.arbitraryShellAllowed = true; rehash(value); }],
    ['output proof core extra field', (value) => { value.result.outputProofCore.unexpected = true; rehash(value); }],
    ['result source mismatch', (value) => { value.result.receipt.source = 'other-provider'; }],
    ['result evidence type mismatch', (value) => { value.result.receipt.evidenceType = 'other-type'; }],
    ['result digest mismatch', (value) => { value.result.receipt.commandOutputHash = 'd'.repeat(64); }],
    ['proof source mismatch', (value) => { value.result.evidenceReceipts[0].source = 'other-provider'; }],
    ['proof type mismatch', (value) => { value.result.evidenceReceipts[0].evidenceType = 'other-type'; }],
    ['proof digest mismatch', (value) => { value.result.evidenceReceipts[0].sha256 = 'e'.repeat(64); }],
    ['proof path outside canonical scope', (value) => { value.result.evidenceReceipts[0].receiptPath = '../other.json'; }],
    ['plausible proof path for another grant', (value) => { value.result.evidenceReceipts[0].receiptPath = `proofs/openclaw-oc2/oc2-${'d'.repeat(32)}.json`; }],
    ['result receipt ID for another task', (value) => { value.result.receipt.receiptId = 'openclaw-oc2-result-competing'; }],
    ['proof receipt ID for another task', (value) => { value.result.evidenceReceipts[0].receiptId = 'openclaw-oc2-proof-competing'; }],
    ['multiple proof receipts', (value) => { value.result.evidenceReceipts.push({ ...value.result.evidenceReceipts[0] }); }],
  ];
  for (const [name, mutate] of corruptions) {
    await t.test(name, async () => {
      const forged = gatewayResult();
      mutate(forged);
      let calls = 0;
      const response = await executeOpenClawReadonlyAction({
        actionKind: 'agent-handoff',
        adapter: 'openclaw-readonly',
        operation: OPENCLAW_OC2_OPERATION,
        actionId: TASK,
        missionId: MISSION,
        repository: 'Cheekyfellastef/stephan-os',
        repositoryRoot: 'C:/Users/test/Documents/GitHub/stephan-os',
      }, { processingPath: 'C:/queue/processing/claim.json' }, {
        actionGrant: grant(),
        runCommand() {
          calls += 1;
          return { status: 0, stdout: JSON.stringify(forged), stderr: '' };
        },
      });
      assert.equal(calls, 1);
      assert.equal(response.success, false);
      assert.equal(response.error, 'OPENCLAW_OC2_GATEWAY_RESULT_LINEAGE_INVALID');
    });
  }
});

test('non-allowlisted #1725 operations cannot fall through to OC1 or OC2', async () => {
  let called = false;
  const result = await executeOpenClawReadonlyAction({
    actionKind: 'agent-handoff',
    adapter: 'openclaw-readonly',
    operation: 'caller-selected-command',
    actionId: TASK,
    missionId: MISSION,
  }, { processingPath: 'C:/queue/processing/claim.json' }, {
    actionGrant: grant({ operation: 'caller-selected-command' }),
    runCommand() {
      called = true;
      return { status: 0, stdout: '{}', stderr: '' };
    },
  });
  assert.equal(result.success, false);
  assert.equal(result.error, 'OPENCLAW_OC1_OPERATION_NOT_ALLOWLISTED');
  assert.equal(called, false);
});
