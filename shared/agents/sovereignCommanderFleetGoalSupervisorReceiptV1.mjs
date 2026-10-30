// Diagnostic projection of the existing fleet action. This module grants no
// admission, retry, worker, source, lease, provider or merge authority.
export const FLEET_SUPERVISOR_ACTION = 'fleet-goal-supervisor';
export const FLEET_SUPERVISOR_SCHEMA = 'stephanos.sovereign-commander-fleet-goal-supervisor.v1';
export const FLEET_SUPERVISOR_MARKER = 'SOVEREIGN_COMMANDER_FLEET_GOAL_SUPERVISOR_RESULT=';
export const FLEET_SUPERVISOR_HELD_LIMIT = 8;
export const FLEET_SUPERVISOR_ACTIVE_LIMIT = 4;
// Fixed observation of the existing canonical Seed Growth task. This is not an
// action/query parameter and must never be consumed as retry or source authority.
const RECOVERY_ISSUE = 2964;
const CANONICAL_REPOSITORY = 'cheekyfellastef/stephan-os';
const PHASES = new Set(['UNKNOWN', 'CREATE_WORKTREE', 'AGENT_IMPLEMENTATION',
  'LIVE_RUNTIME_INVESTIGATION', 'VERIFYING', 'GITHUB_COMMIT', 'GITHUB_PUSH',
  'OPEN_PULL_REQUEST', 'CHECK_PULL_REQUEST', 'REPAIR_REQUIRED',
  'AWAITING_OPERATOR_APPROVAL', 'MERGE_PULL_REQUEST', 'LOCAL_DEPLOYMENT',
  'COMPLETE', 'BLOCKED', 'CANCELLED']);
const DISPATCH_STATES = new Set(['UNKNOWN', 'pending', 'running', 'failed', 'complete', 'stopped', 'idle']);
const CONTINUITY_STATES = new Set(['UNKNOWN', 'ACTIVE', 'PARKED_BLOCKED', 'REENTRY_READY']);
const RETRY_GATE_CODES = new Set(['UNKNOWN', 'NOT_OBSERVED', 'NOT_EVALUATED',
  'MISSION_NOT_OBSERVED', 'MISSION_IDENTITY_UNPROVEN', 'AMBIGUOUS_MISSION_IDENTITY',
  'PHASE_NOT_BLOCKED', 'CONTINUITY_NOT_RETRYABLE', 'DISPATCH_NOT_FAILED',
  'NO_RETRYABLE_BLOCKERS', 'NON_RETRYABLE_BLOCKER', 'REPAIR_BUDGET_INVALID',
  'REPAIR_BUDGET_EXHAUSTED', 'MISSION_OUTSIDE_RETRY_DOMAIN', 'REVISION_UNPROVEN',
  'SOURCE_DIFF_MULTIPLE_BLOCKERS', 'OWNER_MIRROR_MISSING', 'OWNER_MIRROR_AMBIGUOUS',
  'OWNER_SOURCE_SCOPE_MISMATCH', 'OWNER_PLAN_INVALID', 'OWNER_TEST_PLAN_UNSUPPLIED',
  'OWNER_TEST_SET_UNCHANGED', 'PREVIOUS_TESTS_NOT_RETAINED', 'STRENGTHENED_PLAN_REJECTED',
  'TERMINAL_IDENTITY_UNPROVEN', 'WORKSPACE_UNRESOLVED', 'OWNERSHIP_RELEASE_UNPROVEN',
  'WORKTREE_REFRESH_BLOCKED', 'RETRY_SELECTED', 'RETRY_PRECONDITION_MOVED',
  'RETRY_READMITTED', 'RETRY_READMISSION_BLOCKED']);

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

