import { createHash } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';

import * as workspaceAdapter from './foundryParallelProductionAccelerationSharedWorkspaceV1.mjs';
import {
  FOUNDRY_ACCELERATION_WORKSPACE_EVENT_KIND,
  FOUNDRY_ACCELERATION_WORKSPACE_PARTICIPANT,
  FOUNDRY_ACCELERATION_WORKSPACE_SCHEMA,
  FOUNDRY_ACCELERATION_WORKSPACE_STATUS_ID,
  FOUNDRY_ACCELERATION_WORKSPACE_TRUTH,
  createFoundryAccelerationWorkspaceRecords,
  createFoundryAccelerationWorkspaceSlice,
} from './foundryParallelProductionAccelerationSharedWorkspaceV1.mjs';
import { validateSharedWorkspaceRecord } from './sharedAgentWorkspaceStore.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const MAIN = 'a'.repeat(40);
const TREE = 'b'.repeat(40);
const NOW = '2026-08-14T15:00:00Z';
const TASK_CLASS = 'SOURCE_CONSTRUCTION';
const M2_ID = 'forge-m2-runtime-receipt-001';
const M3_ID = 'forge-m3-runtime-receipt-001';

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digestBound(core) {
  return {
    ...core,
    payloadSha256: createHash('sha256').update(canonicalJson(core)).digest('hex'),
  };
}

function buildReceipt(providerId, route, overrides = {}) {
  const foundry = route === 'FOUNDRY_FORGE';
  return {
    schemaVersion: 'stephanos.build-lane-capacity-receipt.v1',
    receiptId: `${providerId}-capacity-receipt-001`,
    route,
    repository: REPOSITORY,
    workerId: `${providerId}-worker-001`,
    state: 'READY',
    supportedOperations: ['SOURCE_CONSTRUCTION', 'FOCUSED_TESTS'],
    supportedTaskClasses: [TASK_CLASS],
    observedAtUtc: '2026-08-14T14:58:00Z',
    expiresAtUtc: '2026-08-14T15:10:00Z',
    queueDepth: 0,
    p95StartLatencySeconds: providerId === 'github' ? 180 : 10,
    authorityReceiptIds: foundry ? [M2_ID, M3_ID] : ['github-build-authority-001'],
    proofRefs: [`receipts/capacity/${providerId}-001.json`],
    ...overrides,
  };
}

function metricsReceipt(providerId, build, overrides = {}) {
  return digestBound({
    schemaVersion: 'stephanos.foundry-acceleration-metrics-receipt.v1',
    receiptId: `${providerId}-metrics-receipt-001`,
    providerId,
    buildLaneCapacityReceiptId: build.receiptId,
    route: build.route,
    repository: REPOSITORY,
    workerId: build.workerId,
    canonicalMainHead: MAIN,
    canonicalMainTree: TREE,
    taskClass: TASK_CLASS,
    state: build.state,
    supportedOperations: [...build.supportedOperations],
    supportedTaskClasses: [...build.supportedTaskClasses],
    observedAtUtc: '2026-08-14T14:59:00Z',
    expiresAtUtc: '2026-08-14T15:05:00Z',
    availableSlots: 2,
    queueDepth: build.queueDepth,
    p95StartLatencySeconds: build.p95StartLatencySeconds,
    medianExecutionSeconds: providerId === 'github' ? 600 : 240,
    reviewIntegrationSeconds: providerId === 'github' ? 120 : 60,
    successRate: 0.95,
    reworkRate: 0.05,
    authorityReceiptIds: [...build.authorityReceiptIds],
    proofRefs: [...build.proofRefs, `receipts/metrics/${providerId}-001.json`],
    ...overrides,
  });
}

function evidence(providerId, route, options = {}) {
  const build = buildReceipt(providerId, route, options.build);
  return {
    providerId,
    buildLaneReceipt: build,
    metricsReceipt: metricsReceipt(providerId, build, options.metrics),
  };
}

