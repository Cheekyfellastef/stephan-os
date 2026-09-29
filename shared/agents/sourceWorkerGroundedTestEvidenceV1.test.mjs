import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGroundedSourceTestEvidenceV1 } from './sourceWorkerGroundedTestEvidenceV1.mjs';

const requiredTests = ['node --test focused.test.mjs'];

test('preserves an exact required command only when execution is grounded', () => {
  const result = buildGroundedSourceTestEvidenceV1({
    requiredTests,
    testCommand: 'node --test focused.test.mjs',
    executionVerified: true,
    requirement: 'focused evidence',
    commandOutputHash: 'a'.repeat(64),
    source: 'codex-cli',
    createdAt: '2026-09-10T16:58:00.000Z',
  });
  assert.equal(result.grounded, true);
  assert.equal(result.verified, true);
  assert.equal(result.testCommand, requiredTests[0]);
  assert.equal(result.finalVerdict, 'SOURCE_WORKER_TEST_EVIDENCE_GROUNDED');
});

test('rejects a command that is not one of the exact required tests', () => {
  const result = buildGroundedSourceTestEvidenceV1({
    requiredTests,
    testCommand: 'node --test different.test.mjs',
    executionVerified: true,
  });
  assert.equal(result.grounded, false);
  assert.equal(result.finalVerdict, 'SOURCE_WORKER_TEST_EVIDENCE_REJECTED');
});

test('rejects an exact command when execution itself is not verified', () => {
  const result = buildGroundedSourceTestEvidenceV1({
    requiredTests,
    testCommand: requiredTests[0],
    executionVerified: false,
  });
  assert.equal(result.grounded, false);
  assert.equal(result.blocker, 'SOURCE_WORKER_TEST_EXECUTION_NOT_VERIFIED');
});
