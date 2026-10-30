import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import os from 'node:os';
const repo = fileURLToPath(new URL('../', import.meta.url));
const moduleAt = name => import(pathToFileURL(path.join(repo, name)).href);
const { createBattleBridgeSharedWorkspaceRecords } = await moduleAt('scripts/battle-bridge-shared-workspace-publisher.mjs');
const { buildBattleBridgePublisherLiveSlice } = await moduleAt('stephanos-server/services/battleBridgePublisherLifecycle.js');
const { createBattleBridgePublisherWorkspaceRecords, projectBattleBridgePublicationEvidence } = await moduleAt('shared/agents/battleBridgePublisher.mjs');
const { collectLauncherReadinessLiveFacts } = await moduleAt('scripts/launcher-readiness-live-facts.mjs');
const { planLauncherReadiness } = await moduleAt('scripts/launcher-readiness-planner.mjs');
const { evaluateUi4173Repair } = await moduleAt('scripts/battle-bridge-ui-4173-repair.mjs');
const NOW = '2026-10-30T13:00:00.000Z';
const HEAD = '9c650175d569ab30f22a5f2f8970695372316dc5';
const fixtures = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-publication-proof-'));
test.after(() => {
  assert.equal(path.dirname(path.resolve(fixtures)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(fixtures).startsWith('launcher-publication-proof-'));
  fs.rmSync(fixtures, { recursive: true });
});
function workspace(name) { const root = path.join(fixtures, name); fs.mkdirSync(root); return root; }
function put(root, channel, value, stamp = NOW) {
  fs.mkdirSync(path.join(root, channel), { recursive: true });
  const target = path.join(root, channel, 'battle-bridge-current.json');
  fs.writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value));
  fs.utimesSync(target, new Date(stamp), new Date(stamp));
}
const freshWorker = { schemaVersion: 'stephanos.mission-orchestrator-worker-heartbeat.v1', timestampUtc: NOW,
  repositoryRoot: repo, branch: 'main', headSha: HEAD, taskName: 'Stephanos Mission Orchestrator Worker', pid: 4242,
  launchIdentityId: 'a'.repeat(64), workerStartedAtUtc: '2026-10-30T12:59:00.000Z', lastTickVerdict: 'MISSION_WORKER_TICK_PASS', arbitraryShellAllowed: false, sourceMutationAllowed: false };
