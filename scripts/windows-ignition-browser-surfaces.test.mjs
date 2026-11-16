import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

import './battle-bridge-ignition-sync-preflight.test.mjs';
import './battle-bridge-ignition-sync-package-contract.test.mjs';
import './battle-bridge-github-sync-and-refresh.test.mjs';

const launcherCmd = new URL('../windows/Launch-Stephanos-Local.cmd', import.meta.url);
const launcherPs1 = new URL('../windows/Launch-Stephanos-Local.ps1', import.meta.url);
const aiCoreHtml = new URL('../stephanos-ui/index.html', import.meta.url);
const aiCoreMain = new URL('../stephanos-ui/src/main.jsx', import.meta.url);
const packageJson = new URL('../package.json', import.meta.url);
const ignitionEntry = new URL('./run-battle-bridge-ignition.mjs', import.meta.url);

function launcherStatusHarness(source) {
  const names = ['Convert-SupervisorRecordToIgnitionStatus', 'Test-IgnitionBrowserReceiptSet', 'Resolve-IgnitionStatusProjection', 'Get-IgnitionStatusProjection', 'Publish-IgnitionStatusProjection', 'Write-IgnitionStatus', 'Publish-IgnitionTerminalOutcome', 'Complete-IgnitionLaunch', 'Test-BattleBridgeSupervisorFinalContract', 'Write-IgnitionSupportSnapshot', 'Fail-Step'];
  const functions = names.map(name => {
    const definition = source.match(new RegExp(`^function ${name}\\([\\s\\S]*?^}\\r?$`, 'm'))?.[0];
    assert.ok(definition, `exercise actual ${name} function`);
    return definition;
  }).join('\n');
  return `
$ErrorActionPreference = 'Stop'
$Mode = 'launcher-root'
$script:fixtureHead = '${'a'.repeat(40)}'
$ignitionProofRoot = [System.IO.Path]::GetTempPath()
$ignitionStatusPath = 'fixture-status'
$ignitionSupportSnapshotPath = 'fixture-snapshot'
$script:events = @()
$script:ignitionRunStartedAtUtc = [datetime]::UtcNow.AddSeconds(-5)
$autoOpenEnabled = $true
$browserSurfaces = @('launcher','runtime','openclaw') | ForEach-Object { @{ Id = $_; Url = 'fixture-' + $_; ExpectedTitle = $_; ProfilePath = 'fixture-profile-' + $_; UseBrowserWindow = $true } }
$script:browserSurfaceReceipts = @($browserSurfaces | ForEach-Object { @{ id = $_.Id; url = $_.Url; expectedTitle = $_.ExpectedTitle; profilePath = $_.ProfilePath; pid = 123; windowHandle = 456; windowTitle = $_.ExpectedTitle; verifiedAt = [datetime]::UtcNow.AddSeconds(-1).ToString('o'); processStartTimeUtc = [datetime]::UtcNow.AddMinutes(-1).ToString('o') } })
$script:supervisorFixture = [pscustomobject]@{
  currentPhase = 'ready'; trafficLight = 'green'; blockerId = ''; nextOperatorAction = ''
  sourceTruthVerdict = @{ state = 'ready'; expectedHead = $script:fixtureHead }
  services = @{ backend8787 = @{ ready = $true }; stephanosUi4173 = @{ ready = $true; servedRuntimeProof = @{ ready = $true; currentHead = $script:fixtureHead } }; openClaw18789 = @{ ready = $true } }
}
function Initialize-IgnitionProofWorkspace {}
function Get-BattleBridgeSupervisorCurrentRecord { return $script:supervisorFixture }
function Get-RepositoryHeadForSupervisorProof { return $script:fixtureHead }
function Get-IgnitionStageSnapshot { param([string]$CurrentStageId); return @() }
function Get-LatestOpenClawStartupStatus { return $null }
function Write-IgnitionJson { param($Path, $Value, $Depth); if ($script:publicationFailure -eq $Path) { throw 'fixture-publication-failed' }; if ($Path -eq 'fixture-status') { $script:published = $Value; $script:events += 'status:' + $Value.phase } else { $script:snapshot = $Value; $script:events += 'snapshot:' + $Value.verdict } }
function Write-IgnitionTranscript { param($Event); if ($script:publicationFailure -eq 'transcript') { throw 'fixture-publication-failed' }; $script:events += 'transcript:' + $Event.event }
function Update-IgnitionSplashScreen { param($Status) }
function Get-LauncherChildBlocker { return $script:childFixture }
function Write-Host { param($Object, $ForegroundColor); if ($Object -eq 'Stephanos local server ready') { $script:events += 'console:ready' } }
function Read-Host {}
${functions}
`;
}

