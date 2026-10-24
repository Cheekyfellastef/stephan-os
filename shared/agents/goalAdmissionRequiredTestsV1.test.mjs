import test from 'node:test';
import assert from 'node:assert/strict';
import { projectGoalAdmissionRequiredTestsV1 as project } from './goalAdmissionRequiredTestsV1.mjs';

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
