import { createHash } from 'node:crypto';

export const WINDOWS_AUTHORITY_MISSION_WORKER_CLEANUP_PATHS_V1 = Object.freeze([
  'scripts/windows/restart-approved-stephanos-runtime.ps1',
]);

const SCHEMA = 'stephanos.windows-authority-mission-worker-cleanup-review.v1';
const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const LINEAGE_SCHEMA = 'stephanos.windows-authority-reconciliation-lineage.v1';
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const PR_NUMBER = 2097;
const BRANCH = 'fix/mission-worker-cleanup-launch-receipt-proof-v1';
const PATH = WINDOWS_AUTHORITY_MISSION_WORKER_CLEANUP_PATHS_V1[0];
const SHA = /^[a-f0-9]{40}$/;
const MAX_SOURCE_BYTES = 256 * 1024;

const text = (value) => String(value ?? '').trim();
const finding = (code, summary) => Object.freeze({ severity: 'P0', code, summary, path: PATH });

function blobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function exactEscalation(analysis = {}) {
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  return findings.length === 1
    && text(findings[0]?.severity).toUpperCase() === 'P0'
    && text(findings[0]?.code) === 'unsupported-high-risk-surface'
    && text(findings[0]?.path) === PATH
    && Number(analysis?.counts?.P0) === 1
    && Number(analysis?.counts?.P1) === 0;
}

function exactLineage(lineage, sourceHead, baseSha) {
  const parents = Array.isArray(lineage?.parents) ? lineage.parents.map((item) => text(item).toLowerCase()) : [];
  return lineage?.schemaVersion === LINEAGE_SCHEMA
    && lineage.repository === REPOSITORY
    && lineage.sourceHead === sourceHead
    && lineage.sourceCommitSha === sourceHead
    && lineage.baseSha === baseSha
    && lineage.liveMainBeforeSha === baseSha
    && lineage.liveMainAfterSha === baseSha
    && parents.length >= 1
    && parents.includes(baseSha)
    && lineage?.comparison?.status === 'ahead'
    && Number.isSafeInteger(lineage?.comparison?.aheadBy)
    && lineage.comparison.aheadBy > 0
    && lineage.comparison.behindBy === 0
    && lineage.comparison.baseCommitSha === baseSha
    && lineage.comparison.mergeBaseCommitSha === baseSha;
}

function exactSource(source, sourceHead) {
  const content = typeof source?.content === 'string' ? source.content : '';
  const size = Buffer.byteLength(content, 'utf8');
  return Boolean(source && typeof source === 'object' && !Array.isArray(source)
    && source.schemaVersion === SOURCE_SCHEMA
    && source.repository === REPOSITORY
    && source.path === PATH
    && source.ref === sourceHead
    && source.exists === true
    && Number.isSafeInteger(source.size)
    && source.size === size
    && size > 0
    && size <= MAX_SOURCE_BYTES
    && SHA.test(text(source.blobSha))
    && source.blobSha === blobSha(content));
}

