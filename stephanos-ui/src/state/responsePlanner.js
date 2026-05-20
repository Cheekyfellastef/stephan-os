import { projectCanonicalPrEvidence } from './prEvidenceCanonicalProjection.js';

function asText(value, fallback = 'unknown') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

const MODE_SHAPES = {
  'merge-decision': ['merge', 'reason', 'required-proof', 'risks', 'next-action'],
  'codex-prompt': ['existing-or-new-pr', 'scope', 'forbidden-actions', 'required-tests', 'acceptance', 'report-format'],
  'codex-dispatch': ['packet-status', 'approval-needed', 'next-action', 'forbidden-actions', 'required-proof'],
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
  const snapshotPrEvidenceDetected = String(input?.supportSnapshotSummary?.prEvidenceInputDetected || input?.missionState?.prEvidenceInputDetected || '').toLowerCase() === 'yes';
  const distRequired = String(input?.missionState?.distRequired || '').toLowerCase() === 'yes';
  const distRebuilt = String(input?.missionState?.distRebuilt || '').toLowerCase() === 'yes';
  const testsPassed = String(input?.missionState?.testsPassed || '').toLowerCase() === 'yes';

  const providerPr = input?.chatContextPack?.providerSummaries?.prEvidence || {};
  const snapshotPr = {
    status: input?.supportSnapshotSummary?.prEvidenceStatus,
    prEvidenceStatus: input?.supportSnapshotSummary?.prEvidenceStatus,
    checksStatus: input?.supportSnapshotSummary?.prEvidenceChecksStatus,
    buildStatus: input?.supportSnapshotSummary?.prEvidenceBuildStatus,
    verifyStatus: input?.supportSnapshotSummary?.prEvidenceVerifyStatus,
    changedFileCount: input?.supportSnapshotSummary?.prEvidenceChangedFileCount,
    merged: String(input?.supportSnapshotSummary?.prEvidenceMerged || '').toLowerCase() === 'yes',
    mergeReadiness: input?.supportSnapshotSummary?.prEvidenceMergeReadiness,
    missingProof: String(input?.supportSnapshotSummary?.prEvidenceMissingProof || '').split('|').map((v) => v.trim()).filter(Boolean),
    prNumber: input?.supportSnapshotSummary?.prEvidenceParsedPrNumber,
    parsedPrNumber: input?.supportSnapshotSummary?.prEvidenceParsedPrNumber,
  };
  const canonicalPr = projectCanonicalPrEvidence({
    prEvidence: { ...snapshotPr, ...providerPr },
    githubPrEvidence: input?.githubPrEvidence || input?.chatContextPack?.githubPrEvidence || {},
  });
  const canonicalEvidenceDetected = ['fetched', 'available', 'parsed', 'received', 'merge_ready_candidate', 'merged'].includes(String(canonicalPr?.status || canonicalPr?.prEvidenceStatus || '').toLowerCase());
  const prEvidenceDetected = snapshotPrEvidenceDetected || canonicalEvidenceDetected;
  const prMergeReadiness = String(canonicalPr?.mergeReadiness || input?.missionState?.prEvidenceMergeReadiness || input?.supportSnapshotSummary?.prEvidenceMergeReadiness || '').toLowerCase();
  const prMissingProof = (() => {
    const canonicalList = Array.isArray(canonicalPr?.missingProof) ? canonicalPr.missingProof : [];
    if (canonicalList.length > 0) return canonicalList;
    const fallbackRaw = String(input?.missionState?.prEvidenceMissingProof || input?.supportSnapshotSummary?.prEvidenceMissingProof || '');
    if (!fallbackRaw) return [];
    return fallbackRaw
      .split('|')
      .map((item) => item.trim())
      .filter(Boolean)
      .filter((item) => !['none', 'unknown', 'n/a', 'na'].includes(item.toLowerCase()));
  })();
  const prStatus = String(canonicalPr?.status || canonicalPr?.prEvidenceStatus || input?.missionState?.prEvidenceStatus || '').toLowerCase();
  const prAlreadyMerged = prStatus === 'merged' || prMergeReadiness === 'already-merged' || canonicalPr?.merged === true;
  const prEvidenceUnavailable = ['unavailable', 'needs-connector', 'needs-evidence'].includes(prStatus);
  const canonicalChecksPassed = ['passed', 'success'].includes(String(canonicalPr?.checksStatus || '').toLowerCase());
  const canonicalBuildPassed = ['passed', 'success'].includes(String(canonicalPr?.buildStatus || '').toLowerCase());
  const canonicalVerifyPassed = ['passed', 'success'].includes(String(canonicalPr?.verifyStatus || '').toLowerCase());
  const proofsKnownPassed = canonicalChecksPassed && canonicalBuildPassed && canonicalVerifyPassed;

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
  let codexPromptRequired = (responseMode === 'codex-prompt' || responseMode === 'codex-dispatch') ? 'yes' : 'no';
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

  if (responseMode === 'codex-dispatch') {
    riskLevel = 'medium';
    proofRequired = 'yes';
    recommendedNextAction = 'present dispatch packet, require operator approval, then copy prompt for manual Codex handoff';
  }

  if (responseMode === 'merge-decision') {
    riskLevel = 'medium';
    proofRequired = 'yes';
    if (!prEvidenceDetected) {
      mergeDecision = 'wait';
      warnings.push('PR evidence missing; do not infer merge status.');
      recommendedNextAction = 'collect PR evidence and verification proofs before merge decision';
    }
    if (prEvidenceUnavailable) {
      mergeDecision = 'wait';
      warnings.push('GitHub evidence unavailable; request connector or pasted PR summary.');
      recommendedNextAction = 'connect read-only GitHub evidence or paste PR summary';
    }
    if (!prEvidenceUnavailable && (checksKnownFail || (!proofsKnownPassed && (checksUnknown || !testsPassed)) || prMergeReadiness === 'needs-amendment')) {
      mergeDecision = prMergeReadiness === 'needs-amendment' || checksKnownFail ? 'no' : (mergeDecision === 'unknown' ? 'wait' : mergeDecision);
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
    if (prAlreadyMerged) {
      mergeDecision = 'already-merged';
      recommendedNextAction = 'PR already merged; run post-merge validation and monitor regressions';
    }
    if (!prAlreadyMerged && (prMissingProof.length > 0 || ['hold','needs-proof','incomplete'].includes(prMergeReadiness))) {
      mergeDecision = 'wait';
      warnings.push('PR evidence indicates missing proof or amendment required.');
      recommendedNextAction = 'request amendment prompt with missing proof fields';
    }
    if (!warnings.length && !prAlreadyMerged) {
      mergeDecision = 'merge-candidate';
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
