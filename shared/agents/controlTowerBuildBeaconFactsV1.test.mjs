import test from 'node:test';
import assert from 'node:assert/strict';
import { projectControlTowerBuildBeaconFactsV1 as project } from './controlTowerBuildBeaconFactsV1.mjs';
import { createControlTowerRequestObservationV1 as create, projectControlTowerLedgerObservationV1 as ledgerView } from './controlTowerRequestObservationV1.mjs';
import { fixture } from './fixtures/controlTowerBuildV1.mjs';

const HEAD = 'a'.repeat(40), NOW = Date.parse('2026-10-29T16:00:30.000Z');
const flags = { buildStartedProven: false, nativePickupProven: false,
  goalCompletionProven: false, sourceMutationAllowed: false, mergeAuthority: false,
  leaseSeizureAllowed: false };
const facts = (overrides = {}, relayOverrides = {}) => ({
  schema: 'stephanos.sovereign-relay-daemon.v1',
  statusId: 'sovereign-relay-current', sourceHead: HEAD,
  heartbeatAtUtc: '2026-10-29T16:00:29.000Z',
  controlTowerBuild: { schemaVersion: 'stephanos.control-tower-build-consumer.v1',
    state: 'WAKE_COMPLETED', blocker: '', observedAtUtc: '2026-10-29T16:00:25.000Z',
    requestId: 'control-tower-build-40906673530-1', runId: 40906673530,
    sourceHead: HEAD, wakeProofHash: 'b'.repeat(64), ...flags, ...overrides },
  ...relayOverrides,
});
const read = (record, extra = {}) => project(record, { expectedHead: HEAD, nowMs: NOW, ...extra });

test('fresh, exactly bound owner wake is observable but NEVER claims native build', () => {
  const result = read(facts());
  assert.equal(result.observed, true);
  assert.equal(result.wakeObserved, true);
  assert.equal(result.state, 'WAKE_COMPLETED');
  assert.equal(result.runId, 40906673530);
  for (const flag of Object.keys(flags)) assert.equal(result[flag], false);
  assert.equal(Object.isFrozen(result), true);
});

test('missing, stale, future and cross-head relay evidence fail closed', () => {
  assert.equal(read(null).blocker, 'CONTROL_TOWER_RELAY_RECORD_MISSING');
  assert.equal(read(facts({}, { sourceHead: 'b'.repeat(40) })).observed, false);
  assert.equal(read(facts({}, { heartbeatAtUtc: '2026-10-29T15:49:00Z' })).state, 'UNPROVEN');
  assert.equal(read(facts({ observedAtUtc: '2026-10-29T15:49:00Z' })).state, 'UNPROVEN');
  assert.equal(read(facts({ observedAtUtc: '2026-10-29T16:10:00Z' })).state, 'UNPROVEN');
  assert.equal(read(facts({ observedAtUtc: undefined })).state, 'UNPROVEN');
});

test('forged authority, wrong request binding and unauthenticated wire states never become pickup', () => {
  for (const changed of [
    { nativePickupProven: true }, { sourceMutationAllowed: true },
    { goalCompletionProven: true }, { mergeAuthority: true },
    { requestId: 'control-tower-build-40906673531-1' },
    { sourceHead: 'c'.repeat(40) }, { wakeProofHash: 'invalid' },
    { operation: { token: 'PRIVATE_OPERATION_PAYLOAD' } },
    { state: 'BUILDING' }, { schemaVersion: 'arbitrary' },
  ]) {
    const result = read(facts(changed));
    assert.equal(result.observed, false);
    assert.equal(result.nativePickupProven, false);
  }
});

test('read-only response excludes arbitrary private fields and path-like blockers', () => {
  const raw = facts({ token: 'MUST_NOT_ESCAPE', internalPath: 'C:/Private/Secret.txt' });
  const output = JSON.stringify(read(raw));
  assert.doesNotMatch(output, /MUST_NOT_ESCAPE|Private|token|wakeProofHash/i);
  const blocked = read(facts({ state: 'WAKE_BLOCKED', blocker: 'C:/Private/Secret', wakeProofHash: '' }));
  assert.equal(blocked.observed, false);
  assert.doesNotMatch(JSON.stringify(blocked), /Private|Secret/);
});

