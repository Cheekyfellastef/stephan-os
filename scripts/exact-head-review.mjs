#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const SHA_RE = /^[0-9a-f]{40}$/i;
const MAX_PATCH_BYTES = 2_000_000;


function addedPatchCode(patch) {
  return String(patch ?? '')
    .split(/\r?\n/)
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1))
    .join('\n');
}

function maskQuotedLiterals(source) {
  let output = '';
  let quote = '';
  let escaped = false;
  for (const char of String(source ?? '')) {
    if (quote) {
      output += char === '\n' ? '\n' : ' ';
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = '';
      }
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      output += ' ';
      continue;
    }
    output += char;
  }
  return output;
}

function dynamicExecutionEvidence(patch) {
  const added = addedPatchCode(patch)
    .replace(/(^|[=(:,\[]\s*)\/(?:\\.|[^/\n])+\/[dgimsuvy]*\.exec\s*\(/gm, '$1REGEXP_EXEC(');
  return maskQuotedLiterals(added);
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
      add('P2', 'AUTHORITY_SURFACE_CHANGED', 'Authority-sensitive surface changed; require explicit human or escalated AI review.', file);
    }
  }

  if (typeof patch === 'string') {
    if (/^\+<{7}|^\+={7}|^\+>{7}/m.test(patch)) {
      add('P1', 'CONFLICT_MARKER', 'Added conflict marker detected.');
    }
    if (/^\+\s*(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})\s*$/m.test(patch)) {
      add('P0', 'SECRET_PATTERN', 'Potential credential or private key added.');
    }
    const executableEvidence = dynamicExecutionEvidence(patch);
    if (/(?:\beval\s*\(|\bnew\s+Function\s*\(|\b(?:exec|execSync|execFile|execFileSync|spawn|spawnSync|fork)\s*\(|child_process\.(?:exec|execSync|execFile|execFileSync|spawn|spawnSync|fork)\s*\(|shell:\s*true)/m.test(executableEvidence)) {
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