test('desktop ignition enters the complete existing launcher-root cockpit flow', async () => {
  const cmd = await readFile(launcherCmd, 'utf8');
  assert.match(cmd, /Launch-Stephanos-Local\.ps1/);
  assert.match(cmd, /-Mode launcher-root -BootMode cockpit/);
  assert.doesNotMatch(cmd, /Launch-Stephanos-Ignition\.ps1/);
});

test('cockpit mode opens the front end, AI Core, and OpenClaw after the splash', async () => {
  const script = await readFile(launcherPs1, 'utf8');
  assert.match(script, /Show-IgnitionSplashScreen/);
  assert.match(script, /Get-StephanosBrowserSurfaceDefinition -Id 'launcher' -Label 'launcher' -Url \$launcherShellUrl -ExpectedTitle 'Stephanos OS'/);
  assert.match(script, /Get-StephanosBrowserSurfaceDefinition -Id 'runtime' -Label 'runtime' -Url \$launcherRuntimeUrl -ExpectedTitle 'Stephanos AI Core'/);
  assert.match(script, /Get-StephanosBrowserSurfaceDefinition -Id 'openclaw' -Label 'OpenClaw' -Url \$openClawControlUrl -ExpectedTitle 'OpenClaw Control'/);
  assert.match(script, /'cockpit' \{ return @\(\$surfaceMap\.launcher, \$surfaceMap\.runtime, \$surfaceMap\.openclaw\) \}/);
  assert.match(script, /Open-CockpitSurface -Url \$surface\.Url -Label \$surface\.Label -Id \$surface\.Id -ExpectedTitle \$surface\.ExpectedTitle/);
});

