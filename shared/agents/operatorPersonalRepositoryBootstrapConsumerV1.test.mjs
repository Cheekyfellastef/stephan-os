import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const consumerUrl = new URL('../../scripts/operator-protected-personal-repository-merge.mjs', import.meta.url);

async function source() {
  return readFile(consumerUrl, 'utf8');
}

test('personal repository consumer delegates review mode admission to the closed-world classifier', async () => {
  const text = await source();
  assert.match(text, /OPERATOR_MERGE_ENVIRONMENT,/);
  assert.match(text, /validatePersonalRepositoryReviewAdmission/);
  assert.match(text, /async function loadSelectedIndependentReview\(context, identity, environmentName\)/);
  assert.match(text, /const admission = validatePersonalRepositoryReviewAdmission\(\{ artifact, validation \}, \{/);
  assert.match(text, /protectedEnvironmentAdmitted: environmentName === OPERATOR_MERGE_ENVIRONMENT/);
  assert.match(text, /environmentName,/);
  assert.doesNotMatch(text, /artifact\.reviewMode !== 'clean-independent'/);
  assert.doesNotMatch(text, /artifact\.receipt\?\.verdict !== 'clean'/);
});

test('live protected environment identity is carried into review admission', async () => {
  const text = await source();
  assert.match(text, /const independentReview = await loadSelectedIndependentReview\(\s*context,\s*evidence\.identity,\s*text\(environment\?\.name\),\s*\);/s);
  assert.match(text, /const configuration = await collectRulesetConfiguration\(\s*context,\s*repository,\s*environment,\s*integrationId,\s*\);/s);
  assert.ok(text.indexOf('const configuration = await collectRulesetConfiguration(') < text.indexOf('const independentReview = await loadSelectedIndependentReview('));
});

test('bootstrap mode and exact findings are evidence-bound rather than erased', async () => {
  const text = await source();
  assert.match(text, /reviewMode: admission\.reviewMode/);
  assert.match(text, /findings: admission\.findings/);
  assert.match(text, /operatorProtectedApprovalRequired: admission\.operatorProtectedApprovalRequired/);
  assert.match(text, /configurationSnapshotSha256: configuration\.configurationSnapshotSha256,[\s\S]*workflows: workflows\.evidence,[\s\S]*independentReview,/s);
  assert.doesNotMatch(text, /findings:\s*Object\.freeze\(\[\]\)/);
});

test('review admission remains non-authorizing and final merge stays exact-head squash only', async () => {
  const text = await source();
  assert.match(text, /if \(!validation\.valid[\s\S]*\|\| artifact\.payloadSha256 !== selected\.independentReviewPayloadSha256[\s\S]*\|\| !admission\.valid\)/s);
  assert.match(text, /fail\('Selected independent review payload is invalid, stale or not admitted by the protected review boundary\.'/);
  assert.match(text, /method: 'PUT',[\s\S]*merge_method: 'squash',[\s\S]*sha: receipt\.sourceHead/s);
  assert.doesNotMatch(text, /git\s+(?:push|reset|clean|rebase)|gh\s+pr\s+merge|Restart-Computer|Stop-Process|shutdown\.exe|taskkill|Invoke-Expression|\beval\s*\(/i);
});
