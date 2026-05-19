import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGithubPrEvidenceProvider, parsePrReferenceFromPrompt, resolveGithubPrEvidenceReadOnly } from './githubPrEvidenceProvider.js';

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


test('read-only adapter contract is explicit and does not allow write actions', () => {
  const r = buildGithubPrEvidenceProvider({ operatorPrompt: 'do i merge PR 123' });
  assert.equal(r.adapterVersion, 'github-pr-evidence-readonly.v1');
  assert.equal(r.readOnly, true);
  assert.equal(r.writeActionsAllowed, false);
  assert.equal(r.status, 'needs-connector');
  assert.equal(r.prTitle, '');
  assert.equal(r.checksStatus, 'unknown');
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

test('live github read-only evidence is normalized and emitted without write actions', () => {
  const r = buildGithubPrEvidenceProvider({
    operatorPrompt: 'do i merge PR 123',
    liveGithubPrEvidence: {
      repo: 'acme/stephan-os',
      prNumber: 123,
      url: 'https://github.com/acme/stephan-os/pull/123',
      title: 'Live evidence wiring',
      state: 'open',
      merged: false,
      headSha: 'abc1234',
      changedFiles: ['stephanos-ui/src/state/prEvidenceConnectorModel.js'],
      checksStatus: 'passed',
      buildStatus: 'passed',
      verifyStatus: 'unknown',
      browserProofStatus: 'unknown',
      failingChecks: [],
      codexTaskPresent: 'yes',
      missingProof: ['verify', 'browser'],
      mergeReadiness: 'hold',
      warnings: ['connector_read_only_mode'],
    },
  });
  assert.equal(r.status, 'fetched');
  assert.equal(r.source, 'github-live-readonly');
  assert.equal(r.repo, 'acme/stephan-os');
  assert.equal(r.prTitle, 'Live evidence wiring');
  assert.equal(r.writeActionsAllowed, false);
  assert.equal(r.readOnly, true);
  assert.equal(r.mergeReadiness, 'needs-proof');
  assert.equal(r.evidenceWarnings.includes('connector_read_only_mode'), true);
});

test('missing proof fields remain unknown and conservative when live evidence is partial', () => {
  const r = buildGithubPrEvidenceProvider({
    operatorPrompt: 'do i merge PR 321',
    liveGithubPrEvidence: { repo: 'acme/stephan-os', prNumber: 321, url: 'https://github.com/acme/stephan-os/pull/321' },
  });
  assert.equal(r.checksStatus, 'unknown');
  assert.equal(r.buildStatus, 'unknown');
  assert.equal(r.verifyStatus, 'unknown');
  assert.equal(r.browserProofStatus, 'unknown');
  assert.equal(r.mergeReadiness, 'needs-proof');
});

test('missing repo returns needs-repo and preserves parsed PR number', async () => {
  const connectorEvidence = await resolveGithubPrEvidenceReadOnly({
    prompt: 'do i merge PR 123',
    connectorAvailable: true,
    hasToken: true,
    fetchGithubPrEvidence: async () => ({ title: 'unused' }),
  });
  const r = buildGithubPrEvidenceProvider({ operatorPrompt: 'do i merge PR 123', connectorEvidence });
  assert.equal(r.status, 'needs-repo');
  assert.equal(r.prNumber, 123);
  assert.equal(r.parsedPrNumber, 123);
});

test('missing token/connector returns needs-configuration or needs-connector and preserves PR number', async () => {
  const missingConnector = await resolveGithubPrEvidenceReadOnly({ prompt: 'do i merge PR 123', repo: 'acme/stephan-os', connectorAvailable: false });
  const r1 = buildGithubPrEvidenceProvider({ operatorPrompt: 'do i merge PR 123', connectorEvidence: missingConnector });
  assert.equal(r1.status, 'needs-connector');
  assert.equal(r1.prNumber, 123);

  const missingToken = await resolveGithubPrEvidenceReadOnly({ prompt: 'do i merge PR 123', repo: 'acme/stephan-os', connectorAvailable: true, hasToken: false });
  const r2 = buildGithubPrEvidenceProvider({ operatorPrompt: 'do i merge PR 123', connectorEvidence: missingToken });
  assert.equal(r2.status, 'needs-configuration');
  assert.equal(r2.prNumber, 123);
});

test('mocked read-only fetch populates title/state/checks/files and keeps no-write contract', async () => {
  const connectorEvidence = await resolveGithubPrEvidenceReadOnly({
    prompt: 'do i merge PR 123',
    repo: 'acme/stephan-os',
    connectorAvailable: true,
    hasToken: true,
    fetchGithubPrEvidence: async () => ({
      title: 'Wire live PR evidence',
      state: 'open',
      merged: false,
      headSha: 'abc1234',
      changedFiles: ['stephanos-ui/src/state/githubPrEvidenceProvider.js'],
      checksStatus: 'failed',
      failingChecks: ['build'],
      buildStatus: 'failed',
      verifyStatus: 'passed',
      browserProofStatus: 'missing',
    }),
  });
  const r = buildGithubPrEvidenceProvider({ operatorPrompt: 'do i merge PR 123', connectorEvidence });
  assert.equal(r.status, 'fetched');
  assert.equal(r.prTitle, 'Wire live PR evidence');
  assert.equal(r.prState, 'open');
  assert.equal(r.changedFileCount, 1);
  assert.equal(r.checksStatus, 'failed');
  assert.deepEqual(r.failingChecks, ['build']);
  assert.equal(r.mergeReadiness, 'needs-amendment');
  assert.equal(r.writeActionsAllowed, false);
});


test('backend needs-pr-number status is preserved in provider output', () => {
  const r = buildGithubPrEvidenceProvider({ connectorEvidence: { status: 'needs-pr-number', source: 'none' }, operatorPrompt: 'merge this' });
  assert.equal(r.status, 'needs-pr-number');
  assert.equal(r.mergeReadiness, 'wait');
});
