import assert from 'node:assert/strict';
import test from 'node:test';

import {
  executeOpenClawReadonlyAction,
} from './mission-orchestrator-worker.mjs';
import {
  OPENCLAW_OC2_FIXED_PLAN,
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
      receipt: {
        receiptId: 'openclaw-oc2-result-1234567890',
        verified: true,
      },
      evidenceReceipts: [{
        receiptId: 'openclaw-oc2-proof-1234567890',
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
