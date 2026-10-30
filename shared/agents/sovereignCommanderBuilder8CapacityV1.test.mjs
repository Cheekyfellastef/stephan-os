import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BUILD_LANE_CAPACITY_RECEIPT_SCHEMA,
  MISSION_CONTROLLER_ROUTE,
  createBuildLaneCapacityStatusRecord,
  routeMissionControllerCapacity,
  validateBuildLaneCapacityReceipt,
} from './missionControllerCapacityRouterV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const SOURCE_HEAD = 'b'.repeat(40);
const NOW = '2026-10-10T12:00:00.000Z';

function receipt(overrides = {}) {
  return {
    schemaVersion: BUILD_LANE_CAPACITY_RECEIPT_SCHEMA,
    receiptId: 'sovereign-builder8-capacity-sample',
    route: MISSION_CONTROLLER_ROUTE.SOVEREIGN_COMMANDER,
    repository: REPOSITORY,
    sourceHead: SOURCE_HEAD,
    workerId: 'stephanos-sovereign-builder-08',
    state: 'READY',
    supportedOperations: ['SOURCE_CONSTRUCTION', 'FOCUSED_TESTS'],
    supportedTaskClasses: ['FOCUSED_REPAIR'],
    observedAtUtc: '2026-10-10T11:59:00.000Z',
    expiresAtUtc: '2026-10-10T12:03:00.000Z',
    queueDepth: 0,
    p95StartLatencySeconds: 8,
    authorityReceiptIds: [`sovereign-builder8-source-${SOURCE_HEAD}`],
    proofRefs: [`proof/sovereign-builder8-capacity-${SOURCE_HEAD}.json`],
    ...overrides,
  };
}

function route(input = {}) {
  return routeMissionControllerCapacity({
    nowUtc: NOW,
    sourceHead: SOURCE_HEAD,
    mission: {
      missionId: 'critical-2998-builder8-proof',
      repository: REPOSITORY,
      currentPhase: 'REPAIR_REQUIRED',
      allowedFiles: ['shared/agents/sovereignCommanderBuilder8CapacityV1.test.mjs'],
      requiredEvidence: ['focused tests'],
      dispatch: { adapter: 'codex', status: 'pending' },
    },
    ...input,
  });
}

test('builder 8 is distinct, capacity-backed and has no extra merge/lease authority', () => {
  assert.equal(MISSION_CONTROLLER_ROUTE.SOVEREIGN_COMMANDER, 'SOVEREIGN_COMMANDER');
  assert.equal(validateBuildLaneCapacityReceipt(receipt(), {
    repository: REPOSITORY,
    sourceHead: SOURCE_HEAD,
    taskClass: 'FOCUSED_REPAIR',
    nowUtc: NOW,
  }).valid, true);
  const record = createBuildLaneCapacityStatusRecord(receipt(), { nowUtc: NOW });
  assert.equal(record.statusId, 'sovereign-commander-build-capacity-current');
  assert.equal(record.mergeAuthority, false);
  assert.equal(record.sourceMutationAllowed, false);
  const result = route({ sovereignCommanderLaneReceipt: receipt() });
  assert.equal(result.route, MISSION_CONTROLLER_ROUTE.SOVEREIGN_COMMANDER);
  assert.equal(result.adapter, 'sovereign-commander');
  assert.equal(result.workerId, 'stephanos-sovereign-builder-08');
  assert.equal(result.dispatchAllowed, true);
  assert.equal(result.selectedCapacityReceiptId, receipt().receiptId);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.leaseSeizureAllowed, false);
  assert.equal(result.duplicateDispatchAllowed, false);
});

test('no fabricated eighth builder without current exact-head proof', () => {
  const absent = route();
  assert.equal(absent.dispatchAllowed, false);
  for (const malformed of [
    receipt({ sourceHead: 'a'.repeat(40) }),
    receipt({ workerId: 'desktop-commander-battle-bridge-01' }),
    receipt({ authorityReceiptIds: [] }),
    receipt({ authorityReceiptIds: ['wrong-authority'] }),
    receipt({ proofRefs: ['proof/other.json'] }),
    receipt({ expiresAtUtc: '2026-10-10T12:10:00.000Z' }),
    receipt({ expiresAtUtc: '2026-10-10T11:59:59.000Z' }),
    receipt({ p95StartLatencySeconds: 601 }),
    receipt({ queueDepth: 65 }),
  ]) {
    assert.equal(route({ sovereignCommanderLaneReceipt: malformed }).dispatchAllowed, false,
      `malformed sovereign proof must not dispatch: ${JSON.stringify(malformed)}`);
  }
});

test('operator quarantine, existing writer and window-bound work remain protected', () => {
  assert.equal(route({
    sovereignCommanderLaneReceipt: receipt(),
    blockedAdapters: ['sovereign-commander'],
  }).dispatchAllowed, false);
  assert.equal(route({
    sovereignCommanderLaneReceipt: receipt(),
    operatorContainment: { active: true, commandId: 'operator-hold' },
  }).dispatchAllowed, false);
  const existing = route({
    sovereignCommanderLaneReceipt: receipt(),
    mission: {
      missionId: 'critical-2998-builder8-proof',
      repository: REPOSITORY,
      dispatch: { adapter: 'openclaw-local', status: 'running' },
    },
  });
  assert.equal(existing.dispatchAllowed, false);
  assert.ok(existing.blockers.includes('existing-agent-dispatch-owns-mission'));
  assert.equal(route({
    sovereignCommanderLaneReceipt: receipt(),
    task: { windowsBound: true, taskClass: 'WINDOWS_RUNTIME_PROOF' },
  }).dispatchAllowed, false);
});