function forgeSidecar(overrides = {}) {
  return {
    goalId: '#1671',
    repository: REPOSITORY,
    canonicalMainHead: MAIN,
    canonicalMainTree: TREE,
    mirrorHead: MAIN,
    mirrorTree: TREE,
    sourceReady: true,
    m2Receipt: digestBound({
      schemaVersion: 'stephanos.forge-shadow-m2-runtime-receipt.v1',
      receiptId: M2_ID,
      repository: REPOSITORY,
      sourceHead: MAIN,
      sourceTree: TREE,
      mirrorHead: MAIN,
      mirrorTree: TREE,
      operation: 'INSTALL_FORGE_SHADOW_M2',
      state: 'DONE',
      finalVerdict: 'FORGE_SHADOW_M2_READY',
      completedAt: '2026-08-14T14:59:00Z',
      proofRefs: ['receipts/forge/m2-001.json'],
    }),
    m3RuntimeReceipt: digestBound({
      schemaVersion: 'stephanos.forge-shadow-m3-runner-runtime-receipt.v1',
      receiptId: M3_ID,
      repository: REPOSITORY,
      sourceHead: MAIN,
      sourceTree: TREE,
      artifactSetDigest: `sha256:${'e'.repeat(64)}`,
      runnerIdentities: [
        'stephanos-forge-linux-runner-01',
        'stephanos-forge-windows-proof-runner-01',
      ],
      linuxReviewRunnerConnected: true,
      windowsProofRunnerConnected: true,
      teardownComplete: true,
      zeroResidualRegistration: true,
      zeroResidualCredential: true,
      zeroResidualWorkspace: true,
      canCarryRealWork: true,
      finalVerdict: 'FORGE_SHADOW_M3_RUNNER_RUNTIME_READY',
      completedAt: '2026-08-14T14:59:00Z',
      proofRefs: ['receipts/forge/m3-001.json'],
    }),
    evidenceRefs: ['receipts/forge/m2-001.json', 'receipts/forge/m3-001.json'],
    ...overrides,
  };
}

function portfolioItem(issue, overrides = {}) {
  return {
    issue,
    title: `Goal #${issue}`,
    state: 'READY',
    prerequisites: [],
    priority: 500,
    route: 'CHATGPT_GITHUB',
    resourceIds: [`goal:${issue}`],
    criticalPathWeight: 500,
    reversibility: 'HIGH',
    evidenceAt: '2026-08-14T14:59:30Z',
    ...overrides,
  };
}

function scheduler(options = {}) {
  const selected = options.selected ?? [portfolioItem(1737)];
  const active = options.active ?? [];
  return {
    correlationId: 'scheduler-workspace-test-001',
    goals: options.goals ?? [...active, ...selected],
    proofHeadShas: options.proofHeadShas ?? [],
    proofReceipts: options.proofReceipts ?? [],
    proofRefs: options.proofRefs ?? [],
    minimumActiveLanes: options.minimumActiveLanes ?? 5,
    maximumActiveLanes: options.maximumActiveLanes ?? 16,
    availableExecutorSlots: options.availableExecutorSlots ?? 16,
  };
}

function host(overrides = {}) {
  return {
    schemaVersion: 'stephanos.foundry-acceleration-host-context.v1',
    repository: REPOSITORY,
    canonicalMainHead: MAIN,
    canonicalMainTree: TREE,
    nowUtc: NOW,
    taskClass: TASK_CLASS,
    minimumNetSavingsSeconds: 60,
    receiptFreshnessSeconds: 300,
    schedulerSource: scheduler(),
    providerCapacityEvidence: [
      evidence('github', 'CHATGPT_GITHUB'),
      evidence('foundry', 'FOUNDRY_FORGE'),
    ],
    forgeSidecar: forgeSidecar(),
    ...overrides,
  };
}

function rebindReceipt(receipt, overrides = {}) {
  const core = { ...receipt, ...overrides };
  delete core.payloadSha256;
  return digestBound(core);
}

function noGainFoundry(availableSlots = 2) {
  return evidence('foundry', 'FOUNDRY_FORGE', {
    build: { p95StartLatencySeconds: 180 },
    metrics: {
      availableSlots,
      medianExecutionSeconds: 600,
      reviewIntegrationSeconds: 120,
      successRate: 0.95,
      reworkRate: 0.05,
    },
  });
}

