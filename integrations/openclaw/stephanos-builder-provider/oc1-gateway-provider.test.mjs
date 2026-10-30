import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  OPENCLAW_OC1_GATEWAY_REQUEST_SCHEMA,
  OPENCLAW_OC1_GATEWAY_RESULT_SCHEMA,
  executeOpenClawOc1GatewayRequest,
} from './lib/oc1-gateway-provider.mjs';

const HEAD = '8501a5657abe3fc5e815d9b35d9920003a4a1843';
const MISSION_ID = 'critical-1725-openclaw-oc1';
const TASK_ID = 'critical-1725-openclaw-oc1-r1-task';
const NOW = new Date('2026-08-19T18:20:00.000Z');

function grant(overrides = {}) {
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
    branch: 'main',
    boundedActionCount: 1,
    mergeAuthority: false,
    leaseSeizureAllowed: false,
    ...overrides,
  };
}

function action(overrides = {}) {
  return {
    schemaVersion: 'stephanos.mission-worker-action.v1',
    missionId: MISSION_ID,
    actionId: TASK_ID,
    actionKind: 'agent-handoff',
    adapter: 'openclaw-readonly',
    repository: 'Cheekyfellastef/stephan-os',
    repositoryRoot: 'C:/Users/test/Documents/GitHub/stephan-os',
    requiredEvidence: [],
    browserProofRequired: false,
    executable: true,
    ...overrides,
  };
}

function spawnFixture(repoRoot) {
  const calls = [];
  const fn = (_executable, args) => {
    calls.push([...args]);
    const key = args.join(' ');
    const stdout = key === 'rev-parse --show-toplevel' ? repoRoot
      : key === 'remote get-url origin' ? 'https://github.com/Cheekyfellastef/stephan-os.git'
        : key === 'rev-parse --abbrev-ref HEAD' ? 'main'
          : key === 'rev-parse HEAD' ? HEAD
            : key === 'status --porcelain=v1 --untracked-files=all' ? ''
              : '';
    return { status: 0, stdout: `${stdout}\n`, stderr: '' };
  };
  return { fn, calls };
}

async function createHarness() {
  const userProfile = await mkdtemp(path.join(tmpdir(), 'oc1-gateway-'));
  const repoRoot = path.resolve(userProfile, 'Documents', 'GitHub', 'stephan-os');
  const queueRoot = path.resolve(userProfile, 'mission-queue');
  const processingRoot = path.resolve(queueRoot, 'openclaw-readonly', 'processing');
  const processingPath = path.resolve(processingRoot, `${TASK_ID}.json`);
  await mkdir(repoRoot, { recursive: true });
  await mkdir(processingRoot, { recursive: true });
  await writeFile(path.join(repoRoot, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
  const item = {
    schemaVersion: 'stephanos.mission-worker-queue-item.v1',
    adapter: 'openclaw-readonly',
    missionId: MISSION_ID,
    actionId: TASK_ID,
    payload: action(),
  };
  await writeFile(processingPath, JSON.stringify(item));
  const reads = [];
  const writes = [];
  const spawn = spawnFixture(repoRoot);
  return {
    userProfile,
    repoRoot,
    queueRoot,
    processingPath,
    reads,
    writes,
    spawn,
    request: { schemaVersion: OPENCLAW_OC1_GATEWAY_REQUEST_SCHEMA, actionGrant: grant() },
    options: {
      platform: 'win32',
      env: { USERPROFILE: userProfile, STEPHANOS_MISSION_WORKER_QUEUE_DIR: queueRoot },
      gatewayRuntimeContext: {
        executingInsideOpenClawGateway: true,
        pluginId: 'stephanos-builder-provider',
        method: 'stephanos-builder-provider.oc1Qualification',
        providerInstance: 'openclaw-gateway:4242',
      },
      spawnSyncFn: spawn.fn,
      readFileFn: async (...args) => {
        reads.push(path.resolve(args[0]));
        return readFile(...args);
      },
      existsSyncFn: () => true,
      fetchFn: async () => ({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ product: 'OpenClaw', runtimeId: 'openclaw-runtime-oc1-gateway-test' }),
      }),
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

test('qualification runs inside OpenClaw Gateway and reopens the exact canonical processing claim', async () => {
  const harness = await createHarness();
  const result = await executeOpenClawOc1GatewayRequest(harness.request, harness.options);

  assert.equal(result.schemaVersion, OPENCLAW_OC1_GATEWAY_RESULT_SCHEMA);
  assert.equal(result.success, true);
  assert.equal(result.qualificationEligible, true);
  assert.equal(result.executionSurface, 'openclaw-gateway-plugin');
  assert.equal(result.providerInstance, 'openclaw-gateway:4242');
  assert.equal(result.missionId, MISSION_ID);
  assert.equal(result.taskId, TASK_ID);
  assert.equal(result.requestedSourceHead, HEAD);
  assert.equal(result.result.success, true);
  assert.equal(result.result.resultId, TASK_ID);
  assert.deepEqual(result.result.changedFiles, []);
  assert.equal(result.result.receipt.verified, true);
  assert.equal(result.result.evidenceReceipts.length, 1);
  assert.equal(harness.reads[0], harness.processingPath);
  assert.equal(harness.writes.length, 2);
  assert.deepEqual(harness.spawn.calls, [
    ['rev-parse', '--show-toplevel'],
    ['remote', 'get-url', 'origin'],
    ['rev-parse', '--abbrev-ref', 'HEAD'],
    ['rev-parse', 'HEAD'],
    ['status', '--porcelain=v1', '--untracked-files=all'],
  ]);
});

test('a direct module call without the OpenClaw Gateway runtime marker cannot qualify', async () => {
  const harness = await createHarness();
  const result = await executeOpenClawOc1GatewayRequest(harness.request, {
    ...harness.options,
    gatewayRuntimeContext: null,
  });
  assert.equal(result.success, false);
  assert.equal(result.error, 'OPENCLAW_OC1_GATEWAY_RUNTIME_REQUIRED');
  assert.equal(harness.reads.length, 0);
  assert.equal(harness.spawn.calls.length, 0);
});

test('caller-selected claim paths and extra request fields are rejected before claim access', async () => {
  const harness = await createHarness();
  const result = await executeOpenClawOc1GatewayRequest({
    ...harness.request,
    processingPath: 'C:/attacker/chosen.json',
  }, harness.options);
  assert.equal(result.success, false);
  assert.equal(result.error, 'OPENCLAW_OC1_GATEWAY_REQUEST_SHAPE_INVALID');
  assert.equal(harness.reads.length, 0);
  assert.equal(harness.spawn.calls.length, 0);
});

test('wrong task or source-head grant cannot redirect Gateway qualification', async () => {
  const harness = await createHarness();
  const wrongTask = await executeOpenClawOc1GatewayRequest({
    schemaVersion: OPENCLAW_OC1_GATEWAY_REQUEST_SCHEMA,
    actionGrant: grant({ actionId: '../wrong-task' }),
  }, harness.options);
  assert.equal(wrongTask.success, false);
  assert.equal(wrongTask.error, 'OPENCLAW_OC1_GATEWAY_GRANT_INVALID');

  const wrongHead = await executeOpenClawOc1GatewayRequest({
    schemaVersion: OPENCLAW_OC1_GATEWAY_REQUEST_SCHEMA,
    actionGrant: grant({ sourceRevision: 'not-a-sha' }),
  }, harness.options);
  assert.equal(wrongHead.success, false);
  assert.equal(wrongHead.error, 'OPENCLAW_OC1_GATEWAY_GRANT_INVALID');
});