test('typed blocked and waiting observations distinguish request from missing native pickup', () => {
  const blocked = read(facts({ state: 'WAKE_BLOCKED', blocker: 'MAINTENANCE_CUSTODY_STATE_MISSING', wakeProofHash: '' }));
  assert.equal(blocked.state, 'WAKE_BLOCKED');
  assert.equal(blocked.wakeObserved, false);
  assert.equal(blocked.nativePickupProven, false);
  const waiting = read(facts({ state: 'WAITING', blocker: 'NO_CONTROL_TOWER_BUILD_REQUEST',
    requestId: '', runId: undefined, sourceHead: undefined, wakeProofHash: '' }));
  assert.equal(waiting.observed, true);
  assert.equal(waiting.requestId, '');
  assert.equal(waiting.nativePickupProven, false);
});

function retained(state = 'RESERVED') {
  const request = { ...fixture().request, artifactId: 200, artifactSha256: 'c'.repeat(64) };
  const original = '2026-10-28T12:00:20.000Z';
  const value = create(request, { commandDigest: 'd'.repeat(64), acceptedAtUtc: original,
    observedAtUtc: original, state, blocker: state === 'RESERVED' ? 'CONTROL_TOWER_REQUEST_RESERVED' : '',
    wakeProofHash: state === 'WAKE_COMPLETED' ? 'b'.repeat(64) : '', nowMs: NOW });
  return ledgerView({ requestId: value.requestId, issueNumber: 2315, commandDigest: value.commandDigest,
    phase: state === 'RESERVED' ? 'RESERVED' : 'TERMINAL', terminalState: state === 'RESERVED' ? '' : 'DONE',
    terminalProofHash: value.wakeProofHash, controlTowerObservation: value }, { nowMs: NOW });
}

test('empty fresh polling cannot erase or retimestamp an older terminal request', () => {
  const historical = retained('WAKE_COMPLETED');
  const result = read(facts({ state: 'WAITING', blocker: 'NO_CONTROL_TOWER_BUILD_REQUEST',
    requestId: '', runId: undefined, sourceHead: undefined, wakeProofHash: '',
    latestBuildRequestObservation: historical, latestRequestObservation: { ...historical, runId: 999 } }));
  assert.equal(result.state, 'WAITING'); assert.equal(result.currentPoll.state, 'WAITING');
  assert.equal(result.wakeObserved, false);
  assert.equal(result.latestRequestObservation.requestId, historical.requestId);
  assert.equal(result.latestRequestObservation.observedAtUtc, historical.observedAtUtc);
  assert.equal(result.latestRequestObservation.historical, true);
  assert.equal(result.latestRequestObservation.nativePickupProven, false);
  assert(result.latestRequestObservation.ageMs > 180000);
});

test('stale carrier and changed current source retain original historical request evidence without current authority', () => {
  for (const state of ['RESERVED', 'WAKE_COMPLETED']) {
    const historical = retained(state);
    const record = facts({ latestBuildRequestObservation: historical }, { heartbeatAtUtc: '2026-10-28T12:00:20.000Z' });
    const stale = read(record); assert.equal(stale.observed, false);
    assert.equal(stale.blocker, 'CONTROL_TOWER_RELAY_HEARTBEAT_STALE');
    assert.equal(stale.latestBuildRequestObservation.state, state);
    assert.equal(stale.latestBuildRequestObservation.observedAtUtc, historical.observedAtUtc);
    const changed = project(record, { expectedHead: 'e'.repeat(40), nowMs: NOW });
    assert.equal(changed.blocker, 'CONTROL_TOWER_RELAY_SOURCE_MISMATCH');
    assert.equal(changed.latestBuildRequestObservation.exactHeadMatch, false);
    assert.equal(changed.latestBuildRequestObservation.sourceHead, HEAD);
    assert.equal(changed.wakeObserved, false); assert.equal(changed.nativePickupProven, false);
  }
});

test('arbitrary uppercase child data cannot escape through historical or current blockers', () => {
  const historical = { ...retained(), blocker: 'PRIVATE_UPPERCASE_CONTENT' };
  const result = read(facts({ state: 'WAKE_BLOCKED', blocker: 'PRIVATE_UPPERCASE_CONTENT',
    latestBuildRequestObservation: historical, wakeProofHash: '' }));
  assert.equal(result.observed, false); assert.equal(result.latestBuildRequestObservation, null);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_UPPERCASE_CONTENT/);
});
