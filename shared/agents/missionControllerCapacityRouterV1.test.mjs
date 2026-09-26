import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  BUILD_LANE_CAPACITY_RECEIPT_SCHEMA,
  FORGE_LIFEBOAT_WORKER_ID,
  MISSION_CONTROLLER_ROUTE,
  createBuildLaneCapacityStatusRecord,
  forgeLifeboatAuthorityReceiptId,
  forgeLifeboatProofRef,
  publishBuildLaneCapacityToSharedWorkspace,
  routeMissionControllerCapacity,
  validateBuildLaneCapacityReceipt,
} from './missionControllerCapacityRouterV1.mjs';
import {
  createStephanosNativeCapacityReceipt,
  createStephanosNativeSourceAuthority,
} from './stephanosNativeCapacityReceiptV1.mjs';
import {
  isVerifiedStephanosNativeRoutingCandidate,
  readVerifiedStephanosNativeRoutingCandidate,
} from './stephanosNativeCapacityRoutingAdmissionV1.mjs';

const NOW = '2026-08-10T12:00:00.000Z';
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const SOURCE_HEAD = 'a'.repeat(40);
const NATIVE_WORKER_ID = 'stephanos-native-battle-bridge';
const NATIVE_KEY_ID = 'stephanos-native-capacity-key-v1';

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
    authorityReceiptIds: [],
    proofRefs: ['receipts/github-builder/capacity.json'],
    ...overrides,
  };
}

function forgeReceipt(overrides = {}) {
  return {
    ...githubReceipt(),
    receiptId: 'forge-builder-capacity-20260810t1159z',
    route: MISSION_CONTROLLER_ROUTE.FOUNDRY_FORGE,
    workerId: 'stephanos-forge-builder-01',
    authorityReceiptIds: ['forge-m2-runtime-001', 'forge-m3-runtime-001'],
    proofRefs: ['receipts/forge-builder/capacity.json'],
    ...overrides,
  };
}

function lifeboatReceipt(sourceHead = SOURCE_HEAD, overrides = {}) {
  return {
    ...forgeReceipt(),
    receiptId: 'forge-lifeboat-capacity-20260810t1159z',
    workerId: FORGE_LIFEBOAT_WORKER_ID,
    queueDepth: 0,
    p95StartLatencySeconds: 3,
    authorityReceiptIds: [forgeLifeboatAuthorityReceiptId(sourceHead)],
    proofRefs: [forgeLifeboatProofRef(sourceHead)],
    ...overrides,
  };
}

function nativeKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

function nativeStatus(keyPair, overrides = {}) {
  const payload = {
    schemaVersion: 'stephanos.native-capacity-payload.v1',
    receiptId: 'native-capacity-aaaaaaaaaaaa-20260810115900',
    repository: REPOSITORY,
    sourceHead: SOURCE_HEAD,
    workerId: NATIVE_WORKER_ID,
    provider: 'ollama-local',
    transport: 'http-loopback-fixed',
    endpoint: 'http://127.0.0.1:11434',
    model: 'qwen:14b',
    modelInventorySha256: '1'.repeat(64),
    qualificationId: 'native-source-qualification-v1',
    supportedTaskClasses: ['FOCUSED_REPAIR'],
    supportedOperations: ['SOURCE_CONSTRUCTION', 'FOCUSED_TESTS'],
    observedAtUtc: '2026-08-10T11:59:00.000Z',
    expiresAtUtc: '2026-08-10T12:04:00.000Z',
    queueDepth: 0,
    p95StartLatencySeconds: 2,
    loadState: 'READY',
    requestSha256: '2'.repeat(64),
    responseSha256: '3'.repeat(64),
    proofRefs: ['proof/native-capacity-runtime-test.json'],
    ...(overrides.payload || {}),
  };
  const capacityReceipt = createStephanosNativeCapacityReceipt(payload, {
    privateKeyPem: keyPair.privateKeyPem,
    keyId: NATIVE_KEY_ID,
  });
  const expected = {
    repository: REPOSITORY,
    sourceHead: payload.sourceHead,
    workerId: NATIVE_WORKER_ID,
    nowUtc: NOW,
    keyId: NATIVE_KEY_ID,
  };
  const sourceAuthority = createStephanosNativeSourceAuthority(capacityReceipt, {
    publicKeyPem: keyPair.publicKeyPem,
    expected,
  });
  const receiptSha256 = createHash('sha256').update(JSON.stringify(capacityReceipt)).digest('hex');
  return {
    schemaVersion: 'shared-agent-workspace-record.v1',
    statusId: 'stephanos-native-capacity-current',
    participantId: NATIVE_WORKER_ID,
    timestampUtc: payload.observedAtUtc,
    status: 'READY',
    capacityReceipt,
    sourceAuthority,
    publisherAttestation: {
      keyId: NATIVE_KEY_ID,
      receiptSha256,
      sourceHead: payload.sourceHead,
      proofRef: payload.proofRefs[0],
    },
    sourceMutationAllowed: true,
    supportedOperations: ['SOURCE_CONSTRUCTION', 'FOCUSED_TESTS'],
    arbitraryCommandAllowed: false,
    mergeAuthority: false,
    leaseSeizureAllowed: false,
    duplicateDispatchAllowed: false,
    ...(overrides.status || {}),
  };
}

