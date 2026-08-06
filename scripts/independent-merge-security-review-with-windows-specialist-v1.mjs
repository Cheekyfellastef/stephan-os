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
  analyzeWindowsAuthoritySpecialistReview,
} from '../shared/agents/windowsAuthoritySpecialistReviewV1.mjs';

const API_VERSION = '2022-11-28';
const USER_AGENT = 'stephanos-independent-review-windows-specialist-v1';

function text(value) {
  return String(value ?? '').trim();
}

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
  fs.writeFileSync(path, `${JSON.stringify(artifact, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
}

function unique(values) {
  return [...new Set(values)];
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
  if (!token) throw new Error('GitHub token is required for specialist exact-head source retrieval.');
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': USER_AGENT,
    },
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw new Error(`GitHub response exceeded ${maxBytes} bytes.`);
  const raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (!response.ok) throw new Error(`GitHub GET ${path} failed (${response.status}): ${raw.slice(0, 300)}`);
  return JSON.parse(raw);
}

function strictBase64(value, path) {
  const encoded = String(value ?? '').replace(/\s/g, '');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error(`Windows authority source ${path} is not canonical base64.`);
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded) throw new Error(`Windows authority source ${path} base64 is not canonical.`);
  return bytes;
}

async function exactHeadSource(repository, path, sourceHead) {
  const [owner, repo] = repository.split('/');
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const payload = await githubJson(
    `/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(sourceHead)}`,
    Math.ceil(WINDOWS_AUTHORITY_SOURCE_MAX_BYTES * 4 / 3) + 65_536,
  );
  if (payload?.type !== 'file'
    || payload?.path !== path
    || payload?.encoding !== 'base64'
    || !Number.isSafeInteger(payload?.size)
    || payload.size <= 0
    || payload.size > WINDOWS_AUTHORITY_SOURCE_MAX_BYTES
    || !/^[a-f0-9]{40}$/.test(text(payload?.sha))) {
    throw new Error(`Windows authority source ${path} is not one bounded exact-head file.`);
  }
  const bytes = strictBase64(payload.content, path);
  if (bytes.length !== payload.size) throw new Error(`Windows authority source ${path} size mismatch.`);
  const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return Object.freeze({
    schemaVersion: WINDOWS_AUTHORITY_SOURCE_SCHEMA_VERSION,
    repository,
    path,
    ref: sourceHead,
    exists: true,
    size: bytes.length,
    blobSha: text(payload.sha).toLowerCase(),
    content,
  });
}

function validateFindingsArtifact(artifact) {
  if (artifact?.schemaVersion !== 'stephanos.independent-review-findings-artifact.v1'
    || artifact?.kind !== 'stephanos.independent-review.findings-artifact'
    || artifact?.artifactFile !== INDEPENDENT_REVIEW_ARTIFACT_FILE
    || !/^[a-f0-9]{40}$/.test(text(artifact?.sourceHead))
    || !/^[a-f0-9]{40}$/.test(text(artifact?.baseSha))
    || artifact?.payloadSha256 !== independentReviewFindingsArtifactPayloadSha256(artifact)) {
    throw new Error('Original findings artifact is invalid or not digest-bound.');
  }
  return artifact;
}

async function main() {
  if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Specialist wrapper may run only inside GitHub Actions.');
  const artifactPath = exactArtifactPath();
  const child = spawnSync(process.execPath, ['scripts/independent-merge-security-review-v2.mjs'], {
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
    env: process.env,
  });
  if (child.status === 0) return;
  if (!fs.existsSync(artifactPath)) process.exit(child.status || 1);

  const artifact = validateFindingsArtifact(JSON.parse(fs.readFileSync(artifactPath, 'utf8')));
  const findings = Array.isArray(artifact?.analysis?.findings) ? artifact.analysis.findings : [];
  const paths = unique(findings.map((item) => text(item?.path)).filter(Boolean));
  const sources = await Promise.all(paths.map((path) => exactHeadSource(
    artifact.repository,
    path,
    artifact.sourceHead,
  )));
  const specialist = analyzeWindowsAuthoritySpecialistReview({
    repository: artifact.repository,
    sourceHead: artifact.sourceHead,
    analysis: artifact.analysis,
    sources,
  });
  if (!specialist.eligible) process.exit(child.status || 1);

  const createdAtUtc = new Date().toISOString();
  if (!specialist.clean) {
    const specialistFindings = specialist.findings;
    const analysis = Object.freeze({
      schemaVersion: 'stephanos.independent-security-analysis.v1',
      findings: Object.freeze(specialistFindings),
      counts: counts(specialistFindings),
      verdict: 'findings',
      proofRefs: Object.freeze(unique([
        ...(Array.isArray(artifact.analysis?.proofRefs) ? artifact.analysis.proofRefs : []),
        ...specialist.proofRefs,
      ])),
      finalVerdict: 'INDEPENDENT_SECURITY_REVIEW_FINDINGS',
    });
    const replacement = buildIndependentReviewFindingsArtifact({
      repository: artifact.repository,
      prNumber: artifact.prNumber,
      branch: artifact.branch,
      sourceHead: artifact.sourceHead,
      baseSha: artifact.baseSha,
      workflowRunId: artifact.workflowRunId,
      workflowRunAttempt: artifact.workflowRunAttempt,
      createdAtUtc,
      analysis,
    });
    writeReplacementArtifact(artifactPath, replacement);
    console.error(`WINDOWS_AUTHORITY_SPECIALIST_REVIEW_BLOCKED=${specialistFindings.map((item) => item.code).join(',')}`);
    process.exitCode = 1;
    return;
  }

  const cleanAnalysis = Object.freeze({
    schemaVersion: 'stephanos.independent-security-analysis.v1',
    findings: Object.freeze([]),
    counts: Object.freeze({ P0: 0, P1: 0, P2: 0 }),
    verdict: 'clean',
    proofRefs: Object.freeze(unique([
      ...(Array.isArray(artifact.analysis?.proofRefs) ? artifact.analysis.proofRefs : []),
      ...specialist.proofRefs,
    ])),
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
  console.log('WINDOWS_AUTHORITY_SPECIALIST_REVIEW=clean');
  console.log(`WINDOWS_AUTHORITY_SPECIALIST_REVIEW_PATHS=${specialist.reviewedPaths.join(',')}`);
  console.log(`INDEPENDENT_SECURITY_REVIEW_ARTIFACT_PAYLOAD_SHA256=${replacement.payloadSha256}`);
}

main().catch((error) => {
  console.error(`WINDOWS_AUTHORITY_SPECIALIST_REVIEW_BLOCKED=${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
