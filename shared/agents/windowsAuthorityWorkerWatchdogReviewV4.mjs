import { createHash } from 'node:crypto';

import { reviewCurrentWorkerWatchdogSourceSemanticsV2 } from './windowsAuthorityWorkerWatchdogReviewV2.mjs';

export const WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V4 = Object.freeze([
  'scripts/windows/probe-mission-orchestrator-worker-watchdog.ps1',
  'scripts/windows/restart-approved-stephanos-runtime.ps1',
]);

export const WINDOWS_AUTHORITY_WORKER_WATCHDOG_REVIEWED_ANCHOR_V4 =
  '84f41d8c42ea615fa40a7bed57b84ffca085ddbd';
export const WINDOWS_AUTHORITY_WORKER_WATCHDOG_REPAIRED_HEAD_V4 =
  'edff74ceaf64e9006bd60da72a2eb9776d59c07c';

export const WINDOWS_AUTHORITY_WORKER_WATCHDOG_REVIEWED_MANIFEST_V4 = Object.freeze({
  'scripts/windows/probe-mission-orchestrator-worker-watchdog.ps1': Object.freeze({
    blobSha: '1c22a57ea23013ff9de3c947294aa05231a90798',
  }),
  'scripts/windows/restart-approved-stephanos-runtime.ps1': Object.freeze({
    blobSha: 'de4088bef6c8f763e7883410c4e7fb5be3998638',
  }),
});