test('cockpit attempts every requested window before reporting combined failures', async () => {
  const script = await readFile(launcherPs1, 'utf8');
  assert.match(script, /\$surfaceFailures = @\(\)[\s\S]*?for \(\$index[\s\S]*?Open-CockpitSurface[\s\S]*?catch \{[\s\S]*?\$surfaceFailures \+= [\s\S]*?if \(\$surfaceFailures\.Count -gt 0\) \{ throw/);
});

test('warm and cold cockpit launches always use the guarded helper before browser readiness', { skip: process.platform !== 'win32' }, async () => {
  const script = (await readFile(launcherPs1, 'utf8')).replace(/\r\n/g, '\n');
  const start = script.indexOf("    Write-LiveLog 'launcher-root selected; ensuring port 5173 is not used by vite-dev'");
  const end = script.indexOf('\n  }\n\n  $isLocalhostLaunch', start);
  assert.ok(start >= 0 && end > start, 'exercise the actual launcher-root branch');
  const branch = script.slice(start, end);
  for (const warm of [true, false]) {
    const command = `
$ErrorActionPreference = 'Stop'
$script:calls = @()
$resolvedBootMode = 'cockpit'
$launcherRootCommand = 'guarded-command'
$launcherShellUrl = 'fixture-launcher'
$launcherRuntimeUrl = 'fixture-runtime'
function Write-LiveLog { param([string]$Message) }
function Stop-ProcessOnTcpPort { param([int]$Port) }
function Get-DesktopLaunchReadiness {
  $script:calls += 'unguarded-readiness-shortcut'
  return @{ ready = $${warm}; head = '${'a'.repeat(40)}' }
}
function Start-DevWindow {
  param([string]$Title, [string]$Command, [switch]$ReturnProcess)
  if ($Command -ne 'guarded-command') { throw 'unexpected helper command' }
  $script:calls += 'guarded-helper'
  return @{ fixture = $true }
}
function Wait-ForBattleBridgeSupervisorReady { $script:calls += 'supervisor-proof'; return @{} }
function Wait-ForUrl { param([string]$StepLabel, [string]$Url); $script:calls += 'url-proof' }
${branch}
ConvertTo-Json -InputObject @($script:calls) -Compress
`;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      encoding: 'utf8', windowsHide: true, shell: false, timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout || result.error?.message);
    const calls = JSON.parse(result.stdout.trim()).filter(call => call !== 'unguarded-readiness-shortcut');
    assert.deepEqual(calls, ['guarded-helper', 'supervisor-proof', 'url-proof', 'url-proof'], warm ? 'warm readiness must retain canonical admission' : 'cold startup must retain canonical admission');
  }
});

test('launcher status adjudicates the desktop and Vite service-proof truth table before persistence', { skip: process.platform !== 'win32' }, async () => {
  const source = (await readFile(launcherPs1, 'utf8')).replace(/\r\n/g, '\n');
  const fixtures = [];
  for (const mode of ['launcher-root', 'vite-dev']) {
    for (const phase of ['battle-bridge-supervisor', 'opening-command-deck', 'restart-required', 'fixed-runtime-installation', 'blocked', 'ready']) {
      for (const state of ['qualified', 'blocked', 'pending', 'missing', 'wrong-source', 'source-pending', 'source-missing', 'wrong-served', 'invalid-head', 'incomplete']) {
        fixtures.push({ mode, phase, state });
      }
    }
  }
  const command = launcherStatusHarness(source) + `
$goodSupervisorJson = ConvertTo-Json -InputObject $script:supervisorFixture -Depth 12
$fixtures = '${JSON.stringify(fixtures)}' | ConvertFrom-Json
$observations = @()
foreach ($fixture in $fixtures) {
  $Mode = $fixture.mode
  $script:fixtureHead = '${'a'.repeat(40)}'
  $script:supervisorFixture = $goodSupervisorJson | ConvertFrom-Json
  switch ($fixture.state) {
    'blocked' { $script:supervisorFixture.currentPhase = 'blocked'; $script:supervisorFixture.trafficLight = 'red'; $script:supervisorFixture.blockerId = 'service-proof-failed' }
    'pending' { $script:supervisorFixture.currentPhase = 'build'; $script:supervisorFixture.trafficLight = 'blue' }
    'missing' { $script:supervisorFixture = $null }
    'wrong-source' { $script:supervisorFixture.sourceTruthVerdict.expectedHead = '${'b'.repeat(40)}' }
    'source-pending' { $script:supervisorFixture.sourceTruthVerdict.state = 'pending' }
    'source-missing' { $script:supervisorFixture.sourceTruthVerdict = $null }
    'wrong-served' { $script:supervisorFixture.services.stephanosUi4173.servedRuntimeProof.currentHead = '${'b'.repeat(40)}' }
    'invalid-head' { $script:fixtureHead = '' }
    'incomplete' { $script:supervisorFixture.services.backend8787.ready = $false }
  }
  $stage = if ($fixture.phase -eq 'opening-command-deck') { 'ready' } else { $fixture.phase }
  Write-IgnitionStatus -Phase $fixture.phase -Message $fixture.phase -Extra @{ currentStage = $stage; blocker = 'browser-window-failed'; browserTargets = @('launcher','runtime','openclaw'); phase = 'ready'; trafficLight = 'green'; enterStephanosEnabled = $true; progressPercentage = 100; battleBridgeSupervisor = @{ trafficLight = 'forged' } }
  $observations += @{ mode = $fixture.mode; request = $fixture.phase; state = $fixture.state; phase = $script:published.phase; trafficLight = $script:published.trafficLight; enter = $script:published.enterStephanosEnabled; blocker = $script:published.blocker; services = $script:published.battleBridgeSupervisor.trafficLight; stage = $script:published.currentStage; browserTargets = $script:published.browserTargets }
}
ConvertTo-Json -InputObject @($observations) -Compress
`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    encoding: 'utf8', windowsHide: true, shell: false, timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout || result.error?.message);
  const observations = JSON.parse(result.stdout.trim());
  assert.equal(observations.length, fixtures.length);
  for (const row of observations) {
    const label = `${row.mode}/${row.request}/${row.state}`;
    let expectedPhase = row.request;
    let expectedBlocker = 'browser-window-failed';
    if (row.mode === 'launcher-root' && !['blocked', 'restart-required', 'fixed-runtime-installation'].includes(row.request)) {
      if (row.state === 'blocked') { expectedPhase = 'blocked'; expectedBlocker = 'service-proof-failed'; }
      else if (row.request === 'ready' && row.state !== 'qualified') { expectedPhase = 'blocked'; expectedBlocker = 'desktop-ignition-service-proof-unproven'; }
    }
    assert.equal(row.phase, expectedPhase, label);
    assert.equal(row.enter, expectedPhase === 'ready', label);
    assert.equal(row.trafficLight === 'green', expectedPhase === 'ready', label);
    if (expectedPhase === 'blocked') assert.equal(row.blocker, expectedBlocker, label);
    if (expectedPhase !== 'ready') assert.notEqual(row.stage, 'ready', label);
    assert.notEqual(row.services, 'forged', label);
    if (row.mode === 'vite-dev') assert.equal(row.services, null, label);
    assert.deepEqual(row.browserTargets, ['fixture-launcher', 'fixture-runtime', 'fixture-openclaw'], label);
  }
});

test('a failed cockpit window attempts all surfaces and publishes red despite fresh green services', { skip: process.platform !== 'win32' }, async () => {
  const source = (await readFile(launcherPs1, 'utf8')).replace(/\r\n/g, '\n');
  const start = source.lastIndexOf('  if ($autoOpenEnabled) {');
  const end = source.indexOf('\n  Complete-IgnitionLaunch', start);
  assert.ok(start >= 0 && end > start, 'exercise the actual required-window loop');
  const command = launcherStatusHarness(source) + `
$autoOpenEnabled = $true
$script:attempts = @()
$script:childFixture = @{ message = 'older-child-blocker'; nextOperatorAction = 'old action' }
$browserSurfaces = @(@{ Id = 'launcher'; Label = 'launcher'; Url = 'fixture-launcher'; ExpectedTitle = 'Stephanos OS' }, @{ Id = 'runtime'; Label = 'runtime'; Url = 'fixture-runtime'; ExpectedTitle = 'Stephanos AI Core' }, @{ Id = 'openclaw'; Label = 'OpenClaw'; Url = 'fixture-openclaw'; ExpectedTitle = 'OpenClaw Control' })
function Wait-ForUrl { param($StepLabel, $Url, $TimeoutSeconds) }
function Start-Sleep { param($Milliseconds) }
function Open-CockpitSurface {
  param($Url, $Label, $Id, $ExpectedTitle)
  $script:attempts += $Id
  if ($Id -eq 'runtime') { throw 'fixture-runtime-window-failed' }
}
function Write-IgnitionJson { param($Path, $Value, $Depth); ConvertTo-Json -InputObject @{ path = $Path; status = $Value; attempts = @($script:attempts) } -Depth 15 -Compress }
try {
${source.slice(start, end)}
  throw 'window failure was not surfaced'
} catch { Fail-Step -Step $_.Exception.Message -ErrorRecord $_ }
`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    encoding: 'utf8', windowsHide: true, shell: false, timeout: 10_000,
  });
  assert.equal(result.status, 1, result.stderr || result.stdout || result.error?.message);
  const observations = result.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
  const observation = observations.find(row => row.path === 'fixture-status');
  assert.deepEqual(observation.attempts, ['launcher', 'runtime', 'openclaw']);
  assert.equal(observation.status.phase, 'blocked');
  assert.equal(observation.status.trafficLight, 'red');
  assert.equal(observation.status.enterStephanosEnabled, false);
  assert.match(observation.status.blocker, /fixture-runtime-window-failed/);
  assert.equal(observation.status.battleBridgeSupervisor.trafficLight, 'green');
  assert.equal(observation.status.childIgnitionBlocker.message, 'older-child-blocker');
  const snapshot = observations.find(row => row.path === 'fixture-snapshot').status;
  assert.equal(snapshot.verdict, 'blocked');
  assert.equal(snapshot.blocker, observation.status.blocker);
});

