import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SHARED_WORKSPACE_QA_ANSWER_DIAGNOSTIC_SCHEMA_VERSION,
  buildSharedWorkspaceQaAnswerDiagnosticV1,
} from './sharedWorkspaceQaAnswerDiagnosticV1.mjs';

test('Q&A rejection diagnostic preserves only bounded classification and sanitized errors', () => {
  const diagnostic = buildSharedWorkspaceQaAnswerDiagnosticV1({
    classification: 'AI_RESPONSE_REJECTED_AS_NON_DATA',
    errors: [
      'ai-response.output_text-must-be-string',
      'ai-response.output_text-must-be-string',
      'x'.repeat(500),
      'credential=secret-value',
      'C:\\Users\\operator\\private.txt',
      ...Array.from({ length: 20 }, (_, index) => `bounded-error-${index}`),
    ],
    providerRaw: { mustNotAppear: true },
  });

  assert.equal(diagnostic.schemaVersion, SHARED_WORKSPACE_QA_ANSWER_DIAGNOSTIC_SCHEMA_VERSION);
  assert.equal(diagnostic.classification, 'AI_RESPONSE_REJECTED_AS_NON_DATA');
  assert.equal(diagnostic.errors.length, 8);
  assert.equal(diagnostic.errors[0], 'ai-response.output_text-must-be-string');
  assert.equal(diagnostic.errors[1].length, 240);
  assert.equal(JSON.stringify(diagnostic).includes('credential'), false);
  assert.equal(JSON.stringify(diagnostic).includes('Users'), false);
  assert.equal(Object.hasOwn(diagnostic, 'providerRaw'), false);
});

test('Q&A rejection diagnostic rejects malformed or unsafe classifications', () => {
  assert.equal(buildSharedWorkspaceQaAnswerDiagnosticV1(null), null);
  assert.equal(buildSharedWorkspaceQaAnswerDiagnosticV1({ classification: 'not safe text!' }), null);
  const diagnostic = buildSharedWorkspaceQaAnswerDiagnosticV1({ errors: ['answer-record-missing'] });
  assert.equal(diagnostic.classification, 'WORKSPACE_QA_COGNITION_REJECTED_UNCLASSIFIED');
});
