import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BATTLE_BRIDGE_PUBLISHER_LIVE_SLICE_MAX_AGE_MS,
  buildBattleBridgePublisherLiveSlice,
  collectBackendCanonicalLocalServiceFactsV1,
  refreshBackendPublisherCanonicalV1,
} from './battleBridgePublisherLifecycle.js';
import {
  DEFAULT_MISSION_WORKER_HEARTBEAT_MAX_AGE_MS,
  MISSION_WORKER_HEARTBEAT_SCHEMA,
  MISSION_WORKER_TASK_NAME,
} from '../../scripts/mission-orchestrator-worker-heartbeat.mjs';

const NOW = '2026-09-07T22:30:00.000Z';
const REPOSITORY_ROOT = '/repo/stephan-os';
const HEAD_SHA = 'ae72c8d00a5b3ae971bac1e1e527f19320b26987';

function freshSupervisor(overrides = {}) {
  return {
    generatedAt: '2026-09-07T22:29:30.000Z',
    trafficLight: 'green',
    services: {
      backend8787: { state: 'ready', ready: true },
      openClaw18789: { state: 'ready', ready: true },
      stephanosUi4173: { state: 'ready', ready: true },
    },
    ...overrides,
  };
}

function freshWorker(overrides = {}) {
  return {
    schemaVersion: MISSION_WORKER_HEARTBEAT_SCHEMA,
    timestampUtc: '2026-09-07T22:29:45.000Z',
    repositoryRoot: REPOSITORY_ROOT,
    branch: 'main',
    headSha: HEAD_SHA,
    taskName: MISSION_WORKER_TASK_NAME,
    pid: 4242,
    launchIdentityId: 'a'.repeat(64),
    workerStartedAtUtc: '2026-09-07T22:20:00.000Z',
    lastTickVerdict: 'MISSION_WORKER_TICK_PASS',
    arbitraryShellAllowed: false,
    sourceMutationAllowed: false,
    ...overrides,
  };
}

function liveSlice({ supervisor = freshSupervisor(), worker = freshWorker() } = {}) {
  return buildBattleBridgePublisherLiveSlice({
    supervisor,
    worker,
    timestampUtc: NOW,
    expectedRepositoryRoot: REPOSITORY_ROOT,
    expectedHeadSha: HEAD_SHA,
  });
}

test('periodic direct observation probes only three fixed local services', async () => {
  const seen = [];
  const facts = await collectBackendCanonicalLocalServiceFactsV1({ probe: async service => {
    seen.push([service.id, service.host, service.port]);
    return { ready: service.id !== 'stephanos-ui', evidence: {
      probe: 'http-json-health', host: service.host, port: service.port, path: service.path, detail: 'fixture' } };
  } });
  assert.deepEqual(seen, [['backend','127.0.0.1',8787],['stephanos-ui','127.0.0.1',4173],
    ['openclaw-gateway','127.0.0.1',18789]]);
  assert.equal(facts.observedFacts.services['stephanos-ui'].ready, false);
  assert.equal(Object.hasOwn(facts, 'sourceFacts'), false);
  assert.equal(facts.authority.servedHeadAttested, false);
});

