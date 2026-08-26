#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

const SHA_RE = /^[0-9a-f]{40}$/i;
const MAX_PATCH_BYTES = 2_000_000;
const DYNAMIC_EXECUTION_RE = /(?:\beval\s*\(|\bnew\s+Function\s*\(|\b(?:exec|execSync|execFile|execFileSync|spawn|spawnSync|fork)\s*\(|child_process\.(?:exec|execSync|execFile|execFileSync|spawn|spawnSync|fork)\s*\(|shell:\s*true)/m;

function addedPatchSource(patch) {
  return String(patch || '')
    .split(/\r?\n/)
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1))
    .join('\n');
}

export function maskInertJavaScriptForDynamicReview(source = '') {
  const input = String(source);
  const output = [...input];
  const stack = [{ type: 'code', templateExpression: false, braceDepth: 0 }];
  const mask = (index) => {
    if (input[index] !== '\n' && input[index] !== '\r') output[index] = ' ';
  };
  const push = (frame) => stack.push(frame);
  const pop = () => stack.pop();

  for (let index = 0; index < input.length; index += 1) {
    const frame = stack[stack.length - 1];

    if (frame.type === 'line-comment') {
      if (input[index] === '\n') pop();
      else mask(index);
      continue;
    }

    if (frame.type === 'block-comment') {
      mask(index);
      if (input[index] === '*' && input[index + 1] === '/') {
        mask(index + 1);
        index += 1;
        pop();
      }
      continue;
    }

    if (frame.type === 'single' || frame.type === 'double') {
      const quote = frame.type === 'single' ? "'" : '"';
      mask(index);
      if (input[index] === '\\') {
        if (index + 1 < input.length) {
          mask(index + 1);
          index += 1;
        }
      } else if (input[index] === quote) {
        pop();
      }
      continue;
    }

    if (frame.type === 'template') {
      mask(index);
      if (input[index] === '\\') {
        if (index + 1 < input.length) {
          mask(index + 1);
          index += 1;
        }
        continue;
      }
      if (input[index] === '`') {
        pop();
        continue;
      }
      if (input[index] === '$' && input[index + 1] === '{') {
        mask(index + 1);
        index += 1;
        push({ type: 'code', templateExpression: true, braceDepth: 0 });
      }
      continue;
    }

    if (input[index] === '/' && input[index + 1] === '/') {
      mask(index);
      mask(index + 1);
      index += 1;
      push({ type: 'line-comment' });
      continue;
    }
    if (input[index] === '/' && input[index + 1] === '*') {
      mask(index);
      mask(index + 1);
      index += 1;
      push({ type: 'block-comment' });
      continue;
    }
    if (input[index] === "'") {
      mask(index);
      push({ type: 'single' });
      continue;
    }
    if (input[index] === '"') {
      mask(index);
      push({ type: 'double' });
      continue;
    }
    if (input[index] === '`') {
      mask(index);
      push({ type: 'template' });
      continue;
    }

    if (frame.templateExpression) {
      if (input[index] === '{') {
        frame.braceDepth += 1;
      } else if (input[index] === '}') {
        if (frame.braceDepth === 0) {
          mask(index);
          pop();
        } else {
          frame.braceDepth -= 1;
        }
      }
    }
  }

  if (stack.at(-1)?.type === 'line-comment') stack.pop();
  if (stack.length !== 1 || stack[0].type !== 'code') return input;
  return output.join('');
}

export function patchAddsDynamicExecution(patch = '') {
  const source = addedPatchSource(patch);
  const masked = maskInertJavaScriptForDynamicReview(source);
  return DYNAMIC_EXECUTION_RE.test(masked);
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
    if (patchAddsDynamicExecution(patch)) {
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
