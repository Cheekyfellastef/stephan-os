import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const launcher = readFileSync(
  new URL('../scripts/windows/launch-stephanos-spatial-workspace.ps1', import.meta.url),
  'utf8'
);
const installer = readFileSync(
  new URL('../scripts/windows/install-stephanos-spatial-workspace-shortcut.ps1', import.meta.url),
  'utf8'
);
const ignitionHelper = readFileSync(
  new URL('../windows/Invoke-Stephanos-Ignite-With-Approval.ps1', import.meta.url),
  'utf8'
);

test('Spatial Workspace launcher opens only the trusted local route', () => {
  assert.match(launcher, /http:\/\/127\.0\.0\.1:4173\/apps\/spatial-bridge\/quest-entry\.html/);
  assert.match(launcher, /StartsWith\('http:\/\/127\.0\.0\.1:4173\/'\)/);
  assert.match(launcher, /Stephanos Spatial Workspace/);
  assert.match(launcher, /Test-SpatialWorkspaceRoute/);
  assert.match(launcher, /Invoke-Stephanos-Ignite-With-Approval\.ps1/);
  assert.match(launcher, /AddSeconds\(300\)/);
  assert.match(launcher, /return \$process/);
  assert.match(launcher, /\.HasExited/);
  assert.match(launcher, /ExitCode -ne 0/);
  assert.match(launcher, /battle-bridge-ignition-supervisor-current\.json/);
  assert.match(launcher, /Get-FreshBattleBridgeSupervisorBlocker/);
  assert.match(launcher, /blockerId/);
  assert.match(launcher, /generatedAt/);
  assert.doesNotMatch(launcher, /Local\\Stephanos-Battle-Bridge-Ignition/);
  assert.doesNotMatch(launcher, /WaitOne\(/);

  assert.match(ignitionHelper, /Local\\Stephanos-Battle-Bridge-Ignition/);
  assert.match(ignitionHelper, /WaitOne\(0\)/);
  assert.match(ignitionHelper, /canonical ignition already in progress; coalescing this request/);
  assert.doesNotMatch(ignitionHelper, /Read-Host/);
  assert.match(ignitionHelper, /lease is never held open for console input/);
  assert.match(ignitionHelper, /ReleaseMutex\(\)/);
});

test('Spatial Workspace ignition stays hidden while the browser remains visible', () => {
  assert.match(launcher, /CreateNoWindow = \$true/);
  assert.match(launcher, /powershellExecutable/);
  assert.match(launcher, /-NonInteractive/);
  assert.match(launcher, /--new-window/);
  assert.doesNotMatch(launcher, /Launch-Stephanos-Local\.cmd/);
  assert.doesNotMatch(launcher, /WindowStyle\s*=\s*['"]Normal['"]/i);
  assert.doesNotMatch(launcher, /runtimeReady\s*=\s*\$true/);
  assert.match(launcher, /workspaceRouteReady\s*=\s*\$true/);
  assert.match(launcher, /canonical Battle Bridge health not asserted/);
  assert.match(launcher, /\$browserCandidates = @\(\r?\n\s+@\(/);
  assert.match(launcher, /Where-Object \{ \$_ -and \(Test-Path/);
});

test('desktop shortcut has the requested identity and hidden PowerShell target', () => {
  assert.match(installer, /Stephanos Spatial Workspace\.lnk/);
  assert.match(installer, /WindowStyle Hidden/);
  assert.match(installer, /launch-stephanos-spatial-workspace\.ps1/);
  assert.match(installer, /SPATIAL_WORKSPACE_SHORTCUT_READY/);
});
