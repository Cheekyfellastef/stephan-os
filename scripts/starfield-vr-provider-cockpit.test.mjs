import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const splashUrl = new URL('./windows/launch-starfield-vr-with-splash.ps1', import.meta.url);

test('Starfield VR splash exposes bounded provider cockpit without auto-launch', async () => {
  const source = await readFile(splashUrl, 'utf8');

  assert.match(source, /CHOOSE YOUR VERIFIED VR ROUTE/);
  assert.match(source, /VorpX Baseline/);
  assert.match(source, /Mutar \/ OpenXR/);
  assert.match(source, /Hybrid \/ Stephanos VR/);
  assert.match(source, /LOCKED • COMPOSITE LAB/);

  assert.match(source, /\[string\]\$MutarProfilePath/);
  assert.match(source, /starfield-vr-launch-profile-mutar-openxr\.json/);
  assert.match(source, /Test-ProviderProfileConfigured -Path \$ProfilePath -Provider 'vorpx'/);
  assert.match(source, /Test-ProviderProfileConfigured -Path \$MutarProfilePath -Provider 'mutar-openxr'/);
  assert.match(source, /PACKAGE STAGED • PROFILE NOT CONFIGURED/);
  assert.match(source, /\$hybridButton\.Enabled = \$false/);

  assert.match(source, /Start-ProviderRoute -Provider 'vorpx' -SelectedProfilePath \$ProfilePath/);
  assert.match(source, /Start-ProviderRoute -Provider 'mutar-openxr' -SelectedProfilePath \$MutarProfilePath/);
  assert.match(source, /Start-StarfieldVrLauncherProcess -SelectedProfilePath \$processState\.ProfilePath -ReadinessOnly/);
  assert.match(source, /Start-StarfieldVrLauncherProcess -SelectedProfilePath \$processState\.ProfilePath/);

  assert.match(source, /starfield-vr-provider-preference\.json/);
  assert.match(source, /stephanos\.starfield-vr-provider-preference\.v1/);
  assert.match(source, /\[System\.IO\.File\]::WriteAllText/);
  assert.match(source, /return \$true/);
  assert.match(source, /catch \{\s*return \$false/s);
  assert.match(source, /\$preferenceSaved = Write-ProviderPreference/);
  assert.match(source, /provider preference could not be saved; launch is continuing/);

  assert.doesNotMatch(source, /\$form\.Add_Shown\(\{\s*Start-ReadinessCheck/);
  assert.match(source, /Nothing launches until you choose a route\./);
  assert.doesNotMatch(source, /EXPERIMENTAL • READY|VorpX Baseline[^\n]*VERIFIED/);
  assert.doesNotMatch(source, /Copy-Item|Invoke-WebRequest|Expand-Archive|Start-BitsTransfer/i);
  assert.doesNotMatch(source, /Start-Process\s+-FilePath\s+.*Starfield|sfse_loader\.exe|dxgi\.dll/i);
});
