import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const installerUrl = new URL('./windows/install-desktop-commander-watchdog.ps1', import.meta.url);
const runnerUrl = new URL('./windows/run-desktop-commander-watchdog-hidden.ps1', import.meta.url);
const launcherUrl = new URL('./windows/run-stephanos-scheduled-task-windowless.vbs', import.meta.url);

test('Commander watchdog is fixed, hidden, limited and does not install packages from the network', async () => {
  const [installer, runner, launcher] = await Promise.all([
    readFile(installerUrl, 'utf8'),
    readFile(runnerUrl, 'utf8'),
    readFile(launcherUrl, 'utf8'),
  ]);

  assert.match(installer, /Stephanos Commander Watchdog/);
  assert.match(installer, /desktop-commander-watchdog/);
  assert.match(installer, /RepetitionInterval \(New-TimeSpan -Minutes 1\)/);
  assert.match(installer, /RunLevel Limited/);
  assert.match(installer, /MultipleInstances IgnoreNew/);
  assert.match(installer, /networkInstallAllowed = \$false/);
  assert.match(installer, /pcRestartAllowed = \$false/);
  assert.match(installer, /headlessLauncher = \$true/);

  assert.match(runner, /\$requiredVersion = '0\.2\.51'/);
  assert.match(runner, /@wonderwhy-er\/desktop-commander/);
  assert.match(runner, /dist\\index\.js/);
  assert.match(runner, /ArgumentList @\(\$quotedIndex, 'remote'\)/);
  assert.match(runner, /-WindowStyle Hidden/);
  assert.match(runner, /networkInstallAllowed = \$false/);
  assert.match(runner, /packageMutationAllowed = \$false/);
  assert.match(runner, /unrelatedProcessRestartAllowed = \$false/);
  assert.match(runner, /pcRestartAllowed = \$false/);
  assert.doesNotMatch(runner, /npm\s+install|npx\s|Invoke-WebRequest|Invoke-RestMethod|Restart-Computer|shutdown\.exe/i);

  assert.match(launcher, /Case "desktop-commander-watchdog"/);
  assert.match(launcher, /run-desktop-commander-watchdog-hidden\.ps1/);
  assert.match(launcher, /shell\.Run\(command, 0, True\)/);
});
