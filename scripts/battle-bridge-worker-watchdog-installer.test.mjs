import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const installPath = new URL('./windows/install-battle-bridge-worker-watchdog.ps1', import.meta.url);
const statusPath = new URL('./windows/status-battle-bridge-worker-watchdog.ps1', import.meta.url);
const uninstallPath = new URL('./windows/uninstall-battle-bridge-worker-watchdog.ps1', import.meta.url);
const probePath = new URL('./windows/probe-mission-orchestrator-worker-watchdog.ps1', import.meta.url);
const workerStartPath = new URL('./windows/start-mission-orchestrator-worker.ps1', import.meta.url);

function parameterBlock(source) {
  const match = source.match(/param\(([^)]*)\)/s);
  return match?.[1] || '';
}

test('installer exposes only StartNow and registers hidden limited fixed watchdog task', async () => {
  const source = await readFile(installPath, 'utf8');
  assert.deepEqual([...parameterBlock(source).matchAll(/\[switch\]\s*\$(\w+)/g)].map((match) => match[1]), ['StartNow']);
  assert.match(source, /Stephanos Mission Orchestrator Worker Watchdog/);
  assert.match(source, /New-ScheduledTaskAction -Execute \$nodeExe/);
  assert.match(source, /battle-bridge-worker-watchdog\.mjs/);
  assert.match(source, /-RepetitionInterval \(New-TimeSpan -Minutes 1\)/);
  assert.match(source, /-AtLogOn/);
  assert.match(source, /-Hidden/);
  assert.match(source, /-RunLevel Limited/);
  assert.match(source, /-MultipleInstances IgnoreNew/);
  assert.doesNotMatch(source, /Invoke-Expression|Start-Process powershell|Stop-Process|Restart-Computer|shutdown\.exe/i);
});

test('operator status script is read-only and surfaces watchdog plus worker heartbeat', async () => {
  const source = await readFile(statusPath, 'utf8');
  assert.match(source, /Get-ScheduledTask/);
  assert.match(source, /Get-ScheduledTaskInfo/);
  assert.match(source, /battle-bridge-worker-watchdog-current\.json/);
  assert.match(source, /mission-orchestrator-worker-heartbeat\.json/);
  assert.doesNotMatch(source, /Register-ScheduledTask|Unregister-ScheduledTask|Start-ScheduledTask|Stop-ScheduledTask|Stop-Process/);
});

test('rollback removes only the watchdog task and preserves worker, source and proof', async () => {
  const source = await readFile(uninstallPath, 'utf8');
  assert.match(source, /Unregister-ScheduledTask -TaskName \$taskName/);
  assert.match(source, /workerTaskPreserved = \$true/);
  assert.match(source, /sourcePreserved = \$true/);
  assert.match(source, /sharedWorkspaceReceiptsPreserved = \$true/);
  assert.doesNotMatch(source, /Remove-Item|Stop-Process|Restart-Computer|shutdown\.exe|\bgit(?:\.exe)?\s/i);
});

test('internal probe permits only inspect or fixed canonical task start and never process kill', async () => {
  const source = await readFile(probePath, 'utf8');
  assert.match(source, /ValidateSet\('Inspect', 'StartApprovedWorkerTask'\)/);
  assert.match(source, /\$taskName = 'Stephanos Mission Orchestrator Worker'/);
  assert.match(source, /\$workerLauncherPath/);
  assert.match(source, /Test-CanonicalWorkerTaskAction/);
  assert.match(source, /TaskPath -ne '\\\\'/);
  assert.match(source, /\.Actions\.Count -ne 1/);
  assert.match(source, /actionMatchesCanonicalWorker/);
  assert.match(source, /The fixed Mission Orchestrator worker task action is not canonical/);
  assert.match(source, /Start-ScheduledTask -TaskName \$taskName/);
  assert.match(source, /Get-CimInstance Win32_Process/);
  assert.doesNotMatch(source, /\[string\]\$TaskName|Stop-ScheduledTask|Stop-Process|Invoke-Expression|Restart-Computer|shutdown\.exe/i);
});

test('worker launcher is pinned to canonical main and supervised heartbeat loop', async () => {
  const source = await readFile(workerStartPath, 'utf8');
  assert.match(source, /mission-orchestrator-worker-supervised\.mjs/);
  assert.match(source, /Documents\\GitHub\\stephan-os/);
  assert.match(source, /\$branch -ne 'main'/);
  assert.match(source, /STEPHANOS_MISSION_WORKER_HEAD_SHA/);
  assert.match(source, /STEPHANOS_MISSION_WORKER_TASK_NAME/);
  assert.doesNotMatch(source, /Start-Process|Invoke-Expression|git reset|git checkout|git clean|git push/i);
});
