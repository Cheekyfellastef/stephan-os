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
import {
  WINDOWS_AUTHORITY_SOURCE_MAX_BYTES,
  WINDOWS_AUTHORITY_SOURCE_SCHEMA_VERSION,
} from '../shared/agents/windowsAuthoritySpecialistReviewV1.mjs';
import { analyzeOpenClawBuilderProviderSpecialistReviewV1 } from '../shared/agents/openClawBuilderProviderSpecialistReviewV1.mjs';
import { analyzeOpenClawOc2SpecialistReviewV1 } from '../shared/agents/openClawOc2SpecialistReviewV1.mjs';

const API_VERSION = '2022-11-28';
const USER_AGENT = 'stephanos-independent-review-openclaw-specialist-v1';
const PRIOR_WRAPPER = 'scripts/independent-merge-security-review-with-windows-specialist-v1.mjs';
const SHA = /^[a-f0-9]{40}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
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

async function githubJson(path, maxBytes = WINDOWS_AUTHORITY_SOURCE_MAX_BYTES * 2) {
  const token = text(process.env.GH_TOKEN || process.env.GITHUB_TOKEN);
  if (!token) throw new Error('GitHub token is required for OpenClaw specialist exact-head source retrieval.');
  const url = `https://api.github.com${path}`;
  const response = await fetch(url, {
    redirect: 'error',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': USER_AGENT,
    },
  });
  if (response.url !== url) throw new Error('GitHub OpenClaw specialist read response URL did not remain exact.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw new Error(`GitHub response exceeded ${maxBytes} bytes.`);
  const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (!response.ok) throw new Error(`GitHub GET ${path} failed (${response.status}): ${raw.slice(0, 300)}`);
  return JSON.parse(raw);
}

function strictBase64(value, path) {
  const encoded = String(value ?? '').replace(/\s/g, '');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error(`OpenClaw specialist source ${path} is not canonical base64.`);
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded) throw new Error(`OpenClaw specialist source ${path} base64 is not canonical.`);
  return bytes;
}

