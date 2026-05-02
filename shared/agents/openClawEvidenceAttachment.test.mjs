import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenClawEvidenceAttachment } from './openClawEvidenceAttachment.mjs';

test('attachment model is non-executing', () => {
  const model = buildOpenClawEvidenceAttachment({ source: 'operator' });
  assert.equal(model.executionAllowed, false);
  assert.equal(model.selfModificationAllowed, false);
  assert.equal(model.openClawSelfApprovalAllowed, false);
});
