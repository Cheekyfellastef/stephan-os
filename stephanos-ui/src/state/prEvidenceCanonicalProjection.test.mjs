import test from 'node:test';
import assert from 'node:assert/strict';
import { projectCanonicalPrEvidence } from './prEvidenceCanonicalProjection.js';

test('disabled live fetch keeps evidence unavailable and unknown truth', () => {
  const out = projectCanonicalPrEvidence({
    prEvidence: { prNumber: 970, parsedPrNumber: 970, status: 'parsed' },
    githubPrEvidence: { status: 'needs-connector', source: 'connector-manual-disabled' },
  });
  assert.equal(out.status, 'evidence-unavailable');
  assert.equal(out.mergeReadiness, 'hold');
  assert.equal(out.evidenceTruthStatus, 'unknown-disabled');
  assert.equal(out.verificationSource, 'parsed-only');
});

test('operator supplied merged evidence resolves already merged', () => {
  const out = projectCanonicalPrEvidence({
    prEvidence: { prNumber: 970 },
    githubPrEvidence: { status: 'fetched', source: 'operator-supplied-readonly', prState: 'closed', merged: true },
  });
  assert.equal(out.merged, true);
  assert.equal(out.mergeReadiness, 'already-merged');
  assert.equal(out.evidenceTruthStatus, 'known-merged');
});