test('terminal consumers share service and window admission and publication failures never succeed', { skip: process.platform !== 'win32' }, async () => {
  const source = (await readFile(launcherPs1, 'utf8')).replace(/\r\n/g, '\n');
  const fixtures = [
    { name: 'verified-desktop', setup: '', ready: true },
    { name: 'missing-services', setup: '$script:supervisorFixture = $null', blocker: 'desktop-ignition-service-proof-unproven' },
    { name: 'pending-services', setup: "$script:supervisorFixture.currentPhase = 'build'; $script:supervisorFixture.trafficLight = 'blue'", blocker: 'desktop-ignition-service-proof-unproven' },
    { name: 'moved-source', setup: `$script:supervisorFixture.sourceTruthVerdict.expectedHead = '${'b'.repeat(40)}'`, blocker: 'desktop-ignition-service-proof-unproven' },
    { name: 'wrong-served', setup: `$script:supervisorFixture.services.stephanosUi4173.servedRuntimeProof.currentHead = '${'b'.repeat(40)}'`, blocker: 'desktop-ignition-service-proof-unproven' },
    { name: 'receiptless-default-browser-request', setup: '$script:browserSurfaceReceipts = @()', blocker: 'desktop-ignition-browser-proof-unproven' },
    { name: 'duplicate-receipt', setup: '$script:browserSurfaceReceipts += $script:browserSurfaceReceipts[0]', blocker: 'desktop-ignition-browser-proof-unproven' },
    { name: 'substituted-url', setup: "$script:browserSurfaceReceipts[0].url = 'foreign-url'", blocker: 'desktop-ignition-browser-proof-unproven' },
    { name: 'wrong-window-title', setup: "$script:browserSurfaceReceipts[0].windowTitle = 'foreign-title'", blocker: 'desktop-ignition-browser-proof-unproven' },
    { name: 'stale-receipt', setup: "$script:browserSurfaceReceipts[0].verifiedAt = [datetime]::UtcNow.AddMinutes(-1).ToString('o')", blocker: 'desktop-ignition-browser-proof-unproven' },
    { name: 'missing-window-handle', setup: '$script:browserSurfaceReceipts[0].windowHandle = 0', blocker: 'desktop-ignition-browser-proof-unproven' },
    { name: 'vite-manual', setup: "$Mode = 'vite-dev'; $autoOpenEnabled = $false; $script:browserSurfaceReceipts = @(); $script:supervisorFixture = $null", ready: true, scope: 'vite-manual-open' },
    { name: 'vite-open-request', setup: "$Mode = 'vite-dev'; $script:browserSurfaceReceipts = @(); $script:supervisorFixture = $null", ready: true, scope: 'vite-browser-request-unverified' },
    ...['fixture-status', 'fixture-snapshot', 'transcript'].map(path => ({ name: `publication-${path}`, setup: `$script:publicationFailure = '${path}'`, publicationFailure: true })),
  ];
  for (const fixture of fixtures) {
    const command = launcherStatusHarness(source) + `
${fixture.setup}
function Write-IgnitionJson {
  param($Path, $Value, $Depth)
  if ($script:publicationFailure -eq $Path) { throw 'fixture-publication-failed' }
  Write-Output ('EVIDENCE=' + (ConvertTo-Json -InputObject @{ kind = $Path; value = $Value } -Depth 16 -Compress))
}
function Write-IgnitionTranscript {
  param($Event)
  if ($script:publicationFailure -eq 'transcript') { throw 'fixture-publication-failed' }
  Write-Output ('EVIDENCE=' + (ConvertTo-Json -InputObject @{ kind = 'transcript'; value = $Event } -Depth 16 -Compress))
}
function Write-Host { param($Object, $ForegroundColor); if ($Object -eq 'Stephanos local server ready') { Write-Output 'EVIDENCE={"kind":"console-ready"}' } }
try { Complete-IgnitionLaunch -Extra @{ currentStage = 'ready' } } catch { Fail-Step -Step $_.Exception.Message -ErrorRecord $_ }
`;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      encoding: 'utf8', windowsHide: true, shell: false, timeout: 10_000,
    });
    assert.equal(result.status, fixture.ready ? 0 : 1, `${fixture.name}: ${result.stderr || result.stdout || result.error?.message}`);
    const evidence = result.stdout.split(/\r?\n/).filter(line => line.startsWith('EVIDENCE=')).map(line => JSON.parse(line.slice(9)));
    assert.equal(evidence.some(row => row.kind === 'console-ready'), fixture.ready === true, fixture.name);
    if (fixture.publicationFailure) continue;
    const status = evidence.find(row => row.kind === 'fixture-status').value;
    const snapshot = evidence.find(row => row.kind === 'fixture-snapshot').value;
    assert.deepEqual(snapshot.ignitionOutcome, status, fixture.name);
    assert.equal(snapshot.phase, fixture.ready ? 'ready' : 'blocked', fixture.name);
    assert.equal(snapshot.verdict, fixture.ready ? 'ready-for-local-proof' : 'blocked', fixture.name);
    if (fixture.blocker) assert.equal(status.blocker, fixture.blocker, fixture.name);
    if (fixture.scope) assert.equal(status.browserProofScope, fixture.scope, fixture.name);
    const statusEvent = evidence.find(row => row.kind === 'transcript' && row.value.event === 'ignition-status').value;
    const snapshotEvent = evidence.find(row => row.kind === 'transcript' && row.value.event === 'support-snapshot').value;
    assert.equal(statusEvent.phase, status.phase, fixture.name);
    assert.equal(statusEvent.blocker, status.blocker, fixture.name);
    assert.equal(snapshotEvent.verdict, snapshot.verdict, fixture.name);
    if (fixture.ready) assert.ok(evidence.findIndex(row => row.kind === 'console-ready') > evidence.findIndex(row => row.kind === 'fixture-snapshot'), fixture.name);
  }
});

