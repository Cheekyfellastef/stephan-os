import test from 'node:test';
import assert from 'node:assert/strict';
import { assertLegacyGoalDeclaredTestAcceptanceV1 as verify } from './legacyGoalTestPlanAcceptanceV1.mjs';

function candidate(scheduler, _missions, {goalRecords}) {
  const resources = scheduler.portfolio[0].resourceIds;
  const declared = resources.map(value => value.split(':path:')[1]).filter(path => path && /\.test\.(mjs|cjs|js)$/.test(path));
  if (!goalRecords.length && declared.length > 16) return {admitted: [], held: [{reason: 'TOO_MANY'}]};
  const requiredTests = ['npm run stephanos:verify', ...(goalRecords[0]?.requiredTests || declared.map(path => `node --test ${path}`))];
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
