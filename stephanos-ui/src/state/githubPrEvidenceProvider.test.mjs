import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGithubPrEvidenceProvider, parsePrReferenceFromPrompt } from './githubPrEvidenceProvider.js';

test('parses PR number from merge prompt', () => {
  const r = parsePrReferenceFromPrompt('do i merge PR 123');
  assert.equal(r.prNumber, 123);
  assert.equal(r.parseConfidence, 'high');
});

test('parses lowercase PR in merge prompt', () => {
  const r = parsePrReferenceFromPrompt('do i merge pr 123');
  assert.equal(r.prNumber, 123);
});

test('parses check PR prompt', () => {
  const r = parsePrReferenceFromPrompt('check PR 123');
  assert.equal(r.prNumber, 123);
});

test('parses PR URL', () => {
  const r = parsePrReferenceFromPrompt('check https://github.com/acme/stephan-os/pull/88');
  assert.equal(r.prNumber, 88);
  assert.equal(r.repo, 'acme/stephan-os');
  assert.equal(r.parseConfidence, 'high');
});


test('parses review/is-merge-ready variants', () => {
  assert.equal(parsePrReferenceFromPrompt('review PR 321').prNumber, 321);
  assert.equal(parsePrReferenceFromPrompt('is PR 222 merge ready').prNumber, 222);
});

test('parses retrieval/raw/normalized prompt fallbacks in precedence order', () => {
  const viaRetrieval = buildGithubPrEvidenceProvider({ retrieval_query: 'do i merge PR 901' });
  assert.equal(viaRetrieval.prNumber, 901);
  assert.equal(viaRetrieval.parsedPrNumber, 901);

  const viaRaw = buildGithubPrEvidenceProvider({ raw_input: 'check PR 902' });
  assert.equal(viaRaw.prNumber, 902);

  const viaNormalized = buildGithubPrEvidenceProvider({ normalizedOperatorMessage: 'do i merge pr 903' });
  assert.equal(viaNormalized.prNumber, 903);
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
  assert.equal(r.prNumber, 123);
});


test('parses PR number from operatorMessage fallback and preserves parsedPrNumber', () => {
  const r = buildGithubPrEvidenceProvider({ operatorMessage: 'do i merge PR 123' });
  assert.equal(r.prNumber, 123);
  assert.equal(r.parsedPrNumber, 123);
  assert.equal(r.status, 'needs-connector');
});

test('parses PR number from matchInput fallback', () => {
  const r = buildGithubPrEvidenceProvider({ matchInput: 'do i merge pr 456' });
  assert.equal(r.prNumber, 456);
  assert.equal(r.parsedPrNumber, 456);
});

test('preserves parsed PR number from chat context match input when connector is unavailable', () => {
  const r = buildGithubPrEvidenceProvider({ chat_context_match_input: 'do i merge PR 123' });
  assert.equal(r.status, 'needs-connector');
  assert.equal(r.source, 'none');
  assert.equal(r.prNumber, 123);
  assert.equal(r.parsedPrNumber, 123);
  assert.equal(r.parseConfidence, 'high');
  assert.equal(r.parsedNumberSource, 'operator-input');
});