test('canonical backend status refuses a TCP-only listener, HTML SPA fallback and HTTP 503', async () => {
  const seen = [];
  const facts = await collectBackendCanonicalLocalServiceFactsV1({ fetchFn: async (url, options) => {
    seen.push([url, options.method, options.redirect]);
    if (url.includes(':8787')) return new Response(JSON.stringify({ok:true}), {
      status:200, headers:{'content-type':'application/json'} });
    if (url.includes(':4173')) return new Response(JSON.stringify({ok:false}), {
      status:503, headers:{'content-type':'application/json'} });
    return new Response('<html>fallback</html>', {
      status:200, headers:{'content-type':'text/html'} });
  } });
  assert.deepEqual(seen, [
    ['http://127.0.0.1:8787/api/health','GET','manual'],
    ['http://127.0.0.1:4173/__stephanos/health','GET','manual'],
    ['http://127.0.0.1:18789/health','GET','manual'],
  ]);
  assert.equal(facts.observedFacts.services.backend.ready,true);
  assert.equal(facts.observedFacts.services['stephanos-ui'].ready,false);
  assert.equal(facts.observedFacts.services['openclaw-gateway'].ready,false);
  assert.equal(facts.authority.servedHeadAttested,false);
});
test('health HTTP 200 with error, stale runtime, redirect or oversized body cannot become READY', async () => {
  const invalid = [
    new Response(JSON.stringify({ok:false,status:'ready'}), {status:200,headers:{'content-type':'application/json'}}),
    new Response(JSON.stringify({ok:true,runtimeBuildCurrent:false}), {status:200,headers:{'content-type':'application/json'}}),
    new Response(JSON.stringify({ok:true,mode:'visibility-only'}), {status:200,headers:{'content-type':'application/json'}}),
    new Response('', {status:302,headers:{location:'http://evil.invalid/', 'content-type':'application/json'}}),
    new Response('x'.repeat(256 * 1024 + 1), {status:200,headers:{'content-type':'application/json'}}),
  ];
  for (const response of invalid) {
    const facts = await collectBackendCanonicalLocalServiceFactsV1({
      fetchFn:async () => response.clone(),
    });
    assert.equal(Object.values(facts.observedFacts.services).every(x=>x.ready===false),true);
  }
});
test('one healthy JSON response per fixed endpoint qualifies local service observation only', async () => {
  const facts = await collectBackendCanonicalLocalServiceFactsV1({fetchFn:async url =>
    new Response(JSON.stringify(url.includes('18789') ? {status:'live'} : {ok:true}), {
      status:200,headers:{'content-type':'application/json'}})});
  assert.equal(Object.values(facts.observedFacts.services).every(x=>x.ready),true);
  assert.equal(facts.authority.sourceMutationAllowed,false);
  assert.equal(facts.authority.servedHeadAttested,false);
});

test('existing backend tick calls canonical direct writer once with bounded facts', async () => {
  const seen = [];
  const facts = { observedFacts: { services: Object.fromEntries([
    ['backend',8787],['stephanos-ui',4173],['openclaw-gateway',18789]
  ].map(([id,port]) => [id,{ready:id !== 'stephanos-ui',
    evidence:{probe:'http-json-health',host:'127.0.0.1',port,path:id==='backend'?'/api/health':id==='stephanos-ui'?'/__stephanos/health':'/health'}}])) } };
  const result = await refreshBackendPublisherCanonicalV1({
    repoRoot: REPOSITORY_ROOT, workspaceRoot:'/fixture-existing-workspace', timestampUtc:NOW,
    observe: async () => { seen.push('observe'); return facts; },
    publisher: async value => {
      seen.push('publish'); assert.equal(value.sharedWorkspace, '/fixture-existing-workspace');
      assert.equal(value.mode, 'periodic-existing-backend-publisher');
      assert.equal(value.facts.observedFacts.services['stephanos-ui'].ready, false);
      return {ok:true,status:'DEGRADED'};
    },
  });
  assert.deepEqual(seen,['observe','publish']);
  assert.equal(result.status,'DEGRADED');
  assert.equal(result.sourceAuthority,false);
  assert.equal(result.workerPickupProven,false);
});
test('unknown local probe, forged source-clean record and failed canonical write refuse', async () => {
  const facts = { observedFacts: { services: Object.fromEntries([
    ['backend',8787],['stephanos-ui',4173],['openclaw-gateway',18789]
  ].map(([id,port]) => [id,{ready:true,
    evidence:{probe:'http-json-health',host:'127.0.0.1',port,path:id==='backend'?'/api/health':id==='stephanos-ui'?'/__stephanos/health':'/health'}}])) } };
  const input = {repoRoot:REPOSITORY_ROOT,workspaceRoot:'/fixture-existing-workspace',timestampUtc:NOW};
  await assert.rejects(refreshBackendPublisherCanonicalV1({
    ...input, observe: async () => ({observedFacts:{services:{}}}),
    publisher: async () => ({ok:true}),
  }),/BACKEND_CANONICAL_REFRESH_PROOF_UNPROVEN/);
  await assert.rejects(refreshBackendPublisherCanonicalV1({
    ...input, observe: async () => ({...facts,sourceFacts:{dirtyPaths:[]}}),
    publisher: async () => ({ok:true}),
  }),/BACKEND_CANONICAL_REFRESH_PROOF_UNPROVEN/);
  await assert.rejects(refreshBackendPublisherCanonicalV1({
    ...input, observe: async () => facts,
    publisher: async () => ({ok:false}),
  }),/BACKEND_CANONICAL_REFRESH_FAILED/);
});
test('fresh canonical supervisor and exact-head worker evidence produce a ready live publisher slice', () => {
  const slice = liveSlice();
  assert.equal(slice.status, 'READY');
  assert.equal(slice.finalVerdict, 'BATTLE_BRIDGE_PUBLISHER_READY');
  assert.deepEqual(slice.services.map((entry) => [entry.serviceId, entry.status]), [
    ['backend', 'READY'],
    ['battle-bridge-supervisor', 'READY'],
    ['mission-worker', 'READY'],
    ['openclaw-gateway', 'READY'],
  ]);
});

