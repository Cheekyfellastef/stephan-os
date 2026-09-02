import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  BUILD_LANE_CAPACITY_RECEIPT_SCHEMA,
  BUILD_LANE_AUTHORITY_RECEIPT_SCHEMA,
  EXECUTION_SURFACE_FAILURE_CLASS,
  MISSION_CONTROLLER_LIVENESS,
  MISSION_CONTROLLER_ROUTE,
  createBuildLaneCapacityStatusRecord,
  createBuildLanePublisherAttestation,
  classifyExecutionSurfaceFailure,
  decideMissionControllerLiveness,
  publishBuildLaneCapacityToSharedWorkspace,
  routeMissionControllerCapacity,
  validateBuildLaneAuthorityReceipt,
  validateBuildLaneCapacityReceipt,
  validateBuildLaneCapacityStatusRecord,
  validateBuildLanePublisherAttestation,
} from './missionControllerCapacityRouterV1.mjs';

const NOW = '2026-08-10T12:00:00.000Z';
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const SOURCE_HEAD = 'a'.repeat(40);

function mission(overrides = {}) {
  return {
    missionId: 'critical-1292-routing-test',
    title: 'Repair the controller route',
    repository: REPOSITORY,
    currentPhase: 'REPAIR_REQUIRED',
    allowedFiles: ['shared/agents/controller.mjs'],
    requiredEvidence: ['focused tests'],
    dispatch: { adapter: 'codex', status: 'pending' },
    ...overrides,
  };
}

function codexStatus(overrides = {}) {
  return {
    schemaVersion: 'shared-agent-workspace-record.v1',
    statusId: 'codex-capacity-current',
    truthState: 'CURRENT',
    meterTruthUsable: true,
    observedAtUtc: '2026-08-10T11:58:00.000Z',
    remainingPercent: 80,
    availability: 'AVAILABLE',
    confidence: 'high',
    naturalResetAtUtc: '',
    ...overrides,
  };
}

function githubReceipt(overrides = {}) {
  return {
    schemaVersion: BUILD_LANE_CAPACITY_RECEIPT_SCHEMA,
    receiptId: 'github-builder-capacity-20260810t1159z',
    route: MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB,
    repository: REPOSITORY,
    workerId: 'shared-fabric-chatgpt-github-builder-01',
    state: 'READY',
    supportedOperations: ['SOURCE_CONSTRUCTION', 'FOCUSED_TESTS'],
    supportedTaskClasses: ['FOCUSED_REPAIR', 'MULTI_MODULE_IMPLEMENTATION'],
    observedAtUtc: '2026-08-10T11:59:00.000Z',
    expiresAtUtc: '2026-08-10T12:14:00.000Z',
    queueDepth: 0,
    p95StartLatencySeconds: 20,
    authorityReceiptIds: ['github-build-authority-001'],
    proofRefs: ['receipts/github-builder/capacity.json'],
    ...overrides,
  };
}

function executionSurfaceFailure(overrides = {}) {
  return {
    missionId: mission().missionId,
    repository: REPOSITORY,
    sourceHead: SOURCE_HEAD,
    route: MISSION_CONTROLLER_ROUTE.CODEX,
    reason: 'provider usage limit reached before execution receipt',
    errorCode: 'METER_EXHAUSTED',
    httpStatus: 0,
    attemptCount: 1,
    expectedReceiptObserved: false,
    observedAtUtc: '2026-08-10T11:59:30.000Z',
    ...overrides,
  };
}

function githubAuthority(overrides = {}) {
  return {
    schemaVersion: BUILD_LANE_AUTHORITY_RECEIPT_SCHEMA,
    receiptId: 'github-build-authority-001',
    route: MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB,
    repository: REPOSITORY,
    sourceHead: SOURCE_HEAD,
    workerId: githubReceipt().workerId,
    authorizedOperations: ['SOURCE_CONSTRUCTION', 'FOCUSED_TESTS'],
    authorizedTaskClasses: ['FOCUSED_REPAIR', 'MULTI_MODULE_IMPLEMENTATION'],
    issuedAtUtc: '2026-08-10T11:55:00.000Z',
    expiresAtUtc: '2026-08-10T13:00:00.000Z',
    proofRefs: ['receipts/github-builder/authority-proof.json'],
    sourceDispatchAllowed: true,
    sourceMutationAuthorityAdded: false,
    mergeAuthorityAdded: false,
    deploymentAuthorityAdded: false,
    runtimeMutationAuthorityAdded: false,
    protectedMergeDispatchAllowed: false,
    duplicateDispatchAllowed: false,
    arbitraryCommandAllowed: false,
    ...overrides,
  };
}