function functionSlice(source, name) {
  const marker = `function ${name}`;
  const start = source.indexOf(marker);
  if (start < 0) return '';
  const searchStart = start + marker.length;
  const remainder = source.slice(searchStart);
  const nextFunction = /\r?\nfunction\s+[A-Za-z0-9-]+\s*\{/.exec(remainder);
  const end = nextFunction ? searchStart + nextFunction.index : source.length;
  return source.slice(start, end);
}

function inspectSource(source) {
  const findings = [];
  const fallback = functionSlice(source, 'Get-VerifiedCleanupFallbackWorkerProcess');
  const cleanup = functionSlice(source, 'Stop-NewlyStartedOwnedWorker');
  const requireIn = (area, pattern, code, summary) => {
    if (!pattern.test(area)) findings.push(finding(code, summary));
  };
  const forbidIn = (area, pattern, code, summary) => {
    if (pattern.test(area)) findings.push(finding(code, summary));
  };

  if (!fallback || !cleanup) {
    findings.push(finding('mission-worker-cleanup-functions-missing', 'Both bounded fallback and cleanup functions must be present.'));
    return findings;
  }

  requireIn(fallback, /Get-ScheduledTask\s+-TaskName\s+'Stephanos Mission Orchestrator Worker'\s+-TaskPath\s+'\\'/, 'mission-worker-cleanup-task-not-fixed', 'Fallback must inspect only the fixed Mission Worker Scheduled Task.');
  requireIn(fallback, /State[^\r\n]*-in\s+@\('Running',\s*'Queued'\)/, 'mission-worker-cleanup-task-quiescence-missing', 'Fallback must reject Running or Queued task state.');
  requireIn(fallback, /Get-UniquelyVerifiedCanonicalWorkerProcessWithoutHeartbeat\s+-ExpectedRepoRoot\s+\$ExpectedRepoRoot/, 'mission-worker-cleanup-canonical-selector-missing', 'Fallback must reuse the exact canonical worker selector.');
  requireIn(fallback, /ProcessStartedAtUtc\.ToUniversalTime\(\)\.Ticks\s+-le\s+\$StartedAfterUtc\.ToUniversalTime\(\)\.Ticks/, 'mission-worker-cleanup-freshness-boundary-missing', 'Pre-existing worker processes must remain ineligible.');
  requireIn(fallback, /Get-CimInstance\s+Win32_Process\s+-Filter\s+"ProcessId = \$\(\$candidate\.ProcessId\)"/, 'mission-worker-cleanup-process-reread-missing', 'Candidate PID must be re-read before capability binding.');
  requireIn(fallback, /Test-ExactCanonicalWorkerProcess\s+-Process\s+\$reRead\s+-ExpectedRepoRoot\s+\$ExpectedRepoRoot/, 'mission-worker-cleanup-command-recheck-missing', 'Re-read process must still match the exact canonical command.');
  requireIn(fallback, /\[System\.Diagnostics\.Process\]::GetProcessById\(\$candidate\.ProcessId\)/, 'mission-worker-cleanup-capability-bind-missing', 'Cleanup must bind a Process capability to the exact candidate PID.');
  requireIn(fallback, /\$null\s*=\s*\$processCapability\.Handle[\s\S]*\$processCapability\.HasExited[\s\S]*\$processCapability\.StartTime\.ToUniversalTime\(\)\.Ticks/, 'mission-worker-cleanup-capability-recheck-missing', 'Handle, exit state and exact start time must be revalidated.');
  requireIn(fallback, /MISSION_WORKER_CLEANUP_FALLBACK_PROCESS_NOT_PROVEN/, 'mission-worker-cleanup-not-proven-blocker-missing', 'Unproven fallback identity must fail with the typed blocker.');
  requireIn(fallback, /MISSION_WORKER_CLEANUP_FALLBACK_PROCESS_IDENTITY_CHANGED/, 'mission-worker-cleanup-identity-changed-blocker-missing', 'Changed fallback identity must fail with the typed blocker.');

  const preferred = cleanup.indexOf('Get-VerifiedInvocationProcessFromLaunchReceipt');
  const fallbackUse = cleanup.indexOf('Get-VerifiedCleanupFallbackWorkerProcess');
  if (preferred < 0 || fallbackUse < 0 || preferred >= fallbackUse) {
    findings.push(finding('mission-worker-cleanup-receipt-not-preferred', 'Launch-receipt proof must remain the preferred cleanup ownership proof.'));
  }
  requireIn(cleanup, /if\s*\(-not\s+\$verifiedInvocationProcess\)[\s\S]*Get-VerifiedCleanupFallbackWorkerProcess/, 'mission-worker-cleanup-fallback-not-narrow', 'Fallback must be reachable only when launch-receipt proof is unavailable.');
  const fallbackCalls = cleanup.match(/Get-VerifiedCleanupFallbackWorkerProcess/g) || [];
  if (fallbackCalls.length < 2) {
    findings.push(finding('mission-worker-cleanup-fallback-reverification-missing', 'The same fallback contract must reverify identity before cancellation.'));
  }
  requireIn(cleanup, /-ExpectedProcessId\s+\$verifiedWorker\.ProcessId[\s\S]*-ExpectedProcessStartedAtUtc\s+\$verifiedWorker\.ProcessStartedAtUtc/, 'mission-worker-cleanup-exact-reverification-missing', 'Pre-cancellation fallback revalidation must pin PID and start time.');

  forbidIn(`${fallback}\n${cleanup}`, /\bStop-Process\b|\btaskkill(?:\.exe)?\b|Invoke-Expression|\biex\b|Start-Process|cmd(?:\.exe)?\s+\/c|powershell(?:\.exe)?\s+-command/i, 'mission-worker-cleanup-generic-execution-forbidden', 'Fallback cleanup may not gain generic process or shell authority.');
  forbidIn(fallback, /param\([\s\S]*\$(?:TaskName|TaskPath|Executable|CommandLine|ProcessPath)\b/i, 'mission-worker-cleanup-caller-authority-forbidden', 'Fallback may not accept caller-selected task, executable or command authority.');
  return findings;
}

export function analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(input = {}) {
  const sourceHead = text(input.sourceHead).toLowerCase();
  const baseSha = text(input.baseSha).toLowerCase();
  const eligible = input.repository === REPOSITORY
    && Number(input.prNumber) === PR_NUMBER
    && text(input.branch) === BRANCH
    && SHA.test(sourceHead)
    && SHA.test(baseSha)
    && exactEscalation(input.analysis);
  if (!eligible) return Object.freeze({
    schemaVersion: SCHEMA, eligible: false, clean: false, reviewedPaths: Object.freeze([]),
    findings: Object.freeze([]), proofRefs: Object.freeze([]),
    finalVerdict: 'WINDOWS_AUTHORITY_MISSION_WORKER_CLEANUP_NOT_APPLICABLE',
  });

  const findings = [];
  if (!exactLineage(input.lineageEvidence, sourceHead, baseSha)) {
    findings.push(finding('mission-worker-cleanup-current-main-lineage-invalid', 'Review requires exact-current-main ahead-only lineage.'));
  }
  const sources = Array.isArray(input.sources) ? input.sources : [];
  if (sources.length !== 1 || !exactSource(sources[0], sourceHead)) {
    findings.push(finding('mission-worker-cleanup-source-evidence-invalid', 'Review requires one content-derived exact-head source record.'));
  } else {
    findings.push(...inspectSource(sources[0].content));
  }
  const clean = findings.length === 0;
  return Object.freeze({
    schemaVersion: SCHEMA,
    eligible: true,
    clean,
    reviewedPaths: WINDOWS_AUTHORITY_MISSION_WORKER_CLEANUP_PATHS_V1,
    findings: Object.freeze(findings),
    proofRefs: clean ? Object.freeze([
      `proofs/windows-authority/mission-worker-cleanup/pr-${PR_NUMBER}`,
      `proofs/windows-authority/mission-worker-cleanup/${PATH}@${sourceHead}#${sources[0].blobSha}`,
      'proofs/windows-authority/mission-worker-cleanup/launch-receipt-preferred',
      'proofs/windows-authority/mission-worker-cleanup/exact-process-capability-reverified',
    ]) : Object.freeze([]),
    sourceMutationAllowed: false,
    mergeAuthority: false,
    runtimeMutationAllowed: false,
    providerQualificationAuthority: false,
    finalVerdict: clean
      ? 'WINDOWS_AUTHORITY_MISSION_WORKER_CLEANUP_CLEAN'
      : 'WINDOWS_AUTHORITY_MISSION_WORKER_CLEANUP_FINDINGS',
  });
}
