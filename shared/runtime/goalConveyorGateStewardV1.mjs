// One gate steward inside the existing single-owner Core. This policy is a
// pure, fail-closed planner. It MUST NOT grant or execute leases/approvals.
export const GOAL_GATE_STEWARD_SCHEMA_V1 = 'stephanos.goal-conveyor-gate-steward.v1';
export const GOAL_GATE_EVIDENCE_SCHEMA_V1 = 'stephanos.goal-build-gate-observation.v1';
export const SAFE_GATE_ACTIONS_V1 = Object.freeze({
  7: { action: 'OBSERVE_PROGRAMME_AUTHORITY', authority: 'programme-authority', mode: 'READ_ONLY' },
  8: { action: 'REQUEST_ORIGINAL_WRITER_CUSTODY_WITNESS', authority: 'independent-windows-custody', mode: 'QUALIFIED_EVIDENCE_REQUIRED' },
  9: { action: 'REQUEST_ORIGINAL_EXECUTION_RECEIPT', authority: 'original-writer-ledger', mode: 'QUALIFIED_EVIDENCE_REQUIRED' },
  10: { action: 'REQUEST_SIGNED_OS_EXCLUSION_WITNESS', authority: 'independent-windows-custody', mode: 'QUALIFIED_EVIDENCE_REQUIRED' },
  11: { action: 'REQUEST_PROTECTED_QUARANTINE_APPROVAL', authority: 'protected-operator', mode: 'OPERATOR_REQUIRED' },
  13: { action: 'RECHECK_SIGNED_NATIVE_PUBLISHER', authority: 'native-capacity-publisher', mode: 'READ_ONLY' },
});
const SAFE_REASON = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,159}$/;
const HEAD = /^[a-f0-9]{40}$/;

export function projectCoreGateEvidenceV1({
  sourceHead = '', observedAtUtc = '', state = {}, refillSummary = {},
  lastRepairBlocker = '', lastRepairSourceHead = '', nativeRouting = null,
} = {}) {
  if (!HEAD.test(sourceHead) || !Number.isFinite(Date.parse(observedAtUtc))) {
    return Object.freeze({ ok: false, blocker: 'GATE_STEWARD_SOURCE_UNVERIFIED', evidence: null });
  }
  const evidence = [];
  const proof = (id, status, ref, typedBlocker = '') => {
    if (status === 'FAIL' && !SAFE_REASON.test(typedBlocker)) return;
    evidence.push(Object.freeze({
      id, status, proofRef: ref, sourceHead, observedAtUtc,
      ...(typedBlocker ? { typedBlocker } : {}),
    }));
  };
  if (state?.daemonHealthy === true && state?.missionWorkerHealthy === true &&
    state?.sovereignCommanderHealthy === true && state?.backendHealthy === true) {
    proof(3, 'PASS', 'workspace:status/stephanos-core-daemon-current.json');
  }
  if (refillSummary?.refillCanonicalProgrammeHeld === true &&
    typeof refillSummary?.refillCanonicalProgrammeBlockerIdentity === 'string' &&
    refillSummary.refillCanonicalProgrammeBlockerIdentity.includes('elastic-lease-expired-or-not-active')) {
    proof(7, 'FAIL', 'workspace:status/stephanos-core-daemon-current.json', 'LANE:ELASTIC-LEASE-EXPIRED-OR-NOT-ACTIVE');
    // This authoritatively confirms the expired source lease symptom, but
    // cannot establish physical custody or approval to release it.
    proof(8, 'FAIL', 'workspace:status/stephanos-core-daemon-current.json', 'ELASTIC_LEASE_EXPIRED_OR_NOT_ACTIVE');
  }
  if (sourceHead === lastRepairSourceHead && [
    'REPAIR_ORIGINAL_EXECUTION_RECEIPT_MISSING',
    'REPAIR_ORIGINAL_TERMINAL_SOURCE_BINDING_UNPROVEN',
  ].includes(lastRepairBlocker)) {
    proof(9, 'FAIL', 'workspace:status/stephanos-core-daemon-current.json', lastRepairBlocker);
  }
  if (nativeRouting?.ok === true && nativeRouting?.candidate?.sourceHead === sourceHead) {
    proof(13, 'PASS', 'workspace:status/stephanos-native-capacity-current.json');
  } else {
    const code = String(nativeRouting?.reason || '');
    if (SAFE_REASON.test(code) && code !== 'STEPHANOS_NATIVE_ROUTING_IDENTITY_INVALID') {
      proof(13, 'FAIL', 'workspace:status/stephanos-native-capacity-current.json', code.slice(0, 160));
    }
  }
  return Object.freeze({
    ok: true, blocker: '',
    evidence: Object.freeze({
      schemaVersion: GOAL_GATE_EVIDENCE_SCHEMA_V1,
      sourceHead, observedAtUtc, gates: Object.freeze(evidence),
    }),
  });
}

export function planCoreGateStewardV1(observatory = {}, {
  previousActionKey = '', previousAttemptAtMs = null, nowMs = Date.now(),
  minRetryMs = 60 * 60_000, gamingProtected = false,
} = {}) {
  const failures = Array.isArray(observatory.gates)
    ? observatory.gates.filter(g => g?.status === 'FAIL') : [];
  const actions = failures.map(gate => {
    const policy = SAFE_GATE_ACTIONS_V1[gate.id];
    return policy ? Object.freeze({
      gateId: gate.id, reason: gate.typedBlocker || 'GATE_EVIDENCE_BLOCKED',
      ...policy, proofRef: gate.proofRef || '',
    }) : null;
  }).filter(Boolean);
  const priority = actions.find(a => a.gateId === 8)
    || actions.find(a => a.gateId === 13)
    || actions[0] || null;
  const key = priority ? [observatory.sourceHead, priority.gateId, priority.reason].join(':') : '';
  const repeat = key && previousActionKey === key
    && Number.isFinite(previousAttemptAtMs) && nowMs - previousAttemptAtMs < minRetryMs;
  return Object.freeze({
    schemaVersion: GOAL_GATE_STEWARD_SCHEMA_V1,
    owner: 'EXISTING_STEPhANOS_CORE_DAEMON',
    mode: 'SHADOW_READ_ONLY',
    observedHead: HEAD.test(observatory?.sourceHead || '') ? observatory.sourceHead : '',
    gateCount: 23,
    failedGateIds: Object.freeze(failures.map(g => g.id)),
    proposals: Object.freeze(actions),
    nextAction: priority && !gamingProtected && !repeat ? priority : null,
    decision: gamingProtected ? 'GAMING_PROTECTED'
      : !priority ? 'AWAIT_FRESH_GATE_PROOF'
        : repeat ? 'SAME_EVIDENCE_COOLDOWN'
          : 'PROPOSE_EXISTING_AUTHORITY_ACTION',
    proofKey: key,
    retryAfterMs: repeat ? Math.max(0, minRetryMs - (nowMs - previousAttemptAtMs)) : 0,
    autoExecuteAllowed: false,
    approvalAuthority: false,
    mergeAuthority: false,
    sourceMutationAllowed: false,
    leaseOverrideAllowed: false,
    duplicateControllerAllowed: false,
  });
}