async function nativeFixture(options = {}) {
  const parent = await mkdtemp(join(tmpdir(), 'native-routing-'));
  const root = join(parent, 'workspace');
  const repoRoot = join(parent, 'repo');
  const missionRunnerRoot = join(parent, 'mission-runner');
  const keyDir = join(missionRunnerRoot, 'keys');
  await mkdir(join(root, 'status'), { recursive: true });
  await mkdir(repoRoot, { recursive: true });
  await mkdir(keyDir, { recursive: true });
  const signer = nativeKeyPair();
  const status = nativeStatus(signer, options.statusOverrides);
  await writeFile(join(root, 'status', 'stephanos-native-capacity-current.json'), `${JSON.stringify(status, null, 2)}\n`, 'utf8');
  if (!options.omitPublicKey) {
    await writeFile(
      join(keyDir, 'stephanos-native-capacity-public.pem'),
      options.publicKeyPem || signer.publicKeyPem,
      'utf8',
    );
  }
  return { root, repoRoot, env: { STEPHANOS_MISSION_RUNNER_ROOT: missionRunnerRoot } };
}

async function verifiedNativeAdmission(options = {}) {
  const fixture = await nativeFixture(options);
  return readVerifiedStephanosNativeRoutingCandidate({
    ...fixture,
    repository: REPOSITORY,
    sourceHead: options.sourceHead || SOURCE_HEAD,
    taskClass: options.taskClass || 'FOCUSED_REPAIR',
    nowUtc: NOW,
  });
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
  });
  assert.equal(result.codex.dispatchAllowed, false);
  assert.equal(result.route, MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB);
  assert.equal(result.adapter, 'chatgpt-github');
  assert.equal(result.dispatchAllowed, true);
  assert.equal(result.selectedCapacityReceiptId, githubReceipt().receiptId);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.duplicateDispatchAllowed, false);
});

test('Lane 6 routes a source-only repair from the exact-head local lifeboat receipt without Forge sidecar M2/M3', () => {
  const result = routeMissionControllerCapacity({
    nowUtc: NOW,
    sourceHead: SOURCE_HEAD,
    mission: mission(),
    codexStatus: codexStatus({ remainingPercent: 0, availability: 'METER_STALLED' }),
    forgeLaneReceipt: lifeboatReceipt(),
  });
  assert.equal(result.route, MISSION_CONTROLLER_ROUTE.FOUNDRY_FORGE);
  assert.equal(result.adapter, 'foundry-forge');
  assert.equal(result.workerId, FORGE_LIFEBOAT_WORKER_ID);
  assert.equal(result.dispatchAllowed, true);
  assert.equal(result.selectedCapacityReceiptId, lifeboatReceipt().receiptId);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.leaseSeizureAllowed, false);
  assert.equal(result.duplicateDispatchAllowed, false);
});

test('ordinary Forge capacity still cannot self-admit without the existing M2/M3 sidecar proof', () => {
  const result = routeMissionControllerCapacity({
    nowUtc: NOW,
    sourceHead: SOURCE_HEAD,
    mission: mission(),
    codexStatus: codexStatus({ remainingPercent: 0, availability: 'METER_STALLED' }),
    forgeLaneReceipt: forgeReceipt(),
  });
  assert.equal(result.route, MISSION_CONTROLLER_ROUTE.WAIT_FOR_PROVEN_CAPACITY);
  assert.equal(result.dispatchAllowed, false);
});

