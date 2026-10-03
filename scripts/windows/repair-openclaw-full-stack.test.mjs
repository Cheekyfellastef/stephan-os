import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const scriptPath = resolve('scripts/windows/repair-openclaw-full-stack.ps1');

test('OpenClaw full-stack repair is fixed-scope and proves gateway plus both Stephanos plugins', async () => {
  const script = await readFile(scriptPath, 'utf8');
  assert.match(script, /stephanos-ignite-command/);
  assert.match(script, /stephanos-whatsapp-command/);
  assert.match(script, /plugins','install','--link'/);
  assert.match(script, /plugins','enable'/);
  assert.match(script, /gateway','restart'/);
  assert.match(script, /plugins','inspect'/);
  assert.match(script, /status','--json'/);
  assert.match(script, /127\.0\.0\.1:18789\/health/);
  assert.match(script, /127\.0\.0\.1:18789\/identity/);
  assert.match(script, /OPENCLAW_FULL_STACK_REPAIR_GREEN/);
  assert.match(script, /arbitraryShellAllowed = \$false/);
  assert.match(script, /arbitraryPluginIdAllowed = \$false/);
  assert.match(script, /sourceMutationAllowed = \$false/);
  assert.match(script, /pcRestartAllowed = \$false/);
  assert.doesNotMatch(script, /Invoke-Expression|Start-Process\s+cmd|cmd\.exe\s+\/c/i);
});

test('OpenClaw full-stack repair does not emit raw OpenClaw status or plugin inspect output', async () => {
  const script = await readFile(scriptPath, 'utf8');
  assert.doesNotMatch(script, /Write-Output\s+\$status\.output/);
  assert.doesNotMatch(script, /Write-Output\s+\$inspect\.output/);
  assert.match(script, /runtimeIdPresent/);
});
