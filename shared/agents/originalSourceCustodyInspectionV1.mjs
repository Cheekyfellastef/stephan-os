// Read-only projection for the exact historical #2962/r7 Windows census.
// Do not promote untrusted telemetry to signer, cancellation or lease authority.
export const ORIGINAL_SOURCE_CUSTODY_CENSUS_SCHEMA =
  'stephanos.original-source-custody-readonly-census.v1';
const LEASE = 'critical-2962-elastic-goal-r7-lease';
const REPO = 'Cheekyfellastef/stephan-os';
const UNKNOWN = new Set([
  'CHECKOUT_PROBE_UNAVAILABLE', 'CIM_PROCESS_INVENTORY_UNAVAILABLE',
  'CIM_PROCESS_COMMAND_LINE_UNOBSERVED', 'TASK_INVENTORY_UNAVAILABLE', 'CHECKOUT_UNAVAILABLE', 'CHECKOUT_ACL_UNAVAILABLE',
]);
const count = v => v === null || (Number.isSafeInteger(v) && v >= 0 && v <= 1000000);
const exactTime = value => typeof value === 'string'
  && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value))
  && new Date(Date.parse(value)).toISOString() === value;
const verdict = (blockers, observable = false) => Object.freeze({
  schemaVersion: 'stephanos.original-source-custody-readiness.v1',
  originalLeaseId: LEASE, observable,
  blockers: Object.freeze(blockers),
  historicallyMissingReceiptStillMissing: true,
  independentWindowsExclusionProven: false,
  independentlySignedOperatorApprovalProven: false,
  leaseReleaseAuthorized: false, sourceMutationAuthorized: false,
  safeToCancelOriginal: false,
  finalVerdict: 'ORIGINAL_SOURCE_CUSTODY_HOLD',
});
export function inspectOriginalSourceCustodyCensusV1(input, {
  nowUtc = new Date().toISOString(),
} = {}) {
  const hold = code => verdict([code,
    'INDEPENDENT_OS_EXCLUSION_WITNESS_NOT_COMMISSIONED',
    'INDEPENDENT_OPERATOR_APPROVAL_NOT_PROVEN']);
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || input.schemaVersion !== ORIGINAL_SOURCE_CUSTODY_CENSUS_SCHEMA
    || input.repository !== REPO || input.originalLeaseId !== LEASE
    || input.inspectionMode !== 'UNPRIVILEGED_READ_ONLY'
    || input.finalVerdict !== 'INSPECTION_ONLY_CUSTODY_HOLD'
    || !exactTime(input.inspectedAtUtc) || !exactTime(nowUtc)
    || Math.abs(Date.parse(nowUtc) - Date.parse(input.inspectedAtUtc)) > 5 * 60_000
    || typeof input.checkoutPresent !== 'boolean'
    || typeof input.aclReadable !== 'boolean'
    || !count(input.candidateProcessCount)
    || !count(input.stephanosScheduledTaskCount)
    || !Array.isArray(input.unknownObservations)
    || input.unknownObservations.length > 5
    || input.unknownObservations.some(x => typeof x !== 'string' || !UNKNOWN.has(x))
    || input.historicalExecutionOutcome !== 'UNKNOWN'
    || input.originalReceiptReconstructed !== false
    || input.independentWindowsExclusionProven !== false
    || input.outOfJobWriterExclusionProven !== false
    || input.sourceAclDenialProven !== false
    || input.independentOperatorApprovalProven !== false
    || input.leaseReleaseAuthorized !== false
    || input.sourceMutationAuthorized !== false) return hold('CENSUS_UNTRUSTED_OR_STALE');
  const blockers = [
    ...(input.checkoutPresent ? [] : ['ORIGINAL_CHECKOUT_NOT_OBSERVED']),
    ...(input.aclReadable ? [] : ['ORIGINAL_CHECKOUT_ACL_UNOBSERVED']),
    ...(input.candidateProcessCount === null ? ['ORIGINAL_PROCESS_ENUMERATION_UNAVAILABLE']
      : input.candidateProcessCount > 0 ? ['ORIGINAL_PROCESS_CANDIDATES_PRESENT'] : []),
    ...(input.stephanosScheduledTaskCount === null ? ['SCHEDULED_TASK_ENUMERATION_UNAVAILABLE'] : []),
    ...input.unknownObservations,
    'INDEPENDENT_OS_EXCLUSION_WITNESS_NOT_COMMISSIONED',
    'INDEPENDENT_OPERATOR_APPROVAL_NOT_PROVEN',
  ];
  return verdict([...new Set(blockers)], true);
}
