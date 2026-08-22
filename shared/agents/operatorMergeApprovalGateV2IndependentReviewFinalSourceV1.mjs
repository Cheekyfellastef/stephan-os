import { createHash } from 'node:crypto';

import {
  PROTECTED_WORKFLOW_SOURCE_MAX_BYTES,
  PROTECTED_WORKFLOW_SOURCE_SCHEMA_VERSION,
} from './operatorMergeApprovalGate.mjs';
import {
  analyzeIndependentSecurityReviewV2,
} from './operatorMergeApprovalBoundaryV2.mjs';
import {
  validateIndependentReviewWorkflowFinalPolicyV1,
} from './independentReviewWorkflowFinalPolicyV1.mjs';

export const INDEPENDENT_REVIEW_WORKFLOW_FINAL_SOURCE_POLICY_SCHEMA = 'stephanos.independent-review-workflow-final-source-policy.v1';
export const INDEPENDENT_REVIEW_WORKFLOW_PATH = '.github/workflows/independent-merge-security-review.yml';

const SHA40 = /^[a-f0-9]{40}$/;
const PROTECTED_WORKFLOW_SOURCE_KEYS = Object.freeze([
  'schemaVersion',
  'repository',
  'path',
  'ref',
  'exists',
  'size',
  'blobSha',
  'content',
]);

function text(value) {
  return String(value ?? '').trim();
}

function isPlainRecord(value) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value, expectedKeys) {
  if (!isPlainRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function unique(values) {
  return [...new Set(values)];
}

function indentation(line) {
  return line.match(/^ */)?.[0].length ?? 0;
}

function gitBlobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1')
    .update(`blob ${bytes.length}\0`, 'utf8')
    .update(bytes)
    .digest('hex');
}

function yamlEventKeys(source) {
  const lines = String(source).split(/\r?\n/);
  const starts = lines
    .map((line, index) => (line === 'on:' ? index : -1))
    .filter((index) => index >= 0);
  if (starts.length !== 1) return Object.freeze([]);
  const keys = [];
  for (let index = starts[0] + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (indentation(line) === 0) break;
    const direct = line.match(/^ {2}([A-Za-z0-9_-]+):(?:\s.*)?$/);
    if (direct) keys.push(direct[1]);
  }
  return Object.freeze(keys);
}

function yamlWorkflowDispatchInputKeys(source) {
  const lines = String(source).split(/\r?\n/);
  const dispatchStarts = lines
    .map((line, index) => (line === '  workflow_dispatch:' ? index : -1))
    .filter((index) => index >= 0);
  if (dispatchStarts.length !== 1) return Object.freeze([]);
  const inputsStarts = lines
    .map((line, index) => (index > dispatchStarts[0] && line === '    inputs:' ? index : -1))
    .filter((index) => index >= 0);
  if (inputsStarts.length !== 1) return Object.freeze([]);
  const keys = [];
  for (let index = inputsStarts[0] + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (indentation(line) <= 4) break;
    const direct = line.match(/^ {6}([A-Za-z0-9_-]+):\s*$/);
    if (direct) keys.push(direct[1]);
  }
  return Object.freeze(keys);
}

function checkoutRefFacts(source) {
  const lines = String(source).split(/\r?\n/);
  const refs = [];
  let checkoutCount = 0;
  let valid = true;
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\s*uses:\s*actions\/checkout@v4\s*$/.test(lines[index])) continue;
    checkoutCount += 1;
    const usesIndent = indentation(lines[index]);
    let end = index + 1;
    while (end < lines.length) {
      const candidate = lines[end];
      if (candidate.trim() && !candidate.trimStart().startsWith('#')
        && indentation(candidate) < usesIndent) break;
      end += 1;
    }
    const block = lines.slice(index, end);
    const refLines = block.filter((line) => /^\s*ref:\s*/.test(line));
    const persistLines = block.filter((line) => /^\s*persist-credentials:\s*/.test(line));
    if (refLines.length !== 1 || persistLines.length !== 1 || !/^\s*persist-credentials:\s*false\s*$/.test(persistLines[0])) {
      valid = false;
      continue;
    }
    const match = refLines[0].match(/^\s*ref:\s*\$\{\{\s*([^}]+?)\s*\}\}\s*$/);
    if (!match) {
      valid = false;
      continue;
    }
    refs.push(match[1].trim());
  }
  const counts = new Map();
  for (const expression of refs) counts.set(expression, (counts.get(expression) || 0) + 1);
  return Object.freeze({
    valid,
    checkoutCount,
    checkoutRefs: Object.freeze([...counts.entries()].map(([expression, count]) => Object.freeze({ expression, count }))),
  });
}

