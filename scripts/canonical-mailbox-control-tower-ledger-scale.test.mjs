import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { setImmediate as immediate } from 'node:timers/promises';
import { createMailboxExecutionLedger } from './canonical-mailbox-execution-ledger-v1.mjs';
import { mailboxRotationDigest } from '../shared/agents/canonicalMailboxRotationV1.mjs';
import { createControlTowerRequestObservationV1 } from '../shared/agents/controlTowerRequestObservationV1.mjs';
import { fixture, NOW } from '../shared/agents/fixtures/controlTowerBuildV1.mjs';

const nowMs = Date.parse(NOW);
function setup(t, count = 4108) {
  const parent = resolve(tmpdir()), root = mkdtempSync(join(parent, 'ct-ledger-scale-'));
  t.after(() => {
    assert(root.startsWith(parent + sep + 'ct-ledger-scale-'));
    rmSync(root, { recursive: true });
  });
  const ledgerRoot = join(root, 'execution-ledger-v1');
  const paths = [];
  for (let i = 0; i < count; i++) {
    const requestId = 'historical-mailbox-request-' + i;
    const hash = mailboxRotationDigest(requestId), directory = join(ledgerRoot, hash.slice(0, 2));
    mkdirSync(directory, { recursive: true });
    const path = join(directory, hash + '.json');
    writeFileSync(path, JSON.stringify({ schemaVersion: 'stephanos.mailbox-execution-ledger-entry.v1',
      requestId, issueNumber: 3258, phase: 'TERMINAL', commandDigest: '' }) + '\n');
    paths.push(path);
  }
  const ledger = createMailboxExecutionLedger(root);
  return { root, ledger, ledgerRoot, paths };
}
function reserve(ledger, runId, withObservation = true) {
  const request = { ...fixture().request, requestId: 'control-tower-build-' + runId + '-1',
    runId, issueNumber: 2315, artifactId: runId + 1000, artifactSha256: 'c'.repeat(64) };
  const observation = createControlTowerRequestObservationV1(request,
    { commandDigest: mailboxRotationDigest(request), acceptedAtUtc: NOW, nowMs });
  ledger.reserve(request, withObservation ? { controlTowerObservation: observation } : {});
  return request;
}
function snapshot(root) {
  const hash = createHash('sha256'); let count = 0;
  for (const shard of readdirSync(root).sort()) for (const name of readdirSync(join(root, shard)).sort()) {
    hash.update(shard + '/' + name + '\n'); hash.update(readFileSync(join(root, shard, name))); count++;
  }
  return { count, sha256: hash.digest('hex') };
}

test('history beyond 4096 retains every byte and discovers the original unresolved reservation', async t => {
  const { ledger, ledgerRoot } = setup(t);
  const request = reserve(ledger, 100);
  const before = snapshot(ledgerRoot);
  const result = await ledger.discoverControlTower({ nowMs });
  assert.equal(result.ok, true, result.blocker);
  assert.equal(result.latestBuildRequestObservation.requestId, request.requestId);
  assert.equal(result.latestBuildRequestObservation.state, 'RESERVED');
  assert.deepEqual(snapshot(ledgerRoot), before);
});

test('a completed observation cannot hide an unresolved build after large retained history', async t => {
  const { ledger } = setup(t);
  const request = reserve(ledger, 100);
  ledger.importHistorical('control-tower-build-101-1', 2315, 'TERMINAL');
  const result = await ledger.discoverControlTower({ nowMs });
  assert.equal(result.ok, true, result.blocker);
  assert.equal(result.latestBuildRequestObservation.requestId, request.requestId);
});

test('large-history corruption never becomes a partial successful discovery', async t => {
  const { ledger, paths } = setup(t);
  reserve(ledger, 100);
  writeFileSync(paths.at(-1), '{invalid');
  const result = await ledger.discoverControlTower({ nowMs });
  assert.equal(result.ok, false);
  assert.equal(result.latestBuildRequestObservation, null);
});

