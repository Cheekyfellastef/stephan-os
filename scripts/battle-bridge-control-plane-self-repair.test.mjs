import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const reconcileUrl = new URL('./windows/reconcile-battle-bridge-control-plane.ps1', import.meta.url);
const syncLauncherUrl = new URL('./windows/run-battle-bridge-github-sync-hidden.ps1', import.meta.url);

test('control-plane reconciler is fixed to exactly the canonical recovery mesh and mailbox tasks', async () => {
  const source = await readFile(reconcileUrl, 'utf8');
  const taskNames = [...source.matchAll(/Name = '([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(taskNames, [
    'Stephanos Battle Bridge Recovery Mesh',
    'Stephanos Battle Bridge GitHub Command Mailbox',
  ]);
  assert.match(source, /LauncherId = 'recovery-mesh'/);
  assert.match(source, /LauncherId = 'github-command-mailbox'/);
  assert.match(source, /install-battle-bridge-recovery-mesh\.ps1/);
  assert.match(source, /install-battle-bridge-github-command-mailbox\.ps1/);
  assert.match(source, /-StartNow/);
  assert.match(source, /arbitraryTaskNameAllowed = \$false/);
  assert.match(source, /arbitraryExecutableAllowed = \$false/);
  assert.match(source, /arbitraryShellAllowed = \$false/);
  assert.match(source, /sourceMutationAllowed = \$false/);
  assert.match(source, /gitMutationAllowed = \$false/);
  assert.match(source, /pcRestartAllowed = \$false/);
  assert.doesNotMatch(source, /param\([^)]*TaskName|param\([^)]*Executable|param\([^)]*Command|param\([^)]*Path/i);
  assert.doesNotMatch(source, /Invoke-Expression|Start-Process|cmd\.exe|reset --hard|git clean|git stash|git checkout|git push|Restart-Computer/i);
});

test('unattended sync repairs the control plane only after canonical source sync succeeds', async () => {
  const source = await readFile(syncLauncherUrl, 'utf8');
  const syncCall = source.indexOf('& $nodeCommand.Source $coordinatorPath');
  const syncGuard = source.indexOf('if ($syncExitCode -ne 0) { exit $syncExitCode }');
  const reconcileResolve = source.indexOf("reconcile-battle-bridge-control-plane.ps1");
  const reconcileCall = source.indexOf("& 'C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe'");
  assert.ok(syncCall >= 0);
  assert.ok(syncGuard > syncCall);
  assert.ok(reconcileResolve > syncGuard);
  assert.ok(reconcileCall > reconcileResolve);
  assert.match(source, /-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \$reconcilePath/);
  assert.doesNotMatch(source, /reconcile-battle-bridge-control-plane\.ps1[\s\S]*before.*coordinatorPath/i);
});
