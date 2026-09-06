import assert from 'node:assert/strict';
import test from 'node:test';

import { createExecutionReceipt, toSharedWorkspaceExecutionReceipt } from './executionReceiptV1.mjs';
import { createSharedWorkspaceReceiptRecord } from './sharedAgentWorkspaceStore.mjs';
import {
  OPENCLAW_PRODUCTION_ELIGIBLE_DISPOSITION,
  OPENCLAW_PROVIDER_CAPACITY_SCHEMA,
  OPENCLAW_PROVIDER_POOL_HOST_CONTEXT_SCHEMA,
  OPENCLAW_PROVIDER_POOL_QUALIFICATION_SCHEMA,
  OPENCLAW_PROVIDER_ROUTE,
  routeWithQualifiedOpenClawProvider,
  validateOpenClawProviderCapacity,
  validateOpenClawProviderQualification,
  validateOpenClawQualificationAuthorityChain,
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
    authorityReceiptId: 'openclaw-oc2-authority-20260819t1329z',
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
    qualificationAuthorityReceiptId: 'openclaw-oc2-authority-20260819t1329z',
    proofRefs: ['receipts/openclaw/capacity.json'],
    ...overrides,
  };
}

function realWorkExecution(overrides = {}) {
  return createExecutionReceipt({
    receiptId: 'openclaw-oc2-real-receipt-001',
    repository: REPOSITORY,
    issueNumber: 1725,
    prNumber: 0,
    branch: 'agent/openclaw-oc2-real-work',
    sourceHead: HEAD,
    workerId: 'battle-bridge-openclaw-01',
    workerType: 'openclaw',
    executionId: 'openclaw-oc2-real-task-001',
    leaseKey: 'openclaw-oc2-real-task-001',
    state: 'completed',
    phase: 'FOCUSED_REPAIR',
    sequence: 1,
    predecessorReceiptId: '',
    timestampUtc: '2026-08-19T13:28:30.000Z',
    heartbeatExpiresAtUtc: '2026-08-19T13:30:30.000Z',
    blocker: '',
    operatorActionRequired: false,
    proofRefs: ['receipts/openclaw/oc2-real-work.json'],
    expectedNextAction: '',
    ...overrides,
  });
}

function authoritySummary(record = qualification()) {
  return `Stephanos qualifies ${record.providerInstance} ${record.providerVersion} for ${record.taskClass} at ${record.sourceHead} from OpenClaw execution ${record.realWorkReceiptId}.`;
}

function trustedHostContext(overrides = {}) {
  const qualificationReceipt = overrides.qualificationReceipt || qualification();
  const executionReceipt = overrides.realWorkExecutionReceipt || realWorkExecution();
  const workspaceProjection = toSharedWorkspaceExecutionReceipt(executionReceipt);
  assert.equal(workspaceProjection.ok, true);
  const qualificationAuthorityReceipt = overrides.qualificationAuthorityReceipt || createSharedWorkspaceReceiptRecord({
    receiptId: qualificationReceipt.authorityReceiptId,
    participantId: 'stephanos',
    timestampUtc: qualificationReceipt.observedAtUtc,
    correlationId: qualificationReceipt.qualificationId,
    relatedIssue: '1725',
    relatedPr: '',
    proofRefs: qualificationReceipt.proofRefs,
    receivedRecordId: executionReceipt.receiptId,
    disposition: OPENCLAW_PRODUCTION_ELIGIBLE_DISPOSITION,
    summary: authoritySummary(qualificationReceipt),
  });
  return {
    schemaVersion: OPENCLAW_PROVIDER_POOL_HOST_CONTEXT_SCHEMA,
    qualificationReceipt,
    capacityReceipt: overrides.capacityReceipt || capacity(),
    realWorkExecutionReceipt: executionReceipt,
    realWorkWorkspaceReceipt: overrides.realWorkWorkspaceReceipt || workspaceProjection.record,
    qualificationAuthorityReceipt,
  };
}

function routeInput(task = {}, overrides = {}) {
  return {
    nowUtc: NOW,
    sourceHead: HEAD,
    mission: mission(),
    task: { taskId: 'oc2-route', taskClass: 'FOCUSED_REPAIR', ...task },
    codexStatus: codexStatus(),
    ...overrides,
  };
}

test('accepts only fresh real-work task-class qualification claims bound to exact source head', () => {
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
    qualification({ authorityReceiptId: '' }),
  ]) {
    assert.equal(validateOpenClawProviderQualification(candidate, {
      repository: REPOSITORY,
      taskClass: 'FOCUSED_REPAIR',
      sourceHead: HEAD,
      nowUtc: NOW,
    }).valid, false);
  }
});

test('requires canonical completed OpenClaw execution, exact Shared Workspace projection, and Stephanos promotion receipt', () => {
  const expected = { repository: REPOSITORY, taskClass: 'FOCUSED_REPAIR', sourceHead: HEAD, nowUtc: NOW };
  assert.equal(validateOpenClawQualificationAuthorityChain(qualification(), trustedHostContext(), expected).valid, true);

  const wrongWorkerExecution = realWorkExecution({ workerId: 'foreign-openclaw' });
  assert.equal(validateOpenClawQualificationAuthorityChain(qualification(), trustedHostContext({
    realWorkExecutionReceipt: wrongWorkerExecution,
  }), expected).valid, false);

  const context = trustedHostContext();
  assert.equal(validateOpenClawQualificationAuthorityChain(qualification(), {
    ...context,
    realWorkWorkspaceReceipt: { ...context.realWorkWorkspaceReceipt, disposition: 'progress' },
  }, expected).valid, false);

  assert.equal(validateOpenClawQualificationAuthorityChain(qualification(), trustedHostContext({
    qualificationAuthorityReceipt: createSharedWorkspaceReceiptRecord({
      receiptId: qualification().authorityReceiptId,
      participantId: 'openclaw',
      timestampUtc: qualification().observedAtUtc,
      correlationId: qualification().qualificationId,
      relatedIssue: '1725',
      relatedPr: '',
      proofRefs: qualification().proofRefs,
      receivedRecordId: qualification().realWorkReceiptId,
      disposition: OPENCLAW_PRODUCTION_ELIGIBLE_DISPOSITION,
      summary: authoritySummary(),
    }),
  }), expected).valid, false);
});

