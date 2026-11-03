import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const installerPaths = [
  new URL('./windows/install-mission-orchestrator-worker-autostart.ps1', import.meta.url),
  new URL('./windows/install-stephanos-backend-autostart.ps1', import.meta.url),
  new URL('./windows/install-battle-bridge-github-command-mailbox.ps1', import.meta.url),
];
const windowlessLauncherPath = new URL('./windows/run-stephanos-scheduled-task-windowless.vbs', import.meta.url);

test('persistent Stephanos scheduled tasks use the windowless script host', async () => {
  for (const installerPath of installerPaths) {
    const source = await readFile(installerPath, 'utf8');
    assert.match(source, /New-ScheduledTaskAction -Execute \$wscriptExe/);
    assert.match(source, /run-stephanos-scheduled-task-windowless\.vbs/);
    assert.match(source, /\/\/B \/\/NoLogo/);
    assert.match(source, /-LogonType Interactive -RunLevel Limited/);
    assert.doesNotMatch(source, /New-ScheduledTaskAction -Execute \$(?:node|nodeExe|npm)/);
  }
});

test('windowless launcher accepts only fixed task identities and never allocates a console', async () => {
  const source = await readFile(windowlessLauncherPath, 'utf8');
  for (const taskId of ['worker-watchdog', 'github-sync', 'github-command-mailbox', 'mission-worker', 'backend', 'openclaw-gateway']) {
    assert.match(source, new RegExp(`Case "${taskId}"`));
  }
  assert.match(source, /Select Case taskId/);
  assert.match(source, /Case Else\s+WScript\.Quit 2/);
  assert.match(source, /shell\.Run\(command, 0, True\)/);
  assert.doesNotMatch(source, /cmd\.exe|Invoke-Expression|WScript\.Arguments\(1\)/i);
});
