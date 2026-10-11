import assert from 'node:assert/strict';
import test from 'node:test';
import {
  refreshSovereignBuilder8Capacity,
  SOVEREIGN_BUILDER8_WORKER_ID,
  SOVEREIGN_BUILDER8_STATUS_ID,
} from './sovereignBuilder8CapacityService.js';
import { routeMissionControllerCapacity } from '../../shared/agents/missionControllerCapacityRouterV1.mjs';
import { dispatchElasticGoalBuilds } from './criticalBacklogConveyorService.js';

const HEAD = 'b'.repeat(40);
const NOW = new Date('2026-10-10T14:00:00.000Z');
function harness(overrides = {}) {
  const statuses = [], proofs = [], receipts = [];
  let readHeadCalls = 0;
  const opts = {
    now: NOW,
    env: { STEPHANOS_OLLAMA_ENDPOINT: 'http://127.0.0.1:11434/api/chat', STEPHANOS_LOCAL_BUILDER_MODEL: 'qwen3-coder:30b' },
    paths: { repoRoot: 'C:/repo', workspaceRoot: 'C:/workspace' },
    readSourceHead: async () => { readHeadCalls += 1; return HEAD; },
    probeEnvironment: async () => ({ ok: true, workerCount: 1, governorState: 'NORMAL', freeVramMib: 20000 }),
    probeModel: async () => ({
      ok: true, model: 'qwen3-coder:30b', loadState: 'READY',
      requestSha256: '1'.repeat(64), responseSha256: '2'.repeat(64),
    }),
    readQueue: async () => [{ adapter: 'sovereign-commander' }, { adapter: 'foundry-forge' }],
    writeProof: async (record) => { proofs.push(record); return { ok: true }; },
    publishCapacity: async (receipt) => { receipts.push(receipt); return { ok: true }; },
    writeStatus: async (record) => { statuses.push(record); return { ok: true }; },
    ...overrides,
  };
  return { opts, statuses, proofs, receipts, getHeadReads: () => readHeadCalls };
}
function route(capacityReceipt, blockedAdapters = []) {
  return routeMissionControllerCapacity({
    nowUtc: NOW.toISOString(), sourceHead: HEAD,
    mission: { missionId: 'critical-3002-elastic-goal', repository: 'Cheekyfellastef/stephan-os' },
    task: { taskClass: 'FOCUSED_REPAIR' },
    blockedAdapters,
    sovereignCommanderLaneReceipt: capacityReceipt,
    codexStatus: null,
  });
}
test('Builder 8 uses unique exact-head receipt and proof before publication, then can be routed', async () => {
  const h = harness();
  const result = await refreshSovereignBuilder8Capacity(h.opts);
  assert.equal(result.ok, true);
  assert.equal(result.workerId, SOVEREIGN_BUILDER8_WORKER_ID);
  assert.equal(result.queueDepth, 1);
  assert.equal(h.getHeadReads(), 2);
  assert.equal(h.proofs.length, 1);
  assert.equal(h.receipts.length, 1);
  assert.equal(h.statuses.length, 0);
  assert.equal(h.proofs[0].sourceHead, HEAD);
  assert.equal(h.receipts[0].authorityReceiptIds[0], 'sovereign-builder8-source-' + HEAD);
  assert.equal(h.receipts[0].proofRefs[0], 'proof/sovereign-builder8-capacity-' + HEAD + '.json');
  assert.equal(h.receipts[0].workerId, SOVEREIGN_BUILDER8_WORKER_ID);
  assert.equal(h.receipts[0].p95StartLatencySeconds, 90);
  assert.equal(route(h.receipts[0]).route, 'SOVEREIGN_COMMANDER');
  assert.equal(route(h.receipts[0]).adapter, 'sovereign-commander');
  assert.equal(route(h.receipts[0], ['sovereign-commander']).dispatchAllowed, false);
});

