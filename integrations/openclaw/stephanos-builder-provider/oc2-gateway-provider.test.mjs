import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';

import {
  OPENCLAW_OC2_GATEWAY_METHOD,
  OPENCLAW_OC2_GATEWAY_REQUEST_SCHEMA,
  executeOpenClawOc2GatewayRequest,
} from './lib/oc2-gateway-provider.mjs';
import { OPENCLAW_OC2_OPERATION } from './lib/oc2-deterministic-test-build.mjs';

const HEAD = 'b'.repeat(40);
const MISSION = 'oc2-gateway-mission';
const TASK = 'oc2-gateway-task-0001';

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

function item() {
  const payload = {
    schemaVersion: 'stephanos.mission-worker-action.v1',
    missionId: MISSION,
    actionId: TASK,
    actionKind: 'agent-handoff',
    adapter: 'openclaw-readonly',
    operation: OPENCLAW_OC2_OPERATION,
    executable: true,
    repository: 'Cheekyfellastef/stephan-os',
  };
  return {
    schemaVersion: 'stephanos.mission-worker-queue-item.v1',
    adapter: 'openclaw-readonly',
    missionId: MISSION,
    actionId: TASK,
    payload,
  };
}

test('OC2 gateway rejects execution outside the actual OpenClaw Gateway plugin', async () => {
  const result = await executeOpenClawOc2GatewayRequest({
    schemaVersion: OPENCLAW_OC2_GATEWAY_REQUEST_SCHEMA,
    actionGrant: grant(),
  }, { gatewayRuntimeContext: { executingInsideOpenClawGateway: false } });
  assert.equal(result.success, false);
  assert.equal(result.error, 'OPENCLAW_OC2_GATEWAY_RUNTIME_REQUIRED');
});

test('OC2 gateway rejects caller-selected operation or extra request fields', async () => {
  const wrongOperation = await executeOpenClawOc2GatewayRequest({
    schemaVersion: OPENCLAW_OC2_GATEWAY_REQUEST_SCHEMA,
    actionGrant: grant({ operation: 'node --test arbitrary.mjs' }),
  }, {
    gatewayRuntimeContext: {
      executingInsideOpenClawGateway: true,
      pluginId: 'stephanos-builder-provider',
      method: OPENCLAW_OC2_GATEWAY_METHOD,
      providerInstance: 'openclaw-gateway:8',
    },
  });
  assert.equal(wrongOperation.error, 'OPENCLAW_OC2_GATEWAY_GRANT_INVALID');

  const extra = await executeOpenClawOc2GatewayRequest({
    schemaVersion: OPENCLAW_OC2_GATEWAY_REQUEST_SCHEMA,
    actionGrant: grant(),
    command: 'node --test arbitrary.mjs',
  }, {
    gatewayRuntimeContext: {
      executingInsideOpenClawGateway: true,
      pluginId: 'stephanos-builder-provider',
      method: OPENCLAW_OC2_GATEWAY_METHOD,
      providerInstance: 'openclaw-gateway:8',
    },
  });
  assert.equal(extra.error, 'OPENCLAW_OC2_GATEWAY_REQUEST_SHAPE_INVALID');
});

test('OC2 gateway binds the persisted claimed item and executes the fixed plan', async () => {
  const userProfile = '/tmp/oc2-gateway-user';
  const repoRoot = path.resolve(userProfile, 'Documents', 'GitHub', 'stephan-os');
  const queueRoot = path.resolve(userProfile, 'queue');
  const persisted = item();
  const request = {
    schemaVersion: OPENCLAW_OC2_GATEWAY_REQUEST_SCHEMA,
    actionGrant: grant(),
  };
  const spawnSyncFn = (executable, args) => {
    if (String(executable).toLowerCase().endsWith('git.exe')) {
      const key = args.join(' ');
      if (key === 'rev-parse --show-toplevel') return { status: 0, stdout: `${repoRoot}\n`, stderr: '' };
      if (key === 'remote get-url origin') return { status: 0, stdout: 'git@github.com:Cheekyfellastef/stephan-os.git\n', stderr: '' };
      if (key === 'rev-parse --abbrev-ref HEAD') return { status: 0, stdout: 'main\n', stderr: '' };
      if (key === 'rev-parse HEAD') return { status: 0, stdout: `${HEAD}\n`, stderr: '' };
      if (key === 'status --porcelain=v1 --untracked-files=all') return { status: 0, stdout: '', stderr: '' };
    }
    return { status: 0, stdout: 'pass\n', stderr: '' };
  };
  const result = await executeOpenClawOc2GatewayRequest(request, {
    gatewayRuntimeContext: {
      executingInsideOpenClawGateway: true,
      pluginId: 'stephanos-builder-provider',
      method: OPENCLAW_OC2_GATEWAY_METHOD,
      providerInstance: 'openclaw-gateway:4242',
    },
    platform: 'win32',
    env: { USERPROFILE: userProfile, STEPHANOS_MISSION_WORKER_QUEUE_DIR: queueRoot },
    readFileFn: async () => JSON.stringify(persisted),
    existsSyncFn: () => true,
    spawnSyncFn,
    ensureSharedWorkspaceLayoutFn: async () => ({ ok: true }),
    writeAtomicJsonFn: async () => ({ ok: true }),
    now: new Date('2026-08-21T00:00:00.000Z'),
  });
  assert.equal(result.success, true);
  assert.equal(result.qualificationEligible, true);
  assert.equal(result.taskClass, 'OC2_DETERMINISTIC_TEST_BUILD');
  assert.equal(result.executionSurface, 'openclaw-gateway-plugin');
  assert.equal(result.result.changedFiles.length, 0);
});
