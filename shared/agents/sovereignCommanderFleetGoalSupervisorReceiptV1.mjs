// Diagnostic projection of the existing fleet action. This module grants no
// admission, retry, worker, source, lease, provider or merge authority.
export const FLEET_SUPERVISOR_ACTION = 'fleet-goal-supervisor';
export const FLEET_SUPERVISOR_SCHEMA = 'stephanos.sovereign-commander-fleet-goal-supervisor.v1';
export const FLEET_SUPERVISOR_MARKER = 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_RESULT=';
export const FLEET_SUPERVISOR_HELD_LIMIT = 8;

const RETRY_CODES = new Set([
  'UNKNOWN', 'NO_RETRYABLE_BLOCKED_AGENT_FAILURE',
  'RETRYABLE_AGENT_FAILURE_REVISION_UNPROVEN',
  'SOURCE_DIFF_RETRY_REQUIRES_STRONGER_OWNER_ACCEPTANCE',
  'RETRYABLE_AGENT_FAILURE_TERMINAL_IDENTITY_UNPROVEN',
  'RETRYABLE_AGENT_FAILURE_WORKSPACE_UNRESOLVED',
  'RETRYABLE_AGENT_FAILURE_OWNERSHIP_RELEASE_UNPROVEN',
  'RETRYABLE_AGENT_FAILURE_WORKTREE_REFRESH_BLOCKED',
  'RETRYABLE_AGENT_FAILURE_PRECONDITION_MOVED',
  'RETRYABLE_AGENT_FAILURE_READMITTED', 'RETRYABLE_AGENT_FAILURE_READMISSION_BLOCKED',
  'MISSION_WORKER_RETRY_IDENTITY_INCOMPLETE', 'MISSION_WORKER_RETRY_QUEUE_ROOT_REQUIRED',
  'MISSION_WORKER_RETRY_PRIOR_CLAIM_STILL_PROCESSING', 'MISSION_WORKER_RETRY_TERMINAL_QUEUE_PROOF_MISSING',
  'MISSION_WORKER_RETRY_TERMINAL_QUEUE_IDENTITY_INVALID', 'MISSION_WORKER_RETRY_EXECUTION_RECEIPT_ROOT_REQUIRED',
  'MISSION_WORKER_RETRY_TERMINAL_EXECUTION_RECEIPT_UNPROVEN',
]);
const ADMISSION_CODES = new Set([
  'UNKNOWN', 'ELASTIC_GOAL_ADMISSION_SAFE_HOLD', 'ELASTIC_GOAL_ADMISSION_DIAGNOSTIC_FAILED',
  'ELASTIC_GOAL_ADMISSIONS_READY', 'ELASTIC_GOAL_ADMISSIONS_EMPTY',
  'ELASTIC_GOAL_MISSIONS_CREATED', 'ELASTIC_GOAL_MISSIONS_AVAILABLE',
  'ELASTIC_GOAL_MISSIONS_OCCUPIED', 'ELASTIC_GOAL_MISSIONS_HELD',
]);
const REASON_CODES = new Set([
  'UNKNOWN', 'SCHEDULER_ELASTIC_ADMISSION_NOT_PROVEN',
  'RESOURCE_SCOPE_CONFLICT', 'MISSION_WORKER_RUNTIME_NOT_READY',
  'RESOURCE_SCOPE_REQUIRED', 'SOURCE_SCOPE_IDENTITY_MISMATCH',
  'MULTI_REPOSITORY_SOURCE_SCOPE_NOT_SUPPORTED', 'SOURCE_PATH_SCOPE_REQUIRED',
  'REPOSITORY_SCOPE_INVALID', 'EXISTING_GOAL_MISSION_TERMINAL_AWAITING_GOAL_RECONCILIATION',
  'EXISTING_GOAL_MISSION_BLOCKED_SIDELINED', 'EXISTING_GOAL_MISSION_AWAITING_OPERATOR_APPROVAL',
  'EXISTING_GOAL_MISSION_NOT_ADMISSIBLE', 'RETAINED_SOURCE_SCOPE_RESERVED',
  'DUPLICATE_CANDIDATE_ID', 'INVALID_CANDIDATE_INVENTORY', 'RESOURCE_CONFLICT',
  'PARALLEL_CAPACITY_FULL', 'ELASTIC_SELECTION_HELD', 'CANDIDATE_ISSUE_INVALID',
  'OPERATOR_LANE_CONTAINED', 'SCHEDULER_READY_GOAL_NOT_PROVEN',
  'GOAL_REQUIRED_TEST_PLAN_UNPROVEN', 'MISSION_CREATE_RESULT_INVALID',
  'SOURCE_REVISION_REQUIRED', 'EXACT_PR_HEAD_LANE_REQUIRES_CANONICAL_LEASE_PATH',
  'NATIVE_CONTROL_PHASE_REMAINS_PRIMARY_LANE', 'DISTINCT_PROVEN_EXTERNAL_CAPACITY_UNAVAILABLE',
  'EXACT_EXTERNAL_ACTION_GRANT_UNAVAILABLE', 'PARKED_ORIGINAL_MISSION_STATE_CHANGED',
  'PARKED_ORIGINAL_WRITER_PROOF_UNOBSERVABLE', 'LEASE_RELEASE_FAILED',
  'SOURCE_MUTATION_LEASE_NOT_ACTIVE', 'SOURCE_MUTATION_LEASE_OWNED_BY_OTHER_LANE',
  'LEASE_RENEWAL_FAILED', 'RUNNING_PR_HEAD_MISSION_WITHOUT_CANONICAL_LEASE',
  'PROVIDER_INDEPENDENT_CAPACITY_ROUTING_UNAVAILABLE', 'EXACT_PR_HEAD_ACTION_GRANT_UNAVAILABLE',
  'CANONICAL_QUEUED_EXECUTION_PROOF_REQUIRED', 'EXECUTION_RECEIPT_WORKSPACE_OR_LEASE_REQUIRED',
  'EXECUTION_RECEIPT_HISTORY_BLOCKED', 'IN_FLIGHT_PR_HEAD_ACTION_WITHOUT_CANONICAL_LEASE',
  'IN_FLIGHT_PR_HEAD_ACTION_WITHOUT_ACTIVE_CANONICAL_RECEIPT',
  'QUEUED_EXECUTION_RECEIPT_APPEND_EXCEPTION', 'QUEUED_EXECUTION_RECEIPT_APPEND_FAILED',
  'SOURCE_MUTATION_LEASE_CLAIM_EXCEPTION', 'SOURCE_MUTATION_LEASE_CLAIM_IDENTITY_MISMATCH',
  'LEASE_CLAIM_FAILED', 'PR_HEAD_ACTION_NOT_PUBLISHED',
  'EXECUTION_RECEIPT_ALREADY_COMPLETED', 'EXECUTION_RECEIPT_ALREADY_FAILED',
  'EXECUTION_RECEIPT_ALREADY_CANCELLED',
  'ACTIVE_EXECUTION_RECEIPT_WITHOUT_IN_FLIGHT_QUEUE:accepted',
  'ACTIVE_EXECUTION_RECEIPT_WITHOUT_IN_FLIGHT_QUEUE:started',
  'ACTIVE_EXECUTION_RECEIPT_WITHOUT_IN_FLIGHT_QUEUE:progress',
  'ACTIVE_EXECUTION_RECEIPT_WITHOUT_IN_FLIGHT_QUEUE:stalled',
]);
const OUTCOMES = new Set([
  'BLOCKED', 'NATIVE_INTAKE_UNVERIFIED', 'NATIVE_UPLIFT_PENDING', 'PICKUP_PENDING',
  'PARITY_CLOSURE_ACTIVE', 'PARITY_PENDING', 'DISPATCHED', 'IDLE_GREEN',
  'HELD_EXPLAINED', 'GREEN',
].map(code => `SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_${code}`));
const BLOCKED = 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_BLOCKED';
const BLOCKER_CODES = new Set([
  'UNKNOWN', 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_FAILED',
  'CANONICAL_GOAL_CONVEYOR_EXCEPTION', 'CANONICAL_GOAL_CONVEYOR_BLOCKED',
  'ELASTIC_GOALS_ALL_HELD_REPAIR_REQUIRED', 'ELASTIC_GOAL_ADMISSION_SAFE_HOLD',
  'ELASTIC_GOAL_ADMISSION_DIAGNOSTIC_FAILED', 'ELASTIC_GOAL_ADMISSION_FAILED',
  'ELASTIC_GOAL_MISSIONS_HELD_WITHOUT_CLAIMABLE_WORK', 'ELASTIC_GOAL_ADMISSION_NOT_PROVEN',
  'CANONICAL_PROGRAMME_HOLD_REPAIR_REQUIRED', 'SOVEREIGN_COMMANDER_CAPABILITY_PARITY_UNPROVEN',
  'SAFE_RUNNABLE_WORK_AND_FREE_CAPACITY_STRANDED', 'CRITICAL_BACKLOG_CONVEYOR_SERVICE_BLOCKED',
  'SOVEREIGN_COMMANDER_CAPABILITY_PARITY_RECONCILE_FAILED',
  'REPAIR_ORIGINAL_EXECUTION_RECEIPT_MISSING', 'REPAIR_ORIGINAL_TERMINAL_SOURCE_BINDING_UNPROVEN',
  'REPAIR_ORIGINAL_EXECUTION_HISTORY_UNVERIFIED', 'REPAIR_ORIGINAL_TERMINAL_PAIR_PRESENT_RECEIPT_MISSING',
  'REPAIR_ORIGINAL_WORK_STILL_IN_FLIGHT', 'CANCELLED_ORIGINAL_SOURCE_FENCE_REQUIRED',
  'ORIGINAL_SOURCE_FENCE_PROOF_UNVERIFIED', 'EXACT_ORIGINAL_MISSION_UNAVAILABLE_OR_AMBIGUOUS',
  'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_TIMEOUT_CUSTODY_UNPROVEN',
]);
const COUNT_FIELDS = Object.freeze([
  'activeMissionCount', 'runningMissionCount', 'runnableGoalCount', 'availableSlotCount',
  'dispatchCount', 'pickupPendingCount', 'provenPickupCount', 'heldGoalCount',
]);
const AUTHORITY_FIELDS = Object.freeze([
  'duplicateSchedulerAllowed', 'duplicateLeaseAllowed', 'mergeAuthority',
  'runtimeMutationAuthority', 'arbitraryShellAllowed',
]);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exactFields = (value, keys) => record(value) && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key)
    && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'));
