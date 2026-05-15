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

  const buildVerifyPassed = input.latestBuildVerifyStatus === 'pass';
  const testsPassed = input.latestTestResults === 'pass';
  const uiRealityFailed = String(input.latestSupportSnapshotStatus?.uiRealityStatus || input.uiRealityStatus || '').toUpperCase() === 'FAIL';
  const supportAcceptanceMatch = input.latestSupportSnapshotStatus?.acceptanceFieldsMatch !== false;
  const browserProofRequired = input.latestSupportSnapshotStatus?.browserProofRequired === true;
  const browserProofAvailable = input.latestSupportSnapshotStatus?.browserProofAvailable === true;
  const attemptsExhausted = currentAttempt >= maxAttempts;

  let status = 'active';
  if (attemptsExhausted) status = 'blocked';
  else if (!buildVerifyPassed || !testsPassed) status = 'blocked';
  else if (uiRealityFailed || !supportAcceptanceMatch || failingAcceptanceFields.length > 0) status = 'needs-repair';
  else if (browserProofRequired && !browserProofAvailable) status = 'needs-proof';
  else status = 'passed';

  const latestFailingField = failingAcceptanceFields[0] || '';
  const operatorDecisionRequired = status === 'blocked';
  const mergeRecommendation = status === 'passed' ? 'merge-candidate' : 'hold';
  const nextPrompt = status === 'passed'
    ? 'All acceptance fields pass. Prepare merge evidence summary only.'
    : latestFailingField
      ? `Repair ${latestFailingField} and rerun required proof commands before requesting merge.`
      : 'Collect missing proof, repair failing acceptance fields, and rerun required tests/build/verify.';

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
    latestTestResults: asText(input.latestTestResults, 'unknown'),
    latestBuildVerifyStatus: asText(input.latestBuildVerifyStatus, 'unknown'),
    latestSupportSnapshotStatus: input.latestSupportSnapshotStatus || {},
    failingAcceptanceFields,
    nextPrompt,
    mergeRecommendation,
    operatorDecisionRequired,
    warnings: asList(input.warnings),
  };
}
