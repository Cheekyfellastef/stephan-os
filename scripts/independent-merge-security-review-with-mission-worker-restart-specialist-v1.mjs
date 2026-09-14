#!/usr/bin/env node

import fs from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { TextDecoder } from 'node:util';
import {
  INDEPENDENT_REVIEW_ARTIFACT_FILE,
  buildIndependentReviewArtifact,
  buildIndependentReviewFindingsArtifact,
  independentReviewFindingsArtifactPayloadSha256,
} from '../shared/agents/operatorMergeReviewArtifactV1.mjs';
import { reviewCurrentWorkerWatchdogSourceSemanticsV2 } from '../shared/agents/windowsAuthorityWorkerWatchdogReviewV2.mjs';

const PRIOR_WRAPPER = 'scripts/independent-merge-security-review-with-openclaw-specialist-v1.mjs';
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const PR_NUMBER = 2222;
const BRANCH = 'fix/mission-worker-watchdog-restart-v1';
const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const LINEAGE_SCHEMA = 'stephanos.windows-authority-reconciliation-lineage.v1';
const SHA = /^[a-f0-9]{40}$/;
const PATHS = Object.freeze([
  'scripts/windows/probe-mission-orchestrator-worker-watchdog.ps1',
  'scripts/windows/restart-approved-stephanos-runtime.ps1',
]);
const EXPECTED_BLOBS = Object.freeze({
  'scripts/windows/probe-mission-orchestrator-worker-watchdog.ps1': 'db925d47dad89fe14ae12b7c3b8d83504c03f049',
  'scripts/windows/restart-approved-stephanos-runtime.ps1': 'cab526079839ccc0da0d50607d304ca7a033f6eb',
});
const MAX_SOURCE_BYTES = 256 * 1024;
const text = (value) => String(value ?? '').trim();
const unique = (values) => [...new Set(values)];

function exactArtifactPath() {
  const runnerTemp = text(process.env.RUNNER_TEMP);
  const requested = text(process.env.STEPHANOS_INDEPENDENT_REVIEW_ARTIFACT_PATH);
  if (!runnerTemp || !requested) throw new Error('Independent review artifact path is required.');
  const expected = resolve(runnerTemp, INDEPENDENT_REVIEW_ARTIFACT_FILE);
  const actual = resolve(requested);
  if (expected !== actual) throw new Error('Independent review artifact path must remain the exact runner-temp result file.');
  return actual;
}

function writeReplacementArtifact(path, artifact) {
  fs.rmSync(path, { force: false });
  fs.writeFileSync(path, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
}

function counts(findings) {
  return Object.freeze({
    P0: findings.filter((item) => item.severity === 'P0').length,
    P1: findings.filter((item) => item.severity === 'P1').length,
    P2: findings.filter((item) => item.severity === 'P2').length,
  });
}

async function githubJson(path, maxBytes = MAX_SOURCE_BYTES * 2) {
  const token = text(process.env.GH_TOKEN || process.env.GITHUB_TOKEN);
  if (!token) throw new Error('GitHub token is required for Mission Worker restart specialist review.');
  const url = `https://api.github.com${path}`;
  const response = await fetch(url, {
    redirect: 'error',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'stephanos-mission-worker-restart-specialist-v1',
    },
  });
  if (response.url !== url) throw new Error('Specialist GitHub response URL changed.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw new Error(`GitHub response exceeded ${maxBytes} bytes.`);
  const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (!response.ok) throw new Error(`GitHub GET ${path} failed (${response.status}): ${raw.slice(0, 300)}`);
  return JSON.parse(raw);
}

function strictBase64(value, path) {
  const encoded = String(value ?? '').replace(/\s/g, '');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error(`Source ${path} is not canonical base64.`);
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded) throw new Error(`Source ${path} base64 is not canonical.`);
  return bytes;
}

async function exactHeadSource(repository, path, sourceHead) {
  const [owner, repo] = repository.split('/');
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const payload = await githubJson(`/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(sourceHead)}`, Math.ceil(MAX_SOURCE_BYTES * 4 / 3) + 65_536);
  if (payload?.type !== 'file' || payload?.path !== path || payload?.encoding !== 'base64'
    || !Number.isSafeInteger(payload?.size) || payload.size <= 0 || payload.size > MAX_SOURCE_BYTES
    || !SHA.test(text(payload?.sha))) throw new Error(`Source ${path} is not one bounded exact-head file.`);
  const bytes = strictBase64(payload.content, path);
  if (bytes.length !== payload.size) throw new Error(`Source ${path} size mismatch.`);
  return Object.freeze({
    schemaVersion: SOURCE_SCHEMA,
    repository,
    path,
    ref: sourceHead,
    exists: true,
    size: bytes.length,
    blobSha: text(payload.sha).toLowerCase(),
    content: new TextDecoder('utf-8', { fatal: true }).decode(bytes),
  });
}

