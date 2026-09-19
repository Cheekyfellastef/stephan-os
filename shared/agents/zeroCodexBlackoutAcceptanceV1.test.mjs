import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BUILD_LANE_CAPACITY_RECEIPT_SCHEMA,
  MISSION_CONTROLLER_ROUTE,
} from './missionControllerCapacityRouterV1.mjs';
import {
  ZERO_CODEX_BLACKOUT_ZC1_SCHEMA,
  ZERO_CODEX_ZC1_VERDICT,
  evaluateZeroCodexZc1Routing,
} from './zeroCodexBlackoutAcceptanceV1.mjs';

const NOW = '2026-08-19T15:30:00.000Z';
const SOURCE_HEAD = '8501a5657abe3fc5e815d9b35d9920003a4a1843';
const REPOSITORY = 'Cheekyfellastef/stephan-os';

function mission(overrides = {}) {
  return {
    missionId: 'zero-codex-zc1-source-repair',
    title: 'Prove source work routes without Codex',
    repository: REPOSITORY,
    currentPhase: 'REPAIR_REQUIRED',
    allowedFiles: ['shared/agents/zeroCodexBlackoutAcceptanceV1.mjs'],
    requiredEvidence: ['focused tests', 'provider-neutral route receipt'],
    dispatch: { adapter: 'codex', status: 'pending' },
    ...overrides,
  };
}

function githubReceipt(overrides = {}) {
  return {
    schemaVersion: BUILD_LANE_CAPACITY_RECEIPT_SCHEMA,
    receiptId: 'github-zero-codex-capacity-20260819t1529z',
    route: MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB,
    repository: REPOSITORY,
    workerId: 'shared-fabric-chatgpt-github-builder-01',
    state: 'READY',
    supportedOperations: ['SOURCE_CONSTRUCTION', 'FOCUSED_TESTS'],
    supportedTaskClasses: ['FOCUSED_REPAIR'],
    observedAtUtc: '2026-08-19T15:29:00.000Z',
    expiresAtUtc: '2026-08-19T15:44:00.000Z',
    queueDepth: 0,
    p95StartLatencySeconds: 10,
    authorityReceiptIds: [],
    proofRefs: ['receipts/zero-codex/github-capacity.json'],
    ...overrides,
  };
}

test('ZC1 routes a bounded source repair to a proven non-Codex GitHub lane at zero Codex capacity', () => {
  const result = evaluateZeroCodexZc1Routing({
    nowUtc: NOW,
    sourceHead: SOURCE_HEAD,
    mission: mission(),
    githubLaneReceipt: githubReceipt(),
  });

  assert.equal(result.schemaVersion, ZERO_CODEX_BLACKOUT_ZC1_SCHEMA);
  assert.equal(result.finalVerdict, ZERO_CODEX_ZC1_VERDICT.PASS);
  assert.equal(result.route, MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB);
  assert.equal(result.adapter, 'chatgpt-github');
  assert.equal(result.dispatchAllowed, true);
  assert.equal(result.rejectedCodexRoute, true);
  assert.deepEqual(result.nonCodexProvidersUsed, ['chatgpt-github']);
  assert.equal(result.capacityInjection.codexCapacity, 'ZERO_OR_UNAVAILABLE');
  assert.equal(result.capacityInjection.workAgenticCapacity, 'ZERO_OR_UNAVAILABLE');
  assert.equal(result.capacityInjection.newCodexDispatchAllowed, false);
  assert.equal(result.capacityInjection.waitingForCodexAllowed, false);
});

test('ZC1 reports a parity gap instead of PROGRAMME_STALLED when no qualified fallback exists', () => {
  const result = evaluateZeroCodexZc1Routing({
    nowUtc: NOW,
    sourceHead: SOURCE_HEAD,
    mission: mission(),
  });

  assert.equal(result.finalVerdict, ZERO_CODEX_ZC1_VERDICT.BLOCKED_BY_PARITY_GAP);
  assert.equal(result.route, MISSION_CONTROLLER_ROUTE.WAIT_FOR_PROVEN_CAPACITY);
  assert.equal(result.dispatchAllowed, false);
  assert.equal(result.rejectedCodexRoute, true);
  assert.ok(result.blockers.includes('codex-capacity-unavailable'));
  assert.ok(result.blockers.includes('proven-build-fallback-unavailable'));
  assert.ok(!result.routerFinalVerdict.includes('PROGRAMME_STALLED'));
});

test('ZC1 does not route Windows-bound work to a GitHub-only fallback just to obtain a green blackout result', () => {
  const result = evaluateZeroCodexZc1Routing({
    nowUtc: NOW,
    sourceHead: SOURCE_HEAD,
    mission: mission({
      allowedFiles: ['scripts/windows/repair-worker.ps1'],
      requiredEvidence: ['Windows runtime proof'],
    }),
    task: { taskClass: 'WINDOWS_RUNTIME_PROOF', windowsBound: true },
    githubLaneReceipt: githubReceipt({ supportedTaskClasses: ['WINDOWS_RUNTIME_PROOF'] }),
  });

  assert.equal(result.finalVerdict, ZERO_CODEX_ZC1_VERDICT.BLOCKED_BY_PARITY_GAP);
  assert.equal(result.dispatchAllowed, false);
  assert.ok(result.blockers.includes('proven-windows-capable-fallback-unavailable'));
});

test('ZC1 fails closed on stale or malformed non-Codex capacity rather than pretending parity', () => {
  for (const receipt of [
    githubReceipt({ expiresAtUtc: '2026-08-19T15:29:30.000Z' }),
    githubReceipt({ queueDepth: -1 }),
    githubReceipt({ repository: 'wrong/repository' }),
  ]) {
    const result = evaluateZeroCodexZc1Routing({
      nowUtc: NOW,
      sourceHead: SOURCE_HEAD,
      mission: mission(),
      githubLaneReceipt: receipt,
    });
    assert.equal(result.finalVerdict, ZERO_CODEX_ZC1_VERDICT.BLOCKED_BY_PARITY_GAP);
    assert.equal(result.dispatchAllowed, false);
  }
});

test('ZC1 invalid fixture identity fails closed before any provider route is credited', () => {
  const result = evaluateZeroCodexZc1Routing({
    nowUtc: 'not-a-time',
    sourceHead: 'short',
    mission: mission({ missionId: '' }),
    githubLaneReceipt: githubReceipt(),
  });

  assert.equal(result.finalVerdict, ZERO_CODEX_ZC1_VERDICT.BLOCKED_INVALID_FIXTURE);
  assert.equal(result.dispatchAllowed, false);
  assert.deepEqual(result.nonCodexProvidersUsed, []);
});

test('ZC1 acceptance can never grant merge, runtime, OpenClaw, qualification or duplicate-dispatch authority', () => {
  const result = evaluateZeroCodexZc1Routing({
    nowUtc: NOW,
    sourceHead: SOURCE_HEAD,
    mission: mission(),
    githubLaneReceipt: githubReceipt(),
  });

  assert.deepEqual(result.authorityBoundary, {
    mergeAuthority: false,
    deploymentAuthority: false,
    windowsRuntimeAuthority: false,
    openClawMutationAuthority: false,
    providerQualificationAuthority: false,
    leaseSeizureAllowed: false,
    duplicateDispatchAllowed: false,
  });
});
