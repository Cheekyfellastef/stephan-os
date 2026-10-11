import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const wrapperUrl = new URL('./independent-merge-security-review-with-openclaw-specialist-v1.mjs', import.meta.url);
const entryUrl = new URL('./independent-merge-security-review-entry-v1.mjs', import.meta.url);
const missionWorkerRestartSpecialistUrl = new URL('./independent-merge-security-review-with-mission-worker-restart-specialist-v1.mjs', import.meta.url);

async function source() {
  return readFile(wrapperUrl, 'utf8');
}

test('OpenClaw specialist composes after the existing Windows specialist wrapper', async () => {
  const text = await source();
  assert.match(text, /const PRIOR_WRAPPER = 'scripts\/independent-merge-security-review-with-windows-specialist-v1\.mjs'/);
  assert.match(text, /spawnSync\(process\.execPath, \[PRIOR_WRAPPER\]/);
  assert.match(text, /shell: false/);
  assert.match(text, /if \(child\.status === 0\) return;/);
  assert.match(text, /if \(!fs\.existsSync\(artifactPath\)\) process\.exit\(child\.status \|\| 1\);/);
});

test('OpenClaw specialist can act only on an exact digest-bound findings artifact', async () => {
  const text = await source();
  assert.match(text, /stephanos\.independent-review-findings-artifact\.v1/);
  assert.match(text, /stephanos\.independent-review\.findings-artifact/);
  assert.match(text, /artifact\?\.payloadSha256 !== independentReviewFindingsArtifactPayloadSha256\(artifact\)/);
  assert.match(text, /analyzeOpenClawBuilderProviderSpecialistReviewV1/);
  assert.match(text, /if \(!probe\.eligible\) process\.exit\(child\.status \|\| 1\);/);
  assert.match(text, /if \(!specialist\.eligible\) process\.exit\(child\.status \|\| 1\);/);
});

test('OpenClaw specialist source reads are bounded exact-head GitHub reads', async () => {
  const text = await source();
  assert.match(text, /\/contents\/\$\{encodedPath\}\?ref=\$\{encodeURIComponent\(sourceHead\)\}/);
  assert.match(text, /payload\?\.type !== 'file'/);
  assert.match(text, /payload\?\.path !== path/);
  assert.match(text, /payload\?\.encoding !== 'base64'/);
  assert.match(text, /payload\.size > WINDOWS_AUTHORITY_SOURCE_MAX_BYTES/);
  assert.match(text, /redirect: 'error'/);
  assert.doesNotMatch(text, /method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i);
});

test('OpenClaw specialist re-proves current main and exact reconciliation lineage', async () => {
  const text = await source();
  assert.match(text, /exactReconciliationLineage\(artifact\.repository, artifact\.sourceHead, artifact\.baseSha\)/);
  assert.match(text, /\/git\/ref\/heads\/main/);
  assert.match(text, /\/git\/commits\/\$\{encodeURIComponent\(sourceHead\)\}/);
  assert.match(text, /\/compare\/\$\{encodeURIComponent\(baseSha\)\}\.\.\.\$\{encodeURIComponent\(sourceHead\)\}/);
  assert.match(text, /liveMainBeforeSha/);
  assert.match(text, /liveMainAfterSha/);
});

test('replacement artifact remains exact runner-temp exclusive and fail closed on findings', async () => {
  const text = await source();
  assert.match(text, /resolve\(runnerTemp, INDEPENDENT_REVIEW_ARTIFACT_FILE\)/);
  assert.match(text, /fs\.rmSync\(path, \{ force: false \}\)/);
  assert.match(text, /flag: 'wx'/);
  assert.match(text, /mode: 0o600/);
  assert.match(text, /if \(!specialist\.clean\)/);
  assert.match(text, /finalVerdict: 'INDEPENDENT_SECURITY_REVIEW_FINDINGS'/);
  assert.match(text, /process\.exitCode = 1/);
  assert.match(text, /finalVerdict: 'INDEPENDENT_SECURITY_REVIEW_CLEAN'/);
});

test('wrapper grants no repository, merge, deployment or host mutation authority', async () => {
  const text = await source();
  assert.doesNotMatch(text, /gh\s+pr\s+(?:merge|ready)|git\s+(?:push|reset|clean|rebase)|Stop-Process|Restart-Computer|shutdown\.exe|taskkill|Invoke-Expression|\beval\s*\(/i);
  assert.doesNotMatch(text, /contents:\s*write|pull-requests:\s*write|deployments:\s*write/i);
  assert.doesNotMatch(text, /spawnSync\([^\n]+shell:\s*true/i);
});

test('mandatory OpenClaw preflight also proves the bounded Mission Worker restart specialist', async () => {
  const [entry, specialist] = await Promise.all([
    readFile(entryUrl, 'utf8'),
    readFile(missionWorkerRestartSpecialistUrl, 'utf8'),
  ]);
  assert.match(entry, /independent-merge-security-review-with-mission-worker-restart-specialist-v1\.mjs/);
  assert.match(specialist, /const PRIOR_WRAPPER = 'scripts\/independent-merge-security-review-with-openclaw-specialist-v1\.mjs'/);
  assert.match(specialist, /const PR_NUMBER = 2222/);
  assert.match(specialist, /const BRANCH = 'fix\/mission-worker-watchdog-restart-v1'/);
  assert.match(specialist, /db925d47dad89fe14ae12b7c3b8d83504c03f049/);
  assert.match(specialist, /cab526079839ccc0da0d50607d304ca7a033f6eb/);
  assert.match(specialist, /parents\.includes\(baseSha\)/);
  assert.match(specialist, /behindBy === 0/);
  assert.match(specialist, /source\.blobSha !== EXPECTED_BLOBS\[source\.path\]/);
  assert.match(specialist, /reviewCurrentWorkerWatchdogSourceSemanticsV2/);
  assert.match(specialist, /System\\\.Diagnostics\\\.Process/);
  assert.match(specialist, /Get-CimInstance/);
  assert.doesNotMatch(specialist, /@codex|chatgpt-codex-connector|Codex Review:/i);
  assert.doesNotMatch(specialist, /git\s+(?:push|merge|reset|rebase)|gh\s+pr\s+merge|UPDATE_STEPHANOS_FROM_CHAT|Start-ScheduledTask/i);
  assert.match(specialist, /buildIndependentReviewArtifact/);
  assert.match(specialist, /buildIndependentReviewFindingsArtifact/);
});
