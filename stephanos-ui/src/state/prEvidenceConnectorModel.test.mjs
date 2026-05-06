import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrEvidenceFromInput, parsePrEvidenceInput } from './prEvidenceConnectorModel.js';

test('GitHub PR URL parsing extracts repo and PR number', () => {
  const parsed = parsePrEvidenceInput('https://github.com/acme/stephan-os/pull/42');
  assert.equal(parsed.detectedRepo, 'acme/stephan-os');
  assert.equal(parsed.detectedPrNumber, 42);
});

test('Codex task URL parsing extracts task ID', () => {
  const parsed = parsePrEvidenceInput('Codex task: https://codex.example/tasks/task_123');
  assert.equal(parsed.detectedCodexTaskId, 'task_123');
});

test('changed files, checks, merge state and auto-merge warning are detected', () => {
  const parsed = parsePrEvidenceInput(`PR: #9\nChecks: pending\nState: merged\n- stephanos-ui/src/state/intentToBuildModel.js\n- apps/stephanos/dist/main.js`);
  assert.equal(parsed.detectedChangedFiles.length, 2);
  assert.equal(parsed.detectedChecksStatus, 'pending');
  assert.equal(parsed.detectedMergeStatus, 'merged');
  assert.equal(parsed.parseWarnings.includes('auto_merge_state_unknown'), true);
});

test('parsed metadata feeds existing prEvidenceIntakeModel', () => {
  const result = buildPrEvidenceFromInput({ rawPrInput: 'https://github.com/acme/stephan-os/pull/19\nChecks: passed\nState: open' });
  assert.equal(result.prEvidenceIntake.prNumber, 19);
  assert.equal(result.prEvidenceIntake.checksStatus, 'passed');
});

test('direct main commits and ignition fetch evidence are parsed into metadata', () => {
  const parsed = parsePrEvidenceInput('Direct main commit: detected\nCommit SHA: a1b2c3d4\nCommit at: 2026-05-06T01:02:03Z\nIgnition fetch evidence: refreshed');
  assert.equal(parsed.normalizedPrMetadata.directMainCommitDetected, true);
  assert.equal(parsed.normalizedPrMetadata.directMainCommitSha, 'a1b2c3d4');
  assert.equal(parsed.normalizedPrMetadata.fetchEvidenceStatus, 'refreshed');
});
