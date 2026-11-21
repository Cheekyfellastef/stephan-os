import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  WINDOWS_AUTHORITY_LEGACY_BACKEND_MIGRATION_PATHS_V1,
  analyzeWindowsAuthorityLegacyBackendMigrationReviewV1,
} from './windowsAuthorityLegacyBackendMigrationReviewV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const HEAD = 'a'.repeat(40);
const PATH = WINDOWS_AUTHORITY_LEGACY_BACKEND_MIGRATION_PATHS_V1[0];

// Reviewer-bootstrap fixture only. The high-risk implementation remains solely in #1895.
// This fixture is intentionally closed-world and contains every exact invariant the child
// specialist is required to prove without importing the implementation under review.
const SOURCE = String.raw`[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-fA-F]{40}$')]
  [string]$ExpectedHead
)
$ErrorActionPreference = 'Stop'
$canonicalNode = 'C:\Program Files\nodejs\node.exe'
$canonicalGit = 'C:\Program Files\Git\cmd\git.exe'
$healthUrl = 'http://127.0.0.1:8787/api/health'
$repoRoot = Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'
$connections = @(Get-NetTCPConnection -LocalPort 8787 -State Listen)
$processIds = @($connections | Select-Object -ExpandProperty OwningProcess -Unique)
if ($processIds.Count -ne 1) { throw 'LEGACY_BACKEND_LISTENER_COUNT_INVALID' }
$processId = [int]$processIds[0]
$process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId"
$executable = [string]$process.ExecutablePath
if (-not [string]::Equals($executable, $canonicalNode, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'LEGACY_BACKEND_EXECUTABLE_NOT_CANONICAL' }
$allowedCommands = @(
  'node stephanos-server/server.js',
  'node.exe stephanos-server/server.js'
)
$health = [pscustomobject]@{
  SchemaVersion = 'stephanos.backend-health.v1'
  RuntimeId = 'stephanos-battle-bridge-backend'
  SourceHead = 'b' * 40
}
if ($health.SourceHead -eq $ExpectedHead) { Stop-WithBlocker 'LEGACY_BACKEND_LISTENER_ALREADY_CURRENT' }
$branch = & $canonicalGit branch --show-current
$head = & $canonicalGit rev-parse HEAD
$originHead = & $canonicalGit rev-parse origin/main
if ($LASTEXITCODE -ne 0 -or $branch -ne 'main' -or $head -ne $ExpectedHead -or $originHead -ne $ExpectedHead) { throw 'LEGACY_BACKEND_REPOSITORY_IDENTITY_INVALID' }
& $canonicalGit cat-file -e "$($health.SourceHead)^{commit}"
& $canonicalGit merge-base --is-ancestor $health.SourceHead $ExpectedHead
$listenerBefore = [pscustomobject]@{ ProcessId = $processId; CreationTimeUtc = '2026-01-01T00:00:00Z'; CommandLine = $process.CommandLine }
$listenerAfter = [pscustomobject]@{ ProcessId = $processId; CreationTimeUtc = '2026-01-01T00:00:00Z'; CommandLine = $process.CommandLine }
if ($listenerAfter.ProcessId -ne $listenerBefore.ProcessId) { throw 'PROCESS_IDENTITY_CHANGED' }
if ($listenerAfter.CreationTimeUtc -ne $listenerBefore.CreationTimeUtc) { throw 'PROCESS_START_TIME_CHANGED' }
if (-not [string]::Equals($listenerAfter.CommandLine, $listenerBefore.CommandLine, [System.StringComparison]::Ordinal)) { throw 'PROCESS_COMMAND_CHANGED' }
$headImmediatelyBeforeMutation = & $canonicalGit rev-parse HEAD
Stop-Process -Id $listenerAfter.ProcessId -Force -ErrorAction Stop
$record = [ordered]@{
  terminatedVerifiedOwnedProcess = $true
  arbitraryPidAllowed = $false
  arbitraryExecutableAllowed = $false
  arbitraryCommandAllowed = $false
  arbitraryTaskAllowed = $false
  arbitraryShellAllowed = $false
  sourceMutationAllowed = $false
  pcRestartAllowed = $false
  liveOpenClawUpdatePerformed = $false
}
`;

function blobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`, 'utf8').update(bytes).digest('hex');
}

function sourceRecord(content = SOURCE) {
  return {
    schemaVersion: 'stephanos.windows-authority-source.v1',
    repository: REPOSITORY,
    path: PATH,
    ref: HEAD,
    exists: true,
    size: Buffer.byteLength(content, 'utf8'),
    blobSha: blobSha(content),
    content,
  };
}

function review(content = SOURCE, overrides = {}) {
  return analyzeWindowsAuthorityLegacyBackendMigrationReviewV1({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: {
      findings: [{ severity: 'P0', code: 'unsupported-high-risk-surface', path: PATH }],
    },
    sources: [sourceRecord(content)],
    ...overrides,
  });
}

test('accepts only the fixed exact-owned legacy backend migration contract', () => {
  const result = review();
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.reviewedPaths, [PATH]);
  assert.match(result.proofRefs[0], /windows-authority-legacy-backend-migration/);
});

test('rejects widened process termination or removal of stable identity gates', () => {
  const arbitraryPid = SOURCE.replace(
    'Stop-Process -Id $listenerAfter.ProcessId -Force -ErrorAction Stop',
    'Stop-Process -Id 1234 -Force -ErrorAction Stop',
  );
  assert.ok(review(arbitraryPid).findings.some((item) => item.code === 'legacy-backend-verified-stop-not-exact'));

  const noStablePid = SOURCE.replace(
    '$listenerAfter.ProcessId -ne $listenerBefore.ProcessId',
    '$false',
  );
  assert.ok(review(noStablePid).findings.some((item) => item.code === 'legacy-backend-stable-pid-gate-missing'));

  const noAncestor = SOURCE.replace(
    'merge-base --is-ancestor $health.SourceHead $ExpectedHead',
    'rev-parse $ExpectedHead',
  );
  assert.ok(review(noAncestor).findings.some((item) => item.code === 'legacy-backend-ancestry-gate-missing'));
});

test('rejects dynamic execution, task mutation and additional process termination', () => {
  for (const [suffix, code] of [
    ['\nStart-Process calc.exe\n', 'legacy-backend-dynamic-execution-forbidden'],
    ["\nStart-ScheduledTask -TaskName 'Anything'\n", 'legacy-backend-task-mutation-forbidden'],
    ['\nStop-Process -Id 7 -Force\n', 'legacy-backend-stop-process-count-invalid'],
  ]) {
    assert.ok(review(`${SOURCE}${suffix}`).findings.some((item) => item.code === code), code);
  }
});

test('fails closed on widened source evidence or a different high-risk path', () => {
  const widened = review(SOURCE, { sources: [sourceRecord(), { ...sourceRecord(), path: 'scripts/windows/other.ps1' }] });
  assert.equal(widened.clean, false);
  assert.ok(widened.findings.some((item) => item.code === 'windows-authority-source-evidence-invalid'));

  const wrongPath = analyzeWindowsAuthorityLegacyBackendMigrationReviewV1({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: { findings: [{ severity: 'P0', code: 'unsupported-high-risk-surface', path: 'scripts/windows/other.ps1' }] },
    sources: [sourceRecord()],
  });
  assert.equal(wrongPath.eligible, false);
});
