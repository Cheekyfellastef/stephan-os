import test from 'node:test';
import assert from 'node:assert/strict';
import { assertLegacyGoalDeclaredTestAcceptanceV1 as verify } from './legacyGoalTestPlanAcceptanceV1.mjs';

function candidate(scheduler, _missions, {goalRecords}) {
  const resources = scheduler.portfolio[0].resourceIds;
  const declared = resources.map(value => value.split(':path:')[1]).filter(path => path && /\.test\.(mjs|cjs|js)$/.test(path));
  if (!goalRecords.length && declared.length > 16) return {admitted: [], held: [{reason: 'TOO_MANY'}]};
  const requiredTests = goalRecords[0]?.requiredTests
    ? [...goalRecords[0].requiredTests]
    : ['npm run stephanos:verify', ...declared.map(path => `node --test ${path}`)];
  return {admitted: [{resourceIds: [...resources].sort(), missionInput: {requiredTests, allowedFiles: declared}}], mergeAuthority: false};
}
test('oracle accepts complete semantics and refuses omitted behavior or scope expansion', () => {
  verify(candidate);
  for (const defect of ['missing-focused', 'extra-scope', 'owner-plan-replaced', 'overlarge-admitted']) {
    assert.throws(() => verify((...args) => {
      const result = candidate(...args);
      if (defect === 'overlarge-admitted' && !result.admitted.length) result.admitted.push({missionInput: {requiredTests: []}});
      if (result.admitted[0]) {
        if (defect === 'missing-focused') result.admitted[0].missionInput.requiredTests = ['npm run stephanos:verify'];
        if (defect === 'extra-scope') result.admitted[0].resourceIds.push('repo:cheekyfellastef/stephan-os');
        if (defect === 'owner-plan-replaced' && args[2].goalRecords.length) result.admitted[0].missionInput.requiredTests.push('node --test scripts/unapproved.test.mjs');
      }
      return result;
    }), undefined, defect);
  }
});

test('oracle refuses general or inferred checks added to an explicit owner plan', () => {
  for (const extra of ['npm run stephanos:verify', 'node --test scripts/declared.test.mjs']) {
    let explicitPlanObserved = false;
    assert.throws(() => verify((...args) => {
      const result = candidate(...args);
      if (args[2].goalRecords.length) {
        explicitPlanObserved = true;
        result.admitted[0].missionInput.requiredTests.unshift(extra);
      }
      return result;
    }), error => error.code === 'ERR_ASSERTION' && error.operator === 'deepStrictEqual'
      && Array.isArray(error.actual) && error.actual.includes(extra), extra);
    assert.equal(explicitPlanObserved, true, extra);
  }
});