async function exactReconciliationLineage(repository, sourceHead, baseSha) {
  const [owner, repo] = repository.split('/');
  const liveMainBefore = await githubJson(`/repos/${owner}/${repo}/git/ref/heads/main`, 65_536);
  const [sourceCommit, comparison] = await Promise.all([
    githubJson(`/repos/${owner}/${repo}/git/commits/${encodeURIComponent(sourceHead)}`, 65_536),
    githubJson(`/repos/${owner}/${repo}/compare/${encodeURIComponent(baseSha)}...${encodeURIComponent(sourceHead)}`, 2 * 1024 * 1024),
  ]);
  const liveMainAfter = await githubJson(`/repos/${owner}/${repo}/git/ref/heads/main`, 65_536);
  return Object.freeze({
    schemaVersion: LINEAGE_SCHEMA,
    repository,
    sourceHead,
    sourceCommitSha: text(sourceCommit?.sha).toLowerCase(),
    baseSha,
    liveMainBeforeSha: text(liveMainBefore?.object?.sha).toLowerCase(),
    liveMainAfterSha: text(liveMainAfter?.object?.sha).toLowerCase(),
    parents: Object.freeze((sourceCommit?.parents || []).map((item) => text(item?.sha).toLowerCase())),
    comparison: Object.freeze({
      status: text(comparison?.status).toLowerCase(),
      aheadBy: comparison?.ahead_by,
      behindBy: comparison?.behind_by,
      baseCommitSha: text(comparison?.base_commit?.sha).toLowerCase(),
      mergeBaseCommitSha: text(comparison?.merge_base_commit?.sha).toLowerCase(),
    }),
  });
}

function validateFindingsArtifact(artifact) {
  if (artifact?.schemaVersion !== 'stephanos.independent-review-findings-artifact.v1'
    || artifact?.kind !== 'stephanos.independent-review.findings-artifact'
    || artifact?.artifactFile !== INDEPENDENT_REVIEW_ARTIFACT_FILE
    || artifact?.repository !== REPOSITORY || artifact?.prNumber !== PR_NUMBER || artifact?.branch !== BRANCH
    || !SHA.test(text(artifact?.sourceHead)) || !SHA.test(text(artifact?.baseSha))
    || artifact?.payloadSha256 !== independentReviewFindingsArtifactPayloadSha256(artifact)) {
    throw new Error('Mission Worker restart findings artifact identity is invalid.');
  }
  return artifact;
}

function exactEscalation(analysis = {}) {
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  const paths = findings.map((item) => text(item?.path)).sort();
  return findings.length === 2
    && findings.every((item) => text(item?.severity).toUpperCase() === 'P0' && text(item?.code) === 'unsupported-high-risk-surface')
    && JSON.stringify(paths) === JSON.stringify([...PATHS].sort())
    && Number(analysis?.counts?.P0) === 2 && Number(analysis?.counts?.P1) === 0 && Number(analysis?.counts?.P2 ?? 0) === 0;
}

function exactLineage(lineage, sourceHead, baseSha) {
  const parents = Array.isArray(lineage?.parents) ? lineage.parents : [];
  return lineage?.schemaVersion === LINEAGE_SCHEMA && lineage.repository === REPOSITORY
    && lineage.sourceHead === sourceHead && lineage.sourceCommitSha === sourceHead
    && lineage.baseSha === baseSha && lineage.liveMainBeforeSha === baseSha && lineage.liveMainAfterSha === baseSha
    && parents.includes(baseSha)
    && lineage?.comparison?.status === 'ahead' && Number.isSafeInteger(lineage.comparison.aheadBy) && lineage.comparison.aheadBy > 0
    && lineage.comparison.behindBy === 0 && lineage.comparison.baseCommitSha === baseSha && lineage.comparison.mergeBaseCommitSha === baseSha;
}

