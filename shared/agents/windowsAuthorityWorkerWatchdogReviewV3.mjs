import { createHash } from 'node:crypto';

import { reviewCurrentWorkerWatchdogSourceSemanticsV2 } from './windowsAuthorityWorkerWatchdogReviewV2.mjs';

export const WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V3 = Object.freeze([
  'scripts/windows/probe-mission-orchestrator-worker-watchdog.ps1',
]);

export const WINDOWS_AUTHORITY_WORKER_WATCHDOG_REVIEWED_ANCHOR_V3 =
  '79e1698e826b714fbf1b6756d65c52e7c1c215d0';

export const WINDOWS_AUTHORITY_WORKER_WATCHDOG_REVIEWED_MANIFEST_V3 = Object.freeze({
  'scripts/windows/probe-mission-orchestrator-worker-watchdog.ps1': Object.freeze({
    blobSha: '8f998f46cf6934ccd34ebe6f058e6ab98c5f226b',
    size: 28046,
  }),
});

const SCHEMA = 'stephanos.windows-authority-specialist-review.v1';
const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const LINEAGE_SCHEMA = 'stephanos.windows-authority-reconciliation-lineage.v1';
const SHA = /^[a-f0-9]{40}$/;
const MAX_SOURCE_BYTES = 256 * 1024;
const REVIEWED_IDENTITY = Object.freeze({
  repository: 'Cheekyfellastef/stephan-os',
  prNumber: 1732,
  branch: 'agent/watchdog-control-plane-bootstrap-recovery-v1',
});
const LINEAGE_KEYS = Object.freeze([
  'baseSha', 'comparison', 'liveMainAfterSha', 'liveMainBeforeSha', 'parents',
  'repository', 'schemaVersion', 'sourceCommitSha', 'sourceHead',
]);
const COMPARISON_KEYS = Object.freeze([
  'aheadBy', 'baseCommitSha', 'behindBy', 'mergeBaseCommitSha', 'status',
]);
const SOURCE_RECORD_KEYS = Object.freeze([
  'blobSha', 'content', 'exists', 'path', 'ref', 'repository', 'schemaVersion', 'size',
]);
const REQUIRED_CURRENT_PROBE_PATTERNS = Object.freeze([
  /function\s+Read-ValidatedMissionWorkerRestartFailureBlocker\b/,
  /\$missionWorkerRestartFailureProperties\s*=\s*@\(/,
  /\$missionWorkerRestartFailureBlockers\s*=\s*@\(/,
  /\$missionWorkerRestartFailureBlockers\s+-notcontains\s+\$blocker/,
  /APPROVED_RUNTIME_RESTART_BLOCKED/,
  /MISSION_WORKER_EXACT_HEAD_HEARTBEAT_TIMEOUT/,
  /MISSION_WORKER_FRESH_INSTANCE_NOT_PROVEN/,
  /MISSION_WORKER_INVOCATION_IDENTITY_NOT_PROVEN/,
  /MISSION_WORKER_TASK_NOT_RUNNING_AFTER_START/,
  /MISSION_WORKER_POST_START_PROOF_FAILED/,
  /MISSION_WORKER_POST_START_CLEANUP_FAILED/,
  /MISSION_WORKER_DEADLINE_SELF_CLEANUP_NOT_PROVEN/,
]);

const text = (value) => String(value ?? '').trim();
const finding = (code, summary, path = WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V3[0]) =>
  Object.freeze({ severity: 'P0', code, summary, path });

function blobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function exactDataRecord(value, expectedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string') || keys.length !== expectedKeys.length) return false;
  const sorted = keys.map(String).sort();
  if (sorted.some((key, index) => key !== expectedKeys[index])) return false;
  return keys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable === true;
  });
}

function exactParentEstate(parents) {
  if (!Array.isArray(parents) || parents.length !== 2) return false;
  const keys = Reflect.ownKeys(parents).map(String);
  if (keys.length !== 3 || keys[0] !== '0' || keys[1] !== '1' || keys[2] !== 'length') return false;
  const first = Object.getOwnPropertyDescriptor(parents, '0');
  const second = Object.getOwnPropertyDescriptor(parents, '1');
  const length = Object.getOwnPropertyDescriptor(parents, 'length');
  return Boolean(first && second && length
    && Object.hasOwn(first, 'value') && Object.hasOwn(second, 'value') && Object.hasOwn(length, 'value')
    && first.enumerable === true && second.enumerable === true && length.value === 2
    && typeof first.value === 'string' && SHA.test(first.value)
    && typeof second.value === 'string' && SHA.test(second.value));
}

