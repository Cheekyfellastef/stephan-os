import test from 'node:test';
import assert from 'node:assert/strict';
import { createMissionFinishAuthority, adjudicateMissionFinishAuthority } from './missionFinishAuthorityModel.js';

test('default mission finish authority has no merge authority', () => {
  const state = createMissionFinishAuthority({ missionId: 'm-1' });
  assert.equal(state.finishAuthorityLevel, 'none');
  assert.equal(state.mergeAuthorityIncluded, false);
  assert.equal(state.routineFinishAllowed, false);
  assert.equal(state.autoMergeArmed, 'unknown');
});

test('routine finish does not imply merge authority and stale dist note is warning-only', () => {
  const state = adjudicateMissionFinishAuthority({
    finishAuthorityLevel: 'routine_finish_allowed',
    routineFinishAllowed: true,
    rebuildDistAllowed: true,
    checksStatus: 'pass',
    verificationStatus: 'verified',
  });
  assert.equal(state.routineFinishAllowed, true);
  assert.equal(state.mergeAuthorityIncluded, false);
  assert.equal(state.warnings.some((w) => /generated artifact refresh/.test(w)), true);
});

test('merged PR without recorded approval raises warning', () => {
  const state = adjudicateMissionFinishAuthority({ merged: true, mergeAuthorityIncluded: true, operatorApprovalRecorded: false });
  assert.equal(state.mergedWithoutRecordedApproval, true);
  assert.equal(state.warnings.some((w) => /without recorded approval/i.test(w)), true);
});

test('failed or unknown checks force codex repair posture', () => {
  const state = adjudicateMissionFinishAuthority({ finishAuthorityLevel: 'merge_authorized', mergeAuthorityIncluded: true, checksStatus: 'failed', verificationStatus: 'unknown' });
  assert.equal(state.requiresCodexRepair, true);
  assert.equal(state.checksKnownGood, false);
  assert.equal(state.nextAction.includes('Codex repair'), true);
});

test('merge authority must be explicit even when merged', () => {
  const state = adjudicateMissionFinishAuthority({ merged: true, operatorApprovalRecorded: true, checksStatus: 'pass', verificationStatus: 'verified' });
  assert.equal(state.mergeAuthorityIncluded, false);
  assert.equal(state.warnings.some((w) => /no recorded merge authority/.test(w)), true);
});
