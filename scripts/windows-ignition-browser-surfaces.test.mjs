import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const launcherCmd = new URL('../windows/Launch-Stephanos-Local.cmd', import.meta.url);
const launcherPs1 = new URL('../windows/Launch-Stephanos-Local.ps1', import.meta.url);
const aiCoreHtml = new URL('../stephanos-ui/index.html', import.meta.url);

test('desktop ignition enters the complete existing launcher-root cockpit flow', async () => {
  const cmd = await readFile(launcherCmd, 'utf8');
  assert.match(cmd, /Launch-Stephanos-Local\.ps1/);
  assert.match(cmd, /-Mode launcher-root -BootMode cockpit/);
  assert.doesNotMatch(cmd, /Launch-Stephanos-Ignition\.ps1/);
});

test('cockpit mode preserves splash, landing page, and AI Core browser surfaces', async () => {
  const script = await readFile(launcherPs1, 'utf8');
  assert.match(script, /Show-IgnitionSplashScreen/);
  assert.match(script, /launcher\s*=\s*\[ordered\]@\{ Label = 'launcher'; Url = \$launcherShellUrl \}/);
  assert.match(script, /runtime\s*=\s*\[ordered\]@\{ Label = 'runtime'; Url = \$launcherRuntimeUrl \}/);
  assert.match(script, /'cockpit' \{ return @\(\$surfaceMap\.launcher, \$surfaceMap\.runtime\) \}/);
  assert.match(script, /Open-CockpitSurface -Url \$surface\.Url -Label \$surface\.Label/);
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
