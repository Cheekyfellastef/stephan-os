import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  analyzeWindowsAuthorityIgnitionConvergenceReview as analyzeProductionReview,
  analyzeWindowsAuthorityIgnitionConvergenceReviewWithFixtureBlobsForTest,
  WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_BLOBS_V1,
  WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1,
} from './windowsAuthorityIgnitionConvergenceReviewV1.mjs';

const repository = 'Cheekyfellastef/stephan-os';
const prNumber = 1919;
const branch = 'fix/ignition-canonical-convergence-gate-v1';
const sourceHead = 'a'.repeat(40);
const previousHead = 'c'.repeat(40);
const baseSha = 'b'.repeat(40);

const probeSource = String.raw`[CmdletBinding()]
param(
  [ValidateSet('Inspect', 'Recover')]
  [string]$Mode = 'Inspect'
)
$ErrorActionPreference = 'Stop'
$wscriptPath = 'C:\Windows\System32\wscript.exe'
$canonicalPowerShell = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
$canonicalNode = 'C:\Program Files\nodejs\node.exe'
$canonicalBootstrapEval = "import('data:text/javascript;base64,'+process.env.STEPHANOS_BACKEND_BOOTSTRAP_BASE64)"
$taskSpecs = @(
  [pscustomobject]@{ Name = 'Stephanos Mission Orchestrator Worker Watchdog' }
  [pscustomobject]@{ Name = 'Stephanos Battle Bridge GitHub Command Mailbox' }
  [pscustomobject]@{ Name = 'Stephanos Battle Bridge Backend' }
  [pscustomobject]@{ Name = 'OpenClaw Gateway' }
)
[string]$Task.Settings.MultipleInstances -eq 'IgnoreNew'
function Test-CanonicalBackendCommandLine {}
[string]::Equals($executable, $canonicalNode)
Test-CanonicalBackendCommandLine
BACKEND_LISTENER_EXECUTABLE_FOREIGN
BACKEND_LISTENER_COMMAND_FOREIGN
$raw = & $canonicalNode $backendFreshnessProbePath --expected-source-head $ExpectedSourceHead
[string]$receipt.schemaVersion -eq 'stephanos.backend-runtime.v1'
([string]$receipt.headSha).ToLowerInvariant() -eq $ExpectedSourceHead
[int]$receipt.pid -eq $listenerAfter.pid
[string]$receipt.processStartTimeUtc -eq $listenerAfter.creationTimeUtc
[string]$proof.finalVerdict -eq 'BACKEND_CURRENT'
$sourceControlExecutable = 'C:\Program Files\Git\cmd\git.exe'
if ($sourceHead -notmatch '^[0-9a-f]{40}$' -or $branch -ne 'main') {}
function Assert-CanonicalTrackedWorktreeClean {}
Assert-CanonicalTrackedWorktreeClean -GitExecutable $sourceControlExecutable -RepositoryRoot $repoRoot
if (-not $observed.authorityCanonical) { continue }
Start-ScheduledTask -TaskName $spec.Name
maximumTaskStarts = 4
arbitraryTaskNameAllowed = $false
arbitraryPowerShellAllowed = $false
sourceMutationAllowed = $false
pcRestartAllowed = $false
`;

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
$canonicalNode = 'C:\Program Files\nodejs\node.exe'
$canonicalBootstrapEval = "import('data:text/javascript;base64,'+process.env.STEPHANOS_BACKEND_BOOTSTRAP_BASE64)"
'Stephanos Battle Bridge Backend'
'Stephanos Mission Orchestrator Worker'
NON_CANONICAL_REPOSITORY_PATH
EXPECTED_HEAD_MISMATCH
$process.ExecutablePath
BACKEND_LISTENER_NOT_CANONICAL_NODE
BACKEND_LISTENER_COMMAND_NOT_ALLOWLISTED
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
$canonicalBootstrapEval = "import('data:text/javascript;base64,'+process.env.STEPHANOS_BACKEND_BOOTSTRAP_BASE64)"
$env:GIT_NO_REPLACE_OBJECTS = '1'
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
function Get-ExactHeadBackendBootstrapBase64 {}
$bootstrapGitPath = 'stephanos-server/backend-bootstrap.mjs'
BACKEND_EXACT_HEAD_BOOTSTRAP_HASH_MISMATCH
function Start-BackendNodeWithMinimalEnvironment {}
$minimalEnvironment['STEPHANOS_BACKEND_SOURCE_HEAD'] = $SourceHead
$minimalEnvironment['STEPHANOS_BACKEND_REPO_ROOT'] = $RepositoryRoot
$minimalEnvironment['STEPHANOS_BACKEND_BOOTSTRAP_BASE64'] = $BootstrapBase64
$arguments = @('--input-type=module', '--eval', $canonicalBootstrapEval)
Assert-ExpectedHeadImmediatelyBeforeMutation -Mutation 'exact-head bootstrap capture'
$bootstrapBase64 = Get-ExactHeadBackendBootstrapBase64 -RepositoryRoot $repoRoot -HeadSha $headSha
Assert-ExpectedHeadImmediatelyBeforeMutation -Mutation 'backend process start'
Start-BackendNodeWithMinimalEnvironment
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
function lineage(overrides = {}) {
  return {
    schemaVersion: 'stephanos.windows-authority-reconciliation-lineage.v1',
    repository,
    sourceHead,
    sourceCommitSha: sourceHead,
    baseSha,
    liveMainBeforeSha: baseSha,
    liveMainAfterSha: baseSha,
    parents: [previousHead, baseSha],
    comparison: {
      status: 'ahead',
      aheadBy: 19,
      behindBy: 0,
      baseCommitSha: baseSha,
      mergeBaseCommitSha: baseSha,
    },
    ...overrides,
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
    lineageEvidence: lineage(),
    analysis: analysis(),
    sources: [
      sourceRecord(WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1[0], probeSource),
      sourceRecord(WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1[1], repairSource),
      sourceRecord(WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1[2], restartSource),
      sourceRecord(WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1[3], backendSource),
    ],
    ...overrides,
  };
}

