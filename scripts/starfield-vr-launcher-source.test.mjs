import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const launcherUrl = new URL('./windows/launch-starfield-vr.ps1', import.meta.url);
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

test('installer creates exactly one current-user shortcut named Starfield VR', async () => {
  const source = await readFile(installerUrl, 'utf8');
  assert.match(source, /\[Environment\]::GetFolderPath\(\[Environment\+SpecialFolder\]::Desktop\)/);
  assert.match(source, /Join-Path \$desktopPath 'Starfield VR\.lnk'/);
  assert.match(source, /New-Object -ComObject WScript\.Shell/);
  assert.match(source, /SupportsShouldProcess = \$true/);
  assert.match(source, /-WindowStyle Hidden/);
  assert.doesNotMatch(source, /AllUsersDesktop|Public\\Desktop|RunAs|Verb\s*=\s*'runas'/i);
});

test('package scripts expose installation readiness and focused regression checks', async () => {
  const pkg = JSON.parse(await readFile(packageUrl, 'utf8'));
  assert.match(pkg.scripts['starfield-vr:install-shortcut'], /install-starfield-vr-desktop-shortcut\.ps1/);
  assert.match(pkg.scripts['starfield-vr:status'], /launch-starfield-vr\.ps1 -ReadinessOnly/);
  assert.match(pkg.scripts['starfield-vr:test'], /starfieldVrLaunchPolicy\.test\.mjs/);
  assert.match(pkg.scripts['starfield-vr:test'], /starfield-vr-launcher-source\.test\.mjs/);
});
