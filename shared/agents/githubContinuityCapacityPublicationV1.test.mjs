import assert from 'node:assert/strict';
import test from 'node:test';
import { access, mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  GITHUB_CONTINUITY_CAPACITY_PUBLICATION_STATE,
  buildGitHubContinuityCapacityPublicationV1,
  publishGitHubContinuityCapacityPublicationV1,
} from './githubContinuityCapacityPublicationV1.mjs';
import {
  MISSION_CONTROLLER_ROUTE,
  routeMissionControllerCapacity,
  validateBuildLaneCapacityReceipt,
} from './missionControllerCapacityRouterV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const OBSERVED = '2026-08-17T16:00:00.000Z';
const NOW = '2026-08-17T16:01:00.000Z';

function observation(overrides = {}) {
  return {
    receiptId: 'github-continuity-capacity-20260817t1600z',
    route: MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB,
    repository: REPOSITORY,
    workerId: 'shared-fabric-chatgpt-github-builder-01',
    supportedTaskClasses: ['FOCUSED_REPAIR', 'MULTI_MODULE_IMPLEMENTATION'],
    observedAtUtc: OBSERVED,
    expiresAtUtc: '2026-08-17T16:04:00.000Z',
    queueDepth: 0,
    p95StartLatencySeconds: 15,
    authorityReceiptIds: [],
    proofRefs: ['receipts/github-builder/exact-host-persistence.json'],
    ...overrides,
  };
}

function mission() {
  return {
    missionId: 'goal-1624-music-capacity-regression',
    title: 'Continue source construction when Codex is exhausted',
    repository: REPOSITORY,
    currentPhase: 'REPAIR_REQUIRED',
    allowedFiles: ['apps/stephanos/src/musicDiscoverySpotlight.js'],
    requiredEvidence: ['focused tests'],
    dispatch: { adapter: 'codex', status: 'pending' },
  };
}

function exhaustedCodexStatus() {
  return {
    schemaVersion: 'shared-agent-workspace-record.v1',
    statusId: 'codex-capacity-current',
    truthState: 'CURRENT',
    meterTruthUsable: true,
    observedAtUtc: OBSERVED,
    remainingPercent: 0,
    availability: 'METER_STALLED',
    confidence: 'high',
    naturalResetAtUtc: '',
  };
}

test('builds the existing canonical receipt shape from a fresh proven GitHub writer observation', () => {
  const result = buildGitHubContinuityCapacityPublicationV1(observation());
  assert.equal(result.state, GITHUB_CONTINUITY_CAPACITY_PUBLICATION_STATE.READY);
  assert.equal(result.receipt.route, MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB);
  assert.deepEqual(result.receipt.supportedOperations, ['SOURCE_CONSTRUCTION', 'FOCUSED_TESTS']);
  assert.equal(validateBuildLaneCapacityReceipt(result.receipt, {
    repository: REPOSITORY,
    taskClass: 'FOCUSED_REPAIR',
    nowUtc: NOW,
  }).valid, true);
  assert.equal(result.authority.mergeAuthorityAdded, false);
  assert.equal(result.authority.runtimeMutationAuthorityAdded, false);
});

test('fresh M4 capacity evidence routes exhausted-Codex source work to the existing GitHub lane', () => {
  const built = buildGitHubContinuityCapacityPublicationV1(observation());
  const routed = routeMissionControllerCapacity({
    nowUtc: NOW,
    mission: mission(),
    codexStatus: exhaustedCodexStatus(),
    githubLaneReceipt: built.receipt,
  });
  assert.equal(routed.route, MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB);
  assert.equal(routed.adapter, 'chatgpt-github');
  assert.equal(routed.dispatchAllowed, true);
  assert.equal(routed.selectedCapacityReceiptId, built.receipt.receiptId);
  assert.equal(routed.mergeAuthority, false);
  assert.equal(routed.duplicateDispatchAllowed, false);
});

test('publishes the receipt through the existing Shared Workspace status writer rather than a second queue', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'github-continuity-capacity-'));
  const root = join(parent, 'workspace');
  const result = await publishGitHubContinuityCapacityPublicationV1(root, observation(), { nowUtc: NOW });
  assert.equal(result.publication.ok, true, result.publication.reason);
  const persisted = JSON.parse(await readFile(join(root, 'status', 'chatgpt-github-build-capacity-current.json'), 'utf8'));
  assert.equal(persisted.capacityReceipt.receiptId, observation().receiptId);
  assert.equal(persisted.capacityReceipt.route, MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB);
  assert.equal(persisted.sourceMutationAllowed, false);
  assert.equal(persisted.mergeAuthority, false);
});

test('rejects evidence that expires before publication and admits no current Shared Workspace truth', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'github-continuity-capacity-expired-'));
  const root = join(parent, 'workspace');
  const result = await publishGitHubContinuityCapacityPublicationV1(root, observation({
    observedAtUtc: '2026-08-17T16:00:00.000Z',
    expiresAtUtc: '2026-08-17T16:03:00.000Z',
  }), {
    nowUtc: '2026-08-17T16:03:00.001Z',
  });

  assert.equal(result.state, GITHUB_CONTINUITY_CAPACITY_PUBLICATION_STATE.SAFE_HOLD);
  assert.equal(result.blocker, 'capacity-observation-not-current-at-publication');
  assert.equal(result.receipt, null);
  assert.equal(Object.hasOwn(result, 'publication'), false);
  await assert.rejects(access(root), { code: 'ENOENT' });
});

test('fails closed on stale/overlong evidence, Codex masquerading and missing proof references', () => {
  for (const candidate of [
    observation({ expiresAtUtc: '2026-08-17T16:10:00.000Z' }),
    observation({ route: MISSION_CONTROLLER_ROUTE.CODEX }),
    observation({ proofRefs: [] }),
    observation({ queueDepth: -1 }),
  ]) {
    const result = buildGitHubContinuityCapacityPublicationV1(candidate);
    assert.equal(result.state, GITHUB_CONTINUITY_CAPACITY_PUBLICATION_STATE.SAFE_HOLD);
    assert.equal(result.receipt, null);
  }
});

test('rejects accessor-bearing observations without invoking the accessor', () => {
  let calls = 0;
  const candidate = observation();
  Object.defineProperty(candidate, 'workerId', {
    enumerable: true,
    get() {
      calls += 1;
      return 'attacker-controlled-writer';
    },
  });
  const result = buildGitHubContinuityCapacityPublicationV1(candidate);
  assert.equal(result.state, GITHUB_CONTINUITY_CAPACITY_PUBLICATION_STATE.SAFE_HOLD);
  assert.equal(calls, 0);
});
