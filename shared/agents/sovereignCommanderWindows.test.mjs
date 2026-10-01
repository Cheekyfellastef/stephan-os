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

test('installer creates a local bearer token and does not install a vendor package', () => {
  assert.match(installer, /RandomNumberGenerator/);
  assert.match(installer, /sovereign-commander-token\.txt/);
  assert.match(installer, /existingToken\.Length -ge 32/);
  assert.match(installer, /Set-Acl -LiteralPath \$tokenPath -AclObject \$acl/);
  assert.match(installer, /vendorMeterRequired = \$false/);
  assert.match(installer, /externalSaasRelayRequired = \$false/);
  assert.doesNotMatch(installer, /npm\s+install|npx\s+@wonderwhy-er|desktop-commander/i);
});

test('watchdog retains array snapshots for zero, one, or many process matches', () => {
  assert.match(runner, /\$before = @\(Get-SovereignCommanderProcesses\)/);
  assert.match(runner, /\$after = @\(Get-SovereignCommanderProcesses\)/);
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


test('installer reports skipped truth instead of claiming installation when ShouldProcess declines', () => {
  assert.match(installer, /\$shouldApply = \$PSCmdlet\.ShouldProcess/);
  assert.match(installer, /installActionPerformed = \$installActionPerformed/);
  assert.match(installer, /startedNow = \$startedNow/);
  assert.match(installer, /SOVEREIGN_COMMANDER_INSTALL_SKIPPED/);
  assert.doesNotMatch(installer, /installed = \$true/);
});

test('watchdog can boundedly recycle only verified Sovereign Commander processes when capability is stale', () => {
  assert.match(runner, /\[string\]\$RequireCapabilityVersion = ''/);
  assert.match(runner, /\$serverScriptPattern = \[regex\]::Escape\(\$serverScript\)/);
  assert.match(runner, /CommandLine -match \$serverScriptPattern/);
  assert.match(runner, /\$staleCapabilityRecycleRequested = \$true/);
  assert.match(runner, /Stop-Process -Id \(\[int\]\$process\.ProcessId\) -Force/);
  assert.match(runner, /SOVEREIGN_COMMANDER_STALE_CAPABILITY_RECYCLE_FAILED/);
  assert.doesNotMatch(runner, /Stop-Process\s+-Name/);
});


test('capability probing is StrictMode-safe when an old daemon omits capabilityVersion', () => {
  assert.match(runner, /PSObject\.Properties\['capabilityVersion'\]/);
  assert.match(runner, /\$capabilityProperty\.Value/);
  assert.doesNotMatch(runner, /\$null -ne \$health\.capabilityVersion/);
});
