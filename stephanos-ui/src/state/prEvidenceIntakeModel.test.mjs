import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrEvidenceIntake } from './prEvidenceIntakeModel.js';

test('missing metadata => no_pr_evidence', () => {
  const r = buildPrEvidenceIntake({});
  assert.equal(r.normalizedStatus, 'no_pr_evidence');
});

test('merged metadata normalizes and warns when authority missing', () => {
  const r = buildPrEvidenceIntake({ prMetadata: { merged: true, mergedAt: '2026-05-01T00:00:00Z', autoMergeState: 'unknown' }, missionSpec: { finishAuthority: {} } });
  assert.equal(r.normalizedStatus, 'merged');
  assert.equal(r.evidenceWarnings.includes('merged_without_recorded_mission_authority'), true);
  assert.equal(r.evidenceWarnings.includes('auto_merge_state_unknown'), true);
});

test('closed unmerged and checks failed statuses', () => {
  assert.equal(buildPrEvidenceIntake({ prMetadata: { state: 'closed', merged: false } }).normalizedStatus, 'closed_unmerged');
  assert.equal(buildPrEvidenceIntake({ prMetadata: { checksStatus: 'failed' } }).normalizedStatus, 'checks_failed');
});

test('passed checks => merge_ready_candidate and dist detection + codex extraction', () => {
  const r = buildPrEvidenceIntake({ prMetadata: { checksStatus: 'passed', files: ['apps/stephanos/dist/a.js'], body: 'codex task: abc123 https://codex.example/task/abc123' } });
  assert.equal(r.normalizedStatus, 'merge_ready_candidate');
  assert.equal(r.evidenceWarnings.some((w) => w.startsWith('generated_dist_files_detected')), true);
  assert.equal(r.codexTaskId, 'abc123');
  assert.match(r.codexTaskUrl, /codex/);
});

test('changed file scope warning with architecture context', () => {
  const r = buildPrEvidenceIntake({ prMetadata: { files: ['random/file.js'] }, missionSpec: { repoArchitectureContext: { sourceFilesLikelyTouched: ['stephanos-ui/src/state/intentToBuildModel.js'] } } });
  assert.equal(r.evidenceWarnings.some((w) => w.startsWith('changed_files_outside_likely_scope:')), true);
});