test('stale supervisor evidence is never repainted current by the minute publisher tick', () => {
  const staleAt = new Date(Date.parse(NOW) - BATTLE_BRIDGE_PUBLISHER_LIVE_SLICE_MAX_AGE_MS - 1).toISOString();
  const slice = liveSlice({ supervisor: freshSupervisor({ generatedAt: staleAt }) });
  assert.equal(slice.status, 'UNKNOWN');
  assert.equal(slice.services.find((entry) => entry.serviceId === 'backend').status, 'UNKNOWN');
  assert.equal(slice.services.find((entry) => entry.serviceId === 'battle-bridge-supervisor').status, 'UNKNOWN');
  assert.equal(slice.services.find((entry) => entry.serviceId === 'openclaw-gateway').status, 'UNKNOWN');
  assert.equal(slice.services.find((entry) => entry.serviceId === 'mission-worker').status, 'READY');
});

test('fresh negative supervisor state is degraded rather than falsely ready', () => {
  const slice = liveSlice({
    supervisor: freshSupervisor({
      trafficLight: 'amber',
      services: {
        backend8787: { state: 'blocked', ready: false },
        openClaw18789: { state: 'ready', ready: true },
      },
    }),
  });
  assert.equal(slice.status, 'UNKNOWN');
  assert.equal(slice.services.find((entry) => entry.serviceId === 'backend').status, 'DEGRADED');
  assert.equal(slice.services.find((entry) => entry.serviceId === 'battle-bridge-supervisor').status, 'DEGRADED');
});

test('worker heartbeat older than the canonical 120-second deadline is unknown even inside supervisor freshness', () => {
  const staleAt = new Date(Date.parse(NOW) - DEFAULT_MISSION_WORKER_HEARTBEAT_MAX_AGE_MS - 1).toISOString();
  const slice = liveSlice({
    worker: freshWorker({
      timestampUtc: staleAt,
      workerStartedAtUtc: new Date(Date.parse(staleAt) - 60_000).toISOString(),
    }),
  });
  assert.equal(slice.services.find((entry) => entry.serviceId === 'mission-worker').status, 'UNKNOWN');
  assert.equal(slice.status, 'UNKNOWN');
});

test('wrong-head or structurally invalid worker heartbeat can never publish ready', () => {
  const wrongHead = liveSlice({ worker: freshWorker({ headSha: 'b'.repeat(40) }) });
  assert.equal(wrongHead.services.find((entry) => entry.serviceId === 'mission-worker').status, 'UNKNOWN');
  assert.equal(wrongHead.status, 'UNKNOWN');

  const invalid = liveSlice({ worker: freshWorker({ schemaVersion: 'wrong.schema' }) });
  assert.equal(invalid.services.find((entry) => entry.serviceId === 'mission-worker').status, 'UNKNOWN');
  assert.equal(invalid.status, 'UNKNOWN');
});

test('recognized non-affirmative worker verdict stays live but degraded', () => {
  const slice = liveSlice({ worker: freshWorker({ lastTickVerdict: 'MISSION_WORKER_TICK_FAILED' }) });
  const worker = slice.services.find((entry) => entry.serviceId === 'mission-worker');
  assert.equal(worker.status, 'DEGRADED');
  assert.equal(worker.reachable, true);
  assert.equal(worker.usable, false);
  assert.equal(slice.status, 'UNKNOWN');
});