test('support snapshot details cannot replace the adjudicated verdict or admitted evidence', { skip: process.platform !== 'win32' }, async () => {
  const source = (await readFile(launcherPs1, 'utf8')).replace(/\r\n/g, '\n');
  const command = launcherStatusHarness(source) + `
$outcome = Get-IgnitionStatusProjection -Phase 'blocked' -Message 'current-browser-failure' -Extra @{ blocker = 'current-browser-failure' }
Write-IgnitionSupportSnapshot -Verdict 'ready-for-local-proof' -Outcome $outcome -Extra @{ verdict = 'ready-for-local-proof'; phase = 'ready'; blocker = 'forged'; browserTargets = @('forged'); browserSurfaceReceipts = @('forged'); ignitionOutcome = @{ phase = 'ready' } }
ConvertTo-Json -InputObject $script:snapshot -Depth 16 -Compress
`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true, shell: false, timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr || result.stdout || result.error?.message);
  const snapshot = JSON.parse(result.stdout.trim());
  assert.equal(snapshot.verdict, 'blocked');
  assert.equal(snapshot.phase, 'blocked');
  assert.equal(snapshot.blocker, 'current-browser-failure');
  assert.deepEqual(snapshot.browserTargets, ['fixture-launcher', 'fixture-runtime', 'fixture-openclaw']);
  assert.equal(snapshot.ignitionOutcome.phase, 'blocked');
  assert.equal(snapshot.browserSurfaceReceipts.length, 3);
});

