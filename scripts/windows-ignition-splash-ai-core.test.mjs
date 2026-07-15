import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ignitionScript = new URL('../windows/Launch-Stephanos-Ignition.ps1', import.meta.url);
const launcherCmd = new URL('../windows/Launch-Stephanos-Local.cmd', import.meta.url);

test('desktop ignition routes through splash launcher', async () => {
  const cmd = await readFile(launcherCmd, 'utf8');
  assert.match(cmd, /Launch-Stephanos-Ignition\.ps1/);
  assert.match(cmd, /Starting splash-driven Stephanos ignition/);
});

test('ignition opens splash before starting runtime surfaces', async () => {
  const script = await readFile(ignitionScript, 'utf8');
  const splashIndex = script.indexOf("Start-Process -FilePath $script:splashPath");
  const coreIndex = script.indexOf("Start-StephanosPowerShellWindow -Title 'Stephanos AI Core'");
  const runtimeIndex = script.indexOf("Start-StephanosPowerShellWindow -Title 'Stephanos Runtime'");
  assert.ok(splashIndex >= 0);
  assert.ok(coreIndex > splashIndex);
  assert.ok(runtimeIndex > coreIndex);
});

test('AI Core uses its own visible PowerShell window', async () => {
  const script = await readFile(ignitionScript, 'utf8');
  assert.match(script, /Start-StephanosPowerShellWindow -Title 'Stephanos AI Core' -Command 'npm --prefix stephanos-server run dev' -WindowStyle Normal/);
  assert.match(script, /AppActivate\('Stephanos AI Core'\)/);
});

test('runtime uses canonical launcher-root build and serve command', async () => {
  const script = await readFile(ignitionScript, 'utf8');
  assert.match(script, /Start-StephanosPowerShellWindow -Title 'Stephanos Runtime' -Command 'npm run stephanos:ignite:launcher-root' -WindowStyle Minimized/);
});

test('browser opens only after exact-head proof', async () => {
  const script = await readFile(ignitionScript, 'utf8');
  const proofIndex = script.indexOf('if ([string]$uiHealth.gitCommit -ne $head)');
  const openIndex = script.indexOf('Start-Process -FilePath $stephanosUrl');
  assert.ok(proofIndex >= 0);
  assert.ok(openIndex > proofIndex);
  assert.match(script, /Stephanos is ready\. The AI Core console and Stephanos are both open\./);
});
