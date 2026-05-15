function asText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function asList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asText(item)).filter(Boolean);
}

export function buildMissionRepairLoopModel(input = {}) {
  const missionId = asText(input.missionId, 'unknown-mission');
  const title = asText(input.title, 'Mission Repair Loop');
  const objective = asText(input.objective, 'Repair mission until acceptance criteria are proven.');
  const currentAttempt = Math.max(0, Number(input.currentAttempt) || 0);
  const maxAttempts = Math.max(1, Number(input.maxAttempts) || 3);
  const acceptanceCriteria = asList(input.acceptanceCriteria);
  const forbiddenActions = asList(input.forbiddenActions);
  const requiredProof = asList(input.requiredProof);
  const failingAcceptanceFields = asList(input.failingAcceptanceFields);

  const sourceTruthsUsed = asList(input.sourceTruthsUsed);
  const latestBuildVerifyStatus = asText(input.latestBuildVerifyStatus, 'unknown');
  const latestTestResults = asText(input.latestTestResults, 'unknown');
  const uiRealityStatus = asText(input.latestSupportSnapshotStatus?.uiRealityStatus || input.uiRealityStatus, 'UNKNOWN').toUpperCase();
  const supportAcceptanceMatch = input.latestSupportSnapshotStatus?.acceptanceFieldsMatch !== false;
  const browserProofRequired = input.latestSupportSnapshotStatus?.browserProofRequired === true;
  const browserProofAvailable = input.latestSupportSnapshotStatus?.browserProofAvailable === true;
  const verificationReady = asText(input.missionVerificationReadinessLevel, 'unknown');
  const verificationProof = asText(input.missionVerificationProofStatus, 'unknown');
  const attemptsExhausted = currentAttempt >= maxAttempts;

  const buildVerifyFailed = latestBuildVerifyStatus === 'fail';
  const testsFailed = latestTestResults === 'fail';
  const uiRealityFailed = uiRealityStatus === 'FAIL';
  const verificationBlocked = ['blocked', 'not_ready', 'failed'].includes(verificationReady) || ['failed'].includes(verificationProof);

  let status = 'active';
  if (attemptsExhausted) status = 'blocked';
  else if (buildVerifyFailed || testsFailed || verificationBlocked) status = 'blocked';
  else if (uiRealityFailed || !supportAcceptanceMatch || failingAcceptanceFields.length > 0) status = 'needs-repair';
  else if (browserProofRequired && !browserProofAvailable) status = 'needs-proof';
  else if (latestBuildVerifyStatus === 'pass' && latestTestResults === 'pass' && supportAcceptanceMatch) status = 'passed';

  const latestFailingField = failingAcceptanceFields[0] || '';
  const operatorDecisionRequired = status === 'blocked';
  const mergeRecommendation = status === 'passed' && verificationProof !== 'failed' ? 'merge-candidate' : 'hold';
  const nextPrompt = status === 'passed'
    ? 'All acceptance fields pass. Prepare merge evidence summary only.'
    : latestFailingField
      ? `Repair ${latestFailingField} and rerun required proof commands before requesting merge.`
      : 'Collect missing proof, repair failing acceptance fields, and rerun required tests/build/verify.';

  const duplicateAuthorityDetected = sourceTruthsUsed.length === 0 ? 'yes' : 'no';

  return {
    version: 'mission-repair-loop.v1',
    status,
    missionId,
    title,
    objective,
    currentAttempt,
    maxAttempts,
    acceptanceCriteria,
    forbiddenActions,
    requiredProof,
    latestCodexSummary: asText(input.latestCodexSummary, 'n/a'),
    latestTestResults,
    latestBuildVerifyStatus,
    latestSupportSnapshotStatus: input.latestSupportSnapshotStatus || {},
    missionVerificationReadinessLevel: verificationReady,
    missionVerificationProofStatus: verificationProof,
    failingAcceptanceFields,
    nextPrompt,
    mergeRecommendation,
    operatorDecisionRequired,
    sourceTruthsUsed,
    duplicateAuthorityDetected,
    warnings: asList(input.warnings),
  };
}
