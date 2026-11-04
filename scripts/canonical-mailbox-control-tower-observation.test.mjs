import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync, existsSync, readdirSync,
  symlinkSync, renameSync, unlinkSync } from 'node:fs';
import { join, resolve, sep, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { createMailboxExecutionLedger } from './canonical-mailbox-execution-ledger-v1.mjs';
import { mailboxRotationDigest } from '../shared/agents/canonicalMailboxRotationV1.mjs';
import { createControlTowerRequestObservationV1 as create } from '../shared/agents/controlTowerRequestObservationV1.mjs';
import { projectSovereignControlSystemStatusV1 as statusProject } from '../shared/agents/sovereignControlSystemStatusV1.mjs';
import { fixture, HEAD, NOW } from '../shared/agents/fixtures/controlTowerBuildV1.mjs';
const nowMs = Date.parse(NOW), proof = 'b'.repeat(64);
function setup(t) {
  const parent = resolve(tmpdir()), root = mkdtempSync(join(parent, 'ct-ledger-observation-'));
  t.after(() => { assert(root.startsWith(parent + sep + 'ct-ledger-observation-')); rmSync(root, { recursive: true }); });
  return { root, ledger: createMailboxExecutionLedger(root) };
}
function material(id = 100, operation = 'BUILD_NEXT_ELIGIBLE_GOAL') {
  const command = { ...fixture().request, requestId: `control-tower-build-${id}-1`, runId: id, operation,
    artifactId: id + 200, artifactSha256: 'c'.repeat(64), issueNumber: 2315 };
  const initial = create(command, { commandDigest: mailboxRotationDigest(command), acceptedAtUtc: NOW, nowMs });
  return { command, initial, terminal: create(command, { commandDigest: initial.commandDigest, acceptedAtUtc: NOW,
    observedAtUtc: '2026-10-28T12:00:21.000Z', nowMs: nowMs + 1000, state: 'WAKE_COMPLETED', blocker: '', wakeProofHash: proof }) };
}
function pathOf(root, id) { const hash = mailboxRotationDigest(id); return join(root, 'execution-ledger-v1', hash.slice(0, 2), hash + '.json'); }
function reserve(ledger, value) { return ledger.reserve(value.command, { controlTowerObservation: value.initial }); }
function complete(ledger, value) { return ledger.complete({ requestId: value.command.requestId, issueNumber: 2315,
  state: 'DONE', proofHash: proof, controlTowerObservation: value.terminal }); }

test('same original wx record atomically retains initial identity and terminal detail within four KiB', t => {
  const { root, ledger } = setup(t), m = material(); reserve(ledger, m);
  const original = ledger.inspectControlTower(m.command.requestId, { nowMs });
  assert.equal(original.state, 'RESERVED'); assert.equal(original.observedAtUtc, NOW);
  assert.throws(() => reserve(createMailboxExecutionLedger(root), m), /ALREADY_SEEN/);
  complete(ledger, m);
  const reloaded = createMailboxExecutionLedger(root).inspectControlTower(m.command.requestId, { nowMs: nowMs + 86400000 });
  assert.equal(reloaded.state, 'WAKE_COMPLETED'); assert.equal(reloaded.ledgerPhase, 'TERMINAL');
  assert.equal(reloaded.observedAtUtc, m.terminal.observedAtUtc); assert.equal(reloaded.sourceHead, HEAD);
  assert(statSync(pathOf(root, m.command.requestId)).size <= 4096);
  const bytes = readFileSync(pathOf(root, m.command.requestId)); complete(ledger, m);
  assert.deepEqual(readFileSync(pathOf(root, m.command.requestId)), bytes);
  assert.equal(readdirSync(root).length, 1);
});

test('mismatched terminal identity, outcome and proof cannot rewrite or discharge a reservation', t => {
  const { root, ledger } = setup(t), m = material(); reserve(ledger, m);
  const before = readFileSync(pathOf(root, m.command.requestId));
  for (const changed of [{ sourceHead: 'd'.repeat(40) }, { commandDigest: 'd'.repeat(64) },
    { artifactId: 999 }, { acceptedAtUtc: '2026-10-28T12:00:19.000Z' },
    { wakeProofHash: 'd'.repeat(64) }, { operation: 'OBSERVE_CONTROL_SYSTEM' }]) {
    assert.throws(() => ledger.complete({ requestId: m.command.requestId, issueNumber: 2315, state: 'DONE',
      proofHash: proof, controlTowerObservation: { ...m.terminal, ...changed } }), /CONTROL_TOWER_TERMINAL_INVALID/);
    assert.deepEqual(readFileSync(pathOf(root, m.command.requestId)), before);
  }
  complete(ledger, m);
  assert.throws(() => ledger.complete({ requestId: m.command.requestId, issueNumber: 2315, state: 'BLOCKED',
    controlTowerObservation: { ...m.terminal, state: 'WAKE_BLOCKED', blocker: 'LIVE_MAINTENANCE_CUSTODY_UNPROVEN', wakeProofHash: '' } }), /TERMINAL_IMMUTABLE/);
  assert.equal(ledger.read(m.command.requestId).terminalState, 'DONE');
});

test('read-only discovery recovers a reservation with no status pointer and prefers it over a newer terminal build', t => {
  const { root, ledger } = setup(t), older = material(100), newer = material(102);
  reserve(ledger, older); reserve(ledger, newer); complete(ledger, newer);
  const before = readFileSync(pathOf(root, older.command.requestId));
  const discovered = createMailboxExecutionLedger(root).discoverControlTower({ nowMs: nowMs + 1000 });
  assert.equal(discovered.ok, true); assert.equal(discovered.latestBuildRequestObservation.requestId, older.command.requestId);
  assert.equal(discovered.latestBuildRequestObservation.state, 'RESERVED');
  assert.equal(existsSync(join(root, 'status')), false);
  assert.deepEqual(readFileSync(pathOf(root, older.command.requestId)), before);
});

test('legacy reserved and terminal entries stay ambiguous and cannot be retrofitted with new acceptance time', t => {
  const { ledger } = setup(t), m = material(99);
  ledger.reserve(m.command);
  const observed = ledger.discoverControlTower({ nowMs }).latestBuildRequestObservation;
  assert.equal(observed.detailState, 'LEGACY_DETAIL_UNAVAILABLE'); assert.equal(observed.state, 'RESERVED');
  assert.equal(observed.sourceHead, ''); assert.equal(observed.observedAtUtc, '');
  assert.throws(() => complete(ledger, m), /LEGACY_BINDING_UNPROVEN/);
  assert.equal(ledger.read(m.command.requestId).phase, 'RESERVED');
});

test('proven expired legacy reservation can retire only as terminal BLOCKED', t => {
  const { ledger } = setup(t), m = material(99);
  ledger.reserve(m.command);
  assert.throws(() => ledger.retireLegacyControlTowerReservation({
    request: m.command, nowMs: Date.parse(m.command.expiresAtUtc) - 1,
  }), /RETIREMENT_INVALID/);
  assert.throws(() => ledger.retireLegacyControlTowerReservation({
    request: { ...m.command, artifactSha256: 'd'.repeat(64) },
    nowMs: Date.parse(m.command.expiresAtUtc) + 1,
  }), /BINDING_UNPROVEN/);
  const retired = ledger.retireLegacyControlTowerReservation({
    request: m.command, nowMs: Date.parse(m.command.expiresAtUtc) + 1,
  });
  assert.equal(retired.phase, 'TERMINAL');
  assert.equal(retired.terminalState, 'BLOCKED');
  assert.equal(retired.controlTowerObservation, undefined);
  const observed = ledger.discoverControlTower({ nowMs: Date.parse(m.command.expiresAtUtc) + 1 })
    .latestBuildRequestObservation;
  assert.equal(observed.detailState, 'LEGACY_DETAIL_UNAVAILABLE');
  assert.equal(observed.ledgerPhase, 'TERMINAL');
  assert.equal(observed.terminalState, 'BLOCKED');
});

test('observation terminal hash binds only the closed status and never becomes terminal wake proof', t => {
  const { root, ledger } = setup(t), m = material(101, 'OBSERVE_CONTROL_SYSTEM'); reserve(ledger, m);
  const status = statusProject({ schemaVersion: 'stephanos.sovereign-control-system-inspection.v1',
    observationOnly: true, observationCompleted: true, observedAtUtc: NOW,
    source: { available: true, stable: true, sourceHead: HEAD, expectedMain: HEAD, reason: '' },
    nativeRuntime: { available: true, qualificationObserved: false,
      reason: 'FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING', observedAtUtc: NOW } });
  const terminal = create(m.command, { commandDigest: m.initial.commandDigest, acceptedAtUtc: NOW, nowMs,
    state: 'OBSERVATION_COMPLETED', blocker: '', controlSystemStatus: status,
    observationProofHash: createHash('sha256').update(JSON.stringify(status)).digest('hex') });
  assert(terminal);
  assert.throws(() => ledger.complete({ requestId: m.command.requestId, issueNumber: 2315, state: 'DONE',
    controlTowerObservation: { ...terminal, observationProofHash: 'f'.repeat(64) } }), /TERMINAL_INVALID/);
  ledger.complete({ requestId: m.command.requestId, issueNumber: 2315, state: 'DONE', controlTowerObservation: terminal });
  assert.equal(ledger.read(m.command.requestId).terminalProofHash, undefined);
  assert.equal(ledger.discoverControlTower({ nowMs }).latestControlSystemObservation.state, 'OBSERVATION_COMPLETED');
  const stored = ledger.read(m.command.requestId); stored.controlTowerObservation.observationProofHash = 'f'.repeat(64);
  writeFileSync(pathOf(root, m.command.requestId), JSON.stringify(stored));
  assert.equal(ledger.inspectControlTower(m.command.requestId, { nowMs }).detailState, 'INVALID');
  assert.equal(ledger.has(m.command.requestId), true);
});

test('bounded discovery refuses overflow and unsafe file or shard substitutions without returning an empty success', t => {
  const { root, ledger } = setup(t), a = material(100), b = material(101); reserve(ledger, a); reserve(ledger, b);
  assert.equal(ledger.discoverControlTower({ nowMs, maxEntries: 1 }).blocker, 'CONTROL_TOWER_LEDGER_DISCOVERY_BOUND_EXCEEDED');
  const path = pathOf(root, a.command.requestId), held = path + '.fixture'; renameSync(path, held); symlinkSync(held, path);
  assert.equal(ledger.discoverControlTower({ nowMs }).ok, false); unlinkSync(path); renameSync(held, path);
  const shard = dirname(path), moved = shard + '-fixture'; renameSync(shard, moved); symlinkSync(moved, shard, 'junction');
  assert.equal(ledger.discoverControlTower({ nowMs }).ok, false); unlinkSync(shard); renameSync(moved, shard);
  assert.equal(ledger.discoverControlTower({ nowMs }).ok, true);
});

test('hashed path identity and advisory corruption cannot hide original replay custody', t => {
  const { root, ledger } = setup(t), m = material(); reserve(ledger, m);
  const path = pathOf(root, m.command.requestId), stored = ledger.read(m.command.requestId);
  stored.controlTowerObservation.state = 'DONE'; writeFileSync(path, JSON.stringify(stored));
  assert.equal(ledger.has(m.command.requestId), true);
  const found = ledger.discoverControlTower({ nowMs });
  assert.equal(found.ok, true); assert.equal(found.latestBuildRequestObservation.state, 'RESERVED');
  assert.equal(found.latestBuildRequestObservation.detailState, 'INVALID');
  stored.requestId = 'control-tower-build-999-1'; writeFileSync(path, JSON.stringify(stored));
  assert.equal(ledger.discoverControlTower({ nowMs }).ok, false);
});

test('missing ledger inspection does not create a directory or invent an outcome', t => {
  const { root, ledger } = setup(t);
  assert.deepEqual(ledger.discoverControlTower({ nowMs }), { ok: true, blocker: '', latestBuildRequestObservation: null, latestControlSystemObservation: null });
  assert.deepEqual(readdirSync(root), []);
});

test('a corrupted authoritative phase cannot be laundered through an otherwise valid terminal annotation', t => {
  const { root, ledger } = setup(t), m = material();
  assert.throws(() => ledger.reserve(m.command, { controlTowerObservation: { ...m.initial, sourceHead: 'e'.repeat(40) } }), /OBSERVATION_INVALID/);
  assert.equal(ledger.has(m.command.requestId), false);
  reserve(ledger, m); const stored = ledger.read(m.command.requestId);
  stored.phase = 'RETIRED'; writeFileSync(pathOf(root, m.command.requestId), JSON.stringify(stored));
  assert.throws(() => complete(ledger, m), /TERMINAL_INVALID/);
  assert.equal(ledger.read(m.command.requestId).phase, 'RETIRED');
});
