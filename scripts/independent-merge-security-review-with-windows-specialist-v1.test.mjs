import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const wrapperUrl = new URL('./independent-merge-security-review-with-windows-specialist-v1.mjs', import.meta.url);

async function source() {
  return readFile(wrapperUrl, 'utf8');
}

test('wrapper is GitHub-Actions-only and preserves the trusted base reviewer', async () => {
  const text = await source();
  assert.match(text, /process\.env\.GITHUB_ACTIONS !== 'true'/);
  assert.match(text, /spawnSync\(process\.execPath, \['scripts\/independent-merge-security-review-v2\.mjs'\]/);
  assert.match(text, /shell: false/);
  assert.match(text, /if \(child\.status === 0\) return;/);
  assert.match(text, /if \(!fs\.existsSync\(artifactPath\)\) process\.exit\(child\.status \|\| 1\);/);
});

test('wrapper can replace only the exact runner-temp immutable artifact', async () => {
  const text = await source();
  assert.match(text, /resolve\(runnerTemp, INDEPENDENT_REVIEW_ARTIFACT_FILE\)/);
  assert.match(text, /resolve\(requested\)/);
  assert.match(text, /if \(expected !== actual\)/);
  assert.match(text, /fs\.rmSync\(path, \{ force: false \}\)/);
  assert.match(text, /flag: 'wx'/);
  assert.match(text, /mode: 0o600/);
  assert.doesNotMatch(text, /writeFileSync\([^,]+,[\s\S]*flag: ['"]w['"]/);
});

test('original findings artifact remains exact-head and digest bound', async () => {
  const text = await source();
  assert.match(text, /stephanos\.independent-review-findings-artifact\.v1/);
  assert.match(text, /stephanos\.independent-review\.findings-artifact/);
  assert.match(text, /artifact\?\.artifactFile !== INDEPENDENT_REVIEW_ARTIFACT_FILE/);
  assert.match(text, /artifact\?\.payloadSha256 !== independentReviewFindingsArtifactPayloadSha256\(artifact\)/);
  assert.match(text, /\^\[a-f0-9\]\{40\}\$/);
  assert.match(text, /typeof artifact\?\.repository !== 'string'/);
  assert.match(text, /Number\.isSafeInteger\(artifact\?\.prNumber\)/);
  assert.match(text, /typeof artifact\?\.branch !== 'string'/);
});

test('production wrapper forwards immutable artifact identity without substitution', async () => {
  const text = await source();
  assert.match(text, /analyzeWindowsAuthoritySpecialistReview\(\{\s*repository: artifact\.repository,\s*prNumber: artifact\.prNumber,\s*branch: artifact\.branch,\s*sourceHead: artifact\.sourceHead,\s*baseSha: artifact\.baseSha,\s*lineageEvidence,/s);
  assert.doesNotMatch(text, /prNumber:\s*1732|branch:\s*['"]agent\/watchdog-control-plane-bootstrap-recovery-v1['"]|sourceHead:\s*['"](?:707f7db9964b5e100aab21d6735108a4c5e53457|a552b13c0a3e6a338d21e8d395dfcf12d12a3475)['"]/);
});

test('source retrieval is one bounded exact-head GitHub Contents GET', async () => {
  const text = await source();
  assert.match(text, /\/contents\/\$\{encodedPath\}\?ref=\$\{encodeURIComponent\(sourceHead\)\}/);
  assert.match(text, /payload\?\.type !== 'file'/);
  assert.match(text, /payload\?\.path !== path/);
  assert.match(text, /payload\?\.encoding !== 'base64'/);
  assert.match(text, /payload\.size > WINDOWS_AUTHORITY_SOURCE_MAX_BYTES/);
  assert.match(text, /bytes\.length !== payload\.size/);
  assert.match(text, /blobSha: text\(payload\.sha\)\.toLowerCase\(\)/);
  assert.doesNotMatch(text, /method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i);
});

test('lineage proof comes only from exact GitHub commit, comparison and current-main reads', async () => {
  const text = await source();
  assert.match(text, /exactReconciliationLineage\(artifact\.repository, artifact\.sourceHead, artifact\.baseSha\)/);
  assert.match(text, /\/git\/commits\/\$\{encodeURIComponent\(sourceHead\)\}/);
  assert.match(text, /\/compare\/\$\{encodeURIComponent\(baseSha\)\}\.\.\.\$\{encodeURIComponent\(sourceHead\)\}/);
  assert.match(text, /\/git\/ref\/heads\/main/);
  assert.match(text, /redirect: 'error'/);
  assert.match(text, /const response = await fetch\(url,[\s\S]*if \(response\.url !== url\)[\s\S]*response\.arrayBuffer\(\)/);
  assert.match(text, /sourceCommitSha: text\(sourceCommit\?\.sha\)\.toLowerCase\(\)/);
  assert.match(text, /liveMainBeforeSha: text\(liveMainBefore\?\.object\?\.sha\)\.toLowerCase\(\)/);
  assert.match(text, /liveMainAfterSha: text\(liveMainAfter\?\.object\?\.sha\)\.toLowerCase\(\)/);
  assert.match(text, /parents: Object\.freeze\(parents\)/);
  assert.match(text, /baseCommitSha: text\(comparison\?\.base_commit\?\.sha\)\.toLowerCase\(\)/);
  assert.match(text, /mergeBaseCommitSha: text\(comparison\?\.merge_base_commit\?\.sha\)\.toLowerCase\(\)/);
  assert.doesNotMatch(text, /lineageEvidence\s*=\s*\{[^}]*a552b13c0a3e6a338d21e8d395dfcf12d12a3475/s);
});

test('wrapper has no repository, merge, deployment, shell or host mutation authority', async () => {
  const text = await source();
  assert.doesNotMatch(text, /gh\s+pr\s+(?:merge|ready)|git\s+(?:push|reset|clean|rebase)|Stop-Process|Restart-Computer|shutdown\.exe|taskkill|Invoke-Expression|\beval\s*\(/i);
  assert.doesNotMatch(text, /contents:\s*write|pull-requests:\s*write|deployments:\s*write/i);
  assert.doesNotMatch(text, /child_process[^\n]*(?:exec|execSync)|spawnSync\([^\n]+shell:\s*true/i);
});

test('non-eligible or non-clean specialist results remain fail closed', async () => {
  const text = await source();
  assert.match(text, /if \(!specialist\.eligible\) process\.exit\(child\.status \|\| 1\);/);
  assert.match(text, /if \(!specialist\.clean\)/);
  assert.match(text, /finalVerdict: 'INDEPENDENT_SECURITY_REVIEW_FINDINGS'/);
  assert.match(text, /process\.exitCode = 1/);
  assert.match(text, /finalVerdict: 'INDEPENDENT_SECURITY_REVIEW_CLEAN'/);
});
