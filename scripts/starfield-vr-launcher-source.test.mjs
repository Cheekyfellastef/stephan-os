import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const launcherUrl = new URL('./windows/launch-starfield-vr.ps1', import.meta.url);
const splashUrl = new URL('./windows/launch-starfield-vr-with-splash.ps1', import.meta.url);
const installerUrl = new URL('./windows/install-starfield-vr-desktop-shortcut.ps1', import.meta.url);
const packageUrl = new URL('../package.json', import.meta.url);

test('launcher delegates authority to the canonical shared decision policy', async () => {
  const source = await readFile(launcherUrl, 'utf8');
  assert.match(source, /scripts\\starfield-vr-launch-decision\.mjs/);
  assert.match(source, /Get-FileHash[\s\S]*?-Algorithm SHA256/);
  assert.match(source, /Get-ItemPropertyValue[\s\S]*?Khronos\\OpenXR\\1[\s\S]*?ActiveRuntime/);
  assert.match(source, /Get-Process -Name 'OculusDash'/);
  assert.match(source, /if \(-not \$decision\.ok\)[\s\S]*?STARFIELD_VR_LAUNCH_BLOCKED/);
  assert.match(source, /Nothing was changed and flat Starfield was not started/);
});

test('launcher is launch-only and cannot install or download a VR mod', async () => {
  const source = await readFile(launcherUrl, 'utf8');
  assert.doesNotMatch(source, /Invoke-WebRequest|Start-BitsTransfer|Expand-Archive|Copy-Item|Set-ItemProperty/i);
  assert.doesNotMatch(source, /git\s+(reset|clean|checkout)|Remove-Item\s+.*Starfield/i);
  assert.match(source, /LAUNCH_VORPX/);
  assert.match(source, /Start-Process -FilePath \$launchExecutable -WorkingDirectory \$workingDirectory -PassThru/);
});

test('splash is presentation-only and delegates readiness plus launch to the canonical launcher', async () => {
  const source = await readFile(splashUrl, 'utf8');
  assert.match(source, /Add-Type -AssemblyName System\.Windows\.Forms/);
  assert.match(source, /STARFIELD VR/);
  assert.match(source, /Preparing Starfield VR/);
  assert.match(source, /Checking Quest 3 route/);
  assert.match(source, /Checking Meta Air Link/);
  assert.match(source, /Checking OpenXR runtime/);
  assert.match(source, /Checking verified VR provider/);
  assert.match(source, /Ready to launch/);
  assert.match(source, /Launching Starfield VR/);
  assert.match(source, /Invoke-StarfieldVrLauncher -ReadinessOnly/);
  assert.match(source, /Invoke-StarfieldVrLauncher/);
  assert.match(source, /STARFIELD_VR_LAUNCH_READY/);
  assert.match(source, /Flat Starfield was not started/);
  assert.match(source, /Show details/);
  assert.match(source, /Cancel/);
  assert.doesNotMatch(source, /Invoke-WebRequest|Start-BitsTransfer|Expand-Archive|Copy-Item|Set-ItemProperty/i);
  assert.doesNotMatch(source, /Start-Process\s+-FilePath\s+.*Starfield|sfse_loader\.exe|dxgi\.dll/i);
});

test('installer creates exactly one current-user shortcut named Starfield VR through the splash wrapper', async () => {
  const source = await readFile(installerUrl, 'utf8');
  assert.match(source, /\[Environment\]::GetFolderPath\(\[Environment\+SpecialFolder\]::Desktop\)/);
  assert.match(source, /Join-Path \$desktopPath 'Starfield VR\.lnk'/);
  assert.match(source, /launch-starfield-vr-with-splash\.ps1/);
  assert.match(source, /\$arguments = [\s\S]*\$splashLauncherScript/);
  assert.match(source, /New-Object -ComObject WScript\.Shell/);
  assert.match(source, /SupportsShouldProcess = \$true/);
  assert.match(source, /-WindowStyle Hidden/);
  assert.match(source, /splashLauncherScript = \$splashLauncherScript/);
  assert.doesNotMatch(source, /AllUsersDesktop|Public\\Desktop|RunAs|Verb\s*=\s*'runas'/i);
});

test('package scripts expose installation readiness and focused regression checks', async () => {
  const pkg = JSON.parse(await readFile(packageUrl, 'utf8'));
  assert.match(pkg.scripts['starfield-vr:install-shortcut'], /install-starfield-vr-desktop-shortcut\.ps1/);
  assert.match(pkg.scripts['starfield-vr:status'], /launch-starfield-vr\.ps1 -ReadinessOnly/);
  assert.match(pkg.scripts['starfield-vr:test'], /starfieldVrLaunchPolicy\.test\.mjs/);
  assert.match(pkg.scripts['starfield-vr:test'], /starfield-vr-launcher-source\.test\.mjs/);
});
