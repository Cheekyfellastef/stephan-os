import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGithubPrEvidenceProvider, parsePrReferenceFromPrompt } from './githubPrEvidenceProvider.js';

test('parses PR number from merge prompt', () => {
  const r = parsePrReferenceFromPrompt('do i merge PR 123');
  assert.equal(r.prNumber, 123);
});

test('parses PR URL', () => {
  const r = parsePrReferenceFromPrompt('check https://github.com/acme/stephan-os/pull/88');
  assert.equal(r.prNumber, 88);
  assert.equal(r.repo, 'acme/stephan-os');
});

test('handles missing PR safely', () => {
  const r = buildGithubPrEvidenceProvider({ operatorPrompt: 'do i merge this pr' });
  assert.equal(r.mergeReadiness, 'wait');
});

test('handles unavailable connector safely', () => {
  const r = buildGithubPrEvidenceProvider({});
  assert.equal(r.status, 'unavailable');
});

test('failed checks/build/verify and missing browser proof', () => {
  const r = buildGithubPrEvidenceProvider({ connectorEvidence: { prNumber: 1, checksStatus: 'failed', buildStatus: 'failed', verifyStatus: 'failed', browserProofStatus: 'missing' } });
  assert.equal(r.mergeReadiness, 'needs-amendment');
});

test('all proof passed => merge candidate', () => {
  const r = buildGithubPrEvidenceProvider({ connectorEvidence: { prNumber: 1, checksStatus: 'passed', buildStatus: 'passed', verifyStatus: 'passed', browserProofStatus: 'passed' } });
  assert.equal(r.mergeReadiness, 'merge-candidate');
});

test('already merged status', () => {
  const r = buildGithubPrEvidenceProvider({ connectorEvidence: { prNumber: 1, merged: true } });
  assert.equal(r.mergeReadiness, 'already-merged');
});

test('dist-only source truth risk', () => {
  const r = buildGithubPrEvidenceProvider({ connectorEvidence: { prNumber: 1, changedFiles: ['apps/stephanos/dist/x.js'] } });
  assert.equal(r.evidenceWarnings.includes('dist_only_change_source_truth_risk'), true);
});


test('prompt PR without connector returns needs-connector', () => {
  const r = buildGithubPrEvidenceProvider({ operatorPrompt: 'do i merge PR 123' });
  assert.equal(r.status, 'needs-connector');
});
