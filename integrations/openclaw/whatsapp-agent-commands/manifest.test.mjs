import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const installScript = new URL('../../../scripts/windows/install-openclaw-whatsapp-agent-commands.ps1', import.meta.url);
const uninstallScript = new URL('../../../scripts/windows/uninstall-openclaw-whatsapp-agent-commands.ps1', import.meta.url);

async function readScript(url) {
  return readFile(url, 'utf8');
}

test('PowerShell WhatIf switches are declared before StrictMode use', async () => {
  const install = await readScript(installScript);
  assert.match(install, /\[switch\]\$WhatIfInstall/);
  assert.match(install, /Set-StrictMode -Version Latest/);
  assert.ok(install.indexOf('[switch]$WhatIfInstall') < install.indexOf('Set-StrictMode -Version Latest'));

  const uninstall = await readScript(uninstallScript);
  assert.match(uninstall, /\[switch\]\$WhatIfRollback/);
  assert.match(uninstall, /Set-StrictMode -Version Latest/);
  assert.ok(uninstall.indexOf('[switch]$WhatIfRollback') < uninstall.indexOf('Set-StrictMode -Version Latest'));
});

test('agent command canon stays source-owned and non-mutating by default', async () => {
  const install = await readScript(installScript);
  for (const expected of [
    "'/standalone=standalone'",
    "'/scout-coder=stephanos-scout-coder'",
    "'/scout_coder=stephanos-scout-coder'",
    "'/stephanos=stephanos'",
    "'ChatClean=ChatClean'",
    "'WhatsAppAgentName=ChatClean'",
  ]) {
    assert.match(install, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(install, /\$RuntimeMutationExplicit = \[bool\]\$MutateRuntime/);
  assert.match(install, /\$MergeAllowed = \$false/);
  assert.match(install, /-MutateRuntime/);
});
