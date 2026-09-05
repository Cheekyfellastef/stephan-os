import {
  PROVIDER_INDEPENDENCE_VERDICT,
  evaluateProviderIndependenceAdmissionV1,
} from './providerIndependenceAdmissionGateV1.mjs';

export const PROVIDER_INDEPENDENCE_MISSION_ADMISSION_SCHEMA = 'stephanos.provider-independence-mission-admission.v1';

export const PROVIDER_INDEPENDENCE_MISSION_DECISION = Object.freeze({
  ADMIT: 'ADMIT',
  ADMIT_TEMPORARY_EXCEPTION: 'ADMIT_TEMPORARY_EXCEPTION',
  HOLD_PROVIDER_INDEPENDENCE: 'HOLD_PROVIDER_INDEPENDENCE',
});

const PASS_VERDICTS = new Set([
  PROVIDER_INDEPENDENCE_VERDICT.PASS_PROVIDER_INDEPENDENT,
  PROVIDER_INDEPENDENCE_VERDICT.PASS_OPTIONAL_CODEX_SPECIALIST,
  PROVIDER_INDEPENDENCE_VERDICT.PASS_EXISTING_QUALIFIED_PARITY,
]);
const SAFE_MISSION_ID = /^[a-z0-9][a-z0-9._:@/-]{1,180}$/i;
const REPOSITORY = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i;
const INPUT_KEYS = Object.freeze(['missionBinding', 'providerIndependenceInput']);
const MISSION_KEYS = Object.freeze(['missionId', 'goalIssue', 'repository']);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function exactKeys(value, keys) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function issueNumber(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

function zeroAuthority() {
  return Object.freeze({
    dispatchAllowed: false,
    sourceMutationAllowed: false,
    providerQualificationAuthority: false,
    mergeAuthority: false,
    deploymentAuthority: false,
    windowsRuntimeAuthority: false,
    openClawMutationAuthority: false,
    spendingOrAccountAuthority: false,
    leaseSeizureAllowed: false,
  });
}

function validateMissionBinding(binding) {
  if (!exactKeys(binding, MISSION_KEYS)) return null;
  const missionId = text(binding.missionId);
  const repository = text(binding.repository);
  const goalIssue = issueNumber(binding.goalIssue);
  if (!SAFE_MISSION_ID.test(missionId) || !REPOSITORY.test(repository) || !goalIssue) return null;
  return Object.freeze({ missionId, goalIssue, repository });
}

export function evaluateProviderIndependenceMissionAdmissionV1(input = {}) {
  if (!exactKeys(input, INPUT_KEYS)) {
    throw new Error('mission provider-independence admission requires the exact closed-world input schema');
  }
  const mission = validateMissionBinding(input.missionBinding);
  if (!mission) throw new Error('mission binding is invalid');

  const providerVerdict = evaluateProviderIndependenceAdmissionV1(input.providerIndependenceInput);
  const isPass = PASS_VERDICTS.has(providerVerdict.finalVerdict);
  const isTemporaryException = providerVerdict.finalVerdict === PROVIDER_INDEPENDENCE_VERDICT.TEMPORARY_EXCEPTION_ACTIVE;
  const eligible = isPass || isTemporaryException;
  const decision = isTemporaryException
    ? PROVIDER_INDEPENDENCE_MISSION_DECISION.ADMIT_TEMPORARY_EXCEPTION
    : isPass
      ? PROVIDER_INDEPENDENCE_MISSION_DECISION.ADMIT
      : PROVIDER_INDEPENDENCE_MISSION_DECISION.HOLD_PROVIDER_INDEPENDENCE;

  const schedulerProjection = Object.freeze({
    missionId: mission.missionId,
    goalIssue: mission.goalIssue,
    eligible,
    decision,
    providerIndependenceVerdict: providerVerdict.finalVerdict,
    holdReason: eligible ? '' : providerVerdict.blockers[0] || 'provider-independence-not-proven',
    selectedAlternativeRouteIds: Object.freeze([...(providerVerdict.selectedAlternativeRouteIds || [])]),
    authority: zeroAuthority(),
  });

  const sovereigntyProjection = Object.freeze({
    missionId: mission.missionId,
    goalIssue: mission.goalIssue,
    repository: mission.repository,
    providerDependencyId: providerVerdict.providerDependencyId,
    capabilityClass: providerVerdict.capabilityClass,
    provider: providerVerdict.provider,
    mode: providerVerdict.mode,
    finalVerdict: providerVerdict.finalVerdict,
    concentrationRiskVisible: providerVerdict.concentrationRiskVisible === true,
    selectedAlternativeRouteIds: Object.freeze([...(providerVerdict.selectedAlternativeRouteIds || [])]),
    exceptionId: text(providerVerdict.exceptionId),
    exceptionExpiresAt: text(providerVerdict.exceptionExpiresAt),
    blockers: Object.freeze([...(providerVerdict.blockers || [])]),
    authority: zeroAuthority(),
  });

  return Object.freeze({
    schemaVersion: PROVIDER_INDEPENDENCE_MISSION_ADMISSION_SCHEMA,
    mission,
    providerVerdict,
    schedulerProjection,
    sovereigntyProjection,
    authority: zeroAuthority(),
  });
}
