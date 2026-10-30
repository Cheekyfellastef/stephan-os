import test from 'node:test';
import assert from 'node:assert/strict';
import { projectControlTowerBuildBeaconFactsV1 as project } from './controlTowerBuildBeaconFactsV1.mjs';

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