test('projects a ready planner result into sanitized bounded recommendation truth', () => {
  const slice = createFoundryAccelerationWorkspaceSlice(host());
  assert.equal(slice.schemaVersion, FOUNDRY_ACCELERATION_WORKSPACE_SCHEMA);
  assert.equal(slice.participantId, FOUNDRY_ACCELERATION_WORKSPACE_PARTICIPANT);
  assert.equal(slice.truthState, FOUNDRY_ACCELERATION_WORKSPACE_TRUTH.CURRENT_READY);
  assert.equal(slice.recommendationUsable, true);
  assert.equal(slice.assignmentTotal, 1);
  assert.equal(slice.assignments[0].candidateId, '#1737');
  assert.equal(slice.assignments[0].resourceCount, 1);
  assert.equal(Object.hasOwn(slice.assignments[0], 'resourceIds'), false);
  assert.equal(slice.foundryTelemetry.m2ReceiptId, M2_ID);
  assert.equal(slice.foundryTelemetry.m3RuntimeReceiptId, M3_ID);
});

test('status and event records validate through the canonical Shared Workspace validator', () => {
  const records = createFoundryAccelerationWorkspaceRecords(host());
  assert.equal(records.validation.valid, true);
  assert.equal(records.statusRecord.statusId, FOUNDRY_ACCELERATION_WORKSPACE_STATUS_ID);
  for (const record of [records.statusRecord, records.eventRecord]) {
    const validation = validateSharedWorkspaceRecord(record, { nowMs: Date.parse(NOW) });
    assert.equal(validation.valid, true, validation.errors.join(', '));
  }
});

test('Shared Workspace-incompatible planner identifiers fail closed before READY projection', () => {
  const incompatibleM2Id = 'forge-m2-session';
  const forge = forgeSidecar();
  forge.m2Receipt = rebindReceipt(forge.m2Receipt, { receiptId: incompatibleM2Id });
  const foundry = evidence('foundry', 'FOUNDRY_FORGE', {
    build: { authorityReceiptIds: [incompatibleM2Id, M3_ID] },
  });
  const records = createFoundryAccelerationWorkspaceRecords(host({
    forgeSidecar: forge,
    providerCapacityEvidence: [evidence('github', 'CHATGPT_GITHUB'), foundry],
  }));
  assert.equal(records.slice.truthState, FOUNDRY_ACCELERATION_WORKSPACE_TRUTH.BLOCKED);
  assert.equal(records.slice.planValid, false);
  assert.equal(records.slice.recommendationUsable, false);
  assert.equal(records.slice.assignmentTotal, 0);
  assert.deepEqual(records.slice.assignments, []);
  assert.equal(records.validation.valid, true);
  assert.doesNotMatch(JSON.stringify(records), /session\b/i);
});

test('Shared Workspace-incompatible repository values cannot retain READY truth', () => {
  const incompatibleRepository = 'owner/session-repo';
  const github = evidence('github', 'CHATGPT_GITHUB', {
    build: { repository: incompatibleRepository },
    metrics: { repository: incompatibleRepository },
  });
  const foundry = evidence('foundry', 'FOUNDRY_FORGE', {
    build: { repository: incompatibleRepository },
    metrics: { repository: incompatibleRepository },
  });
  const forge = forgeSidecar({ repository: incompatibleRepository });
  forge.m2Receipt = rebindReceipt(forge.m2Receipt, { repository: incompatibleRepository });
  forge.m3RuntimeReceipt = rebindReceipt(forge.m3RuntimeReceipt, { repository: incompatibleRepository });
  const records = createFoundryAccelerationWorkspaceRecords(host({
    repository: incompatibleRepository,
    providerCapacityEvidence: [github, foundry],
    forgeSidecar: forge,
  }));
  assert.equal(records.slice.truthState, FOUNDRY_ACCELERATION_WORKSPACE_TRUTH.BLOCKED);
  assert.equal(records.slice.planValid, false);
  assert.equal(records.slice.recommendationUsable, false);
  assert.equal(records.slice.repository, null);
  assert.equal(records.slice.assignmentTotal, 0);
  assert.equal(records.validation.valid, true);
  assert.doesNotMatch(JSON.stringify(records), /session\b/i);
});

