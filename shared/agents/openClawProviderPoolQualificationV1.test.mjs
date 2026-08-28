import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  acquireSharedWorkspaceOperationLock,
  createExecutionReceipt,
  toSharedWorkspaceExecutionReceipt,
} from './executionReceiptV1.mjs';
import {
  createSharedWorkspaceReceiptRecord,
  ensureSharedWorkspaceLayout,
} from './sharedAgentWorkspaceStore.mjs';
import {
  OPENCLAW_PRODUCTION_ELIGIBLE_DISPOSITION,
  OPENCLAW_PROVIDER_CAPACITY_SCHEMA,
  OPENCLAW_PROVIDER_POOL_COMPONENT_FILES,
  OPENCLAW_PROVIDER_POOL_HOST_CONTEXT_SCHEMA,
  OPENCLAW_PROVIDER_POOL_PUBLICATION_LOCK_SEGMENTS,
  OPENCLAW_PROVIDER_POOL_QUALIFICATION_SCHEMA,
  OPENCLAW_PROVIDER_ROUTE,
  publishOpenClawProviderPoolToSharedWorkspace,
  routeWithQualifiedOpenClawProvider,
  validateOpenClawProviderCapacity,
  validateOpenClawProviderPoolStatusRecord,
  validateOpenClawProviderQualification,
  validateOpenClawQualificationAuthorityChain,
} from './openClawProviderPoolQualificationV1.mjs';
import { readMissionControllerCapacityRoutingInput } from '../../stephanos-server/services/programmeAuthorityService.js';

const NOW = '2026-08-19T13:30:00.000Z';
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const HEAD = '8501a5657abe3fc5e815d9b35d9920003a4a1843';
const { privateKey:PUBLISHER_PRIVATE_KEY, publicKey:PUBLISHER_PUBLIC_KEY } = generateKeyPairSync('ed25519');
const PUBLISHER_PRIVATE_KEY_PEM = PUBLISHER_PRIVATE_KEY.export({ type:'pkcs8', format:'pem' });
const PUBLISHER_PUBLIC_KEY_PEM = PUBLISHER_PUBLIC_KEY.export({ type:'spki', format:'pem' });

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
  assert.equal(validateOpenClawProviderCapacity(capacity({
    supportedOperations: ['SOURCE_CONSTRUCTION', 'FOCUSED_TESTS', 'MERGE_PULL_REQUEST'],
  }), expected).valid, false);
});

