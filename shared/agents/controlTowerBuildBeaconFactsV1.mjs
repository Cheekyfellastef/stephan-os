import { projectControlTowerLatestRequestObservationV1,
  controlTowerObservationBlockerV1 } from './controlTowerRequestObservationV1.mjs';
import { CONTROL_TOWER_BUILD_OPERATION, CONTROL_TOWER_OBSERVE_OPERATION } from './controlTowerBuildRequestV1.mjs';

// Read-only projections of the EXISTING relay and original execution ledger.
// Current polls and retained request outcomes have distinct identities/times.
export const CONTROL_TOWER_BUILD_BEACON_FACTS_SCHEMA = 'stephanos.control-tower-build-beacon-facts.v1';
const RELAY_SCHEMA = 'stephanos.sovereign-relay-daemon.v1';
const CONSUMER_SCHEMA = 'stephanos.control-tower-build-consumer.v1';
const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const REQUEST = /^control-tower-build-([1-9][0-9]{0,15})-1$/;
const STATES = new Set(['WAITING', 'HELD', 'REPLAY_HELD', 'UNKNOWN', 'WAKE_BLOCKED', 'WAKE_COMPLETED',
  'OBSERVATION_COMPLETED', 'OBSERVATION_BLOCKED']);
const REQUIRE_REQUEST = new Set(['REPLAY_HELD', 'UNKNOWN', 'WAKE_BLOCKED', 'WAKE_COMPLETED',
  'OBSERVATION_COMPLETED', 'OBSERVATION_BLOCKED']);
const FLAGS = Object.freeze({ buildStartedProven: false, nativePickupProven: false,
  goalCompletionProven: false, sourceMutationAllowed: false, mergeAuthority: false, leaseSeizureAllowed: false });
const record = value => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const keys = Reflect.ownKeys(value), descriptors = Object.getOwnPropertyDescriptors(value);
  return keys.length <= 96 && keys.every(key => typeof key === 'string'
    && Object.hasOwn(descriptors[key], 'value'));
};
const matches = (pattern, value) => typeof value === 'string' && pattern.test(value);
const stale = (value, nowMs, maxAgeMs) => {
  if (typeof value !== 'string') return true;
  const at = Date.parse(value);
  return !Number.isFinite(at) || at > nowMs + 5000 || nowMs - at > maxAgeMs;
};
const unproven = blocker => Object.freeze({
  schemaVersion: CONTROL_TOWER_BUILD_BEACON_FACTS_SCHEMA,
  observed: false, state: 'UNPROVEN', blocker,
  runId: null, requestId: '', observedAtUtc: '', exactHeadMatch: false,
  wakeObserved: false, observationCompleted: false, ...FLAGS,
});

