export const BATTLE_BRIDGE_TELEMETRY_AUTOREPAIR_SCHEMA = 'stephanos.battle-bridge-telemetry-autorepair.v1';

const SHA40 = /^[0-9a-f]{40}$/;

const SURFACE_POLICY = Object.freeze({
  githubSync: Object.freeze({
    requiredForCompleteState: true,
    proofClass: 'SOURCE_HEARTBEAT',
    repairRoute: 'GITHUB_SYNC_OBSERVATION',
    consequentialRepair: false,
  }),
  postSyncRefresh: Object.freeze({
    requiredForCompleteState: true,
    proofClass: 'SOURCE_BOUND_EVENT_PROOF',
    repairRoute: 'POST_SYNC_REFRESH',
    consequentialRepair: true,
  }),
  ignition: Object.freeze({
    requiredForCompleteState: true,
    proofClass: 'RUNTIME_ACCEPTANCE',
    repairRoute: 'IGNITION',
    consequentialRepair: true,
  }),
  battleBridge: Object.freeze({
    requiredForCompleteState: true,
    proofClass: 'LIVE_SERVICE_HEALTH',
    repairRoute: 'BATTLE_BRIDGE_READ_ONLY_REFRESH',
    consequentialRepair: false,
  }),
  recoveryMesh: Object.freeze({
    requiredForCompleteState: true,
    proofClass: 'CONTROL_PLANE_HEARTBEAT',
    repairRoute: 'RECOVERY_MESH_RECONCILIATION',
    consequentialRepair: true,
  }),
  mailbox: Object.freeze({
    requiredForCompleteState: true,
    proofClass: 'CONTROL_PLANE_INGRESS',
    repairRoute: 'MAILBOX_PROOF_REFRESH',
    consequentialRepair: false,
  }),
  missionWorker: Object.freeze({
    requiredForCompleteState: true,
    proofClass: 'WORKER_HEARTBEAT',
    repairRoute: 'MISSION_WORKER_RECONCILIATION',
    consequentialRepair: true,
  }),
});

function text(value, limit = 180) {
  const normalized = String(value ?? '').trim();
  return normalized.length > limit ? normalized.slice(0, limit) : normalized;
}

function validHead(value) {
  const normalized = text(value, 40).toLowerCase();
  return SHA40.test(normalized) ? normalized : '';
}

function normalizedState(surface = {}) {
  return text(surface.state || 'UNKNOWN', 120).toUpperCase();
}

function isBadState(state) {
  return state === 'STALE'
    || state === 'UNKNOWN'
    || state === 'UNPROVEN'
    || state.includes('BLOCK')
    || state.includes('FAIL')
    || state.includes('ERROR');
}

function classifyGap({ surface, sourceHead, policy }) {
  const state = normalizedState(surface);
  const head = validHead(surface.head);
  const exactHead = validHead(sourceHead);
  const headMismatch = Boolean(head && exactHead && head !== exactHead);

  if (headMismatch) {
    return Object.freeze({
      gapClass: 'EXACT_HEAD_MISMATCH',
      state,
      head,
      blocker: `Observed ${surface.id} proof is bound to a different source head.`,
    });
  }

  if (state === 'STALE' && policy.proofClass === 'SOURCE_BOUND_EVENT_PROOF' && head && head === exactHead) {
    return Object.freeze({
      gapClass: 'NONE',
      state: 'CURRENT_EXACT_HEAD_EVENT_PROOF',
      head,
      blocker: '',
    });
  }

  if (state === 'STALE') {
    return Object.freeze({ gapClass: 'STALE_EVIDENCE', state, head, blocker: text(surface.blocker || 'Evidence freshness expired.') });
  }
  if (state === 'UNKNOWN' || state === 'UNPROVEN') {
    return Object.freeze({ gapClass: 'MISSING_OR_UNPROVEN_EVIDENCE', state, head, blocker: text(surface.blocker || state) });
  }
  if (state.includes('BLOCK') || state.includes('FAIL') || state.includes('ERROR')) {
    return Object.freeze({ gapClass: 'OBSERVED_FAILURE_OR_BLOCKER', state, head, blocker: text(surface.blocker || state) });
  }
  return Object.freeze({ gapClass: 'NONE', state, head, blocker: '' });
}