test('repeat ignition presses reuse exact verified Edge app windows instead of duplicating cockpit surfaces', async () => {
  const script = await readFile(launcherPs1, 'utf8');
  assert.match(script, /stephanos\.ignition-browser-surface-receipt\.v1/);
  assert.match(script, /fixed-per-surface-profile/);
  assert.match(script, /Local\\Stephanos-Ignition-Browser-Surface-\$Id/);
  assert.match(script, /Get-VerifiedEdgeAppSurface -Surface \$Surface -EdgeExecutable \$edgeExecutable/);
  assert.match(script, /reused-existing-window/);
  assert.match(script, /opened-new-window/);
  assert.match(script, /--app=\$\(\$Surface\.Url\)/);
  assert.match(script, /--user-data-dir=/);
  assert.match(script, /GetVisibleTopLevelWindows\(\[int\]\$candidate\.ProcessId\)/);
  assert.match(script, /GetWindowThreadProcessId/);
  assert.match(script, /IsWindowVisible/);
  assert.match(script, /\[string\]\$_\.Title, \[string\]\$Surface\.ExpectedTitle/);
  assert.match(script, /windowHandle = \[int64\]\$surfaceWindow\.Handle/);
  assert.doesNotMatch(script, /\$process\.MainWindowHandle/);
  assert.doesNotMatch(script, /\$process\.MainWindowTitle/);
  assert.match(script, /arbitraryBrowserExecutableAllowed = \$false/);
});

