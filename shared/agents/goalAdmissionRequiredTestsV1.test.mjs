import test from 'node:test';
import assert from 'node:assert/strict';
import { projectGoalTestContextPathsV1 } from './goalAdmissionRequiredTestsV1.mjs';
import { projectGoalAdmissionRequiredTestsV1 as project, projectStrengthenedRetryTestsV1 as strengthen, projectOwnerGoalRequiredTestsV1 as owner } from './goalAdmissionRequiredTestsV1.mjs';

test('required-test context is a fixed read-only projection of the validated plan', () => {
  assert.deepEqual(projectGoalTestContextPathsV1(['npm run stephanos:verify',
    'node --test scripts/acceptance/legacy-goal-declared-tests.acceptance.mjs']),
  ['shared/agents/legacyGoalTestPlanAcceptanceV1.mjs', 'scripts/acceptance/legacy-goal-declared-tests.acceptance.mjs']);
  assert.deepEqual(projectGoalTestContextPathsV1(['node --test shared/agents/example.test.mjs']),
    ['shared/agents/example.test.mjs']);
  for (const plan of [undefined, [], ['node --test ../secrets.test.mjs'],
    ['node --test scripts/*.test.mjs'], ['node --test scripts/a.test.mjs;whoami'],
    ['node --test scripts/a.test.mjs', 'npm install']]) {
    assert.deepEqual(projectGoalTestContextPathsV1(plan), []);
  }
});

test('optional owner acceptance permits only finite existing bounded test forms', () => {
  assert.deepEqual(project(undefined), { valid: true, supplied: false, commands: [] });
  const commands = ['npm run stephanos:verify', 'node --test scripts/sovereign-goal-builder-worker-evidence.test.mjs',
    'node --test stephanos-server/services/elasticGoalMissionAdmissionService.test.js'];
  assert.deepEqual(project(commands), { valid: true, supplied: true, commands });
});

test('malformed, unbounded, executable, environment and escaping test requests refuse', () => {
  for (const value of [null, [], 'node --test scripts/a.test.mjs', [''], [4],
    Array.from({ length: 17 }, (_, i) => `node --test scripts/a${i}.test.mjs`),
    ['npm run other'], ['node --test scripts/a.test.mjs', 'node --test scripts/a.test.mjs'],
    ['node --test scripts/../other.test.mjs'], ['node --test scripts//other.test.mjs'],
    ['node --test C:/outside.test.mjs'], ['node --test /outside.test.mjs'],
    ['node --test scripts/data/other.test.mjs'], ['node --test scripts/node_modules/a.test.mjs'],
    ['node --test --import scripts/a.test.mjs'], ['node --check scripts/a.mjs'],
    ['node --test scripts/a.test.mjs;whoami'], ['node --test scripts/a.test.mjs\nwhoami'],
    ['node --test scripts/a.test.mjs '], ['set X=1 && node --test scripts/a.test.mjs'],
  ]) assert.equal(project(value).valid, false, JSON.stringify(value));
});

test('owner-selected independent task acceptance permits only the fixed commands', () => {
  assert.equal(project(['node --test scripts/acceptance/legacy-goal-declared-tests.acceptance.mjs']).valid, true);
  const scopeAcceptance = 'node --test scripts/acceptance/generated-functional-scope.acceptance.mjs';
  assert.equal(project([scopeAcceptance]).valid, true);
  assert.deepEqual(projectGoalTestContextPathsV1([scopeAcceptance]),
    ['scripts/acceptance/generated-functional-scope.acceptance.mjs']);
  assert.equal(strengthen(['npm run stephanos:verify'], ['npm run stephanos:verify', scopeAcceptance],
    ['stephanos-server/services/githubPrEvidenceService.js']).valid, true);
  assert.equal(strengthen(['npm run stephanos:verify'], ['npm run stephanos:verify', scopeAcceptance],
    ['scripts/acceptance/**']).valid, false);
  for (const command of ['node --test scripts/acceptance/other.acceptance.mjs',
    'node --test scripts/acceptance/generated-functional-scope.acceptance.mjs --watch',
    'node --test scripts/acceptance/generated-functional-scope.acceptance.mjs;whoami',
    'node --test scripts/acceptance/legacy-goal-declared-tests.acceptance.mjs --watch',
    'node --test scripts/../acceptance/legacy-goal-declared-tests.acceptance.mjs']) {
    assert.equal(project([command]).valid, false, command);
  }
});


test('retry acceptance remains monotonic and independent of normalized mutation scopes', () => {
  const previous = ['npm run stephanos:verify', 'node --test scripts/previous.test.mjs'];
  const extra = 'node --test scripts/acceptance/legacy-goal-declared-tests.acceptance.mjs';
  const next = [...previous, extra];
  assert.equal(strengthen(previous, next, ['stephanos-server/services/example.js']).valid, true);
  for (const scope of ['**', 'scripts/**', 'scripts/acceptance/**', './scripts/acceptance/**',
    'scripts/acceptance/legacy-goal-declared-tests.acceptance.mjs']) assert.equal(strengthen(previous, next, [scope]).valid, false, scope);
  for (const plan of [previous, [extra], [...next, extra], ['npm run stephanos:verify', extra], []]) {
    assert.equal(strengthen(previous, plan, ['stephanos-server/services/example.js']).valid, false);
  }
});

test('shared owner passport refuses every changed authority binding', () => {
  const record = {schemaVersion: 'shared-agent-workspace-record.v1', kind: 'stephanos.shared_workspace.goal',
    goalId: 'goal-2964', issueNumber: 2964, repository: 'Cheekyfellastef/stephan-os',
    source: 'github-goal-estate-mirror', mirrorSchema: 'stephanos.github-goal-mirror.v1',
    githubAdmissionState: 'ADMISSION_PROVEN', mirrorIssueNumber: 2964,
    mirrorRepository: 'Cheekyfellastef/stephan-os', mirrorBuildPickupAllowed: true,
    requiredTests: ['node --test scripts/acceptance/legacy-goal-declared-tests.acceptance.mjs']};
  assert.equal(owner(record, 2964, record.repository).valid, true);
  for (const key of Object.keys(record).filter(key => key !== 'requiredTests')) {
    assert.equal(owner({...record, [key]: null}, 2964, record.repository).valid, false, key);
  }
});
