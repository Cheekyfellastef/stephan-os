import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const scriptUrl = new URL('../../../scripts/windows/repair-openclaw-stephanos-ignite-command.ps1', import.meta.url);

test('Windows repair script uses canonical repo plugin path and refuses missing files', async () => {
  const source = await readFile(scriptUrl, 'utf8');
  assert.match(source, /Documents\\GitHub\\stephan-os/);
  assert.match(source, /integrations\\openclaw\\stephanos-ignite-command/);
  assert.match(source, /openclaw\.plugin\.json/);
  assert.match(source, /package\.json/);
  assert.match(source, /index\.js/);
  assert.match(source, /lib\\ignite-status\.mjs/);
  assert.match(source, /throw "Required Stephanos Ignite OpenClaw plugin file is missing:/);
});

test('Windows repair script is explicit and does not rewrite OpenClaw config or run doctor fix', async () => {
  const source = await readFile(scriptUrl, 'utf8');
  assert.match(source, /\[switch\]\$Relink/);
  assert.match(source, /plugins install --link \$pluginRoot/);
  assert.match(source, /plugins enable \$pluginId/);
  assert.doesNotMatch(source, /doctor\s+--fix/);
  assert.doesNotMatch(source, /Set-Content|ConvertTo-Json|Remove-Item|\.openclaw\\openclaw\.json/);
  assert.doesNotMatch(source, /gateway restart/);
});