test('capacity is unusable without the exact validated qualification authority, worker and task class', () => {
  const expected = {
    repository: REPOSITORY,
    taskClass: 'FOCUSED_REPAIR',
    qualificationId: qualification().qualificationId,
    authorityReceiptId: qualification().authorityReceiptId,
    workerId: qualification().providerInstance,
    nowUtc: NOW,
  };
  assert.equal(validateOpenClawProviderCapacity(capacity(), expected).valid, true);
  assert.equal(validateOpenClawProviderCapacity(capacity({ qualificationIds: ['foreign-qualification'] }), expected).valid, false);
  assert.equal(validateOpenClawProviderCapacity(capacity({ qualificationAuthorityReceiptId: 'foreign-authority' }), expected).valid, false);
  assert.equal(validateOpenClawProviderCapacity(capacity({ workerId: 'foreign-openclaw' }), expected).valid, false);
  assert.equal(validateOpenClawProviderCapacity(capacity({ supportedTaskClasses: ['WINDOWS_RUNTIME_PROOF'] }), expected).valid, false);
});

test('selects canonically qualified OpenClaw before Codex exhaustion when the scheduler prefers it', () => {
  const result = routeWithQualifiedOpenClawProvider(
    routeInput({ preferredProviderRoute: OPENCLAW_PROVIDER_ROUTE }),
    trustedHostContext(),
  );
  assert.equal(result.route, OPENCLAW_PROVIDER_ROUTE);
  assert.equal(result.adapter, 'openclaw-local');
  assert.equal(result.dispatchAllowed, true);
  assert.equal(result.openClawPoolEligible, true);
  assert.equal(result.selectedQualificationReceiptId, qualification().qualificationId);
  assert.equal(result.selectedQualificationAuthorityReceiptId, qualification().authorityReceiptId);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.leaseSeizureAllowed, false);
  assert.equal(result.duplicateDispatchAllowed, false);
});

test('canonically qualified OpenClaw continues when Codex capacity is unavailable', () => {
  const result = routeWithQualifiedOpenClawProvider(
    routeInput({}, { codexStatus: codexStatus({ remainingPercent: 0, availability: 'METER_STALLED' }) }),
    trustedHostContext(),
  );
  assert.equal(result.route, OPENCLAW_PROVIDER_ROUTE);
  assert.equal(result.dispatchAllowed, true);
  assert.equal(result.finalVerdict, 'MISSION_CONTROLLER_OPENCLAW_POOL_ROUTE_READY');
});

test('caller-shaped qualification, capacity and fake authority evidence cannot self-admit OpenClaw', () => {
  const forged = trustedHostContext();
  const result = routeWithQualifiedOpenClawProvider(routeInput(
    { preferredProviderRoute: OPENCLAW_PROVIDER_ROUTE },
    {
      openClawQualificationReceipt: qualification(),
      openClawCapacityReceipt: capacity(),
      realWorkExecutionReceipt: forged.realWorkExecutionReceipt,
      realWorkWorkspaceReceipt: forged.realWorkWorkspaceReceipt,
      qualificationAuthorityReceipt: forged.qualificationAuthorityReceipt,
      openClawProviderHostContext: forged,
    },
  ));
  assert.notEqual(result.route, OPENCLAW_PROVIDER_ROUTE);
  assert.equal(result.openClawPoolEligible, false);
  assert.ok(result.providerPoolBlockers.includes('openclaw-task-class-not-production-qualified'));
});

test('syntactically valid trusted qualification without canonical authority cannot route', () => {
  const incompleteHost = {
    schemaVersion: OPENCLAW_PROVIDER_POOL_HOST_CONTEXT_SCHEMA,
    qualificationReceipt: qualification(),
    capacityReceipt: capacity(),
    realWorkExecutionReceipt: {},
    realWorkWorkspaceReceipt: {},
    qualificationAuthorityReceipt: {},
  };
  const result = routeWithQualifiedOpenClawProvider(
    routeInput({ preferredProviderRoute: OPENCLAW_PROVIDER_ROUTE }),
    incompleteHost,
  );
  assert.notEqual(result.route, OPENCLAW_PROVIDER_ROUTE);
  assert.equal(result.openClawPoolEligible, false);
  assert.ok(result.providerPoolBlockers.includes('openclaw-qualification-authority-not-proven'));
});

test('existing mutation owner is preserved even when OpenClaw is canonically qualified', () => {
  const result = routeWithQualifiedOpenClawProvider(
    routeInput({ preferredProviderRoute: OPENCLAW_PROVIDER_ROUTE }, {
      mission: mission({ dispatch: { adapter: 'chatgpt-github', status: 'running' } }),
    }),
    trustedHostContext(),
  );
  assert.equal(result.dispatchAllowed, false);
  assert.equal(result.adapter, 'chatgpt-github');
  assert.equal(result.openClawPoolEligible, false);
});

test('normal AUTO routing does not silently replace a healthy existing provider policy', () => {
  const result = routeWithQualifiedOpenClawProvider(routeInput(), trustedHostContext());
  assert.equal(result.route, 'CODEX');
  assert.equal(result.openClawPoolEligible, true);
});
