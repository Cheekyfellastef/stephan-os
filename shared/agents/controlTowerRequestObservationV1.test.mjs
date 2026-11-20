import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createControlTowerRequestObservationV1 as create, projectControlTowerRequestObservationV1 as project,
  projectControlTowerLedgerObservationV1 as fromLedger, projectControlTowerLatestRequestObservationV1 as latest,
  controlTowerObservationBlockerV1 as blocker } from './controlTowerRequestObservationV1.mjs';
import { projectSovereignControlSystemStatusV1 } from './sovereignControlSystemStatusV1.mjs';
import { fixture, HEAD, NOW } from './fixtures/controlTowerBuildV1.mjs';
const nowMs = Date.parse(NOW), hash = 'c'.repeat(64);
const request = () => ({ ...fixture().request, artifactId: 200, artifactSha256: hash });
const initial = () => create(request(), { commandDigest: hash, acceptedAtUtc: NOW, nowMs });
const observation = () => projectSovereignControlSystemStatusV1({
  schemaVersion: 'stephanos.sovereign-control-system-inspection.v1', observationOnly: true,
  observationCompleted: true, observedAtUtc: NOW, blocker: 'FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING',
  source: { available: true, stable: true, sourceHead: HEAD, expectedMain: HEAD, reason: '' },
  nativeRuntime: { available: true, qualificationObserved: false,
    reason: 'FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING', observedAtUtc: NOW },
});

test('closed original identity and timestamps survive repeated public projections without new freshness', () => {
  const original = initial(); assert(original);
  const stored = fromLedger({ requestId: original.requestId, issueNumber: 2315, phase: 'RESERVED',
    commandDigest: hash, controlTowerObservation: original }, { nowMs });
  const seen = latest(stored, { expectedHead: HEAD, nowMs: nowMs + 86400000 });
  assert.equal(seen.observedAtUtc, NOW); assert.equal(seen.acceptedAtUtc, NOW);
  assert.equal(seen.ageMs, 86400000); assert.equal(seen.historical, true);
  assert.equal(seen.state, 'RESERVED'); assert.equal(seen.nativePickupProven, false);
  const moved = latest(seen, { expectedHead: 'd'.repeat(40), nowMs: nowMs + 86400001 });
  assert.equal(moved.exactHeadMatch, false); assert.equal(moved.sourceHead, HEAD);
  assert.equal(moved.evidenceState, 'HEAD_MISMATCH'); assert.equal(moved.observedAtUtc, NOW);
});

test('malformed identity, authority, types and accessor objects cannot mint a historical outcome', () => {
  const valid = initial();
  for (const changed of [{ sourceHead: [HEAD] }, { artifactSha256: [hash] }, { commandDigest: [hash] },
    { wakeProofHash: 0 }, { runId: '100' }, { runAttempt: 2 }, { nativePickupProven: true },
    { state: 'DONE' }, { observedAtUtc: '2026-10-28T12:01:00.000Z' }, { blocker: 'SECRET_UPPERCASE_DATA' },
    { expiresAtUtc: '2026-10-28T12:30:05.000Z' }, { acceptedAtUtc: '2026-10-28T12:10:05.000Z' }])
    assert.equal(project({ ...valid, ...changed }, { nowMs }), null);
  let invoked = false;
  const accessor = { ...valid }; Object.defineProperty(accessor, 'sourceHead', { get() { invoked = true; return HEAD; } });
  assert.equal(project(accessor, { nowMs }), null); assert.equal(invoked, false);
  assert.equal(project(Object.assign(Object.create({ x: 1 }), valid), { nowMs }), null);
});

test('observation proof remains distinct from wake proof and typed native denial is a completed observation', () => {
  const status = observation(); assert.equal(status.observationCompleted, true);
  const requestValue = { ...request(), operation: 'OBSERVE_CONTROL_SYSTEM' };
  const options = { commandDigest: hash, acceptedAtUtc: NOW, nowMs, state: 'OBSERVATION_COMPLETED',
    blocker: '', controlSystemStatus: status, observationProofHash: createHash('sha256').update(JSON.stringify(status)).digest('hex') };
  const receipt = create(requestValue, options); assert(receipt);
  assert.equal(receipt.wakeProofHash, ''); assert.equal(receipt.controlSystemStatus.nativeRuntime.qualificationObserved, false);
  assert.equal(create(requestValue, { ...options, wakeProofHash: hash }), null);
  assert.equal(create(request(), options), null);
  assert.equal(project({ ...receipt, controlSystemStatus: { ...status, source: { ...status.source, sourceHead: 'd'.repeat(40) } } }, { nowMs }), null);
});

test('legacy metadata keeps phase truth without inventing time head operation or success', () => {
  for (const phase of ['RESERVED', 'TERMINAL', 'RETIRED']) {
    const seen = fromLedger({ requestId: 'control-tower-build-99-1', issueNumber: 2315, phase,
      terminalState: phase === 'TERMINAL' ? 'DONE' : '' }, { nowMs });
    assert.equal(seen.detailState, 'LEGACY_DETAIL_UNAVAILABLE'); assert.equal(seen.sourceHead, '');
    assert.equal(seen.observedAtUtc, ''); assert.equal(seen.operation, '');
    assert.equal(seen.state, phase === 'RESERVED' ? 'RESERVED' : 'UNKNOWN');
    assert.equal(latest(seen, { nowMs, expectedHead: HEAD }).evidenceState, 'LEGACY_DETAIL_UNAVAILABLE');
  }
});

test('closed blockers and browser-safe model cannot leak arbitrary native output', () => {
  assert.equal(blocker('LIVE_MAINTENANCE_CUSTODY_UNPROVEN'), 'LIVE_MAINTENANCE_CUSTODY_UNPROVEN');
  assert.equal(blocker('RUNTIME_NORMAL_OPERATOR_REQUIRED'), 'RUNTIME_NORMAL_OPERATOR_REQUIRED');
  assert.equal(blocker('TOKEN_PRIVATE_UPPERCASE'), 'CONTROL_TOWER_BUILD_WAKE_UNPROVEN');
  assert.doesNotMatch(readFileSync(new URL('./controlTowerRequestObservationV1.mjs', import.meta.url), 'utf8'), /node:|Buffer\./);
  const clean = project({ ...initial(), token: 'SECRET', path: 'C:/Private' }, { nowMs });
  assert.doesNotMatch(JSON.stringify(clean), /SECRET|Private/);
});
