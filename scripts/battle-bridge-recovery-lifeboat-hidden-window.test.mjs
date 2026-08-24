import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const installerUrl = new URL('./windows/install-battle-bridge-recovery-lifeboat-v1.ps1', import.meta.url);
const launcherUrl = new URL('./windows/run-battle-bridge-recovery-lifeboat-windowless-v2.vbs', import.meta.url);

test('Battle Bridge Recovery Lifeboat scheduled task has no direct PowerShell console launch', async () => {
  const installer = await readFile(installerUrl, 'utf8');
  const launcher = await readFile(launcherUrl, 'utf8');

  assert.match(installer, /\$wscriptExe = 'C:\\\\Windows\\\\System32\\\\wscript\.exe'/);
  assert.match(
    installer,
    /New-ScheduledTaskAction -Execute \$wscriptExe -Argument "\/\/B \/\/Nologo `\\"\$installedWindowlessLauncher`\\""/,
  );
  assert.match(installer, /directPowerShellTaskLaunch = \$false/);
  assert.doesNotMatch(installer, /New-ScheduledTaskAction -Execute \$powershellExe/);
  assert.doesNotMatch(installer, /-WindowStyle Hidden/);

  assert.match(launcher, /CreateObject\("WScript\.Shell"\)/);
  assert.match(launcher, /shell\.Run\(command, 0, True\)/);
  assert.match(launcher, /run-battle-bridge-recovery-lifeboat-active-v1\.ps1/);
  assert.doesNotMatch(launcher, /WScript\.Arguments/);
});