const baseFixtureBlobs = Object.freeze(Object.fromEntries([
  probeSource, repairSource, restartSource, backendSource,
].map((content, index) => [WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1[index], blobSha(content)])));

function fixtureBlobsFor(value) {
  const sourcesDescriptor = Object.getOwnPropertyDescriptor(value, 'sources');
  const sources = sourcesDescriptor && Object.hasOwn(sourcesDescriptor, 'value') ? sourcesDescriptor.value : null;
  if (!Array.isArray(sources) || sources.length !== WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1.length) return baseFixtureBlobs;
  const records = [];
  for (let index = 0; index < sources.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(sources, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) return baseFixtureBlobs;
    records.push(descriptor.value);
  }
  const entries = [];
  for (const path of WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1) {
    const matches = records.filter((source) => {
      const descriptor = source && typeof source === 'object' && Object.getPrototypeOf(source) === Object.prototype
        ? Object.getOwnPropertyDescriptor(source, 'path')
        : null;
      return descriptor && Object.hasOwn(descriptor, 'value') && descriptor.value === path;
    });
    if (matches.length !== 1) return baseFixtureBlobs;
    const blobDescriptor = Object.getOwnPropertyDescriptor(matches[0], 'blobSha');
    if (!blobDescriptor || !Object.hasOwn(blobDescriptor, 'value') || !/^[a-f0-9]{40}$/.test(blobDescriptor.value)) return baseFixtureBlobs;
    entries.push([path, blobDescriptor.value]);
  }
  return Object.freeze(Object.fromEntries(entries));
}

function analyzeWindowsAuthorityIgnitionConvergenceReview(value) {
  return analyzeWindowsAuthorityIgnitionConvergenceReviewWithFixtureBlobsForTest(value, fixtureBlobsFor(value));
}

test('production reviewer pins the four independently reviewed Git blobs while allowing lineage head and base to move', () => {
  assert.deepEqual(WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_BLOBS_V1, {
    'scripts/windows/probe-battle-bridge-recovery-mesh.ps1': '132460b4e131786a65da03aaaf9215bcff8de1d6',
    'scripts/windows/repair-stephanos-battle-bridge.ps1': 'c53aea4971932f9758992d8ce7cbb75e75ae6c06',
    'scripts/windows/restart-approved-stephanos-runtime.ps1': '04ac9ee1d87d5ace47f4904ad89b167b418edbd3',
    'scripts/windows/start-stephanos-backend.ps1': 'a13ce1f3f5c1b23cfcfc38343698c5e5de42bac1',
  });
  const result = analyzeProductionReview(input());
  assert.equal(result.eligible, true);
  assert.equal(result.clean, false);
  assert.equal(result.findings.length, 4);
  assert.ok(result.findings.every((item) => item.code === 'windows-authority-source-evidence-invalid'));
});

test('appended filesystem authority cannot inherit a clean review through a future reconciliation head', () => {
  const sources = input().sources;
  sources[0] = sourceRecord(WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1[0], `${probeSource}\nRemove-Item -Recurse -Force $callerPath\n`);
  const result = analyzeProductionReview(input({ sources }));
  assert.equal(result.eligible, true);
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'windows-authority-source-evidence-invalid'));
});

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
  assert.equal(result.proofRefs.length, 4);
});

