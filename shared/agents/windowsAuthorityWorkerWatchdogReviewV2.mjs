import { createHash } from 'node:crypto';

export const WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V2 = Object.freeze([
  'scripts/windows/probe-mission-orchestrator-worker-watchdog.ps1',
  'scripts/windows/restart-approved-stephanos-runtime.ps1',
  'scripts/windows/start-mission-orchestrator-worker.ps1',
]);

export const WINDOWS_AUTHORITY_WORKER_WATCHDOG_REVIEWED_MANIFEST_V2 = Object.freeze({
  'scripts/windows/probe-mission-orchestrator-worker-watchdog.ps1': Object.freeze({
    blobSha: 'e1daa40b9004a9058490697fce44f481b0608527',
    size: 22621,
  }),
  'scripts/windows/restart-approved-stephanos-runtime.ps1': Object.freeze({
    blobSha: '2bce3b6de334b1b4acd6481c1354c1e5ff097bd9',
    size: 66700,
  }),
  'scripts/windows/start-mission-orchestrator-worker.ps1': Object.freeze({
    blobSha: '84b7f6ac4a1e53462a3c5e882fd2c3a081050a72',
    size: 31123,
  }),
});

export const WINDOWS_AUTHORITY_WORKER_WATCHDOG_REVIEWED_ANCHOR_V2 =
  '6ca11104ed7fecd7f115eb7da2dcbbf7f8076e47';

const SCHEMA = 'stephanos.windows-authority-specialist-review.v1';
const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const PR_NUMBER = 2045;
const BRANCH = 'codex/worker-watchdog-current-main-binding-v2';
const SHA = /^[a-f0-9]{40}$/;
const MAX_SOURCE_BYTES = 256 * 1024;
const EXACT_ESCALATION_CODE = 'unsupported-high-risk-surface';

const text = (value) => String(value ?? '').trim();
const finding = (code, summary, path = '') =>
  Object.freeze({ severity: 'P0', code, summary, path });

function gitBlobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function exactEscalationPaths(analysis = {}) {
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  if (findings.length !== WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V2.length) return [];
  const paths = findings.map((item) => text(item?.path));
  if (findings.some((item) =>
    text(item?.severity).toUpperCase() !== 'P0'
    || text(item?.code) !== EXACT_ESCALATION_CODE)
    || new Set(paths).size !== paths.length
    || paths.some((path) => !WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V2.includes(path))) {
    return [];
  }
  return [...paths].sort();
}

function exactV2CandidateIdentity(input = {}) {
  const lineage = input?.lineageEvidence;
  return text(input.repository) === REPOSITORY
    && Number(input.prNumber) === PR_NUMBER
    && text(input.branch) === BRANCH
    && lineage?.schemaVersion === 'stephanos.windows-authority-reconciliation-lineage.v1'
    && Array.isArray(lineage.parents)
    && lineage.parents.length === 2
    && lineage.parents[0] === WINDOWS_AUTHORITY_WORKER_WATCHDOG_REVIEWED_ANCHOR_V2;
}

function exactSource(source, repository, sourceHead, path) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return false;
  const content = typeof source.content === 'string' ? source.content : '';
  const size = Buffer.byteLength(content, 'utf8');
  return source.schemaVersion === SOURCE_SCHEMA
    && source.repository === repository
    && source.path === path
    && source.ref === sourceHead
    && source.exists === true
    && Number.isSafeInteger(source.size)
    && source.size === size
    && size > 0
    && size <= MAX_SOURCE_BYTES
    && SHA.test(text(source.blobSha))
    && source.blobSha === gitBlobSha(content);
}

function exactReviewedSource(source, path) {
  const expected = WINDOWS_AUTHORITY_WORKER_WATCHDOG_REVIEWED_MANIFEST_V2[path];
  return Boolean(expected
    && source.blobSha === expected.blobSha
    && source.size === expected.size);
}

export function validateWorkerWatchdogReconciliationLineageV2({
  repository,
  sourceHead,
  baseSha,
  lineageEvidence,
} = {}) {
  const lineage = lineageEvidence;
  const comparison = lineage?.comparison;
  return repository === REPOSITORY
    && SHA.test(text(sourceHead))
    && SHA.test(text(baseSha))
    && sourceHead !== WINDOWS_AUTHORITY_WORKER_WATCHDOG_REVIEWED_ANCHOR_V2
    && sourceHead !== baseSha
    && lineage?.schemaVersion === 'stephanos.windows-authority-reconciliation-lineage.v1'
    && lineage.repository === REPOSITORY
    && lineage.sourceHead === sourceHead
    && lineage.sourceCommitSha === sourceHead
    && lineage.baseSha === baseSha
    && lineage.liveMainBeforeSha === baseSha
    && lineage.liveMainAfterSha === baseSha
    && Array.isArray(lineage.parents)
    && lineage.parents.length === 2
    && lineage.parents[0] === WINDOWS_AUTHORITY_WORKER_WATCHDOG_REVIEWED_ANCHOR_V2
    && lineage.parents[1] === baseSha
    && comparison?.status === 'ahead'
    && Number.isSafeInteger(comparison?.aheadBy)
    && comparison.aheadBy >= 1
    && comparison.behindBy === 0
    && comparison.baseCommitSha === baseSha
    && comparison.mergeBaseCommitSha === baseSha;
}