test('Lane 6 receipt is rejected when its authority or proof is bound to another source head', () => {
  const otherHead = 'b'.repeat(40);
  for (const receipt of [
    lifeboatReceipt(otherHead),
    lifeboatReceipt(SOURCE_HEAD, { authorityReceiptIds: ['forge-lifeboat-local-source-wrong'] }),
    lifeboatReceipt(SOURCE_HEAD, { proofRefs: ['proof/forge-lifeboat-local-capacity-wrong.json'] }),
  ]) {
    const result = routeMissionControllerCapacity({
      nowUtc: NOW,
      sourceHead: SOURCE_HEAD,
      mission: mission(),
      codexStatus: codexStatus({ remainingPercent: 0, availability: 'METER_STALLED' }),
      forgeLaneReceipt: receipt,
    });
    assert.equal(result.route, MISSION_CONTROLLER_ROUTE.WAIT_FOR_PROVEN_CAPACITY);
    assert.equal(result.dispatchAllowed, false);
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

test('Windows/runtime work is never sent through the simple Lane 6 lifeboat', () => {
  const result = routeMissionControllerCapacity({
    nowUtc: NOW,
    sourceHead: SOURCE_HEAD,
    mission: mission({
      allowedFiles: ['scripts/windows/repair-worker.ps1'],
      requiredEvidence: ['Windows runtime proof'],
    }),
    task: { taskClass: 'WINDOWS_RUNTIME_PROOF', windowsBound: true },
    codexStatus: codexStatus({ remainingPercent: 0, availability: 'METER_STALLED' }),
    forgeLaneReceipt: lifeboatReceipt(SOURCE_HEAD, { supportedTaskClasses: ['WINDOWS_RUNTIME_PROOF'] }),
  });
  assert.equal(result.route, MISSION_CONTROLLER_ROUTE.WAIT_FOR_PROVEN_CAPACITY);
  assert.equal(result.dispatchAllowed, false);
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
});

test('OpenClaw is a first-class route identity but generic build-lane receipts cannot self-admit it', () => {
  assert.equal(MISSION_CONTROLLER_ROUTE.OPENCLAW_LOCAL, 'OPENCLAW_LOCAL');
  const forgedGenericOpenClaw = githubReceipt({
    receiptId: 'openclaw-generic-capacity-20260810t1159z',
    route: MISSION_CONTROLLER_ROUTE.OPENCLAW_LOCAL,
    workerId: 'openclaw-worker-01',
    proofRefs: ['receipts/openclaw/capacity.json'],
  });
  const result = validateBuildLaneCapacityReceipt(forgedGenericOpenClaw, {
    repository: REPOSITORY,
    taskClass: 'FOCUSED_REPAIR',
    nowUtc: NOW,
  });
  assert.equal(result.route, MISSION_CONTROLLER_ROUTE.OPENCLAW_LOCAL);
  assert.equal(result.valid, false);
});

test('STEPHANOS_NATIVE is first-class but a generic build-lane receipt cannot self-admit it', () => {
  assert.equal(MISSION_CONTROLLER_ROUTE.STEPHANOS_NATIVE, 'STEPHANOS_NATIVE');
  const forgedGenericNative = githubReceipt({
    receiptId: 'native-generic-capacity-20260810t1159z',
    route: MISSION_CONTROLLER_ROUTE.STEPHANOS_NATIVE,
    workerId: NATIVE_WORKER_ID,
    proofRefs: ['proof/native-generic-capacity.json'],
  });
  const result = validateBuildLaneCapacityReceipt(forgedGenericNative, {
    repository: REPOSITORY,
    taskClass: 'FOCUSED_REPAIR',
    nowUtc: NOW,
  });
  assert.equal(result.route, MISSION_CONTROLLER_ROUTE.STEPHANOS_NATIVE);
  assert.equal(result.valid, false);
});

test('router selects only a protected-key-verified Stephanos-native candidate when Codex is unavailable', async () => {
  const admission = await verifiedNativeAdmission();
  assert.equal(admission.ok, true, admission.reason);
  assert.equal(isVerifiedStephanosNativeRoutingCandidate(admission.candidate), true);
  const result = routeMissionControllerCapacity({
    nowUtc: NOW,
    sourceHead: SOURCE_HEAD,
    mission: mission(),
    codexStatus: codexStatus({ remainingPercent: 0, availability: 'METER_STALLED' }),
    nativeRoutingCandidate: admission.candidate,
  });
  assert.equal(result.route, MISSION_CONTROLLER_ROUTE.STEPHANOS_NATIVE);
  assert.equal(result.adapter, 'stephanos-native');
  assert.equal(result.workerId, NATIVE_WORKER_ID);
  assert.equal(result.dispatchAllowed, true);
  assert.equal(result.selectedCapacityReceiptId, 'native-capacity-aaaaaaaaaaaa-20260810115900');
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.leaseSeizureAllowed, false);
  assert.equal(result.duplicateDispatchAllowed, false);
});

test('caller-shaped Stephanos-native candidate cannot route even when every visible field looks valid', () => {
  const forged = Object.freeze({
    schemaVersion: 'stephanos.native-routing-admission.v1',
    route: 'STEPHANOS_NATIVE',
    adapter: 'stephanos-native',
    workerId: NATIVE_WORKER_ID,
    repository: REPOSITORY,
    sourceHead: SOURCE_HEAD,
    taskClass: 'FOCUSED_REPAIR',
    queueDepth: 0,
    p95StartLatencySeconds: 1,
    capacityReceiptId: 'native-capacity-forged',
    authorityReceiptIds: ['native-authority-forged'],
    proofRefs: ['proof/native-forged.json'],
    sourceMutationAllowed: true,
    arbitraryCommandAllowed: false,
    mergeAuthority: false,
    leaseSeizureAllowed: false,
    duplicateDispatchAllowed: false,
  });
  assert.equal(isVerifiedStephanosNativeRoutingCandidate(forged), false);
  const result = routeMissionControllerCapacity({
    nowUtc: NOW,
    sourceHead: SOURCE_HEAD,
    mission: mission(),
    codexStatus: codexStatus({ remainingPercent: 0, availability: 'METER_STALLED' }),
    nativeRoutingCandidate: forged,
  });
  assert.equal(result.route, MISSION_CONTROLLER_ROUTE.WAIT_FOR_PROVEN_CAPACITY);
  assert.equal(result.dispatchAllowed, false);
});

test('native admission fails closed for wrong protected key, head drift, unsupported task class and widened status authority', async () => {
  const wrongKey = nativeKeyPair();
  const wrongKeyAdmission = await verifiedNativeAdmission({ publicKeyPem: wrongKey.publicKeyPem });
  assert.equal(wrongKeyAdmission.ok, false);
  assert.match(wrongKeyAdmission.reason, /^STEPHANOS_NATIVE_CAPACITY_RECEIPT_INVALID:/);

  const headDrift = await verifiedNativeAdmission({ sourceHead: 'b'.repeat(40) });
  assert.equal(headDrift.ok, false);
  assert.match(headDrift.reason, /^STEPHANOS_NATIVE_CAPACITY_RECEIPT_INVALID:/);

  const unsupported = await verifiedNativeAdmission({ taskClass: 'MULTI_MODULE_IMPLEMENTATION' });
  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.reason, 'STEPHANOS_NATIVE_TASK_NOT_QUALIFIED');

  const widened = await verifiedNativeAdmission({ statusOverrides: { status: { mergeAuthority: true } } });
  assert.equal(widened.ok, false);
  assert.equal(widened.reason, 'STEPHANOS_NATIVE_CAPACITY_STATUS_BINDING_INVALID');
});

test('native admission fails dark when the protected public key is missing', async () => {
  const missing = await verifiedNativeAdmission({ omitPublicKey: true });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, 'STEPHANOS_NATIVE_ROUTING_TRUTH_MISSING');
  assert.equal(missing.candidate, null);
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


test('quarantined Codex surface routes the same mission through proven GitHub capacity', () => {
  const result = routeMissionControllerCapacity({
    nowUtc: NOW,
    mission: mission(),
    codexStatus: codexStatus(),
    githubLaneReceipt: githubReceipt(),
    blockedAdapters: ['codex'],
  });
  assert.equal(result.route, MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB);
  assert.equal(result.adapter, 'chatgpt-github');
  assert.equal(result.dispatchAllowed, true);
  assert.deepEqual(result.blockedAdapters, ['codex']);
});

test('quarantined GitHub writer is skipped in favour of the already-proven Forge lifeboat', () => {
  const result = routeMissionControllerCapacity({
    nowUtc: NOW,
    sourceHead: SOURCE_HEAD,
    mission: mission(),
    codexStatus: codexStatus({ remainingPercent: 0, availability: 'METER_STALLED' }),
    githubLaneReceipt: githubReceipt({ p95StartLatencySeconds: 1 }),
    forgeLaneReceipt: lifeboatReceipt(),
    blockedAdapters: ['chatgpt-github'],
  });
  assert.equal(result.route, MISSION_CONTROLLER_ROUTE.FOUNDRY_FORGE);
  assert.equal(result.adapter, 'foundry-forge');
  assert.equal(result.workerId, FORGE_LIFEBOAT_WORKER_ID);
  assert.equal(result.dispatchAllowed, true);
  assert.deepEqual(result.blockedAdapters, ['chatgpt-github']);
});

test('quarantining every currently proven writer holds only capacity rather than widening authority', () => {
  const result = routeMissionControllerCapacity({
    nowUtc: NOW,
    sourceHead: SOURCE_HEAD,
    mission: mission(),
    codexStatus: codexStatus(),
    githubLaneReceipt: githubReceipt(),
    forgeLaneReceipt: lifeboatReceipt(),
    blockedAdapters: ['codex', 'chatgpt-github', 'foundry-forge'],
  });
  assert.equal(result.route, MISSION_CONTROLLER_ROUTE.WAIT_FOR_PROVEN_CAPACITY);
  assert.equal(result.dispatchAllowed, false);
  assert.ok(result.blockers.includes('execution-surface-quarantine-active'));
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.leaseSeizureAllowed, false);
  assert.equal(result.duplicateDispatchAllowed, false);
});