const canonicalRepository = value => typeof value === 'string' && value.toLowerCase() === CANONICAL_REPOSITORY;
const elasticMission = value => typeof value === 'string'
  && /^critical-[1-9]\d*-elastic-goal(?:$|[-_.])/i.test(value);
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  const canonical = new Date(parsed).toISOString();
  return canonical === value || canonical.replace('.000Z', 'Z') === value ? canonical : null;
}
function storedMission(state) {
  const identity = canonicalRepository(state?.repository) && elasticMission(state?.missionId)
    && missionIssue(state?.missionId) !== null;
  return Object.freeze({
    issueNumber: identity ? missionIssue(state.missionId) : null,
    phase: identity ? code(state?.currentPhase, PHASES) : 'UNKNOWN',
    dispatchStatus: identity ? code(state?.dispatch?.status, DISPATCH_STATES) : 'UNKNOWN',
    continuity: identity ? code(state?.continuity?.parkingStatus, CONTINUITY_STATES) : 'UNKNOWN',
    revision: identity && count(state?.revision) ? state.revision : null,
    updatedAt: identity ? timestamp(state?.updatedAt) : null,
  });
}
function validStoredMission(state) {
  return exactFields(state, ['issueNumber', 'phase', 'dispatchStatus', 'continuity', 'revision', 'updatedAt'])
    && (state.issueNumber === null || issue(state.issueNumber) !== null)
    && PHASES.has(state.phase) && DISPATCH_STATES.has(state.dispatchStatus)
    && CONTINUITY_STATES.has(state.continuity) && count(state.revision)
    && (state.updatedAt === null || timestamp(state.updatedAt) === state.updatedAt)
    && (state.issueNumber !== null || (state.phase === 'UNKNOWN' && state.dispatchStatus === 'UNKNOWN'
      && state.continuity === 'UNKNOWN' && state.revision === null && state.updatedAt === null));
}

// Capture scalar state before any retry event can mutate the record. The
// observer has no I/O or policy effect: callers only note branches they reached.
export function createFleetRetryScanObservationV1(records) {
  const entries = records.map(state => ({ state, snapshot: storedMission(state),
    issueNumber: canonicalRepository(state?.repository) ? missionIssue(state?.missionId) : null,
    recoveryMatch: missionIssue(state?.missionId) === RECOVERY_ISSUE, gateCode: 'NOT_EVALUATED' }));
  const byRecord = new Map();
  for (const entry of entries) {
    const matches = byRecord.get(entry.state) || [];
    matches.push(entry); byRecord.set(entry.state, matches);
  }
  return Object.freeze({
    note(state, gateCode) {
      for (const entry of byRecord.get(state) || []) entry.gateCode = code(gateCode, RETRY_GATE_CODES);
    },
    snapshot(candidates, evaluatedCount) {
      const matches = entries.filter(entry => entry.recoveryMatch);
      const unique = matches.length === 1 ? matches[0] : null;
      const validIdentity = unique?.snapshot.issueNumber === RECOVERY_ISSUE;
      // Preserve the already selected candidate order. Noncandidate exclusions
      // are observed by the fixed recovery witness, never sampled as retry work.
      const rows = candidates.slice(0, FLEET_SUPERVISOR_HELD_LIMIT).map(state => {
        const entry = byRecord.get(state)?.[0];
        return Object.freeze({
        issueNumber: entry?.issueNumber ?? null,
        gateCode: code(entry?.gateCode, RETRY_GATE_CODES),
        });
      });
      return Object.freeze({
        snapshotStage: 'BEFORE_RETRY', observed: true,
        recordCount: entries.length, candidateCount: candidates.length, evaluatedCount,
        reasons: Object.freeze(rows), truncated: candidates.length > rows.length,
        recovery: Object.freeze({ issueNumber: RECOVERY_ISSUE, matchCount: matches.length,
          state: validIdentity ? unique.snapshot : null, stateOmitted: false,
          gateCode: matches.length === 0 ? 'MISSION_NOT_OBSERVED'
            : matches.length > 1 ? 'AMBIGUOUS_MISSION_IDENTITY'
            : !validIdentity ? 'MISSION_IDENTITY_UNPROVEN' : code(unique.gateCode, RETRY_GATE_CODES) }),
      });
    },
  });
}

