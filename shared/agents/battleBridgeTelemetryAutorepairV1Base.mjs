export const BATTLE_BRIDGE_TELEMETRY_AUTOREPAIR_SCHEMA = 'stephanos.battle-bridge-telemetry-autorepair.v1';
export const BATTLE_BRIDGE_EXECUTIVE_STATE_SCHEMA = 'stephanos.battle-bridge-executive-state.v1';

const SHA40 = /^[0-9a-f]{40}$/;
const SOURCE_BOUND_EVENT_SUCCESS_STATES = Object.freeze([
  'REFRESH_COMPLETE',
  'NO_RUNTIME_REFRESH_REQUIRED',
  'POST_SYNC_RUNTIME_REFRESH_PASS',
]);

export const BATTLE_BRIDGE_EXECUTIVE_QUESTION_CLASSES = Object.freeze([
  'SOURCE_IDENTITY',
  'SOURCE_DIRT_AND_HOUSEKEEPER',
  'DELIVERY_AND_RUNTIME_HEADS',
  'BACKEND_HEALTH',
  'UI_HEALTH',
  'OPENCLAW_HEALTH',
  'SHARED_WORKSPACE_HEALTH',
  'POST_SYNC_REFRESH_HEALTH',
  'IGNITION_HEALTH',
  'RECOVERY_MESH_HEALTH',
  'MAILBOX_HEALTH',
  'MISSION_WORKER_HEALTH',
  'PROACTIVE_REPAIR_DECISION',
]);

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

