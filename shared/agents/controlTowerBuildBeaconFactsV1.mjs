// Read-only public projection of the EXISTING Sovereign relay's fixed Control
// Tower wake evidence. No GitHub event or WAKE_COMPLETED receipt is a source
// claim, OS pickup or finished goal.
export const CONTROL_TOWER_BUILD_BEACON_FACTS_SCHEMA = 'stephanos.control-tower-build-beacon-facts.v1';
const RELAY_SCHEMA = 'stephanos.sovereign-relay-daemon.v1';
const CONSUMER_SCHEMA = 'stephanos.control-tower-build-consumer.v1';
const SHA = /^[a-f0-9]{40}$/;
const REQUEST = /^control-tower-build-([1-9][0-9]{0,15})-1$/;
const BLOCKER = /^[A-Z0-9_:-]{1,160}$/;
const STATES = new Set(['WAITING', 'HELD', 'REPLAY_HELD', 'UNKNOWN', 'WAKE_BLOCKED', 'WAKE_COMPLETED']);
const REQUIRE_REQUEST = new Set(['REPLAY_HELD', 'UNKNOWN', 'WAKE_BLOCKED', 'WAKE_COMPLETED']);
const FORBIDDEN_TRUE = [
  'buildStartedProven', 'nativePickupProven', 'goalCompletionProven',
  'sourceMutationAllowed', 'mergeAuthority', 'leaseSeizureAllowed',
];
const stale = (value, nowMs, maxAgeMs) => {
  if (typeof value !== 'string') return true;
  const at = Date.parse(value);
  return !Number.isFinite(at) || at > nowMs + 5000 || nowMs - at > maxAgeMs;
};
const unproven = blocker => Object.freeze({
  schemaVersion: CONTROL_TOWER_BUILD_BEACON_FACTS_SCHEMA,
  observed: false, state: 'UNPROVEN', blocker,
  runId: null, requestId: '', observedAtUtc: '', exactHeadMatch: false,
  wakeObserved: false, buildStartedProven: false, nativePickupProven: false,
  goalCompletionProven: false, sourceMutationAllowed: false, mergeAuthority: false,
  leaseSeizureAllowed: false,
});

export function projectControlTowerBuildBeaconFactsV1(relay, {
  expectedHead, nowMs = Date.now(), maxAgeMs = 180000,
} = {}) {
  if (!SHA.test(expectedHead || '') || !Number.isFinite(nowMs)
    || !Number.isSafeInteger(maxAgeMs) || maxAgeMs < 1000 || maxAgeMs > 300000)
    return unproven('CONTROL_TOWER_BUILD_PROJECTION_CONTEXT_INVALID');
  if (!relay || typeof relay !== 'object' || Array.isArray(relay))
    return unproven('CONTROL_TOWER_RELAY_RECORD_MISSING');
  if (relay.schema !== RELAY_SCHEMA || relay.statusId !== 'sovereign-relay-current')
    return unproven('CONTROL_TOWER_RELAY_SCHEMA_INVALID');
  if (relay.sourceHead !== expectedHead)
    return unproven('CONTROL_TOWER_RELAY_SOURCE_MISMATCH');
  if (stale(relay.heartbeatAtUtc, nowMs, maxAgeMs))
    return unproven('CONTROL_TOWER_RELAY_HEARTBEAT_STALE');
  const evidence = relay.controlTowerBuild;
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence))
    return unproven('CONTROL_TOWER_BUILD_RECEIPT_MISSING');
  if (evidence.schemaVersion !== CONSUMER_SCHEMA || !STATES.has(evidence.state)
    || FORBIDDEN_TRUE.some(flag => evidence[flag] !== false))
    return unproven('CONTROL_TOWER_BUILD_RECEIPT_INVALID');
  if (stale(evidence.observedAtUtc, nowMs, maxAgeMs))
    return unproven('CONTROL_TOWER_BUILD_RECEIPT_STALE');
  const requestId = evidence.requestId || '';
  const matched = REQUEST.exec(requestId);
  const requireRequest = REQUIRE_REQUEST.has(evidence.state);
  if ((requireRequest && !matched) || (requestId && !matched))
    return unproven('CONTROL_TOWER_BUILD_REQUEST_ID_INVALID');
  const runId = matched ? Number(matched[1]) : null;
  if (matched && (!Number.isSafeInteger(runId) || runId !== evidence.runId
    || evidence.sourceHead !== expectedHead))
    return unproven('CONTROL_TOWER_BUILD_REQUEST_BINDING_INVALID');
  const blocker = evidence.blocker || '';
  if (typeof blocker !== 'string' || (blocker && !BLOCKER.test(blocker)))
    return unproven('CONTROL_TOWER_BUILD_BLOCKER_INVALID');
  if (evidence.state === 'WAKE_COMPLETED'
    && (blocker || !/^[a-f0-9]{64}$/.test(evidence.wakeProofHash || '')))
    return unproven('CONTROL_TOWER_BUILD_WAKE_PROOF_INVALID');
  return Object.freeze({
    schemaVersion: CONTROL_TOWER_BUILD_BEACON_FACTS_SCHEMA,
    observed: true, state: evidence.state, blocker,
    runId, requestId, observedAtUtc: evidence.observedAtUtc,
    exactHeadMatch: true, wakeObserved: evidence.state === 'WAKE_COMPLETED',
    // Never infer native worker pickup or a goal source commit from the wake.
    buildStartedProven: false, nativePickupProven: false, goalCompletionProven: false,
    sourceMutationAllowed: false, mergeAuthority: false, leaseSeizureAllowed: false,
  });
}
