import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateStephanosMemoryCrossDeviceLifecycleV1,
  STEPHANOS_MEMORY_CROSS_DEVICE_AUTHORITY,
  STEPHANOS_MEMORY_CROSS_DEVICE_INPUT_SCHEMA_V1,
} from './stephanosMemoryCrossDeviceLifecycleV1.mjs';

const d = (char) => `sha256:${char.repeat(64)}`;
const original = d('a');
const corrected = d('b');

function event(eventType, index, overrides = {}) {
  const defaults = {
    WRITE_CONFIRMED: { deviceId: 'device:a', surface: 'BATTLE_BRIDGE_DESKTOP', digest: original, priorDigest: undefined, newDigest: undefined, contentPresent: true, futureInfluenceAllowed: true },
    READ_CONFIRMED: { deviceId: 'device:b', surface: 'PHONE', digest: original, priorDigest: undefined, newDigest: undefined, contentPresent: true, futureInfluenceAllowed: true },
    CORRECT_CONFIRMED: { deviceId: 'device:b', surface: 'PHONE', digest: undefined, priorDigest: original, newDigest: corrected, contentPresent: true, futureInfluenceAllowed: true },
    READ_CORRECTED: { deviceId: 'device:a', surface: 'BATTLE_BRIDGE_DESKTOP', digest: corrected, priorDigest: undefined, newDigest: undefined, contentPresent: true, futureInfluenceAllowed: true },
    FORGET_CONFIRMED: { deviceId: 'device:a', surface: 'BATTLE_BRIDGE_DESKTOP', digest: undefined, priorDigest: corrected, newDigest: undefined, contentPresent: false, futureInfluenceAllowed: false },
    TOMBSTONE_OBSERVED: { deviceId: 'device:b', surface: 'PHONE', digest: undefined, priorDigest: corrected, newDigest: undefined, contentPresent: false, futureInfluenceAllowed: false },
  }[eventType];
  return {
    eventId: `event:${index}`,
    eventType,
    deviceId: defaults.deviceId,
    surface: defaults.surface,
    occurredAtUtc: `2026-08-17T16:0${index}:00Z`,
    authorityConfirmed: true,
    authorityClass: 'SHARED_AUTHORITY',
    recordId: 'memory:cross-device:1',
    digest: defaults.digest,
    priorDigest: defaults.priorDigest,
    newDigest: defaults.newDigest,
    contentPresent: defaults.contentPresent,
    futureInfluenceAllowed: defaults.futureInfluenceAllowed,
    evidenceRefs: [`proof:lifecycle:${index}`],
    ...overrides,
  };
}

function completeEvents() {
  return [
    event('WRITE_CONFIRMED', 1),
    event('READ_CONFIRMED', 2),
    event('CORRECT_CONFIRMED', 3),
    event('READ_CORRECTED', 4),
    event('FORGET_CONFIRMED', 5),
    event('TOMBSTONE_OBSERVED', 6),
  ];
}

function evaluate(events = completeEvents()) {
  return evaluateStephanosMemoryCrossDeviceLifecycleV1({
    schemaVersion: STEPHANOS_MEMORY_CROSS_DEVICE_INPUT_SCHEMA_V1,
    recordId: 'memory:cross-device:1',
    events,
  });
}

test('passes the complete two-device write read correct read forget tombstone cycle', () => {
  const result = evaluate();
  assert.equal(result.verdict, 'PASS');
  assert.equal(result.completeLifecycleObserved, true);
  assert.deepEqual(result.deviceIds, ['device:a', 'device:b']);
  assert.equal(result.originalDigest, original);
  assert.equal(result.correctedDigest, corrected);
  assert.equal(result.finalTombstoneObserved, true);
});

test('holds an incomplete lifecycle rather than fabricating acceptance', () => {
  assert.equal(evaluate(completeEvents().slice(0, 5)).verdict, 'HOLD_INCOMPLETE');
});

