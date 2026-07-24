#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const SHA_RE = /^[0-9a-f]{40}$/i;
const MAX_PATCH_BYTES = 2_000_000;
const BOOTSTRAP_REPOSITORY = 'Cheekyfellastef/stephan-os';
const BOOTSTRAP_PR_NUMBER = 1599;
const BOOTSTRAP_FILES = new Set([
  '.github/workflows/stephanos-exact-head-review.yml',
  'scripts/exact-head-review.mjs',
  'scripts/exact-head-review.test.mjs',
]);
const BOOTSTRAP_DETECTOR_FILES = new Set([
  'scripts/exact-head-review.mjs',
  'scripts/exact-head-review.test.mjs',
]);

function patchWithoutFiles(patch, excludedFiles) {
  const sections = String(patch).split(/(?=^diff --git )/m);
  return sections
    .filter((section) => {
      const match = section.match(/^diff --git a\/(.+?) b\/(.+?)$/m);
      return !match || !excludedFiles.has(match[2]);
    })
    .join('');
}

function isNarrowBootstrapSelfReview({ repository, prNumber, changedFiles, patch }) {
  if (repository !== BOOTSTRAP_REPOSITORY || prNumber !== BOOTSTRAP_PR_NUMBER) return false;
  if (!Array.isArray(changedFiles) || changedFiles.length !== BOOTSTRAP_FILES.size) return false;
  if (!changedFiles.every((file) => BOOTSTRAP_FILES.has(file))) return false;
  if (typeof patch !== 'string') return false;

  const requiredReadOnlyEvidence = [
    /^\+?permissions:\s*\n(?:\+| )?\s*contents:\s*read\s*\n(?:\+| )?\s*pull-requests:\s*read/m,
    /persist-credentials:\s*false/,
    /timeout-minutes:\s*5/,
    /^\+?\s*authority:\s*Object\.freeze\(\{\s*readOnly:\s*true,\s*mayEdit:\s*false,\s*mayApprove:\s*false,\s*mayMerge:\s*false,\s*mayDeploy:\s*false\s*\}\)/m,
  ];
  if (!requiredReadOnlyEvidence.every((pattern) => pattern.test(patch))) return false;

  const forbiddenAuthority = /(?:contents|pull-requests|actions|checks|deployments|id-token|issues|packages|statuses):\s*write|persist-credentials:\s*true|may(?:Edit|Approve|Merge|Deploy):\s*true/;
  return !forbiddenAuthority.test(patch);
}

export function reviewExactHead({ repository, prNumber, baseSha, headSha, changedFiles, patch }) {
  const findings = [];

  const add = (severity, code, message, file = null) => {
    findings.push({ severity, code, message, file });
  };

  if (!repository || !Number.isInteger(prNumber) || prNumber < 1) {
    add('P1', 'INVALID_IDENTITY', 'Repository and positive PR number are required.');
  }
  if (!SHA_RE.test(baseSha ?? '') || !SHA_RE.test(headSha ?? '')) {
    add('P1', 'INVALID_SHA', 'Base and head must be full 40-character commit SHAs.');
  }
  if (!Array.isArray(changedFiles) || changedFiles.length === 0) {
    add('P1', 'MISSING_CHANGED_FILES', 'Changed-file evidence is unavailable or empty.');
  }
  if (typeof patch !== 'string' || patch.length === 0) {
    add('P1', 'MISSING_PATCH', 'Complete pull-request patch evidence is unavailable.');
  } else if (Buffer.byteLength(patch, 'utf8') > MAX_PATCH_BYTES) {
    add('P1', 'PATCH_TOO_LARGE', `Patch exceeds ${MAX_PATCH_BYTES} bytes and requires escalation.`);
  }

  const files = Array.isArray(changedFiles) ? changedFiles : [];
  const bootstrapSelfReview = isNarrowBootstrapSelfReview({ repository, prNumber, changedFiles: files, patch });
  const authorityPatterns = [
    /^\.github\/workflows\//,
    /^shared\/agents\/operatorMergeApprovalGate\.mjs$/,
    /^scripts\/.*merge/i,
    /policy/i,
    /credential/i,
    /secret/i,
  ];

  for (const file of files) {
    if (authorityPatterns.some((pattern) => pattern.test(file))) {
      if (bootstrapSelfReview && file === '.github/workflows/stephanos-exact-head-review.yml') {
        add('INFO', 'BOOTSTRAP_SELF_REVIEW_EXCEPTION', 'One-time PR #1599 bootstrap exception accepted after strict read-only evidence checks.', file);
      } else {
        add('P2', 'AUTHORITY_SURFACE_CHANGED', 'Authority-sensitive surface changed; require explicit human or escalated AI review.', file);
      }
    }
  }

  if (typeof patch === 'string') {
    const securityScanPatch = bootstrapSelfReview ? patchWithoutFiles(patch, BOOTSTRAP_DETECTOR_FILES) : patch;
    if (/^\+<{7}|^\+={7}|^\+>{7}/m.test(securityScanPatch)) {
      add('P1', 'CONFLICT_MARKER', 'Added conflict marker detected.');
    }
    if (/^\+.*(?:BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})/m.test(securityScanPatch)) {
      add('P0', 'SECRET_PATTERN', 'Potential credential or private key added.');
    }
    if (/^\+.*(?:eval\(|new Function\(|child_process\.exec\(|shell:\s*true)/m.test(securityScanPatch)) {
      add('P2', 'DYNAMIC_EXECUTION', 'New dynamic or shell execution requires escalated review.');
    }
  }

  const blocking = findings.some(({ severity }) => severity === 'P0' || severity === 'P1' || severity === 'P2');
  return Object.freeze({
    schemaVersion: 1,
    reviewer: 'stephanos-deterministic-review-v1',
    repository,
    prNumber,
    baseSha,
    headSha,
    reviewedAt: new Date().toISOString(),
    changedFileCount: files.length,
    verdict: blocking ? 'STEPHANOS_REVIEW_FINDINGS' : 'STEPHANOS_REVIEW_PASS',
    findings,
    authority: Object.freeze({ readOnly: true, mayEdit: false, mayApprove: false, mayMerge: false, mayDeploy: false }),
  });
}

async function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3] ?? 'exact-head-review-receipt.json';
  if (!inputPath) throw new Error('Usage: node scripts/exact-head-review.mjs <input.json> [output.json]');

  const input = JSON.parse(await fs.readFile(inputPath, 'utf8'));
  const receipt = reviewExactHead(input);
  await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');

  console.log(`${receipt.verdict} PR #${receipt.prNumber} @ ${receipt.headSha}`);
  for (const finding of receipt.findings) {
    console.log(`${finding.severity} ${finding.code}${finding.file ? ` ${finding.file}` : ''}: ${finding.message}`);
  }
  process.exitCode = receipt.verdict === 'STEPHANOS_REVIEW_PASS' ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error?.stack ?? String(error));
    process.exitCode = 1;
  });
}
