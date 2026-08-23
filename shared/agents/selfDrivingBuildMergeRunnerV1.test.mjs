import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SELF_DRIVING_BUILD_MERGE_RUNNER_V1_ACTIONS,
  SELF_DRIVING_BUILD_MERGE_RUNNER_V1_STATES,
  classifySelfDrivingBuildMergeRunnerV1,
} from './selfDrivingBuildMergeRunnerV1.mjs';

const exactHeadEvidence = Object.freeze({
  expectedHeadSha: 'abc123',
  actualHeadSha: 'abc123',
  source: 'github:pulls/1334/head',
});

function classify(overrides = {}) {
  return classifySelfDrivingBuildMergeRunnerV1({
    workingTreeClean: true,
    mergeConflict: false,
    merged: false,
    duplicateAlreadyOnMain: false,
    exactHeadEvidence,
    proof: { status: 'NOT_RUN' },
    ...overrides,
  });
}

test('classifies READY_FOR_PROOF when clean exact head evidence exists but proof has not run', () => {
  const result = classify();
  assert.equal(result.state, SELF_DRIVING_BUILD_MERGE_RUNNER_V1_STATES.READY_FOR_PROOF);
  assert.equal(result.action, SELF_DRIVING_BUILD_MERGE_RUNNER_V1_ACTIONS.RUN_PROOF);
  assert.equal(result.canMerge, false);
});

test('classifies PROOF_FAILED with an exact unblock action and never merge permission', () => {
  const result = classify({ proof: { status: 'FAIL', headSha: 'abc123' } });
  assert.equal(result.state, SELF_DRIVING_BUILD_MERGE_RUNNER_V1_STATES.PROOF_FAILED);
  assert.equal(result.canMerge, false);
  assert.match(result.unblockAction, /rerun proof successfully/i);
});

test('classifies READY_TO_MERGE only after proof passes for the exact head evidence', () => {
  const result = classify({ proof: { status: 'PASS', headSha: 'abc123' } });
  assert.equal(result.state, SELF_DRIVING_BUILD_MERGE_RUNNER_V1_STATES.READY_TO_MERGE);
  assert.equal(result.action, SELF_DRIVING_BUILD_MERGE_RUNNER_V1_ACTIONS.MERGE_PR);
  assert.equal(result.canMerge, true);
  assert.equal(result.mergeHeadSha, 'abc123');
});

test('classifies MERGED as noop after clean and conflict checks', () => {
  const result = classify({ merged: true, proof: { status: 'PASS', headSha: 'abc123' } });
  assert.equal(result.state, SELF_DRIVING_BUILD_MERGE_RUNNER_V1_STATES.MERGED);
  assert.equal(result.action, SELF_DRIVING_BUILD_MERGE_RUNNER_V1_ACTIONS.NOOP);
  assert.equal(result.canMerge, false);
});

test('classifies DUPLICATE_ALREADY_ON_MAIN as noop when change is already on main', () => {
  const result = classify({ duplicateAlreadyOnMain: true, proof: { status: 'PASS', headSha: 'abc123' } });
  assert.equal(result.state, SELF_DRIVING_BUILD_MERGE_RUNNER_V1_STATES.DUPLICATE_ALREADY_ON_MAIN);
  assert.equal(result.action, SELF_DRIVING_BUILD_MERGE_RUNNER_V1_ACTIONS.NOOP);
  assert.equal(result.canMerge, false);
});

test('blocks dirty trees before considering proof or merge state', () => {
  const result = classify({
    workingTreeClean: false,
    merged: true,
    proof: { status: 'PASS', headSha: 'abc123' },
  });
  assert.equal(result.state, SELF_DRIVING_BUILD_MERGE_RUNNER_V1_STATES.DIRTY_TREE_BLOCKED);
  assert.equal(result.canMerge, false);
  assert.match(result.unblockAction, /git status --short/);
});

test('blocks merge conflicts with an exact unblock action', () => {
  const result = classify({ mergeConflict: true, proof: { status: 'PASS', headSha: 'abc123' } });
  assert.equal(result.state, SELF_DRIVING_BUILD_MERGE_RUNNER_V1_STATES.MERGE_CONFLICT_BLOCKED);
  assert.equal(result.canMerge, false);
  assert.match(result.unblockAction, /Resolve the merge conflicts/);
});

test('blocks missing or mismatched exact head evidence before proof can authorize merge', () => {
  for (const badEvidence of [
    {},
    { expectedHeadSha: 'abc123', actualHeadSha: 'def456', source: 'github' },
    { expectedHeadSha: 'abc123', actualHeadSha: 'abc123' },
  ]) {
    const result = classify({
      exactHeadEvidence: badEvidence,
      proof: { status: 'PASS', headSha: 'abc123' },
    });
    assert.equal(result.state, SELF_DRIVING_BUILD_MERGE_RUNNER_V1_STATES.BLOCKED_WITH_EXACT_UNBLOCK_ACTION);
    assert.equal(result.canMerge, false);
    assert.match(result.unblockAction, /exactHeadEvidence/);
  }
});

test('blocks proof pass from a stale head with an exact unblock action', () => {
  const result = classify({ proof: { status: 'PASS', headSha: 'stale999' } });
  assert.equal(result.state, SELF_DRIVING_BUILD_MERGE_RUNNER_V1_STATES.BLOCKED_WITH_EXACT_UNBLOCK_ACTION);
  assert.equal(result.canMerge, false);
  assert.match(result.unblockAction, /Rerun proof on exactHeadEvidence.actualHeadSha/);
});

test('every blocked state includes an exact unblock action', () => {
  const blockedResults = [
    classify({ workingTreeClean: false }),
    classify({ mergeConflict: true }),
    classify({ proof: { status: 'FAIL', headSha: 'abc123' } }),
    classify({ exactHeadEvidence: {}, proof: { status: 'PASS', headSha: 'abc123' } }),
  ];

  for (const result of blockedResults) {
    assert.ok(result.unblockAction, `${result.state} should include unblockAction`);
    assert.equal(result.canMerge, false);
  }
});
