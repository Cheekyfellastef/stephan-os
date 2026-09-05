import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const installerUrl = new URL('./windows/install-battle-bridge-recovery-lifeboat-v1.ps1', import.meta.url);
const launcherUrl = new URL('./windows/run-battle-bridge-recovery-lifeboat-windowless-v2.vbs', import.meta.url);

test('Battle Bridge Recovery Lifeboat scheduled task has no direct PowerShell console launch', async () => {
  const installer = await readFile(installerUrl, 'utf8');
  const launcher = await readFile(launcherUrl, 'utf8');

  assert.match(installer, /\$wscriptExe = 'C:\\Windows\\System32\\wscript\.exe'/);
  assert.match(
    installer,
    /New-ScheduledTaskAction -Execute \$wscriptExe -Argument "\/\/B \/\/Nologo `"\$installedWindowlessLauncher`""/,
  );
  assert.match(installer, /directPowerShellTaskLaunch = \$false/);
  assert.doesNotMatch(installer, /New-ScheduledTaskAction -Execute \$powershellExe/);
  assert.doesNotMatch(installer, /-WindowStyle Hidden/);

  assert.match(launcher, /CreateObject\("WScript\.Shell"\)/);
  assert.match(launcher, /shell\.Run\(command, 0, True\)/);
  assert.match(launcher, /run-battle-bridge-recovery-lifeboat-active-v1\.ps1/);
  assert.doesNotMatch(launcher, /WScript\.Arguments/);
});

test('already-current healthy Lifeboat reinstall is a proved idempotent success', async () => {
  const installer = await readFile(installerUrl, 'utf8');

  assert.doesNotMatch(installer, /Candidate lifeboat bank is not distinct from the active known-good bank/);
  assert.match(installer, /function Assert-ActivePayloadManifest/);
  assert.match(installer, /active manifest file does not match active state/);
  assert.match(installer, /Read-FreshHealthyHeartbeat -BankId \$activeBank -ExpectedManifest/);
  assert.match(installer, /Assert-ActivePayloadManifest -BankId \$activeBank -ExpectedManifest/);

  assert.match(installer, /function Assert-CanonicalScheduledTask/);
  assert.match(installer, /Get-ScheduledTask -TaskName \$taskName -ErrorAction Stop/);
  assert.match(installer, /\$actions\.Count -ne 1/);
  assert.match(installer, /\$actions\[0\]\.Execute -ne \$wscriptExe/);
  assert.match(installer, /\$actions\[0\]\.Arguments -ne \$expectedArguments/);
  assert.match(installer, /\$task\.Principal\.UserId -ne \$CurrentUser/);
  assert.match(installer, /\$task\.Principal\.LogonType -ne 'Interactive'/);
  assert.match(installer, /\$task\.Principal\.RunLevel -ne 'Limited'/);

  const branchStart = installer.indexOf('if ($null -ne $activeState -and $manifestSha256 -eq [string]$activeState.manifestSha256) {');
  const branchEnd = installer.indexOf('\n$targetRoot = Join-Path $banksRoot $targetBank', branchStart);
  assert.ok(branchStart >= 0 && branchEnd > branchStart, 'same-manifest branch must be bounded before candidate promotion');
  const sameManifestBranch = installer.slice(branchStart, branchEnd);
  assert.match(sameManifestBranch, /Assert-CanonicalScheduledTask -CurrentUser \$currentUser/);
  assert.match(sameManifestBranch, /Remove-Item -LiteralPath \$stageRoot -Recurse -Force/);
  assert.match(sameManifestBranch, /installDisposition = 'ALREADY_CURRENT_HEALTHY'/);
  assert.match(sameManifestBranch, /changed = \$false/);
  assert.match(sameManifestBranch, /activeBankAfter = \$activeBank/);
  assert.match(sameManifestBranch, /scheduledTaskIdentityReproved = \$true/);
  assert.match(sameManifestBranch, /if \(\$StartNow -and \$PSCmdlet\.ShouldProcess\(\$taskName, 'Start existing canonical Battle Bridge recovery lifeboat task'\)\)/);
  assert.match(sameManifestBranch, /return/);
  assert.doesNotMatch(sameManifestBranch, /Register-ScheduledTask/);
  assert.doesNotMatch(sameManifestBranch, /Write-AtomicJson/);

  assert.match(installer, /installDisposition = 'PROMOTED_CANDIDATE'/);
  assert.match(installer, /changed = \$true/);
  assert.match(installer, /activeBankOverwriteAllowed = \$false/);
  assert.match(installer, /dualBankOverwriteAllowed = \$false/);
  assert.match(installer, /arbitraryShellAllowed = \$false/);
  assert.match(installer, /gitMutationAllowed = \$false/);
  assert.match(installer, /sourceMutationAllowed = \$false/);
  assert.match(installer, /pcRestartAllowed = \$false/);
});
