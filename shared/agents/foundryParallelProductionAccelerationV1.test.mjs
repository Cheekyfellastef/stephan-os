import { createHash } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FOUNDRY_ACCELERATION_DECISIONS,
  FOUNDRY_ACCELERATION_HOST_CONTEXT_SCHEMA,
  FOUNDRY_ACCELERATION_METRICS_RECEIPT_SCHEMA,
  FOUNDRY_ACCELERATION_SCHEMA,
  planFoundryParallelProductionAcceleration,
} from './foundryParallelProductionAccelerationV1.mjs';

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
function signed(core) {
  return { ...core, payloadSha256:createHash('sha256').update(canonicalJson(core)).digest('hex') };
}

function buildReceipt(providerId, route, overrides = {}) {
  const foundry = route === 'FOUNDRY_FORGE';
  return {
    schemaVersion:'stephanos.build-lane-capacity-receipt.v1',
    receiptId:`${providerId}-capacity-receipt-001`,
    route,
    repository:REPOSITORY,
    workerId:`${providerId}-worker-001`,
    state:'READY',
    supportedOperations:['SOURCE_CONSTRUCTION', 'FOCUSED_TESTS'],
    supportedTaskClasses:[TASK_CLASS],
    observedAtUtc:'2026-08-14T14:58:00Z',
    expiresAtUtc:'2026-08-14T15:10:00Z',
    queueDepth:0,
    p95StartLatencySeconds:providerId === 'github' ? 180 : 10,
    authorityReceiptIds:foundry ? [M2_ID, M3_ID] : ['github-build-authority-001'],
    proofRefs:[`receipts/capacity/${providerId}-001.json`],
    ...overrides,
  };
}

function metricsReceipt(providerId, build, overrides = {}) {
  const core = {
    schemaVersion:FOUNDRY_ACCELERATION_METRICS_RECEIPT_SCHEMA,
    receiptId:`${providerId}-metrics-receipt-001`,
    providerId,
    buildLaneCapacityReceiptId:build.receiptId,
    route:build.route,
    repository:REPOSITORY,
    workerId:build.workerId,
    canonicalMainHead:MAIN,
    canonicalMainTree:TREE,
    taskClass:TASK_CLASS,
    state:build.state,
    supportedOperations:[...build.supportedOperations],
    supportedTaskClasses:[...build.supportedTaskClasses],
    observedAtUtc:'2026-08-14T14:59:00Z',
    expiresAtUtc:'2026-08-14T15:05:00Z',
    availableSlots:2,
    queueDepth:build.queueDepth,
    p95StartLatencySeconds:build.p95StartLatencySeconds,
    medianExecutionSeconds:providerId === 'github' ? 600 : 240,
    reviewIntegrationSeconds:providerId === 'github' ? 120 : 60,
    successRate:0.95,
    reworkRate:0.05,
    authorityReceiptIds:[...build.authorityReceiptIds],
    proofRefs:[...build.proofRefs, `receipts/metrics/${providerId}-001.json`],
    ...overrides,
  };
  return signed(core);
}

function evidence(providerId, route, options = {}) {
  const build = buildReceipt(providerId, route, options.build);
  return { providerId, buildLaneReceipt:build,
    metricsReceipt:metricsReceipt(providerId, build, options.metrics) };
}

function forgeSidecar(overrides = {}) {
  return {
    goalId:'#1671', repository:REPOSITORY, canonicalMainHead:MAIN, canonicalMainTree:TREE,
    mirrorHead:MAIN, mirrorTree:TREE, sourceReady:true,
    m2Receipt:signed({ schemaVersion:'stephanos.forge-shadow-m2-runtime-receipt.v1',
      receiptId:M2_ID, repository:REPOSITORY, sourceHead:MAIN, sourceTree:TREE,
      mirrorHead:MAIN, mirrorTree:TREE, operation:'INSTALL_FORGE_SHADOW_M2', state:'DONE',
      finalVerdict:'FORGE_SHADOW_M2_READY', completedAt:'2026-08-14T14:59:00Z',
      proofRefs:['receipts/forge/m2-001.json'] }),
    m3RuntimeReceipt:signed({ schemaVersion:'stephanos.forge-shadow-m3-runner-runtime-receipt.v1',
      receiptId:M3_ID, repository:REPOSITORY, sourceHead:MAIN, sourceTree:TREE,
      artifactSetDigest:`sha256:${'e'.repeat(64)}`,
      runnerIdentities:['stephanos-forge-linux-runner-01', 'stephanos-forge-windows-proof-runner-01'],
      linuxReviewRunnerConnected:true, windowsProofRunnerConnected:true, teardownComplete:true,
      zeroResidualRegistration:true, zeroResidualCredential:true, zeroResidualWorkspace:true,
      canCarryRealWork:true, finalVerdict:'FORGE_SHADOW_M3_RUNNER_RUNTIME_READY',
      completedAt:'2026-08-14T14:59:00Z', proofRefs:['receipts/forge/m3-001.json'] }),
    evidenceRefs:['receipts/forge/m2-001.json', 'receipts/forge/m3-001.json'],
    ...overrides,
  };
}

