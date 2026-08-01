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
  assert.doesNotMatch(installer, /RunLevel Highest|Restart-Computer|Stop-Process|Invoke-Expression|git\s+(?:reset|clean|checkout)/i);
});

test('windowless launcher pins recovery mesh to one fixed source runner', async () => {
  const [vbs, hidden] = await Promise.all([
    source('run-stephanos-scheduled-task-windowless.vbs'),
    source('run-battle-bridge-recovery-mesh-hidden.ps1'),
  ]);
  assert.match(vbs, /Case "recovery-mesh"[\s\S]*run-battle-bridge-recovery-mesh-hidden\.ps1/);
  assert.match(hidden, /scripts\\battle-bridge-recovery-mesh\.mjs/);
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
  assert.doesNotMatch(probe, /Restart-Computer|Stop-Process|Invoke-Expression|git\s+(?:reset|clean|checkout|switch)|Remove-Item/i);
});

test('ingress adapter has four fixed routes and nonce-gates break glass', async () => {
  const request = await source('request-battle-bridge-recovery.ps1');
  for (const route of ['GITHUB_MAILBOX','TAILSCALE_CONTROL','OPENCLAW_WHATSAPP','AUTHENTICATED_BREAK_GLASS']) assert.match(request, new RegExp(route));
  assert.match(request, /IssueBreakGlassNonce/);
  assert.match(request, /BREAK_GLASS_NONCE_MISMATCH/);
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
