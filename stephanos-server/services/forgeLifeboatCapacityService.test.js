import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { resolve } from 'node:path';

import {
  FORGE_LIFEBOAT_WORKER_ID,
  FORGE_LIFEBOAT_LOCAL_TASK_CLASSES,
  forgeLifeboatAuthorityReceiptId,
  forgeLifeboatProofRef,
} from '../../shared/agents/missionControllerCapacityRouterV1.mjs';
import { refreshForgeLifeboatCapacity } from './forgeLifeboatCapacityService.js';

const HEAD = 'a'.repeat(40);
const NOW = new Date('2026-09-18T09:00:00.000Z');
const ORIGINAL_READ_FILE_SYNC = fs.readFileSync;
let governorObservation;
let governorReads;

function normalGovernor() {
  return { schemaVersion: 'stephanos.vr-resource-governor.v1', governorVersion: 3,
    updatedAtUtc: new Date().toISOString(), phase: 'NORMAL', active: false,
    flatGameActive: false, airLinkActive: false, realAirLinkActive: false,
    virtualAirLinkTestActive: false, prepareLeaseActive: false,
    nativeProbeCustodyHeld: false, dependencyObservationKnown: true,
    localModelAllowed: true, heavyModelAllowed: true, evictionHealthy: true };
}

// Isolate actual filesystem observation from the operator's resource state.
// No service option can replace this permission with a caller-provided grant.
beforeEach(t => {
  governorObservation = () => JSON.stringify(normalGovernor());
  governorReads = [];
  t.mock.method(fs, 'readFileSync', (path, ...args) => {
    if (String(path).endsWith('vr-resource-governor-current.json')) {
      governorReads.push(String(path));
      return governorObservation();
    }
    return ORIGINAL_READ_FILE_SYNC(path, ...args);
  });
  syncBuiltinESMExports();
});

afterEach(t => {
  t.mock.restoreAll();
  syncBuiltinESMExports();
});

function baseOptions(overrides = {}) {
  const publications = [];
  const proofs = [];
  return {
    options: {
      paths: { repoRoot: 'C:/repo', workspaceRoot: 'C:/workspace' },
      now: NOW,
      readSourceHead: async () => HEAD,
      probeLocalBuilder: async () => ({
        ok: true,
        latencyMs: 1250,
        requestSha256: '1'.repeat(64),
        responseSha256: '2'.repeat(64),
      }),
      readQueue: async () => [
        { adapter: 'foundry-forge' },
        { adapter: 'codex' },
        { adapter: 'foundry-forge' },
      ],
      writeProof: async (record) => {
        proofs.push(record);
        return { ok: true, reason: 'proof-written' };
      },
      publishCapacity: async (observation) => {
        publications.push(observation);
        return {
          finalVerdict: 'GITHUB_CONTINUITY_CAPACITY_PUBLISHED',
          publication: { ok: true },
          workerScopedPublication: { ok: true },
        };
      },
      ...overrides,
    },
    publications,
    proofs,
  };
}

function observeProbeTimeout(t) {
  const timeouts = [];
  t.mock.method(globalThis, 'setTimeout', (_callback, timeoutMs) => {
    timeouts.push(timeoutMs);
    return 123;
  });
  t.mock.method(globalThis, 'clearTimeout', () => {});
  return timeouts;
}

test('actual default Git and HTTP probe reduce their timeouts after slow source observation and never publish late capacity', async t => {
  let clock = 0, http = 0, queues = 0;
  const timeouts = observeProbeTimeout(t);
  const { options, publications, proofs } = baseOptions({
    remainingMs: () => 5000 - clock,
    probeTimeoutMs: 4000,
    readSourceHead: undefined,
    spawnSyncFn: (_command, _args, options) => {
      assert.equal(options.timeout, 5000);
      clock = 3990;
      return { status: 0, stdout: HEAD };
    },
    probeLocalBuilder: undefined,
    fetchImpl: async (_url, request) => {
      http++;
      assert.equal(request.method, 'POST');
      assert.equal(request.signal.aborted, false);
      clock += 2000;
      return { ok: true, text: async () => JSON.stringify({ done: true, response: 'LANE6_READY' }) };
    },
    readQueue: async () => { queues++; return []; },
  });
  const result = await refreshForgeLifeboatCapacity(options);
  assert.deepEqual(timeouts, [1010], 'the actual POST receives the remaining time after Git');
  assert.equal(http, 1);
  assert.equal(result.reason, 'FORGE_LIFEBOAT_CAPACITY_BUDGET_EXHAUSTED');
  assert.equal(result.available, false);
  assert.equal(queues, 0);
  assert.equal(proofs.length, 0);
  assert.equal(publications.length, 0);
});

