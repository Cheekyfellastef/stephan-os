import { createHash } from 'node:crypto';

export const WINDOWS_AUTHORITY_MISSION_WORKER_CLEANUP_PATHS_V1 = Object.freeze([
  'scripts/windows/restart-approved-stephanos-runtime.ps1',
]);

const SCHEMA = 'stephanos.windows-authority-mission-worker-cleanup-review.v1';
const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const LINEAGE_SCHEMA = 'stephanos.windows-authority-reconciliation-lineage.v1';
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const CLEANUP_PR_NUMBER = 2097;
const CLEANUP_BRANCH = 'fix/mission-worker-cleanup-launch-receipt-proof-v1';
const ORPHAN_CAPABILITY_PR_NUMBER = 2105;
const ORPHAN_CAPABILITY_BRANCH = 'fix/mission-worker-orphan-capability-starttime-v1';
const ORPHAN_CAPABILITY_HEAD = '5e04abd527ae76f782799014e1c84c150ae0e7fe';
const ORPHAN_CAPABILITY_BLOB_SHA = '24bdbd048e30eda6641a8122d60e9262521af376';
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
  const open = source.indexOf('{', start + marker.length);
  if (open < 0) return '';

  let depth = 0;
  let state = 'code';
  for (let index = open; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];

    if (state === 'line-comment') {
      if (current === '\n') state = 'code';
      continue;
    }
    if (state === 'block-comment') {
      if (current === '#' && next === '>') { state = 'code'; index += 1; }
      continue;
    }
    if (state === 'single-quote') {
      if (current === "'" && next === "'") { index += 1; continue; }
      if (current === "'") state = 'code';
      continue;
    }
    if (state === 'double-quote') {
      if (current === '`') { index += 1; continue; }
      if (current === '"') state = 'code';
      continue;
    }

    if (current === '#') { state = 'line-comment'; continue; }
    if (current === '<' && next === '#') { state = 'block-comment'; index += 1; continue; }
    if (current === "'") { state = 'single-quote'; continue; }
    if (current === '"') { state = 'double-quote'; continue; }
    if (current === '`') { index += 1; continue; }
    if (current === '{') { depth += 1; continue; }
    if (current === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
      if (depth < 0) return '';
    }
  }
  return '';
}