const code = (value, known) => typeof value === 'string' && known.has(value) ? value : 'UNKNOWN';
const count = value => value === null || (typeof value === 'number'
  && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000);
const issue = value => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
function missionIssue(value) {
  // Same canonical critical-mission prefix as the conveyor's issueFromMissionId.
  const match = typeof value === 'string' ? value.trim().toLowerCase().match(/^critical-([1-9]\d*)(?:$|[-_.])/) : null;
  return issue(Number(match?.[1]));
}
function heldIssue(row) {
  const direct = issue(row?.issueNumber), canonical = missionIssue(row?.missionId);
  return direct !== null && canonical !== null && direct !== canonical ? null : direct ?? canonical;
}

export function projectFleetConveyorObservationV1(conveyor = {}) {
  const retry = record(conveyor?.retryAdmission) ? conveyor.retryAdmission : null;
  const admission = record(conveyor?.elasticAdmission) ? conveyor.elasticAdmission : null;
  const heldArrays = [admission?.held, conveyor?.elasticIgnition?.held].filter(Array.isArray);
  // Count observations from the two existing owners, not unique active lanes.
  const heldCount = heldArrays.reduce((total, rows) => total + rows.length, 0);
  const rows = heldArrays.flatMap(values => values.slice(0, FLEET_SUPERVISOR_HELD_LIMIT))
    .slice(0, FLEET_SUPERVISOR_HELD_LIMIT);
  return Object.freeze({
    retryAdmission: Object.freeze({
      present: Boolean(retry),
      classification: code(retry?.classification, RETRY_CODES),
      retried: typeof retry?.retried === 'boolean' ? retry.retried : null,
      issueNumber: missionIssue(retry?.missionId),
    }),
    admission: Object.freeze({
      present: Boolean(admission),
      classification: code(admission?.classification, ADMISSION_CODES),
      reasonCode: code(admission?.reason, REASON_CODES),
    }),
    held: Object.freeze({
      count: heldArrays.length > 0 && count(heldCount) ? heldCount : null,
      reasons: Object.freeze(rows.map(row => Object.freeze({
        issueNumber: heldIssue(row),
        reasonCode: code(row?.reason, REASON_CODES),
      }))),
      truncated: heldCount > rows.length,
    }),
  });
}

