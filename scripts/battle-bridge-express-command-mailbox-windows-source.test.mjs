import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = (relativePath) => readFile(resolve(root, relativePath), 'utf8');

test('windowless launcher exposes the express mailbox without replacing GitHub mailbox', async () => {
  const source = await read('scripts/windows/run-stephanos-scheduled-task-windowless.vbs');
  assert.match(source, /Case "github-command-mailbox"/);
  assert.match(source, /Case "express-command-mailbox"/);
  assert.match(source, /run-battle-bridge-express-command-mailbox-hidden\.ps1/);
});

test('installer registers hidden limited additive watcher with restart safety net', async () => {
  const source = await read('scripts/windows/install-battle-bridge-express-command-mailbox.ps1');
  assert.match(source, /Stephanos Battle Bridge Express Command Mailbox/);
  assert.match(source, /-AtLogOn/);
  assert.match(source, /-RepetitionInterval \(New-TimeSpan -Minutes 1\)/);
  assert.match(source, /-RunLevel Limited/);
  assert.match(source, /-Hidden/);
  assert.match(source, /-MultipleInstances IgnoreNew/);
  assert.match(source, /durableFallbackPreserved = \$true/);
  assert.match(source, /rawCommandExecutionAllowed = \$false/);
  assert.match(source, /visiblePowerShellRequired = \$false/);
});

test('hidden runner is canonical-checkout bound and exposes only the watcher entrypoint', async () => {
  const source = await read('scripts/windows/run-battle-bridge-express-command-mailbox-hidden.ps1');
  assert.match(source, /Documents\\GitHub\\stephan-os/);
  assert.match(source, /battle-bridge-express-command-mailbox\.mjs/);
  assert.doesNotMatch(source, /Invoke-Expression|iex\s|Start-Process/);
});