const facts = { observedFacts: { services: { backend: { ready: true }, 'openclaw-gateway': { ready: true }, 'stephanos-ui': { ready: false } } } };
async function project(root) {
  const live = await collectLauncherReadinessLiveFacts({ repoRoot: repo, sharedWorkspace: root, now: Date.parse(NOW),
    execFile: () => '', serviceProbe: async service => ({ ready: service.id !== 'stephanos-ui', evidence: { probe: 'CONTROLLED_TEST_FIXTURE' } }) });
  const readinessReport = planLauncherReadiness(live);
  return { live, readinessReport, repair: evaluateUi4173Repair({ readinessReport, dryRun: true }) };
}
function directPublish(root) {
  const records = createBattleBridgeSharedWorkspaceRecords({ facts, timestampUtc: NOW });
  for (const key of ['status', 'proof', 'event']) put(root, key === 'event' ? 'events' : key, records[key]);
}
test('fresh truthful cold-start evidence survives a backend publisher overwrite without requiring UI already green', async () => {
  const root = workspace('publisher-interleaving');
  directPublish(root);
  assert.equal((await project(root)).repair.allowedToStart, true, 'baseline direct publisher permits missing UI repair');
  const slice = buildBattleBridgePublisherLiveSlice({ timestampUtc: NOW, expectedRepositoryRoot: repo, expectedHeadSha: HEAD, worker: freshWorker,
    supervisor: { generatedAt: NOW, trafficLight: 'red', services: { backend8787: { state: 'ready', ready: true }, openClaw18789: { state: 'ready', ready: true }, stephanosUi4173: { state: 'blocked', ready: false } } } });
  assert.notEqual(slice.status, 'READY', 'an absent UI must not be painted healthy');
  const records = createBattleBridgePublisherWorkspaceRecords(slice);
  put(root, 'status', records.statusRecord); put(root, 'proof', records.proofRecord); put(root, 'events', records.eventRecord);
  const observed = await project(root);
  assert.equal(observed.readinessReport.observedServices['stephanos-ui'].ready, false);
  assert.equal(observed.repair.allowedToStart, true, JSON.stringify({ publisherStatus: slice.status, blockers: observed.repair.blockers }));
});
test('fresh malformed publication does not authorize a UI start', async () => {
  const root = workspace('malformed'); put(root, 'status', '{broken JSON');
  assert.equal((await project(root)).repair.allowedToStart, false, 'parse failure must fail closed independently of service health');
});
test('fresh empty publication does not authorize a UI start', async () => {
  const root = workspace('empty-object'); put(root, 'status', {});
  assert.equal((await project(root)).repair.allowedToStart, false, 'missing canonical schema and identity must fail closed');
});
test('genuinely stale publication continues to deny UI repair', async () => {
  const root = workspace('stale'); directPublish(root);
  for (const channel of ['status', 'proof', 'events']) fs.utimesSync(path.join(root, channel, 'battle-bridge-current.json'), new Date('2026-10-30T12:00:00Z'), new Date('2026-10-30T12:00:00Z'));
  assert.equal((await project(root)).repair.allowedToStart, false);
});
for (const [name, mutate] of [
  ['foreign-status-identity', record => ({ ...record, statusId: 'unrelated-service-current' })],
  ['foreign-record-kind', record => ({ ...record, kind: 'stephanos.shared_workspace.goal' })],
  ['future-content-time', record => ({ ...record, timestampUtc: '2026-10-31T13:00:00.000Z' })],
  ['touched-old-content', record => ({ ...record, timestampUtc: '2026-10-29T13:00:00.000Z' })],
]) test(`${name} cannot gain startup permission from fresh filesystem time`, async () => {
  const root = workspace(name); directPublish(root);
  const target = path.join(root, 'status', 'battle-bridge-current.json');
  put(root, 'status', mutate(JSON.parse(fs.readFileSync(target, 'utf8'))));
  assert.equal((await project(root)).repair.allowedToStart, false, `${name} must not authorize startup`);
});

test('every interrupted interleaving preserves publication without upgrading runtime truth', async () => {
  const direct = createBattleBridgeSharedWorkspaceRecords({ facts, timestampUtc: NOW });
  const unknown = createBattleBridgePublisherWorkspaceRecords(buildBattleBridgePublisherLiveSlice({
    timestampUtc: NOW, expectedRepositoryRoot: repo, expectedHeadSha: HEAD, worker: freshWorker,
    supervisor: { generatedAt: NOW, trafficLight: 'red', services: { backend8787: { ready: true }, openClaw18789: { ready: true } } },
  }));
  const producers = [
    { status: direct.status, proof: direct.proof, events: direct.event },
    { status: unknown.statusRecord, proof: unknown.proofRecord, events: unknown.eventRecord },
  ];
  const before = JSON.stringify(producers);
  for (let mask = 0; mask < 8; mask++) {
    const root = workspace('interleaving-' + mask);
    for (const [index, channel] of ['status', 'proof', 'events'].entries()) put(root, channel, producers[(mask >> index) & 1][channel]);
    const result = await project(root);
    assert.equal(result.repair.allowedToStart, true);
    assert.equal(result.readinessReport.observedServices['stephanos-ui'].ready, false);
    assert.notEqual(result.readinessReport.finalVerdict, 'ready');
    for (const channel of ['status', 'proof']) {
      const record = JSON.parse(fs.readFileSync(path.join(root, channel, 'battle-bridge-current.json')));
      assert.ok(['UNKNOWN', 'DEGRADED'].includes(record.status));
    }
  }
  assert.equal(JSON.stringify(producers), before, 'observation must not rewrite either producer or its runtime verdict');
});