test('keeps an eligible implementation on Codex when fresh meter capacity covers it', () => {
  const result = routeMissionControllerCapacity({ nowUtc: NOW, mission: mission(), codexStatus: codexStatus() });
  assert.equal(result.route, MISSION_CONTROLLER_ROUTE.CODEX);
  assert.equal(result.adapter, 'codex');
  assert.equal(result.dispatchAllowed, true);
});

test('low Codex capacity routes an unowned source repair to a freshly proven GitHub builder', () => {
  const result = routeMissionControllerCapacity({
    nowUtc: NOW,
    mission: mission(),
    codexStatus: codexStatus({ remainingPercent: 3 }),
    githubLaneReceipt: githubReceipt(),
    githubLaneAuthorityReceipts: [githubAuthority()],
    sourceHead: SOURCE_HEAD,
  });
  assert.equal(result.codex.dispatchAllowed, false);
  assert.equal(result.route, MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB);
  assert.equal(result.adapter, 'chatgpt-github');
  assert.equal(result.dispatchAllowed, true);
  assert.equal(result.selectedCapacityReceiptId, githubReceipt().receiptId);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.duplicateDispatchAllowed, false);
});

test('fresh missing-receipt provider exhaustion is classified without widening authority', () => {
  const result = classifyExecutionSurfaceFailure(executionSurfaceFailure(), {
    nowUtc: NOW,
    missionId: mission().missionId,
    repository: REPOSITORY,
    sourceHead: SOURCE_HEAD,
  });
  assert.equal(result.valid, true);
  assert.equal(result.classification, EXECUTION_SURFACE_FAILURE_CLASS.PROVIDER_EXHAUSTION);
  assert.equal(result.reroutable, true);
  assert.equal(result.expectedReceiptObserved, false);
});

test('failed Codex execution surface reroutes the same exact mission to proven GitHub capacity', () => {
  const result = routeMissionControllerCapacity({
    nowUtc: NOW,
    sourceHead: SOURCE_HEAD,
    mission: mission(),
    codexStatus: codexStatus(),
    githubLaneReceipt: githubReceipt(),
    githubLaneAuthorityReceipts: [githubAuthority()],
    executionSurfaceFailure: executionSurfaceFailure(),
  });
  assert.equal(result.route, MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB);
  assert.equal(result.adapter, 'chatgpt-github');
  assert.equal(result.dispatchAllowed, true);
  assert.equal(result.finalVerdict, 'MISSION_CONTROLLER_EXECUTION_SURFACE_REROUTED');
  assert.equal(result.executionSurfaceFailure.classification, EXECUTION_SURFACE_FAILURE_CLASS.PROVIDER_EXHAUSTION);
  assert.equal(result.duplicateDispatchAllowed, false);
  assert.equal(result.mergeAuthority, false);
});

test('execution-surface failure suppresses only the failed route and keeps the controller enabled', () => {
  const result = routeMissionControllerCapacity({
    nowUtc: NOW,
    sourceHead: SOURCE_HEAD,
    mission: mission(),
    codexStatus: codexStatus(),
    githubLaneReceipt: githubReceipt(),
    githubLaneAuthorityReceipts: [githubAuthority()],
    executionSurfaceFailure: executionSurfaceFailure(),
  });
  assert.equal(result.controllerLiveness.state, MISSION_CONTROLLER_LIVENESS.KEEP_ENABLED);
  assert.equal(result.controllerLiveness.keepEnabled, true);
  assert.equal(result.controllerLiveness.disableAllowed, false);
  assert.equal(result.executionSurfaceFailure.route, MISSION_CONTROLLER_ROUTE.CODEX);
  assert.equal(result.executionSurfaceFailure.suppressRouteUntilUtc, '2026-08-10T12:15:00.000Z');
  assert.equal(result.route, MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB);
});