function hasAll(source, patterns) {
  return patterns.every((pattern) => pattern.test(source));
}

const PROBE_REQUIRED = Object.freeze([
  /ValidateSet\('Inspect', 'StartApprovedWorkerTask'\)/,
  /\$canonicalGit = 'C:\\Program Files\\Git\\cmd\\git\.exe'/,
  /\$canonicalPowerShell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe'/,
  /function Test-ExactJsonPropertyEstate/,
  /function Get-VerifiedWorkerLaunchIdentity/,
  /mission-orchestrator-worker-launch-identity-\$launchIdentityId\.json/,
  /schemaVersion -ne 'stephanos\.mission-worker-launch-identity\.v1'/,
  /\$heartbeatWorkerStartedAtUtc\.Ticks -ne \$processStartedAtUtc\.Ticks/,
  /\$receiptWorkerStartedAtUtc\.Ticks -ne \$processStartedAtUtc\.Ticks/,
  /launchIdentityId = if \(\$launchIdentity\) \{ \[string\]\$launchIdentity\.LaunchIdentityId \} else \{ '' \}/,
  /launchIdentityVerified = \[bool\]\$launchIdentity/,
  /launchIdentityId = \[string\]\$heartbeat\.launchIdentityId/,
  /workerStartedAtUtc = \[string\]\$heartbeat\.workerStartedAtUtc/,
]);

