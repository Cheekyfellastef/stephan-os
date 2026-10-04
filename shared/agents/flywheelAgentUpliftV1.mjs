export const FLYWHEEL_AGENT_UPLIFT_SCHEMA_V1 = 'stephanos.flywheel-agent-uplift.v1';

export const UPLIFT_DIMENSIONS_V1 = Object.freeze([
  'reasoning-quality',
  'execution-reliability',
  'proof-quality',
  'recovery-ability',
  'tool-coverage',
  'operator-intervention',
  'calibration-readiness',
]);

function text(value, fallback = '') {
  const out = String(value ?? '').trim();
  return out || fallback;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values = []) {
  return [...new Set(values.map((value) => text(value)).filter(Boolean))];
}

function countMatching(records = [], predicate = () => false) {
  return list(records).filter(predicate).length;
}

function dimension({ id, evidenceRefs = [], positiveSignals = 0, negativeSignals = 0, detail = '' } = {}) {
  const status = negativeSignals > 0
    ? 'NEEDS_UPLIFT'
    : positiveSignals > 0
      ? 'EVIDENCED'
      : 'UNKNOWN';
  return Object.freeze({
    id,
    status,
    positiveSignals,
    negativeSignals,
    evidenceRefs: Object.freeze(unique(evidenceRefs)),
    detail: text(detail),
  });
}

export function buildAgentUpliftScorecardV1(input = {}) {
  const receipts = list(input.executionReceipts);
  const calibration = input.calibration && typeof input.calibration === 'object'
    ? input.calibration
    : {};
  const gaps = list(input.capabilityGaps);
  const evidenceRefs = unique([
    ...list(input.evidenceRefs),
    ...receipts.flatMap((receipt) => list(receipt?.proofRefs)),
    ...list(calibration?.proofRefs),
  ]);

  const completed = countMatching(receipts, (r) => /complete|completed|proved|success/i.test(text(r?.state)));
  const failed = countMatching(receipts, (r) => /fail|blocked|stalled|error/i.test(text(r?.state)));
  const proofBacked = countMatching(receipts, (r) => list(r?.proofRefs).length > 0);
  const recovered = countMatching(receipts, (r) => /recover|reroute|retry-success|replanned/i.test(text(r?.phase) + ' ' + text(r?.state)));
  const operatorInterventions = Number.isFinite(Number(input.operatorInterventionCount))
    ? Math.max(0, Number(input.operatorInterventionCount))
    : 0;
  const calibrationVerdict = text(calibration?.verdict || calibration?.finalVerdict).toUpperCase();
  const calibrationGapCount = list(calibration?.gaps || calibration?.buildableGaps).length;
  const toolGapCount = gaps.filter((gap) => /tool|capability|verb|route|access/i.test(text(gap?.kind || gap?.type || gap))).length;

  return Object.freeze({
    schemaVersion: FLYWHEEL_AGENT_UPLIFT_SCHEMA_V1,
    participantId: text(input.participantId, 'unknown-participant'),
    missionId: text(input.missionId, 'unknown-mission'),
    dimensions: Object.freeze([
      dimension({
        id: 'reasoning-quality',
        positiveSignals: /pass|grounded|proven/i.test(calibrationVerdict) ? 1 : 0,
        negativeSignals: calibrationGapCount,
        evidenceRefs,
        detail: 'Grounded from canonical calibration evidence; no score is invented from silence.',
      }),
      dimension({
        id: 'execution-reliability',
        positiveSignals: completed,
        negativeSignals: failed,
        evidenceRefs,
        detail: 'Derived from canonical execution receipts.',
      }),
      dimension({
        id: 'proof-quality',
        positiveSignals: proofBacked,
        negativeSignals: Math.max(0, receipts.length - proofBacked),
        evidenceRefs,
        detail: 'Receipt claims without proof refs count as an uplift signal.',
      }),
      dimension({
        id: 'recovery-ability',
        positiveSignals: recovered,
        negativeSignals: Number(input.recoveryFailed === true),
        evidenceRefs,
        detail: 'Recovery is evidenced only by receipts describing reroute/replan/recovery.',
      }),
      dimension({
        id: 'tool-coverage',
        positiveSignals: gaps.length === 0 && receipts.length > 0 ? 1 : 0,
        negativeSignals: toolGapCount,
        evidenceRefs,
        detail: 'Capability/tool gaps become bounded uplift candidates, not automatic new authority.',
      }),
      dimension({
        id: 'operator-intervention',
        positiveSignals: receipts.length > 0 && operatorInterventions === 0 ? 1 : 0,
        negativeSignals: operatorInterventions,
        evidenceRefs,
        detail: 'Repeated operator rescue is treated as automation debt evidence.',
      }),
      dimension({
        id: 'calibration-readiness',
        positiveSignals: /pass|grounded|settled|proven/i.test(calibrationVerdict) ? 1 : 0,
        negativeSignals: calibrationGapCount,
        evidenceRefs,
        detail: 'Uses the existing recurring multi-agent calibration contract.',
      }),
    ]),
    evidenceRefs: Object.freeze(evidenceRefs),
  });
}

