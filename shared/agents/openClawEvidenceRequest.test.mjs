import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenClawEvidenceRequest } from './openClawEvidenceRequest.mjs';

test('needs_more_evidence yields requested by default', () => {
  const model = buildOpenClawEvidenceRequest({}, { reviewDecision: 'needs_more_evidence', packetId: 'p1' });
  assert.equal(model.requestStatus, 'requested');
  assert.equal(model.executionAllowed, false);
});

test('provided evidence yields satisfied', () => {
  const model = buildOpenClawEvidenceRequest({ evidenceNeeded: ['operator_note'] }, { reviewDecision: 'needs_more_evidence', packetId: 'p1', attachments: [{ evidenceType: 'operator_note' }] });
  assert.equal(model.requestStatus, 'satisfied');
});