test('event identity is idempotent for one snapshot and distinct for a changed current recommendation', () => {
  const first = createFoundryAccelerationWorkspaceRecords(host());
  const repeated = createFoundryAccelerationWorkspaceRecords(host());
  const changed = createFoundryAccelerationWorkspaceRecords(host({
    schedulerSource: scheduler({ selected: [portfolioItem(1738)] }),
  }));
  assert.equal(JSON.stringify(first), JSON.stringify(repeated));
  assert.equal(first.eventRecord.eventId, repeated.eventRecord.eventId);
  assert.notEqual(first.eventRecord.eventId, changed.eventRecord.eventId);
  assert.match(first.eventRecord.eventId,
    new RegExp(`^${FOUNDRY_ACCELERATION_WORKSPACE_EVENT_KIND}-[a-f0-9]{24}$`));
  assert.equal(first.eventRecord.eventId.length, 80);
  assert.equal(changed.validation.event.valid, true);
});

test('blocked planner evidence cannot become usable capacity or retain assignments', () => {
  const records = createFoundryAccelerationWorkspaceRecords(host({
    canonicalMainHead: 'c'.repeat(40),
  }));
  assert.equal(records.slice.truthState, FOUNDRY_ACCELERATION_WORKSPACE_TRUTH.BLOCKED);
  assert.equal(records.slice.planValid, false);
  assert.equal(records.slice.recommendationUsable, false);
  assert.equal(records.slice.assignmentTotal, 0);
  assert.deepEqual(records.slice.assignments, []);
  assert.equal(records.slice.timestampUtc, new Date(0).toISOString());
  assert.equal(records.validation.valid, true);
});

test('waiting, no-gain and idle decisions remain visible but unusable', async (t) => {
  await t.test('waiting for canonical M3', () => {
    const forge = forgeSidecar();
    forge.m3RuntimeReceipt = rebindReceipt(forge.m3RuntimeReceipt, { canCarryRealWork: false });
    const slice = createFoundryAccelerationWorkspaceSlice(host({ forgeSidecar: forge }));
    assert.equal(slice.truthState, FOUNDRY_ACCELERATION_WORKSPACE_TRUTH.CURRENT_HELD);
    assert.equal(slice.decision, 'FOUNDRY_ACCELERATION_WAITING_FOR_M3');
    assert.equal(slice.recommendationUsable, false);
  });

  await t.test('no positive gain', () => {
    const slice = createFoundryAccelerationWorkspaceSlice(host({
      minimumNetSavingsSeconds: 0,
      providerCapacityEvidence: [
        evidence('github', 'CHATGPT_GITHUB'),
        noGainFoundry(),
      ],
    }));
    assert.equal(slice.truthState, FOUNDRY_ACCELERATION_WORKSPACE_TRUTH.CURRENT_HELD);
    assert.equal(slice.decision, 'FOUNDRY_ACCELERATION_NO_POSITIVE_GAIN');
    assert.equal(slice.recommendationUsable, false);
  });

  await t.test('canonical idle', () => {
    const slice = createFoundryAccelerationWorkspaceSlice(host({
      schedulerSource: scheduler({ selected: [], goals: [] }),
    }));
    assert.equal(slice.truthState, FOUNDRY_ACCELERATION_WORKSPACE_TRUTH.CURRENT_IDLE);
    assert.equal(slice.decision, 'FOUNDRY_ACCELERATION_IDLE');
    assert.equal(slice.recommendationUsable, false);
  });
});