function portfolioItem(issue, overrides = {}) {
  return { issue, route:'CHATGPT_GITHUB', resourceIds:[`goal:${issue}`],
    criticalPathWeight:500, lifecycle:'READY', evidenceFreshness:'FRESH', ...overrides };
}
function scheduler(options = {}) {
  const selected = options.selected ?? [portfolioItem(1737)];
  const active = options.active ?? [];
  const portfolio = options.portfolio ?? [...active, ...selected];
  return {
    schemaVersion:'stephanos.mission-scheduler.v1', readOnly:true, failClosed:false,
    contradictions:[], contradictionsTotal:0,
    activeGoals:active.map(({ issue }) => `#${issue}`),
    parallelCandidates:selected.map(({ issue }) => `#${issue}`),
    parallelCandidateDetails:selected.map(({ issue, route, resourceIds }) =>
      ({ candidateId:`#${issue}`, issue, route, resourceIds:[...resourceIds] })),
    portfolio,
    decisionReceipt:{ correlationId:'scheduler-test-001', decidedAt:'2026-08-14T14:59:30Z',
      status:active.length ? (active.length === 1 ? 'ACTIVE_LANE' : 'ACTIVE_LANES')
        : selected.length ? 'LANE_SELECTED' : 'WAITING',
      failClosed:false, contradictionCodes:[], selectedIssue:active.length || !selected.length ? null : selected[0].issue,
      selectedIssues:selected.map(({ issue }) => issue), selectedLifecycle:active.length || !selected.length ? null : 'READY',
      activeIssue:active[0]?.issue ?? null, activeIssues:active.map(({ issue }) => issue),
      route:active[0]?.route ?? selected[0]?.route ?? 'WAITING_FOR_EXTERNAL_CONDITION',
      proofRefs:[], proofHeadShas:[], proofReceipts:[] },
    ...options.projection,
  };
}

function host(overrides = {}) {
  return {
    schemaVersion:FOUNDRY_ACCELERATION_HOST_CONTEXT_SCHEMA,
    repository:REPOSITORY,
    canonicalMainHead:MAIN,
    canonicalMainTree:TREE,
    nowUtc:NOW,
    taskClass:TASK_CLASS,
    minimumNetSavingsSeconds:60,
    receiptFreshnessSeconds:300,
    schedulerProjection:scheduler(),
    providerCapacityEvidence:[evidence('github', 'CHATGPT_GITHUB'), evidence('foundry', 'FOUNDRY_FORGE')],
    forgeSidecar:forgeSidecar(),
    ...overrides,
  };
}

function resign(receipt, overrides = {}) {
  const core = { ...receipt, ...overrides };
  delete core.payloadSha256;
  return signed(core);
}

test('routes canonical scheduler work to canonical M2/M3-bound Foundry capacity', () => {
  const result = planFoundryParallelProductionAcceleration({}, host());
  assert.equal(result.schemaVersion, FOUNDRY_ACCELERATION_SCHEMA);
  assert.equal(result.valid, true);
  assert.equal(result.decision, FOUNDRY_ACCELERATION_DECISIONS.READY);
  assert.equal(result.assignments.length, 1);
  assert.equal(result.assignments[0].providerId, 'foundry');
  assert.ok(result.assignments[0].predictedNetSecondsSaved > 0);
  assert.equal(result.foundryTelemetry.m2ReceiptId, M2_ID);
  assert.equal(result.foundryTelemetry.m3RuntimeReceiptId, M3_ID);
  assert.equal(result.assignments[0].dispatchAuthority, false);
});