// Called only after the existing stronger-acceptance branch rejected the plan.
// It explains already computed inputs; it never supplies a policy decision.
export function fleetRetryAcceptanceGateCodeV1({ singleBlocker, mirrorCount, sameSourceScope,
  ownerPlan, previousRequiredTests, nextRequiredTests } = {}) {
  if (!singleBlocker) return 'SOURCE_DIFF_MULTIPLE_BLOCKERS';
  if (mirrorCount === 0) return 'OWNER_MIRROR_MISSING';
  if (mirrorCount !== 1) return 'OWNER_MIRROR_AMBIGUOUS';
  if (!sameSourceScope) return 'OWNER_SOURCE_SCOPE_MISMATCH';
  if (!ownerPlan?.valid) return 'OWNER_PLAN_INVALID';
  if (!ownerPlan.supplied) return 'OWNER_TEST_PLAN_UNSUPPLIED';
  if (Array.isArray(previousRequiredTests) && Array.isArray(nextRequiredTests)) {
    if (previousRequiredTests.some(command => !nextRequiredTests.includes(command))) return 'PREVIOUS_TESTS_NOT_RETAINED';
    if (!nextRequiredTests.some(command => !previousRequiredTests.includes(command))) return 'OWNER_TEST_SET_UNCHANGED';
  }
  return 'STRENGTHENED_PLAN_REJECTED';
}

function unknownRetryScan() {
  return { snapshotStage: 'BEFORE_RETRY', observed: false,
    recordCount: null, candidateCount: null, evaluatedCount: null,
    reasons: [], truncated: false, recovery: { issueNumber: RECOVERY_ISSUE, matchCount: null,
      state: null, stateOmitted: false, gateCode: 'NOT_OBSERVED' } };
}
function projectMissionDiagnostics(value) {
  if (value?.detailsOmitted === true) return projectCompactMissionDiagnostics(value);
  if (!exactFields(value, ['persistedStateOnly', 'storedMissions', 'retryScan']) || value.persistedStateOnly !== true) return null;
  const stored = value.storedMissions, scan = value.retryScan, recovery = scan?.recovery;
  if (!exactFields(stored, ['snapshotStage', 'observed', 'selected', 'selectedOmitted', 'activeCount', 'active', 'truncated'])
    || stored.snapshotStage !== 'ADMISSION_RESULT'
    || typeof stored.observed !== 'boolean' || typeof stored.selectedOmitted !== 'boolean'
    || (stored.selected !== null && !validStoredMission(stored.selected))
    || (stored.selectedOmitted && stored.selected !== null) || !count(stored.activeCount)
    || !Array.isArray(stored.active) || stored.active.length > FLEET_SUPERVISOR_ACTIVE_LIMIT
    || !stored.active.every(validStoredMission) || typeof stored.truncated !== 'boolean'
    || (stored.activeCount === null ? stored.active.length !== 0 || stored.truncated
      : stored.activeCount < stored.active.length || stored.truncated !== (stored.activeCount > stored.active.length))
    || (!stored.observed && (stored.selected !== null || stored.selectedOmitted || stored.activeCount !== null))
    || (stored.observed && stored.activeCount === null)
    || !exactFields(scan, ['snapshotStage', 'observed', 'recordCount', 'candidateCount', 'evaluatedCount', 'reasons', 'truncated', 'recovery'])
    || scan.snapshotStage !== 'BEFORE_RETRY'
    || typeof scan.observed !== 'boolean' || !count(scan.recordCount) || !count(scan.candidateCount) || !count(scan.evaluatedCount)
    || !Array.isArray(scan.reasons) || scan.reasons.length > FLEET_SUPERVISOR_HELD_LIMIT
    || typeof scan.truncated !== 'boolean'
    || (scan.candidateCount === null ? scan.reasons.length !== 0 || scan.truncated
      : scan.candidateCount < scan.reasons.length || scan.truncated !== (scan.candidateCount > scan.reasons.length))
    || (scan.observed && [scan.recordCount, scan.candidateCount, scan.evaluatedCount].some(value => value === null))
    || (scan.candidateCount !== null && (scan.candidateCount > scan.recordCount || scan.evaluatedCount > scan.candidateCount))
    || (!scan.observed && (scan.recordCount !== null || scan.candidateCount !== null || scan.evaluatedCount !== null))
    || !exactFields(recovery, ['issueNumber', 'matchCount', 'state', 'stateOmitted', 'gateCode'])
    || recovery.issueNumber !== RECOVERY_ISSUE || !count(recovery.matchCount)
    || typeof recovery.stateOmitted !== 'boolean' || !RETRY_GATE_CODES.has(recovery.gateCode)
    || (recovery.state !== null && (!validStoredMission(recovery.state) || recovery.state.issueNumber !== RECOVERY_ISSUE))
    || (recovery.stateOmitted && (recovery.state !== null || recovery.matchCount !== 1))
    || (!scan.observed && (recovery.matchCount !== null || recovery.state !== null || recovery.stateOmitted || recovery.gateCode !== 'NOT_OBSERVED'))
    || (scan.observed && (recovery.matchCount === null || recovery.matchCount > scan.recordCount))
    || (recovery.matchCount === 0 && (recovery.state !== null || recovery.stateOmitted || recovery.gateCode !== 'MISSION_NOT_OBSERVED'))
    || (recovery.matchCount > 1 && (recovery.state !== null || recovery.stateOmitted || recovery.gateCode !== 'AMBIGUOUS_MISSION_IDENTITY'))
    || (recovery.matchCount === 1 && (recovery.state || recovery.stateOmitted)
      && ['NOT_OBSERVED', 'MISSION_NOT_OBSERVED', 'AMBIGUOUS_MISSION_IDENTITY', 'MISSION_IDENTITY_UNPROVEN'].includes(recovery.gateCode))
    || (recovery.matchCount === 1 && !recovery.state && !recovery.stateOmitted && recovery.gateCode !== 'MISSION_IDENTITY_UNPROVEN')) return null;
  const reasons = [];
  for (const row of scan.reasons) {
    if (!exactFields(row, ['issueNumber', 'gateCode']) || (row.issueNumber !== null && issue(row.issueNumber) === null)
      || !RETRY_GATE_CODES.has(row.gateCode)) return null;
    reasons.push(Object.freeze({ ...row }));
  }
  return Object.freeze({ persistedStateOnly: true,
    storedMissions: Object.freeze({ ...stored,
      selected: stored.selected ? Object.freeze({ ...stored.selected }) : null,
      active: Object.freeze(stored.active.map(state => Object.freeze({ ...state }))) }),
    retryScan: Object.freeze({ ...scan, reasons: Object.freeze(reasons),
      recovery: Object.freeze({ ...recovery, state: recovery.state ? Object.freeze({ ...recovery.state }) : null }) }),
  });
}

