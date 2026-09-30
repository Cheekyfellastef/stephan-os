import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const launcher = await readFile(new URL('../../scripts/windows/run-stephanos-scheduled-task-windowless.vbs', import.meta.url), 'utf8');
const installer = await readFile(new URL('../../scripts/windows/install-sovereign-commander.ps1', import.meta.url), 'utf8');
const runner = await readFile(new URL('../../scripts/windows/run-sovereign-commander-hidden.ps1', import.meta.url), 'utf8');

test('windowless launcher exposes Sovereign Commander without a visible console', () => {
  assert.match(launcher, /Case "sovereign-commander-watchdog"/);
  assert.match(launcher, /run-sovereign-commander-hidden\.ps1/);
  assert.match(installer, /wscript\.exe/i);
  assert.match(installer, /-Hidden/);
  assert.match(installer, /visiblePowerShellRequired = \$false/);
});

test('installer rebuilds and verifies an exclusive current-user token DACL without Set-Acl', () => {
  assert.match(installer, /RandomNumberGenerator/);
  assert.match(installer, /sovereign-commander-token\.txt/);
  assert.match(installer, /GetAccessControl\(\[System\.Security\.AccessControl\.AccessControlSections\]::Access\)/);
  assert.match(installer, /SetAccessRuleProtection\(\$true, \$false\)/);
  assert.match(installer, /RemoveAccessRuleSpecific/);
  assert.match(installer, /SetAccessControl\(\$acl\)/);
  assert.match(installer, /rules\.Count -ne 1/);
  assert.match(installer, /SOVEREIGN_COMMANDER_TOKEN_ACL_NOT_EXCLUSIVE/);
  assert.match(installer, /tokenAclMethod = 'exclusive-current-user-dacl'/);
  assert.doesNotMatch(installer, /Set-Acl|icacls\.exe/i);
  assert.match(installer, /vendorMeterRequired = \$false/);
  assert.match(installer, /externalSaasRelayRequired = \$false/);
  assert.doesNotMatch(installer, /npm\s+install|npx\s+@wonderwhy-er|desktop-commander/i);
});

test('WhatIf gates token directory, token write and DACL mutation', () => {
  const gate = installer.indexOf('$shouldApply = $PSCmdlet.ShouldProcess');
  const declined = installer.indexOf('if (-not $shouldApply)');
  assert.ok(gate >= 0);
  assert.ok(declined > gate);
  for (const mutation of [
    'New-Item -ItemType Directory -Path $tokenDir',
    'WriteAllText($tokenPath',
    'Set-CurrentUserOnlyFileDacl -Path $tokenPath',
    'Register-ScheduledTask',
  ]) {
    const index = installer.indexOf(mutation);
    assert.ok(index > declined, `mutation must follow ShouldProcess decline gate: ${mutation}`);
  }
  assert.match(installer, /mutationPerformed = \$false/);
  assert.match(installer, /SOVEREIGN_COMMANDER_INSTALL_SKIPPED/);
});

test('watchdog starts only the source-controlled local HTTP server and proves health', () => {
  assert.match(runner, /sovereign-commander-http\.mjs/);
  assert.match(runner, /http:\/\/127\.0\.0\.1:\$port\/health/);
  assert.match(runner, /\$canonicalNode = 'C:\\Program Files\\nodejs\\node\.exe'/);
  assert.match(runner, /Test-Path -LiteralPath \$canonicalNode -PathType Leaf/);
  assert.match(runner, /Start-Process -FilePath \$canonicalNode/);
  assert.doesNotMatch(runner, /Get-Command node/);
  assert.match(runner, /-WindowStyle Hidden/);
  assert.match(runner, /arbitraryShellAllowed = \$false/);
  assert.match(runner, /pcRestartAllowed = \$false/);
  assert.doesNotMatch(runner, /@wonderwhy-er|desktop-commander/i);
});
