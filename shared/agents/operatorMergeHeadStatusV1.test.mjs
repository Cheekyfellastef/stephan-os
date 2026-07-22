import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OPERATOR_MERGE_HEAD_STATUS_CONTEXT,
  OPERATOR_MERGE_HEAD_STATUS_GATE_JOB,
  OPERATOR_MERGE_HEAD_STATUS_PENDING_JOB,
  OPERATOR_MERGE_HEAD_STATUS_SUCCESS_JOB,
  buildOperatorMergeHeadStatusPayload,
  validateOperatorMergeHeadStatusExecution,
  validateOperatorMergeHeadStatusReadback,
} from './operatorMergeHeadStatusV1.mjs';

const sourceHead = 'a'.repeat(40);
const baseSha = 'b'.repeat(40);
const repository = 'Cheekyfellastef/stephan-os';

function event() {
  return {
    repository: { full_name: repository },
    pull_request: {
      number: 1581,
      head: { sha: sourceHead, ref: 'fix/bounded-github-admin-mailbox', repo: { full_name: repository } },
      base: { sha: baseSha, ref: 'main' },
    },
  };
}

function pullRequest() {
  return {
    number: 1581,
    state: 'open',
    head: { sha: sourceHead, ref: 'fix/bounded-github-admin-mailbox', repo: { full_name: repository } },
    base: { sha: baseSha, ref: 'main' },
  };
}

function input(overrides = {}) {
  return {
    mode: 'pending',
    job: OPERATOR_MERGE_HEAD_STATUS_PENDING_JOB,
    eventName: 'pull_request_target',
    repository,
    runId: 9001,
    runAttempt: 1,
    event: event(),
    pullRequest: pullRequest(),
    mainRef: { object: { sha: baseSha } },
    jobs: [],
    ...overrides,
  };
}

test('accepts a pending status only for the exact live PR head and base', () => {
  const result = validateOperatorMergeHeadStatusExecution(input());
  assert.equal(result.ok, true);
  assert.equal(result.sourceHead, sourceHead);
  assert.equal(result.baseSha, baseSha);
});

test('rejects head, base, repository and job identity drift', () => {
  assert.equal(validateOperatorMergeHeadStatusExecution(input({ job: OPERATOR_MERGE_HEAD_STATUS_SUCCESS_JOB })).blocker, 'HEAD_STATUS_JOB_IDENTITY_MISMATCH');
  assert.equal(validateOperatorMergeHeadStatusExecution(input({
    pullRequest: { ...pullRequest(), head: { ...pullRequest().head, sha: 'c'.repeat(40) } },
  })).blocker, 'HEAD_STATUS_PULL_REQUEST_IDENTITY_CHANGED');
  assert.equal(validateOperatorMergeHeadStatusExecution(input({
    mainRef: { object: { sha: 'd'.repeat(40) } },
  })).blocker, 'HEAD_STATUS_LIVE_BASE_CHANGED');
});

test('success status requires the same-run protected gate job to have succeeded', () => {
  const blocked = validateOperatorMergeHeadStatusExecution(input({
    mode: 'success',
    job: OPERATOR_MERGE_HEAD_STATUS_SUCCESS_JOB,
  }));
  assert.equal(blocked.blocker, 'HEAD_STATUS_PROTECTED_GATE_NOT_SUCCESSFUL');
  const ready = validateOperatorMergeHeadStatusExecution(input({
    mode: 'success',
    job: OPERATOR_MERGE_HEAD_STATUS_SUCCESS_JOB,
    jobs: [{ name: OPERATOR_MERGE_HEAD_STATUS_GATE_JOB, status: 'completed', conclusion: 'success' }],
  }));
  assert.equal(ready.ok, true);
});

test('builds and verifies a status bound to the exact head and workflow run', () => {
  const runUrl = 'https://github.com/Cheekyfellastef/stephan-os/actions/runs/9001';
  const payload = buildOperatorMergeHeadStatusPayload({ mode: 'pending', runUrl });
  assert.equal(payload.ok, true);
  assert.equal(payload.context, OPERATOR_MERGE_HEAD_STATUS_CONTEXT);
  const readback = validateOperatorMergeHeadStatusReadback([{
    context: OPERATOR_MERGE_HEAD_STATUS_CONTEXT,
    state: 'pending',
    sha: sourceHead,
    target_url: runUrl,
  }], {
    expectedState: 'pending',
    expectedSha: sourceHead,
    expectedRunUrl: runUrl,
  });
  assert.equal(readback.ok, true);
  assert.equal(validateOperatorMergeHeadStatusReadback([{
    context: OPERATOR_MERGE_HEAD_STATUS_CONTEXT,
    state: 'pending',
    sha: baseSha,
    target_url: runUrl,
  }], {
    expectedState: 'pending',
    expectedSha: sourceHead,
    expectedRunUrl: runUrl,
  }).blocker, 'HEAD_STATUS_SHA_MISMATCH');
});