function buildRepairCandidate(surface, gap, policy) {
  if (gap.gapClass === 'NONE') return null;
  const consequential = policy.consequentialRepair === true;
  return Object.freeze({
    surfaceId: surface.id,
    gapClass: gap.gapClass,
    observedState: gap.state,
    observedHead: gap.head,
    blocker: gap.blocker,
    repairRoute: policy.repairRoute,
    proofClass: policy.proofClass,
    repairDisposition: consequential ? 'EXACT_INTERACTIVE_AUTHORIZATION_REQUIRED' : 'SAFE_AUTOMATIC_DIAGNOSIS_OR_PROOF_REFRESH',
    operatorAuthorizationState: consequential ? 'OPERATOR_AUTHORIZATION_NOT_PRESENT' : 'NOT_REQUIRED_FOR_READ_ONLY_DIAGNOSIS',
    sourceMutationAllowedByThisRecord: false,
    runtimeMutationAllowedByThisRecord: false,
  });
}

export function buildBattleBridgeTelemetryAutorepairProjection({ sourceHead = '', surfaces = [] } = {}) {
  const exactHead = validHead(sourceHead);
  if (!exactHead) throw new Error('BATTLE_BRIDGE_TELEMETRY_SOURCE_HEAD_INVALID');

  const byId = new Map((Array.isArray(surfaces) ? surfaces : []).map((surface) => [surface?.id, surface]));
  const coverage = [];
  const repairCandidates = [];

  for (const [id, policy] of Object.entries(SURFACE_POLICY)) {
    const surface = byId.get(id) || Object.freeze({ id, state: 'UNPROVEN', head: '', blocker: 'STATUS_MISSING' });
    const gap = classifyGap({ surface, sourceHead: exactHead, policy });
    const repair = buildRepairCandidate(surface, gap, policy);
    const answered = gap.gapClass === 'NONE';
    coverage.push(Object.freeze({
      surfaceId: id,
      requiredForCompleteState: policy.requiredForCompleteState,
      proofClass: policy.proofClass,
      answered,
      state: gap.state,
      head: gap.head,
      gapClass: gap.gapClass,
    }));
    if (repair) repairCandidates.push(repair);
  }

  const unanswered = coverage.filter((entry) => entry.requiredForCompleteState && !entry.answered);
  const consequential = repairCandidates.filter((entry) => entry.repairDisposition === 'EXACT_INTERACTIVE_AUTHORIZATION_REQUIRED');
  const safe = repairCandidates.filter((entry) => entry.repairDisposition === 'SAFE_AUTOMATIC_DIAGNOSIS_OR_PROOF_REFRESH');
  const complete = unanswered.length === 0;

  return Object.freeze({
    schemaVersion: BATTLE_BRIDGE_TELEMETRY_AUTOREPAIR_SCHEMA,
    sourceHead: exactHead,
    completeStateAnswerable: complete,
    telemetryCompleteness: complete ? 'COMPLETE' : 'PARTIAL',
    requiredSurfaceCount: coverage.filter((entry) => entry.requiredForCompleteState).length,
    answeredSurfaceCount: coverage.filter((entry) => entry.requiredForCompleteState && entry.answered).length,
    unansweredSurfaceCount: unanswered.length,
    coverage: Object.freeze(coverage),
    repairCandidates: Object.freeze(repairCandidates),
    safeAutomaticCandidateCount: safe.length,
    consequentialAuthorizationCandidateCount: consequential.length,
    operatorNeededNow: consequential.length > 0,
    operatorAuthorizationState: consequential.length > 0 ? 'OPERATOR_AUTHORIZATION_NOT_PRESENT' : 'NOT_REQUIRED_FOR_CURRENT_READ_ONLY_ACTIONS',
    nextAutomaticAction: safe.length > 0
      ? `Run the existing read-only proof/diagnostic route for ${safe[0].surfaceId} and re-evaluate the same source head.`
      : (consequential.length > 0
        ? 'Preserve the exact repair-ready state and surface one exact interactive authorization request for the highest-priority consequential repair.'
        : 'Continue passive monitoring; no repair is indicated.'),
    autonomousRepairPolicy: Object.freeze({
      diagnoseKnownGapsWithoutOperator: true,
      executeReadOnlyProofRefreshWithoutOperator: true,
      executeConsequentialRuntimeMutationWithoutExactAuthorization: false,
      createOrReuseCanonicalSourceRepairForTelemetryDefect: true,
      duplicateRepairLaneAllowed: false,
      arbitraryShellAllowed: false,
      destructiveGitAllowed: false,
      selfApprovalAllowed: false,
      authorityWideningAllowed: false,
    }),
    finalVerdict: complete ? 'BATTLE_BRIDGE_COMPLETE_STATE_ANSWERABLE' : 'BATTLE_BRIDGE_TELEMETRY_GAPS_REQUIRE_REPAIR_OR_PROOF',
  });
}

export function isBattleBridgeTelemetryStateHealthy(surface = {}) {
  return !isBadState(normalizedState(surface));
}
