// Diagnostic projection for independently commissioned original-r7 Windows custody.
// Untrusted Windows inventory, even when every visible item is healthy, is never
// a signer, source-writer exclusion, lease-release or privileged-OS attestation.
export const ORIGINAL_R7_WITNESS_AUDIT_SCHEMA = 'stephanos.original-r7-witness-commissioning-audit.v1';
export const ORIGINAL_R7_WITNESS_READINESS_SCHEMA = 'stephanos.original-r7-witness-readiness.v1';
const REPO = 'Cheekyfellastef/stephan-os';
const LEASE = 'critical-2962-elastic-goal-r7-lease';
const SERVICE = 'StephanosOriginalR7CustodyWitness';
const UNKNOWN = new Set([
  'SERVICE_ENUMERATION_UNAVAILABLE',
  'PROCESS_ENUMERATION_UNAVAILABLE',
  'PROCESS_COMMANDLINE_VISIBILITY_INCOMPLETE',
  'SCHEDULED_TASK_ENUMERATION_UNAVAILABLE',
  'CHECKOUT_INSPECTION_UNAVAILABLE',
  'PUBLISHER_TASK_CONTEXT_UNAVAILABLE',
]);
const strictTime = x => typeof x === 'string'
  && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x)
  && Number.isFinite(Date.parse(x))
  && new Date(Date.parse(x)).toISOString() === x;
const count = x => x === null || (Number.isSafeInteger(x) && x >= 0 && x <= 1000000);

function verdict(blockers, visible = false, context = {}) {
  return Object.freeze({
    schemaVersion: ORIGINAL_R7_WITNESS_READINESS_SCHEMA,
    repository: REPO,
    originalLeaseId: LEASE,
    serviceName: SERVICE,
    observable: visible,
    servicePresent: context.servicePresent === true,
    serviceStatus: context.serviceStatus || 'UNKNOWN',
    publisherTaskPresent: context.publisherTaskPresent === true,
    publisherTaskState: context.publisherTaskState || 'UNKNOWN',
    publisherLastResultClass: context.publisherLastResultClass || 'UNKNOWN',
    publisherOriginalWriterAuthenticated: false,
    blockers: Object.freeze([...new Set(blockers)]),
    nextAction: 'COMMISSION_INDEPENDENT_WINDOWS_SERVICE_AND_SEPARATE_OPERATOR_ROOT',
    authenticatedWitness: false,
    originalHistoricalOutcome: 'UNKNOWN',
    historicalReceiptReconstructed: false,
    originalSourceLeaseUntouched: true,
    sourceMutationAuthority: false,
    leaseReleaseAuthority: false,
    operatorApprovalAuthority: false,
    privilegedServiceInstallAuthority: false,
    physicalPickupProven: false,
    finalVerdict: 'ORIGINAL_R7_WINDOWS_WITNESS_NOT_COMMISSIONED',
  });
}

export function projectOriginalR7WitnessCommissioningAuditV1(input, { nowUtc = new Date().toISOString() } = {}) {
  const malformed = () => verdict(['COMMISSIONING_AUDIT_UNTRUSTED_OR_STALE']);
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || input.schemaVersion !== ORIGINAL_R7_WITNESS_AUDIT_SCHEMA
    || input.repository !== REPO
    || input.originalLeaseId !== LEASE
    || input.serviceName !== SERVICE
    || input.inspectionMode !== 'UNPRIVILEGED_READ_ONLY'
    || input.finalVerdict !== 'COMMISSIONING_NOT_PROVEN'
    || !strictTime(input.observedAtUtc) || !strictTime(nowUtc)
    || Math.abs(Date.parse(nowUtc) - Date.parse(input.observedAtUtc)) > 2 * 60_000
    || typeof input.servicePresent !== 'boolean'
    || !['RUNNING', 'STOPPED', 'NOT_INSTALLED', 'UNKNOWN'].includes(input.serviceStatus)
    || (input.servicePresent === false && !['NOT_INSTALLED', 'UNKNOWN'].includes(input.serviceStatus))
    || !count(input.originalProcessCandidateCount)
    || !count(input.relatedTaskCount)
    || (input.publisherTaskPresent !== undefined && typeof input.publisherTaskPresent !== 'boolean')
    || (input.publisherTaskState !== undefined
      && !['RUNNING','READY','DISABLED','QUEUED','NOT_FOUND','UNKNOWN'].includes(input.publisherTaskState))
    || (input.publisherLastResultClass !== undefined
      && !['ZERO','NONZERO','NEVER_RUN','UNKNOWN'].includes(input.publisherLastResultClass))
    || (input.publisherTaskPresent === true && input.publisherTaskState === 'NOT_FOUND')
    || (input.publisherTaskPresent === false
      && !['UNKNOWN','NOT_FOUND',undefined].includes(input.publisherTaskState))
    || !Array.isArray(input.unknownObservations)
    || input.unknownObservations.length > 6
    || input.unknownObservations.some(x => typeof x !== 'string' || !UNKNOWN.has(x))
    || input.privilegedServiceSidVerified !== false
    || input.sourceAclDenialEnforced !== false
    || input.outOfJobWritersExcluded !== false
    || input.wmiComRelaunchDenied !== false
    || input.scheduledTaskRelaunchDenied !== false
    || input.trustRootsVerified !== false
    || input.independentOperatorSignatureVerified !== false
    || input.leaseReleaseAuthorized !== false
    || input.sourceMutationAuthorized !== false) return malformed();

  const blockers = [
    ...(input.servicePresent ? [] : ['OS_WITNESS_SERVICE_NOT_OBSERVED']),
    ...(input.servicePresent && input.serviceStatus !== 'RUNNING' ? ['OS_WITNESS_SERVICE_NOT_RUNNING'] : []),
    ...(input.originalProcessCandidateCount === null ? ['ORIGINAL_WRITER_PROCESS_INVENTORY_UNAVAILABLE']
      : input.originalProcessCandidateCount > 0 ? ['ORIGINAL_WRITER_PROCESS_CANDIDATES_PRESENT'] : []),
    ...(input.relatedTaskCount === null ? ['RELATED_SCHEDULED_TASK_INVENTORY_UNAVAILABLE'] : []),
    ...input.unknownObservations,
    'INDEPENDENT_PROTECTED_SERVICE_SID_NOT_COMMISSIONED',
    'ORIGINAL_WRITER_OS_EXCLUSION_AND_NEGATIVE_TESTS_UNPROVEN',
    'PROTECTED_WITNESS_SIGNING_ROOT_UNCOMMISSIONED',
    'SEPARATE_OPERATOR_SIGNING_ROOT_UNCOMMISSIONED',
    'CANONICAL_R7_CAS_RELEASE_PROOF_MISSING',
  ];
  return verdict(blockers, true, input);
}
