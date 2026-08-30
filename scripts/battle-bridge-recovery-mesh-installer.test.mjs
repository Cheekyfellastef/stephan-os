import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const windows = new URL('./windows/', import.meta.url);

async function source(name) {
  return readFile(new URL(name, windows), 'utf8');
}

test('installer registers one hidden minute supervisor with overlap rejection', async () => {
  const installer = await source('install-battle-bridge-recovery-mesh.ps1');
  assert.match(installer, /Stephanos Battle Bridge Recovery Mesh/);
  assert.match(installer, /RepetitionInterval \(New-TimeSpan -Minutes 1\)/);
  assert.match(installer, /-MultipleInstances IgnoreNew/);
  assert.match(installer, /-Hidden/);
  assert.match(installer, /recovery-mesh/);
  assert.match(installer, /maximumConcurrentExecutors = 1/);
  assert.match(installer, /wscriptExe = 'C:\\Windows\\System32\\wscript\.exe'/);
  assert.doesNotMatch(installer, /env:SystemRoot/);
  assert.match(installer, /registrationApplied = \$false/);
  assert.match(installer, /installed = \[bool\]\$registrationApplied/);
  assert.match(installer, /startedNow = \[bool\]\$startApplied/);
  assert.match(installer, /whatIf = \[bool\]\$WhatIfPreference/);
  assert.doesNotMatch(installer, /RunLevel Highest|Restart-Computer|Stop-Process|Invoke-Expression|git\s+(?:reset|clean|checkout)/i);
});

test('package lifecycle commands pin the canonical PowerShell host', async () => {
  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  for (const name of [
    'stephanos:battle-bridge:recovery-mesh:install',
    'stephanos:battle-bridge:recovery-mesh:status',
    'stephanos:battle-bridge:recovery-mesh:uninstall',
  ]) {
    assert.match(packageJson.scripts[name], /^"C:\\Windows\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe" /);
    assert.doesNotMatch(packageJson.scripts[name], /^powershell\b/i);
  }
  assert.equal(
    packageJson.scripts['stephanos:battle-bridge:recovery-mesh'],
    '"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%USERPROFILE%\\Documents\\GitHub\\stephan-os\\scripts\\windows\\run-battle-bridge-recovery-mesh-hidden.ps1"',
  );
  assert.doesNotMatch(packageJson.scripts['stephanos:battle-bridge:recovery-mesh'], /-File scripts[\\/]/);
  assert.doesNotMatch(packageJson.scripts['stephanos:battle-bridge:recovery-mesh'], /^node\b/i);
});

