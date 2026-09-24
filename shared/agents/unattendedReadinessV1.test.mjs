import assert from 'node:assert/strict';
import test from 'node:test';

import {
  UNATTENDED_READINESS_STATE,
  UNATTENDED_REQUIRED_PROOFS,
  projectUnattendedReadinessV1,
} from './unattendedReadinessV1.mjs';

const HEAD = 'a'.repeat(40);
const NOW = Date.parse('2026-09-24T15:00:00Z');

function fixture(overrides = {}) {
  const observedAtUtc = '2026-09-24T14:58:00Z';
  return {
    sourceHead: HEAD,
    nowMs: NOW,
    operatorDesiredState: 'RUNNING',
    authorityContradiction: false,
    stopContainmentViolation: false,
    duplicateMutationWriter: false,
    controllers: [
      {
        controllerId: 'native-controller-1557',
        controlState: 'RUNNING',
        unattendedState: 'UNATTENDED_READY',
        sourceHead: HEAD,
        heartbeatAtUtc: observedAtUtc,
        resourceIds: ['controller:1557'],
      },
      {
        controllerId: 'goal-building-agent-2002',
        controlState: 'ACTIVE',
        unattendedState: 'UNATTENDED_READY',
        sourceHead: HEAD,
        heartbeatAtUtc: observedAtUtc,
        resourceIds: ['programme:goal-building'],
      },
    ],
    proofs: UNATTENDED_REQUIRED_PROOFS.map((proofType) => ({
      proofType,
      receiptId: 'receipt-' + proofType.toLowerCase().replaceAll('_', '-'),
      state: 'PROVEN',
      verified: true,
      sourceHead: HEAD,
      observedAtUtc,
    })),
    ...overrides,
  };
}

test('returns UNATTENDED_READY only when all required current evidence is present', () => {
  const result = projectUnattendedReadinessV1(fixture());
  assert.equal(result.state, UNATTENDED_READINESS_STATE.READY);
  assert.equal(result.blockers.length, 0);
  assert.equal(result.proofStatus.NATIVE_GOAL_CYCLE, 'CURRENT');
  assert.equal(result.proofStatus.EVENT_DRIVEN_REFILL, 'CURRENT');
  assert.ok(Object.values(result.authority).every((value) => value === false));
});

test('missing resilience proof degrades but does not invent a global stop', () => {
  const input = fixture();
  input.proofs = input.proofs.filter((proof) => proof.proofType !== 'PROVIDER_FAILOVER');
  const result = projectUnattendedReadinessV1(input);
  assert.equal(result.state, UNATTENDED_READINESS_STATE.DEGRADED);
  assert.ok(result.blockers.includes('PROVIDER_FAILOVER:MISSING'));
  assert.equal(result.reasonCodes.includes('CORE_CONTINUATION_AVAILABLE_BUT_RESILIENCE_INCOMPLETE'), true);
});

test('missing native build-cycle proof remains not ready', () => {
  const input = fixture();
  input.proofs = input.proofs.filter((proof) => proof.proofType !== 'NATIVE_GOAL_CYCLE');
  const result = projectUnattendedReadinessV1(input);
  assert.equal(result.state, UNATTENDED_READINESS_STATE.NOT_READY);
  assert.ok(result.blockers.includes('NATIVE_GOAL_CYCLE:MISSING'));
});

test('stale core proof cannot remain ready after its freshness window expires', () => {
  const input = fixture();
  input.proofs = input.proofs.map((proof) => proof.proofType === 'INDEPENDENT_REVIEW_ROUTE'
    ? { ...proof, observedAtUtc: '2026-09-24T12:00:00Z' }
    : proof);
  const result = projectUnattendedReadinessV1(input);
  assert.equal(result.state, UNATTENDED_READINESS_STATE.NOT_READY);
  assert.equal(result.proofStatus.INDEPENDENT_REVIEW_ROUTE, 'STALE');
});

test('operator stop-propagation violation forces SAFE_HOLD', () => {
  const result = projectUnattendedReadinessV1(fixture({ stopContainmentViolation: true }));
  assert.equal(result.state, UNATTENDED_READINESS_STATE.SAFE_HOLD);
  assert.ok(result.reasonCodes.includes('OPERATOR_STOP_PROPAGATION_VIOLATION'));
  assert.equal(result.authority.controllerMutationAllowed, false);
});

test('duplicate active mutation ownership forces SAFE_HOLD', () => {
  const input = fixture();
  input.controllers[0].resourceIds = ['repo:stephan-os'];
  input.controllers[1].resourceIds = ['repo:stephan-os'];
  const result = projectUnattendedReadinessV1(input);
  assert.equal(result.state, UNATTENDED_READINESS_STATE.SAFE_HOLD);
  assert.ok(result.blockers.includes('MULTIPLE_CONTROLLERS_FOR_RESOURCE:repo:stephan-os'));
});

test('explicitly degraded controller produces fleet degradation rather than false ready', () => {
  const input = fixture();
  input.controllers[1].unattendedState = 'UNATTENDED_DEGRADED';
  const result = projectUnattendedReadinessV1(input);
  assert.equal(result.state, UNATTENDED_READINESS_STATE.DEGRADED);
  assert.ok(result.reasonCodes.includes('CONTROLLER_EXPLICITLY_DEGRADED:goal-building-agent-2002'));
});

test('head drift on a required controller fails closed to NOT_READY', () => {
  const input = fixture();
  input.controllers[0].sourceHead = 'b'.repeat(40);
  const result = projectUnattendedReadinessV1(input);
  assert.equal(result.state, UNATTENDED_READINESS_STATE.NOT_READY);
  assert.ok(result.blockers.includes('CONTROLLER_SOURCE_HEAD_MISMATCH:native-controller-1557'));
});

test('duplicate proof identities cannot be used to fabricate readiness', () => {
  const input = fixture();
  input.proofs.push({ ...input.proofs[0], receiptId: 'receipt-duplicate' });
  const result = projectUnattendedReadinessV1(input);
  assert.equal(result.state, UNATTENDED_READINESS_STATE.SAFE_HOLD);
  assert.ok(result.reasonCodes.includes('DUPLICATE_READINESS_EVIDENCE'));
});

test('durable JSON round-trip preserves the same readiness projection', () => {
  const input = fixture();
  const before = projectUnattendedReadinessV1(input);
  const after = projectUnattendedReadinessV1(JSON.parse(JSON.stringify(input)));
  assert.deepEqual(after, before);
});