// Final 9 KiB pressure form. Scan counts/recovery remain BEFORE_RETRY;
// active remains the ADMISSION_RESULT active count; gate is the actual retry
// gate code. All scalar states and row arrays
// are explicitly omitted, never reconstructed as an observed empty inventory.
function projectCompactMissionDiagnostics(value) {
  if (!exactFields(value, ['detailsOmitted', 'active', 'records', 'candidates', 'evaluated', 'issue', 'matches', 'gate'])
    || value.detailsOmitted !== true || !count(value.active)
    || !count(value.records) || !count(value.candidates) || !count(value.evaluated)) return null;
  // Reuse the full schema's identity/count/omission consistency rules.
  const checked = projectMissionDiagnostics({ persistedStateOnly: true,
    storedMissions: { snapshotStage: 'ADMISSION_RESULT', observed: value.active !== null,
      selected: null, selectedOmitted: false, activeCount: value.active,
      active: [], truncated: value.active !== null && value.active > 0 },
    retryScan: { snapshotStage: 'BEFORE_RETRY', observed: value.records !== null,
      recordCount: value.records, candidateCount: value.candidates, evaluatedCount: value.evaluated,
      reasons: [], truncated: value.candidates !== null && value.candidates > 0,
      recovery: { issueNumber: value.issue, matchCount: value.matches, gateCode: value.gate, state: null,
        stateOmitted: value.matches === 1 && value.gate !== 'MISSION_IDENTITY_UNPROVEN' } },
  });
  return checked ? Object.freeze({ ...value }) : null;
}