test('caller-shaped clocks, heads, metrics, candidates, leases and legacy M3 proof are unobserved', () => {
  const trusted = host();
  const expected = planFoundryParallelProductionAcceleration({}, trusted);
  const hostileRequest = new Proxy({
    nowUtc:'2020-01-01T00:00:00Z', canonicalMainHead:'f'.repeat(40), canonicalMainTree:'e'.repeat(40),
    providers:[{ providerId:'foundry', availableSlots:999, medianExecutionSeconds:0 }],
    candidates:[{ candidateId:'#9999', resourceIds:[] }], activeResourceIds:[],
    m3RuntimeReceipt:{ schemaVersion:'stephanos.forge-shadow-m3-live-capacity.v1', canCarryRealWork:true },
    forgeCapacityAdjudication:{ canCarryRealWork:true, m2ReceiptId:M2_ID, m3RuntimeReceiptId:M3_ID },
  }, { get() { throw new Error('request must not be read'); } });
  assert.deepEqual(planFoundryParallelProductionAcceleration(hostileRequest, trusted), expected);
});

test('a fake legacy M3 receipt cannot replace canonical Forge sidecar adjudication', () => {
  const forge = forgeSidecar();
  forge.m3RuntimeReceipt = resign(forge.m3RuntimeReceipt, { canCarryRealWork:false });
  const result = planFoundryParallelProductionAcceleration({
    m3RuntimeReceipt:{ canCarryRealWork:true, teardownVerdict:'ZERO_RESIDUAL_AUTHORITY' },
  }, host({ forgeSidecar:forge }));
  assert.equal(result.valid, true);
  assert.equal(result.decision, FOUNDRY_ACCELERATION_DECISIONS.WAITING_FOR_M3);
  assert.equal(result.assignments.length, 0);
  assert.ok(result.providerStatus.find(({ providerId }) => providerId === 'foundry').blockers.includes('forge-m3-runtime-invalid'));
});

test('forged root performance numbers cannot influence receipt-bound routing', () => {
  const trusted = host();
  assert.deepEqual(
    planFoundryParallelProductionAcceleration({ providers:[{ providerId:'foundry', medianExecutionSeconds:0, successRate:1 }] }, trusted),
    planFoundryParallelProductionAcceleration({}, trusted),
  );
});

test('trusted head and clock bind receipts despite replayed caller values', () => {
  const expected = planFoundryParallelProductionAcceleration({}, host());
  assert.deepEqual(planFoundryParallelProductionAcceleration({
    canonicalMainHead:'c'.repeat(40), canonicalMainTree:'d'.repeat(40), nowUtc:'2026-08-14T14:00:00Z',
  }, host()), expected);
  assert.equal(planFoundryParallelProductionAcceleration({}, host({ canonicalMainHead:'c'.repeat(40) })).valid, false);
  assert.equal(planFoundryParallelProductionAcceleration({}, host({ nowUtc:'2026-08-14T16:00:00Z' })).valid, false);
});

test('canonical active ownership blocks an omitted caller conflict', () => {
  const active = portfolioItem(1700, { lifecycle:'ACTIVE', resourceIds:['repo:shared/agents/owned.mjs'] });
  const selected = portfolioItem(1737, { resourceIds:['repo:shared/agents/owned.mjs'] });
  const result = planFoundryParallelProductionAcceleration({ activeResourceIds:[] }, host({
    schedulerProjection:scheduler({ active:[active], selected:[selected] }),
  }));
  assert.equal(result.valid, false);
  assert.ok(result.blockers.includes('scheduler-candidate-active-resource-conflict:#1737'));
});

test('scheduler inventory fails closed on omitted active rows or partial resource scopes', async (t) => {
  await t.test('unlisted ACTIVE portfolio row', () => {
    const hidden = portfolioItem(1700, { lifecycle:'ACTIVE', resourceIds:['repo:hidden'] });
    const projection = scheduler({ portfolio:[hidden, portfolioItem(1737)] });
    const result = planFoundryParallelProductionAcceleration({}, host({ schedulerProjection:projection }));
    assert.equal(result.valid, false);
    assert.ok(result.blockers.includes('scheduler-active-portfolio-inventory-mismatch'));
  });
  await t.test('candidate detail omits a portfolio resource', () => {
    const selected = portfolioItem(1737, { resourceIds:['repo:one', 'repo:two'] });
    const projection = scheduler({ selected:[selected] });
    projection.parallelCandidateDetails[0].resourceIds = ['repo:one'];
    const result = planFoundryParallelProductionAcceleration({}, host({ schedulerProjection:projection }));
    assert.equal(result.valid, false);
    assert.ok(result.blockers.includes('scheduler-candidate-resource-mismatch:#1737'));
  });
});