test('source or actual POST-boundary deadline exhaustion prevents generation, proof and READY publication', async t => {
  const timeouts = observeProbeTimeout(t);
  for (const expireAt of ['source', 'post']) {
    let clock = 0, budgetReads = 0, http = 0;
    const { options, proofs, publications } = baseOptions({
      remainingMs: () => {
        budgetReads++;
        if (expireAt === 'post' && budgetReads >= 4) clock = 5000;
        return 5000 - clock;
      },
      readSourceHead: async () => { await Promise.resolve(); if (expireAt === 'source') clock = 5000; return HEAD; },
      probeLocalBuilder: undefined,
      fetchImpl: async () => { http++; assert.fail('expired producer started a POST'); },
    });
    const result = await refreshForgeLifeboatCapacity(options);
    assert.equal(result.reason, 'FORGE_LIFEBOAT_CAPACITY_BUDGET_EXHAUSTED', expireAt);
    assert.equal(http, 0);
    assert.equal(proofs.length, 0);
    assert.equal(publications.length, 0);
  }
  assert.deepEqual(timeouts, [], 'no timer or HTTP starts with zero remaining time');
});

test('expired asynchronous queue or proof completion cannot start capacity publication and retains written proof', async () => {
  for (const expireAt of ['queue', 'proof']) {
    let clock = 0;
    const actualProofWrite = { ok: true, reason: 'actual-fixture-proof-written' };
    const { options, proofs, publications } = baseOptions({
      remainingMs: () => 5000 - clock,
      readQueue: async () => { await Promise.resolve(); if (expireAt === 'queue') clock = 5000; return []; },
      writeProof: async record => { proofs.push(record); await Promise.resolve(); clock = 5000; return actualProofWrite; },
    });
    const result = await refreshForgeLifeboatCapacity(options);
    assert.equal(result.reason, 'FORGE_LIFEBOAT_CAPACITY_BUDGET_EXHAUSTED', expireAt);
    assert.equal(proofs.length, expireAt === 'proof' ? 1 : 0);
    assert.equal(publications.length, 0);
    if (expireAt === 'proof') {
      assert.equal(result.proofWrite, actualProofWrite);
      assert.equal(result.capacityPublished, false);
    }
  }
});

test('authentic complete or partial publication finishing after budget is retained without claiming current available capacity', async () => {
  for (const complete of [false, true]) {
    let clock = 0;
    const actualPublication = { finalVerdict: complete ? 'GITHUB_CONTINUITY_CAPACITY_PUBLISHED' : 'GITHUB_CONTINUITY_CAPACITY_PUBLICATION_SAFE_HOLD',
      publication: { ok: true }, workerScopedPublication: { ok: complete } };
    const { options, publications, proofs } = baseOptions({
      remainingMs: () => 5000 - clock,
      publishCapacity: async record => { publications.push(record); await Promise.resolve(); clock = 5000; return actualPublication; },
    });
    const result = await refreshForgeLifeboatCapacity(options);
    assert.equal(result.reason, 'FORGE_LIFEBOAT_CAPACITY_BUDGET_EXHAUSTED');
    assert.equal(result.available, false);
    assert.equal(result.capacityPublished, complete, 'deadline failure cannot erase completed publication results');
    assert.equal(result.publicationCompletedAfterBudget, true);
    assert.equal(result.publication, actualPublication);
    assert.equal(result.publication.publication.ok, true, 'a partial primary write is still actual state');
    assert.equal(publications.length, 1);
    assert.equal(proofs.length, 1);
  }
});

test('malformed, exhausted or increasing caller deadlines fail closed before new work', async () => {
  for (const remainingMs of [undefined, null, () => NaN, () => Infinity, () => -1, () => 0, () => '5000', () => { throw new Error('clock-unavailable'); }]) {
    const { options, publications, proofs } = baseOptions({ remainingMs,
      readSourceHead: () => assert.fail('invalid deadline reached source observation') });
    const result = await refreshForgeLifeboatCapacity(options);
    assert.equal(result.reason, 'FORGE_LIFEBOAT_CAPACITY_BUDGET_EXHAUSTED');
    assert.equal(publications.length, 0);
    assert.equal(proofs.length, 0);
  }
  let budget = 1000;
  const { options, proofs, publications } = baseOptions({ remainingMs: () => budget,
    readSourceHead: async () => { budget = 1001; return HEAD; },
    probeLocalBuilder: () => assert.fail('a reversed deadline reached generation') });
  const result = await refreshForgeLifeboatCapacity(options);
  assert.equal(result.reason, 'FORGE_LIFEBOAT_CAPACITY_BUDGET_EXHAUSTED');
  assert.equal(publications.length, 0);
  assert.equal(proofs.length, 0);
});

