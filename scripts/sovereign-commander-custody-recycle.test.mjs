import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

for (const heldKind of ['timeout', 'maintenance']) test(`actual Windows caretaker retains ${heldKind} custody even with a stale capability`, { skip: process.platform !== 'win32' }, () => {
  const source = readFileSync(new URL('./windows/run-sovereign-commander-hidden.ps1', import.meta.url), 'utf8');
  const extract = (start, end) => {
    const a = source.indexOf(start), b = source.indexOf(end, a);
    assert.ok(a >= 0 && b > a); return source.slice(a, b);
  };
  const health = extract('function Get-SovereignCommanderHealth {', 'function Wait-SovereignCommanderHealth {');
  const lifecycle = extract('if ($healthBefore.timeoutCustodyHeld -eq $true)', '$after = @(Get-SovereignCommanderProcesses)');
  const script = `$ErrorActionPreference='Stop';Set-StrictMode -Version Latest;
    $port=18791;$RequireCapabilityVersion='new-version';$script:stops=0;$script:starts=0;
    function Invoke-RestMethod { [pscustomobject]@{ok=$true;service='stephanos-sovereign-commander';
      capabilityVersion='old-version';continuousRepairGuardian=[pscustomobject]@{
        enabled=$true;running=$false;scheduled=$false;timeoutCustodyHeld=$${heldKind === 'timeout'};maintenanceInFlight=$${heldKind === 'maintenance'}}} }
    function Test-Path { return $true }
    function Stop-Process { $script:stops++ }
    function Start-Process { $script:starts++;return [pscustomobject]@{Id=1234} }
    function Start-Sleep {}
    ${health}
    $healthBefore=Get-SovereignCommanderHealth;$healthyBefore=[bool]$healthBefore.healthy;
    $before=@([pscustomobject]@{ProcessId=1234});$staleDaemonContract=$true;
    $serverScript='fixture';$tokenPath='fixture';$canonicalNode='fixture';$repoRoot='fixture';
    $blocker='';$startRequested=$false;$stoppedPidCount=0;
    ${lifecycle}
    @{held=$healthBefore.timeoutCustodyHeld;healthy=$healthyBefore;capability=$healthBefore.capabilitySatisfied;
      stops=$script:stops;starts=$script:starts;startRequested=$startRequested;blocker=$blocker}|ConvertTo-Json -Compress`;
  const result = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    // Cold Windows PowerShell startup on hosted runners can exceed 10s when
    // native fixtures initialize concurrently. Keep execution bounded without
    // changing any hold/no-start/no-stop assertion or runtime repair deadline.
    { shell: false, windowsHide: true, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.deepEqual(JSON.parse(result.stdout), { held: heldKind === 'timeout', healthy: false, capability: false,
    stops: 0, starts: 0, startRequested: false,
    blocker: heldKind === 'timeout' ? 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_TIMEOUT_CUSTODY_UNPROVEN' : 'SOVEREIGN_MAINTENANCE_OWNER_BUSY' });
});
