import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { WINDOWS_AUTHORITY_SOURCE_SCHEMA_VERSION, analyzeWindowsAuthoritySpecialistReview } from './windowsAuthoritySpecialistReviewV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const HEAD = 'a'.repeat(40);
const paths = [
  'scripts/windows/repair-batte-bridge-control-plane-now.ps1',
  'scripts/windows/Repair-Batte-Bridge-Control-Plane-Now.cmd',
  'scripts/windows/repair-batte-bridge-control-plane-now.test.mjs',
];
const hash = (content) => {
  const bytes = Buffer.from(content);
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
};
const record = (path, content) => ({ schemaVersion: WINDOWS_AUTHORITY_SOURCE_SCHEMA_VERSION, repository: REPOSITORY, path, ref: HEAD, exists: true, size: Buffer.byteLength(content), blobSha: hash(content), content });
const analysis = () => ({ findings: paths.map((path) => ({ severity: 'P0', code: 'unsupported-high-risk-surface', path })) });
const review = (sources) => analyzeWindowsAuthoritySpecialistReview({ repository: REPOSITORY, sourceHead: HEAD, analysis: analysis(), sources });

const rescue = String.raw`[CmdletBinding(SupportsShouldProcess = $true)]
param([ValidateRange(60, 900)][int]$ConvergenceTimeoutSeconds = 480,[ValidateRange(1, 15)][int]$PollIntervalSeconds = 3)
$repository = 'Cheekyfellastef/stephan-os'
$publicRemote = 'https://github.com/Cheekyfellastef/stephan-os.git'
$gitExe = 'C:\Program Files\Git\cmd\git.exe'
$syncTaskName = 'Stephanos Battle Bridge GitHub Sync'
$recoveryTaskName = 'Stephanos Battle Bridge Recovery Mesh'
$mailboxTaskName = 'Stephanos Battle Bridge GitHub Command Mailbox'
$syncInstaller = Join-Path $repoRoot 'scripts\windows\install-battle-bridge-github-sync.ps1'
$recoveryInstaller = Join-Path $repoRoot 'scripts\windows\install-battle-bridge-recovery-mesh.ps1'
$mailboxInstaller = Join-Path $repoRoot 'scripts\windows\install-battle-bridge-github-command-mailbox.ps1'
function Read-PublicMainHead { Read-FixedGitText -Arguments @('ls-remote', $publicRemote, 'refs/heads/main') }
function Invoke-FixedInstaller { if ([string]$receipt.taskName -ne $ExpectedTaskName) { throw 'wrong' }; if ($receipt.installed -ne $true -or $receipt.startedNow -ne $true) { throw 'bad' } }
$origin = Read-FixedGitText -Arguments @('-C', $repoRoot, 'remote', 'get-url', 'origin')
if ($origin -notmatch '^(https:\/\/github\.com\/Cheekyfellastef\/stephan-os(?:\.git)?\/?|git@github\.com:Cheekyfellastef\/stephan-os(?:\.git)?|ssh:\/\/git@github\.com\/Cheekyfellastef\/stephan-os(?:\.git)?\/?)$') { throw 'bad' }
if (-not $PSCmdlet.ShouldProcess($repoRoot, 'Start the three existing reviewed Battle Bridge control-plane tasks and converge to public main')) { return }
for ($round = 1; $round -le 3; $round += 1) { Invoke-FixedInstaller -Path $syncInstaller -ExpectedTaskName $syncTaskName }
Stop-BoundedRescue -Blocker 'EXACT_MAIN_CONVERGENCE_TIMEOUT'
Stop-BoundedRescue -Blocker 'PUBLIC_MAIN_MOVED_DURING_RESCUE'
$observedTree = Read-FixedGitText -Arguments @('-C', $repoRoot, 'rev-parse', "$observedHead__TREE__")
Stop-BoundedRescue -Blocker 'EXACT_TREE_PROOF_FAILED'
Invoke-FixedInstaller -Path $recoveryInstaller -ExpectedTaskName $recoveryTaskName
Invoke-FixedInstaller -Path $mailboxInstaller -ExpectedTaskName $mailboxTaskName
$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if (($taskProof | Where-Object { $_.present -ne $true }).Count -gt 0) { throw 'missing' }
sourceMutationPerformedByRescue = $false
sourceConvergencePerformedByExistingReviewedSync = $true
destructiveGitAllowed = $false
arbitraryShellAllowed = $false
tailscaleCredentialRequired = $false
forgeMutationPerformed = $false
finalVerdict = 'BATTLE_BRIDGE_NO_FAFF_RESCUE_READY'`.replace('__TREE__', '`${tree}');

