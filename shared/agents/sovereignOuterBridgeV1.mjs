// #2961: a wider observation/reconciliation bridge around a broken wake path.
// It NEVER replaces the one canonical programme/lease/worker authority.
export const SOVEREIGN_OUTER_BRIDGE_SCHEMA = 'stephanos.sovereign-outer-bridge.v1';
export const SOVEREIGN_OUTER_BRIDGE_POLL_MS = 60_000;
const SHA = /^[a-f0-9]{40}$/;
const safe = (s, fallback = 'UNVERIFIED') => /^[A-Z][A-Z0-9_]{0,119}$/.test(String(s || ''))
  ? s : fallback;
const guardrails = Object.freeze({
  sourceMutationAllowed: false,
  leaseSeizureAllowed: false,
  independentDispatchAllowed: false,
  duplicateSchedulerAllowed: false,
  independentReviewApprovalAllowed: false,
  mergeAuthority: false,
  arbitraryShellAllowed: false,
  authenticatedExistingTransportOnly: true,
  oneCanonicalLeaseAuthority: true,
});

// Gate proof is NOT inferred from a process heartbeat, an RPC 200 or a green UI.
export function projectSovereignOuterBridgeV1({
  observedAtUtc, sourceHead, sourceIdentityVerified = false,
  rescue = null, workerPickupReceiptProven = false,
  unattendedRefillReceiptCount = 0,
} = {}) {
  const time = Date.parse(observedAtUtc || '');
  const identity = sourceIdentityVerified === true && SHA.test(String(sourceHead || ''));
  const released = identity && rescue?.canonicalLeaseReleaseProven === true
    && rescue?.publicationOk === true
    && rescue?.schemaVersion === 'stephanos.temporary-sovereign-lease-rescue.v1';
  // This physical pickup input can only be set by a separately verified,
  // original-worker exact-head receipt. Current Core adapter always passes false.
  const pickup = released && workerPickupReceiptProven === true;
  const refill = pickup && Number.isSafeInteger(unattendedRefillReceiptCount)
    && unattendedRefillReceiptCount >= 2;
  const stage = !identity ? 'OUTER_BRIDGE_SOURCE_HELD'
    : !released ? 'OUTER_BRIDGE_WIDE'
      : !pickup ? 'OUTER_BRIDGE_NARROWING_LEASE'
        : !refill ? 'OUTER_BRIDGE_NARROWING_PICKUP'
          : 'CANONICAL_REJOIN_READY';
  return Object.freeze({
    schemaVersion: SOVEREIGN_OUTER_BRIDGE_SCHEMA,
    observedAtUtc: Number.isFinite(time) ? new Date(time).toISOString() : '',
    sourceHead: identity ? sourceHead : '',
    status: refill ? 'READY' : 'HELD',
    stage,
    outerEnd: 'EXISTING_CORE_DAEMON_AND_SOVEREIGN_COMMANDER',
    innerEnd: 'EXISTING_CANONICAL_PROGRAMME_LEASE_AND_WORKER',
    brokenMiddle: 'RECOVERY_MESH_WAKE_AND_ORIGINAL_2962_TERMINAL_BINDING',
    wakeAdapterRequired: false,
    elasticAdmissionRequiredForRescue: false,
    rescueObserved: Boolean(rescue && rescue.publicationOk === true),
    rescueBlocker: safe(rescue?.blocker, 'ORIGINAL_SOURCE_RECOVERY_NOT_PROVEN'),
    originalLeaseId: /^critical-2962-elastic-goal-r[1-9]\d*-lease$/.test(String(rescue?.originalLeaseId || ''))
      ? rescue.originalLeaseId : '',
    canonicalLeaseReleaseProven: released,
    physicalPickupProven: pickup,
    twoUnattendedRefillsProven: refill,
    originalWorkerTerminalReceiptProven: false,
    remainingGates: Object.freeze([
      ...(!released ? ['ORIGINAL_EXACT_LEASE_RELEASE'] : []),
      ...(!pickup ? ['PHYSICAL_WORKER_PICKUP'] : []),
      ...(!refill ? ['TWO_UNATTENDED_REFILLS'] : []),
    ]),
    // Even a fully proven downstream hand-back is only a suggestion to the
    // canonical fabric. Never create another scheduler/authority plane.
    canonicalHandbackEligible: refill,
    ...guardrails,
  });
}

export function decideSovereignOuterBridgeAttemptV1({
  nowMs = Date.now(), nextEligibleAtMs = 0, inFlight = false,
  sourceHead = '', gamingActive = false, shutdown = false,
} = {}) {
  if (shutdown) return Object.freeze({ start: false, reason: 'CORE_SHUTTING_DOWN' });
  if (!SHA.test(String(sourceHead || ''))) return Object.freeze({ start: false, reason: 'EXACT_SOURCE_HEAD_UNPROVEN' });
  if (gamingActive === true) return Object.freeze({ start: false, reason: 'GAMING_GOVERNOR_PROTECTED' });
  if (inFlight) return Object.freeze({ start: false, reason: 'RESCUE_CYCLE_ALREADY_IN_FLIGHT' });
  if (!Number.isFinite(nowMs) || nowMs < nextEligibleAtMs) {
    return Object.freeze({ start: false, reason: 'RESCUE_INTERVAL_COOLDOWN' });
  }
  return Object.freeze({ start: true, reason: 'WIDE_BRIDGE_READY' });
}
