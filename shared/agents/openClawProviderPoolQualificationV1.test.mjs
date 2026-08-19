import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OPENCLAW_PROVIDER_CAPACITY_SCHEMA,
  OPENCLAW_PROVIDER_POOL_QUALIFICATION_SCHEMA,
  OPENCLAW_PROVIDER_ROUTE,
  routeWithQualifiedOpenClawProvider,
  validateOpenClawProviderCapacity,
  validateOpenClawProviderQualification,
} from './openClawProviderPoolQualificationV1.mjs';

const NOW = '2026-08-19T13:30:00.000Z';
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const HEAD = '8501a5657abe3fc5e815d9b35d9920003a4a1843';

function mission(overrides = {}) {
  return {
    missionId: 'openclaw-oc2-real-work-qualification',
    title: 'Run focused OpenClaw qualification proof',
    repository: REPOSITORY,
    sourceHead: HEAD,
    currentPhase: 'REPAIR_REQUIRED',
    allowedFiles: ['shared/agents/openClawProviderPoolQualificationV1.mjs'],
    requiredEvidence: ['focused tests'],
    dispatch: { adapter: '', status: 'pending' },
    ...overrides,
  };
}

function codexStatus(overrides = {}) {
  return {
    schemaVersion: 'shared-agent-workspace-record.v1',
    statusId: 'codex-capacity-current',
    truthState: 'CURRENT',
    meterTruthUsable: true,
    observedAtUtc: '2026-08-19T13:28:00.000Z',
    remainingPercent: 80,
    availability: 'AVAILABLE',
    confidence: 'high',
    naturalResetAtUtc: '',
    ...overrides,
  };
}

function qualification(overrides = {}) {
  return {
    schemaVersion: OPENCLAW_PROVIDER_POOL_QUALIFICATION_SCHEMA,
    qualificationId: 'openclaw-oc2-qualification-20260819t1329z',
    provider: 'openclaw-standalone',
    repository: REPOSITORY,
    taskClass: 'FOCUSED_REPAIR',
    state: 'PRODUCTION_ELIGIBLE',
    providerInstance: 'battle-bridge-openclaw-01',
    providerVersion: 'openclaw-qualified-v1',
    sourceHead: HEAD,
    realWorkTaskId: 'openclaw-oc2-real-task-001',
    realWorkReceiptId: 'openclaw-oc2-real-receipt-001',
    observedAtUtc: '2026-08-19T13:29:00.000Z',
    expiresAtUtc: '2026-08-19T13:44:00.000Z',
    codexRequired: false,
    proofRefs: ['receipts/openclaw/oc2-real-work.json'],
    ...overrides,
  };
}

function capacity(overrides = {}) {
  return {
    schemaVersion: OPENCLAW_PROVIDER_CAPACITY_SCHEMA,
    receiptId: 'openclaw-capacity-20260819t1329z',
    provider: 'openclaw-standalone',
    repository: REPOSITORY,
    workerId: 'battle-bridge-openclaw-01',
    state: 'READY',
    supportedOperations: ['SOURCE_CONSTRUCTION', 'FOCUSED_TESTS'],
    supportedTaskClasses: ['FOCUSED_REPAIR'],
    observedAtUtc: '2026-08-19T13:29:00.000Z',
    expiresAtUtc: '2026-08-19T13:44:00.000Z',
    queueDepth: 0,
    p95StartLatencySeconds: 5,
    qualificationIds: ['openclaw-oc2-qualification-20260819t1329z'],
    proofRefs: ['receipts/openclaw/capacity.json'],
    ...overrides,
  };
}

test('accepts only fresh real-work task-class qualification bound to exact source head', () => {
  const accepted = validateOpenClawProviderQualification(qualification(), {
    repository: REPOSITORY,
    taskClass: 'FOCUSED_REPAIR',
    sourceHead: HEAD,
    nowUtc: NOW,
  });
  assert.equal(accepted.valid, true);

  for (const candidate of [
    qualification({ state: 'EVALUATED' }),
    qualification({ codexRequired: true }),
    qualification({ sourceHead: '0'.repeat(40) }),
    qualification({ expiresAtUtc: '2026-08-19T13:29:30.000Z' }),
    qualification({ realWorkReceiptId: '' }),
  ]) {
    assert.equal(validateOpenClawProviderQualification(candidate, {
      repository: REPOSITORY,
      taskClass: 'FOCUSED_REPAIR',
      sourceHead: HEAD,
      nowUtc: NOW,
    }).valid, false);
  }
});