test('Builder 8 refuses absent or duplicate canonical worker, gaming, memory pressure and missing commander', async () => {
  for (const reason of [
    'SOVEREIGN_BUILDER8_CANONICAL_WORKER_NOT_UNIQUE_AND_RUNNING',
    'SOVEREIGN_BUILDER8_GAMING_ACTIVE_OR_UNKNOWN',
    'SOVEREIGN_BUILDER8_RAM_PRESSURE',
    'SOVEREIGN_BUILDER8_COMMANDER_UNHEALTHY',
  ]) {
    const h = harness({ probeEnvironment: async () => ({ ok: false, reason }) });
    const result = await refreshSovereignBuilder8Capacity(h.opts);
    assert.equal(result.ok, false, reason);
    assert.equal(result.reason, reason);
    assert.equal(h.receipts.length, 0);
    assert.equal(h.statuses[0].statusId, SOVEREIGN_BUILDER8_STATUS_ID);
    assert.equal(h.statuses[0].status, 'BLOCKED');
    assert.equal(route(null).dispatchAllowed, false);
  }
});
test('Builder 8 never substitutes a model or accepts unqualified model output', async () => {
  for (const probe of [
    { ok: false, reason: 'native-model-not-installed' },
    { ok: true, model: 'other:14b', loadState: 'READY', requestSha256: '1'.repeat(64), responseSha256: '2'.repeat(64) },
    { ok: true, model: 'qwen3-coder:30b', loadState: 'READY', requestSha256: 'x', responseSha256: '2'.repeat(64) },
  ]) {
    const h = harness({ probeModel: async () => probe });
    assert.equal((await refreshSovereignBuilder8Capacity(h.opts)).ok, false);
    assert.equal(h.receipts.length, 0);
  }
});
test('Builder 8 rejects non-loopback endpoint, moved source, queue saturation, failed proof, failed status', async () => {
  const cases = [
    { env: { STEPHANOS_OLLAMA_ENDPOINT: 'https://example.com/api/chat' } },
    { readSourceHead: async () => HEAD === 'b'.repeat(40) ? undefined : HEAD },
    { readQueue: async () => Array.from({ length: 65 }, () => ({ adapter: 'sovereign-commander' })) },
    { writeProof: async () => ({ ok: false }) },
    { publishCapacity: async () => ({ ok: false }) },
  ];
  for (const change of cases) {
    const h = harness(change);
    const result = await refreshSovereignBuilder8Capacity(h.opts);
    assert.equal(result.ok, false);
    assert.equal(h.receipts.length <= 1, true);
    assert.equal(h.statuses.length, 1);
  }
});
test('Builder 8 detects source head changing after qualification', async () => {
  let calls = 0;
  const h = harness({ readSourceHead: async () => ++calls === 1 ? HEAD : 'c'.repeat(40) });
  const result = await refreshSovereignBuilder8Capacity(h.opts);
  assert.equal(result.reason, 'SOVEREIGN_BUILDER8_SOURCE_HEAD_MOVED');
  assert.equal(h.proofs.length, 0);
  assert.equal(h.receipts.length, 0);
});
test('Builder 8 does not confer protected merge, lease or shell authority', async () => {
  const h = harness();
  const result = await refreshSovereignBuilder8Capacity(h.opts);
  for (const value of [result, h.proofs[0]]) {
    assert.equal(value.mergeAuthority, false);
    assert.equal(value.leaseSeizureAllowed, false);
  }
  assert.equal(result.arbitraryCommandAllowed, false);
});

test('qualified Builder 8 receipt reaches the real elastic external admission path', async () => {
  const h = harness();
  assert.equal((await refreshSovereignBuilder8Capacity(h.opts)).ok, true);
  const publishCalls = [];
  const mission = {
    missionId: 'critical-3002-elastic-goal',
    title: 'Builder 8 first bounded proof goal',
    repository: 'Cheekyfellastef/stephan-os',
    operatorIntent: 'Repair an allowed source file using one local builder.',
    intendedOutcome: 'Bounded source repair with focused tests.',
    allowedFiles: ['shared/agents/goal-3002.mjs'],
    requiredTests: ['node --test shared/agents/goal-3002.test.mjs'],
    requiredEvidence: ['focused proof'],
    revision: 1, currentPhase: 'AGENT_IMPLEMENTATION',
    git: { branch: 'openclaw/elastic-goal-3002', worktreePath: '/bounded/critical-3002-elastic-goal' },
  };
  const result = await dispatchElasticGoalBuilds({
    desiredWidth: 1, selectedMission: null, activeMissions: [], runnableMissions: [mission],
  }, {
    now: NOW, sourceRevision: HEAD,
    paths: { repoRoot: '/repo', workspaceRoot: '/workspace', orchestratorRoot: '/orchestrator', snapshotRoot: '/snapshots' },
    capacityRouting: { sovereignCommanderLaneReceipt: h.receipts[0], codexStatus: null },
    publishWorkerAction: async ({ actionGrant }) => {
      publishCalls.push(actionGrant);
      return { published: true, actionGrantAccepted: true };
    },
  });
  assert.equal(result.dispatchCount, 1, JSON.stringify(result.held));
  assert.equal(publishCalls.length, 1);
  assert.equal(publishCalls[0].adapter, 'sovereign-commander');
  assert.equal(result.dispatched[0].workerId, SOVEREIGN_BUILDER8_WORKER_ID);
  assert.equal(result.dispatched[0].pickupProven, false);
  assert.equal(result.mergeAuthority, false);
});

test('an unexpected worker/model failure replaces any prior READY state with blocked status', async () => {
  for (const change of [
    { probeEnvironment: async () => { throw new Error('health-probe-crash'); } },
    { probeModel: async () => { throw new Error('ollama-crash'); } },
    { readQueue: async () => { throw new Error('queue-unreadable'); } },
    { writeProof: async () => { throw new Error('disk-error'); } },
  ]) {
    const h = harness(change);
    const result = await refreshSovereignBuilder8Capacity(h.opts);
    assert.equal(result.reason, 'SOVEREIGN_BUILDER8_CAPACITY_PROBE_EXCEPTION');
    assert.equal(h.statuses.length, 1);
    assert.equal(h.statuses[0].status, 'BLOCKED');
  }
});
