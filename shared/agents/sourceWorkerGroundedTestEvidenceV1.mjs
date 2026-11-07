export const SOURCE_WORKER_GROUNDED_TEST_EVIDENCE_V1_SCHEMA = 'stephanos.source-worker-grounded-test-evidence.v1';

function text(value) { return String(value ?? '').trim(); }

export function buildGroundedSourceTestEvidenceV1(input = {}) {
  const command = text(input.testCommand || input.command);
  const requiredTests = new Set((Array.isArray(input.requiredTests) ? input.requiredTests : []).map(text).filter(Boolean));
  const executionVerified = input.executionVerified === true;

  if (!command || !requiredTests.has(command) || !executionVerified) {
    return Object.freeze({
      schemaVersion: SOURCE_WORKER_GROUNDED_TEST_EVIDENCE_V1_SCHEMA,
      grounded: false,
      testCommand: '',
      blocker: !executionVerified ? 'SOURCE_WORKER_TEST_EXECUTION_NOT_VERIFIED' : 'SOURCE_WORKER_TEST_COMMAND_NOT_REQUIRED',
      finalVerdict: 'SOURCE_WORKER_TEST_EVIDENCE_REJECTED',
    });
  }

  return Object.freeze({
    schemaVersion: SOURCE_WORKER_GROUNDED_TEST_EVIDENCE_V1_SCHEMA,
    grounded: true,
    testCommand: command,
    requirement: text(input.requirement),
    commandOutputHash: text(input.commandOutputHash),
    source: text(input.source, 'mission-worker'),
    createdAt: text(input.createdAt),
    verified: true,
    blocker: '',
    finalVerdict: 'SOURCE_WORKER_TEST_EVIDENCE_GROUNDED',
  });
}
