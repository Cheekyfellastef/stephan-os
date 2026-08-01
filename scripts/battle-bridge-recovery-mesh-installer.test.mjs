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
  assert.match(installer, /registrationApplied = \$false/);
  assert.match(installer, /installed = \[bool\]\$registrationApplied/);
  assert.match(installer, /startedNow = \[bool\]\$startApplied/);
  assert.match(installer, /whatIf = \[bool\]\$WhatIfPreference/);
  assert.doesNotMatch(installer, /RunLevel Highest|Restart-Computer|Stop-Process|Invoke-Expression|git\s+(?:reset|clean|checkout)/i);
});

test('windowless launcher pins recovery mesh to one fixed source runner', async () => {
  const [vbs, hidden, verifier] = await Promise.all([
    source('run-stephanos-scheduled-task-windowless.vbs'),
    source('run-battle-bridge-recovery-mesh-hidden.ps1'),
    source('verify-battle-bridge-recovery-mesh-mutex.ps1'),
  ]);
  assert.match(vbs, /Case "recovery-mesh"[\s\S]*run-battle-bridge-recovery-mesh-hidden\.ps1/);
  assert.match(hidden, /scripts\\battle-bridge-recovery-mesh\.mjs/);
  assert.match(hidden, /System\.Threading\.Mutex/);
  assert.match(hidden, /STEPHANOS_RECOVERY_MESH_MUTEX_HELD = '1'/);
  assert.match(hidden, /STEPHANOS_RECOVERY_MESH_LAUNCHER_PID/);
  assert.match(hidden, /regardless of PID reuse/);
  assert.doesNotMatch(hidden, /Get-Process -Id/);
  assert.match(verifier, /Mutex\]::OpenExisting\('Local\\StephanosBattleBridgeRecoveryMeshV1'\)/);
  assert.match(verifier, /node\.ParentProcessId -ne \$LauncherPid/);
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
  assert.match(probe, /http:\/\/127\.0\.0\.1:18789\/health/);
  assert.match(probe, /http:\/\/127\.0\.0\.1:18789\/identity/);
  assert.match(probe, /product\s+-eq\s+'OpenClaw'/);
  assert.match(probe, /identityVerified/);
  assert.doesNotMatch(probe, /Test-TcpHealth/);
  assert.match(probe, /expectedArguments = "\/\/B \/\/NoLogo/);
  assert.match(probe, /\[string\]::Equals\(\$arguments, \$expectedArguments/);
  assert.doesNotMatch(probe, /arguments -match/);
  assert.doesNotMatch(probe, /Restart-Computer|Stop-Process|Invoke-Expression|git\s+(?:reset|clean|checkout|switch)|Remove-Item/i);
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
  assert.match(uninstall, /workerPreserved = \$true/);
  assert.match(uninstall, /mailboxPreserved = \$true/);
  assert.match(uninstall, /sharedWorkspaceReceiptsPreserved = \$true/);
  assert.doesNotMatch(uninstall, /Remove-Item|git\s+|Stop-Process|Restart-Computer/i);
});
