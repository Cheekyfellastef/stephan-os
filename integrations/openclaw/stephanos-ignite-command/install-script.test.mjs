import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const installScript = new URL('../../../scripts/windows/install-openclaw-stephanos-ignite-command.ps1', import.meta.url);
const statusScript = new URL('../../../scripts/windows/status-openclaw-stephanos-ignite-command.ps1', import.meta.url);

test('install script uses canonical linked OpenClaw installation mechanism', async () => {
  const source = await readFile(installScript, 'utf8');
  assert.match(source, /\$pluginId = 'stephanos-ignite-command'/);
  assert.match(source, /plugins install --link \$pluginRoot/);
  assert.match(source, /plugins enable \$pluginId/);
  assert.match(source, /gateway restart/);
  assert.match(source, /INSPECT_COMMAND=openclaw plugins inspect stephanos-ignite-command --runtime --json/);
});

test('status script proves runtime loading through OpenClaw inspect', async () => {
  const source = await readFile(statusScript, 'utf8');
  assert.match(source, /plugins inspect \$pluginId --runtime --json/);
  assert.match(source, /FINAL_VERDICT=OPENCLAW_STEPHANOS_IGNITE_COMMAND_RUNTIME_PRESENT/);
});