test('scheduler rejects overlapping selections, set mismatches and non-GitHub routes', async (t) => {
  await t.test('pairwise selected overlap', () => {
    const selected = [portfolioItem(1737, { resourceIds:['repo:shared'] }), portfolioItem(1738, { resourceIds:['repo:shared'] })];
    const result = planFoundryParallelProductionAcceleration({}, host({ schedulerProjection:scheduler({ selected }) }));
    assert.equal(result.valid, false);
    assert.ok(result.blockers.includes('scheduler-candidate-parallel-resource-conflict:#1738'));
  });
  await t.test('decision/detail mismatch', () => {
    const projection = scheduler();
    projection.decisionReceipt.selectedIssues = [];
    assert.equal(planFoundryParallelProductionAcceleration({}, host({ schedulerProjection:projection })).valid, false);
  });
  await t.test('non-GitHub route', () => {
    const selected = [portfolioItem(1737, { route:'OPENCLAW_LOCAL' })];
    const result = planFoundryParallelProductionAcceleration({}, host({ schedulerProjection:scheduler({ selected }) }));
    assert.equal(result.valid, false);
    assert.ok(result.blockers.includes('scheduler-candidate-route-not-accelerable:#1737'));
  });
  await t.test('contradictory decision status and codes', () => {
    const projection = scheduler();
    projection.decisionReceipt.status = 'BLOCKED_FAIL_CLOSED';
    projection.decisionReceipt.contradictionCodes = ['ACTIVE_RESOURCE_CONFLICT'];
    const result = planFoundryParallelProductionAcceleration({}, host({ schedulerProjection:projection }));
    assert.equal(result.valid, false);
    assert.ok(result.blockers.includes('scheduler-decision-stale-or-invalid'));
  });
  await t.test('truncated decision receipt shape', () => {
    const projection = scheduler();
    delete projection.decisionReceipt.contradictionCodes;
    const result = planFoundryParallelProductionAcceleration({}, host({ schedulerProjection:projection }));
    assert.equal(result.valid, false);
    assert.ok(result.blockers.includes('scheduler-decision-receipt-shape-invalid'));
  });
  for (const invalidStatus of [null, { state:'LANE_SELECTED' }, 'INVENTED_READY']) {
    await t.test(`noncanonical decision status ${JSON.stringify(invalidStatus)}`, () => {
      const projection = scheduler();
      projection.decisionReceipt.status = invalidStatus;
      const result = planFoundryParallelProductionAcceleration({}, host({ schedulerProjection:projection }));
      assert.equal(result.valid, false);
      assert.ok(result.blockers.includes('scheduler-decision-stale-or-invalid'));
    });
  }
});

test('a zero-slot GitHub lane remains a valid measured baseline for healthy Foundry capacity', () => {
  const github = evidence('github', 'CHATGPT_GITHUB', { metrics:{ availableSlots:0 } });
  const result = planFoundryParallelProductionAcceleration({}, host({
    providerCapacityEvidence:[github, evidence('foundry', 'FOUNDRY_FORGE')],
  }));
  assert.equal(result.valid, true);
  assert.equal(result.decision, FOUNDRY_ACCELERATION_DECISIONS.READY);
  assert.equal(result.assignments[0].providerId, 'foundry');
  const baseline = result.providerStatus.find(({ providerId }) => providerId === 'github');
  assert.equal(baseline.evidenceValid, true);
  assert.equal(baseline.eligible, false);
});

test('zero and negative savings never route even when the trusted minimum is zero', async (t) => {
  const zeroFoundry = evidence('foundry', 'FOUNDRY_FORGE', {
    build:{ p95StartLatencySeconds:180 },
    metrics:{ medianExecutionSeconds:600, reviewIntegrationSeconds:120, successRate:0.95, reworkRate:0.05 },
  });
  const zero = planFoundryParallelProductionAcceleration({}, host({
    minimumNetSavingsSeconds:0,
    providerCapacityEvidence:[evidence('github', 'CHATGPT_GITHUB'), zeroFoundry],
  }));
  assert.equal(zero.assignments.length, 0);
  assert.equal(zero.decision, FOUNDRY_ACCELERATION_DECISIONS.NO_POSITIVE_GAIN);
  await t.test('negative savings', () => {
    const negativeFoundry = evidence('foundry', 'FOUNDRY_FORGE', {
      build:{ p95StartLatencySeconds:181 },
      metrics:{ medianExecutionSeconds:600, reviewIntegrationSeconds:120, successRate:0.95, reworkRate:0.05 },
    });
    const result = planFoundryParallelProductionAcceleration({}, host({ minimumNetSavingsSeconds:0,
      providerCapacityEvidence:[evidence('github', 'CHATGPT_GITHUB'), negativeFoundry] }));
    assert.equal(result.assignments.length, 0);
  });
});