test('publishes only the complete trusted OpenClaw qualification chain to the canonical status path', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openclaw-provider-pool-'));
  try {
    await ensureSharedWorkspaceLayout({ root, repoRoot: process.cwd() });
    const publication = await publishOpenClawProviderPoolToSharedWorkspace(
      root,
      trustedHostContext(),
      { repository: REPOSITORY, taskClass: 'FOCUSED_REPAIR', sourceHead: HEAD, nowUtc: NOW },
      { repoRoot: process.cwd(), nowMs: Date.parse(NOW), publisherPrivateKeyPem:PUBLISHER_PRIVATE_KEY_PEM },
    );
    assert.equal(publication.ok, true, publication.reason);
    assert.equal(publication.record.statusId, 'openclaw-provider-pool-current');
    assert.equal(publication.record.sourceHead, HEAD);
    assert.equal(publication.record.sourceMutationAllowed, false);
    assert.equal(publication.record.mergeAuthority, false);
    const persisted = JSON.parse(await readFile(
      join(root, 'status', 'openclaw-provider-pool-current.json'),
      'utf8',
    ));
    assert.equal(Object.hasOwn(persisted, 'hostContext'), false);
    const components = Object.fromEntries(await Promise.all(Object.entries(
      OPENCLAW_PROVIDER_POOL_COMPONENT_FILES,
    ).map(async ([componentKey, file]) => [
      componentKey,
      JSON.parse(await readFile(join(root, 'receipts', file), 'utf8')),
    ])));
    const validatedPublication = validateOpenClawProviderPoolStatusRecord(
      persisted,
      components,
      { repository: REPOSITORY, taskClass: 'FOCUSED_REPAIR', sourceHead: HEAD, nowUtc: NOW, publisherPublicKeyPem:PUBLISHER_PUBLIC_KEY_PEM },
    );
    assert.equal(validatedPublication.valid, true, validatedPublication.reason);
    assert.deepEqual(validatedPublication.hostContext, trustedHostContext());
    const publisherPublicKeyPath = join(root, 'publisher-public.pem');
    await writeFile(publisherPublicKeyPath, PUBLISHER_PUBLIC_KEY_PEM, 'utf8');
    const productionRouting = await readMissionControllerCapacityRoutingInput({
      root,
      repoRoot:process.cwd(),
      nowUtc:NOW,
      sourceRevision:HEAD,
      env:{ STEPHANOS_GITHUB_AUTH_PUBLIC_KEY_PATH:publisherPublicKeyPath },
    });
    assert.deepEqual(productionRouting.openClawHostContext, trustedHostContext());
    assert.equal(validateOpenClawProviderPoolStatusRecord(
      { ...persisted, publisherId: 'forged-publisher' },
      components,
      { repository: REPOSITORY, taskClass: 'FOCUSED_REPAIR', sourceHead: HEAD, nowUtc: NOW, publisherPublicKeyPem:PUBLISHER_PUBLIC_KEY_PEM },
    ).valid, false);
    assert.equal(validateOpenClawProviderPoolStatusRecord(
      persisted,
      {
        ...components,
        capacityReceipt: {
          ...components.capacityReceipt,
          payload: capacity({ supportedOperations: ['SOURCE_CONSTRUCTION', 'FOCUSED_TESTS', 'ARBITRARY_SHELL'] }),
        },
      },
      { repository: REPOSITORY, taskClass: 'FOCUSED_REPAIR', sourceHead: HEAD, nowUtc: NOW, publisherPublicKeyPem:PUBLISHER_PUBLIC_KEY_PEM },
    ).valid, false);
    assert.equal(validateOpenClawProviderPoolStatusRecord(
      { ...persisted, summary: 'Tampered after publication.' },
      components,
      { repository: REPOSITORY, taskClass: 'FOCUSED_REPAIR', sourceHead: HEAD, nowUtc: NOW, publisherPublicKeyPem:PUBLISHER_PUBLIC_KEY_PEM },
    ).valid, false);
    const foreignKeys = generateKeyPairSync('ed25519');
    assert.equal(validateOpenClawProviderPoolStatusRecord(
      persisted,
      components,
      { repository: REPOSITORY, taskClass: 'FOCUSED_REPAIR', sourceHead: HEAD, nowUtc: NOW, publisherPublicKeyPem:foreignKeys.publicKey.export({ type:'spki', format:'pem' }) },
    ).valid, false);

    const rejected = await publishOpenClawProviderPoolToSharedWorkspace(
      root,
      trustedHostContext({ capacityReceipt: capacity({ qualificationIds: ['foreign'] }) }),
      { repository: REPOSITORY, taskClass: 'FOCUSED_REPAIR', sourceHead: HEAD, nowUtc: NOW },
      { repoRoot: process.cwd(), nowMs: Date.parse(NOW) },
    );
    assert.equal(rejected.ok, false);
    assert.equal(rejected.reason, 'OPENCLAW_CAPACITY_INVALID');

    const rejectedPrivilegedOperation = await publishOpenClawProviderPoolToSharedWorkspace(
      root,
      trustedHostContext({ capacityReceipt: capacity({
        supportedOperations: ['SOURCE_CONSTRUCTION', 'FOCUSED_TESTS', 'ARBITRARY_SHELL'],
      }) }),
      { repository: REPOSITORY, taskClass: 'FOCUSED_REPAIR', sourceHead: HEAD, nowUtc: NOW },
      { repoRoot: process.cwd(), nowMs: Date.parse(NOW) },
    );
    assert.equal(rejectedPrivilegedOperation.ok, false);
    assert.equal(rejectedPrivilegedOperation.reason, 'OPENCLAW_CAPACITY_INVALID');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('serializes concurrent OpenClaw provider-pool generations behind one fixed operation lock', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openclaw-provider-pool-lock-'));
  const expected = { repository: REPOSITORY, taskClass: 'FOCUSED_REPAIR', sourceHead: HEAD, nowUtc: NOW };
  const firstHost = trustedHostContext();
  const secondQualification = qualification({
    qualificationId: 'openclaw-oc2-qualification-generation-b',
    authorityReceiptId: 'openclaw-oc2-authority-generation-b',
    providerInstance: 'battle-bridge-openclaw-02',
    realWorkTaskId: 'openclaw-oc2-real-task-002',
    realWorkReceiptId: 'openclaw-oc2-real-receipt-002',
  });
  const secondExecution = realWorkExecution({
    receiptId: secondQualification.realWorkReceiptId,
    workerId: secondQualification.providerInstance,
    executionId: secondQualification.realWorkTaskId,
    leaseKey: secondQualification.realWorkTaskId,
  });
  const secondHost = trustedHostContext({
    qualificationReceipt: secondQualification,
    capacityReceipt: capacity({
      receiptId: 'openclaw-capacity-generation-b',
      workerId: secondQualification.providerInstance,
      qualificationIds: [secondQualification.qualificationId],
      qualificationAuthorityReceiptId: secondQualification.authorityReceiptId,
    }),
    realWorkExecutionReceipt: secondExecution,
  });
  const publishOptions = {
    repoRoot: process.cwd(),
    nowMs: Date.parse(NOW),
    publisherPrivateKeyPem: PUBLISHER_PRIVATE_KEY_PEM,
    operationLockTimeoutMs: 100,
    operationLockRetryMs: 1,
    operationStaleLockMs: 5_000,
    operationLockHeartbeatMs: 10,
  };
  try {
    await ensureSharedWorkspaceLayout({ root, repoRoot: process.cwd() });
    const firstPublication = await publishOpenClawProviderPoolToSharedWorkspace(root, firstHost, expected, publishOptions);
    assert.equal(firstPublication.ok, true, firstPublication.reason);

    const heldLock = await acquireSharedWorkspaceOperationLock(
      root,
      OPENCLAW_PROVIDER_POOL_PUBLICATION_LOCK_SEGMENTS,
      publishOptions,
    );
    assert.equal(heldLock.ok, true, heldLock.reason);
    try {
      const blocked = await publishOpenClawProviderPoolToSharedWorkspace(root, secondHost, expected, {
        ...publishOptions,
        operationLockTimeoutMs: 10,
      });
      assert.equal(blocked.ok, false);
      assert.equal(blocked.reason, 'SHARED_WORKSPACE_OPERATION_LOCK_TIMEOUT');

      const persisted = JSON.parse(await readFile(join(root, 'status', 'openclaw-provider-pool-current.json'), 'utf8'));
      const components = Object.fromEntries(await Promise.all(Object.entries(OPENCLAW_PROVIDER_POOL_COMPONENT_FILES).map(
        async ([componentKey, file]) => [componentKey, JSON.parse(await readFile(join(root, 'receipts', file), 'utf8'))],
      )));
      const stillFirst = validateOpenClawProviderPoolStatusRecord(persisted, components, {
        ...expected,
        publisherPublicKeyPem: PUBLISHER_PUBLIC_KEY_PEM,
      });
      assert.equal(stillFirst.valid, true, stillFirst.reason);
      assert.deepEqual(stillFirst.hostContext, firstHost);
    } finally {
      assert.equal(await heldLock.release(), true);
    }

    const secondPublication = await publishOpenClawProviderPoolToSharedWorkspace(root, secondHost, expected, publishOptions);
    assert.equal(secondPublication.ok, true, secondPublication.reason);
    const finalStatus = JSON.parse(await readFile(join(root, 'status', 'openclaw-provider-pool-current.json'), 'utf8'));
    const finalComponents = Object.fromEntries(await Promise.all(Object.entries(OPENCLAW_PROVIDER_POOL_COMPONENT_FILES).map(
      async ([componentKey, file]) => [componentKey, JSON.parse(await readFile(join(root, 'receipts', file), 'utf8'))],
    )));
    const finalValidation = validateOpenClawProviderPoolStatusRecord(finalStatus, finalComponents, {
      ...expected,
      publisherPublicKeyPem: PUBLISHER_PUBLIC_KEY_PEM,
    });
    assert.equal(finalValidation.valid, true, finalValidation.reason);
    assert.deepEqual(finalValidation.hostContext, secondHost);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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