test('controller disablement requires explicit operator disable or proved SAFE_HOLD', () => {
  const ordinaryFailure = decideMissionControllerLiveness({
    executionSurfaceUnavailable: true,
  });
  assert.equal(ordinaryFailure.state, MISSION_CONTROLLER_LIVENESS.KEEP_ENABLED);
  assert.equal(ordinaryFailure.disableAllowed, false);

  const unprovedSafeHold = decideMissionControllerLiveness({
    safeHold: true,
    contradictoryEvidenceProved: false,
  });
  assert.equal(unprovedSafeHold.state, MISSION_CONTROLLER_LIVENESS.KEEP_ENABLED);
  assert.equal(unprovedSafeHold.disableAllowed, false);

  const provedSafeHold = decideMissionControllerLiveness({
    safeHold: true,
    contradictoryEvidenceProved: true,
  });
  assert.equal(provedSafeHold.state, MISSION_CONTROLLER_LIVENESS.DISABLE_SAFE_HOLD);
  assert.equal(provedSafeHold.disableAllowed, true);

  const operatorDisable = decideMissionControllerLiveness({
    explicitOperatorDisable: true,
  });
  assert.equal(operatorDisable.state, MISSION_CONTROLLER_LIVENESS.DISABLE_OPERATOR_REQUESTED);
  assert.equal(operatorDisable.disableAllowed, true);
});

test('source or test failure is parked instead of being misclassified as provider failover', () => {
  const result = routeMissionControllerCapacity({
    nowUtc: NOW,
    sourceHead: SOURCE_HEAD,
    mission: mission(),
    codexStatus: codexStatus(),
    githubLaneReceipt: githubReceipt(),
    githubLaneAuthorityReceipts: [githubAuthority()],
    executionSurfaceFailure: executionSurfaceFailure({
      reason: 'focused regression test assertion failed',
      errorCode: 'TEST_FAILURE',
    }),
  });
  assert.equal(result.route, MISSION_CONTROLLER_ROUTE.WAIT_FOR_PROVEN_CAPACITY);
  assert.equal(result.dispatchAllowed, false);
  assert.equal(result.finalVerdict, 'MISSION_CONTROLLER_EXECUTION_FAILURE_PARKED');
  assert.equal(result.executionSurfaceFailure.classification, EXECUTION_SURFACE_FAILURE_CLASS.SOURCE_OR_TEST_FAILURE);
});

test('unbounded retries or a receipt-present observation cannot suppress a healthy route', () => {
  for (const observation of [
    executionSurfaceFailure({ attemptCount: 3 }),
    executionSurfaceFailure({ expectedReceiptObserved: true }),
    executionSurfaceFailure({ sourceHead: 'b'.repeat(40) }),
  ]) {
    const result = routeMissionControllerCapacity({
      nowUtc: NOW,
      sourceHead: SOURCE_HEAD,
      mission: mission(),
      codexStatus: codexStatus(),
      githubLaneReceipt: githubReceipt(),
      githubLaneAuthorityReceipts: [githubAuthority()],
      executionSurfaceFailure: observation,
    });
    assert.equal(result.route, MISSION_CONTROLLER_ROUTE.WAIT_FOR_PROVEN_CAPACITY);
    assert.equal(result.dispatchAllowed, false);
    assert.equal(result.finalVerdict, 'MISSION_CONTROLLER_CAPACITY_BLOCKED');
    assert.ok(result.blockers.includes('execution-surface-failure-observation-invalid'));
  }
});

test('missing or stale meter truth cannot be silently treated as Codex capacity', () => {
  for (const status of [undefined, codexStatus({ observedAtUtc: '2026-08-10T11:00:00.000Z' })]) {
    const result = routeMissionControllerCapacity({ nowUtc: NOW, mission: mission(), codexStatus: status });
    assert.equal(result.route, MISSION_CONTROLLER_ROUTE.WAIT_FOR_PROVEN_CAPACITY);
    assert.equal(result.dispatchAllowed, false);
    assert.ok(result.blockers.includes('codex-capacity-unavailable'));
  }
});

