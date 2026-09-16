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

test('adapter admits exactly two new bounded desktop-bootstrap request identities', async () => {
  const source = await readFile(adapterUrl, 'utf8');

  assert.match(source, /'forge-wsl2-desktop-bootstrap-authorized-20260916-v1'/);
  assert.match(source, /'forge-wsl2-desktop-receipt-authorized-20260916-v1'/);
  assert.match(source, /WSL2_SCRIPT_RELATIVE_PATH = 'scripts\/windows\/forge-wsl2-desktop-bootstrap-v1\.ps1'/);
  assert.match(source, /'FORGE_WSL2_OPERATOR_DESKTOP_LAUNCH_REQUIRED'/);
  assert.doesNotMatch(source, /forge-wsl2-desktop-\*/);
});