const SCHEMA = 'stephanos.windows-authority-specialist-review.v1';
const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const LINEAGE_SCHEMA = 'stephanos.windows-authority-reconciliation-lineage.v1';
const SHA = /^[a-f0-9]{40}$/;
const MAX_SOURCE_BYTES = 256 * 1024;
const REVIEWED_IDENTITY = Object.freeze({
  repository: 'Cheekyfellastef/stephan-os',
  prNumber: 2066,
  branch: 'agent/1818-watchdog-stale-worker-reclaim-v1',
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
const REQUIRED_PROBE_PATTERNS = Object.freeze([
  /function\s+Read-ValidatedMissionWorkerRestartFailureBlocker\b/,
  /MISSION_WORKER_CANONICAL_PROCESS_QUERY_FAILED/,
  /MISSION_WORKER_CANONICAL_PROCESS_IDENTITY_AMBIGUOUS/,
  /MISSION_WORKER_ORPHAN_PROCESS_IDENTITY_CHANGED/,
  /MISSION_WORKER_ORPHAN_PROCESS_CAPABILITY_CHANGED/,
  /MISSION_WORKER_ORPHAN_PROCESS_DID_NOT_STOP/,
]);
const REQUIRED_RESTART_PATTERNS = Object.freeze([
  /function\s+Get-UniquelyVerifiedCanonicalWorkerProcessWithoutHeartbeat\b/,
  /Get-CimInstance\s+Win32_Process\s+-Filter\s+"Name = 'node\.exe'"/,
  /Test-ExactCanonicalWorkerProcess\s+-Process\s+\$process\s+-ExpectedRepoRoot\s+\$ExpectedRepoRoot/,
  /MISSION_WORKER_CANONICAL_PROCESS_IDENTITY_AMBIGUOUS/,
  /\[System\.Diagnostics\.Process\]::GetProcessById\(\$processId\)/,
  /\$capabilityProcessStartedAtUtc\s*=\s*\$processCapability\.StartTime\.ToUniversalTime\(\)/,
  /if\s*\(\[string\]\$task\.State\s+-in\s+@\('Running',\s*'Queued'\)\)/,
  /-notin\s+@\('Running',\s*'Queued'\)/,
  /\$preOrphanReclaimTask\s*=\s*Get-ScheduledTask/,
  /if\s*\(\[string\]\$preOrphanReclaimTask\.State\s+-in\s+@\('Running',\s*'Queued'\)\)/,
  /if\s*\(-not\s+\$oldWorker\)\s*\{[\s\S]*Get-UniquelyVerifiedCanonicalWorkerProcessWithoutHeartbeat/,
  /\$reverifiedOrphanProcessCapability\.Kill\(\)/,
  /\$reverifiedOrphanProcessCapability\.WaitForExit\(10000\)/,
  /MISSION_WORKER_ORPHAN_PROCESS_IDENTITY_CHANGED/,
  /MISSION_WORKER_ORPHAN_PROCESS_CAPABILITY_CHANGED/,
  /MISSION_WORKER_ORPHAN_PROCESS_DID_NOT_STOP/,
]);

const text = (value) => String(value ?? '').trim();
const finding = (code, summary, path = '') =>
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
    && Number(input.prNumber) === REVIEWED_IDENTITY.prNumber
    && input.branch === REVIEWED_IDENTITY.branch);
}

export function validateWorkerWatchdogReconciliationLineageV4(input = {}) {
  try {
    const sourceHead = text(input.sourceHead).toLowerCase();
    const baseSha = text(input.baseSha).toLowerCase();
    const lineage = input.lineageEvidence;
    if (!SHA.test(sourceHead)
      || !SHA.test(baseSha)
      || sourceHead === WINDOWS_AUTHORITY_WORKER_WATCHDOG_REPAIRED_HEAD_V4
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
      || lineage.parents[0] !== WINDOWS_AUTHORITY_WORKER_WATCHDOG_REPAIRED_HEAD_V4
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
  if (findings.length !== WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V4.length) return false;
  const paths = findings.map((item) => text(item?.path));
  return findings.every((item) =>
    text(item?.severity).toUpperCase() === 'P0'
    && text(item?.code) === 'unsupported-high-risk-surface')
    && new Set(paths).size === WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V4.length
    && WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V4.every((path) => paths.includes(path));
}

function exactSource(source, repository, sourceHead, path) {
  try {
    if (!exactDataRecord(source, SOURCE_RECORD_KEYS)) return false;
    const content = typeof source.content === 'string' ? source.content : '';
    const size = Buffer.byteLength(content, 'utf8');
    const expected = WINDOWS_AUTHORITY_WORKER_WATCHDOG_REVIEWED_MANIFEST_V4[path];
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
      && SHA.test(text(source.blobSha))
      && source.blobSha === expected.blobSha
      && source.blobSha === blobSha(content));
  } catch {
    return false;
  }
}

function semanticFindings(path, source) {
  const findings = [...reviewCurrentWorkerWatchdogSourceSemanticsV2(path, source)];
  const required = path === WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V4[0]
    ? REQUIRED_PROBE_PATTERNS
    : path === WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V4[1]
      ? REQUIRED_RESTART_PATTERNS
      : [];
  if (required.length === 0) {
    findings.push(finding(
      'windows-authority-v4-source-path-invalid',
      'The PR #2066 watchdog continuation may review only the exact two escalated Windows paths.',
      path,
    ));
    return findings;
  }
  for (const pattern of required) {
    if (!pattern.test(source)) {
      findings.push(finding(
        'windows-authority-v4-orphan-reclaim-boundary-missing',
        'The repaired PR #2066 source must preserve queued-task quiescence and the closed-world stale-worker reclaim boundary.',
        path,
      ));
      break;
    }
  }
  return findings;
}

function result({ clean, findings = [], finalVerdict, proofRefs = [] }) {
  return Object.freeze({
    schemaVersion: SCHEMA,
    eligible: true,
    clean,
    reviewedPaths: WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V4,
    findings: Object.freeze(findings),
    proofRefs: Object.freeze(proofRefs),
    finalVerdict,
  });
}

export function analyzeWindowsAuthorityWorkerWatchdogReviewV4(input = {}) {
  if (!exactReviewedIdentity(input)) {
    return Object.freeze({
      schemaVersion: SCHEMA,
      eligible: false,
      clean: false,
      reviewedPaths: Object.freeze([]),
      findings: Object.freeze([]),
      proofRefs: Object.freeze([]),
      finalVerdict: 'WINDOWS_AUTHORITY_WORKER_WATCHDOG_V4_NOT_APPLICABLE',
    });
  }
  if (!exactEscalation(input.analysis)) {
    return result({
      clean: false,
      findings: [finding(
        'windows-authority-v4-escalation-mismatch',
        'The PR #2066 profile requires exactly the two unsupported-high-risk Windows findings.',
      )],
      finalVerdict: 'WINDOWS_AUTHORITY_WORKER_WATCHDOG_V4_BLOCKED',
    });
  }
  if (!validateWorkerWatchdogReconciliationLineageV4(input)) {
    return result({
      clean: false,
      findings: [finding(
        'windows-authority-v4-reviewed-lineage-mismatch',
        'The PR #2066 source must be one exact forward preservation merge of the repaired head onto the live protected main.',
      )],
      finalVerdict: 'WINDOWS_AUTHORITY_WORKER_WATCHDOG_V4_BLOCKED',
    });
  }
  if (!Array.isArray(input.sources) || input.sources.length === 0) {
    return result({
      clean: false,
      findings: [finding(
        'windows-authority-v4-exact-source-required',
        'Exact-head source is required before the PR #2066 Windows watchdog specialist can issue a verdict.',
      )],
      finalVerdict: 'WINDOWS_AUTHORITY_WORKER_WATCHDOG_V4_SOURCE_REQUIRED',
    });
  }
  const sources = input.sources;
  if (sources.length !== WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V4.length
    || sources.some((source, index) => source?.path !== WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V4[index])) {
    return result({
      clean: false,
      findings: [finding(
        'windows-authority-v4-source-estate-mismatch',
        'The PR #2066 specialist profile requires exactly the ordered two-source Windows estate.',
      )],
      finalVerdict: 'WINDOWS_AUTHORITY_WORKER_WATCHDOG_V4_BLOCKED',
    });
  }

  const findings = [];
  const proofRefs = [];
  for (const [index, path] of WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V4.entries()) {
    const source = sources[index];
    if (!exactSource(source, REVIEWED_IDENTITY.repository, text(input.sourceHead).toLowerCase(), path)) {
      findings.push(finding(
        'windows-authority-v4-reviewed-source-mismatch',
        'The PR #2066 Windows source does not match the exact repaired reviewed blob.',
        path,
      ));
      continue;
    }
    findings.push(...semanticFindings(path, source.content));
    proofRefs.push(`windows-authority:worker-watchdog-v4:${path}@${source.blobSha}`);
  }

  const clean = findings.length === 0;
  return result({
    clean,
    findings,
    proofRefs: clean ? [
      'windows-authority:worker-watchdog-v4',
      'pr:2066',
      `reviewed-anchor:${WINDOWS_AUTHORITY_WORKER_WATCHDOG_REVIEWED_ANCHOR_V4}`,
      `repaired-head:${WINDOWS_AUTHORITY_WORKER_WATCHDOG_REPAIRED_HEAD_V4}`,
      ...proofRefs,
    ] : proofRefs,
    finalVerdict: clean
      ? 'WINDOWS_AUTHORITY_WORKER_WATCHDOG_V4_CLEAN'
      : 'WINDOWS_AUTHORITY_WORKER_WATCHDOG_V4_BLOCKED',
  });
}