function inspectCleanupSource(source) {
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

  const fixedTaskLiteral = /Get-ScheduledTask\s+-TaskName\s+'Stephanos Mission Orchestrator Worker'\s+-TaskPath\s+'\\'/i.test(fallback);
  const fixedTaskViaValidatedPlan = /if\s*\(\s*\[string\]\s*\$Plan\.TaskName\s+-ne\s+'Stephanos Mission Orchestrator Worker'\s*\)\s*\{[\s\S]*?Stop-WithBlocker\s+'MISSION_WORKER_CLEANUP_TASK_NOT_ALLOWLISTED'[\s\S]*?\}/i.test(fallback)
    && /Get-ScheduledTask\s+-TaskName\s+\$Plan\.TaskName\s+-TaskPath\s+'\\'/i.test(fallback);
  if (!fixedTaskLiteral && !fixedTaskViaValidatedPlan) {
    findings.push(finding('mission-worker-cleanup-task-not-fixed', 'Fallback must inspect only the fixed Mission Worker Scheduled Task.'));
  }
  requireIn(fallback, /State[^\r\n]*-in\s+@\('Running',\s*'Queued'\)/i, 'mission-worker-cleanup-task-quiescence-missing', 'Fallback must reject Running or Queued task state.');
  requireIn(fallback, /Get-UniquelyVerifiedCanonicalWorkerProcessWithoutHeartbeat\s+-ExpectedRepoRoot\s+\$ExpectedRepoRoot/i, 'mission-worker-cleanup-canonical-selector-missing', 'Fallback must reuse the exact canonical worker selector.');
  requireIn(fallback, /ProcessStartedAtUtc\.ToUniversalTime\(\)\.Ticks\s+-le\s+\$StartedAfterUtc\.ToUniversalTime\(\)\.Ticks/i, 'mission-worker-cleanup-freshness-boundary-missing', 'Pre-existing worker processes must remain ineligible.');
  requireIn(fallback, /Get-CimInstance\s+Win32_Process\s+-Filter\s+"ProcessId = \$\(\$candidate\.ProcessId\)"/i, 'mission-worker-cleanup-process-reread-missing', 'Candidate PID must be re-read before capability binding.');
  requireIn(fallback, /Test-ExactCanonicalWorkerProcess\s+-Process\s+\$reread\s+-ExpectedRepoRoot\s+\$ExpectedRepoRoot/i, 'mission-worker-cleanup-command-recheck-missing', 'Re-read process must still match the exact canonical command.');
  requireIn(fallback, /\[System\.Diagnostics\.Process\]::GetProcessById\(\s*(?:\[int\]\s*)?\$candidate\.ProcessId\s*\)/i, 'mission-worker-cleanup-capability-bind-missing', 'Cleanup must bind a Process capability to the exact candidate PID.');
  const capabilityHandle = /\$null\s*=\s*\$processCapability\.Handle/i.test(fallback);
  const capabilityExit = /\$processCapability\.HasExited/i.test(fallback);
  const capabilityId = /\$processCapability\.Id\s+-ne\s+(?:\[int\]\s*)?\$candidate\.ProcessId/i.test(fallback);
  const capabilityStart = /\$processCapability\.StartTime\.ToUniversalTime\(\)/i.test(fallback)
    && /(?:capabilityStartedAtUtc|capabilityProcessStartedAtUtc)\.Ticks\s+-ne\s+\$candidate\.ProcessStartedAtUtc\.ToUniversalTime\(\)\.Ticks/i.test(fallback);
  if (!capabilityHandle || !capabilityExit || !capabilityId || !capabilityStart) {
    findings.push(finding('mission-worker-cleanup-capability-recheck-missing', 'Handle, exit state, exact PID and exact start time must be revalidated.'));
  }
  requireIn(fallback, /MISSION_WORKER_CLEANUP_(?:PROCESS_IDENTITY_NOT_PROVEN|FALLBACK_PROCESS_NOT_PROVEN)/, 'mission-worker-cleanup-not-proven-blocker-missing', 'Unproven fallback identity must fail with the typed cleanup blocker.');
  requireIn(fallback, /MISSION_WORKER_CLEANUP_(?:FALLBACK_)?PROCESS_IDENTITY_CHANGED/, 'mission-worker-cleanup-identity-changed-blocker-missing', 'Changed fallback identity must fail with the typed cleanup blocker.');

  const preferred = cleanup.indexOf('Get-VerifiedInvocationProcessFromLaunchReceipt');
  const fallbackUse = cleanup.indexOf('Get-VerifiedCleanupFallbackWorkerProcess');
  if (preferred < 0 || fallbackUse < 0 || preferred >= fallbackUse) {
    findings.push(finding('mission-worker-cleanup-receipt-not-preferred', 'Launch-receipt proof must remain the preferred cleanup ownership proof.'));
  }
  const negatedFallback = /if\s*\(\s*-not\s+\$verifiedInvocationProcess\s*\)[\s\S]*?Get-VerifiedCleanupFallbackWorkerProcess/i.test(cleanup);
  const elseFallback = /if\s*\(\s*\$verifiedInvocationProcess\s*\)[\s\S]*?\}\s*else\s*\{[\s\S]*?Get-VerifiedCleanupFallbackWorkerProcess/i.test(cleanup);
  if (!negatedFallback && !elseFallback) {
    findings.push(finding('mission-worker-cleanup-fallback-not-narrow', 'Fallback must be reachable only when launch-receipt proof is unavailable.'));
  }
  const fallbackCalls = cleanup.match(/Get-VerifiedCleanupFallbackWorkerProcess/g) || [];
  if (fallbackCalls.length < 2) {
    findings.push(finding('mission-worker-cleanup-fallback-reverification-missing', 'The same fallback contract must reverify identity before cancellation.'));
  }
  requireIn(cleanup, /-ExpectedProcessId\s+\$verifiedWorker\.ProcessId[\s\S]*-ExpectedProcessStartedAtUtc\s+\$verifiedWorker\.ProcessStartedAtUtc/, 'mission-worker-cleanup-exact-reverification-missing', 'Pre-cancellation fallback revalidation must pin PID and start time.');

  forbidIn(`${fallback}\n${cleanup}`, /\bStop-Process\b|\btaskkill(?:\.exe)?\b|Invoke-Expression|\biex\b|Start-Process|cmd(?:\.exe)?\s+\/c|powershell(?:\.exe)?\s+-command/i, 'mission-worker-cleanup-generic-execution-forbidden', 'Fallback cleanup may not gain generic process or shell authority.');
  forbidIn(fallback, /param\([\s\S]*\$(?:TaskName|TaskPath|Executable|CommandLine|ProcessPath)\b/i, 'mission-worker-cleanup-caller-authority-forbidden', 'Fallback may not accept caller-selected task, executable or command authority.');
  return findings;
}

function inspectOrphanCapabilitySource(source) {
  const findings = [];
  const selector = functionSlice(source, 'Get-UniquelyVerifiedCanonicalWorkerProcessWithoutHeartbeat');
  const requireIn = (pattern, code, summary) => {
    if (!pattern.test(selector)) findings.push(finding(code, summary));
  };
  const forbidIn = (pattern, code, summary) => {
    if (pattern.test(selector)) findings.push(finding(code, summary));
  };

  if (!selector) {
    findings.push(finding('mission-worker-orphan-selector-missing', 'The canonical orphan worker selector must remain present.'));
    return findings;
  }

  requireIn(/Get-CimInstance\s+Win32_Process\s+-Filter\s+"Name = 'node\.exe'"/i, 'mission-worker-orphan-canonical-query-missing', 'Orphan reclaim must discover only Node processes through the fixed CIM query.');
  requireIn(/Test-ExactCanonicalWorkerProcess\s+-Process\s+\$process\s+-ExpectedRepoRoot\s+\$ExpectedRepoRoot/i, 'mission-worker-orphan-canonical-command-check-missing', 'Candidate discovery must keep exact canonical command verification.');
  requireIn(/\$canonicalWorkers\.Count\s+-gt\s+1[\s\S]*MISSION_WORKER_CANONICAL_PROCESS_IDENTITY_AMBIGUOUS/i, 'mission-worker-orphan-uniqueness-missing', 'Ambiguous canonical worker selection must remain fail closed.');
  requireIn(/\$processId\s*=\s*\[int\]\$candidate\.ProcessId/i, 'mission-worker-orphan-fixed-pid-missing', 'The live process capability must bind to the uniquely selected candidate PID.');
  requireIn(/\[System\.Diagnostics\.Process\]::GetProcessById\(\$processId\)/i, 'mission-worker-orphan-capability-bind-missing', 'Orphan reclaim must bind a System.Diagnostics.Process capability to the fixed PID.');
  requireIn(/if\s*\(\s*\$processCapability\.HasExited\s+-or\s+\$processCapability\.Id\s+-ne\s+\$processId\s*\)\s*\{[\s\S]*?Stop-WithBlocker\s+'MISSION_WORKER_ORPHAN_PROCESS_CAPABILITY_CHANGED'[\s\S]*?\}/i, 'mission-worker-orphan-capability-rejection-missing', 'Exited or PID-rebound capabilities must enter the typed fail-closed branch.');
  requireIn(/\$null\s*=\s*\$processCapability\.Handle/i, 'mission-worker-orphan-capability-handle-missing', 'Bound process capability must expose a usable handle.');
  requireIn(/\$capabilityProcessStartedAtUtc\s*=\s*\$processCapability\.StartTime\.ToUniversalTime\(\)/i, 'mission-worker-orphan-capability-starttime-missing', 'Returned process identity must originate from the live Process capability start time.');
  requireIn(/\$candidateReRead\s*=\s*Get-CimInstance\s+Win32_Process\s+-Filter\s+"ProcessId = \$processId"/i, 'mission-worker-orphan-cim-reread-missing', 'The same PID must be re-read through CIM after capability binding.');
  requireIn(/if\s*\(\s*-not\s+\$candidateReRead\s+-or\s+-not\s*\(\s*Test-ExactCanonicalWorkerProcess\s+-Process\s+\$candidateReRead\s+-ExpectedRepoRoot\s+\$ExpectedRepoRoot\s*\)\s*\)\s*\{[\s\S]*?Stop-WithBlocker\s+'MISSION_WORKER_ORPHAN_PROCESS_IDENTITY_CHANGED'[\s\S]*?\}/i, 'mission-worker-orphan-cim-command-rejection-missing', 'Missing or non-canonical post-bind CIM observations must enter the typed fail-closed branch.');
  requireIn(/\$candidateReReadStartedAtUtc\s*=\s*\(\[datetime\]\$candidateReRead\.CreationDate\)\.ToUniversalTime\(\)/i, 'mission-worker-orphan-cim-creation-reread-missing', 'Post-bind CIM creation identity must be materialized.');
  requireIn(/if\s*\(\s*\$candidateReReadStartedAtUtc\.Ticks\s+-ne\s+\$candidateStartedAtUtc\.Ticks\s*\)\s*\{[\s\S]*?Stop-WithBlocker\s+'MISSION_WORKER_ORPHAN_PROCESS_IDENTITY_CHANGED'[\s\S]*?\}/i, 'mission-worker-orphan-cim-identity-rejection-missing', 'Changed CIM creation identity must enter the typed fail-closed branch.');
  requireIn(/ProcessStartedAtUtc\s*=\s*\$capabilityProcessStartedAtUtc/i, 'mission-worker-orphan-same-api-return-missing', 'Subsequent rechecks must receive the Process capability start identity.');
  requireIn(/ProcessCapability\s*=\s*\$processCapability/i, 'mission-worker-orphan-capability-return-missing', 'The exact live Process capability must be returned with the identity.');
  requireIn(/MISSION_WORKER_ORPHAN_PROCESS_CAPABILITY_CHANGED/, 'mission-worker-orphan-capability-blocker-missing', 'Capability failure must retain the typed orphan blocker.');
  requireIn(/MISSION_WORKER_ORPHAN_PROCESS_IDENTITY_CHANGED/, 'mission-worker-orphan-identity-blocker-missing', 'Identity failure must retain the typed orphan blocker.');

  const capabilityBind = selector.search(/\[System\.Diagnostics\.Process\]::GetProcessById\(\$processId\)/i);
  const cimReRead = selector.search(/\$candidateReRead\s*=\s*Get-CimInstance\s+Win32_Process\s+-Filter\s+"ProcessId = \$processId"/i);
  const returnedIdentity = selector.search(/ProcessStartedAtUtc\s*=\s*\$capabilityProcessStartedAtUtc/i);
  if (capabilityBind < 0 || cimReRead <= capabilityBind || returnedIdentity <= cimReRead) {
    findings.push(finding('mission-worker-orphan-rebinding-order-invalid', 'Capability binding, CIM identity recheck and same-API return must remain ordered.'));
  }

  forbidIn(/\$capabilityProcessStartedAtUtc\.Ticks\s+-ne\s+\$candidateStartedAtUtc\.Ticks|\$candidateStartedAtUtc\.Ticks\s+-ne\s+\$capabilityProcessStartedAtUtc\.Ticks/i, 'mission-worker-orphan-cross-api-tick-equality-forbidden', 'CIM creation ticks must not be demanded to equal Process.StartTime ticks.');
  forbidIn(/\bStop-Process\b|\btaskkill(?:\.exe)?\b|Invoke-Expression|\biex\b|Start-Process|cmd(?:\.exe)?\s+\/c|powershell(?:\.exe)?\s+-command/i, 'mission-worker-orphan-generic-execution-forbidden', 'Orphan identity proof may not gain generic process or shell authority.');
  const parameterArea = selector.slice(0, Math.max(0, selector.indexOf('$canonicalWorkers')));
  if (/\$(?:ProcessId|Pid|TaskName|TaskPath|Executable|CommandLine|ProcessPath)\b/i.test(parameterArea)) {
    findings.push(finding('mission-worker-orphan-caller-authority-forbidden', 'Orphan identity proof may not accept caller-selected process, task or executable authority.'));
  }
  return findings;
}

function profileFor(input = {}) {
  if (Number(input.prNumber) === CLEANUP_PR_NUMBER && text(input.branch) === CLEANUP_BRANCH) return 'cleanup';
  if (Number(input.prNumber) === ORPHAN_CAPABILITY_PR_NUMBER && text(input.branch) === ORPHAN_CAPABILITY_BRANCH) return 'orphan-capability';
  return null;
}

export function analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(input = {}) {
  const sourceHead = text(input.sourceHead).toLowerCase();
  const baseSha = text(input.baseSha).toLowerCase();
  const profile = profileFor(input);
  const eligible = input.repository === REPOSITORY
    && profile !== null
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
  } else if (profile === 'cleanup') {
    findings.push(...inspectCleanupSource(sources[0].content));
  } else {
    if (sourceHead !== ORPHAN_CAPABILITY_HEAD || sources[0].blobSha !== ORPHAN_CAPABILITY_BLOB_SHA) {
      findings.push(finding('mission-worker-orphan-exact-source-not-pinned', 'Orphan capability approval requires the exact expected source head and full runtime-script blob.'));
    }
    findings.push(...inspectOrphanCapabilitySource(sources[0].content));
  }
  const clean = findings.length === 0;
  const prNumber = Number(input.prNumber);
  const proofNamespace = profile === 'cleanup' ? 'mission-worker-cleanup' : 'mission-worker-orphan-capability';
  return Object.freeze({
    schemaVersion: SCHEMA,
    eligible: true,
    clean,
    reviewedPaths: WINDOWS_AUTHORITY_MISSION_WORKER_CLEANUP_PATHS_V1,
    findings: Object.freeze(findings),
    proofRefs: clean ? Object.freeze([
      `proofs/windows-authority/${proofNamespace}/pr-${prNumber}`,
      `proofs/windows-authority/${proofNamespace}/${PATH}@${sourceHead}#${sources[0].blobSha}`,
      ...(profile === 'cleanup'
        ? ['proofs/windows-authority/mission-worker-cleanup/launch-receipt-preferred', 'proofs/windows-authority/mission-worker-cleanup/exact-process-capability-reverified']
        : ['proofs/windows-authority/mission-worker-orphan-capability/cim-identity-stable', 'proofs/windows-authority/mission-worker-orphan-capability/same-api-starttime-rebound']),
    ]) : Object.freeze([]),
    sourceMutationAllowed: false,
    mergeAuthority: false,
    runtimeMutationAllowed: false,
    providerQualificationAuthority: false,
    finalVerdict: clean
      ? (profile === 'cleanup' ? 'WINDOWS_AUTHORITY_MISSION_WORKER_CLEANUP_CLEAN' : 'WINDOWS_AUTHORITY_MISSION_WORKER_ORPHAN_CAPABILITY_CLEAN')
      : (profile === 'cleanup' ? 'WINDOWS_AUTHORITY_MISSION_WORKER_CLEANUP_FINDINGS' : 'WINDOWS_AUTHORITY_MISSION_WORKER_ORPHAN_CAPABILITY_FINDINGS'),
  });
}