const SERVICE_QUESTION_POLICY = Object.freeze({
  BACKEND_HEALTH: Object.freeze({ aliases: ['backend', 'backend8787'], repairRoute: 'BACKEND_8787_RECONCILIATION', targetIds: ['backend'] }),
  UI_HEALTH: Object.freeze({ aliases: ['stephanos-ui', 'ui4173', 'ui'], repairRoute: 'UI_4173_RECONCILIATION', targetIds: ['stephanos-ui'] }),
  OPENCLAW_HEALTH: Object.freeze({ aliases: ['openclaw-gateway', 'openclaw'], repairRoute: 'OPENCLAW_RUNTIME_RECONCILIATION', targetIds: ['openclaw-gateway'] }),
  SHARED_WORKSPACE_HEALTH: Object.freeze({ aliases: ['shared-workspace', 'sharedWorkspace'], repairRoute: 'SHARED_WORKSPACE_PROOF_REFRESH', targetIds: ['shared-workspace'], readOnlyRepair: true }),
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

function normalizedRawState(surface = {}) {
  return text(surface.rawState || surface.state || 'UNKNOWN', 120).toUpperCase();
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
  const rawState = normalizedRawState(surface);
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
    if (SOURCE_BOUND_EVENT_SUCCESS_STATES.includes(rawState)) {
      return Object.freeze({
        gapClass: 'NONE',
        state: 'CURRENT_EXACT_HEAD_EVENT_PROOF',
        head,
        blocker: '',
      });
    }
    if (rawState === 'APPROVAL_REQUIRED_OPENCLAW'
        || rawState.includes('BLOCK')
        || rawState.includes('FAIL')
        || rawState.includes('ERROR')) {
      return Object.freeze({
        gapClass: 'OBSERVED_FAILURE_OR_BLOCKER',
        state: rawState,
        head,
        blocker: text(surface.blocker || rawState),
      });
    }
    return Object.freeze({
      gapClass: 'STALE_EVIDENCE',
      state: rawState,
      head,
      blocker: text(surface.blocker || `Current-head source-bound event is not terminal-success proof: ${rawState}`),
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

function frozenQuestion(questionClass, values = {}) {
  return Object.freeze({
    questionClass,
    answered: values.answered === true,
    state: text(values.state || (values.answered ? 'READY' : 'UNPROVEN'), 120).toUpperCase(),
    blocker: text(values.blocker || '', 180),
    nextAutomaticAction: text(values.nextAutomaticAction || (values.answered ? 'NONE' : 'READ_ONLY_DIAGNOSIS'), 120).toUpperCase(),
    authorityClass: text(values.authorityClass || 'NONE', 120).toUpperCase(),
    repairRoute: text(values.repairRoute || '', 120).toUpperCase(),
    targetIds: Object.freeze(Array.isArray(values.targetIds) ? values.targetIds.map((value) => text(value, 80)).filter(Boolean) : []),
    evidence: Object.freeze(values.evidence && typeof values.evidence === 'object' ? values.evidence : {}),
  });
}

function mergeServiceFacts(surfaces = []) {
  const merged = {};
  for (const surface of surfaces) {
    const facts = surface?.serviceFacts;
    if (!facts || typeof facts !== 'object' || Array.isArray(facts)) continue;
    for (const [id, fact] of Object.entries(facts)) {
      if (!fact || typeof fact !== 'object' || Array.isArray(fact)) continue;
      merged[id] = Object.freeze({
        ready: fact.ready === true,
        state: text(fact.state || '', 80).toUpperCase(),
        head: validHead(fact.head),
      });
    }
  }
  return Object.freeze(merged);
}

function findServiceFact(serviceFacts, aliases) {
  for (const alias of aliases) {
    if (serviceFacts[alias]) return Object.freeze({ id: alias, ...serviceFacts[alias] });
  }
  return null;
}

function sourceIdentityQuestion(exactHead, syncSurface) {
  const syncHead = validHead(syncSurface?.head);
  const state = normalizedState(syncSurface || {});
  if (!syncSurface || !syncHead) {
    return frozenQuestion('SOURCE_IDENTITY', {
      state: 'UNPROVEN', blocker: 'SOURCE_IDENTITY_PROOF_MISSING', nextAutomaticAction: 'READ_ONLY_DIAGNOSIS',
      evidence: { sourceHead: exactHead, observedHead: syncHead },
    });
  }
  if (syncHead !== exactHead) {
    return frozenQuestion('SOURCE_IDENTITY', {
      state: 'BLOCKED', blocker: 'SOURCE_IDENTITY_EXACT_HEAD_MISMATCH', nextAutomaticAction: 'READ_ONLY_DIAGNOSIS',
      evidence: { sourceHead: exactHead, observedHead: syncHead },
    });
  }
  if (isBadState(state)) {
    return frozenQuestion('SOURCE_IDENTITY', {
      state, blocker: text(syncSurface.blocker || 'SOURCE_SYNC_NOT_HEALTHY'), nextAutomaticAction: 'READ_ONLY_DIAGNOSIS',
      evidence: { sourceHead: exactHead, observedHead: syncHead },
    });
  }
  return frozenQuestion('SOURCE_IDENTITY', { answered: true, state, evidence: { sourceHead: exactHead, observedHead: syncHead } });
}

function sourceDirtHousekeeperQuestion(exactHead, syncSurface) {
  const dirt = syncSurface?.dirtFacts && typeof syncSurface.dirtFacts === 'object' ? syncSurface.dirtFacts : {};
  const housekeeper = syncSurface?.housekeeperFacts && typeof syncSurface.housekeeperFacts === 'object' ? syncSurface.housekeeperFacts : {};
  if (dirt.known !== true) {
    return frozenQuestion('SOURCE_DIRT_AND_HOUSEKEEPER', {
      state: 'UNPROVEN', blocker: 'SOURCE_DIRT_TELEMETRY_MISSING', nextAutomaticAction: 'CANONICAL_SOURCE_TELEMETRY_REPAIR', repairRoute: 'BATTLE_BRIDGE_TELEMETRY_SOURCE_REPAIR',
      evidence: { dirtKnown: false, housekeeperObserved: housekeeper.observed === true },
    });
  }
  if (dirt.blocksSync === true) {
    return frozenQuestion('SOURCE_DIRT_AND_HOUSEKEEPER', {
      state: 'BLOCKED', blocker: 'SOURCE_DIRT_BLOCKS_SYNC', nextAutomaticAction: 'READ_ONLY_DIAGNOSIS',
      evidence: { dirtKnown: true, blocksSync: true, blockingCount: Number(dirt.blockingCount || 0), housekeeperObserved: housekeeper.observed === true },
    });
  }
  if (housekeeper.observed !== true) {
    return frozenQuestion('SOURCE_DIRT_AND_HOUSEKEEPER', {
      state: 'UNPROVEN', blocker: 'HOUSEKEEPER_CYCLE_TELEMETRY_MISSING', nextAutomaticAction: 'CANONICAL_SOURCE_TELEMETRY_REPAIR', repairRoute: 'HOUSEKEEPER_TELEMETRY_SOURCE_REPAIR',
      evidence: { dirtKnown: true, blocksSync: false, housekeeperObserved: false },
    });
  }
  const housekeeperHead = validHead(housekeeper.head);
  if (housekeeperHead !== exactHead) {
    return frozenQuestion('SOURCE_DIRT_AND_HOUSEKEEPER', {
      state: 'BLOCKED', blocker: 'HOUSEKEEPER_EXACT_HEAD_MISMATCH', nextAutomaticAction: 'READ_ONLY_DIAGNOSIS',
      evidence: { dirtKnown: true, blocksSync: false, housekeeperObserved: true, housekeeperHead },
    });
  }
  const housekeeperState = text(housekeeper.state || 'UNKNOWN', 80).toUpperCase();
  if (isBadState(housekeeperState)) {
    return frozenQuestion('SOURCE_DIRT_AND_HOUSEKEEPER', {
      state: housekeeperState, blocker: text(housekeeper.blocker || 'HOUSEKEEPER_BLOCKED'), nextAutomaticAction: 'READ_ONLY_DIAGNOSIS',
      evidence: { dirtKnown: true, blocksSync: false, housekeeperObserved: true, housekeeperHead },
    });
  }
  return frozenQuestion('SOURCE_DIRT_AND_HOUSEKEEPER', {
    answered: true, state: housekeeperState, evidence: { dirtKnown: true, blocksSync: false, housekeeperObserved: true, housekeeperHead },
  });
}

function runtimeHeadsQuestion(exactHead, surfaces) {
  const candidates = surfaces.map((surface) => surface?.runtimeHeads).filter((value) => value && typeof value === 'object');
  const merged = Object.assign({}, ...candidates);
  const heads = Object.freeze({
    sourceHead: exactHead,
    builtHead: validHead(merged.builtHead),
    servedHead: validHead(merged.servedHead),
    runtimeHead: validHead(merged.runtimeHead),
  });
  const missing = ['builtHead', 'servedHead', 'runtimeHead'].filter((key) => !heads[key]);
  if (missing.length > 0) {
    return frozenQuestion('DELIVERY_AND_RUNTIME_HEADS', {
      state: 'UNPROVEN', blocker: 'DELIVERY_RUNTIME_HEAD_PROOF_MISSING', nextAutomaticAction: 'READ_ONLY_EXACT_HEAD_PROOF_REFRESH', repairRoute: 'EXACT_RUNTIME_PROOF_REFRESH',
      evidence: { ...heads, missingHeadClasses: Object.freeze(missing) },
    });
  }
  const mismatched = ['builtHead', 'servedHead', 'runtimeHead'].filter((key) => heads[key] !== exactHead);
  if (mismatched.length > 0) {
    return frozenQuestion('DELIVERY_AND_RUNTIME_HEADS', {
      state: 'BLOCKED', blocker: 'DELIVERY_RUNTIME_EXACT_HEAD_MISMATCH', nextAutomaticAction: 'READ_ONLY_DIAGNOSIS',
      evidence: { ...heads, mismatchedHeadClasses: Object.freeze(mismatched) },
    });
  }
  return frozenQuestion('DELIVERY_AND_RUNTIME_HEADS', { answered: true, state: 'EXACT_HEAD_PROVEN', evidence: heads });
}

function serviceHealthQuestion(questionClass, exactHead, serviceFacts) {
  const policy = SERVICE_QUESTION_POLICY[questionClass];
  const fact = findServiceFact(serviceFacts, policy.aliases);
  if (!fact) {
    return frozenQuestion(questionClass, {
      state: 'UNPROVEN', blocker: `${questionClass}_TELEMETRY_MISSING`, nextAutomaticAction: 'CANONICAL_SOURCE_TELEMETRY_REPAIR', repairRoute: 'BATTLE_BRIDGE_TELEMETRY_SOURCE_REPAIR', targetIds: policy.targetIds,
    });
  }
  if (!fact.head) {
    return frozenQuestion(questionClass, {
      state: fact.state || (fact.ready ? 'READY' : 'UNPROVEN'), blocker: `${questionClass}_EXACT_HEAD_PROOF_MISSING`, nextAutomaticAction: 'READ_ONLY_EXACT_HEAD_PROOF_REFRESH', repairRoute: 'EXACT_RUNTIME_PROOF_REFRESH', targetIds: policy.targetIds,
      evidence: { serviceId: fact.id, ready: fact.ready, head: '' },
    });
  }
  if (fact.head !== exactHead) {
    return frozenQuestion(questionClass, {
      state: 'BLOCKED', blocker: `${questionClass}_EXACT_HEAD_MISMATCH`, nextAutomaticAction: 'READ_ONLY_DIAGNOSIS', repairRoute: policy.repairRoute, targetIds: policy.targetIds,
      evidence: { serviceId: fact.id, ready: fact.ready, head: fact.head },
    });
  }
  if (fact.ready !== true || isBadState(fact.state || 'UNKNOWN')) {
    return frozenQuestion(questionClass, {
      state: fact.state || 'DEGRADED', blocker: `${questionClass}_NOT_READY`, nextAutomaticAction: policy.readOnlyRepair ? 'READ_ONLY_DIAGNOSIS' : 'EXACT_INTERACTIVE_AUTHORIZATION_REQUIRED',
      authorityClass: policy.readOnlyRepair ? 'NONE' : 'EXACT_RUNTIME_AUTHORIZATION', repairRoute: policy.repairRoute, targetIds: policy.targetIds,
      evidence: { serviceId: fact.id, ready: fact.ready, head: fact.head },
    });
  }
  return frozenQuestion(questionClass, { answered: true, state: fact.state || 'READY', evidence: { serviceId: fact.id, ready: true, head: fact.head } });
}

function surfaceQuestion(questionClass, surfaceId, coverageById, repairById) {
  const coverage = coverageById.get(surfaceId);
  const repair = repairById.get(surfaceId);
  if (coverage?.answered) {
    return frozenQuestion(questionClass, { answered: true, state: coverage.state, evidence: { surfaceId, head: coverage.head } });
  }
  return frozenQuestion(questionClass, {
    state: coverage?.state || 'UNPROVEN', blocker: repair?.blocker || `${questionClass}_UNPROVEN`,
    nextAutomaticAction: repair?.repairDisposition === 'EXACT_INTERACTIVE_AUTHORIZATION_REQUIRED' ? 'EXACT_INTERACTIVE_AUTHORIZATION_REQUIRED' : 'READ_ONLY_DIAGNOSIS',
    authorityClass: repair?.repairDisposition === 'EXACT_INTERACTIVE_AUTHORIZATION_REQUIRED' ? 'EXACT_RUNTIME_AUTHORIZATION' : 'NONE',
    repairRoute: repair?.repairRoute || '', targetIds: [surfaceId], evidence: { surfaceId, head: coverage?.head || '' },
  });
}

function policyMatches(policy, candidate, exactHead) {
  if (!policy || typeof policy !== 'object') return false;
  if (policy.reviewed !== true || policy.fixedCommand !== true || policy.reversible !== true || policy.operatorNeeded !== false) return false;
  if (policy.authorityWideningAllowed === true) return false;
  if (validHead(policy.exactHead) !== exactHead) return false;
  if (text(policy.repairRoute, 120).toUpperCase() !== candidate.repairRoute) return false;
  const expectedTargets = [...candidate.targetIds].sort();
  const policyTargets = (Array.isArray(policy.targetIds) ? policy.targetIds : []).map((value) => text(value, 80)).filter(Boolean).sort();
  if (expectedTargets.length !== policyTargets.length || expectedTargets.some((value, index) => value !== policyTargets[index])) return false;
  return Boolean(text(policy.policyId, 120));
}

function proactiveDecisionQuestion(exactHead, questions, qualifiedRepairPolicies) {
  const unresolved = questions.filter((question) => !question.answered);
  if (unresolved.length === 0) {
    return frozenQuestion('PROACTIVE_REPAIR_DECISION', { answered: true, state: 'NO_REPAIR_INDICATED', evidence: { candidateCount: 0 } });
  }

  const sourceRepair = unresolved.find((question) => question.nextAutomaticAction === 'CANONICAL_SOURCE_TELEMETRY_REPAIR');
  if (sourceRepair) {
    return frozenQuestion('PROACTIVE_REPAIR_DECISION', {
      answered: true, state: 'SOURCE_REPAIR_CANDIDATE', nextAutomaticAction: 'CANONICAL_SOURCE_TELEMETRY_REPAIR', repairRoute: sourceRepair.repairRoute, targetIds: sourceRepair.targetIds,
      evidence: { candidateQuestionClass: sourceRepair.questionClass, blocker: sourceRepair.blocker },
    });
  }

  const readOnlyProof = unresolved.find((question) => question.nextAutomaticAction === 'READ_ONLY_EXACT_HEAD_PROOF_REFRESH');
  if (readOnlyProof) {
    return frozenQuestion('PROACTIVE_REPAIR_DECISION', {
      answered: true, state: 'READ_ONLY_PROOF_REFRESH_CANDIDATE', nextAutomaticAction: 'READ_ONLY_EXACT_HEAD_PROOF_REFRESH', repairRoute: readOnlyProof.repairRoute, targetIds: readOnlyProof.targetIds,
      evidence: { candidateQuestionClass: readOnlyProof.questionClass, blocker: readOnlyProof.blocker },
    });
  }

  const consequential = unresolved.find((question) => question.nextAutomaticAction === 'EXACT_INTERACTIVE_AUTHORIZATION_REQUIRED');
  if (consequential) {
    const matchedPolicy = (Array.isArray(qualifiedRepairPolicies) ? qualifiedRepairPolicies : []).find((policy) => policyMatches(policy, consequential, exactHead));
    if (matchedPolicy) {
      return frozenQuestion('PROACTIVE_REPAIR_DECISION', {
        answered: true, state: 'QUALIFIED_FIXED_SELF_HEAL_ELIGIBLE', nextAutomaticAction: 'QUALIFIED_FIXED_SELF_HEAL', repairRoute: consequential.repairRoute, targetIds: consequential.targetIds,
        evidence: { candidateQuestionClass: consequential.questionClass, blocker: consequential.blocker, policyId: text(matchedPolicy.policyId, 120) },
      });
    }
    return frozenQuestion('PROACTIVE_REPAIR_DECISION', {
      answered: true, state: 'OPERATOR_AUTHORIZATION_REQUIRED', nextAutomaticAction: 'EXACT_INTERACTIVE_AUTHORIZATION_REQUIRED', authorityClass: 'EXACT_RUNTIME_AUTHORIZATION', repairRoute: consequential.repairRoute, targetIds: consequential.targetIds,
      evidence: { candidateQuestionClass: consequential.questionClass, blocker: consequential.blocker },
    });
  }

  const diagnose = unresolved[0];
  return frozenQuestion('PROACTIVE_REPAIR_DECISION', {
    answered: true, state: 'SAFE_DIAGNOSIS_CANDIDATE', nextAutomaticAction: 'READ_ONLY_DIAGNOSIS', repairRoute: diagnose.repairRoute, targetIds: diagnose.targetIds,
    evidence: { candidateQuestionClass: diagnose.questionClass, blocker: diagnose.blocker },
  });
}

export function buildBattleBridgeExecutiveStateProjection({ sourceHead = '', surfaces = [], coverage = [], repairCandidates = [], qualifiedRepairPolicies = [] } = {}) {
  const exactHead = validHead(sourceHead);
  if (!exactHead) throw new Error('BATTLE_BRIDGE_EXECUTIVE_SOURCE_HEAD_INVALID');
  const safeSurfaces = Array.isArray(surfaces) ? surfaces : [];
  const byId = new Map(safeSurfaces.map((surface) => [surface?.id, surface]));
  const coverageById = new Map((Array.isArray(coverage) ? coverage : []).map((entry) => [entry.surfaceId, entry]));
  const repairById = new Map((Array.isArray(repairCandidates) ? repairCandidates : []).map((entry) => [entry.surfaceId, entry]));
  const serviceFacts = mergeServiceFacts(safeSurfaces);

  const questions = [
    sourceIdentityQuestion(exactHead, byId.get('githubSync')),
    sourceDirtHousekeeperQuestion(exactHead, byId.get('githubSync')),
    runtimeHeadsQuestion(exactHead, safeSurfaces),
    serviceHealthQuestion('BACKEND_HEALTH', exactHead, serviceFacts),
    serviceHealthQuestion('UI_HEALTH', exactHead, serviceFacts),
    serviceHealthQuestion('OPENCLAW_HEALTH', exactHead, serviceFacts),
    serviceHealthQuestion('SHARED_WORKSPACE_HEALTH', exactHead, serviceFacts),
    surfaceQuestion('POST_SYNC_REFRESH_HEALTH', 'postSyncRefresh', coverageById, repairById),
    surfaceQuestion('IGNITION_HEALTH', 'ignition', coverageById, repairById),
    surfaceQuestion('RECOVERY_MESH_HEALTH', 'recoveryMesh', coverageById, repairById),
    surfaceQuestion('MAILBOX_HEALTH', 'mailbox', coverageById, repairById),
    surfaceQuestion('MISSION_WORKER_HEALTH', 'missionWorker', coverageById, repairById),
  ];
  const proactive = proactiveDecisionQuestion(exactHead, questions, qualifiedRepairPolicies);
  const allQuestions = Object.freeze([...questions, proactive]);
  const stateQuestions = questions;
  const complete = stateQuestions.every((question) => question.answered);
  const operatorNeeded = proactive.nextAutomaticAction === 'EXACT_INTERACTIVE_AUTHORIZATION_REQUIRED';
  const qualifiedSelfHealEligible = proactive.nextAutomaticAction === 'QUALIFIED_FIXED_SELF_HEAL';

  return Object.freeze({
    schemaVersion: BATTLE_BRIDGE_EXECUTIVE_STATE_SCHEMA,
    sourceHead: exactHead,
    questionCount: allQuestions.length,
    answeredQuestionCount: allQuestions.filter((question) => question.answered).length,
    completeStateAnswerable: complete,
    questions: allQuestions,
    nextAutomaticAction: proactive.nextAutomaticAction,
    operatorNeeded,
    operatorAuthorizationState: operatorNeeded ? 'OPERATOR_AUTHORIZATION_NOT_PRESENT' : 'NOT_REQUIRED_FOR_SELECTED_AUTOMATIC_ACTION',
    qualifiedSelfHealEligible,
    selectedRepairRoute: proactive.repairRoute,
    selectedTargetIds: proactive.targetIds,
    executionAuthorizedByTelemetry: false,
    repairExecutionAllowed: false,
    sourceMutationAllowedByTelemetry: false,
    runtimeMutationAllowedByTelemetry: false,
    arbitraryShellAllowed: false,
    destructiveGitAllowed: false,
    selfApprovalAllowed: false,
    authorityGrantedByTelemetry: false,
    finalVerdict: complete ? 'BATTLE_BRIDGE_EXECUTIVE_STATE_COMPLETE' : 'BATTLE_BRIDGE_EXECUTIVE_STATE_GAPS_IDENTIFIED',
  });
}

export function buildBattleBridgeTelemetryAutorepairProjection({ sourceHead = '', surfaces = [], qualifiedRepairPolicies = [] } = {}) {
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
  const surfaceTelemetryAnswerable = unanswered.length === 0;
  const executive = buildBattleBridgeExecutiveStateProjection({
    sourceHead: exactHead,
    surfaces,
    coverage,
    repairCandidates,
    qualifiedRepairPolicies,
  });
  const complete = executive.completeStateAnswerable;

  return Object.freeze({
    schemaVersion: BATTLE_BRIDGE_TELEMETRY_AUTOREPAIR_SCHEMA,
    sourceHead: exactHead,
    completeStateAnswerable: complete,
    surfaceTelemetryAnswerable,
    telemetryCompleteness: complete ? 'COMPLETE' : 'PARTIAL',
    requiredSurfaceCount: coverage.filter((entry) => entry.requiredForCompleteState).length,
    answeredSurfaceCount: coverage.filter((entry) => entry.requiredForCompleteState && entry.answered).length,
    unansweredSurfaceCount: unanswered.length,
    coverage: Object.freeze(coverage),
    repairCandidates: Object.freeze(repairCandidates),
    safeAutomaticCandidateCount: safe.length,
    consequentialAuthorizationCandidateCount: consequential.length,
    operatorNeededNow: executive.operatorNeeded,
    operatorAuthorizationState: executive.operatorAuthorizationState,
    nextAutomaticAction: executive.nextAutomaticAction,
    executive,
    autonomousRepairPolicy: Object.freeze({
      diagnoseKnownGapsWithoutOperator: true,
      executeReadOnlyProofRefreshWithoutOperator: true,
      executeConsequentialRuntimeMutationWithoutExactAuthorization: false,
      createOrReuseCanonicalSourceRepairForTelemetryDefect: true,
      executePreviouslyQualifiedFixedSelfHealThroughExistingController: true,
      telemetryCanAuthorizeExecution: false,
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