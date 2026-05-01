import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenClawProposalEvidence } from './openClawProposalEvidence.mjs';

test('evidence normalization and warnings', () => {
  const ev = buildOpenClawProposalEvidence({ evidenceType: 'readonly_validation', evidenceStatus: 'succeeded', summary: 'ok' });
  assert.equal(ev.evidenceType, 'readonly_validation');
  assert.equal(ev.evidenceStatus, 'succeeded');
  const missing = buildOpenClawProposalEvidence({ evidenceType: 'capability_trial' });
  assert.ok(missing.warnings.includes('missing_summary'));
  const unknown = buildOpenClawProposalEvidence({ evidenceType: 'unknown_type' });
  assert.equal(unknown.evidenceStatus, 'blocked');
});
