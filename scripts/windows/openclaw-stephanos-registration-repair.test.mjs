import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const repairSource = readFileSync(new URL('./repair-openclaw-stephanos-whatsapp-command-registration.ps1', import.meta.url), 'utf8');
const installSource = readFileSync(new URL('./install-openclaw-stephanos-whatsapp-command.ps1', import.meta.url), 'utf8');

test('Stephanos OpenClaw repair avoids full plugin config rewrites', () => {
  assert.doesNotMatch(repairSource, /plugins\s+install/i);
  assert.doesNotMatch(repairSource, /plugins\s+enable/i);
  assert.match(repairSource, /surgical_text_patch_no_openclaw_config_rewrite/);
  assert.match(repairSource, /stephanos-whatsapp-command/);
  assert.match(repairSource, /Contains\('\\\\'\)/);
  assert.match(repairSource, /Replace\('\\', '\\\\'\)/);
});

test('installer delegates to surgical registration repair instead of plugins install --link', () => {
  assert.doesNotMatch(installSource, /plugins\s+install\s+--link/i);
  assert.doesNotMatch(installSource, /plugins\s+enable/i);
  assert.match(installSource, /repair-openclaw-stephanos-whatsapp-command-registration\.ps1/);
});

test('repair publishes the canonical runtime source and command proof labels', () => {
  assert.match(repairSource, /Documents\\GitHub\\stephan-os/);
  assert.match(repairSource, /integrations\\openclaw\\stephanos-whatsapp-command/);
  assert.match(repairSource, /index\.js/);
  assert.match(repairSource, /\/stephanos <message>/);
  assert.match(repairSource, /\/stephanos-ignite help/);
});