test('metrics receipts fail closed when identity, snapshot or validity bindings diverge', async (t) => {
  const cases = [
    ['wrong head', { canonicalMainHead:'c'.repeat(40) }],
    ['wrong tree', { canonicalMainTree:'d'.repeat(40) }],
    ['wrong repository', { repository:'hostile/repo' }],
    ['expiry exceeds build receipt', { expiresAtUtc:'2026-08-14T15:20:00Z' }],
    ['future observation', { observedAtUtc:'2026-08-14T15:02:00Z' }],
  ];
  for (const [name, overrides] of cases) {
    await t.test(name, () => {
      const foundry = evidence('foundry', 'FOUNDRY_FORGE', { metrics:overrides });
      const result = planFoundryParallelProductionAcceleration({}, host({
        providerCapacityEvidence:[evidence('github', 'CHATGPT_GITHUB'), foundry],
      }));
      assert.equal(result.valid, false);
    });
  }
  await t.test('payload tamper', () => {
    const foundry = evidence('foundry', 'FOUNDRY_FORGE');
    foundry.metricsReceipt.medianExecutionSeconds = 0;
    const result = planFoundryParallelProductionAcceleration({}, host({
      providerCapacityEvidence:[evidence('github', 'CHATGPT_GITHUB'), foundry],
    }));
    assert.equal(result.valid, false);
    assert.ok(result.blockers.includes('metrics-payload-digest-invalid'));
  });
});

test('Foundry capacity must carry both canonical M2 and M3 authority identities', () => {
  const foundry = evidence('foundry', 'FOUNDRY_FORGE', {
    build:{ authorityReceiptIds:['foundry-build-authority-001'] },
  });
  const result = planFoundryParallelProductionAcceleration({}, host({
    providerCapacityEvidence:[evidence('github', 'CHATGPT_GITHUB'), foundry],
  }));
  assert.equal(result.valid, true);
  assert.equal(result.decision, FOUNDRY_ACCELERATION_DECISIONS.WAITING_FOR_M3);
  assert.ok(result.providerStatus.find(({ providerId }) => providerId === 'foundry').blockers.includes('foundry-forge-authority-binding-invalid'));
});

test('fractional canonical p95 latency remains valid and duplicate lane identities do not', () => {
  const foundry = evidence('foundry', 'FOUNDRY_FORGE', { build:{ p95StartLatencySeconds:0.5 } });
  const fractionalScheduler = scheduler({ selected:[portfolioItem(1737, { criticalPathWeight:0.5 })] });
  assert.equal(planFoundryParallelProductionAcceleration({}, host({
    providerCapacityEvidence:[evidence('github', 'CHATGPT_GITHUB'), foundry],
    schedulerProjection:fractionalScheduler,
  })).valid, true);
  const duplicate = evidence('github-two', 'CHATGPT_GITHUB');
  const blocked = planFoundryParallelProductionAcceleration({}, host({
    providerCapacityEvidence:[evidence('github', 'CHATGPT_GITHUB'), duplicate, evidence('foundry', 'FOUNDRY_FORGE')],
  }));
  assert.equal(blocked.valid, false);
  assert.ok(blocked.blockers.includes('provider-route-duplicate'));
});

test('authority is always recommendation-only on success and failure', () => {
  const expected = { dispatch:false, sourceMutation:false, branchMutation:false, publication:false,
    merge:false, deployment:false, runtimeMutation:false, credentialAccess:false,
    arbitraryCommand:false, recommendationOnly:true };
  assert.deepEqual(planFoundryParallelProductionAcceleration({}, host()).authority, expected);
  assert.deepEqual(planFoundryParallelProductionAcceleration({}, {}).authority, expected);
});

test('empty canonical inventory is idle and sparse or hostile trusted observations fail closed', () => {
  const idleProjection = scheduler({ selected:[], portfolio:[] });
  const idle = planFoundryParallelProductionAcceleration({}, host({ schedulerProjection:idleProjection }));
  assert.equal(idle.valid, true);
  assert.equal(idle.decision, FOUNDRY_ACCELERATION_DECISIONS.IDLE);
  assert.equal(idle.totalCriticalPathSecondsSaved, 0);

  const sparse = new Array(2);
  assert.equal(planFoundryParallelProductionAcceleration({}, host({ providerCapacityEvidence:sparse })).valid, false);
  const hostile = new Proxy({}, { get() { throw new Error('hostile host getter'); }, ownKeys() { throw new Error('hostile host keys'); } });
  const blocked = planFoundryParallelProductionAcceleration({}, hostile);
  assert.equal(blocked.valid, false);
  assert.ok(blocked.blockers.includes('trusted-host-context-observation-failed'));
});
