// Optional acceptance commands on the existing owner-authenticated goal
// admission. This is a strict subset of the existing bounded test executor,
// never a shell, environment, dependency-install or mutation-scope grant.
import { projectCanonicalResourceIds } from './elasticBuildCapacityV1.mjs';
export function projectGoalAdmissionRequiredTestsV1(value) {
  if (value === undefined) return Object.freeze({ valid: true, supplied: false, commands: Object.freeze([]) });
  const invalid = () => Object.freeze({ valid: false, supplied: true, commands: Object.freeze([]) });
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) return invalid();
  const commands = [];
  for (const command of value) {
    if (typeof command !== 'string' || command.length > 256 || command !== command.trim()) return invalid();
    if (command !== 'npm run stephanos:verify'
      && command !== 'node --test scripts/acceptance/legacy-goal-declared-tests.acceptance.mjs'
      && command !== 'node --test scripts/acceptance/generated-functional-scope.acceptance.mjs') {
      const match = /^node --test ((?:scripts|shared|stephanos-server|packages|tests?)\/[A-Za-z0-9._/-]+\.test\.(?:mjs|cjs|js))$/.exec(command);
      if (!match || match[1].split('/').some(segment => !segment || segment === '.' || segment === '..'
          || ['.git', 'node_modules', 'dist', 'data', 'runtime-data', 'root-data'].includes(segment))) return invalid();
    }
    if (commands.includes(command)) return invalid();
    commands.push(command);
  }
  return Object.freeze({ valid: true, supplied: true, commands: Object.freeze(commands) });
}

// Read-only context for already admitted tests. Never a mutation scope or an
// import crawler: the legacy acceptance wrapper needs its declared oracle.
export function projectGoalTestContextPathsV1(requiredTests) {
  const plan = projectGoalAdmissionRequiredTestsV1(requiredTests);
  if (!plan.valid || !plan.supplied) return Object.freeze([]);
  const paths = plan.commands.filter(command => command.startsWith('node --test '))
    .map(command => command.slice('node --test '.length));
  if (paths.includes('scripts/acceptance/legacy-goal-declared-tests.acceptance.mjs'))
    paths.unshift('shared/agents/legacyGoalTestPlanAcceptanceV1.mjs');
  return Object.freeze([...new Set(paths)]);
}

export function projectOwnerGoalRequiredTestsV1(record, issueNumber, repository) {
  const tests = projectGoalAdmissionRequiredTestsV1(record?.requiredTests);
  const identity = record?.schemaVersion === 'shared-agent-workspace-record.v1'
    && record?.kind === 'stephanos.shared_workspace.goal'
    && record?.goalId === `goal-${issueNumber}` && record?.issueNumber === issueNumber
    && String(record?.repository).toLowerCase() === String(repository).toLowerCase()
    && record?.source === 'github-goal-estate-mirror'
    && record?.mirrorSchema === 'stephanos.github-goal-mirror.v1'
    && record?.githubAdmissionState === 'ADMISSION_PROVEN'
    && record?.mirrorIssueNumber === issueNumber
    && String(record?.mirrorRepository).toLowerCase() === String(repository).toLowerCase()
    && record?.mirrorBuildPickupAllowed === true;
  return Object.freeze({ ...tests, valid: tests.valid && (!tests.supplied || identity) });
}