function observeMissionDiagnostics(retry, admission) {
  const storedObserved = Array.isArray(admission?.activeMissions)
    && (admission?.selectedMission === null || record(admission?.selectedMission));
  if (!storedObserved && !record(retry?.retryScan)) return null;
  const active = storedObserved ? admission.activeMissions.slice(0, FLEET_SUPERVISOR_ACTIVE_LIMIT).map(storedMission) : [];
  return projectMissionDiagnostics({ persistedStateOnly: true,
    storedMissions: { snapshotStage: 'ADMISSION_RESULT', observed: storedObserved, selected: storedObserved && admission.selectedMission
      ? storedMission(admission.selectedMission) : null, selectedOmitted: false,
    activeCount: storedObserved ? admission.activeMissions.length : null, active,
    truncated: storedObserved && admission.activeMissions.length > active.length },
    retryScan: record(retry?.retryScan) ? retry.retryScan : unknownRetryScan(),
  });
}

export function projectFleetConveyorObservationV1(conveyor = {}) {
  const retry = record(conveyor?.retryAdmission) ? conveyor.retryAdmission : null;
  const admission = record(conveyor?.elasticAdmission) ? conveyor.elasticAdmission : null;
  const heldArrays = [admission?.held, conveyor?.elasticIgnition?.held].filter(Array.isArray);
  // Count observations from the two existing owners, not unique active lanes.
  const heldCount = heldArrays.reduce((total, rows) => total + rows.length, 0);
  const rows = heldArrays.flatMap(values => values.slice(0, FLEET_SUPERVISOR_HELD_LIMIT))
    .slice(0, FLEET_SUPERVISOR_HELD_LIMIT);
  const missionDiagnostics = observeMissionDiagnostics(retry, admission);
  return Object.freeze({
    ...(missionDiagnostics ? { missionDiagnostics } : {}),
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
  // Optional observations never become terminal or custody authority. Old v1
  // receipts remain valid; malformed optional detail becomes unavailable.
  const missionDiagnostics = projectMissionDiagnostics(value.missionDiagnostics);
  return Object.freeze({
    schemaVersion: FLEET_SUPERVISOR_SCHEMA,
    ok: value.ok,
    finalVerdict: value.finalVerdict,
    blockerCode,
    ...(missionDiagnostics ? { missionDiagnostics } : {}),
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
  let missionDiagnostics = projected.missionDiagnostics;
  if (missionDiagnostics && missionDiagnostics.detailsOmitted !== true) {
    const stored = missionDiagnostics.storedMissions, scan = missionDiagnostics.retryScan;
    if (heldLimit === 0) {
      missionDiagnostics = projectMissionDiagnostics({ detailsOmitted: true,
        active: stored.activeCount, records: scan.recordCount, candidates: scan.candidateCount,
        evaluated: scan.evaluatedCount, issue: RECOVERY_ISSUE, matches: scan.recovery.matchCount,
        gate: scan.recovery.gateCode,
      });
    } else {
      const active = stored.active.slice(0, Math.min(heldLimit, FLEET_SUPERVISOR_ACTIVE_LIMIT));
      const retryReasons = scan.reasons.slice(0, heldLimit);
      missionDiagnostics = projectMissionDiagnostics({ persistedStateOnly: true,
        storedMissions: { ...stored, active, truncated: stored.activeCount !== null && stored.activeCount > active.length },
        retryScan: { ...scan, reasons: retryReasons, truncated: scan.candidateCount !== null && scan.candidateCount > retryReasons.length },
      });
    }
  }
  const { missionDiagnostics: _originalDiagnostics, ...core } = projected;
  return Object.freeze({ ...core,
    ...(missionDiagnostics ? { missionDiagnostics } : {}), held: Object.freeze({
    count: projected.held.count, reasons,
    truncated: projected.held.count !== null && projected.held.count > reasons.length,
  }) });
}
