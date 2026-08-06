import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  WINDOWS_AUTHORITY_SOURCE_SCHEMA_VERSION,
  analyzeWindowsAuthoritySpecialistReview,
} from './windowsAuthoritySpecialistReviewV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const HEAD = 'a'.repeat(40);
const paths = [
  'scripts/windows/install-stephanos-backend-autostart.ps1',
  'scripts/windows/probe-battle-bridge-recovery-mesh.ps1',
  'scripts/windows/start-stephanos-backend.ps1',
];

function blobSha(content) {
  const bytes = Buffer.from(content);
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function record(path, content) {
  return {
    schemaVersion: WINDOWS_AUTHORITY_SOURCE_SCHEMA_VERSION,
    repository: REPOSITORY,
    path,
    ref: HEAD,
    exists: true,
    size: Buffer.byteLength(content),
    blobSha: blobSha(content),
    content,
  };
}

const installer = `
$taskName = 'Stephanos Battle Bridge Backend'
$action = New-ScheduledTaskAction -Execute $wscriptExe -Argument $taskArgs
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -MultipleInstances IgnoreNew
if ($PSCmdlet.ShouldProcess($taskName, 'Register/Update scheduled task')) { Register-ScheduledTask }
`;

const probe = `
$canonicalPowerShell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
$canonicalNode = 'C:\\Program Files\\nodejs\\node.exe'
$sourceControlExecutable = 'C:\\Program Files\\Git\\cmd\\git.exe'
function Test-TaskAuthority { $Task.Principal.LogonType -eq 'Interactive'; $Task.Principal.RunLevel -eq 'Limited'; $Task.Settings.MultipleInstances -eq 'IgnoreNew' }
Assert-CanonicalTrackedWorktreeClean
$branchRaw = git branch --show-current
if ($branch -ne 'main') { throw 'bad' }
if (-not $observed.authorityCanonical) { continue }
Start-ScheduledTask -TaskName $spec.Name
$executable = $process.ExecutablePath
[string]::Equals($executable, $canonicalNode, [System.StringComparison]::OrdinalIgnoreCase)
[string]::Equals($commandLine, $expectedQuotedCommand, [System.StringComparison]::OrdinalIgnoreCase)
[string]::Equals($commandLine, $expectedUnquotedCommand, [System.StringComparison]::OrdinalIgnoreCase)
schemaVersion -eq 'stephanos.backend-runtime.v1'; headSha; ExpectedSourceHead; pid; $listenerAfter.pid; processStartTimeUtc
backendRestartSkippedAsCurrent
Assert-CanonicalTrackedWorktreeClean
`;

const starter = `
$canonicalGit = 'C:\\Program Files\\Git\\cmd\\git.exe'
$canonicalNpm = 'C:\\Program Files\\nodejs\\npm.cmd'
$canonicalNode = 'C:\\Program Files\\nodejs\\node.exe'
[string]::Equals($executable, $canonicalNode, [System.StringComparison]::OrdinalIgnoreCase)
[string]::Equals($commandLine, $expectedQuotedCommand, [System.StringComparison]::OrdinalIgnoreCase)
[string]::Equals($commandLine, $expectedUnquotedCommand, [System.StringComparison]::OrdinalIgnoreCase)
schemaVersion -eq 'stephanos.backend-health.v1'; runtimeId -eq 'stephanos-battle-bridge-backend'; sourceHead
& $canonicalGit status '--porcelain=v1' '--untracked-files=no'
$env:STEPHANOS_BACKEND_SOURCE_HEAD = $headSha
Start-Process -FilePath $canonicalNpm -ArgumentList $arguments
Write-BackendRuntimeReceipt -ProcessStartTimeUtc $processStartTimeUtc
`;

function escalation() {
  return {
    findings: paths.map((path) => ({ severity: 'P0', code: 'unsupported-high-risk-surface', summary: 'specialist', path })),
  };
}

test('exact allowlisted Windows authority sources pass specialist review', () => {
  const result = analyzeWindowsAuthoritySpecialistReview({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: escalation(),
    sources: [record(paths[0], installer), record(paths[1], probe), record(paths[2], starter)],
  });
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true);
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_SPECIALIST_CLEAN');
  assert.equal(result.proofRefs.length, 3);
});

test('PATH-resolved tools and substring listener proof are concrete P0 findings', () => {
  const insecure = starter
    .replace("$canonicalGit = 'C:\\Program Files\\Git\\cmd\\git.exe'", '$git = Get-Command git')
    .replace("$canonicalNpm = 'C:\\Program Files\\nodejs\\npm.cmd'", '$npm = Get-Command npm')
    .replace('[string]::Equals($commandLine, $expectedQuotedCommand, [System.StringComparison]::OrdinalIgnoreCase)', "$commandLine.Contains('stephanos-server/server.js')");
  const result = analyzeWindowsAuthoritySpecialistReview({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: escalation(),
    sources: [record(paths[0], installer), record(paths[1], probe), record(paths[2], insecure)],
  });
  assert.equal(result.clean, false);
  const codes = result.findings.map((item) => item.code);
  assert.ok(codes.includes('windows-backend-starter-git-unpinned'));
  assert.ok(codes.includes('windows-backend-starter-npm-unpinned'));
  assert.ok(codes.includes('windows-backend-starter-substring-listener-proof'));
});

test('unknown Windows paths remain escalated to an external specialist', () => {
  const result = analyzeWindowsAuthoritySpecialistReview({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: { findings: [{ severity: 'P0', code: 'unsupported-high-risk-surface', path: 'scripts/windows/unknown.ps1' }] },
    sources: [],
  });
  assert.equal(result.eligible, false);
});

test('tampered source identity fails closed', () => {
  const bad = record(paths[0], installer);
  bad.blobSha = 'b'.repeat(40);
  const result = analyzeWindowsAuthoritySpecialistReview({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: escalation(),
    sources: [bad, record(paths[1], probe), record(paths[2], starter)],
  });
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'windows-authority-source-evidence-invalid'));
});

test('wrapper and workflow preserve trusted-base and no-mutation boundaries', async () => {
  const wrapper = await readFile(new URL('../../scripts/independent-merge-security-review-with-windows-specialist-v1.mjs', import.meta.url), 'utf8');
  const workflow = await readFile(new URL('../../.github/workflows/independent-merge-security-review.yml', import.meta.url), 'utf8');
  assert.match(wrapper, /spawnSync\(process\.execPath/);
  assert.match(wrapper, /independent-merge-security-review-v2\.mjs/);
  assert.match(wrapper, /buildIndependentReviewArtifact/);
  assert.doesNotMatch(wrapper, /git\s+(?:push|reset|clean|rebase)|gh\s+pr\s+(?:merge|ready)|Stop-Process|Restart-Computer/i);
  assert.match(workflow, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /windowsAuthoritySpecialistReviewV1\.test\.mjs/);
  assert.match(workflow, /independent-merge-security-review-with-windows-specialist-v1\.mjs/);
});