function permissionFacts(source) {
  const lines = String(source).split(/\r?\n/);
  const signatures = [];
  let topLevelEmptyCount = 0;
  let valid = true;
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^( *)permissions:\s*(.*?)\s*$/);
    if (!match) continue;
    const indent = match[1].length;
    const inline = match[2];
    if (indent === 0 && inline === '{}') {
      topLevelEmptyCount += 1;
      continue;
    }
    if (indent === 0 || inline) {
      valid = false;
      continue;
    }
    const entries = [];
    for (let child = index + 1; child < lines.length; child += 1) {
      const line = lines[child];
      if (!line.trim() || line.trimStart().startsWith('#')) continue;
      if (indentation(line) <= indent) break;
      const entry = line.match(new RegExp(`^ {${indent + 2}}([a-z][a-z-]*):\\s*(read|write|none)\\s*$`));
      if (!entry) {
        valid = false;
        continue;
      }
      entries.push(`${entry[1]}:${entry[2]}`);
    }
    if (!entries.length || new Set(entries).size !== entries.length) valid = false;
    signatures.push(entries.sort().join(','));
  }
  return Object.freeze({
    valid: valid && topLevelEmptyCount === 1,
    permissionSignatures: Object.freeze(signatures.sort()),
  });
}

function exactSourceBinding(input, source) {
  const repository = text(input.repository);
  const sourceHead = text(input.sourceHead).toLowerCase();
  return exactKeys(source, PROTECTED_WORKFLOW_SOURCE_KEYS)
    && source.schemaVersion === PROTECTED_WORKFLOW_SOURCE_SCHEMA_VERSION
    && source.repository === repository
    && source.path === INDEPENDENT_REVIEW_WORKFLOW_PATH
    && SHA40.test(sourceHead)
    && source.ref === sourceHead
    && source.exists === true
    && Number.isSafeInteger(source.size)
    && source.size > 0
    && source.size <= PROTECTED_WORKFLOW_SOURCE_MAX_BYTES
    && typeof source.content === 'string'
    && Buffer.byteLength(source.content, 'utf8') === source.size
    && SHA40.test(text(source.blobSha).toLowerCase())
    && gitBlobSha(source.content) === text(source.blobSha).toLowerCase();
}

function changedFilePaths(item) {
  if (typeof item === 'string') return [text(item)].filter(Boolean);
  return unique([
    text(item?.filename ?? item?.path),
    text(item?.previous_filename),
  ]).filter(Boolean);
}

