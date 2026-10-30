// Emergency observation is independent of the goal scheduler, not of canonical authority.
// This projector never grants a source writer, lease seizure, or protected merge.
export const TEMPORARY_SOVEREIGN_LEASE_RESCUE_SCHEMA =
  'stephanos.temporary-sovereign-lease-rescue.v1';
const SHA = /^[a-f0-9]{40}$/i;
const ISSUE = '#2961';
const FORENSIC_CLASSIFICATIONS = new Set([
  'ORIGINAL_TERMINAL_QUEUE_UNOBSERVABLE',
  'ORIGINAL_MULTIPLE_BOUND_TERMINAL_PAIRS',
  'ORIGINAL_TERMINAL_QUEUE_SOURCE_BINDING_UNPROVEN',
  'ORIGINAL_BOUND_TERMINAL_RESULT_MISSING_OR_INVALID',
  'ORIGINAL_EXACT_TERMINAL_PAIR_PRESENT',
  'ORIGINAL_EXACT_TERMINAL_PAIR_NOT_FOUND',
]);
const BINDING_MISMATCH_FIELDS = new Set([
  'ITEM_SCHEMA', 'ADAPTER', 'ACTION_FILENAME', 'BINDING_SCHEMA',
  'LEASE_KEY', 'MISSION_ID', 'EXECUTION_ID', 'REPOSITORY',
  'ISSUE_NUMBER', 'PR_NUMBER', 'BRANCH', 'HEAD_SHA',
]);

function code(value, fallback) {
  const raw = String(value || '').trim().toUpperCase();
  return /^[A-Z][A-Z0-9_]{0,119}$/.test(raw) ? raw : fallback;
}
function leaseKey(value) {
  const raw = String(value || '');
  return /^critical-2962-elastic-goal-r[1-9]\d*-lease$/.test(raw) ? raw : '';
}
const noAuthority = Object.freeze({
  sourceMutationAllowed: false,
  leaseSeizureAllowed: false,
  newWriterAllowed: false,
  independentWorkerDispatchAllowed: false,
  protectedMergeAllowed: false,
  runtimeMutationAllowed: false,
  arbitraryShellAllowed: false,
  duplicateSchedulerAllowed: false,
});
export function projectTemporarySovereignLeaseRescueV1({
  timestampUtc, sourceHead, leaseRead, forensic, canonicalReconciliation,
} = {}) {
  const observedAtUtc = Number.isFinite(Date.parse(timestampUtc))
    ? new Date(timestampUtc).toISOString() : '';
  let mode = 'EVIDENCE_HELD';
  let blocker = 'LEASE_AUTHORITY_UNVERIFIED';
  let nextAutomaticAction = 'RETRY_CANONICAL_LEASE_OBSERVATION';
  const lease = leaseRead?.record;
  const originalLeaseId = leaseKey(lease?.leaseId);
  const leaseStale = leaseRead?.ok === true
    && leaseRead?.validation?.valid === true
    && leaseRead?.validation?.active === false
    && leaseRead?.validation?.stale === true;
  const validHead = SHA.test(String(sourceHead || ''));
  const safeForensicClassification = FORENSIC_CLASSIFICATIONS.has(forensic?.classification)
    ? forensic.classification : 'FORENSIC_NOT_PROVEN';
  if (!observedAtUtc || !validHead) {
    blocker = 'EXACT_LOCAL_SOURCE_HEAD_UNAVAILABLE';
    nextAutomaticAction = 'RETRY_LOCAL_SOURCE_HEAD_PROOF';
  } else if (leaseRead?.ok === true && leaseRead?.present === false) {
    mode = 'CANONICAL_RECOVERY_NEEDS_WORKER_PROOF';
    blocker = 'POST_RELEASE_PHYSICAL_PICKUP_UNPROVEN';
    nextAutomaticAction = 'OBSERVE_CANONICAL_WORKER_PICKUP_AND_TWO_REFILLS';
  } else if (leaseRead?.ok === true && originalLeaseId && leaseStale) {
    mode = 'WAITING_EXACT_RELEASE';
    blocker = code(canonicalReconciliation?.blocker,
      'EXACT_CANONICAL_LEASE_RELEASE_NOT_PROVEN');
    nextAutomaticAction = 'RECHECK_ORIGINAL_RECEIPT_AND_CANONICAL_RELEASE';
    if (canonicalReconciliation?.released === true
        && canonicalReconciliation?.ok === true) {
      mode = 'CANONICAL_RECOVERY_NEEDS_WORKER_PROOF';
      blocker = 'POST_RELEASE_PHYSICAL_PICKUP_UNPROVEN';
      nextAutomaticAction = 'OBSERVE_CANONICAL_WORKER_PICKUP_AND_TWO_REFILLS';
    } else if (safeForensicClassification === 'ORIGINAL_TERMINAL_QUEUE_SOURCE_BINDING_UNPROVEN') {
      mode = 'ORIGINAL_OWNER_REPAIR_REQUIRED';
      blocker = 'REPAIR_ORIGINAL_TERMINAL_SOURCE_BINDING_UNPROVEN';
      nextAutomaticAction = 'PREPARE_ISOLATED_ORIGINAL_OWNER_EVIDENCE_REPAIR';
    }
  } else if (leaseRead?.ok === true && leaseRead?.present === true) {
    blocker = originalLeaseId ? 'ORIGINAL_LEASE_NOT_SAFE_TO_RELEASE'
      : 'UNEXPECTED_SOURCE_LEASE_OWNER';
    nextAutomaticAction = 'RECHECK_CANONICAL_LEASE_WITHOUT_SEIZURE';
  }
  return Object.freeze({
    schemaVersion: TEMPORARY_SOVEREIGN_LEASE_RESCUE_SCHEMA,
    relatedIssue: ISSUE,
    observedAtUtc,
    sourceHead: validHead ? sourceHead.toLowerCase() : '',
    mode, blocker, nextAutomaticAction,
    originalLeaseId,
    forensicClassification: safeForensicClassification,
    bindingMismatchCodes: Object.freeze(Array.isArray(forensic?.bindingMismatchCodes)
      ? forensic.bindingMismatchCodes.filter(x => BINDING_MISMATCH_FIELDS.has(x)).slice(0,12)
      : []),
    exactTerminalPairCount: Number.isSafeInteger(forensic?.exactPairCount)
      ? forensic.exactPairCount : 0,
    canonicalLeaseReleaseProven: canonicalReconciliation?.ok === true
      && canonicalReconciliation?.released === true,
    physicalPickupProven: false,
    twoUnattendedRefillsProven: false,
    status: 'HELD',
    safeParallelForensicsAllowed: true,
    isolatedSourceRepairPreparationOnly: true,
    ...noAuthority,
  });
}