test('holds when any receipt lacks canonical authority', () => {
  const events = completeEvents();
  events[1] = { ...events[1], authorityConfirmed: false };
  assert.equal(evaluate(events).verdict, 'HOLD_AUTHORITY');
  events[1] = { ...events[1], authorityConfirmed: true, authorityClass: 'LOCAL_MIRROR' };
  assert.equal(evaluate(events).verdict, 'HOLD_AUTHORITY');
});

test('holds when any lifecycle event lacks proof references', () => {
  const events = completeEvents();
  events[3] = { ...events[3], evidenceRefs: [] };
  assert.equal(evaluate(events).verdict, 'HOLD_EVIDENCE');
});

test('requires strictly increasing lifecycle chronology', () => {
  const events = completeEvents();
  events[3] = { ...events[3], occurredAtUtc: events[2].occurredAtUtc };
  assert.equal(evaluate(events).verdict, 'FAIL_CHRONOLOGY');
});

test('requires two distinct devices with bidirectional propagation', () => {
  const events = completeEvents();
  events[1] = { ...events[1], deviceId: 'device:a' };
  assert.equal(evaluate(events).verdict, 'FAIL_DEVICE_TOPOLOGY');
});

test('correction must occur on B and corrected read must return to A', () => {
  const events = completeEvents();
  events[2] = { ...events[2], deviceId: 'device:a' };
  assert.equal(evaluate(events).verdict, 'FAIL_DEVICE_TOPOLOGY');
});

test('cross-device initial read must match the written digest', () => {
  const events = completeEvents();
  events[1] = { ...events[1], digest: d('c') };
  assert.equal(evaluate(events).verdict, 'FAIL_DIGEST_CHAIN');
});

test('corrected read must match the correction new digest', () => {
  const events = completeEvents();
  events[3] = { ...events[3], digest: d('c') };
  assert.equal(evaluate(events).verdict, 'FAIL_DIGEST_CHAIN');
});

test('forget must target corrected truth and retain no content or influence', () => {
  const wrongDigest = completeEvents();
  wrongDigest[4] = { ...wrongDigest[4], priorDigest: original };
  assert.equal(evaluate(wrongDigest).verdict, 'FAIL_DIGEST_CHAIN');
  const leaked = completeEvents();
  leaked[4] = { ...leaked[4], contentPresent: true };
  assert.equal(evaluate(leaked).verdict, 'FAIL_DIGEST_CHAIN');
});

test('final tombstone observation must contain no content and allow no influence', () => {
  const events = completeEvents();
  events[5] = { ...events[5], futureInfluenceAllowed: true };
  assert.equal(evaluate(events).verdict, 'FAIL_DIGEST_CHAIN');
});

test('requires exactly one event of each required lifecycle kind', () => {
  const events = [...completeEvents(), event('READ_CONFIRMED', 7, { eventId: 'event:extra' })];
  assert.equal(evaluate(events).verdict, 'HOLD_INCOMPLETE');
});

test('rejects duplicate event IDs and mismatched record identities', () => {
  const duplicate = completeEvents();
  duplicate[1] = { ...duplicate[1], eventId: duplicate[0].eventId };
  assert.throws(() => evaluate(duplicate), /DUPLICATE_EVENT/);
  const mismatch = completeEvents();
  mismatch[2] = { ...mismatch[2], recordId: 'memory:other' };
  assert.throws(() => evaluate(mismatch), /RECORD_ID_MISMATCH/);
});

test('rejects accessor-bearing and sparse hostile input', () => {
  const hostile = completeEvents();
  Object.defineProperty(hostile[0], 'deviceId', { enumerable: true, get() { throw new Error('must not execute'); } });
  assert.throws(() => evaluate(hostile), /ACCESSOR_REJECTED/);
  const sparse = [];
  sparse.length = 6;
  assert.throws(() => evaluate(sparse), /SPARSE_ARRAY_REJECTED/);
});

test('evaluation grants no write forget device or runtime authority', () => {
  for (const [key, value] of Object.entries(STEPHANOS_MEMORY_CROSS_DEVICE_AUTHORITY)) {
    assert.equal(value, false, `${key} must remain false`);
  }
  assert.equal(evaluate().authority.sharedWorkspaceMutationAllowed, false);
});
