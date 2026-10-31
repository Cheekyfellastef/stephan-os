import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const entry = readFileSync(new URL('./independent-merge-security-review-entry-v1.mjs', import.meta.url), 'utf8');
const specialist = readFileSync(new URL('./independent-merge-security-review-with-mission-worker-restart-specialist-v1.mjs', import.meta.url), 'utf8');

test('independent review composes the bounded Mission Worker restart specialist after existing specialists', () => {
  assert.match(entry, /independent-merge-security-review-with-mission-worker-restart-specialist-v1\.mjs/);
  assert.match(specialist, /const PRIOR_WRAPPER = 'scripts\/independent-merge-security-review-with-openclaw-specialist-v1\.mjs'/);
  assert.match(specialist, /const PR_NUMBER = 2222/);
  assert.match(specialist, /const BRANCH = 'fix\/mission-worker-watchdog-restart-v1'/);
  assert.match(specialist, /db925d47dad89fe14ae12b7c3b8d83504c03f049/);
  assert.match(specialist, /cab526079839ccc0da0d50607d304ca7a033f6eb/);
});

test('specialist preserves exact-current-main and source-identity gates without Codex qualification', () => {
  assert.match(specialist, /parents\.includes\(baseSha\)/);
  assert.match(specialist, /behindBy === 0/);
  assert.match(specialist, /source\.blobSha !== EXPECTED_BLOBS\[source\.path\]/);
  assert.match(specialist, /reviewCurrentWorkerWatchdogSourceSemanticsV2/);
  assert.match(specialist, /System\\\.Diagnostics\\\.Process/);
  assert.match(specialist, /Get-CimInstance/);
  assert.doesNotMatch(specialist, /@codex|chatgpt-codex-connector|Codex Review:/i);
});

test('specialist remains review-only', () => {
  assert.doesNotMatch(specialist, /git\s+(?:push|merge|reset|rebase)|gh\s+pr\s+merge|UPDATE_STEPHANOS_FROM_CHAT|Start-ScheduledTask/i);
  assert.match(specialist, /buildIndependentReviewArtifact/);
  assert.match(specialist, /buildIndependentReviewFindingsArtifact/);
});
