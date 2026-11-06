import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const installScript = new URL('../scripts/windows/install-openclaw-stephanos-whatsapp-command.ps1', import.meta.url);
const repairScript = new URL('../scripts/windows/repair-openclaw-stephanos-whatsapp-command.ps1', import.meta.url);

test('install clears the OpenClaw plugin registry record before linking the canonical source', async () => {
  const source = await readFile(installScript, 'utf8');
  const uninstallIndex = source.indexOf('plugins uninstall $pluginId');
  const installIndex = source.indexOf('plugins install --link $pluginRoot');
  assert.ok(uninstallIndex > 0, 'expected stale registry uninstall before install');
  assert.ok(installIndex > uninstallIndex, 'expected relink after stale registry uninstall');
  assert.ok(source.includes("not\\s+installed|not\\s+found|unknown\\s+plugin"));
});

test('repair script declares registry precedence and verifies the runtime entry path', async () => {
  const source = await readFile(repairScript, 'utf8');
  assert.match(source, /OpenClaw runtime plugin registry\/installation database wins/);
  assert.match(source, /plugins', 'uninstall', \$pluginId/);
  assert.match(source, /plugins install --link \$pluginRoot/);
  assert.match(source, /plugins', 'inspect', \$pluginId, '--runtime', '--json'/);
  assert.match(source, /Test-RuntimeEntryMatchesCanonicalPath/);
  assert.match(source, /FINAL_VERDICT=OPENCLAW_STEPHANOS_WHATSAPP_COMMAND_REGISTRY_REPAIRED/);
});
