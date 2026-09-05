import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const launcherCmd = new URL('../windows/Launch-Stephanos-Local.cmd', import.meta.url);
const launcherPs1 = new URL('../windows/Launch-Stephanos-Local.ps1', import.meta.url);
const aiCoreHtml = new URL('../stephanos-ui/index.html', import.meta.url);
const packageJson = new URL('../package.json', import.meta.url);
const ignitionEntry = new URL('./run-battle-bridge-ignition.mjs', import.meta.url);

test('desktop ignition enters the complete existing launcher-root cockpit flow', async () => {
  const cmd = await readFile(launcherCmd, 'utf8');
  assert.match(cmd, /Launch-Stephanos-Local\.ps1/);
  assert.match(cmd, /-Mode launcher-root -BootMode cockpit/);
  assert.doesNotMatch(cmd, /Launch-Stephanos-Ignition\.ps1/);
});

test('cockpit mode preserves splash, landing page, and AI Core browser surfaces', async () => {
  const script = await readFile(launcherPs1, 'utf8');
  assert.match(script, /Show-IgnitionSplashScreen/);
  assert.match(script, /Get-StephanosBrowserSurfaceDefinition -Id 'launcher' -Label 'launcher' -Url \$launcherShellUrl -ExpectedTitle 'Stephanos OS'/);
  assert.match(script, /Get-StephanosBrowserSurfaceDefinition -Id 'runtime' -Label 'runtime' -Url \$launcherRuntimeUrl -ExpectedTitle 'Stephanos AI Core'/);
  assert.match(script, /'cockpit' \{ return @\(\$surfaceMap\.launcher, \$surfaceMap\.runtime\) \}/);
  assert.match(script, /Open-CockpitSurface -Url \$surface\.Url -Label \$surface\.Label -Id \$surface\.Id -ExpectedTitle \$surface\.ExpectedTitle/);
});

test('repeat ignition presses reuse exact verified Edge app windows instead of duplicating cockpit surfaces', async () => {
  const script = await readFile(launcherPs1, 'utf8');
  assert.match(script, /stephanos\.ignition-browser-surface-receipt\.v1/);
  assert.match(script, /fixed-per-surface-profile/);
  assert.match(script, /Local\\Stephanos-Ignition-Browser-Surface-\$Id/);
  assert.match(script, /Get-VerifiedEdgeAppSurface -Surface \$Surface -EdgeExecutable \$edgeExecutable/);
  assert.match(script, /reused-existing-window/);
  assert.match(script, /opened-new-window/);
  assert.match(script, /--app=\$\(\$Surface\.Url\)/);
  assert.match(script, /--user-data-dir=/);
  assert.match(script, /GetVisibleTopLevelWindows\(\[int\]\$candidate\.ProcessId\)/);
  assert.match(script, /GetWindowThreadProcessId/);
  assert.match(script, /IsWindowVisible/);
  assert.match(script, /\[string\]\$_\.Title, \[string\]\$Surface\.ExpectedTitle/);
  assert.match(script, /windowHandle = \[int64\]\$surfaceWindow\.Handle/);
  assert.doesNotMatch(script, /\$process\.MainWindowHandle/);
  assert.doesNotMatch(script, /\$process\.MainWindowTitle/);
  assert.match(script, /arbitraryBrowserExecutableAllowed = \$false/);
});

test('ignition truth files use one BOM-free UTF-8 persistence boundary', async () => {
  const script = await readFile(launcherPs1, 'utf8');
  assert.match(script, /function Write-IgnitionUtf8NoBomText[\s\S]*?UTF8Encoding\(\$false\)[\s\S]*?\[System\.IO\.File\]::WriteAllText\(\$Path, \$Value, \$encoding\)/);
  assert.match(script, /function Add-IgnitionUtf8NoBomLine[\s\S]*?UTF8Encoding\(\$false\)[\s\S]*?\[System\.IO\.File\]::AppendAllText/);
  assert.match(script, /function Write-IgnitionJson[\s\S]*?Write-IgnitionUtf8NoBomText/);
  assert.match(script, /Write-IgnitionJson -Path \$ignitionStatusPath -Value \$supervisorStatus -Depth 12/);
  assert.match(script, /Write-IgnitionJson -Path \$ignitionStatusPath -Value \$payload -Depth 8/);
  assert.match(script, /Write-IgnitionJson -Path \$ignitionBrowserSurfaceReceiptPath -Value \$browserSurfaceProjection -Depth 8/);
  assert.match(script, /Write-IgnitionJson -Path \$ignitionSupportSnapshotPath -Value \$snapshot -Depth 10/);
  assert.match(script, /Add-IgnitionUtf8NoBomLine -Path \$ignitionTranscriptPath/);
  assert.doesNotMatch(script, /Set-Content -LiteralPath \$ignition(?:Status|BrowserSurfaceReceipt|SupportSnapshot)Path -Encoding UTF8/);
  assert.doesNotMatch(script, /Add-Content -LiteralPath \$ignitionTranscriptPath -Encoding UTF8/);
});

test('the built runtime browser surface is Stephanos AI Core', async () => {
  const html = await readFile(aiCoreHtml, 'utf8');
  assert.match(html, /<title>Stephanos AI Core<\/title>/);
});

test('AI Core remains a browser surface rather than a dedicated PowerShell console', async () => {
  const cmd = await readFile(launcherCmd, 'utf8');
  const script = await readFile(launcherPs1, 'utf8');
  assert.doesNotMatch(cmd, /visible AI Core window/i);
  assert.doesNotMatch(script, /WindowTitle\s*=\s*'Stephanos AI Core'/);
});

test('Windows ignition preflights only backend 8787 before entering the full supervisor', async () => {
  const pkg = JSON.parse(await readFile(packageJson, 'utf8'));
  const entry = await readFile(ignitionEntry, 'utf8');

  assert.equal(pkg.scripts['stephanos:ignite'], 'node scripts/run-battle-bridge-ignition.mjs');
  assert.equal(pkg.scripts['stephanos:ignite:supervisor'], 'node scripts/battle-bridge-ignition-supervisor.mjs');
  assert.match(entry, /backend-8787-preflight/);
  assert.match(entry, /start-stephanos-backend\.ps1/);
  assert.match(entry, /battle-bridge-ignition-supervisor\.mjs/);
  assert.match(entry, /process\.argv\.slice\(2\)/);
  assert.doesNotMatch(entry, /repair-stephanos-battle-bridge\.ps1/);
  assert.doesNotMatch(entry, /tailscale/i);
});