test('assignment and held inventories respect canonical bounds with truthful totals', async (t) => {
  const selected = Array.from({ length: 24 }, (_, index) => portfolioItem(1800 + index));
  const source = scheduler({ selected });
  const readyFoundry = evidence('foundry', 'FOUNDRY_FORGE', {
    metrics: { availableSlots: 32 },
  });
  const ready = createFoundryAccelerationWorkspaceSlice(host({
    schedulerSource: source,
    providerCapacityEvidence: [evidence('github', 'CHATGPT_GITHUB'), readyFoundry],
  }));
  assert.equal(ready.assignmentTotal, 16);
  assert.equal(ready.assignmentsShown, 16);
  assert.equal(ready.assignmentsTruncated, false);
  assert.ok(Buffer.byteLength(JSON.stringify(ready), 'utf8') < 32 * 1024);

  await t.test('held inventory', () => {
    const held = createFoundryAccelerationWorkspaceSlice(host({
      minimumNetSavingsSeconds: 0,
      schedulerSource: source,
      providerCapacityEvidence: [
        evidence('github', 'CHATGPT_GITHUB'),
        noGainFoundry(),
      ],
    }));
    assert.equal(held.heldCandidateTotal, 16);
    assert.equal(held.heldCandidatesShown, 16);
    assert.equal(held.heldCandidatesTruncated, false);
  });
});

test('projection order is stable across canonical provider and candidate permutations', () => {
  const first = portfolioItem(1701);
  const second = portfolioItem(1702);
  const left = createFoundryAccelerationWorkspaceSlice(host({
    schedulerSource: scheduler({ selected: [second, first] }),
    providerCapacityEvidence: [
      evidence('foundry', 'FOUNDRY_FORGE'),
      evidence('github', 'CHATGPT_GITHUB'),
    ],
  }));
  const right = createFoundryAccelerationWorkspaceSlice(host({
    schedulerSource: scheduler({ selected: [first, second] }),
    providerCapacityEvidence: [
      evidence('github', 'CHATGPT_GITHUB'),
      evidence('foundry', 'FOUNDRY_FORGE'),
    ],
  }));
  assert.deepEqual(left, right);
});

test('raw scheduler, receipt, payload and resource content is never serialized', () => {
  const records = createFoundryAccelerationWorkspaceRecords(host());
  const serialized = JSON.stringify(records);
  for (const forbidden of [
    'payloadSha256',
    'authorityReceiptIds',
    'schedulerSource',
    'forgeSidecar',
    'receipts/forge/m2-001.json',
    'receipts/metrics/foundry-001.json',
    'goal:1737',
    'resourceIds',
  ]) assert.doesNotMatch(serialized, new RegExp(forbidden.replaceAll('/', '\\/')));
  assert.deepEqual(records.statusRecord.proofRefs, []);
});

test('all recommendation, mutation and publication authorities remain false', () => {
  const records = createFoundryAccelerationWorkspaceRecords(host());
  for (const value of [records.slice, records.statusRecord, records.eventRecord]) {
    assert.equal(value.dispatchAllowed, false);
    assert.equal(value.sourceMutationAllowed, false);
    assert.equal(value.branchMutationAllowed, false);
    assert.equal(value.publicationAllowed, false);
    assert.equal(value.mergeAuthority, false);
    assert.equal(value.deploymentAllowed, false);
    assert.equal(value.runtimeMutationAllowed, false);
    assert.equal(value.workspaceWriteAllowed, false);
    assert.equal(value.arbitraryCommandAllowed, false);
  }
});

test('adapter exports no publisher, writer, filesystem or dispatch surface', () => {
  const names = Object.keys(workspaceAdapter);
  assert.ok(names.includes('createFoundryAccelerationWorkspaceSlice'));
  assert.ok(names.includes('createFoundryAccelerationWorkspaceRecords'));
  assert.equal(names.some((name) => /publish|write|append|filesystem|dispatch/i.test(name)), false);
});

test('hostile trusted-context observations fail closed without throwing', () => {
  const hostile = new Proxy({}, {
    ownKeys() { throw new Error('hostile keys'); },
    get() { throw new Error('hostile getter'); },
  });
  const records = createFoundryAccelerationWorkspaceRecords(hostile);
  assert.equal(records.slice.truthState, FOUNDRY_ACCELERATION_WORKSPACE_TRUTH.BLOCKED);
  assert.equal(records.slice.recommendationUsable, false);
  assert.equal(records.validation.valid, true);
});