// Retained workspace reservations and a fresh owner's future retry contract
// are separate truths. This selector cannot alter either record or a claim.
export function projectFreshOwnerGoalRetryContractV1(record, estate, issueNumber, repository, nowUtc) {
  const invalid = () => Object.freeze({ valid: false, supplied: false,
    commands: Object.freeze([]), resourceIds: Object.freeze([]) });
  if (estate?.ok !== true || !Array.isArray(estate.issues) || estate.issues.length > 1000) return invalid();
  const matches = estate.issues.filter(issue => issue?.issueNumber === issueNumber);
  if (matches.length !== 1) return invalid();
  const issue = matches[0], admission = issue.admission;
  if (issue.admissionProofSource !== 'OWNER_AUTHENTICATED_COMMENT'
      || issue.admissionState !== 'ADMISSION_PROVEN' || issue.schedulerEligible !== true
      || issue.operatorLaneContainment?.active === true || issue.state !== 'open'
      || !Array.isArray(issue.labels) || !issue.labels.includes('goal')
      || String(issue.repository).toLowerCase() !== String(repository).toLowerCase()
      || admission?.schemaVersion !== 'stephanos.github-goal-admission.v1'
      || admission.issueNumber !== issueNumber
      || String(admission.repository).toLowerCase() !== String(repository).toLowerCase()
      || admission.state !== 'READY' || admission.route !== 'OPENCLAW_LOCAL'
      || !Array.isArray(admission.prerequisites) || admission.prerequisites.length
      || admission.sourceImplementationAllowed !== true || admission.mergeAuthority !== false
      || admission.deploymentAuthority !== false || admission.runtimeMutationAuthority !== false
      || admission.arbitraryShellAllowed !== false) return invalid();
  const tests = projectOwnerGoalRequiredTestsV1({ ...record, requiredTests: admission.requiredTests }, issueNumber, repository);
  const now = Date.parse(nowUtc), observed = Date.parse(issue.retrievedAt);
  const previous = Date.parse(record?.mirrorObservedAtUtc), updated = Date.parse(issue.updatedAt);
  if (!tests.valid || !tests.supplied || record?.operatorLaneContainment?.active === true
      || record?.state !== 'READY' || record?.route !== 'OPENCLAW_LOCAL'
      || record?.mergeAuthority !== false || record?.deploymentAuthority !== false
      || record?.runtimeMutationAuthority !== false || record?.arbitraryShellAllowed !== false
      || !Number.isFinite(now) || !Number.isFinite(observed)
      || !Number.isFinite(previous) || !Number.isFinite(updated) || updated > observed
      || observed < previous || observed > now || now - observed > 300_000
      || !Array.isArray(record?.resourceIds) || !Array.isArray(admission.resourceIds)) return invalid();
  const before = projectCanonicalResourceIds(record.resourceIds);
  const after = projectCanonicalResourceIds(admission.resourceIds);
  const prefix = `repo:${String(repository).toLowerCase()}:path:`;
  if (!before.valid || !after.valid || !after.resourceIds.length
      || before.resourceIds.length !== record.resourceIds.length
      || after.resourceIds.length !== admission.resourceIds.length
      || after.resourceIds.length >= before.resourceIds.length
      || before.resourceIds.some(path => !path.startsWith(prefix))) return invalid();
  const retained = new Set(before.resourceIds);
  if (after.resourceIds.some(path => !retained.has(path))) return invalid();
  return Object.freeze({ valid: true, supplied: true, commands: tests.commands,
    resourceIds: Object.freeze([...admission.resourceIds].sort()), updatedAtUtc: issue.updatedAt });
}

// A fresh owner plan may strengthen a failed attempt, never weaken it. Its
// independent added checks must remain outside the existing mutation scope.
export function projectStrengthenedRetryTestsV1(previous, next, allowedFiles) {
  const plan = projectGoalAdmissionRequiredTestsV1(next);
  const invalid = () => Object.freeze({ valid: false, commands: Object.freeze([]) });
  if (!plan.valid || !plan.supplied || !Array.isArray(previous) || !Array.isArray(allowedFiles)
    || previous.some(command => !plan.commands.includes(command))) return invalid();
  const added = plan.commands.filter(command => !previous.includes(command));
  if (!added.length) return invalid();
  for (const command of added) {
    if (!command.startsWith('node --test ')) return invalid();
    const path = command.slice('node --test '.length).toLowerCase();
    if (allowedFiles.some(scope => {
      const value = String(scope).trim().replace(/\\/g, '/').replace(/^\.\/+/, '').toLowerCase();
      return value === '**' || value === path || (value.endsWith('/**')
        && (path === value.slice(0, -3) || path.startsWith(value.slice(0, -2))));
    })) return invalid();
  }
  return Object.freeze({ valid: true, commands: plan.commands });
}
