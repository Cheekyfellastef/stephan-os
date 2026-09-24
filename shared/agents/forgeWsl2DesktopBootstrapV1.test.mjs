import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const wrapperUrl = new URL('../../scripts/windows/forge-wsl2-desktop-bootstrap-v1.ps1', import.meta.url);
const elevationUrl = new URL('../../scripts/windows/enable-forge-wsl2-prerequisite-v1.ps1', import.meta.url);
const adapterUrl = new URL('./forgeShadowBattleBridgeAdapterV1.mjs', import.meta.url);

test('Forge WSL2 headless path creates only a fixed desktop bootstrap launcher', async () => {
  const source = await readFile(wrapperUrl, 'utf8');

  assert.match(source, /\$ElevationScriptRelativePath = 'scripts\/windows\/enable-forge-wsl2-prerequisite-v1\.ps1'/);
  assert.match(source, /\$LauncherName = 'Stephanos Forge WSL2 Bootstrap\.cmd'/);
  assert.match(source, /\[Environment\]::GetFolderPath\('Desktop'\)/);
  assert.match(source, /-OperatorApproved -VisibleElevationBroker/);
  assert.match(source, /FORGE_WSL2_OPERATOR_DESKTOP_LAUNCH_REQUIRED/);
  assert.match(source, /Consume-ElevatedReceipt/);
  assert.doesNotMatch(source, /Consume-ElevatedReceipt\s*\|\s*Out-Null/);
  assert.match(source, /\[System\.IO\.FileMode\]::CreateNew/);
  assert.match(source, /\[System\.IO\.FileShare\]::Read/);
  assert.match(source, /\$LauncherGuardWindowSeconds = 15 \* 60/);
  assert.match(source, /Test-Path -LiteralPath \$ReceiptPath -PathType Leaf/);
  assert.match(source, /\$launcherHandle\.Dispose\(\)/);
  assert.match(source, /Remove-Item -LiteralPath \$LauncherPath -Force/);
  assert.doesNotMatch(source, /Set-Content -LiteralPath \$LauncherPath/);
  assert.doesNotMatch(source, /-Verb\s+RunAs/);
  assert.doesNotMatch(source, /Restart-Computer|shutdown\.exe|Invoke-Expression|ScriptBlock::Create/i);
});

test('desktop launcher delegates elevation only to the already-reviewed source-controlled script', async () => {
  const wrapper = await readFile(wrapperUrl, 'utf8');
  const elevation = await readFile(elevationUrl, 'utf8');

  assert.match(wrapper, /git\.exe'|Git\\cmd\\git\.exe/);
  assert.match(wrapper, /hash-object/);
  assert.match(wrapper, /WSL2_PREREQUISITE_SCRIPT_IDENTITY_MISMATCH/);
  assert.match(elevation, /if \(\$VisibleElevationBroker -and -not \$ElevatedChild\)/);
  assert.match(elevation, /Start-Process -FilePath \$PowerShellExe -ArgumentList \$arguments -Verb RunAs -Wait -PassThru/);
});

test('adapter admits exactly three new bounded desktop-bootstrap continuation identities', async () => {
  const source = await readFile(adapterUrl, 'utf8');

  assert.match(source, /'forge-wsl2-desktop-bootstrap-authorized-20260916-v1'/);
  assert.match(source, /'forge-wsl2-desktop-receipt-authorized-20260916-v1'/);
  assert.match(source, /'forge-wsl2-desktop-postreboot-authorized-20260916-v1'/);
  assert.match(source, /WSL2_SCRIPT_RELATIVE_PATH = 'scripts\/windows\/forge-wsl2-desktop-bootstrap-v1\.ps1'/);
  assert.match(source, /'FORGE_WSL2_OPERATOR_DESKTOP_LAUNCH_REQUIRED'/);
  assert.doesNotMatch(source, /forge-wsl2-desktop-\*/);
});


test('desktop launcher lock is bounded and receipt output remains observable by the adapter', async () => {
  const source = await readFile(wrapperUrl, 'utf8');

  const open = source.indexOf('[System.IO.File]::Open(');
  const share = source.indexOf('[System.IO.FileShare]::Read', open);
  const wait = source.indexOf('while ([DateTime]::UtcNow -lt $deadline', share);
  const dispose = source.indexOf('$launcherHandle.Dispose()', wait);
  const consume = source.lastIndexOf('Consume-ElevatedReceipt');

  assert.ok(open >= 0);
  assert.ok(share > open);
  assert.ok(wait > share);
  assert.ok(dispose > wait);
  assert.ok(consume > dispose);
  assert.match(source, /launcherGuardWindowExpired = \$true/);
});