const launcher = String.raw`@echo off
setlocal
set "SCRIPT=%USERPROFILE%\Documents\GitHub\stephan-os\scripts\windows\repair-batte-bridge-control-plane-now.ps1"
set "POWERSHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%POWERSHELL%" exit /b 1
if not exist "%SCRIPT%" exit /b 1
"%POWERSHELL%" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%SCRIPT%"
set "EXITCODE=%ERRORLEVEL%"
if not "%EXITCODE%"=="0" exit /b %EXITCODE%
exit /b 0`;

const staticTest = String.raw`import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const ps1Url = new URL('./repair-batte-bridge-control-plane-now.ps1', import.meta.url);
const cmdUrl = new URL('./Repair-Battle-Bridge-Control-Plane-Now.cmd', import.meta.url);
test('rescue is fixed to the canonical repository and three existing task installers', () => {});
test('rescue reads Git identity but delegates all source convergence to the reviewed sync task', () => {});
test('rescue does not require or expose Tailscale and Forge credentials or mutate Forge', () => {});
test('one-click launcher invokes only the fixed source-controlled rescue script', () => {});
assert.match(ps1, /BATTLE_BRIDGE_NO_FAFF_RESCUE_READY/);
assert.match(ps1, /sourceMutationPerformedByRescue = \$false/);
assert.doesNotMatch(ps1, /['"](?:fetch|merge)['"]/i);`;
const sources = (ps1 = rescue, cmd = launcher, check = staticTest) => [record(paths[0], ps1), record(paths[1], cmd), record(paths[2], check)];

test('qualifies exact no-faff rescue surfaces', () => {
  const result = review(sources());
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true);
  assert.deepEqual(result.reviewedPaths, paths);
});

test('rejects direct task/source/credential/Forge authority', () => {
  const result = review(sources(`${rescue}\nStart-ScheduledTask\n'merge'\nTS_OAUTH_CLIENT_ID\nINSTALL_FORGE_SHADOW_M2`));
  const codes = result.findings.map(({ code }) => code);
  for (const code of ['no-faff-rescue-direct-task-mutation-forbidden','no-faff-rescue-direct-source-convergence-forbidden','no-faff-rescue-credential-surface-forbidden','no-faff-rescue-forge-authority-forbidden']) assert.ok(codes.includes(code));
});

test('rejects dynamic launcher and executable regression', () => {
  const result = review(sources(rescue, launcher.replace('-File "%SCRIPT%"', '-Command "%SCRIPT% *"'), `${staticTest}\nimport 'node:child_process';`));
  const codes = result.findings.map(({ code }) => code);
  for (const code of ['no-faff-launcher-invocation-not-fixed','no-faff-launcher-caller-arguments-forbidden','no-faff-launcher-dynamic-powershell-forbidden','no-faff-static-test-child-process-forbidden']) assert.ok(codes.includes(code));
});

test('rejects weakened identity, stability, and verdict', () => {
  const insecure = rescue.replace("$publicRemote = 'https://github.com/Cheekyfellastef/stephan-os.git'", '$publicRemote = $env:REMOTE').replace('for ($round = 1; $round -le 3; $round += 1)', 'while ($true)').replace("finalVerdict = 'BATTLE_BRIDGE_NO_FAFF_RESCUE_READY'", "finalVerdict = 'READY'");
  const codes = review(sources(insecure)).findings.map(({ code }) => code);
  for (const code of ['no-faff-rescue-public-remote-not-fixed','no-faff-rescue-main-stability-bound-missing','no-faff-rescue-ready-verdict-missing']) assert.ok(codes.includes(code));
});

test('rejects tampered source identity', () => {
  const bad = record(paths[0], rescue); bad.blobSha = 'b'.repeat(40);
  assert.ok(review([bad, ...sources().slice(1)]).findings.some(({ code }) => code === 'windows-authority-source-evidence-invalid'));
});