test('streaming discovery yields and rejects an in-place update to an already scanned record', async t => {
  const { ledger, ledgerRoot } = setup(t, 350);
  const firstShard = readdirSync(ledgerRoot).sort()[0];
  const firstPath = join(ledgerRoot, firstShard, readdirSync(join(ledgerRoot, firstShard))[0]);
  const pending = ledger.discoverControlTower({ nowMs, batchSize: 1 });
  await immediate();
  const record = JSON.parse(readFileSync(firstPath)); record.commandDigest = 'a'.repeat(64);
  writeFileSync(firstPath, JSON.stringify(record) + '\n');
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'CONTROL_TOWER_LEDGER_DISCOVERY_UNPROVEN');
});

test('concurrent reservation invalidates the full snapshot instead of authorizing another request', async t => {
  const { ledger } = setup(t, 350);
  const pending = ledger.discoverControlTower({ nowMs, batchSize: 1 });
  await immediate(); reserve(ledger, 100);
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.latestBuildRequestObservation, null);
});

test('deadline and explicit smaller work limits return held with no partial observations', async t => {
  const { ledger } = setup(t, 350); reserve(ledger, 100);
  for (const options of [{ maxEntries: 1 }, { maxDurationMs: 1, batchSize: 1 }]) {
    const result = await ledger.discoverControlTower({ nowMs, ...options });
    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'CONTROL_TOWER_LEDGER_DISCOVERY_BOUND_EXCEEDED');
    assert.equal(result.latestBuildRequestObservation, null);
  }
});

