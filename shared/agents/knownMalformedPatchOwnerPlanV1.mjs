import { isKnownMalformedPatchRetryV1, KNOWN_MALFORMED_PATCH_REPAIR_V1 as KNOWN } from './knownMalformedPatchRetryV1.mjs';
import { projectCanonicalResourceIds } from './elasticBuildCapacityV1.mjs';
import { projectOwnerGoalRequiredTestsV1, projectStrengthenedRetryTestsV1 } from './goalAdmissionRequiredTestsV1.mjs';
import { projectNarrowedMissionSourceScopeV1 } from './missionOrchestrator.mjs';

// The native GitHub reader authenticates the comment before projecting its
// proof source. This pure selector does not authenticate caller-supplied JSON,
// grant custody, or alter the original unscoped mirror reservation.
export function projectKnownMalformedPatchOwnerPlanV1(mission, mirror, estate, nowUtc) {
  const invalid = () => Object.freeze({ valid: false, supplied: false,
    commands: Object.freeze([]), resourceIds: Object.freeze([]) });
  if (!mission || !isKnownMalformedPatchRetryV1(mission)
      || !Array.isArray(mission.allowedFiles) || mission.allowedFiles.length !== 1
      || mission.allowedFiles[0] !== '**'
      || !Array.isArray(mission.requiredTests) || !mission.requiredTests.includes('npm run stephanos:verify')
      || !Array.isArray(mirror?.resourceIds) || mirror.resourceIds.length !== 0
      || estate?.ok !== true || !Array.isArray(estate.issues) || estate.issues.length > 1000) return invalid();
  const matches = estate.issues.filter(issue => issue?.issueNumber === KNOWN.issueNumber);
  if (matches.length !== 1) return invalid();
  const issue = matches[0], admission = issue.admission;
  const sameRepository = value => typeof value === 'string' && value.toLowerCase() === KNOWN.repository.toLowerCase();
  const noExtraAuthority = value => value?.mergeAuthority === false && value.deploymentAuthority === false
    && value.runtimeMutationAuthority === false && value.arbitraryShellAllowed === false;
  if (issue.admissionProofSource !== 'OWNER_AUTHENTICATED_COMMENT'
      || issue.admissionState !== 'ADMISSION_PROVEN' || issue.schedulerEligible !== true
      || issue.operatorLaneContainment?.active === true || issue.state !== 'open'
      || !Array.isArray(issue.labels) || !issue.labels.includes('goal') || !sameRepository(issue.repository)
      || admission?.schemaVersion !== 'stephanos.github-goal-admission.v1'
      || admission.issueNumber !== KNOWN.issueNumber || !sameRepository(admission.repository)
      || admission.state !== 'READY' || admission.route !== 'OPENCLAW_LOCAL'
      || !Array.isArray(admission.prerequisites) || admission.prerequisites.length !== 0
      || admission.sourceImplementationAllowed !== true || !noExtraAuthority(admission)
      || mirror.operatorLaneContainment?.active === true || mirror.state !== 'READY'
      || mirror.route !== 'OPENCLAW_LOCAL' || !noExtraAuthority(mirror)
      || (mirror.prerequisites !== undefined
        && (!Array.isArray(mirror.prerequisites) || mirror.prerequisites.length !== 0))) return invalid();
  const tests = projectOwnerGoalRequiredTestsV1({ ...mirror, requiredTests: admission.requiredTests },
    KNOWN.issueNumber, KNOWN.repository);
  const now = Date.parse(nowUtc), observed = Date.parse(issue.retrievedAt);
  const previous = Date.parse(mirror.mirrorObservedAtUtc), updated = Date.parse(issue.updatedAt);
  if (!tests.valid || !tests.supplied || !Number.isFinite(now) || !Number.isFinite(observed)
      || !Number.isFinite(previous) || !Number.isFinite(updated) || updated > observed
      || observed < previous || observed > now || now - observed > 300_000) return invalid();
  const resources = projectCanonicalResourceIds(admission.resourceIds);
  const prefix = `repo:${KNOWN.repository.toLowerCase()}:path:`;
  if (!resources.valid || resources.resourceIds.length === 0
      || admission.resourceIds.some(value => value !== value.trim())
      || resources.resourceIds.some(value => !value.startsWith(prefix))) return invalid();
  // Resource paths reserve descendants as well; use the same scopes as the
  // conveyor when proving the added acceptance checks are independent.
  const scopes = admission.resourceIds.flatMap(value => {
    const path = value.slice(prefix.length);
    return [path, `${path}/**`];
  });
  const narrowed = projectNarrowedMissionSourceScopeV1(mission.allowedFiles, scopes);
  if (!narrowed.valid || !projectStrengthenedRetryTestsV1(mission.requiredTests,
    tests.commands, narrowed.allowedFiles).valid) return invalid();
  return Object.freeze({ valid: true, supplied: true, commands: tests.commands,
    resourceIds: Object.freeze([...admission.resourceIds].sort()), updatedAtUtc: issue.updatedAt });
}
