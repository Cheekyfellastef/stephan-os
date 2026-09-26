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
  assert.match(source, /Status = 'LOCKED'/);
  assert.match(source, /function New-ProviderCard/);
  assert.match(source, /\$titleLabel\.Font = New-Object System\.Drawing\.Font\(\$fontFamily, 12/);
  assert.match(source, /\$statusLabel\.Font = New-Object System\.Drawing\.Font\(\$fontFamily, 9/);
  assert.match(source, /\$button\.Font = New-Object System\.Drawing\.Font\(\$fontFamily, 9\.5/);
  assert.match(source, /ActionText = 'Launch VorpX'/);
  assert.match(source, /\$mutarAction = 'Needs profile'/);
  assert.match(source, /ActionText = 'Composite lab unavailable'/);
  assert.match(source, /\$form\.AllowTransparency = \$false/);\n  assert.match(source, /\$form\.Opacity = 1\.0/);
  assert.match(source, /\$statusPanel\.BackColor = \[System\.Drawing\.Color\]::FromArgb\(10, 21, 36\)/);
  assert.match(source, /\$panel\.Size = New-Object System\.Drawing\.Size\(280, 126\)/);
  assert.match(source, /\$button\.Location = New-Object System\.Drawing\.Point\(16, 84\)/);

  assert.match(source, /\[string\]\$MutarProfilePath/);
  assert.match(source, /starfield-vr-launch-profile-mutar-openxr\.json/);
  assert.match(source, /Test-ProviderProfileConfigured -Path \$ProfilePath -Provider 'vorpx'/);
  assert.match(source, /Test-ProviderProfileConfigured -Path \$MutarProfilePath -Provider 'mutar-openxr'/);
  assert.match(source, /\$mutarStatus = 'STAGED'/);
  assert.match(source, /Title = 'Hybrid \/ Stephanos VR'[\s\S]*?Enabled = \$false/);

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