// The same strict, idempotent projection is used at the MCP and public mailbox
// boundaries. Unknown diagnostic codes stay UNKNOWN; malformed protocol truth
// is never converted to a successful action or a zero count.
export function isFleetSupervisorTerminalV1(value) {
  return record(value) && value.schemaVersion === FLEET_SUPERVISOR_SCHEMA
    && typeof value.ok === 'boolean' && OUTCOMES.has(value.finalVerdict)
    && (value.finalVerdict === BLOCKED) === (value.ok === false)
    && AUTHORITY_FIELDS.every(key => value[key] === false);
}

export function projectFleetSupervisorReceiptV1(value, status) {
  if (!isFleetSupervisorTerminalV1(value)
    || (status !== undefined && status !== (value.ok ? 0 : 2))
    || (Object.hasOwn(value, 'diagnosticOnly') && value.diagnosticOnly !== true)) return null;
  const blockerCode = Object.hasOwn(value, 'blockerCode') ? value.blockerCode
    : fleetSupervisorBlockerCodeV1(value.ok, value.blocker);
  if (value.ok ? blockerCode !== '' : !BLOCKER_CODES.has(blockerCode)) return null;
  const retry = value.retryAdmission, admission = value.admission, held = value.held;
  if (!exactFields(retry, ['present', 'classification', 'retried', 'issueNumber'])
    || typeof retry.present !== 'boolean' || !RETRY_CODES.has(retry.classification)
    || (retry.retried !== null && typeof retry.retried !== 'boolean')
    || (retry.issueNumber !== null && issue(retry.issueNumber) === null)
    || (retry.retried === true && (retry.classification !== 'RETRYABLE_AGENT_FAILURE_READMITTED' || retry.issueNumber === null))
    || (retry.classification === 'RETRYABLE_AGENT_FAILURE_READMITTED' && retry.retried !== true)
    || (!retry.present && (retry.classification !== 'UNKNOWN' || retry.retried !== null || retry.issueNumber !== null))
    || !exactFields(admission, ['present', 'classification', 'reasonCode'])
    || typeof admission.present !== 'boolean' || !ADMISSION_CODES.has(admission.classification)
    || !REASON_CODES.has(admission.reasonCode)
    || (!admission.present && (admission.classification !== 'UNKNOWN' || admission.reasonCode !== 'UNKNOWN'))
    || !exactFields(held, ['count', 'reasons', 'truncated']) || !count(held.count)
    || !Array.isArray(held.reasons) || held.reasons.length > FLEET_SUPERVISOR_HELD_LIMIT
    || typeof held.truncated !== 'boolean'
    || (held.count === null && (held.reasons.length !== 0 || held.truncated))
    || (held.count !== null && (held.count < held.reasons.length
      || held.truncated !== (held.count > held.reasons.length)))) return null;
  const reasons = [];
  for (const row of held.reasons) {
    if (!exactFields(row, ['issueNumber', 'reasonCode'])
      || (row.issueNumber !== null && issue(row.issueNumber) === null)
      || !REASON_CODES.has(row.reasonCode)) return null;
    reasons.push(Object.freeze({ issueNumber: row.issueNumber, reasonCode: row.reasonCode }));
  }
  const counts = {};
  for (const key of COUNT_FIELDS) {
    if (!Object.hasOwn(value, key) || !count(value[key])) return null;
    counts[key] = value[key];
  }
  if (counts.dispatchCount !== null && counts.provenPickupCount !== null
    && counts.provenPickupCount > counts.dispatchCount) return null;
  if (counts.dispatchCount !== null && counts.provenPickupCount !== null && counts.pickupPendingCount !== null
    && counts.pickupPendingCount < counts.dispatchCount - counts.provenPickupCount) return null;
  return Object.freeze({
    schemaVersion: FLEET_SUPERVISOR_SCHEMA,
    ok: value.ok,
    finalVerdict: value.finalVerdict,
    blockerCode,
    retryAdmission: Object.freeze({ ...retry }),
    admission: Object.freeze({ ...admission }),
    held: Object.freeze({ count: held.count, reasons: Object.freeze(reasons), truncated: held.truncated }),
    ...counts,
    diagnosticOnly: true,
    duplicateSchedulerAllowed: false,
    duplicateLeaseAllowed: false,
    mergeAuthority: false,
    runtimeMutationAuthority: false,
    arbitraryShellAllowed: false,
  });
}

export function fleetSupervisorBlockerCodeV1(ok, blocker) {
  return ok === true ? '' : code(blocker, BLOCKER_CODES);
}

export function compactFleetSupervisorReceiptV1(value, heldLimit = FLEET_SUPERVISOR_HELD_LIMIT) {
  const projected = projectFleetSupervisorReceiptV1(value);
  if (!projected || !Number.isSafeInteger(heldLimit) || heldLimit < 0
    || heldLimit > FLEET_SUPERVISOR_HELD_LIMIT) return null;
  const reasons = Object.freeze(projected.held.reasons.slice(0, heldLimit));
  return Object.freeze({ ...projected, held: Object.freeze({
    count: projected.held.count, reasons,
    truncated: projected.held.count !== null && projected.held.count > reasons.length,
  }) });
}