function runInShard(shard) {
  for (let runId = 10_000; runId < 100_000; runId++)
    if (mailboxRotationDigest('control-tower-build-' + runId + '-1').startsWith(shard)) return runId;
  throw new Error('FIXTURE_SHARD_REQUEST_NOT_FOUND');
}
async function mutateAfterClosingRead(t, ledger, target, mutate) {
  const original = fs.lstatSync; let reads = 0, mutationApplied = false;
  t.mock.method(fs, 'lstatSync', (path, options) => {
    const result = original(path, options);
    if (path === target && options?.bigint === true && ++reads === 3)
      setImmediate(() => { mutate(); mutationApplied = true; });
    return result;
  });
  syncBuiltinESMExports();
  try {
    const result = await ledger.discoverControlTower({ nowMs, batchSize: 1 });
    assert.equal(mutationApplied, false, 'a queued writer cannot run inside closing verification');
    assert.equal(result.ok, true, result.blocker);
    await immediate();
    assert.equal(mutationApplied, true, 'the actual write occurs only after this observation completed');
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
}

test('a queued new reservation cannot interleave with the uninterrupted closing observation', async t => {
  const { ledger, ledgerRoot } = setup(t, 350), shard = readdirSync(ledgerRoot).sort()[0];
  const target = join(ledgerRoot, shard, readdirSync(join(ledgerRoot, shard))[0]);
  await mutateAfterClosingRead(t, ledger, target, () => reserve(ledger, runInShard(shard)));
  const fresh = await ledger.discoverControlTower({ nowMs });
  assert.equal(fresh.ok, true);
  assert.equal(fresh.latestBuildRequestObservation.state, 'RESERVED');
});

test('a queued terminal rename occurs after closing and is observed by the next scan', async t => {
  const { ledger, ledgerRoot } = setup(t, 350), shard = readdirSync(ledgerRoot).sort()[0];
  const request = reserve(ledger, runInShard(shard)), hash = mailboxRotationDigest(request.requestId);
  const target = join(ledgerRoot, shard, hash + '.json');
  await mutateAfterClosingRead(t, ledger, target, () => {
    const terminal = createControlTowerRequestObservationV1(request, { commandDigest: mailboxRotationDigest(request),
      acceptedAtUtc: NOW, observedAtUtc: new Date(nowMs + 1000).toISOString(), nowMs: nowMs + 1000,
      state: 'WAKE_COMPLETED', blocker: '', wakeProofHash: 'b'.repeat(64) });
    ledger.complete({ requestId: request.requestId, issueNumber: 2315,
      state: 'DONE', proofHash: 'b'.repeat(64), controlTowerObservation: terminal });
  });
  assert.equal((await ledger.discoverControlTower({ nowMs })).latestBuildRequestObservation.state, 'WAKE_COMPLETED');
});

test('late queued in-place corruption cannot run in the closing proof and is rejected on the next observation', async t => {
  const { ledger, ledgerRoot } = setup(t, 350), shard = readdirSync(ledgerRoot).sort()[0];
  const target = join(ledgerRoot, shard, readdirSync(join(ledgerRoot, shard))[0]);
  await mutateAfterClosingRead(t, ledger, target, () => writeFileSync(target, '{invalid'));
  const result = await ledger.discoverControlTower({ nowMs });
  assert.equal(result.ok, false);
  assert.equal(result.latestBuildRequestObservation, null);
});

test('an admitted external-style insertion after an early closing read invalidates its directory identity', async t => {
  const { ledger, ledgerRoot } = setup(t, 350), shard = readdirSync(ledgerRoot).sort()[0];
  const target = join(ledgerRoot, shard, readdirSync(join(ledgerRoot, shard))[0]);
  const original = fs.lstatSync; let targetReads = 0, earlyVerified = false, mutated = false;
  t.mock.method(fs, 'lstatSync', (path, options) => {
    const result = original(path, options);
    if (options?.bigint === true) {
      if (path === target && ++targetReads === 3) earlyVerified = true;
      else if (earlyVerified && !mutated && typeof path === 'string' && path.endsWith('.json')
        && !path.startsWith(join(ledgerRoot, shard) + sep)) {
        mutated = true; reserve(ledger, runInShard(shard));
      }
    }
    return result;
  });
  syncBuiltinESMExports();
  try {
    const result = await ledger.discoverControlTower({ nowMs, batchSize: 1 });
    assert.equal(mutated, true);
    assert.equal(result.ok, false);
    assert.equal(result.latestBuildRequestObservation, null);
    assert.equal(result.latestControlSystemObservation, null);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
});

test('original ledger writers never open an existing canonical record for in-place mutation', async t => {
  const { ledger } = setup(t, 0), original = fs.openSync;
  t.mock.method(fs, 'openSync', (path, flags, ...args) => {
    if (typeof path === 'string' && /[a-f0-9]{64}\.json$/.test(path)) {
      const writing = typeof flags === 'number'
        ? Boolean(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_TRUNC | fs.constants.O_APPEND))
        : /[wa+]/.test(flags);
      if (writing) assert.equal(flags, 'wx', 'canonical insertion must be create-once; replacements use atomic rename');
    }
    return original(path, flags, ...args);
  });
  syncBuiltinESMExports();
  try {
    const request = reserve(ledger, 100);
    const terminal = createControlTowerRequestObservationV1(request, { commandDigest: mailboxRotationDigest(request),
      acceptedAtUtc: NOW, observedAtUtc: new Date(nowMs + 1000).toISOString(), nowMs: nowMs + 1000,
      state: 'WAKE_COMPLETED', blocker: '', wakeProofHash: 'b'.repeat(64) });
    const receipt = { requestId: request.requestId, issueNumber: 2315,
      state: 'DONE', proofHash: 'b'.repeat(64), controlTowerObservation: terminal };
    ledger.complete(receipt); ledger.complete(receipt);
    ledger.importHistorical('ordinary-history', 3258, 'TERMINAL');
    ledger.importHistorical('ordinary-history', 3258, 'RESERVED');
    const legacy = reserve(ledger, 200, false);
    ledger.retireLegacyControlTowerReservation({ request: legacy, nowMs: Date.parse(legacy.expiresAtUtc) + 1 });
    assert.equal((await ledger.discoverControlTower({ nowMs })).ok, true);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
});

test('the monotonic deadline is rechecked after a batch yields', async t => {
  const { ledger } = setup(t, 350); let settled = false;
  const pending = ledger.discoverControlTower({ nowMs, batchSize: 1, maxDurationMs: 250 });
  pending.then(() => { settled = true; });
  await immediate(); assert.equal(settled, false);
  const blockedUntil = performance.now() + 300;
  while (performance.now() < blockedUntil) { /* Simulate a delayed event-loop batch. */ }
  const result = await pending;
  assert.equal(result.blocker, 'CONTROL_TOWER_LEDGER_DISCOVERY_BOUND_EXCEEDED');
  assert.equal(result.latestBuildRequestObservation, null);
  assert.equal(result.latestControlSystemObservation, null);
});
