import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCodexPrRepairContract, parseFailedCheckRepairEvidence } from './codexPrRepairContractModel.js';

test('local tests alone do not complete repair', () => {
  const c = buildCodexPrRepairContract({ missionSpec:{missionId:'m1'}, codexReturnText:'PR #741 tests passed locally' });
  assert.notEqual(c.repairCompleteness, 'repair_complete');
});

test('unchanged head blocks completion', () => {
  const c = buildCodexPrRepairContract({ missionSpec:{missionId:'m1'}, codexReturnText:'PR #741 previous head sha: abcdef1 new head sha: bbbbbbb', targetPrEvidence:{previousHeadSha:'abcdef1'}, currentPrEvidence:{liveHeadSha:'abcdef1'} });
  assert.equal(c.repairCompleteness, 'awaiting_remote_check_rerun');
});

test('cannot push creates blocked status', () => {
  const c = buildCodexPrRepairContract({ missionSpec:{missionId:'m1'}, codexReturnText:'could not push; origin not configured' });
  assert.equal(c.repairCompleteness, 'blocked_codex_cannot_push');
});

test('parser extracts failed job/step', () => {
  const p = parseFailedCheckRepairEvidence('workflow: CI\nfailed check: lint\nfailed job: build\nfailed step: npm test\nReferenceError: x is not defined');
  assert.equal(p.workflow, 'CI');
  assert.equal(p.failedJob, 'build');
  assert.match(p.errorLine, /ReferenceError/);
});
