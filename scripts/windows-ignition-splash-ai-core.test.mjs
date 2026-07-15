import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const wrapperScript = new URL('../windows/Launch-Stephanos-Ignition.ps1', import.meta.url);
const fullLauncherScript = new URL('../windows/Launch-Stephanos-Local.ps1', import.meta.url);
const launcherCmd = new URL('../windows/Launch-Stephanos-Local.cmd', import.meta.url);

test('desktop button routes through compatibility wrapper with canonical full launcher arguments', async () => {
  const cmd = await readFile(launcherCmd, 'utf8');
  assert.match(cmd, /Launch-Stephanos-Ignition\.ps1/);
  assert.match(cmd, /-Mode launcher-root -BootMode cockpit/);
  assert.match(cmd, /preserving the full launcher-root cockpit flow/);
});

test('wrapper preserves the established launcher parameter surface', async () => {
  const script = await readFile(wrapperScript, 'utf8');
  assert.match(script, /\[switch\]\$AutoOpen/);
  assert.match(script, /\[string\]\$Mode = 'launcher-root'/);
  assert.match(script, /\[string\]\$BootMode = 'cockpit'/);
  assert.match(script, /\[switch\]\$ReadinessReportOnly/);
  assert.match(script, /\[switch\]\$RepairMissingUi4173/);
  assert.match(script, /\[switch\]\$RepairDryRun/);
});

test('wrapper delegates to the full existing launcher instead of recreating a reduced ignition path', async () => {
  const script = await readFile(wrapperScript, 'utf8');
  assert.match(script, /windows\/Launch-Stephanos-Local\.ps1/);
  assert.match(script, /Delegating to the full existing Stephanos launcher\. No legacy ignition features are bypassed\./);
  assert.match(script, /& '\$escapedLauncher' -Mode '\$escapedMode' -BootMode '\$escapedBootMode'/);
  assert.doesNotMatch(script, /npm run stephanos:ignite:launcher-root/);
  assert.doesNotMatch(script, /Start-Process -FilePath \$stephanosUrl/);
});

test('full launcher remains the source of splash supervisor approval and cockpit behavior', async () => {
  const launcher = await readFile(fullLauncherScript, 'utf8');
  assert.match(launcher, /Show-IgnitionSplashScreen/);
  assert.match(launcher, /Invoke-Stephanos-Ignite-With-Approval\.ps1/);
  assert.match(launcher, /Wait-ForBattleBridgeSupervisorReady/);
  assert.match(launcher, /Get-CockpitSurfaces/);
  assert.match(launcher, /Write-IgnitionSupportSnapshot/);
});

test('visible AI Core starts only after the full launcher splash is observed', async () => {
  const script = await readFile(wrapperScript, 'utf8');
  const launcherIndex = script.indexOf('$launcherProcess = Start-FullLegacyLauncher');
  const splashIndex = script.indexOf('Wait-ForFullLauncherSplash');
  const coreIndex = script.indexOf('Ensure-VisibleAiCoreWindow');
  assert.ok(launcherIndex >= 0);
  assert.ok(splashIndex > launcherIndex);
  assert.ok(coreIndex > splashIndex);
  assert.match(script, /powershell\.exe'[\s\S]*?'-NoExit'[\s\S]*?Stephanos AI Core/);
  assert.match(script, /npm --prefix stephanos-server run dev/);
  assert.match(script, /api\/mission-operations/);
});

test('source updates trigger a visible AI Core restart from the updated worktree', async () => {
  const script = await readFile(wrapperScript, 'utf8');
  assert.match(script, /if \(\$headBefore -and \$headAfter -and \$headBefore -ne \$headAfter\)/);
  assert.match(script, /Ensure-VisibleAiCoreWindow -ForceRestart/);
});