const RESTART_REQUIRED = Object.freeze([
  /ValidateSet\('backend', 'mission-worker'\)/,
  /\$canonicalGit = 'C:\\Program Files\\Git\\cmd\\git\.exe'/,
  /\$canonicalNode = 'C:\\Program Files\\nodejs\\node\.exe'/,
  /function Read-CanonicalMissionWorkerRestartRequest/,
  /schemaVersion -ne 'stephanos\.mission-worker-restart-request\.v1'/,
  /function Reclaim-ExpiredMissionWorkerRestartRequest/,
  /\$observed\.DeadlineUtc -gt \[datetime\]::UtcNow/,
  /\[string\]\$recheck\.Raw -ne \[string\]\$observed\.Raw/,
  /MISSION_WORKER_RESTART_REQUEST_CHANGED_BEFORE_RECLAIM/,
  /function Remove-ExactOwnedMissionWorkerRestartRequest/,
  /\[string\]\$observed\.Record\.invocationId -ne \$ExpectedInvocationId/,
  /\[string\]\$observed\.Record\.headSha -ne \$ExpectedHead/,
  /\$observed\.DeadlineUtc\.Ticks -ne \$ExpectedDeadlineUtc\.ToUniversalTime\(\)\.Ticks/,
  /MISSION_WORKER_RESTART_REQUEST_CLEANUP_IDENTITY_CHANGED/,
  /Reclaim-ExpiredMissionWorkerRestartRequest[\s\S]*Write-BoundedAtomicJson -Path \$script:restartRequestPath/,
  /\$script:restartRequestWritten = \$true/,
  /if \(\$startupBlocker\)[\s\S]*Remove-ExactOwnedMissionWorkerRestartRequest/,
  /catch \{[\s\S]*\$restartRequestWritten[\s\S]*Remove-ExactOwnedMissionWorkerRestartRequest/,
  /\[System\.Diagnostics\.Process\]::GetProcessById\(\$processId\)[\s\S]*\$reverifiedProcessCapability\.Kill\(\)/,
]);

const LAUNCHER_REQUIRED = Object.freeze([
  /\$canonicalNode = 'C:\\Program Files\\nodejs\\node\.exe'/,
  /\$canonicalGit = 'C:\\Program Files\\Git\\cmd\\git\.exe'/,
  /function Start-ExactWorkerWithLaunchIdentity/,
  /schemaVersion = 'stephanos\.mission-worker-launch-identity\.v1'/,
  /-LaunchKind 'guarded-restart'/,
  /-LaunchKind 'ordinary'/,
  /function Stop-ExactOwnedWorkerProcess/,
]);

const FORBIDDEN_DYNAMIC_AUTHORITY =
  /\b(?:Invoke-Expression|Invoke-Command|Start-Process|Start-Job|Restart-Computer|shutdown\.exe)\b/i;

export function reviewCurrentWorkerWatchdogSourceSemanticsV2(path, source) {
  const findings = [];
  const body = typeof source === 'string' ? source : '';
  let required = [];
  if (path.endsWith('probe-mission-orchestrator-worker-watchdog.ps1')) required = PROBE_REQUIRED;
  else if (path.endsWith('restart-approved-stephanos-runtime.ps1')) required = RESTART_REQUIRED;
  else if (path.endsWith('start-mission-orchestrator-worker.ps1')) required = LAUNCHER_REQUIRED;
  else return Object.freeze([finding('windows-authority-v2-unexpected-path', 'V2 review path is not allowlisted.', path)]);
  if (!hasAll(body, required)) {
    findings.push(finding(
      'windows-authority-v2-required-boundary-missing',
      'The exact reviewed worker/watchdog authority boundary is incomplete.',
      path,
    ));
  }
  if (FORBIDDEN_DYNAMIC_AUTHORITY.test(body)) {
    findings.push(finding(
      'windows-authority-v2-dynamic-authority-forbidden',
      'The reviewed worker/watchdog source must not gain dynamic execution authority.',
      path,
    ));
  }
  return Object.freeze(findings);
}

export function analyzeWindowsAuthorityWorkerWatchdogReviewV2(input = {}) {
  const paths = exactEscalationPaths(input.analysis);
  if (paths.length === 0 || !exactV2CandidateIdentity(input)) {
    return Object.freeze({
      schemaVersion: SCHEMA,
      eligible: false,
      clean: false,
      reviewedPaths: Object.freeze([]),
      findings: Object.freeze([]),
      proofRefs: Object.freeze([]),
      finalVerdict: 'WINDOWS_AUTHORITY_WORKER_WATCHDOG_V2_NOT_APPLICABLE',
    });
  }

  const repository = text(input.repository);
  const sourceHead = text(input.sourceHead).toLowerCase();
  const baseSha = text(input.baseSha).toLowerCase();
  const findings = [];
  const proofRefs = [];

  if (repository !== REPOSITORY
      || Number(input.prNumber) !== PR_NUMBER
      || text(input.branch) !== BRANCH) {
    findings.push(finding(
      'windows-authority-v2-reviewed-identity-mismatch',
      'V2 specialist review requires the exact PR #2045 worker/watchdog identity.',
    ));
  }

  if (!validateWorkerWatchdogReconciliationLineageV2({
    repository,
    sourceHead,
    baseSha,
    lineageEvidence: input.lineageEvidence,
  })) {
    findings.push(finding(
      'windows-authority-v2-reviewed-lineage-mismatch',
      'V2 specialist review requires one exact-current-main two-parent reconciliation from the repaired #2045 anchor.',
    ));
  }

  const sources = Array.isArray(input.sources) ? input.sources : [];
  const sourceEstateExact = sources.length === WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V2.length
    && sources.every((source, index) =>
      source?.path === WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V2[index]);
  if (!sourceEstateExact) {
    findings.push(finding(
      'windows-authority-v2-source-estate-invalid',
      'V2 specialist review requires the exact ordered three-source watchdog estate.',
    ));
  }

  for (const [index, path] of paths.entries()) {
    const source = sourceEstateExact ? sources[index] : null;
    if (!exactSource(source, repository, sourceHead, path)) {
      findings.push(finding(
        'windows-authority-v2-source-evidence-invalid',
        'V2 specialist review requires one exact content-addressed source record.',
        path,
      ));
      continue;
    }
    if (!exactReviewedSource(source, path)) {
      findings.push(finding(
        'windows-authority-v2-source-not-reviewed',
        'V2 specialist review admits only the exact repaired #2045 source manifest.',
        path,
      ));
    }
    findings.push(...reviewCurrentWorkerWatchdogSourceSemanticsV2(path, source.content));
    proofRefs.push(`proofs/windows-authority-specialist-v2/${path}@${sourceHead}#${source.blobSha}:${source.size}`);
  }

  const clean = findings.length === 0;
  return Object.freeze({
    schemaVersion: SCHEMA,
    eligible: true,
    clean,
    reviewedPaths: Object.freeze(paths),
    findings: Object.freeze(findings),
    proofRefs: Object.freeze(proofRefs),
    finalVerdict: clean
      ? 'WINDOWS_AUTHORITY_WORKER_WATCHDOG_V2_CLEAN'
      : 'WINDOWS_AUTHORITY_WORKER_WATCHDOG_V2_FINDINGS',
  });
}