test('ignition truth files use one BOM-free UTF-8 persistence boundary', async () => {
  const script = await readFile(launcherPs1, 'utf8');
  assert.match(script, /function Write-IgnitionUtf8NoBomText[\s\S]*?UTF8Encoding\(\$false\)[\s\S]*?\[System\.IO\.File\]::WriteAllText\(\$Path, \$Value, \$encoding\)/);
  assert.match(script, /function Add-IgnitionUtf8NoBomLine[\s\S]*?UTF8Encoding\(\$false\)[\s\S]*?\[System\.IO\.File\]::AppendAllText/);
  assert.match(script, /function Write-IgnitionJson[\s\S]*?Write-IgnitionUtf8NoBomText/);
  assert.match(script, /function Publish-IgnitionStatusProjection[\s\S]*Write-IgnitionJson -Path \$ignitionStatusPath -Value \$Outcome -Depth 12/);
  assert.match(script, /Write-IgnitionJson -Path \$ignitionBrowserSurfaceReceiptPath -Value \$browserSurfaceProjection -Depth 8/);
  assert.match(script, /Write-IgnitionJson -Path \$ignitionSupportSnapshotPath -Value \$snapshot -Depth 10/);
  assert.match(script, /Add-IgnitionUtf8NoBomLine -Path \$ignitionTranscriptPath/);
  assert.doesNotMatch(script, /Set-Content -LiteralPath \$ignition(?:Status|BrowserSurfaceReceipt|SupportSnapshot)Path -Encoding UTF8/);
  assert.doesNotMatch(script, /Add-Content -LiteralPath \$ignitionTranscriptPath -Encoding UTF8/);
});

test('the built runtime browser surface is Stephanos AI Core', async () => {
  const html = await readFile(aiCoreHtml, 'utf8');
  assert.match(html, /<title>Stephanos AI Core<\/title>/);
  assert.match(html, /<link rel="icon" href="data:," \/>/);
});

test('dist runtime health diagnostics do not probe the optional Vite dev server', async () => {
  const main = await readFile(aiCoreMain, 'utf8');
  assert.match(main, /startupFingerprint\.runtimeRole === "mission-control-dev-runtime"[\s\S]*?fetch\("http:\/\/127\.0\.0\.1:5173\//);
  assert.match(main, /: Promise\.resolve\(false\)/);
});

test('AI Core remains a browser surface rather than a dedicated PowerShell console', async () => {
  const cmd = await readFile(launcherCmd, 'utf8');
  const script = await readFile(launcherPs1, 'utf8');
  assert.doesNotMatch(cmd, /visible AI Core window/i);
  assert.doesNotMatch(script, /WindowTitle\s*=\s*'Stephanos AI Core'/);
});

test('Windows ignition preflights only backend 8787 before entering the full supervisor', async () => {
  const pkg = JSON.parse(await readFile(packageJson, 'utf8'));
  const entry = await readFile(ignitionEntry, 'utf8');

  assert.equal(pkg.scripts['stephanos:ignite'], 'node scripts/run-battle-bridge-ignition.mjs');
  assert.equal(pkg.scripts['stephanos:ignite:supervisor'], 'node scripts/battle-bridge-ignition-supervisor.mjs');
  assert.match(entry, /backend-8787-preflight/);
  assert.match(entry, /start-stephanos-backend\.ps1/);
  assert.match(entry, /battle-bridge-ignition-supervisor\.mjs/);
  assert.match(entry, /process\.argv\.slice\(2\)/);
  assert.doesNotMatch(entry, /repair-stephanos-battle-bridge\.ps1/);
  assert.doesNotMatch(entry, /tailscale/i);
});
