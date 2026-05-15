function asText(value, fallback = 'unknown') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

const MODE_SHAPES = {
  'merge-decision': ['merge', 'reason', 'required-proof', 'risks', 'next-action'],
  'codex-prompt': ['existing-or-new-pr', 'scope', 'forbidden-actions', 'required-tests', 'acceptance', 'report-format'],
  diagnosis: ['what-is-failing', 'evidence', 'likely-layer', 'fix-boundary', 'next-proof'],
  'mission-planning': ['current-mission', 'goal', 'phases', 'risks', 'first-bounded-step'],
  'architecture-guidance': ['current-architecture-read', 'missing-layer', 'recommended-model', 'build-order', 'guardrails'],
  'research-scouting': ['research-target', 'sources-context-needed', 'hypotheses', 'next-collection-step', 'applicability-to-stephanos'],
  'direct-answer': ['direct-answer', 'confidence-caveat', 'optional-next-action'],
  'identity-recall': ['direct-answer', 'identity-source', 'optional-next-action'],
};

export function buildResponsePlan(input = {}) {
  const warnings = [];
  const responseMode = asText(input?.chatContextPack?.recommendedResponseMode || input?.commandEnvelope?.chatContext?.responseMode || 'direct-answer', 'direct-answer');
  const requiredSections = MODE_SHAPES[responseMode] || MODE_SHAPES['direct-answer'];
  const uiRealityStatus = asText(input?.uiRealityStatus?.severity || input?.chatContextPack?.uiRealitySummary?.status || 'UNKNOWN', 'UNKNOWN');
  const proofState = input?.contextProviderSnapshot?.contextProviderProofState || input?.chatContextPack?.contextProviderProofState || {};
  const providerIdsUsed = Array.isArray(input?.chatContextPack?.contextProviderIdsUsed) ? input.chatContextPack.contextProviderIdsUsed : [];
  const canonApplied = Array.isArray(input?.chatContextPack?.relevantCanon) ? input.chatContextPack.relevantCanon.map((rule) => rule.id) : [];
  const checksKnownFail = String(proofState?.buildVerifyStatus || '').toLowerCase() === 'failed';
  const checksUnknown = !proofState || String(proofState?.buildVerifyStatus || '').trim() === '' || String(proofState?.buildVerifyStatus || '').toLowerCase() === 'unknown';
  const prEvidenceDetected = String(input?.supportSnapshotSummary?.prEvidenceInputDetected || input?.missionState?.prEvidenceInputDetected || '').toLowerCase() === 'yes';
  const distRequired = String(input?.missionState?.distRequired || '').toLowerCase() === 'yes';
  const distRebuilt = String(input?.missionState?.distRebuilt || '').toLowerCase() === 'yes';
  const testsPassed = String(input?.missionState?.testsPassed || '').toLowerCase() === 'yes';

  const continuitySummary = input?.chatContinuity?.summaries?.[0]?.summary || 'none';
  const continuityAvailable = Boolean(input?.chatContinuity?.summaries?.length);
  const operatorProfile = input?.chatContextPack?.providerSummaries?.operatorProfile || {};
  const identityRecall = responseMode === 'identity-recall';
  const operatorNameKnown = String(operatorProfile?.known || '').toLowerCase() === 'yes';
  const operatorName = String(operatorProfile?.operatorName || 'unknown');

  const recommendedAgents = Array.isArray(input?.chatContextPack?.providerSummaries?.agentState?.recommendedAgents)
    ? input.chatContextPack.providerSummaries.agentState.recommendedAgents
    : [];

  let mergeDecision = 'unknown';
  let riskLevel = 'low';
  let proofRequired = 'no';
  let codexPromptRequired = responseMode === 'codex-prompt' ? 'yes' : 'no';
  let recommendedNextAction = 'answer directly with bounded confidence';
  let identityRecallUsed = 'no';
  let operatorNameUsed = 'no';
  let identityGuidance = 'Operator identity unavailable.';
  let identityPromptInjected = 'no';
  let operatorProfilePromptLinePresent = 'no';
  let finalAnswerUsedOperatorProfile = 'no';
  let identityRecallDeterministicAnswerUsed = 'no';

  if (identityRecall) {
    identityRecallUsed = 'yes';
    operatorNameUsed = operatorNameKnown ? 'yes' : 'no';
    identityGuidance = operatorNameKnown
      ? `Operator profile indicates the operator's name is ${operatorName}. Use this if asked about the operator's name.`
      : 'Operator profile does not include a known operator name yet. Say name is not stored yet.';
    recommendedNextAction = operatorNameKnown ? 'answer directly with stored operator name' : 'ask operator for preferred name';
    identityPromptInjected = operatorNameKnown ? 'yes' : 'no';
    operatorProfilePromptLinePresent = operatorNameKnown ? 'yes' : 'no';
  }

  if (responseMode === 'merge-decision') {
    riskLevel = 'medium';
    proofRequired = 'yes';
    if (!prEvidenceDetected) {
      mergeDecision = 'wait';
      warnings.push('PR evidence missing; do not infer merge status.');
      recommendedNextAction = 'collect PR evidence and verification proofs before merge decision';
    }
    if (checksKnownFail || checksUnknown || !testsPassed) {
      mergeDecision = mergeDecision === 'unknown' ? 'wait' : mergeDecision;
      warnings.push('build/verify/check evidence missing or failing.');
      recommendedNextAction = 'run build/verify checks and attach results';
    }
    if (uiRealityStatus !== 'OK') {
      mergeDecision = 'wait';
      warnings.push('UI Reality proof is not OK for merge-sensitive UI work.');
      recommendedNextAction = 'capture browser UI Reality proof and re-evaluate merge';
    }
    if (distRequired && !distRebuilt) {
      mergeDecision = 'wait';
      warnings.push('dist rebuild proof missing while dist is required.');
      recommendedNextAction = 'rebuild dist and rerun verify before merge';
    }
    if (!warnings.length) {
      mergeDecision = 'yes';
      riskLevel = 'low';
      proofRequired = 'no';
      recommendedNextAction = 'perform final operator check then merge';
    }
  }

  return {
    version: 'response-planner.v1',
    status: requiredSections.length ? 'active' : 'unavailable',
    responseMode,
    answerShape: responseMode,
    requiredSections,
    omittedSections: [],
    tone: responseMode === 'merge-decision' ? 'operator-guarded' : 'direct',
    riskLevel,
    proofRequired,
    mergeDecision,
    codexPromptRequired,
    recommendedNextAction,
    warnings,
    recommendedAgents,
    continuitySummary,
    priorContextUsed: continuityAvailable ? 'yes' : 'no',
    continuityUsed: continuityAvailable,
    agentAdviceUsed: recommendedAgents.length > 0,
    canonApplied,
    providerIdsUsed,
    identityRecallUsed,
    operatorNameUsed,
    identityGuidance,
    identityPromptInjected,
    operatorProfilePromptLinePresent,
    finalAnswerUsedOperatorProfile,
    identityRecallDeterministicAnswerUsed,
    sourceRefs: ['chatContextPack', 'commandEnvelope', 'contextProviderSnapshot', 'uiRealityStatus', 'missionState'],
  };
}
