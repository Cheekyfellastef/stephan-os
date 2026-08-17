import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const reviewerUrl = new URL('./independent-merge-security-review-v2.mjs', import.meta.url);

async function source() {
  return readFile(reviewerUrl, 'utf8');
}

test('deterministic review runs before specialist review-estate retrieval', async () => {
  const text = await source();
  const deterministicIndex = text.indexOf('const deterministicAnalysis = analyzeIndependentSecurityReview({');
  const specialistPathsIndex = text.indexOf('const specialistPaths = qualifiedSpecialistEscalationPaths(deterministicAnalysis);');
  const reviewReadIndex = text.indexOf('githubPages(`/repos/${owner}/${repo}/pulls/${prNumber}/reviews`)');

  assert.ok(deterministicIndex >= 0, 'deterministic analysis must exist');
  assert.ok(specialistPathsIndex > deterministicIndex, 'specialist eligibility must be derived from deterministic analysis');
  assert.ok(reviewReadIndex > specialistPathsIndex, 'review estate must be read only after specialist eligibility is known');
  assert.equal(text.indexOf('/pulls/${prNumber}/reviews'), reviewReadIndex + 'githubPages(`/repos/${owner}/${repo}'.length);
});

test('review estate is loaded only for an exact qualified-specialist escalation', async () => {
  const text = await source();
  assert.match(text, /qualifiedSpecialistEscalationPaths,/);
  assert.match(text, /const reviews = specialistPaths\.length > 0\s*\? await githubPages\(`\/repos\/\$\{owner\}\/\$\{repo\}\/pulls\/\$\{prNumber\}\/reviews`\)\s*:\s*\[\];/s);
  assert.match(text, /analysis: deterministicAnalysis,\s*reviews,/s);
  assert.match(text, /SPECIALIST_REVIEW_ESTATE=\$\{specialistPaths\.length > 0 \? 'LOADED' : 'NOT_REQUIRED'\}/);
});

test('ordinary clean and approval-boundary analysis no longer depend on the REST reviews endpoint', async () => {
  const text = await source();
  const initialPromise = text.match(/const \[files, diff\] = await Promise\.all\(\[([\s\S]*?)\]\);/);
  assert.ok(initialPromise, 'initial immutable-head reads must fetch files and diff');
  assert.doesNotMatch(initialPromise[1], /reviews/);
  assert.match(text, /const bootstrapRequired = isApprovalBoundaryBootstrapAnalysis\(analysis\);/);
});

test('lazy specialist repair preserves fail-closed review and has no merge or host authority', async () => {
  const text = await source();
  assert.match(text, /writeInfrastructureBlockedArtifact\(error\)/);
  assert.match(text, /process\.exitCode = 1/);
  assert.doesNotMatch(text, /gh\s+pr\s+merge|git\s+(?:push|reset|clean|rebase)|Restart-Computer|Stop-Process|shutdown\.exe|taskkill|Invoke-Expression|\beval\s*\(/i);
});