function exactReviewedIdentity(input) {
  return Boolean(input
    && typeof input === 'object'
    && !Array.isArray(input)
    && input.repository === REVIEWED_IDENTITY.repository
    && input.prNumber === REVIEWED_IDENTITY.prNumber
    && input.branch === REVIEWED_IDENTITY.branch);
}

export function validateWorkerWatchdogReconciliationLineageV3(input = {}) {
  try {
    const sourceHead = text(input.sourceHead).toLowerCase();
    const baseSha = text(input.baseSha).toLowerCase();
    const lineage = input.lineageEvidence;
    if (!SHA.test(sourceHead) || !SHA.test(baseSha)
      || sourceHead === WINDOWS_AUTHORITY_WORKER_WATCHDOG_REVIEWED_ANCHOR_V3
      || sourceHead === baseSha
      || !exactDataRecord(lineage, LINEAGE_KEYS)
      || lineage.schemaVersion !== LINEAGE_SCHEMA
      || lineage.repository !== REVIEWED_IDENTITY.repository
      || lineage.sourceHead !== sourceHead
      || lineage.sourceCommitSha !== sourceHead
      || lineage.baseSha !== baseSha
      || lineage.liveMainBeforeSha !== baseSha
      || lineage.liveMainAfterSha !== baseSha
      || !exactParentEstate(lineage.parents)
      || lineage.parents[0] !== WINDOWS_AUTHORITY_WORKER_WATCHDOG_REVIEWED_ANCHOR_V3
      || lineage.parents[1] !== baseSha
      || !exactDataRecord(lineage.comparison, COMPARISON_KEYS)) return false;
    const comparison = lineage.comparison;
    return comparison.status === 'ahead'
      && Number.isSafeInteger(comparison.aheadBy)
      && comparison.aheadBy >= 1
      && comparison.behindBy === 0
      && comparison.baseCommitSha === baseSha
      && comparison.mergeBaseCommitSha === baseSha;
  } catch {
    return false;
  }
}

function exactEscalation(analysis = {}) {
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  if (findings.length !== 1) return false;
  const [item] = findings;
  return text(item?.severity).toUpperCase() === 'P0'
    && text(item?.code) === 'unsupported-high-risk-surface'
    && text(item?.path) === WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V3[0];
}

function exactSource(source, repository, sourceHead, path) {
  try {
    if (!exactDataRecord(source, SOURCE_RECORD_KEYS)) return false;
    const content = typeof source.content === 'string' ? source.content : '';
    const size = Buffer.byteLength(content, 'utf8');
    const expected = WINDOWS_AUTHORITY_WORKER_WATCHDOG_REVIEWED_MANIFEST_V3[path];
    return Boolean(expected
      && source.schemaVersion === SOURCE_SCHEMA
      && source.repository === repository
      && source.path === path
      && source.ref === sourceHead
      && source.exists === true
      && Number.isSafeInteger(source.size)
      && source.size === size
      && size > 0
      && size <= MAX_SOURCE_BYTES
      && source.size === expected.size
      && SHA.test(text(source.blobSha))
      && source.blobSha === expected.blobSha
      && source.blobSha === blobSha(content));
  } catch {
    return false;
  }
}

export function reviewCurrentWorkerWatchdogSourceSemanticsV3(path, source) {
  if (path !== WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V3[0] || typeof source !== 'string') {
    return Object.freeze([finding(
      'windows-authority-v3-source-path-invalid',
      'The PR #1732 watchdog continuation may review only the exact canonical probe path.',
      path,
    )]);
  }
  const findings = [...reviewCurrentWorkerWatchdogSourceSemanticsV2(path, source)];
  for (const pattern of REQUIRED_CURRENT_PROBE_PATTERNS) {
    if (!pattern.test(source)) {
      findings.push(finding(
        'windows-authority-v3-typed-restart-failure-contract-missing',
        'The current PR #1732 probe must preserve the closed-world typed Mission Worker restart failure contract.',
        path,
      ));
      break;
    }
  }
  return Object.freeze(findings);
}