async function exactHeadSource(repository, path, sourceHead) {
  const [owner, repo] = repository.split('/');
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const payload = await githubJson(
    `/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(sourceHead)}`,
    Math.ceil(WINDOWS_AUTHORITY_SOURCE_MAX_BYTES * 4 / 3) + 65_536,
  );
  if (payload?.type !== 'file' || payload?.path !== path || payload?.encoding !== 'base64'
    || !Number.isSafeInteger(payload?.size) || payload.size <= 0 || payload.size > WINDOWS_AUTHORITY_SOURCE_MAX_BYTES
    || !SHA.test(text(payload?.sha))) {
    throw new Error(`OpenClaw specialist source ${path} is not one bounded exact-head file.`);
  }
  const bytes = strictBase64(payload.content, path);
  if (bytes.length !== payload.size) throw new Error(`OpenClaw specialist source ${path} size mismatch.`);
  return Object.freeze({
    schemaVersion: WINDOWS_AUTHORITY_SOURCE_SCHEMA_VERSION,
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
  const parents = Array.isArray(sourceCommit?.parents) ? sourceCommit.parents.map((parent) => text(parent?.sha).toLowerCase()) : [];
  return Object.freeze({
    schemaVersion: 'stephanos.windows-authority-reconciliation-lineage.v1',
    repository,
    sourceHead,
    sourceCommitSha: text(sourceCommit?.sha).toLowerCase(),
    baseSha,
    liveMainBeforeSha: text(liveMainBefore?.object?.sha).toLowerCase(),
    liveMainAfterSha: text(liveMainAfter?.object?.sha).toLowerCase(),
    parents: Object.freeze(parents),
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
    || !REPOSITORY.test(text(artifact?.repository))
    || !Number.isSafeInteger(artifact?.prNumber) || artifact.prNumber <= 0
    || typeof artifact?.branch !== 'string' || artifact.branch.length === 0 || artifact.branch.length > 255
    || !SHA.test(text(artifact?.sourceHead)) || !SHA.test(text(artifact?.baseSha))
    || artifact?.payloadSha256 !== independentReviewFindingsArtifactPayloadSha256(artifact)) {
    throw new Error('Original findings artifact is invalid or not digest-bound.');
  }
  return artifact;
}

async function main() {
  if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('OpenClaw specialist wrapper may run only inside GitHub Actions.');
  const artifactPath = exactArtifactPath();
  const child = spawnSync(process.execPath, [PRIOR_WRAPPER], { stdio: 'inherit', shell: false, windowsHide: true, env: process.env });
  if (child.status === 0) return;
  if (!fs.existsSync(artifactPath)) process.exit(child.status || 1);

  const artifact = validateFindingsArtifact(JSON.parse(fs.readFileSync(artifactPath, 'utf8')));
  const lineageEvidence = await exactReconciliationLineage(artifact.repository, artifact.sourceHead, artifact.baseSha);
  const reviewInput = {
    repository: artifact.repository,
    prNumber: artifact.prNumber,
    branch: artifact.branch,
    sourceHead: artifact.sourceHead,
    baseSha: artifact.baseSha,
    lineageEvidence,
    analysis: artifact.analysis,
    sources: [],
  };
  let specialistAnalyzer = analyzeOpenClawBuilderProviderSpecialistReviewV1;
  let probe = specialistAnalyzer(reviewInput);
  if (!probe.eligible) {
    specialistAnalyzer = analyzeOpenClawOc2SpecialistReviewV1;
    probe = specialistAnalyzer(reviewInput);
  }
  if (!probe.eligible) process.exit(child.status || 1);

  const sources = await Promise.all(probe.reviewedPaths.map((path) => exactHeadSource(artifact.repository, path, artifact.sourceHead)));
  const specialist = specialistAnalyzer({ ...reviewInput, sources });
  if (!specialist.eligible) process.exit(child.status || 1);
  const isOc2 = specialist.schemaVersion === 'stephanos.openclaw-oc2-specialist-review.v1';

  const createdAtUtc = new Date().toISOString();
  if (!specialist.clean) {
    const analysis = Object.freeze({
      schemaVersion: 'stephanos.independent-security-analysis.v1',
      findings: Object.freeze(specialist.findings),
      counts: counts(specialist.findings),
      verdict: 'findings',
      proofRefs: Object.freeze(unique([...(Array.isArray(artifact.analysis?.proofRefs) ? artifact.analysis.proofRefs : []), ...specialist.proofRefs])),
      finalVerdict: 'INDEPENDENT_SECURITY_REVIEW_FINDINGS',
    });
    writeReplacementArtifact(artifactPath, buildIndependentReviewFindingsArtifact({
      repository: artifact.repository,
      prNumber: artifact.prNumber,
      branch: artifact.branch,
      sourceHead: artifact.sourceHead,
      baseSha: artifact.baseSha,
      workflowRunId: artifact.workflowRunId,
      workflowRunAttempt: artifact.workflowRunAttempt,
      createdAtUtc,
      analysis,
    }));
    if (isOc2) console.error(`OPENCLAW_OC2_SPECIALIST_REVIEW_BLOCKED=${specialist.findings.map((item) => item.code).join(',')}`);
    console.error(`OPENCLAW_BUILDER_PROVIDER_SPECIALIST_REVIEW_BLOCKED=${specialist.findings.map((item) => item.code).join(',')}`);
    process.exitCode = 1;
    return;
  }

  const cleanAnalysis = Object.freeze({
    schemaVersion: 'stephanos.independent-security-analysis.v1',
    findings: Object.freeze([]),
    counts: Object.freeze({ P0: 0, P1: 0, P2: 0 }),
    verdict: 'clean',
    proofRefs: Object.freeze(unique([...(Array.isArray(artifact.analysis?.proofRefs) ? artifact.analysis.proofRefs : []), ...specialist.proofRefs])),
    finalVerdict: 'INDEPENDENT_SECURITY_REVIEW_CLEAN',
  });
  const replacement = buildIndependentReviewArtifact({
    repository: artifact.repository,
    prNumber: artifact.prNumber,
    branch: artifact.branch,
    sourceHead: artifact.sourceHead,
    baseSha: artifact.baseSha,
    workflowRunId: artifact.workflowRunId,
    workflowRunAttempt: artifact.workflowRunAttempt,
    createdAtUtc,
    analysis: cleanAnalysis,
  });
  writeReplacementArtifact(artifactPath, replacement);
  if (isOc2) {
    console.log('OPENCLAW_OC2_SPECIALIST_REVIEW=clean');
    console.log(`OPENCLAW_OC2_SPECIALIST_REVIEW_PATHS=${specialist.reviewedPaths.join(',')}`);
  }
  console.log('OPENCLAW_BUILDER_PROVIDER_SPECIALIST_REVIEW=clean');
  console.log(`OPENCLAW_BUILDER_PROVIDER_SPECIALIST_REVIEW_PATHS=${specialist.reviewedPaths.join(',')}`);
  console.log(`INDEPENDENT_SECURITY_REVIEW_ARTIFACT_PAYLOAD_SHA256=${replacement.payloadSha256}`);
}

main().catch((error) => {
  console.error(`OPENCLAW_BUILDER_PROVIDER_SPECIALIST_REVIEW_BLOCKED=${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