test('windowless launcher pins recovery mesh to one fixed source runner', async () => {
  const [vbs, hidden, verifier] = await Promise.all([
    source('run-stephanos-scheduled-task-windowless.vbs'),
    source('run-battle-bridge-recovery-mesh-hidden.ps1'),
    source('verify-battle-bridge-recovery-mesh-mutex.ps1'),
  ]);
  assert.match(vbs, /Case "recovery-mesh"[\s\S]*run-battle-bridge-recovery-mesh-hidden\.ps1/);
  assert.match(vbs, /powershellExe = "C:\\Windows\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe"/);
  assert.doesNotMatch(vbs, /ExpandEnvironmentStrings\("%SystemRoot%"\)/);
  assert.match(hidden, /scripts\\battle-bridge-recovery-mesh\.mjs/);
  assert.match(hidden, /System\.Threading\.Mutex/);
  assert.match(hidden, /STEPHANOS_RECOVERY_MESH_MUTEX_HELD = '1'/);
  assert.match(hidden, /STEPHANOS_RECOVERY_MESH_LAUNCHER_PID/);
  assert.match(hidden, /C:\\Program Files\\nodejs\\node\.exe/);
  assert.doesNotMatch(hidden, /Get-Command node/);
  assert.match(hidden, /regardless of PID reuse/);
  assert.doesNotMatch(hidden, /Get-Process -Id/);
  assert.match(hidden, /Get-RecoveryLockPathBaseline/);
  assert.match(hidden, /Assert-RecoveryLockPathBaseline/);
  assert.match(hidden, /OpenVerifiedForDelete/);
  assert.match(hidden, /DeleteByHandle/);
  assert.match(hidden, /RECOVERY_LOCK_MULTIPLE_LINKS_REJECTED/);
  assert.doesNotMatch(hidden, /\[System\.IO\.File\]::Delete\(\$lockPath\)/);
  assert.match(verifier, /Mutex\]::OpenExisting\('Local\\StephanosBattleBridgeRecoveryMeshV1'\)/);
  assert.match(verifier, /node\.ParentProcessId -eq \$LauncherPid/);
  assert.match(verifier, /C:\\Windows\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe/);
  assert.match(verifier, /launcher\.ExecutablePath/);
  assert.match(verifier, /node\.ExecutablePath/);
  assert.match(verifier, /\$expectedCommandLine = '\"\{0\}\"  -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"\{1\}\"'/);
  assert.match(verifier, /\$launcherCommandLineMatches = \$launcher -and \[string\]::Equals\(\[string\]\$launcher\.CommandLine, \$expectedCommandLine/);
  assert.match(verifier, /\$processLineageMatches = \[int\]\$verifier\.ParentProcessId -eq \$NodePid -and \[int\]\$node\.ParentProcessId -eq \$LauncherPid/);
  assert.match(verifier, /if \(-not \$processLineageMatches -or -not \$nodeExecutableMatches -or -not \$launcherExecutableMatches -or -not \$launcherCommandLineMatches\)/);
  assert.doesNotMatch(verifier, /CommandLine -notmatch/);
  assert.match(verifier, /RECOVERY_MESH_MUTEX_NOT_OWNED_BY_LAUNCHER/);
  assert.doesNotMatch(hidden, /["']-Command["']|Invoke-Expression|Start-Process/);
});

test('fixed probe can start only four named tasks and cannot restart the PC or mutate source', async () => {
  const probe = await source('probe-battle-bridge-recovery-mesh.ps1');
  for (const task of [
    'Stephanos Mission Orchestrator Worker Watchdog',
    'Stephanos Battle Bridge GitHub Command Mailbox',
    'Stephanos Battle Bridge Backend',
    'OpenClaw Gateway',
  ]) assert.match(probe, new RegExp(task));
  assert.match(probe, /\[ValidateSet\('Inspect', 'Recover'\)\]/);
  assert.match(probe, /Start-ScheduledTask -TaskName \$spec\.Name/);
  assert.match(probe, /function Test-TaskAuthority/);
  assert.match(probe, /Principal\.UserId/);
  assert.match(probe, /Principal\.LogonType\s+-eq\s+'Interactive'/);
  assert.match(probe, /Principal\.RunLevel\s+-eq\s+'Limited'/);
  assert.match(probe, /Settings\.MultipleInstances\s+-eq\s+'IgnoreNew'/);
  assert.match(probe, /Settings\.Enabled\s+-eq\s+\$true/);
  assert.match(probe, /if \(-not \$observed\.authorityCanonical\) \{ continue \}/);
  assert.match(probe, /mailboxTask\.lastTaskResult -eq 0/);
  assert.match(probe, /battle-bridge-backend-freshness-probe\.mjs/);
  assert.match(probe, /\/api\/mission-operations/);
  assert.match(probe, /BACKEND_CURRENT/);
  assert.match(probe, /Get-NetTCPConnection -LocalPort 8787 -State Listen/);
  assert.match(probe, /Get-CimInstance Win32_Process/);
  assert.match(probe, /BACKEND_LISTENER_IDENTITY_CHANGED/);
  assert.match(probe, /BACKEND_TASK_PROCESS_OWNERSHIP_STALE_OR_INVALID/);
  assert.match(probe, /BACKEND_TASK_PROCESS_LINEAGE_NOT_PROVEN/);
  assert.match(probe, /processStartTimeUtc/);
  assert.match(probe, /--expected-source-head \$ExpectedSourceHead/);
  assert.match(probe, /BACKEND_LISTENER_OWNERSHIP_UNVERIFIABLE/);
  assert.doesNotMatch(probe, /function Test-HttpHealth/);
  assert.match(probe, /http:\/\/127\.0\.0\.1:18789\/health/);
  assert.match(probe, /http:\/\/127\.0\.0\.1:18789\/identity/);
  assert.match(probe, /product\s+-eq\s+'OpenClaw'/);
  assert.match(probe, /identityVerified/);
  assert.match(probe, /C:\\Program Files\\Git\\cmd\\git\.exe/);
  assert.match(probe, /wscriptPath = 'C:\\Windows\\System32\\wscript\.exe'/);
  assert.match(probe, /\$canonicalPowerShell/);
  assert.doesNotMatch(probe, /& powershell\.exe/);
  assert.doesNotMatch(probe, /& git\.exe/);
  assert.doesNotMatch(probe, /Test-TcpHealth/);
  assert.match(probe, /expectedArguments = "\/\/B \/\/NoLogo/);
  assert.match(probe, /\[string\]::Equals\(\$arguments, \$expectedArguments/);
  assert.doesNotMatch(probe, /arguments -match/);
  assert.doesNotMatch(probe, /Restart-Computer|Stop-Process|Invoke-Expression|git\s+(?:reset|clean|checkout|switch)|Remove-Item/i);
});

test('backend autostart contract rejects overlapping task instances', async () => {
  const installer = await source('install-stephanos-backend-autostart.ps1');
  assert.match(installer, /New-ScheduledTaskPrincipal -UserId \$currentUser -LogonType Interactive -RunLevel Limited/);
  assert.match(installer, /New-ScheduledTaskSettingsSet[^\r\n]*-MultipleInstances IgnoreNew/);
  assert.doesNotMatch(installer, /RunLevel Highest|-MultipleInstances Parallel/);
});

test('canonical task definition beside an unrelated listener cannot establish backend ownership', async () => {
  const probe = await source('probe-battle-bridge-recovery-mesh.ps1');
  assert.match(probe, /Equals\(\$executable, \$canonicalNode/);
  assert.match(probe, /BACKEND_LISTENER_EXECUTABLE_FOREIGN/);
  assert.match(probe, /function Test-CanonicalBackendCommandLine/);
  assert.match(probe, /-replace '\\s\+', ' '/);
  assert.match(probe, /STEPHANOS_BACKEND_BOOTSTRAP_BASE64/);
  assert.match(probe, /--input-type=module --eval/);
  assert.match(probe, /Test-CanonicalBackendCommandLine -CommandLine \(\[string\]\$process\.CommandLine\) -ExpectedSourceHead \$ExpectedSourceHead/);
  assert.match(probe, /BACKEND_LISTENER_COMMAND_FOREIGN/);
  assert.match(probe, /receipt\.pid -eq \$listenerAfter\.pid/);
  assert.doesNotMatch(probe, /CommandLine -match|Invoke-Expression/i);
});

test('listener identity change between response probe and ownership recheck fails closed', async () => {
  const probe = await source('probe-battle-bridge-recovery-mesh.ps1');
  assert.match(probe, /\$listenerBefore = Get-BackendListenerIdentity[\s\S]*& \$canonicalNode[\s\S]*\$listenerAfter = Get-BackendListenerIdentity/);
  assert.match(probe, /listenerBefore\.pid -ne \$listenerAfter\.pid/);
  assert.match(probe, /listenerBefore\.creationTimeUtc -ne \$listenerAfter\.creationTimeUtc/);
  assert.match(probe, /BACKEND_LISTENER_IDENTITY_CHANGED/);
});

test('unsupported ownership inspection reports an explicit fail-closed blocker', async () => {
  const probe = await source('probe-battle-bridge-recovery-mesh.ps1');
  assert.match(probe, /Get-NetTCPConnection[^\r\n]*-ErrorAction Stop/);
  assert.match(probe, /Get-CimInstance Win32_Process[^\r\n]*-ErrorAction Stop/);
  assert.match(probe, /\$reason = 'BACKEND_LISTENER_OWNERSHIP_UNVERIFIABLE'/);
  assert.doesNotMatch(probe, /BACKEND_LISTENER_OWNERSHIP_UNVERIFIABLE'\s*}\s*catch\s*{\s*return[^\r\n]*healthy = \$true/);
});

test('ingress adapter has four fixed routes and nonce-gates break glass', async () => {
  const request = await source('request-battle-bridge-recovery.ps1');
  for (const route of ['GITHUB_MAILBOX','TAILSCALE_CONTROL','OPENCLAW_WHATSAPP','AUTHENTICATED_BREAK_GLASS']) assert.match(request, new RegExp(route));
  assert.match(request, /IssueBreakGlassNonce/);
  assert.match(request, /BREAK_GLASS_NONCE_MISMATCH/);
  assert.match(request, /FileMode\]::CreateNew/);
  assert.match(request, /BREAK_GLASS_NONCE_ALREADY_CLAIMED/);
  assert.match(request, /TAILSCALE_SSH_IDENTITY_NOT_VERIFIED/);
  assert.match(request, /TAILSCALE_SSH_PROCESS_ANCESTOR_REQUIRED/);
  assert.match(request, /C:\\Program Files\\Tailscale\\tailscale\.exe/);
  assert.doesNotMatch(request, /Get-Command tailscale/);
  assert.match(request, /Get-NetTCPConnection -State Established/);
  assert.match(request, /OPENCLAW_HOST_PROOF_REQUIRED/);
  assert.match(request, /OPENCLAW_HOST_PROCESS_IDENTITY_INVALID/);
  assert.match(request, /OPENCLAW_GATEWAY_PROCESS_OWNERSHIP_INVALID/);
  assert.match(request, /OPENCLAW_GATEWAY_RUNTIME_IDENTITY_INVALID/);
  assert.match(request, /openclaw\.plugin-sdk\.authenticated-command/);
  assert.match(request, /OPENCLAW_CALLER_SUPPLIED_EVIDENCE_REJECTED/);
  assert.match(request, /RECOVERY_GITHUB_RECEIPT_AUTHORITY_INVALID/);
  assert.match(request, /Get-CanonicalMailboxReceiptFilename/);
  assert.match(request, /-C \$repoRoot rev-parse HEAD/);
  assert.match(request, /C:\\Program Files\\Git\\cmd\\git\.exe/);
  assert.match(request, /wscriptPath = 'C:\\Windows\\System32\\wscript\.exe'/);
  assert.doesNotMatch(request, /Get-Command git/);
  assert.match(request, /RECOVERY_ROUTE_EVIDENCE_ISSUER_INVALID/);
  assert.match(request, /stephanos\.battle-bridge-recovery-auth-evidence\.v1/);
  assert.match(request, /RECOVERY_MESH_TASK_ACTION_INVALID/);
  assert.match(request, /RECOVERY_MESH_TASK_PRINCIPAL_INVALID/);
  assert.match(request, /RECOVERY_MESH_TASK_SETTINGS_INVALID/);
  assert.match(request, /MultipleInstances/);
  assert.match(request, /ExecutionTimeLimit/);
  assert.match(request, /FileAttributes\]::ReparsePoint/);
  assert.match(request, /RECOVERY_PATH_REPARSE_ANCESTOR_REJECTED/);
  assert.match(request, /StephanosRecoveryPathIdentity/);
  assert.match(request, /Assert-StablePathBaseline -Baseline \$pathBaseline/);
  assert.match(request, /Start-ScheduledTask -TaskName \$taskName/);
  assert.doesNotMatch(request, /Invoke-Expression|Start-Process|Restart-Computer|Stop-Process|git\s+/i);
});

test('uninstall removes only the coordinator and preserves every underlying service and receipt', async () => {
  const uninstall = await source('uninstall-battle-bridge-recovery-mesh.ps1');
  assert.match(uninstall, /Unregister-ScheduledTask -TaskName \$taskName/);
  assert.match(uninstall, /unregisterApplied = \$false/);
  assert.match(uninstall, /removed = \[bool\]\(\$unregisterApplied -and -not \$taskPresentAfter\)/);
  assert.match(uninstall, /whatIf = \[bool\]\$WhatIfPreference/);
  assert.match(uninstall, /workerPreserved = \$true/);
  assert.match(uninstall, /mailboxPreserved = \$true/);
  assert.match(uninstall, /sharedWorkspaceReceiptsPreserved = \$true/);
  assert.doesNotMatch(uninstall, /Remove-Item|git\s+|Stop-Process|Restart-Computer/i);
});

test('exact-head backend authority tolerates only canonical unstaged runtime-memory and UI-dist dirt', async () => {
  const [starter, probe] = await Promise.all([
    source('start-stephanos-backend.ps1'),
    source('probe-battle-bridge-recovery-mesh.ps1'),
  ]);
  assert.match(starter, /status '--porcelain=v1' '--untracked-files=no'/);
  assert.match(starter, /\$runtimeMemoryPath = 'stephanos-server\/data\/memory\/durable-memory\.json'/);
  assert.match(starter, /\$runtimeDistPrefix = 'apps\/stephanos\/dist\/'/);
  assert.match(starter, /\$status -eq ' M' -and \$path -eq \$runtimeMemoryPath/);
  assert.match(starter, /function Test-RuntimeUiDistStatus[\s\S]*\$Status -eq ' M' -or \$Status -eq ' D'/);
  assert.match(starter, /Test-RuntimeUiDistStatus -Status \$status[\s\S]*\$path\.StartsWith\(\$runtimeDistPrefix, \[System\.StringComparison\]::Ordinal\)/);
  assert.match(starter, /Backend startup requires source-tracked files to be unmodified at exact head/);
  assert.match(starter, /trackedWorktreeClean = -not \(\$RuntimeMemoryDirty -or \$RuntimeDistDirty\)/);
  assert.match(starter, /sourceWorktreeClean = \$true/);
  assert.match(starter, /runtimeMemoryDirtTolerated = \$RuntimeMemoryDirty/);
  assert.match(starter, /runtimeDistDirtTolerated = \$RuntimeDistDirty/);
  assert.match(probe, /function Get-CanonicalTrackedWorktreeAssessment/);
  assert.match(probe, /function Assert-CanonicalSourceWorktreeClean/);
  assert.equal((probe.match(/Assert-CanonicalSourceWorktreeClean -GitExecutable/g) || []).length, 2);
  assert.match(probe, /RECOVERY_CANONICAL_TRACKED_WORKTREE_INSPECTION_FAILED/);
  assert.match(probe, /RECOVERY_CANONICAL_TRACKED_SOURCE_WORKTREE_DIRTY/);
  assert.match(probe, /\$receiptSourceClean/);
  assert.match(probe, /\$receiptTrackedTruth/);
  assert.match(probe, /sourceWorktreeClean = \$true/);
  assert.match(probe, /runtimeMemoryDirtTolerated = \[bool\]\$afterWorktree\.RuntimeMemoryDirty/);
  assert.doesNotMatch(starter, /--untracked-files=all/);
  assert.doesNotMatch(probe, /--untracked-files=all/);
});

test('recovery does not re-run an already verified backend task', async () => {
  const probe = await source('probe-battle-bridge-recovery-mesh.ps1');
  const sourceIdentityIndex = probe.indexOf("$sourceControlExecutable = 'C:\\Program Files\\Git\\cmd\\git.exe'");
  const beforeIndex = probe.indexOf('$before = @{}');
  const preflightIndex = probe.indexOf("$backendBeforeRecovery = if ($Mode -eq 'Recover')");
  const recoveryLoopIndex = probe.indexOf("if ($Mode -eq 'Recover') {", preflightIndex + 1);
  assert.ok(sourceIdentityIndex >= 0 && sourceIdentityIndex < beforeIndex);
  assert.ok(beforeIndex < preflightIndex && preflightIndex < recoveryLoopIndex);
  assert.match(probe, /Get-BackendFreshnessHealth -ExpectedSourceHead \$sourceHead -BackendTask \$before\.backend/);
  assert.match(probe, /if \(\$spec\.Id -eq 'backend' -and \$backendBeforeRecovery\.healthy\) \{[\s\S]*?\$backendRestartSkippedAsCurrent = \$true[\s\S]*?continue/);
  assert.match(probe, /backendRestartSkippedAsCurrent = \[bool\]\$backendRestartSkippedAsCurrent/);
  assert.doesNotMatch(probe, /\$spec\.Id -eq 'backend' -and \[string\]\$observed\.state/);
});