test('capacity is unusable without the exact qualification id and task class', () => {
  assert.equal(validateOpenClawProviderCapacity(capacity(), {
    repository: REPOSITORY,
    taskClass: 'FOCUSED_REPAIR',
    qualificationId: qualification().qualificationId,
    nowUtc: NOW,
  }).valid, true);
  assert.equal(validateOpenClawProviderCapacity(capacity({ qualificationIds: ['foreign-qualification'] }), {
    repository: REPOSITORY,
    taskClass: 'FOCUSED_REPAIR',
    qualificationId: qualification().qualificationId,
    nowUtc: NOW,
  }).valid, false);
  assert.equal(validateOpenClawProviderCapacity(capacity({ supportedTaskClasses: ['WINDOWS_RUNTIME_PROOF'] }), {
    repository: REPOSITORY,
    taskClass: 'FOCUSED_REPAIR',
    qualificationId: qualification().qualificationId,
    nowUtc: NOW,
  }).valid, false);
});

test('selects qualified OpenClaw before Codex exhaustion when the scheduler prefers it', () => {
  const result = routeWithQualifiedOpenClawProvider({
    nowUtc: NOW,
    sourceHead: HEAD,
    mission: mission(),
    task: { taskId: 'oc2-route', taskClass: 'FOCUSED_REPAIR', preferredProviderRoute: OPENCLAW_PROVIDER_ROUTE },
    codexStatus: codexStatus(),
    openClawQualificationReceipt: qualification(),
    openClawCapacityReceipt: capacity(),
  });
  assert.equal(result.route, OPENCLAW_PROVIDER_ROUTE);
  assert.equal(result.adapter, 'openclaw-local');
  assert.equal(result.dispatchAllowed, true);
  assert.equal(result.openClawPoolEligible, true);
  assert.equal(result.selectedQualificationReceiptId, qualification().qualificationId);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.leaseSeizureAllowed, false);
  assert.equal(result.duplicateDispatchAllowed, false);
});

test('qualified OpenClaw continues when Codex capacity is unavailable', () => {
  const result = routeWithQualifiedOpenClawProvider({
    nowUtc: NOW,
    sourceHead: HEAD,
    mission: mission(),
    task: { taskId: 'oc2-zero-codex', taskClass: 'FOCUSED_REPAIR' },
    codexStatus: codexStatus({ remainingPercent: 0, availability: 'METER_STALLED' }),
    openClawQualificationReceipt: qualification(),
    openClawCapacityReceipt: capacity(),
  });
  assert.equal(result.route, OPENCLAW_PROVIDER_ROUTE);
  assert.equal(result.dispatchAllowed, true);
  assert.equal(result.finalVerdict, 'MISSION_CONTROLLER_OPENCLAW_POOL_ROUTE_READY');
});

test('paper capability claims never make OpenClaw eligible', () => {
  const result = routeWithQualifiedOpenClawProvider({
    nowUtc: NOW,
    sourceHead: HEAD,
    mission: mission(),
    task: { taskId: 'oc2-paper-only', taskClass: 'FOCUSED_REPAIR', preferredProviderRoute: OPENCLAW_PROVIDER_ROUTE },
    codexStatus: codexStatus(),
    openClawQualificationReceipt: qualification({ state: 'EVALUATED' }),
    openClawCapacityReceipt: capacity(),
  });
  assert.notEqual(result.route, OPENCLAW_PROVIDER_ROUTE);
  assert.equal(result.openClawPoolEligible, false);
  assert.ok(result.providerPoolBlockers.includes('openclaw-task-class-not-production-qualified'));
});

test('existing mutation owner is preserved even when OpenClaw is qualified', () => {
  const result = routeWithQualifiedOpenClawProvider({
    nowUtc: NOW,
    sourceHead: HEAD,
    mission: mission({ dispatch: { adapter: 'chatgpt-github', status: 'running' } }),
    task: { taskId: 'oc2-owned', taskClass: 'FOCUSED_REPAIR', preferredProviderRoute: OPENCLAW_PROVIDER_ROUTE },
    codexStatus: codexStatus(),
    openClawQualificationReceipt: qualification(),
    openClawCapacityReceipt: capacity(),
  });
  assert.equal(result.dispatchAllowed, false);
  assert.equal(result.adapter, 'chatgpt-github');
  assert.equal(result.openClawPoolEligible, false);
});

test('normal AUTO routing does not silently replace a healthy existing provider policy', () => {
  const result = routeWithQualifiedOpenClawProvider({
    nowUtc: NOW,
    sourceHead: HEAD,
    mission: mission(),
    task: { taskId: 'oc2-auto', taskClass: 'FOCUSED_REPAIR' },
    codexStatus: codexStatus(),
    openClawQualificationReceipt: qualification(),
    openClawCapacityReceipt: capacity(),
  });
  assert.equal(result.route, 'CODEX');
  assert.equal(result.openClawPoolEligible, true);
});
