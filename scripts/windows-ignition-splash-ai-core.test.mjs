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

test('ignition opens splash before updating runtime and starts AI Core from updated source', async () => {
  const script = await readFile(ignitionScript, 'utf8');
  const splashIndex = script.indexOf("Start-Process -FilePath $script:splashPath");
  const runtimeIndex = script.indexOf("Start-StephanosPowerShellWindow -Title 'Stephanos Runtime'");
  const coreIndex = script.indexOf("Start-StephanosPowerShellWindow -Title 'Stephanos AI Core'");
  assert.ok(splashIndex >= 0);
  assert.ok(runtimeIndex > splashIndex);
  assert.ok(coreIndex > runtimeIndex);
});

test('AI Core uses its own visible PowerShell window', async () => {
  const script = await readFile(ignitionScript, 'utf8');
  assert.match(script, /Start-StephanosPowerShellWindow -Title 'Stephanos AI Core' -Command 'npm --prefix stephanos-server run dev' -WindowStyle Normal/);
  assert.match(script, /AppActivate\('Stephanos AI Core'\)/);
  assert.match(script, /Wait-ForWebEndpoint -Url \$backendMissionOperationsUrl/);
});

test('main uses canonical launcher-root lane and PR proof uses no-pull exact branch lane', async () => {
  const script = await readFile(ignitionScript, 'utf8');
  assert.match(script, /\[switch\]\$AllowProofBranch/);
  assert.match(script, /if \(\$branch -ne 'main' -and -not \$AllowProofBranch\.IsPresent\)/);
  assert.match(script, /'npm run stephanos:ignite:launcher-root'/);
  assert.match(script, /'npm run stephanos:serve -- --skip-auto-pull'/);
  assert.match(script, /Start-StephanosPowerShellWindow -Title 'Stephanos Runtime' -Command \$runtimeCommand -WindowStyle Minimized/);
});

test('browser opens only after exact-head proof', async () => {
  const script = await readFile(ignitionScript, 'utf8');
  const proofIndex = script.indexOf('if ($servedCommit -ne $head)');
  const openIndex = script.indexOf('Start-Process -FilePath $stephanosUrl');
  assert.ok(proofIndex >= 0);
  assert.ok(openIndex > proofIndex);
  assert.match(script, /Stephanos is ready\. The AI Core console and Stephanos are both open\./);
});