test('specialist is exact PR head/base bound and rejects another identity or finding estate', () => {
  assert.equal(analyzeWindowsAuthorityIgnitionConvergenceReview(input({ repository: 'other/repo' })).eligible, false);
  assert.equal(analyzeWindowsAuthorityIgnitionConvergenceReview(input({ prNumber: 1918 })).eligible, false);
  assert.equal(analyzeWindowsAuthorityIgnitionConvergenceReview(input({ branch: 'other' })).eligible, false);
  assert.equal(analyzeWindowsAuthorityIgnitionConvergenceReview(input({ sourceHead: 'd'.repeat(40) })).eligible, false);
  assert.equal(analyzeWindowsAuthorityIgnitionConvergenceReview(input({ sourceHead: 'b'.repeat(40) })).eligible, false);
  assert.equal(analyzeWindowsAuthorityIgnitionConvergenceReview(input({ baseSha: 'e'.repeat(40) })).eligible, false);
  assert.equal(analyzeWindowsAuthorityIgnitionConvergenceReview(input({ baseSha: 'c'.repeat(40) })).eligible, false);
  assert.equal(analyzeWindowsAuthorityIgnitionConvergenceReview(input({ sourceHead: 'bad' })).eligible, false);
  assert.equal(analyzeWindowsAuthorityIgnitionConvergenceReview(input({ analysis: { findings: [] } })).eligible, false);
});

test('stale, reordered, diverged or accessor-shaped reconciliation evidence fails closed', () => {
  const variants = [
    lineage({ liveMainBeforeSha: 'd'.repeat(40) }),
    lineage({ liveMainAfterSha: 'd'.repeat(40) }),
    lineage({ sourceCommitSha: 'd'.repeat(40) }),
    lineage({ parents: [baseSha, previousHead] }),
    lineage({ parents: [previousHead] }),
    lineage({ comparison: { ...lineage().comparison, status: 'diverged' } }),
    lineage({ comparison: { ...lineage().comparison, behindBy: 1 } }),
    lineage({ comparison: { ...lineage().comparison, baseCommitSha: 'd'.repeat(40) } }),
    lineage({ comparison: { ...lineage().comparison, mergeBaseCommitSha: 'd'.repeat(40) } }),
  ];
  for (const lineageEvidence of variants) {
    assert.equal(analyzeWindowsAuthorityIgnitionConvergenceReview(input({ lineageEvidence })).eligible, false);
  }

  let getterCalled = false;
  const hostile = lineage();
  delete hostile.sourceHead;
  Object.defineProperty(hostile, 'sourceHead', {
    enumerable: true,
    get() { getterCalled = true; return sourceHead; },
  });
  assert.equal(analyzeWindowsAuthorityIgnitionConvergenceReview(input({ lineageEvidence: hostile })).eligible, false);
  assert.equal(getterCalled, false);
});

test('missing, duplicate or wrong source evidence fails closed', () => {
  const missing = analyzeWindowsAuthorityIgnitionConvergenceReview(input({ sources: input().sources.slice(0, 3) }));
  assert.equal(missing.eligible, true);
  assert.equal(missing.clean, false);
  assert.ok(missing.findings.some((item) => item.code === 'windows-authority-source-estate-invalid'));

  const duplicate = input().sources;
  duplicate[3] = duplicate[2];
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

test('accessor-backed finding array entries fail closed without invoking getters', () => {
  let findingGetterCalled = false;
  const hostileAnalysis = analysis();
  const firstFinding = hostileAnalysis.findings[0];
  Object.defineProperty(hostileAnalysis.findings, '0', {
    configurable: true,
    enumerable: true,
    get() { findingGetterCalled = true; return firstFinding; },
  });
  const result = analyzeWindowsAuthorityIgnitionConvergenceReview(input({ analysis: hostileAnalysis }));
  assert.equal(result.eligible, false);
  assert.equal(findingGetterCalled, false);
});

test('accessor-backed source array entries fail closed without invoking getters', () => {
  let sourceGetterCalled = false;
  const hostileSources = input().sources;
  const firstSource = hostileSources[0];
  Object.defineProperty(hostileSources, '0', {
    configurable: true,
    enumerable: true,
    get() { sourceGetterCalled = true; return firstSource; },
  });
  const result = analyzeWindowsAuthorityIgnitionConvergenceReview(input({ sources: hostileSources }));
  assert.equal(result.eligible, true);
  assert.equal(result.clean, false);
  assert.equal(sourceGetterCalled, false);
  assert.ok(result.findings.some((item) => item.code === 'windows-authority-source-estate-invalid'));
});

test('recovery probe must preserve fixed listener, task, source and mutation boundaries', () => {
  const weakened = probeSource
    .replace('BACKEND_LISTENER_COMMAND_FOREIGN', 'REMOVED_COMMAND_GATE')
    .replace('sourceMutationAllowed = $false', 'sourceMutationAllowed = $true');
  const sources = input().sources;
  sources[0] = sourceRecord(WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1[0], weakened);
  const result = analyzeWindowsAuthorityIgnitionConvergenceReview(input({ sources }));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'ignition-probe-backend-command-mismatch-not-blocked'));
  assert.ok(result.findings.some((item) => item.code === 'ignition-probe-source-authority-not-zero'));
});

