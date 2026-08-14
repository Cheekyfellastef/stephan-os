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
  return { issue, title:`Goal #${issue}`, state:'READY', prerequisites:[], priority:500,
    criticalPathWeight:500, reversibility:'HIGH', route:'CHATGPT_GITHUB',
    resourceIds:[`goal:${issue}`], evidenceAt:'2026-08-14T14:59:30Z', ...overrides };
}
function scheduler(options = {}) {
  const selected = options.selected ?? [portfolioItem(1737)];
  const active = options.active ?? [];
  return {
    correlationId:'scheduler-test-001',
    goals:options.goals ?? [...active, ...selected],
    proofHeadShas:options.proofHeadShas ?? [],
    proofReceipts:options.proofReceipts ?? [],
    proofRefs:options.proofRefs ?? [],
    minimumActiveLanes:options.minimumActiveLanes ?? 5,
    maximumActiveLanes:options.maximumActiveLanes ?? 16,
    availableExecutorSlots:options.availableExecutorSlots ?? 8,
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
    schedulerSource:scheduler(),
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
  const provider = result.providerStatus.find(({ providerId }) => providerId === 'foundry');
  assert.ok(provider.blockers.includes('forge-m3-runtime-invalid'));
  assert.equal(provider.evidenceValid, false);
  assert.equal(provider.eligible, false);
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

test('canonical scheduler owns priority, resource-disjoint admission and capacity', async (t) => {
  await t.test('caller ordering cannot promote the lower-priority candidate', () => {
    const low = portfolioItem(1738, { priority:1, criticalPathWeight:1 });
    const high = portfolioItem(1737, { operatorPriority:true, priority:1, criticalPathWeight:1 });
    const foundry = evidence('foundry', 'FOUNDRY_FORGE', { metrics:{ availableSlots:1 } });
    const result = planFoundryParallelProductionAcceleration({}, host({
      schedulerSource:scheduler({ selected:[low, high] }),
      providerCapacityEvidence:[evidence('github', 'CHATGPT_GITHUB'), foundry],
    }));
    assert.equal(result.valid, true);
    assert.equal(result.assignments[0].candidateId, '#1737');
    assert.equal(result.heldCandidates[0].candidateId, '#1738');
  });

  await t.test('canonical remainingAdmissionSlots caps recommendations even when Foundry has more slots', () => {
    const active = Array.from({ length:4 }, (_, index) => portfolioItem(1600 + index, {
      state:'ACTIVE', activePr:2600 + index, resourceIds:[`active:${index}`],
    }));
    const selected = [
      portfolioItem(1737, { operatorPriority:true }),
      portfolioItem(1738),
    ];
    const foundry = evidence('foundry', 'FOUNDRY_FORGE', { metrics:{ availableSlots:2 } });
    const result = planFoundryParallelProductionAcceleration({}, host({
      schedulerSource:scheduler({ active, selected, availableExecutorSlots:5 }),
      providerCapacityEvidence:[evidence('github', 'CHATGPT_GITHUB'), foundry],
    }));
    assert.equal(result.valid, true);
    assert.deepEqual(result.assignments.map(({ candidateId }) => candidateId), ['#1737']);
  });

  await t.test('active ownership prevents a conflicting candidate from entering the canonical projection', () => {
    const active = portfolioItem(1700, {
      state:'ACTIVE', activePr:2700, resourceIds:['repo:shared/agents/owned.mjs'],
    });
    const selected = portfolioItem(1737, { resourceIds:['repo:shared/agents/owned.mjs'] });
    const result = planFoundryParallelProductionAcceleration({ activeResourceIds:[] }, host({
      schedulerSource:scheduler({ active:[active], selected:[selected] }),
    }));
    assert.equal(result.valid, true);
    assert.equal(result.assignments.length, 0);
  });

  await t.test('pairwise resource overlap admits only the canonical first owner', () => {
    const selected = [
      portfolioItem(1737, { operatorPriority:true, resourceIds:['repo:shared'] }),
      portfolioItem(1738, { resourceIds:['repo:shared'] }),
    ];
    const result = planFoundryParallelProductionAcceleration({}, host({
      schedulerSource:scheduler({ selected }),
    }));
    assert.deepEqual(result.assignments.map(({ candidateId }) => candidateId), ['#1737']);
  });

  await t.test('a caller-shaped scheduler projection is outside the trusted contract', () => {
    const result = planFoundryParallelProductionAcceleration({}, host({
      schedulerProjection:{ parallelCandidates:['#9999'] },
    }));
    assert.equal(result.valid, false);
    assert.ok(result.blockers.includes('trusted-host-context-shape-invalid'));
  });
});

test('trusted scheduler source is snapshotted once and fails closed on hidden authority', async (t) => {
  await t.test('stateful descriptors are observed once before canonical scheduling', () => {
    let priorityReads = 0;
    const target = portfolioItem(1737, { priority:1 });
    const stateful = new Proxy(target, {
      getOwnPropertyDescriptor(object, key) {
        const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
        if (key !== 'priority') return descriptor;
        priorityReads += 1;
        return { ...descriptor, value:priorityReads === 1 ? 1000 : 0 };
      },
    });
    const result = planFoundryParallelProductionAcceleration({}, host({
      schedulerSource:scheduler({ selected:[stateful, portfolioItem(1738, { priority:500 })] }),
    }));
    assert.equal(result.valid, true);
    assert.equal(result.assignments[0].candidateId, '#1737');
    assert.equal(priorityReads, 1);
  });

  await t.test('accessors are rejected without invocation', () => {
    let reads = 0;
    const source = scheduler();
    Object.defineProperty(source.goals[0], 'priority', {
      enumerable:true, configurable:true,
      get() { reads += 1; return 1000; },
    });
    const result = planFoundryParallelProductionAcceleration({}, host({ schedulerSource:source }));
    assert.equal(result.valid, false);
    assert.ok(result.blockers.includes('trusted-host-context-inspection-failed'));
    assert.equal(reads, 0);
  });

  await t.test('symbol and widened array keys are rejected', () => {
    const symbolic = scheduler();
    symbolic[Symbol('hidden-authority')] = 'CHATGPT_GITHUB';
    const symbolResult = planFoundryParallelProductionAcceleration({}, host({ schedulerSource:symbolic }));
    assert.equal(symbolResult.valid, false);
    assert.ok(symbolResult.blockers.includes('trusted-host-context-inspection-failed'));

    const widened = scheduler();
    widened.goals.hiddenRoute = 'CHATGPT_GITHUB';
    const widenedResult = planFoundryParallelProductionAcceleration({}, host({ schedulerSource:widened }));
    assert.equal(widenedResult.valid, false);
    assert.ok(widenedResult.blockers.includes('trusted-host-context-inspection-failed'));
  });

  await t.test('source clocks and freshness cannot override the trusted host', () => {
    const source = { ...scheduler(), now:'2020-01-01T00:00:00Z' };
    const result = planFoundryParallelProductionAcceleration({}, host({ schedulerSource:source }));
    assert.equal(result.valid, false);
    assert.ok(result.blockers.includes('scheduler-source-shape-invalid'));
  });
});

test('provider metrics are snapshotted once before digest validation and routing', async (t) => {
  await t.test('stateful metric descriptors cannot drift after the digest-bound value', () => {
    const normalFoundry = evidence('foundry', 'FOUNDRY_FORGE');
    const expected = planFoundryParallelProductionAcceleration({}, host({
      providerCapacityEvidence:[evidence('github', 'CHATGPT_GITHUB'), normalFoundry],
    }));
    const foundry = evidence('foundry', 'FOUNDRY_FORGE');
    const receipt = foundry.metricsReceipt;
    let reads = 0;
    foundry.metricsReceipt = new Proxy(receipt, {
      getOwnPropertyDescriptor(target, key) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
        if (key !== 'medianExecutionSeconds') return descriptor;
        reads += 1;
        return { ...descriptor, value:reads === 1 ? descriptor.value : 0 };
      },
    });
    const result = planFoundryParallelProductionAcceleration({}, host({
      providerCapacityEvidence:[evidence('github', 'CHATGPT_GITHUB'), foundry],
    }));
    assert.deepEqual(result, expected);
    assert.equal(reads, 1);
  });

  await t.test('metric accessors fail closed without invocation', () => {
    const foundry = evidence('foundry', 'FOUNDRY_FORGE');
    let reads = 0;
    Object.defineProperty(foundry.metricsReceipt, 'medianExecutionSeconds', {
      enumerable:true, configurable:true,
      get() { reads += 1; return 0; },
    });
    const result = planFoundryParallelProductionAcceleration({}, host({
      providerCapacityEvidence:[evidence('github', 'CHATGPT_GITHUB'), foundry],
    }));
    assert.equal(result.valid, false);
    assert.ok(result.blockers.includes('trusted-host-context-inspection-failed'));
    assert.equal(reads, 0);
  });
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

test('positive candidates held after Foundry slots are consumed report slot exhaustion', () => {
  const selected = [portfolioItem(1737, { criticalPathWeight:1000 }), portfolioItem(1738)];
  const foundry = evidence('foundry', 'FOUNDRY_FORGE', { metrics:{ availableSlots:1 } });
  const result = planFoundryParallelProductionAcceleration({}, host({
    schedulerSource:scheduler({ selected }),
    providerCapacityEvidence:[evidence('github', 'CHATGPT_GITHUB'), foundry],
  }));
  assert.equal(result.valid, true);
  assert.equal(result.assignments.length, 1);
  assert.equal(result.heldCandidates.length, 1);
  assert.equal(result.heldCandidates[0].candidateId, '#1738');
  assert.equal(result.heldCandidates[0].reason, 'NO_AVAILABLE_FOUNDRY_SLOT_USE_GITHUB');
});

test('assignment admission preserves canonical scheduler candidate order', () => {
  const selected = [
    portfolioItem(1738, { criticalPathWeight:1000 }),
    portfolioItem(1737, { operatorPriority:true, criticalPathWeight:1 }),
  ];
  const foundry = evidence('foundry', 'FOUNDRY_FORGE', { metrics:{ availableSlots:1 } });
  const result = planFoundryParallelProductionAcceleration({}, host({
    schedulerSource:scheduler({ selected }),
    providerCapacityEvidence:[evidence('github', 'CHATGPT_GITHUB'), foundry],
  }));
  assert.equal(result.valid, true);
  assert.equal(result.assignments[0].candidateId, '#1737');
  assert.equal(result.heldCandidates[0].candidateId, '#1738');
});

test('valid non-GitHub scheduler work is filtered without blocking GitHub acceleration', () => {
  const selected = [
    portfolioItem(1737),
    portfolioItem(1738, { route:'OPENCLAW_LOCAL' }),
  ];
  const result = planFoundryParallelProductionAcceleration({}, host({
    schedulerSource:scheduler({ selected }),
  }));
  assert.equal(result.valid, true);
  assert.equal(result.decision, FOUNDRY_ACCELERATION_DECISIONS.READY);
  assert.deepEqual(result.assignments.map(({ candidateId }) => candidateId), ['#1737']);
  assert.deepEqual(result.heldCandidates, []);
});

test('a proven zero-slot Foundry lane reports current capacity exhaustion, not missing proof', () => {
  const foundry = evidence('foundry', 'FOUNDRY_FORGE', { metrics:{ availableSlots:0 } });
  const result = planFoundryParallelProductionAcceleration({}, host({
    providerCapacityEvidence:[evidence('github', 'CHATGPT_GITHUB'), foundry],
  }));
  assert.equal(result.valid, true);
  assert.equal(result.decision, FOUNDRY_ACCELERATION_DECISIONS.WAITING_FOR_CAPACITY);
  assert.equal(result.assignments.length, 0);
  assert.equal(result.heldCandidates[0].reason, 'NO_AVAILABLE_FOUNDRY_SLOT_USE_GITHUB');
  assert.equal(result.foundryTelemetry.status, 'CAPACITY_EXHAUSTED');
  assert.equal(result.foundryTelemetry.operatorRequired, false);
  const provider = result.providerStatus.find(({ providerId }) => providerId === 'foundry');
  assert.equal(provider.evidenceValid, true);
  assert.equal(provider.eligible, false);
});

test('zero Foundry slots do not mask a nonpositive acceleration comparison', () => {
  const foundry = evidence('foundry', 'FOUNDRY_FORGE', {
    build:{ p95StartLatencySeconds:180 },
    metrics:{ availableSlots:0, medianExecutionSeconds:600, reviewIntegrationSeconds:120,
      successRate:0.95, reworkRate:0.05 },
  });
  const result = planFoundryParallelProductionAcceleration({}, host({
    minimumNetSavingsSeconds:0,
    providerCapacityEvidence:[evidence('github', 'CHATGPT_GITHUB'), foundry],
  }));
  assert.equal(result.valid, true);
  assert.equal(result.decision, FOUNDRY_ACCELERATION_DECISIONS.NO_POSITIVE_GAIN);
  assert.equal(result.heldCandidates[0].reason, 'NO_POSITIVE_NET_ACCELERATION_USE_GITHUB');
});

test('fractional reliability penalties are not independently rounded into false savings', () => {
  const github = evidence('github', 'CHATGPT_GITHUB', {
    build:{ p95StartLatencySeconds:0 },
    metrics:{ medianExecutionSeconds:1, reviewIntegrationSeconds:0,
      successRate:0.99, reworkRate:0.01 },
  });
  const foundry = evidence('foundry', 'FOUNDRY_FORGE', {
    build:{ p95StartLatencySeconds:0 },
    metrics:{ medianExecutionSeconds:2, reviewIntegrationSeconds:0,
      successRate:1, reworkRate:0 },
  });
  const result = planFoundryParallelProductionAcceleration({}, host({
    minimumNetSavingsSeconds:0,
    providerCapacityEvidence:[github, foundry],
  }));
  assert.equal(result.valid, true);
  assert.equal(result.decision, FOUNDRY_ACCELERATION_DECISIONS.NO_POSITIVE_GAIN);
  const baseline = result.providerStatus.find(({ providerId }) => providerId === 'github');
  assert.ok(Math.abs(baseline.predictedSeconds - 1.02) < Number.EPSILON * 4);
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
  const provider = result.providerStatus.find(({ providerId }) => providerId === 'foundry');
  assert.ok(provider.blockers.includes('foundry-forge-authority-binding-invalid'));
  assert.equal(provider.evidenceValid, false);
  assert.equal(provider.eligible, false);
});

test('Forge M2 and M3 authority stages require distinct receipt identities', () => {
  const sidecar = forgeSidecar();
  sidecar.m3RuntimeReceipt = resign(sidecar.m3RuntimeReceipt, { receiptId:M2_ID });
  const foundry = evidence('foundry', 'FOUNDRY_FORGE', {
    build:{ authorityReceiptIds:[M2_ID] },
  });
  const result = planFoundryParallelProductionAcceleration({}, host({
    forgeSidecar:sidecar,
    providerCapacityEvidence:[evidence('github', 'CHATGPT_GITHUB'), foundry],
  }));
  assert.equal(result.valid, true);
  assert.equal(result.decision, FOUNDRY_ACCELERATION_DECISIONS.WAITING_FOR_M3);
  const provider = result.providerStatus.find(({ providerId }) => providerId === 'foundry');
  assert.ok(provider.blockers.includes('forge-receipt-identities-not-distinct'));
  assert.equal(provider.evidenceValid, false);
  assert.equal(provider.eligible, false);
});

test('fractional canonical p95 latency remains valid and duplicate lane identities do not', () => {
  const foundry = evidence('foundry', 'FOUNDRY_FORGE', { build:{ p95StartLatencySeconds:0.5 } });
  const fractionalScheduler = scheduler({ selected:[portfolioItem(1737, { criticalPathWeight:0.5 })] });
  assert.equal(planFoundryParallelProductionAcceleration({}, host({
    providerCapacityEvidence:[evidence('github', 'CHATGPT_GITHUB'), foundry],
    schedulerSource:fractionalScheduler,
  })).valid, true);
  const duplicate = evidence('github-two', 'CHATGPT_GITHUB');
  const blocked = planFoundryParallelProductionAcceleration({}, host({
    providerCapacityEvidence:[evidence('github', 'CHATGPT_GITHUB'), duplicate, evidence('foundry', 'FOUNDRY_FORGE')],
  }));
  assert.equal(blocked.valid, false);
  assert.ok(blocked.blockers.includes('provider-route-duplicate'));
});

test('canonical-equivalent receipt IDs cannot evade duplicate detection with whitespace', async (t) => {
  await t.test('build capacity receipt IDs', () => {
    const github = evidence('github', 'CHATGPT_GITHUB', {
      build:{ receiptId:' shared-capacity-receipt-001 ' },
    });
    const foundry = evidence('foundry', 'FOUNDRY_FORGE', {
      build:{ receiptId:'shared-capacity-receipt-001' },
    });
    const result = planFoundryParallelProductionAcceleration({}, host({
      providerCapacityEvidence:[github, foundry],
    }));
    assert.equal(result.valid, false);
    assert.ok(result.blockers.includes('capacity-receipt-id-duplicate'));
  });

  await t.test('metrics receipt IDs', () => {
    const github = evidence('github', 'CHATGPT_GITHUB', {
      metrics:{ receiptId:' shared-metrics-receipt-001 ' },
    });
    const foundry = evidence('foundry', 'FOUNDRY_FORGE', {
      metrics:{ receiptId:'shared-metrics-receipt-001' },
    });
    const result = planFoundryParallelProductionAcceleration({}, host({
      providerCapacityEvidence:[github, foundry],
    }));
    assert.equal(result.valid, false);
    assert.ok(result.blockers.includes('metrics-receipt-id-duplicate'));
  });
});

test('one canonical receipt identity cannot be reused across build and metrics stages', async (t) => {
  await t.test('within one provider entry', () => {
    const github = evidence('github', 'CHATGPT_GITHUB', {
      metrics:{ receiptId:'github-capacity-receipt-001' },
    });
    const result = planFoundryParallelProductionAcceleration({}, host({
      providerCapacityEvidence:[github, evidence('foundry', 'FOUNDRY_FORGE')],
    }));
    assert.equal(result.valid, false);
    assert.ok(result.blockers.includes('metrics-receipt-id-duplicate'));
  });

  await t.test('when a later build reuses an earlier metrics identity', () => {
    const github = evidence('github', 'CHATGPT_GITHUB', {
      metrics:{ receiptId:'shared-cross-stage-receipt-001' },
    });
    const foundry = evidence('foundry', 'FOUNDRY_FORGE', {
      build:{ receiptId:' shared-cross-stage-receipt-001 ' },
    });
    const result = planFoundryParallelProductionAcceleration({}, host({
      providerCapacityEvidence:[github, foundry],
    }));
    assert.equal(result.valid, false);
    assert.ok(result.blockers.includes('capacity-receipt-id-duplicate'));
  });
});

test('Forge authority IDs cannot reuse build or metrics receipt identities', async (t) => {
  await t.test('M2 identity reused by a build receipt', () => {
    const foundry = evidence('foundry', 'FOUNDRY_FORGE', {
      build:{ receiptId:M2_ID },
    });
    const result = planFoundryParallelProductionAcceleration({}, host({
      providerCapacityEvidence:[evidence('github', 'CHATGPT_GITHUB'), foundry],
    }));
    assert.equal(result.valid, false);
    assert.ok(result.blockers.includes('forge-receipt-id-duplicate'));
  });

  await t.test('M3 identity reused by a metrics receipt', () => {
    const foundry = evidence('foundry', 'FOUNDRY_FORGE', {
      metrics:{ receiptId:M3_ID },
    });
    const result = planFoundryParallelProductionAcceleration({}, host({
      providerCapacityEvidence:[evidence('github', 'CHATGPT_GITHUB'), foundry],
    }));
    assert.equal(result.valid, false);
    assert.ok(result.blockers.includes('forge-receipt-id-duplicate'));
  });
});

test('authority is always recommendation-only on success and failure', () => {
  const expected = { dispatch:false, sourceMutation:false, branchMutation:false, publication:false,
    merge:false, deployment:false, runtimeMutation:false, credentialAccess:false,
    arbitraryCommand:false, recommendationOnly:true };
  assert.deepEqual(planFoundryParallelProductionAcceleration({}, host()).authority, expected);
  assert.deepEqual(planFoundryParallelProductionAcceleration({}, {}).authority, expected);
});

test('empty canonical inventory is idle and sparse or hostile trusted observations fail closed', () => {
  const idleSource = scheduler({ selected:[], goals:[] });
  const idle = planFoundryParallelProductionAcceleration({}, host({ schedulerSource:idleSource }));
  assert.equal(idle.valid, true);
  assert.equal(idle.decision, FOUNDRY_ACCELERATION_DECISIONS.IDLE);
  assert.equal(idle.totalCriticalPathSecondsSaved, 0);

  const sparse = new Array(2);
  assert.equal(planFoundryParallelProductionAcceleration({}, host({ providerCapacityEvidence:sparse })).valid, false);
  const hostile = new Proxy({}, { get() { throw new Error('hostile host getter'); }, ownKeys() { throw new Error('hostile host keys'); } });
  const blocked = planFoundryParallelProductionAcceleration({}, hostile);
  assert.equal(blocked.valid, false);
  assert.ok(blocked.blockers.includes('trusted-host-context-inspection-failed'));
});