test('an existing running dispatch wins over meter changes and fallback receipts', () => {
  const result = routeMissionControllerCapacity({
    nowUtc: NOW,
    mission: mission({ dispatch: { adapter: 'codex', status: 'running' } }),
    codexStatus: codexStatus({ remainingPercent: 0, availability: 'METER_STALLED' }),
    githubLaneReceipt: githubReceipt(),
  });
  assert.equal(result.dispatchAllowed, false);
  assert.equal(result.adapter, 'codex');
  assert.ok(result.blockers.includes('existing-agent-dispatch-owns-mission'));
});

test('Windows-bound work is not sent to a GitHub-only construction lane', () => {
  const result = routeMissionControllerCapacity({
    nowUtc: NOW,
    mission: mission({
      allowedFiles: ['scripts/windows/repair-worker.ps1'],
      requiredEvidence: ['Windows runtime proof'],
    }),
    codexStatus: codexStatus({ remainingPercent: 3 }),
    githubLaneReceipt: githubReceipt({ supportedTaskClasses: ['WINDOWS_RUNTIME_PROOF'] }),
  });
  assert.equal(result.route, MISSION_CONTROLLER_ROUTE.WAIT_FOR_PROVEN_CAPACITY);
  assert.ok(result.blockers.includes('proven-windows-capable-fallback-unavailable'));
});

test('fallback receipts must be exact, fresh, bounded and repository-scoped', () => {
  assert.equal(validateBuildLaneCapacityReceipt(githubReceipt(), {
    repository: REPOSITORY,
    taskClass: 'FOCUSED_REPAIR',
    nowUtc: NOW,
  }).valid, true);
  assert.equal(validateBuildLaneCapacityReceipt(githubReceipt({ queueDepth: -1 }), {
    repository: REPOSITORY,
    taskClass: 'FOCUSED_REPAIR',
    nowUtc: NOW,
  }).valid, false);
  assert.equal(validateBuildLaneCapacityReceipt(githubReceipt({ expiresAtUtc: '2026-08-10T11:59:30.000Z' }), {
    repository: REPOSITORY,
    taskClass: 'FOCUSED_REPAIR',
    nowUtc: NOW,
  }).valid, false);
  assert.equal(validateBuildLaneCapacityReceipt(githubReceipt({ authorityReceiptIds: ['a'.repeat(77)] }), {
    repository: REPOSITORY,
    taskClass: 'FOCUSED_REPAIR',
    nowUtc: NOW,
  }).valid, false);
  for (const workerId of ['worker/name', 'worker:name', 'worker@name', 'w'.repeat(82)]) {
    assert.equal(validateBuildLaneCapacityReceipt(githubReceipt({ workerId }), {
      repository: REPOSITORY,
      taskClass: 'FOCUSED_REPAIR',
      nowUtc: NOW,
    }).valid, false, workerId);
  }
});

test('GitHub fallback requires an independently supplied exact authority chain', () => {
  const base = {
    nowUtc: NOW,
    sourceHead: SOURCE_HEAD,
    mission: mission(),
    codexStatus: codexStatus({ remainingPercent: 3 }),
    githubLaneReceipt: githubReceipt(),
  };
  for (const authorityReceipts of [
    [],
    [githubAuthority({ workerId: 'foreign-github-worker' })],
    [githubAuthority({ sourceHead: 'b'.repeat(40) })],
    [githubAuthority({ sourceDispatchAllowed: false })],
  ]) {
    const result = routeMissionControllerCapacity({ ...base, githubLaneAuthorityReceipts: authorityReceipts });
    assert.equal(result.route, MISSION_CONTROLLER_ROUTE.WAIT_FOR_PROVEN_CAPACITY);
    assert.equal(result.dispatchAllowed, false);
  }
  const allowed = routeMissionControllerCapacity({ ...base, githubLaneAuthorityReceipts: [githubAuthority()] });
  assert.equal(allowed.route, MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB);
  assert.equal(allowed.workerId, githubReceipt().workerId);
  assert.ok(allowed.proofRefs.includes('receipts/github-builder/authority-proof.json'));
});