function result({ clean, findings = [], finalVerdict, proofRefs = [] }) {
  return Object.freeze({
    schemaVersion: SCHEMA,
    eligible: true,
    clean,
    reviewedPaths: WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V3,
    findings: Object.freeze(findings),
    proofRefs: Object.freeze(proofRefs),
    finalVerdict,
  });
}

export function analyzeWindowsAuthorityWorkerWatchdogReviewV3(input = {}) {
  if (!exactReviewedIdentity(input)) {
    return Object.freeze({
      schemaVersion: SCHEMA,
      eligible: false,
      clean: false,
      reviewedPaths: WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V3,
      findings: Object.freeze([]),
      proofRefs: Object.freeze([]),
      finalVerdict: 'WINDOWS_AUTHORITY_WORKER_WATCHDOG_V3_NOT_APPLICABLE',
    });
  }

  if (!exactEscalation(input.analysis)) {
    return result({
      clean: false,
      findings: [finding(
        'windows-authority-v3-escalation-mismatch',
        'The PR #1732 specialist profile requires exactly one unsupported-high-risk P0 on the canonical watchdog probe.',
      )],
      finalVerdict: 'WINDOWS_AUTHORITY_WORKER_WATCHDOG_V3_BLOCKED',
    });
  }

  if (!validateWorkerWatchdogReconciliationLineageV3(input)) {
    return result({
      clean: false,
      findings: [finding(
        'windows-authority-v3-reviewed-lineage-mismatch',
        'The PR #1732 source head is not the exact one-step current-main preservation continuation of the reviewed watchdog repair anchor.',
      )],
      finalVerdict: 'WINDOWS_AUTHORITY_WORKER_WATCHDOG_V3_BLOCKED',
    });
  }

  if (!Array.isArray(input.sources) || input.sources.length === 0) {
    return result({
      clean: false,
      findings: [finding(
        'windows-authority-v3-exact-source-required',
        'Exact-head source is required before the PR #1732 Windows watchdog specialist can issue a verdict.',
      )],
      finalVerdict: 'WINDOWS_AUTHORITY_WORKER_WATCHDOG_V3_SOURCE_REQUIRED',
    });
  }

  if (input.sources.length !== 1) {
    return result({
      clean: false,
      findings: [finding(
        'windows-authority-v3-source-estate-mismatch',
        'The PR #1732 specialist profile accepts exactly one source record for the canonical watchdog probe.',
      )],
      finalVerdict: 'WINDOWS_AUTHORITY_WORKER_WATCHDOG_V3_BLOCKED',
    });
  }

  const source = input.sources[0];
  const path = WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V3[0];
  if (!exactSource(source, REVIEWED_IDENTITY.repository, text(input.sourceHead).toLowerCase(), path)) {
    return result({
      clean: false,
      findings: [finding(
        'windows-authority-v3-reviewed-source-mismatch',
        'The PR #1732 watchdog probe does not match the exact reviewed blob and byte size.',
      )],
      finalVerdict: 'WINDOWS_AUTHORITY_WORKER_WATCHDOG_V3_BLOCKED',
    });
  }

  const semanticFindings = reviewCurrentWorkerWatchdogSourceSemanticsV3(path, source.content);
  if (semanticFindings.length > 0) {
    return result({
      clean: false,
      findings: semanticFindings,
      finalVerdict: 'WINDOWS_AUTHORITY_WORKER_WATCHDOG_V3_BLOCKED',
    });
  }

  return result({
    clean: true,
    findings: [],
    proofRefs: [
      'windows-authority:worker-watchdog-v3',
      'pr:1732',
      `reviewed-anchor:${WINDOWS_AUTHORITY_WORKER_WATCHDOG_REVIEWED_ANCHOR_V3}`,
      `source:${path}@${WINDOWS_AUTHORITY_WORKER_WATCHDOG_REVIEWED_MANIFEST_V3[path].blobSha}`,
    ],
    finalVerdict: 'WINDOWS_AUTHORITY_WORKER_WATCHDOG_V3_CLEAN',
  });
}