export function projectControlTowerBuildBeaconFactsV1(relay, {
  expectedHead, nowMs = Date.now(), maxAgeMs = 180000,
} = {}) {
  if (!matches(SHA, expectedHead) || !Number.isFinite(nowMs)
    || !Number.isSafeInteger(maxAgeMs) || maxAgeMs < 1000 || maxAgeMs > 300000)
    return unproven('CONTROL_TOWER_BUILD_PROJECTION_CONTEXT_INVALID');
  if (!record(relay)) return unproven('CONTROL_TOWER_RELAY_RECORD_MISSING');
  if (relay.schema !== RELAY_SCHEMA || relay.statusId !== 'sovereign-relay-current')
    return unproven('CONTROL_TOWER_RELAY_SCHEMA_INVALID');
  const evidence = relay.controlTowerBuild;
  if (!record(evidence)) return unproven('CONTROL_TOWER_BUILD_RECEIPT_MISSING');
  const projectLatest = value => projectControlTowerLatestRequestObservationV1(value, { expectedHead, nowMs });
  const build = projectLatest(evidence.latestBuildRequestObservation);
  const observe = projectLatest(evidence.latestControlSystemObservation);
  const latestBuildRequestObservation = build && [CONTROL_TOWER_BUILD_OPERATION, ''].includes(build.operation) ? build : null;
  const latestControlSystemObservation = observe?.operation === CONTROL_TOWER_OBSERVE_OPERATION ? observe : null;
  const latestRequestObservation = [latestBuildRequestObservation, latestControlSystemObservation].filter(Boolean)
    .sort((a, b) => (Date.parse(b.acceptedAtUtc) || 0) - (Date.parse(a.acceptedAtUtc) || 0) || b.runId - a.runId)[0] || null;
  const finish = currentPoll => Object.freeze({ ...currentPoll, currentPoll,
    latestRequestObservation, latestBuildRequestObservation, latestControlSystemObservation,
    controlSystemStatus: latestControlSystemObservation?.controlSystemStatus || null });
  // The carrier's freshness/head govern ONLY the current poll. Historical
  // ledger observations keep their original source/time even during a restart.
  if (relay.sourceHead !== expectedHead) return finish(unproven('CONTROL_TOWER_RELAY_SOURCE_MISMATCH'));
  if (stale(relay.heartbeatAtUtc, nowMs, maxAgeMs)) return finish(unproven('CONTROL_TOWER_RELAY_HEARTBEAT_STALE'));
  if (evidence.schemaVersion !== CONSUMER_SCHEMA || !STATES.has(evidence.state)
    || Object.keys(FLAGS).some(flag => evidence[flag] !== false))
    return finish(unproven('CONTROL_TOWER_BUILD_RECEIPT_INVALID'));
  if (evidence.operation != null && ![CONTROL_TOWER_BUILD_OPERATION, CONTROL_TOWER_OBSERVE_OPERATION].includes(evidence.operation))
    return finish(unproven('CONTROL_TOWER_BUILD_REQUEST_BINDING_INVALID'));
  if (stale(evidence.observedAtUtc, nowMs, maxAgeMs)) return finish(unproven('CONTROL_TOWER_BUILD_RECEIPT_STALE'));
  const requestId = evidence.requestId ?? '';
  const matched = typeof requestId === 'string' ? REQUEST.exec(requestId) : null;
  if ((REQUIRE_REQUEST.has(evidence.state) && !matched) || typeof requestId !== 'string' || (requestId && !matched))
    return finish(unproven('CONTROL_TOWER_BUILD_REQUEST_ID_INVALID'));
  const runId = matched ? Number(matched[1]) : null;
  if (matched && (!Number.isSafeInteger(runId) || runId !== evidence.runId || evidence.sourceHead !== expectedHead))
    return finish(unproven('CONTROL_TOWER_BUILD_REQUEST_BINDING_INVALID'));
  const blocker = evidence.blocker ?? '';
  if (typeof blocker !== 'string' || (blocker && controlTowerObservationBlockerV1(blocker) !== blocker))
    return finish(unproven('CONTROL_TOWER_BUILD_BLOCKER_INVALID'));
  const observation = evidence.state.startsWith('OBSERVATION_');
  if (observation && (evidence.operation !== CONTROL_TOWER_OBSERVE_OPERATION
    || latestControlSystemObservation?.requestId !== requestId
    || latestControlSystemObservation.state !== evidence.state
    || latestControlSystemObservation.observationProofHash !== evidence.observationProofHash
    || !matches(HASH, evidence.observationProofHash) || evidence.wakeProofHash))
    return finish(unproven('CONTROL_TOWER_OBSERVATION_PROOF_INVALID'));
  if (evidence.state.startsWith('WAKE_') && evidence.operation != null && evidence.operation !== CONTROL_TOWER_BUILD_OPERATION)
    return finish(unproven('CONTROL_TOWER_BUILD_REQUEST_BINDING_INVALID'));
  if (evidence.state === 'WAKE_COMPLETED' && (blocker || !matches(HASH, evidence.wakeProofHash)))
    return finish(unproven('CONTROL_TOWER_BUILD_WAKE_PROOF_INVALID'));
  return finish(Object.freeze({
    schemaVersion: CONTROL_TOWER_BUILD_BEACON_FACTS_SCHEMA,
    observed: true, state: evidence.state, blocker, runId, requestId,
    ...(evidence.operation ? { operation: evidence.operation } : {}),
    observedAtUtc: evidence.observedAtUtc, exactHeadMatch: true,
    wakeObserved: evidence.state === 'WAKE_COMPLETED', observationCompleted: evidence.state === 'OBSERVATION_COMPLETED',
    ...FLAGS,
  }));
}