for (const [name, mutate] of [
  ['empty-proof-references', row => ({ ...row, proofRefs: [] })],
  ['absent-status', row => { const { status, ...rest } = row; return rest; }],
  ['mistyped-status', row => ({ ...row, status: true })],
  ['unrecognized-status', row => ({ ...row, status: 'INVENTED' })],
  ['ambiguous-record-identity', row => ({ ...row, recordId: 'another-current' })],
  ['missing-timestamp', row => { const { timestampUtc, ...rest } = row; return rest; }],
  ['wrong-schema', row => ({ ...row, schemaVersion: 'foreign.v1' })],
]) test(`${name} fails closed even with other fresh valid publications`, async () => {
  const root = workspace(name); directPublish(root);
  const record = JSON.parse(fs.readFileSync(path.join(root, 'status', 'battle-bridge-current.json')));
  put(root, 'status', mutate(record));
  assert.equal((await project(root)).repair.allowedToStart, false);
});

test('filesystem future time cannot borrow validity from fresh content', async () => {
  const root = workspace('future-file-time'); directPublish(root);
  const file = path.join(root, 'status', 'battle-bridge-current.json');
  fs.utimesSync(file, new Date('2026-10-31T13:00:00Z'), new Date('2026-10-31T13:00:00Z'));
  assert.equal((await project(root)).repair.allowedToStart, false);
});

test('oversized and multiply-linked files cannot supply publication evidence', async () => {
  for (const mode of ['oversized', 'hardlink']) {
    const root = workspace(mode); directPublish(root);
    const file = path.join(root, 'status', 'battle-bridge-current.json');
    if (mode === 'oversized') put(root, 'status', ' '.repeat(1_048_577));
    else fs.linkSync(file, path.join(root, 'alias.json'));
    assert.equal((await project(root)).repair.allowedToStart, false);
  }
});

test('an event alone is not a current status/proof observation', async () => {
  const root = workspace('event-only');
  put(root, 'events', createBattleBridgeSharedWorkspaceRecords({ facts, timestampUtc: NOW }).event);
  assert.equal((await project(root)).repair.allowedToStart, false);
});

test('legacy current-directory UNKNOWN cannot borrow the fixed canonical path exception', async () => {
  const root = workspace('legacy-unknown'), dir = path.join(root, 'current');
  fs.mkdirSync(dir);
  const record = createBattleBridgePublisherWorkspaceRecords({ status: 'UNKNOWN', timestampUtc: NOW }).statusRecord;
  const target = path.join(dir, 'battle-bridge-current.json');
  fs.writeFileSync(target, JSON.stringify(record));
  fs.utimesSync(target, new Date(NOW), new Date(NOW));
  assert.equal((await project(root)).repair.allowedToStart, false);
});

test('the publication projection exposes no positive runtime-health or activation verdict', () => {
  const ready = createBattleBridgePublisherWorkspaceRecords({ status: 'READY', timestampUtc: NOW }).statusRecord;
  for (const timestampUtc of [NOW, '2026-10-29T13:00:00Z', '2026-10-31T13:00:00Z']) {
    const projected = projectBattleBridgePublicationEvidence({ ...ready, timestampUtc }, { nowMs: Date.parse(NOW) });
    assert.equal(projected.runtimeStatus, 'READY', 'retain only the publisher\'s original declared value');
    assert.equal(Object.hasOwn(projected, 'runtimeReady'), false);
    assert.equal(projected.runtimeActivationGranted, false);
    assert.equal(projected.fresh, timestampUtc === NOW);
  }
});

for (const [index, refs] of [[], [' '], [null], [false], [0], [{}], [['proof/x.json']],
  ['proof/battle-bridge-current.json', ' '], [' proof/x.json'], ['proof/x.json ']].entries()) {
  test(`malformed proof-reference elements fail closed in a status-only publication (${index})`, async () => {
    const root = workspace('status-only-bad-refs-' + index);
    const record = createBattleBridgePublisherWorkspaceRecords({ status: 'UNKNOWN', timestampUtc: NOW }).statusRecord;
    put(root, 'status', { ...record, proofRefs: refs });
    assert.equal((await project(root)).repair.allowedToStart, false);
  });
}
