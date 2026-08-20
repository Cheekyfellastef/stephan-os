import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  analyzeWindowsAuthorityIgnitionConvergenceReview,
  WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1,
} from './windowsAuthorityIgnitionConvergenceReviewV1.mjs';

const repository = 'Cheekyfellastef/stephan-os';
const prNumber = 1919;
const branch = 'fix/ignition-canonical-convergence-gate-v1';
const sourceHead = '0cbd8318f5da7d815e3f4e30d8ef9a5d1c9feb77';
const priorSourceHead = '9941da6e500a7d95d11e8a3654630462cce71a91';
const baseSha = '3dc12a7c84c54f406b10dee1293789e2338f7824';
const priorBaseSha = '13f13144730b2a6d94754914dbdf2c254c39567d';

const repairSource = String.raw`[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{40}$')][string]$ExpectedHead
)
$ErrorActionPreference = 'Stop'
$canonicalGit = 'C:\Program Files\Git\cmd\git.exe'
function Assert-ExpectedHeadImmediatelyBeforeMutation {}
function Test-BackendExactHeadHealth {}
$payload.schemaVersion
'stephanos.backend-health.v1'
$payload.backendIdentity.runtimeId
'stephanos-battle-bridge-backend'
BACKEND_HEALTH_SCHEMA_MISSING_OR_MISMATCH
BACKEND_HEALTH_RUNTIME_ID_MISSING_OR_MISMATCH
$payload.backendIdentity.sourceHead
BACKEND_HEALTH_SOURCE_HEAD_MISSING_OR_INVALID
BACKEND_HEALTH_SOURCE_HEAD_MISMATCH
Test-BackendExactHeadHealth -Url $localHealthUrl -ExpectedSourceHead $ExpectedHead
Test-BackendExactHeadHealth -Url $hostedHealthUrl -ExpectedSourceHead $ExpectedHead
Assert-ExpectedHeadImmediatelyBeforeMutation -Mutation 'backend starter child'
Assert-ExpectedHeadImmediatelyBeforeMutation -Mutation 'Tailscale Serve repair'
Assert-ExpectedHeadImmediatelyBeforeMutation -Mutation 'OpenClaw readonly adapter ensure'
npm run --silent openclaw:stub:ensure
`;

const restartSource = String.raw`[CmdletBinding()]
param(
  [ValidateSet('backend', 'mission-worker')][string]$Target,
  [ValidatePattern('^[0-9a-fA-F]{40}$')][string]$ExpectedHead,
  [int]$TimeoutSeconds = 90
)
$ErrorActionPreference = 'Stop'
'Stephanos Battle Bridge Backend'
'Stephanos Mission Orchestrator Worker'
NON_CANONICAL_REPOSITORY_PATH
EXPECTED_HEAD_MISMATCH
if ($Target -eq 'backend' -and [string]$task.Settings.MultipleInstances -ne 'IgnoreNew') {}
function Publish-BackendExpectedHeadHandoff {}
schemaVersion = 'stephanos.backend-expected-head-handoff.v1'
expiresAtUtc = $issuedAtUtc.AddMinutes(2).ToString('o')
Disable-ScheduledTask -TaskName $plan.TaskName
BACKEND_TASK_NOT_QUIESCENT_BEFORE_HANDOFF
BACKEND_TASK_MULTIPLE_INSTANCES_MISMATCH_BEFORE_HANDOFF
BACKEND_TASK_MULTIPLE_INSTANCES_MISMATCH_BEFORE_START
function Read-FreshBackendReceipt {}
function Read-FreshWorkerHeartbeat {}
Stop-Process -Id $listener.ProcessId -Force
Stop-Process -Id $oldWorker.ProcessId -Force
arbitraryTaskTargetAllowed = $false
arbitraryProcessKillAllowed = $false
verifiedOwnedProcessTerminationOnly = $true
liveOpenClawUpdatePerformed = $false
`;

const backendSource = String.raw`[CmdletBinding(SupportsShouldProcess = $true)]
param([string]$ExpectedHead = '')
$ErrorActionPreference = 'Stop'
$canonicalGit = 'C:\Program Files\Git\cmd\git.exe'
$canonicalNpm = 'C:\Program Files\nodejs\npm.cmd'
$canonicalNode = 'C:\Program Files\nodejs\node.exe'
function Assert-ExpectedHeadImmediatelyBeforeMutation {}
function Read-BackendExpectedHeadHandoff {}
if ([string]$handoff.schemaVersion -ne 'stephanos.backend-expected-head-handoff.v1') {}
BACKEND_EXPECTED_HEAD_HANDOFF_EXPIRED
BACKEND_EXPECTED_HEAD_HANDOFF_TIME_INVALID
if ($branch -ne 'main') {}
if ($upstream -ne 'origin/main') {}
if ($originHead -ne $headSha) {}
if ($headSha -ne $boundExpectedHead) {}
Get-TrackedWorktreeAssessment -StatusLines $trackedStatus
if ($trackedAssessment.SourceDirt.Count -ne 0) {}
Test-BackendHealth -Url $healthUrl -ExpectedSourceHead $headSha
Assert-ExpectedHeadImmediatelyBeforeMutation -Mutation 'OpenClaw readonly adapter ensure'
$env:STEPHANOS_BACKEND_SOURCE_HEAD = $headSha
$arguments = @('run', 'stephanos:backend')
Assert-ExpectedHeadImmediatelyBeforeMutation -Mutation 'backend process start'
Start-Process -FilePath $canonicalNpm
Publish-VerifiedBackendRuntimeReceipt
arbitraryShellAllowed = $false
sourceMutationAllowed = $false
`;

function blobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`, 'utf8').update(bytes).digest('hex');
}
function sourceRecord(path, content) {
  return {
    schemaVersion: 'stephanos.windows-authority-source.v1',
    repository,
    path,
    ref: sourceHead,
    exists: true,
    size: Buffer.byteLength(content, 'utf8'),
    blobSha: blobSha(content),
    content,
  };
}
function analysis() {
  return {
    schemaVersion: 'stephanos.independent-security-analysis.v1',
    findings: WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1.map((path) => ({
      severity: 'P0',
      code: 'unsupported-high-risk-surface',
      path,
    })),
  };
}
function input(overrides = {}) {
  return {
    repository,
    prNumber,
    branch,
    sourceHead,
    baseSha,
    analysis: analysis(),
    sources: [
      sourceRecord(WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1[0], repairSource),
      sourceRecord(WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1[1], restartSource),
      sourceRecord(WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1[2], backendSource),
    ],
    ...overrides,
  };
}

test('exact ignition convergence escalation with closed-world source proof is clean and grants no authority', () => {
  const result = analyzeWindowsAuthorityIgnitionConvergenceReview(input());
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true);
  assert.equal(result.reviewedSourceHead, sourceHead);
  assert.equal(result.reviewedBaseSha, baseSha);
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_SPECIALIST_CLEAN');
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.runtimeAuthority, false);
  assert.equal(result.providerQualificationAuthority, false);
  assert.deepEqual(result.reviewedPaths, WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1);
  assert.equal(result.proofRefs.length, 3);
});

test('specialist is exact PR head/base bound and rejects another identity or finding estate', () => {
  assert.equal(analyzeWindowsAuthorityIgnitionConvergenceReview(input({ repository: 'other/repo' })).eligible, false);
  assert.equal(analyzeWindowsAuthorityIgnitionConvergenceReview(input({ prNumber: 1918 })).eligible, false);
  assert.equal(analyzeWindowsAuthorityIgnitionConvergenceReview(input({ branch: 'other' })).eligible, false);
  assert.equal(analyzeWindowsAuthorityIgnitionConvergenceReview(input({ sourceHead: priorSourceHead })).eligible, false);
  assert.equal(analyzeWindowsAuthorityIgnitionConvergenceReview(input({ sourceHead: 'b'.repeat(40) })).eligible, false);
  assert.equal(analyzeWindowsAuthorityIgnitionConvergenceReview(input({ baseSha: priorBaseSha })).eligible, false);
  assert.equal(analyzeWindowsAuthorityIgnitionConvergenceReview(input({ baseSha: 'c'.repeat(40) })).eligible, false);
  assert.equal(analyzeWindowsAuthorityIgnitionConvergenceReview(input({ sourceHead: 'bad' })).eligible, false);
  assert.equal(analyzeWindowsAuthorityIgnitionConvergenceReview(input({ analysis: { findings: [] } })).eligible, false);
});

test('missing, duplicate or wrong source evidence fails closed', () => {
  const missing = analyzeWindowsAuthorityIgnitionConvergenceReview(input({ sources: input().sources.slice(0, 2) }));
  assert.equal(missing.eligible, true);
  assert.equal(missing.clean, false);
  assert.ok(missing.findings.some((item) => item.code === 'windows-authority-source-estate-invalid'));

  const duplicate = input().sources;
  duplicate[2] = duplicate[1];
  const dupResult = analyzeWindowsAuthorityIgnitionConvergenceReview(input({ sources: duplicate }));
  assert.equal(dupResult.clean, false);
  assert.ok(dupResult.findings.some((item) => item.code === 'windows-authority-source-evidence-invalid'));
});

test('accessor-shaped source evidence cannot smuggle trusted content', () => {
  const sources = input().sources;
  let getterCalled = false;
  const hostile = { ...sources[0] };
  Object.defineProperty(hostile, 'content', { enumerable: true, get() { getterCalled = true; return repairSource; } });
  sources[0] = hostile;
  const result = analyzeWindowsAuthorityIgnitionConvergenceReview(input({ sources }));
  assert.equal(result.clean, false);
  assert.equal(getterCalled, false);
  assert.ok(result.findings.some((item) => item.code === 'windows-authority-source-evidence-invalid'));
});

test('accessor-shaped top-level and analysis fields fail closed without invoking getters', () => {
  let headGetterCalled = false;
  const hostileInput = input();
  delete hostileInput.sourceHead;
  Object.defineProperty(hostileInput, 'sourceHead', { enumerable: true, get() { headGetterCalled = true; return sourceHead; } });
  const topResult = analyzeWindowsAuthorityIgnitionConvergenceReview(hostileInput);
  assert.equal(topResult.eligible, false);
  assert.equal(headGetterCalled, false);

  let findingsGetterCalled = false;
  const hostileAnalysis = { schemaVersion: 'stephanos.independent-security-analysis.v1' };
  Object.defineProperty(hostileAnalysis, 'findings', { enumerable: true, get() { findingsGetterCalled = true; return analysis().findings; } });
  const analysisResult = analyzeWindowsAuthorityIgnitionConvergenceReview(input({ analysis: hostileAnalysis }));
  assert.equal(analysisResult.eligible, false);
  assert.equal(findingsGetterCalled, false);
});

test('accessor-shaped finding fields fail closed without invoking getters', () => {
  let pathGetterCalled = false;
  const hostileFinding = {
    severity: 'P0',
    code: 'unsupported-high-risk-surface',
  };
  Object.defineProperty(hostileFinding, 'path', { enumerable: true, get() { pathGetterCalled = true; return WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1[0]; } });
  const hostileAnalysis = analysis();
  hostileAnalysis.findings[0] = hostileFinding;
  const result = analyzeWindowsAuthorityIgnitionConvergenceReview(input({ analysis: hostileAnalysis }));
  assert.equal(result.eligible, false);
  assert.equal(pathGetterCalled, false);
});

test('already-healthy backend exact-head identity gates are mandatory', () => {
  const weakened = repairSource.replace('BACKEND_HEALTH_SOURCE_HEAD_MISMATCH', 'REMOVED_HEAD_MISMATCH_GATE');
  const sources = input().sources;
  sources[0] = sourceRecord(WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1[0], weakened);
  const result = analyzeWindowsAuthorityIgnitionConvergenceReview(input({ sources }));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'ignition-repair-backend-head-mismatch-not-blocked'));
});

test('canonical backend schema and runtime identity gates are mandatory', () => {
  const weakened = repairSource
    .replace('BACKEND_HEALTH_SCHEMA_MISSING_OR_MISMATCH', 'REMOVED_SCHEMA_GATE')
    .replace('BACKEND_HEALTH_RUNTIME_ID_MISSING_OR_MISMATCH', 'REMOVED_RUNTIME_GATE');
  const sources = input().sources;
  sources[0] = sourceRecord(WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1[0], weakened);
  const result = analyzeWindowsAuthorityIgnitionConvergenceReview(input({ sources }));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'ignition-repair-backend-schema-mismatch-not-blocked'));
  assert.ok(result.findings.some((item) => item.code === 'ignition-repair-backend-runtime-mismatch-not-blocked'));
});

test('scheduled backend restart must preserve bounded handoff and IgnoreNew gates', () => {
  const weakened = restartSource
    .replace('BACKEND_TASK_MULTIPLE_INSTANCES_MISMATCH_BEFORE_START', 'REMOVED_PRE_START_GATE')
    .replace("expiresAtUtc = $issuedAtUtc.AddMinutes(2).ToString('o')", "expiresAtUtc = $issuedAtUtc.AddHours(2).ToString('o')");
  const sources = input().sources;
  sources[1] = sourceRecord(WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1[1], weakened);
  const result = analyzeWindowsAuthorityIgnitionConvergenceReview(input({ sources }));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'ignition-restart-pre-start-overlap-proof-missing'));
  assert.ok(result.findings.some((item) => item.code === 'ignition-restart-handoff-expiry-not-bounded'));
});

test('backend child must remain canonical, synchronized and expected-head bound', () => {
  const weakened = backendSource
    .replace("if ($upstream -ne 'origin/main') {}", "if ($upstream -ne 'somewhere') {}")
    .replace('$env:STEPHANOS_BACKEND_SOURCE_HEAD = $headSha', '$env:OTHER = $headSha');
  const sources = input().sources;
  sources[2] = sourceRecord(WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1[2], weakened);
  const result = analyzeWindowsAuthorityIgnitionConvergenceReview(input({ sources }));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'ignition-backend-upstream-gate-missing'));
  assert.ok(result.findings.some((item) => item.code === 'ignition-backend-child-head-binding-missing'));
});

test('dynamic PowerShell and destructive Git remain rejected', () => {
  const poisoned = `${repairSource}\nInvoke-Expression $x\ngit reset --hard HEAD\n`;
  const sources = input().sources;
  sources[0] = sourceRecord(WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1[0], poisoned);
  const result = analyzeWindowsAuthorityIgnitionConvergenceReview(input({ sources }));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'ignition-repair-dynamic-execution-forbidden'));
  assert.ok(result.findings.some((item) => item.code === 'ignition-repair-destructive-git-forbidden'));
});