function restartSpecificFindings(path, content) {
  const findings = [...reviewCurrentWorkerWatchdogSourceSemanticsV2(path, content)];
  const add = (code, summary) => findings.push(Object.freeze({ severity: 'P0', code, summary, path }));
  if (path === PATHS[1]) {
    if (!/\[System\.Diagnostics\.Process\]::GetProcessById\(/.test(content) || !/\.StartTime\.ToUniversalTime\(\)/.test(content)) add('mission-worker-restart-same-api-starttime-missing', 'Restart proof must bind exact process start identity through System.Diagnostics.Process.StartTime.');
    if (!/Get-CimInstance\s+Win32_Process/.test(content) || !/Test-ExactCanonicalWorkerProcess/.test(content)) add('mission-worker-restart-cim-command-proof-missing', 'CIM must remain required for exact canonical command-line proof.');
    if (/TotalSeconds|TotalMilliseconds|Tolerance|tolerance/.test(content)) add('mission-worker-restart-starttime-tolerance-forbidden', 'Exact restart identity may not be weakened to a time tolerance window.');
  }
  return findings;
}

async function main() {
  if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Mission Worker restart specialist may run only inside GitHub Actions.');
  const artifactPath = exactArtifactPath();
  const child = spawnSync(process.execPath, [PRIOR_WRAPPER], { stdio: 'inherit', shell: false, windowsHide: true, env: process.env });
  if (child.status === 0) return;
  if (!fs.existsSync(artifactPath)) process.exit(child.status || 1);

  const artifact = validateFindingsArtifact(JSON.parse(fs.readFileSync(artifactPath, 'utf8')));
  if (!exactEscalation(artifact.analysis)) process.exit(child.status || 1);
  const lineage = await exactReconciliationLineage(artifact.repository, artifact.sourceHead, artifact.baseSha);
  const findings = [];
  if (!exactLineage(lineage, artifact.sourceHead, artifact.baseSha)) findings.push(Object.freeze({ severity: 'P0', code: 'mission-worker-restart-current-main-lineage-invalid', summary: 'Review requires exact-current-main ahead-only lineage with the live base as a parent.', path: PATHS[0] }));
  const sources = await Promise.all(PATHS.map((path) => exactHeadSource(artifact.repository, path, artifact.sourceHead)));
  for (const source of sources) {
    if (source.blobSha !== EXPECTED_BLOBS[source.path]) {
      findings.push(Object.freeze({ severity: 'P0', code: 'mission-worker-restart-reviewed-source-mismatch', summary: 'The exact reviewed Mission Worker restart source blob changed.', path: source.path }));
      continue;
    }
    findings.push(...restartSpecificFindings(source.path, source.content));
  }

  const createdAtUtc = new Date().toISOString();
  if (findings.length) {
    const analysis = Object.freeze({
      schemaVersion: 'stephanos.independent-security-analysis.v1', findings: Object.freeze(findings), counts: counts(findings), verdict: 'findings',
      proofRefs: Object.freeze(unique([...(artifact.analysis?.proofRefs || []), 'windows-authority:mission-worker-restart-v1'])), finalVerdict: 'INDEPENDENT_SECURITY_REVIEW_FINDINGS',
    });
    writeReplacementArtifact(artifactPath, buildIndependentReviewFindingsArtifact({ repository: artifact.repository, prNumber: artifact.prNumber, branch: artifact.branch, sourceHead: artifact.sourceHead, baseSha: artifact.baseSha, workflowRunId: artifact.workflowRunId, workflowRunAttempt: artifact.workflowRunAttempt, createdAtUtc, analysis }));
    console.error(`MISSION_WORKER_RESTART_SPECIALIST_REVIEW_BLOCKED=${findings.map((item) => item.code).join(',')}`);
    process.exitCode = 1;
    return;
  }

  const cleanAnalysis = Object.freeze({
    schemaVersion: 'stephanos.independent-security-analysis.v1', findings: Object.freeze([]), counts: Object.freeze({ P0: 0, P1: 0, P2: 0 }), verdict: 'clean',
    proofRefs: Object.freeze(unique([...(artifact.analysis?.proofRefs || []), 'windows-authority:mission-worker-restart-v1', ...PATHS.map((path) => `windows-authority:mission-worker-restart-v1:${path}#${EXPECTED_BLOBS[path]}`)])),
    finalVerdict: 'INDEPENDENT_SECURITY_REVIEW_CLEAN',
  });
  const replacement = buildIndependentReviewArtifact({ repository: artifact.repository, prNumber: artifact.prNumber, branch: artifact.branch, sourceHead: artifact.sourceHead, baseSha: artifact.baseSha, workflowRunId: artifact.workflowRunId, workflowRunAttempt: artifact.workflowRunAttempt, createdAtUtc, analysis: cleanAnalysis });
  writeReplacementArtifact(artifactPath, replacement);
  console.log('MISSION_WORKER_RESTART_SPECIALIST_REVIEW=clean');
  console.log(`MISSION_WORKER_RESTART_SPECIALIST_REVIEW_PATHS=${PATHS.join(',')}`);
  console.log(`INDEPENDENT_SECURITY_REVIEW_ARTIFACT_PAYLOAD_SHA256=${replacement.payloadSha256}`);
}

main().catch((error) => {
  console.error(`MISSION_WORKER_RESTART_SPECIALIST_REVIEW_BLOCKED=${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