test('publishes one short-lived Lane 6 receipt from a real local-model probe and pending queue depth', async () => {
  const { options, publications, proofs } = baseOptions();
  const result = await refreshForgeLifeboatCapacity(options);

  assert.equal(result.ok, true);
  assert.equal(result.available, true);
  assert.equal(result.workerId, FORGE_LIFEBOAT_WORKER_ID);
  assert.equal(result.sourceHead, HEAD);
  assert.equal(result.queueDepth, 2);
  assert.equal(result.observedResponseLatencySeconds, 1.25);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.runtimeMutationAuthority, false);
  assert.equal(result.leaseSeizureAllowed, false);
  assert.equal(result.arbitraryCommandAllowed, false);

  assert.equal(proofs.length, 1);
  assert.equal(proofs[0].sourceHead, HEAD);
  assert.equal(proofs[0].sampleCount, 1);
  assert.equal(proofs[0].latencySemantics, 'single live generation response latency; conservative upper bound for start latency');

  assert.equal(publications.length, 1);
  assert.equal(publications[0].route, 'FOUNDRY_FORGE');
  assert.equal(publications[0].workerId, FORGE_LIFEBOAT_WORKER_ID);
  assert.deepEqual(publications[0].supportedTaskClasses, ['FOCUSED_REPAIR']);
  assert.equal(publications[0].supportedTaskClasses, FORGE_LIFEBOAT_LOCAL_TASK_CLASSES);
  assert.equal(publications[0].queueDepth, 2);
  assert.equal(publications[0].p95StartLatencySeconds, 1.25);
  assert.deepEqual(publications[0].authorityReceiptIds, [forgeLifeboatAuthorityReceiptId(HEAD)]);
  assert.deepEqual(publications[0].proofRefs, [forgeLifeboatProofRef(HEAD)]);
  assert.deepEqual(governorReads, Array(2).fill(resolve(options.paths.workspaceRoot, 'vr', 'vr-resource-governor-current.json')));
});

test('idle holds and missing or unknown authority block even a custom probe before HTTP', async () => {
  const normal = normalGovernor();
  const observations = [
    ...[
      { ...normal, nativeProbeCustodyHeld: true },
      { ...normal, dependencyObservationKnown: false },
      { ...normal, localModelAllowed: false },
      { ...normal, heavyModelAllowed: false },
      { ...normal, evictionHealthy: false },
      { ...normal, active: true },
      { ...normal, nativeProbeCustodyHeld: 'false' },
      { ...normal, updatedAtUtc: new Date(Date.now() - 20000).toISOString() },
      { ...normal, updatedAtUtc: new Date(Date.now() + 20000).toISOString() },
      null,
    ].map(state => () => JSON.stringify(state)),
    () => '{',
    () => { throw Object.assign(new Error('missing fixture'), { code: 'ENOENT' }); },
    () => { throw Object.assign(new Error('unreadable fixture'), { code: 'EACCES' }); },
  ];
  let probes = 0, http = 0;
  for (const observation of observations) {
    governorObservation = observation;
    for (const customProbe of [false, true]) {
      const { options, publications, proofs } = baseOptions({
        probeLocalBuilder: customProbe ? async () => { probes++; throw new Error('held probe must not run'); } : undefined,
        fetchImpl: async () => { http++; throw new Error('held HTTP must not run'); },
        // Existing callers may carry other context; it cannot grant permission.
        resourceAdmission: { ok: true },
      });
      const result = await refreshForgeLifeboatCapacity(options);
      assert.equal(result.available, false);
      assert.equal(result.reason, 'FORGE_LIFEBOAT_RESOURCE_GOVERNOR_HOLD');
      assert.equal(publications.length, 0);
      assert.equal(proofs.length, 0);
      assert.equal(probes, 0);
      assert.equal(http, 0);
    }
  }
});

test('a hold appearing after the actual generation probe prevents READY publication', async () => {
  let held = false, http = 0;
  governorObservation = () => JSON.stringify({ ...normalGovernor(), nativeProbeCustodyHeld: held });
  const { options, publications } = baseOptions({
    probeLocalBuilder: undefined,
    fetchImpl: async (url, request) => {
      http++;
      assert.equal(url, 'http://127.0.0.1:11434/api/generate');
      assert.equal(request.method, 'POST');
      assert.equal(JSON.parse(request.body).model, 'qwen3-coder:30b');
      held = true;
      return { ok: true, text: async () => JSON.stringify({ done: true, response: 'LANE6_READY' }) };
    },
  });
  const result = await refreshForgeLifeboatCapacity(options);
  assert.equal(http, 1);
  assert.equal(result.available, false);
  assert.equal(result.reason, 'FORGE_LIFEBOAT_RESOURCE_GOVERNOR_HOLD');
  assert.equal(result.governorReason, 'GOVERNOR_NATIVE_PROBE_CUSTODY_HELD');
  assert.equal(publications.length, 0);
  assert.equal(governorReads.length, 2);
});