export function validateIndependentReviewWorkflowFinalSourcePolicyV1(input = {}) {
  const changedPaths = (Array.isArray(input.changedFiles) ? input.changedFiles : [])
    .flatMap(changedFilePaths)
    .filter(Boolean);
  if (!changedPaths.includes(INDEPENDENT_REVIEW_WORKFLOW_PATH)) {
    return Object.freeze({
      schemaVersion: INDEPENDENT_REVIEW_WORKFLOW_FINAL_SOURCE_POLICY_SCHEMA,
      applicable: false,
      valid: false,
      blockers: Object.freeze(['independent-review-workflow-not-changed']),
      proofRef: '',
    });
  }

  const sources = Array.isArray(input.protectedWorkflowSources) ? input.protectedWorkflowSources : [];
  const candidates = sources.filter((source) => text(source?.path) === INDEPENDENT_REVIEW_WORKFLOW_PATH);
  if (candidates.length !== 1 || !exactSourceBinding(input, candidates[0])) {
    return Object.freeze({
      schemaVersion: INDEPENDENT_REVIEW_WORKFLOW_FINAL_SOURCE_POLICY_SCHEMA,
      applicable: true,
      valid: false,
      blockers: Object.freeze(['independent-review-workflow-source-binding-invalid']),
      proofRef: '',
    });
  }

  const source = candidates[0];
  const checkout = checkoutRefFacts(source.content);
  const permissions = permissionFacts(source.content);
  const facts = {
    events: [...yamlEventKeys(source.content)],
    workflowDispatchInputs: [...yamlWorkflowDispatchInputKeys(source.content)],
    checkoutRefs: checkout.checkoutRefs.map((entry) => ({ ...entry })),
    checkoutCount: checkout.checkoutCount,
    permissionSignatures: [...permissions.permissionSignatures],
  };
  const policy = validateIndependentReviewWorkflowFinalPolicyV1(facts);
  const blockers = [
    ...(checkout.valid ? [] : ['independent-review-workflow-checkout-source-invalid']),
    ...(permissions.valid ? [] : ['independent-review-workflow-permission-source-invalid']),
    ...policy.blockers,
  ];
  const valid = blockers.length === 0 && policy.valid;
  return Object.freeze({
    schemaVersion: INDEPENDENT_REVIEW_WORKFLOW_FINAL_SOURCE_POLICY_SCHEMA,
    applicable: true,
    valid,
    blockers: Object.freeze(unique(blockers)),
    proofRef: valid
      ? `proofs/independent-review-workflow-final-policy-v1/${source.path}@${source.ref}#${source.blobSha}:${source.size}`
      : '',
  });
}

function recalculateAnalysis(analysis, findings, proofRefs) {
  const counts = {
    P0: findings.filter((item) => item?.severity === 'P0').length,
    P1: findings.filter((item) => item?.severity === 'P1').length,
    P2: findings.filter((item) => item?.severity === 'P2').length,
  };
  const verdict = counts.P0 || counts.P1 || counts.P2 ? 'findings' : 'clean';
  return Object.freeze({
    ...analysis,
    findings: Object.freeze(findings),
    counts: Object.freeze(counts),
    verdict,
    proofRefs: Object.freeze(unique(proofRefs)),
    finalVerdict: verdict === 'clean'
      ? 'INDEPENDENT_SECURITY_REVIEW_CLEAN'
      : 'INDEPENDENT_SECURITY_REVIEW_FINDINGS',
  });
}

export function migrateIndependentReviewWorkflowFinalPolicyAnalysisV1(analysis = {}, input = {}) {
  const validation = validateIndependentReviewWorkflowFinalSourcePolicyV1(input);
  if (!validation.valid) return analysis;
  const findings = Array.isArray(analysis.findings) ? [...analysis.findings] : [];
  const legacyFindings = findings.filter((item) => (
    text(item?.code) === 'independent-review-workflow-not-trusted'
    && text(item?.path) === INDEPENDENT_REVIEW_WORKFLOW_PATH
  ));
  if (legacyFindings.length !== 1) return analysis;

  const preserved = findings.filter((item) => item !== legacyFindings[0]);
  return recalculateAnalysis(
    analysis,
    preserved,
    [...(Array.isArray(analysis.proofRefs) ? analysis.proofRefs : []), validation.proofRef],
  );
}

export function analyzeIndependentSecurityReviewWithFinalSourcePolicyV1(input = {}) {
  const legacy = analyzeIndependentSecurityReviewV2(input);
  return migrateIndependentReviewWorkflowFinalPolicyAnalysisV1(legacy, input);
}