export function deriveFlywheelBrainRequestV1(input = {}) {
  const rootCauseState = text(input.rootCauseState, 'UNKNOWN').toUpperCase();
  const recurringFailureCount = Number.isFinite(Number(input.recurringFailureCount))
    ? Math.max(0, Number(input.recurringFailureCount))
    : 0;
  const capabilityGaps = list(input.capabilityGaps);
  const conflictingEvidence = input.conflictingEvidence === true;
  const novelGap = input.novelGap === true;
  const diagnosisNeeded = rootCauseState === 'UNKNOWN'
    || rootCauseState === 'CONFLICTING'
    || recurringFailureCount >= 2
    || capabilityGaps.length > 0
    || conflictingEvidence
    || novelGap;

  return Object.freeze({
    required: diagnosisNeeded,
    router: 'stephanos-model-router',
    selectionPolicy: 'router-owned-provider-neutral',
    preferredCapability: 'heavy-reasoning-and-bounded-design',
    fixedModelRequired: false,
    qwen35CanaryCompatible: true,
    routeDecision: Object.freeze({
      localReasoningTier: diagnosisNeeded ? 'deep' : 'default',
      selectedAnswerMode: diagnosisNeeded ? 'deep-local' : 'local-private',
      flywheelBrainRequestRequired: diagnosisNeeded,
      flywheelForceHeavyLocal: diagnosisNeeded,
      flywheelRootCauseState: rootCauseState,
      flywheelRecurringFailureCount: recurringFailureCount,
      flywheelCapabilityGapCount: capabilityGaps.length,
      flywheelConflictingEvidence: conflictingEvidence,
      flywheelNovelGap: novelGap,
    }),
    allowedOutputs: Object.freeze([
      'root-cause-hypotheses',
      'evidence-gaps',
      'bounded-improvement-proposal',
      'test-and-replay-plan',
      'alternative-options',
      'risk-and-rollback-notes',
    ]),
    forbiddenOutputs: Object.freeze([
      'self-granted-authority',
      'goal-creation',
      'work-dispatch',
      'source-mutation',
      'merge-or-deploy-authorization',
      'memory-auto-promotion',
      'provider-spend-or-account-action',
    ]),
    reason: diagnosisNeeded
      ? 'Evidence indicates a gap or uncertainty where bounded reasoning can improve diagnosis/design.'
      : 'Deterministic evidence is sufficient; no model call is required for this uplift turn.',
  });
}

export function buildFlywheelAgentUpliftPlanV1(input = {}) {
  const scorecard = buildAgentUpliftScorecardV1(input);
  const dimensionsNeedingUplift = scorecard.dimensions
    .filter((entry) => entry.status === 'NEEDS_UPLIFT')
    .map((entry) => entry.id);
  const brainRequest = deriveFlywheelBrainRequestV1({
    ...input,
    capabilityGaps: list(input.capabilityGaps),
  });
  const hasGap = dimensionsNeedingUplift.length > 0 || list(input.capabilityGaps).length > 0;

  return Object.freeze({
    schemaVersion: FLYWHEEL_AGENT_UPLIFT_SCHEMA_V1,
    kind: 'stephanos.flywheel.agent-uplift-plan',
    participantId: scorecard.participantId,
    missionId: scorecard.missionId,
    scorecard,
    dimensionsNeedingUplift: Object.freeze(dimensionsNeedingUplift),
    brainRequest,
    existingGoalSearchRequired: hasGap,
    calibrationReplayRequired: hasGap,
    improvementCandidate: hasGap ? Object.freeze({
      promotionState: 'CANDIDATE',
      owner: 'existing-goal-flywheel-and-governed-self-improvement',
      rootCauseState: text(input.rootCauseState, 'UNKNOWN').toUpperCase(),
      gapId: text(
        input?.capabilityGaps?.[0]?.capabilityId
          || input?.capabilityGaps?.[0]?.gapId
          || input?.capabilityGaps?.[0]?.kind
          || input?.capabilityGaps?.[0]?.summary
          || (typeof input?.capabilityGaps?.[0] === 'string' ? input.capabilityGaps[0] : ''),
        `agent-uplift-${scorecard.participantId}`,
      ),
      capabilityGaps: Object.freeze(unique(list(input.capabilityGaps).map((gap) => (
        typeof gap === 'string' ? gap : gap?.summary || gap?.kind || gap?.type
      )))),
      evidenceRefs: scorecard.evidenceRefs,
      requiresExistingGoalSearch: true,
      repairReplayRequired: true,
      brainRequest,
      executionHandoff: Object.freeze({
        route: 'canonical-flywheel-learning-goal-bridge',
        canonicalGoalAdmissionEligible: true,
        directDispatchAllowed: false,
        directSourceMutationAllowed: false,
        directRuntimeMutationAllowed: false,
        mergeAllowed: false,
      }),
      nextAction: brainRequest.required
        ? 'Request deep bounded diagnosis/design through the Stephanos model router, then reuse or admit the canonical goal and replay proof.'
        : 'Search existing goals and replay the affected capability through canonical calibration/proof machinery.',
    }) : null,
    authority: Object.freeze({
      goalCreationAllowed: false,
      dispatchAllowed: false,
      sourceMutationAllowed: false,
      mergeAllowed: false,
      deploymentAllowed: false,
      runtimeMutationAllowed: false,
      memoryPromotionAllowed: false,
      authorityWideningAllowed: false,
    }),
    finalVerdict: hasGap
      ? 'FLYWHEEL_AGENT_UPLIFT_CANDIDATE_READY'
      : 'FLYWHEEL_AGENT_UPLIFT_NO_GAP_EVIDENCED',
  });
}
