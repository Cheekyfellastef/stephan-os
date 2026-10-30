import assert from 'node:assert/strict';
import test from 'node:test';

import { runSupervisedMissionWorker } from './mission-orchestrator-worker-supervised.mjs';

const NOW = '2026-09-03T12:30:00.000Z';
const HEAD = 'a'.repeat(40);
const WORKSPACE = 'C:\\Users\\Stephan\\Documents\\Stephanos-openclaw-workspace';
const REPOSITORY_ROOT = 'C:\\Users\\Stephan\\Documents\\GitHub\\stephan-os';

function sink() {
  return { write() {} };
}

function canonicalIdentity() {
  return {
    valid: true,
    canonical: true,
    branch: 'main',
    headSha: HEAD,
    sourceClean: true,
    worktreeClean: true,
    runtimeDirtCount: 0,
    blocker: '',
  };
}

function baseOptions(overrides = {}) {
  return {
    argv: ['--once'],
    env: {
      STEPHANOS_SHARED_AGENT_WORKSPACE: WORKSPACE,
      STEPHANOS_MISSION_WORKER_REPOSITORY_ROOT: REPOSITORY_ROOT,
      STEPHANOS_MISSION_WORKER_HEAD_SHA: HEAD,
    },
    stdout: sink(),
    stderr: sink(),
    bootstrapMailbox: async () => ({ ok: true, status: 'MAILBOX_ALREADY_REGISTERED' }),
    inspectRepositoryIdentity: canonicalIdentity,
    writeHeartbeat: async () => {},
    setIntervalFn: () => 17,
    clearIntervalFn: () => {},
    now: () => NOW,
    ...overrides,
  };
}

test('supervised worker replays a capacity-scoped grant with a fresh canonical capacity snapshot', async () => {
  const actionGrant = Object.freeze({
    schemaVersion: 'stephanos.mission-worker-action-grant.v1',
    missionId: 'capacity-replay-test',
    actionId: 'capacity-replay-test-r1-action',
    adapter: 'foundry-forge',
    capacityRoute: 'FOUNDRY_FORGE',
    capacityReceiptId: 'forge-capacity-current',
    capacityProofRefs: Object.freeze(['receipts/forge-capacity-current.json']),
    boundedActionCount: 1,
  });
  const capacityRouting = Object.freeze({
    nowUtc: NOW,
    codexStatus: null,
    githubLaneReceipt: null,
    forgeLaneReceipt: Object.freeze({ receiptId: 'forge-capacity-current' }),
    forgeSidecar: Object.freeze({ state: 'READY' }),
  });
  let controllerOptions;
  let loaderOptions;
  let tickOptions;

  const exitCode = await runSupervisedMissionWorker(baseOptions({
    runControllerCycle: async (_machinery, options) => {
      controllerOptions = options;
      return { status: 'ACTIVE', allowWorkerTick: true, workerActionGrant: actionGrant };
    },
    loadCapacityRoutingInput: async (options) => {
      loaderOptions = options;
      return capacityRouting;
    },
    runTick: async (options) => {
      tickOptions = options;
      return { publish: { published: true } };
    },
  }));

  assert.equal(exitCode, 0);
  assert.equal(controllerOptions.root, WORKSPACE);
  assert.equal(controllerOptions.repoRoot, REPOSITORY_ROOT);
  assert.equal(controllerOptions.nowUtc, NOW);
  assert.equal(controllerOptions.sourceRevision, HEAD);
  assert.deepEqual(loaderOptions, {
    root: WORKSPACE,
    repoRoot: REPOSITORY_ROOT,
    nowUtc: NOW,
  });
  assert.strictEqual(tickOptions.actionGrant, actionGrant);
  assert.strictEqual(tickOptions.capacityRouting, capacityRouting);
});

test('supervised worker never manufactures capacity when a scoped grant cannot reload it', async () => {
  const actionGrant = Object.freeze({
    schemaVersion: 'stephanos.mission-worker-action-grant.v1',
    missionId: 'capacity-missing-test',
    actionId: 'capacity-missing-test-r1-action',
    adapter: 'codex',
    capacityRoute: 'CODEX',
    boundedActionCount: 1,
  });
  let observedCapacity = Symbol('unobserved');

  const exitCode = await runSupervisedMissionWorker(baseOptions({
    runControllerCycle: async () => ({
      status: 'ACTIVE',
      allowWorkerTick: true,
      workerActionGrant: actionGrant,
    }),
    loadCapacityRoutingInput: async () => null,
    runTick: async (options) => {
      observedCapacity = options.capacityRouting;
      return { publish: { published: false } };
    },
  }));

  assert.equal(exitCode, 0);
  assert.equal(observedCapacity, null);
});

test('non-capacity worker grants do not acquire an unnecessary provider dependency', async () => {
  const actionGrant = Object.freeze({
    schemaVersion: 'stephanos.mission-worker-action-grant.v1',
    missionId: 'worktree-test',
    actionId: 'worktree-test-r1-action',
    adapter: 'openclaw-signed',
    capacityRoute: '',
    boundedActionCount: 1,
  });
  let loaderCalls = 0;
  let observedCapacity = Symbol('unobserved');

  const exitCode = await runSupervisedMissionWorker(baseOptions({
    runControllerCycle: async () => ({
      status: 'ACTIVE',
      allowWorkerTick: true,
      workerActionGrant: actionGrant,
    }),
    loadCapacityRoutingInput: async () => {
      loaderCalls += 1;
      return { unsafe: true };
    },
    runTick: async (options) => {
      observedCapacity = options.capacityRouting;
      return { publish: { published: true } };
    },
  }));

  assert.equal(exitCode, 0);
  assert.equal(loaderCalls, 0);
  assert.equal(observedCapacity, undefined);
});
