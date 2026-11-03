import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const installPath = new URL('./windows/install-battle-bridge-github-sync.ps1', import.meta.url);
const statusPath = new URL('./windows/status-battle-bridge-github-sync.ps1', import.meta.url);
const uninstallPath = new URL('./windows/uninstall-battle-bridge-github-sync.ps1', import.meta.url);
const hiddenLauncherPath = new URL('./windows/run-battle-bridge-github-sync-hidden.ps1', import.meta.url);

function parameterBlock(source) {
  const match = source.match(/param\(([^)]*)\)/s);
  return match?.[1] || '';
}

test('installer exposes only StartNow and registers hidden limited fixed task', async () => {
  const source = await readFile(installPath, 'utf8');
  assert.deepEqual([...parameterBlock(source).matchAll(/\[switch\]\s*\$(\w+)/g)].map((match) => match[1]), ['StartNow']);
  assert.match(source, /Stephanos Battle Bridge GitHub Sync/);
  assert.match(source, /New-ScheduledTaskAction -Execute \$wscriptExe/);
  assert.match(source, /run-stephanos-scheduled-task-windowless\.vbs/);
  assert.match(source, /\/\/B \/\/NoLogo/);
  assert.match(source, /github-sync/);
  assert.match(source, /-RepetitionInterval \(New-TimeSpan -Minutes 1\)/);
  assert.match(source, /intervalMinutes = 1/);
  assert.match(source, /-AtLogOn/);
  assert.match(source, /-Hidden/);
  assert.match(source, /-RunLevel Limited/);
  assert.match(source, /-MultipleInstances IgnoreNew/);
  assert.doesNotMatch(source, /reset --hard|git clean|git checkout|git push|Invoke-Expression|Start-Process powershell/i);
});

test('GitHub sync headless launcher pins the canonical sync-and-refresh coordinator', async () => {
  const source = await readFile(hiddenLauncherPath, 'utf8');
  assert.match(source, /Documents\\GitHub\\stephan-os/);
  assert.match(source, /battle-bridge-github-sync-and-refresh\.mjs/);
  assert.match(source, /Get-Command node\.exe/);
  assert.match(source, /\*> \$null/);
  assert.doesNotMatch(source, /\[string\]\s*\$|Invoke-Expression|Start-Process|cmd\.exe/i);
});

test('status probe is read-only and reports canonical receipt surface', async () => {
  const source = await readFile(statusPath, 'utf8');
  assert.match(source, /Get-ScheduledTask/);
  assert.match(source, /Get-ScheduledTaskInfo/);
  assert.match(source, /battle-bridge-github-sync-current\.json/);
  assert.doesNotMatch(source, /Register-ScheduledTask|Unregister-ScheduledTask|Start-ScheduledTask|Stop-ScheduledTask/);
});

test('rollback removes only the fixed task and preserves source and receipts', async () => {
  const source = await readFile(uninstallPath, 'utf8');
  assert.match(source, /Unregister-ScheduledTask -TaskName \$taskName/);
  assert.match(source, /sourcePreserved = \$true/);
  assert.match(source, /sharedWorkspaceReceiptsPreserved = \$true/);
  assert.doesNotMatch(source, /Remove-Item|\bgit(?:\.exe)?\s|Stop-Process|Start-Process|Restart-Service/i);
});
