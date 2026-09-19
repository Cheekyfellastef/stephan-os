import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (relative) => readFile(new URL(relative, import.meta.url), 'utf8');

test('windowless launcher exposes exactly the fixed monitor-multiplexer task id', async () => {
  const source = await read('../../scripts/windows/run-stephanos-scheduled-task-windowless.vbs');
  assert.match(source, /Case "monitor-multiplexer"/);
  assert.match(source, /run-battle-bridge-monitor-multiplexer-hidden\.ps1/);
  assert.doesNotMatch(source, /monitor-multiplexer[\s\S]{0,300}(?:WScript\.Arguments\(1\)|Invoke-Expression|cmd\.exe)/i);
});

test('installer is hidden limited and uses one fixed local scheduled task', async () => {
  const source = await read('../../scripts/windows/install-battle-bridge-monitor-multiplexer.ps1');
  assert.match(source, /Stephanos Battle Bridge Monitor Multiplexer/);
  assert.match(source, /monitor-multiplexer/);
  assert.match(source, /-RunLevel Limited/);
  assert.match(source, /-Hidden/);
  assert.match(source, /-MultipleInstances IgnoreNew/);
  assert.match(source, /RepetitionInterval \(New-TimeSpan -Minutes 1\)/);
  assert.doesNotMatch(source, /Invoke-Expression|Start-Process|cmd\.exe|git\s+(?:reset|clean|checkout|push|rebase)/i);
});

test('hidden runner invokes only the fixed source-controlled Node runtime', async () => {
  const source = await read('../../scripts/windows/run-battle-bridge-monitor-multiplexer-hidden.ps1');
  assert.match(source, /battle-bridge-monitor-multiplexer-runtime-v2\.mjs/);
  assert.match(source, /Get-Command node(?:\.exe)?/);
  assert.doesNotMatch(source, /param\([^)]*\$[A-Za-z]/s);
  assert.doesNotMatch(source, /Invoke-Expression|Start-Process|cmd\.exe/i);
});