test('already-healthy backend exact-head identity gates are mandatory', () => {
  const weakened = repairSource.replace('BACKEND_HEALTH_SOURCE_HEAD_MISMATCH', 'REMOVED_HEAD_MISMATCH_GATE');
  const sources = input().sources;
  sources[1] = sourceRecord(WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1[1], weakened);
  const result = analyzeWindowsAuthorityIgnitionConvergenceReview(input({ sources }));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'ignition-repair-backend-head-mismatch-not-blocked'));
});

test('canonical backend schema and runtime identity gates are mandatory', () => {
  const weakened = repairSource
    .replace('BACKEND_HEALTH_SCHEMA_MISSING_OR_MISMATCH', 'REMOVED_SCHEMA_GATE')
    .replace('BACKEND_HEALTH_RUNTIME_ID_MISSING_OR_MISMATCH', 'REMOVED_RUNTIME_GATE');
  const sources = input().sources;
  sources[1] = sourceRecord(WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1[1], weakened);
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
  sources[2] = sourceRecord(WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1[2], weakened);
  const result = analyzeWindowsAuthorityIgnitionConvergenceReview(input({ sources }));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'ignition-restart-pre-start-overlap-proof-missing'));
  assert.ok(result.findings.some((item) => item.code === 'ignition-restart-handoff-expiry-not-bounded'));
});

test('restart listener identity must remain bound to canonical Node and immutable bootstrap command', () => {
  const weakened = restartSource
    .replace('BACKEND_LISTENER_NOT_CANONICAL_NODE', 'REMOVED_CANONICAL_NODE_GATE')
    .replace('BACKEND_LISTENER_COMMAND_NOT_ALLOWLISTED', 'REMOVED_BOOTSTRAP_COMMAND_GATE');
  const sources = input().sources;
  sources[2] = sourceRecord(WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1[2], weakened);
  const result = analyzeWindowsAuthorityIgnitionConvergenceReview(input({ sources }));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'ignition-restart-backend-node-mismatch-not-blocked'));
  assert.ok(result.findings.some((item) => item.code === 'ignition-restart-backend-command-mismatch-not-blocked'));
});

test('backend child must remain canonical, synchronized and expected-head bound', () => {
  const weakened = backendSource
    .replace("if ($upstream -ne 'origin/main') {}", "if ($upstream -ne 'somewhere') {}")
    .replace("$minimalEnvironment['STEPHANOS_BACKEND_SOURCE_HEAD'] = $SourceHead", "$minimalEnvironment['OTHER'] = $SourceHead");
  const sources = input().sources;
  sources[3] = sourceRecord(WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1[3], weakened);
  const result = analyzeWindowsAuthorityIgnitionConvergenceReview(input({ sources }));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'ignition-backend-upstream-gate-missing'));
  assert.ok(result.findings.some((item) => item.code === 'ignition-backend-child-head-binding-missing'));
});

test('immutable exact-head bootstrap materialization is mandatory for backend start', () => {
  const weakened = backendSource
    .replace('BACKEND_EXACT_HEAD_BOOTSTRAP_HASH_MISMATCH', 'REMOVED_BOOTSTRAP_HASH_GATE')
    .replace("Assert-ExpectedHeadImmediatelyBeforeMutation -Mutation 'exact-head bootstrap capture'", 'REMOVED_BOOTSTRAP_CAPTURE_GATE');
  const sources = input().sources;
  sources[3] = sourceRecord(WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1[3], weakened);
  const result = analyzeWindowsAuthorityIgnitionConvergenceReview(input({ sources }));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'ignition-backend-bootstrap-hash-gate-missing'));
  assert.ok(result.findings.some((item) => item.code === 'ignition-backend-bootstrap-capture-gate-missing'));
});

test('dynamic PowerShell and destructive Git remain rejected', () => {
  const poisoned = `${repairSource}\nInvoke-Expression $x\ngit reset --hard HEAD\n`;
  const sources = input().sources;
  sources[1] = sourceRecord(WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1[1], poisoned);
  const result = analyzeWindowsAuthorityIgnitionConvergenceReview(input({ sources }));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'ignition-repair-dynamic-execution-forbidden'));
  assert.ok(result.findings.some((item) => item.code === 'ignition-repair-destructive-git-forbidden'));
});