test('authority receipts reject any operation outside the exact source-only allowlist', () => {
  const expected = {
    receiptId: githubAuthority().receiptId,
    route: MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB,
    repository: REPOSITORY,
    sourceHead: SOURCE_HEAD,
    workerId: githubReceipt().workerId,
    taskClass: 'FOCUSED_REPAIR',
    nowUtc: NOW,
  };
  assert.equal(validateBuildLaneAuthorityReceipt(githubAuthority(), expected).valid, true);
  for (const privilegedOperation of ['MERGE_PULL_REQUEST', 'ARBITRARY_SHELL', 'DEPLOY_RUNTIME']) {
    const widened = githubAuthority({
      authorizedOperations: ['SOURCE_CONSTRUCTION', 'FOCUSED_TESTS', privilegedOperation],
    });
    assert.equal(validateBuildLaneAuthorityReceipt(widened, expected).valid, false, privilegedOperation);
  }
});

test('capacity status requires the exact STATUS envelope and rejects outer authority widening', () => {
  const status = createBuildLaneCapacityStatusRecord(githubReceipt(), { nowUtc: NOW });
  const expected = {
    route: MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB,
    repository: REPOSITORY,
    nowUtc: NOW,
  };
  assert.equal(validateBuildLaneCapacityStatusRecord(status, expected).valid, true);
  assert.equal(validateBuildLaneCapacityStatusRecord({
    ...status,
    kind: 'stephanos.shared_workspace.goal',
  }, expected).valid, false);
  assert.equal(validateBuildLaneCapacityStatusRecord({
    ...status,
    duplicateDispatchAllowed: true,
  }, expected).valid, false);
  assert.equal(validateBuildLaneCapacityStatusRecord({
    ...status,
    sourceMutationAllowed: true,
  }, expected).valid, false);
});

test('GitHub publisher attestation binds the exact status and independently loaded authority set', () => {
  const publisher = generateKeyPairSync('ed25519');
  const foreignPublisher = generateKeyPairSync('ed25519');
  const privateKeyPem = publisher.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicKeyPem = publisher.publicKey.export({ type: 'spki', format: 'pem' });
  const foreignPublicKeyPem = foreignPublisher.publicKey.export({ type: 'spki', format: 'pem' });
  const status = createBuildLaneCapacityStatusRecord(githubReceipt(), { nowUtc: NOW });
  const authority = githubAuthority();
  const attestation = createBuildLanePublisherAttestation(status, [authority], privateKeyPem);

  assert.ok(attestation);
  assert.equal(validateBuildLanePublisherAttestation(attestation, status, [authority], publicKeyPem), true);
  assert.equal(validateBuildLanePublisherAttestation(attestation, status, [authority], foreignPublicKeyPem), false);
  assert.equal(validateBuildLanePublisherAttestation(attestation, {
    ...status,
    summary: 'Substituted capacity summary.',
  }, [authority], publicKeyPem), false);
  assert.equal(validateBuildLanePublisherAttestation(attestation, status, [{
    ...authority,
    workerId: 'foreign-github-worker',
  }], publicKeyPem), false);
  assert.equal(validateBuildLanePublisherAttestation({
    ...attestation,
    mergeAuthority: true,
  }, status, [authority], publicKeyPem), false);
  assert.equal(validateBuildLanePublisherAttestation({
    ...attestation,
    statusDigest: `sha256:${'0'.repeat(64)}`,
  }, status, [authority], publicKeyPem), false);
  assert.equal(validateBuildLanePublisherAttestation(attestation, status, [], publicKeyPem), false);
});

test('a lane worker can publish its fresh capacity receipt to the canonical fabric status path', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'build-lane-capacity-'));
  const root = join(parent, 'workspace');
  const record = createBuildLaneCapacityStatusRecord(githubReceipt(), { nowUtc: NOW });
  assert.equal(record.statusId, 'chatgpt-github-build-capacity-current');
  assert.equal(record.capacityReceipt.receiptId, githubReceipt().receiptId);
  const publication = await publishBuildLaneCapacityToSharedWorkspace(root, githubReceipt(), {
    nowUtc: NOW,
    repoRoot: join(parent, 'repo'),
  });
  assert.equal(publication.ok, true, publication.reason);
  const persisted = JSON.parse(await readFile(join(root, 'status', 'chatgpt-github-build-capacity-current.json'), 'utf8'));
  assert.equal(persisted.capacityReceipt.route, 'CHATGPT_GITHUB');
  assert.equal(persisted.mergeAuthority, false);
});
