import test from 'node:test';
import assert from 'node:assert/strict';
import { planElasticGoalMissionAdmissions } from './elasticGoalMissionAdmissionService.js';

const repository = 'Cheekyfellastef/stephan-os';
const resource = path => `repo:${repository.toLowerCase()}:path:${path}`;
function plan(paths) {
  const goals = [2314, 2315].map((issue, index) => ({ issue, title: `Goal ${issue}`,
    lifecycle: 'READY', route: 'CHATGPT_GITHUB', repository,
    resourceIds: index ? [resource('shared/agents/other.mjs')] : paths.map(resource) }));
  return planElasticGoalMissionAdmissions({ schemaVersion: 'stephanos.mission-scheduler.v1',
    readOnly: true, failClosed: false, activeGoals: [],
    elasticCapacity: { status: 'RUNNING', desiredWidth: 5, remainingAdmissionSlots: 5 },
    parallelCandidateDetails: goals.map(goal => ({ ...goal, candidateId: `#${goal.issue}` })),
    portfolio: goals }, []);
}

test('legacy exact tests preserve case and retain the original mutation scope', () => {
  const result = plan(['shared/agents/source.mjs', 'scripts/Zebra.test.cjs', 'tests/alpha.test.js']);
  const admission = result.admitted.find(item => item.issueNumber === 2314);
  assert.ok(admission, JSON.stringify(result.held));
  assert.deepEqual(admission.missionInput.requiredTests, ['npm run stephanos:verify',
    'node --test scripts/Zebra.test.cjs', 'node --test tests/alpha.test.js']);
  assert.deepEqual(admission.missionInput.allowedFiles, [
    'scripts/Zebra.test.cjs', 'scripts/Zebra.test.cjs/**',
    'shared/agents/source.mjs', 'shared/agents/source.mjs/**',
    'tests/alpha.test.js', 'tests/alpha.test.js/**',
  ]);
});

test('unsafe and unsupported exact test paths hold only their goal through the existing validator', () => {
  for (const path of ['apps/unadmitted.test.js', 'scripts/dist/nested.test.js',
    'scripts/a test.test.js']) {
    const result = plan([path]);
    assert.deepEqual(result.admitted.map(item => item.issueNumber), [2315]);
    assert.ok(result.held.some(item => item.issueNumber === 2314));
  }
});

test('the complete legacy plan respects the existing limit including general verification', () => {
  for (const count of [15, 16]) {
    const result = plan(Array.from({ length: count }, (_, index) => `scripts/test${index}.test.mjs`));
    const admission = result.admitted.find(item => item.issueNumber === 2314);
    if (count === 15) assert.equal(admission.missionInput.requiredTests.length, 16);
    else assert.equal(admission, undefined);
    assert.ok(result.admitted.some(item => item.issueNumber === 2315));
  }
});

test('a directory or non-test declaration never guesses focused test files', () => {
  for (const path of ['scripts', 'shared/agents/source.mjs']) {
    const result = plan([path]);
    const admission = result.admitted.find(item => item.issueNumber === 2314);
    assert.deepEqual(admission.missionInput.requiredTests, ['npm run stephanos:verify']);
  }
});

test('duplicate and glob scopes keep their existing fail-closed admission behavior', () => {
  for (const paths of [['scripts/one.test.js', 'scripts/one.test.js'], ['scripts/*.test.js'], ['scripts/**']]) {
    const result = plan(paths);
    assert.equal(result.admitted.some(item => item.issueNumber === 2314), false);
    assert.ok(result.admitted.some(item => item.issueNumber === 2315));
  }
});