test('permission is re-read after asynchronous proof writing at the READY boundary', async () => {
  let held = false;
  governorObservation = () => JSON.stringify({ ...normalGovernor(), dependencyObservationKnown: !held });
  const { options, publications } = baseOptions({
    writeProof: async () => { held = true; return { ok: true }; },
  });
  const result = await refreshForgeLifeboatCapacity(options);
  assert.equal(result.available, false);
  assert.equal(result.reason, 'FORGE_LIFEBOAT_RESOURCE_GOVERNOR_HOLD');
  assert.equal(publications.length, 0);
  assert.equal(governorReads.length, 2);
});

test('normalizes the existing STEP HANOS Ollama /api/chat endpoint shape to the fixed loopback base', async () => {
  const observedEndpoints = [];
  const { options, proofs } = baseOptions({
    env: { STEPHANOS_OLLAMA_ENDPOINT: 'http://127.0.0.1:11434/api/chat' },
    probeLocalBuilder: async ({ endpoint }) => {
      observedEndpoints.push(endpoint);
      return {
        ok: true,
        latencyMs: 900,
        requestSha256: '3'.repeat(64),
        responseSha256: '4'.repeat(64),
      };
    },
  });
  const result = await refreshForgeLifeboatCapacity(options);
  assert.equal(result.available, true);
  assert.deepEqual(observedEndpoints, ['http://127.0.0.1:11434']);
  assert.equal(proofs[0].endpoint, 'http://127.0.0.1:11434');
});

test('uses canonical git command for Lane 6 source-head proof and preserves an explicit override', async () => {
  const observedCommands = [];
  const spawn = (command) => {
    observedCommands.push(command);
    return { error: null, status: 0, stdout: `${HEAD}\n`, stderr: '' };
  };

  const defaultRun = baseOptions({ readSourceHead: undefined, spawnSyncFn: spawn });
  const defaultResult = await refreshForgeLifeboatCapacity(defaultRun.options);
  assert.equal(defaultResult.available, true);

  const overrideRun = baseOptions({ readSourceHead: undefined, spawnSyncFn: spawn, gitCommand: 'test-git-override' });
  const overrideResult = await refreshForgeLifeboatCapacity(overrideRun.options);
  assert.equal(overrideResult.available, true);

  assert.deepEqual(observedCommands, ['git', 'test-git-override']);
});

test('does not advertise Lane 6 when source head or local model proof is missing', async () => {
  const noHead = baseOptions({ readSourceHead: async () => '' });
  const headResult = await refreshForgeLifeboatCapacity(noHead.options);
  assert.equal(headResult.available, false);
  assert.equal(headResult.reason, 'FORGE_LIFEBOAT_SOURCE_HEAD_UNPROVEN');
  assert.equal(noHead.publications.length, 0);

  const noModel = baseOptions({
    probeLocalBuilder: async () => ({ ok: false, reason: 'FORGE_LIFEBOAT_MODEL_PROBE_TIMEOUT' }),
  });
  const modelResult = await refreshForgeLifeboatCapacity(noModel.options);
  assert.equal(modelResult.available, false);
  assert.equal(modelResult.reason, 'FORGE_LIFEBOAT_MODEL_PROBE_TIMEOUT');
  assert.equal(noModel.publications.length, 0);
});

test('proof publication must succeed before the lifeboat can advertise source capacity', async () => {
  const { options, publications } = baseOptions({
    writeProof: async () => ({ ok: false, reason: 'workspace-write-failed' }),
  });
  const result = await refreshForgeLifeboatCapacity(options);
  assert.equal(result.available, false);
  assert.match(result.reason, /^FORGE_LIFEBOAT_PROOF_PUBLICATION_FAILED:/);
  assert.equal(publications.length, 0);
});

test('caller class declarations cannot turn liveness publication into broader execution capacity', async () => {
  const { options, publications } = baseOptions({
    supportedTaskClasses: ['FOCUSED_REPAIR', 'MULTI_MODULE_IMPLEMENTATION'],
  });
  const result = await refreshForgeLifeboatCapacity(options);
  assert.equal(result.ok, true);
  assert.deepEqual(publications[0].supportedTaskClasses, ['FOCUSED_REPAIR'], 'caller advertisement cannot widen the implemented class');
  assert.equal(Object.hasOwn(result, 'dispatchAllowed'), false, 'capacity refresh does not mint native execution qualification');
});
