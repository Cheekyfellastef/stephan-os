import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import './battle-bridge-ignition-sync-preflight.test.mjs';
import './windows-ignition-preflight-recovery.test.mjs';
import './battle-bridge-ignition-sync-package-contract.test.mjs';
import './battle-bridge-github-sync-and-refresh.test.mjs';

const launcherCmd = new URL('../windows/Launch-Stephanos-Local.cmd', import.meta.url);
const launcherPs1 = new URL('../windows/Launch-Stephanos-Local.ps1', import.meta.url);
const aiCoreHtml = new URL('../stephanos-ui/index.html', import.meta.url);
const aiCoreMain = new URL('../stephanos-ui/src/main.jsx', import.meta.url);
const packageJson = new URL('../package.json', import.meta.url);
const ignitionEntry = new URL('./run-battle-bridge-ignition.mjs', import.meta.url);

function runPowerShell(command, timeout = 10_000) {
  const directory = mkdtempSync(join(tmpdir(), 'ignition-observation-fixture-'));
  const script = join(directory, 'fixture.ps1');
  try {
    writeFileSync(script, '\ufeff' + command, 'utf8');
    return spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
      encoding: 'utf8', windowsHide: true, shell: false, timeout,
    });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

function actualDefinition(source, name) {
  const match = source.match(new RegExp(`^function ${name}(?:\\([^\\n]*\\))? \\{[\\s\\S]*?^}\\r?$`, 'm'));
  assert(match, `actual source definition ${name}`);
  return match[0];
}

test('actual Windows PowerShell unattended mode defers optional preparation before every effect', { skip: process.platform !== 'win32' }, async () => {
  const source = await readFile(launcherPs1, 'utf8');
  const functions = ['Invoke-SovereignCommanderRetainedCustodyPreparation','Invoke-SovereignFixedRuntimeCommissioning'].map(name=>actualDefinition(source,name)).join('\n');
  for (const unattended of [true,false]) {
    const result = runPowerShell(`
$ErrorActionPreference='Stop'
$Unattended=[switch]$${unattended}; $Mode='launcher-root'; $repoRoot='C:\\fixture'
$script:checks=0
function Write-LiveLog { param($Message) }
function Test-Path { param($LiteralPath,$PathType); $script:checks++; return $false }
function Start-Process { throw 'optional-process-must-not-start' }
function Add-Type { throw 'optional-dialog-must-not-open' }
${functions}
$retained=Invoke-SovereignCommanderRetainedCustodyPreparation
$commissioning=Invoke-SovereignFixedRuntimeCommissioning
ConvertTo-Json -InputObject @{ major=$PSVersionTable.PSVersion.Major; retained=$retained; commissioning=$commissioning; checks=$script:checks } -Compress
`);
    assert.equal(result.status,0,result.stderr||result.stdout);
    const observed=JSON.parse(result.stdout.trim());
    assert.equal(observed.major,5);
    assert.equal(observed.retained,false);assert.equal(observed.commissioning,false);
    assert.equal(unattended?observed.checks===0:observed.checks>0,true);
  }
});

test('actual unattended helper recovery decisions produce typed attended-required outcomes without dialog or Git effects', { skip: process.platform !== 'win32' }, async()=>{
  const source=await readFile(new URL('../windows/Invoke-Stephanos-Ignite-With-Approval.ps1',import.meta.url),'utf8');
  const functions=['Test-IgnitionAttendedActionAvailable','Show-OpenClawRestartPopup','Show-IgniteRecoveryPopup','Invoke-ApprovedSourceMergeCheck'].map(name=>actualDefinition(source,name)).join('\n');
  const result=runPowerShell(`
$ErrorActionPreference='Stop'; $Unattended=[switch]$true; $requestedHead='${'a'.repeat(40)}'
function Add-Type { throw 'no-ui-effect-permitted' }
function New-Object { throw 'no-dialog-effect-permitted' }
function git { throw 'no-source-effect-permitted' }
function Write-IgniteApprovalLog { param($Message) }
${functions}
$one=Show-OpenClawRestartPopup -Packet @{}
$two=Show-IgniteRecoveryPopup -Packet @{}
$three=Invoke-ApprovedSourceMergeCheck -Packet @{}
Write-Output ('RESULT='+(@{ one=$one; two=$two; three=$three }|ConvertTo-Json -Compress))
$Unattended=[switch]$false
Write-Output ('INTERACTIVE='+(Test-IgnitionAttendedActionAvailable -RequiredAction 'OPENCLAW_SERVICE_RESTART'))
`);
  assert.equal(result.status,0,result.stderr||result.stdout);
  const lines=result.stdout.trim().split(/\r?\n/);
  const packets=lines.filter(line=>line.startsWith('STEPHANOS_IGNITION_ATTENDED_ACTION_REQUIRED=')).map(line=>JSON.parse(line.split('=').slice(1).join('=')));
  assert.deepEqual(packets.map(row=>row.requiredAction),['OPENCLAW_SERVICE_RESTART','SOURCE_DIVERGENCE_RECOVERY','SOURCE_MERGE_COMPLETION']);
  assert(packets.every(row=>row.blocker==='ATTENDED_ACTION_REQUIRED'&&row.sourceHead==='a'.repeat(40)));
  const output=JSON.parse(lines.find(line=>line.startsWith('RESULT=')).slice(7));
  assert.deepEqual(output,{one:'attended-action-required',two:'attended-action-required',three:2});
  assert(lines.includes('INTERACTIVE=True'));
});

test('unattended optional deferral never pays service or required-window proof and cannot be overwritten by Extra', { skip: process.platform !== 'win32' },async()=>{
  const source=await readFile(launcherPs1,'utf8');
  for(const failure of ['none','window','service']){
    const command=launcherStatusHarness(source)+terminalEvidenceCapture()+`
$Unattended=[switch]$true
function Read-Host { throw 'unattended-must-not-wait' }
${failure==='window'?"$script:liveWindows['runtime']=$null":''}
${failure==='service'?"$script:supervisorFixture.services.backend8787.ready=$false":''}
try { Complete-IgnitionLaunch -Extra @{ currentStage='ready'; executionMode='forged'; optionalPreparations=@{ fixedRuntimeCommissioning=@{ qualificationProven=$true } } } }
catch { Fail-Step -Step $_.Exception.Message -ErrorRecord $_ }
`;
    const observed=readTerminalEvidence(runPowerShell(command),failure==='none',failure);
    assert.equal(observed.status.executionMode,'unattended');
    assert.equal(observed.status.optionalPreparations.fixedRuntimeCommissioning.observedState,'UNKNOWN');
    assert.equal(observed.status.optionalPreparations.fixedRuntimeCommissioning.qualificationProven,false);
    assert.equal(observed.status.optionalPreparations.retainedCustodyPreparation.custodyReleased,false);
  }
});

test('unattended fixed 5173 census holds foreign listeners and failed queries with zero termination', { skip: process.platform !== 'win32' },async()=>{
  const source=(await readFile(launcherPs1,'utf8')).replace(/\r\n/g,'\n');
  const start=source.indexOf('    if ([bool]$Unattended) {\n      Assert-UnattendedVitePortVacant');
  const end=source.indexOf('\n    if ($stopped.Count',start);assert(start>=0&&end>start);
  for(const state of ['vacant','foreign','unavailable','interactive']){
    const result=runPowerShell(`
$ErrorActionPreference='Stop'; $Unattended=[switch]$${state!=='interactive'}; $script:stops=0; $script:queries=0
function Get-CimInstance { param($Namespace,$Query,$ErrorAction); $script:queries++
  if($Namespace -cne 'root/StandardCimv2' -or $Query -cne 'SELECT LocalPort FROM MSFT_NetTCPConnection WHERE LocalPort = 5173 AND State = 2'){throw 'wrong-fixed-query'}
  ${state==='unavailable'?"throw 'query-denied'":state==='foreign'?"return [pscustomobject]@{ LocalPort=5173 }":'return @()'}
}
function Stop-Process { throw 'foreign-process-must-not-be-terminated' }
function Stop-ProcessOnTcpPort { param($Port); $script:stops++; return @(42) }
${actualDefinition(source,'Assert-UnattendedVitePortVacant')}
$held='';try {
${source.slice(start,end)}
} catch {$held=$_.Exception.Message}
ConvertTo-Json -InputObject @{ held=$held; stops=$script:stops; queries=$script:queries } -Compress
`);
    assert.equal(result.status,0,result.stderr||result.stdout);const observed=JSON.parse(result.stdout.trim());
    assert.equal(observed.stops,state==='interactive'?1:0);
    assert.equal(observed.queries,state==='interactive'?0:1);
    assert.equal(observed.held,state==='foreign'?'UNATTENDED_VITE_PORT_OCCUPIED':state==='unavailable'?'UNATTENDED_VITE_PORT_CENSUS_UNPROVEN':'');
  }
});

test('actual launcher helper process stays hidden unattended and preserves interactive window behavior', { skip: process.platform !== 'win32' },async()=>{
  const source=await readFile(launcherPs1,'utf8');
  for(const unattended of [true,false]){
    const result=runPowerShell(`
$ErrorActionPreference='Stop'; $Unattended=[switch]$${unattended}; $repoRoot='C:\\fixture'; $ignitionProofRoot='C:\\fixture\\workspace'
$script:ignitionHelperLogFiles=@()
function Initialize-IgnitionProofWorkspace {}
function Write-LiveLog { param($Message) }
function Write-IgnitionStatus { param($Phase,$Message,$Extra) }
function Start-Process { param($FilePath,$WorkingDirectory,$WindowStyle,$RedirectStandardOutput,$RedirectStandardError,$ArgumentList,[switch]$PassThru)
  $script:style=[string]$WindowStyle; return [pscustomobject]@{ Id=42 } }
${actualDefinition(source,'Start-DevWindow')}
$value=Start-DevWindow -Title 'Existing Helper' -Command 'guarded-command' -ReturnProcess
ConvertTo-Json -InputObject @{ style=$script:style; result=$value.Id; logs=$script:ignitionHelperLogFiles.Count } -Compress
`);
    assert.equal(result.status,0,result.stderr||result.stdout);const value=JSON.parse(result.stdout.trim());
    assert.equal(value.style,unattended?'Hidden':'Minimized');assert.equal(value.result,42);assert.equal(value.logs,2);
  }
});

test('canonical CMD wrapper preserves unattended arguments and terminalizes a failed child without pause', { skip: process.platform !== 'win32' },async()=>{
  const directory=mkdtempSync(join(tmpdir(),'ignition-unattended-cmd-'));
  const command=join(directory,'Launch-Stephanos-Local.cmd'),script=join(directory,'Launch-Stephanos-Local.ps1');
  writeFileSync(command,await readFile(launcherCmd,'utf8'));
  writeFileSync(script,"param([switch]$Unattended,[string]$Mode,[string]$BootMode)\r\nif($Unattended -and $Mode -eq 'launcher-root'){exit 7};exit 0\r\n");
  const result=spawnSync('C:\\Windows\\System32\\cmd.exe',['/d','/c',command,'-Mode','launcher-root','-Unattended'],{encoding:'utf8',windowsHide:true,shell:false,timeout:5000});
  assert.equal(result.status,7,result.stderr||result.stdout||result.error?.message);
  assert.equal(result.error,undefined);
});

test('an unattended required-action helper result persists the exact typed hold without console waiting', { skip: process.platform !== 'win32' },async()=>{
  const source=await readFile(launcherPs1,'utf8');
  const result=runPowerShell(launcherStatusHarness(source)+terminalEvidenceCapture()+`
$Unattended=[switch]$true
$script:childFixture=@{ packetType='ignition-attended-action-required'; reason='ATTENDED_ACTION_REQUIRED'; nextOperatorAction='Attend the same canonical owner.' }
function Read-Host { throw 'unattended-must-not-wait' }
Fail-Step -Step 'helper stopped before service readiness'
`);
  const observed=readTerminalEvidence(result,false,'attended-action-required');
  assert.equal(observed.status.blocker,'ATTENDED_ACTION_REQUIRED');
  assert.equal(observed.status.enterStephanosEnabled,false);
});

function launcherStatusHarness(source) {
  const names = ['Convert-SupervisorRecordToIgnitionStatus', 'Test-IgnitionBrowserReceiptSet', 'Resolve-IgnitionStatusProjection', 'Get-IgnitionStatusProjection', 'Publish-IgnitionStatusProjection', 'Write-IgnitionStatus', 'Publish-IgnitionTerminalOutcome', 'Complete-IgnitionLaunch', 'Test-BattleBridgeSupervisorFinalContract', 'Write-IgnitionSupportSnapshot', 'Fail-Step'];
  const optional = ['New-IgnitionBrowserObservationClock', 'Get-IgnitionBrowserObservationSet', 'Get-IgnitionRequiredBrowserSurfaces', 'Get-IgnitionOptionalBrowserOutcome'];
  const functions = [...names, ...optional].map(name => {
    const definition = source.match(new RegExp(`^function ${name}\\([\\s\\S]*?^}\\r?$`, 'm'))?.[0];
    if (!definition && optional.includes(name)) return ''; // Allows a substantive regression replay against the published predecessor.
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
$script:receiptIndex = 0
$script:browserSurfaceReceipts = @($browserSurfaces | ForEach-Object { $script:receiptIndex++; @{ id = $_.Id; url = $_.Url; expectedTitle = $_.ExpectedTitle; profilePath = $_.ProfilePath; pid = 123 + $script:receiptIndex; windowHandle = 456 + $script:receiptIndex; windowTitle = $_.ExpectedTitle; verifiedAt = [datetime]::UtcNow.AddSeconds(-1).ToString('o'); processStartTimeUtc = [datetime]::UtcNow.AddMinutes(-1).ToString('o') } })
$script:liveWindows = @{}
foreach ($record in $script:browserSurfaceReceipts) { $script:liveWindows[$record.id] = $record | ConvertTo-Json | ConvertFrom-Json }
$script:disposedCapabilities = 0
$script:exitedPids = @()
$script:optionalBrowserSurfaceFailures = @()
$script:probeCalls = @()
$script:supervisorFixture = [pscustomobject]@{
  currentPhase = 'ready'; trafficLight = 'green'; blockerId = ''; nextOperatorAction = ''
  generatedAt = [datetime]::UtcNow.AddSeconds(-1).ToString('o')
  sourceTruthVerdict = @{ state = 'ready'; expectedHead = $script:fixtureHead }
  services = @{ backend8787 = @{ ready = $true }; stephanosUi4173 = @{ ready = $true; servedRuntimeProof = @{ ready = $true; currentHead = $script:fixtureHead } }; openClaw18789 = @{ ready = $true } }
}
$battleBridgeSupervisor = $script:supervisorFixture | ConvertTo-Json -Depth 12 | ConvertFrom-Json
$script:ignitionAdmittedSourceHead = [string]$battleBridgeSupervisor.sourceTruthVerdict.expectedHead
function Initialize-IgnitionProofWorkspace {}
function Get-BattleBridgeSupervisorCurrentRecord { return $script:supervisorFixture }
function Get-RepositoryHeadForSupervisorProof { if ($null -ne $script:headSequence -and $script:headSequence.Count -gt 0) { $value = $script:headSequence[0]; $script:headSequence = @($script:headSequence | Select-Object -Skip 1); return $value }; return $script:fixtureHead }
function Get-IgnitionStageSnapshot { param([string]$CurrentStageId); return @() }
function Get-LatestOpenClawStartupStatus { return $null }
function Write-IgnitionJson { param($Path, $Value, $Depth); if ($script:publicationFailure -eq $Path) { throw 'fixture-publication-failed' }; if ($Path -eq 'fixture-status') { $script:published = $Value; $script:events += 'status:' + $Value.phase } else { $script:snapshot = $Value; $script:events += 'snapshot:' + $Value.verdict } }
function Write-IgnitionTranscript { param($Event); if ($script:publicationFailure -eq 'transcript') { throw 'fixture-publication-failed' }; $script:events += 'transcript:' + $Event.event }
function Update-IgnitionSplashScreen { param($Status) }
function Get-LauncherChildBlocker { return $script:childFixture }
function Write-Host { param($Object, $ForegroundColor); if ($Object -eq 'Stephanos local server ready') { $script:events += 'console:ready' } }
function Read-Host {}
function Write-LiveLog { param($Message) }
function Resolve-StephanosEdgeExecutable { return 'C:\\fixture\\msedge.exe' }
function Get-VerifiedEdgeAppSurface {
  param($Surface, $EdgeExecutable, $RetainedProcess = $null, [switch]$RetainProcess, $ObservationClock = $null)
  $script:probeCalls += $Surface.Id
  if ($script:probeHook) { & $script:probeHook $Surface.Id ([bool]$RetainedProcess) }
  $record = $script:liveWindows[$Surface.Id]
  if (-not $record) { return $null }
  $capability = $RetainedProcess
  if (-not $capability) {
    $capability = [pscustomobject]@{ Id = $record.pid }
    $capability | Add-Member ScriptProperty HasExited { return $script:exitedPids -contains $this.Id }
    $capability | Add-Member ScriptMethod Dispose { $script:disposedCapabilities++ }
  }
  if ($capability.HasExited) { return $null }
  $proof = [ordered]@{ pid = $record.pid; processStartTimeUtc = $record.processStartTimeUtc; windowHandle = $record.windowHandle; windowTitle = $record.windowTitle; ownerProcessId = $record.pid; executablePath = $EdgeExecutable; profilePath = $record.profilePath; url = $record.url }
  if ($script:observationMutation) { & $script:observationMutation $proof }
  if ($RetainProcess) { $proof.processCapability = $capability }
  return $proof
}
${functions}
`;
}

function terminalEvidenceCapture() {
  return `
function Write-IgnitionJson { param($Path, $Value, $Depth); Write-Output ('EVIDENCE=' + (ConvertTo-Json -InputObject @{ kind = $Path; value = $Value; disposed = $script:disposedCapabilities } -Depth 20 -Compress)) }
function Write-IgnitionTranscript { param($Event); Write-Output ('EVIDENCE=' + (ConvertTo-Json -InputObject @{ kind = 'transcript'; value = $Event } -Depth 20 -Compress)) }
function Write-Host { param($Object, $ForegroundColor); if ($Object -eq 'Stephanos local server ready') { Write-Output 'EVIDENCE={"kind":"console-ready"}' } }
`;
}

function readTerminalEvidence(result, ready, label) {
  assert.equal(result.status, ready ? 0 : 1, `${label}: ${result.stderr || result.stdout || result.error?.message}`);
  const evidence = result.stdout.split(/\r?\n/).filter(line => line.startsWith('EVIDENCE=')).map(line => JSON.parse(line.slice(9)));
  assert.equal(evidence.some(row => row.kind === 'console-ready'), ready, label);
  const status = evidence.find(row => row.kind === 'fixture-status');
  const snapshot = evidence.find(row => row.kind === 'fixture-snapshot');
  assert.ok(status && snapshot, label);
  assert.equal(status.value.phase, ready ? 'ready' : 'blocked', label);
  assert.deepEqual(snapshot.value.ignitionOutcome, status.value, label);
  assert.equal(snapshot.value.verdict, ready ? 'ready-for-local-proof' : 'blocked', label);
  assert.equal(evidence.find(row => row.kind === 'transcript' && row.value.event === 'ignition-status').value.blocker, status.value.blocker, label);
  assert.equal(evidence.find(row => row.kind === 'transcript' && row.value.event === 'support-snapshot').value.verdict, snapshot.value.verdict, label);
  assert.doesNotMatch(JSON.stringify(status.value), /processCapability|capabilities|SafeHandle|ElapsedTicks/, label);
  if (ready && status.value.currentBrowserObservation) {
    assert.equal(status.value.currentBrowserObservation.supervisorGeneratedAtBefore, status.value.battleBridgeSupervisor.generatedAt, label);
    assert.equal(status.value.currentBrowserObservation.supervisorGeneratedAtAfter, status.value.battleBridgeSupervisor.generatedAt, label);
  }
  return { status: status.value, snapshot: snapshot.value, disposed: status.disposed };
}

test('closing an earlier core window during the optional opening attempt denies terminal readiness', { skip: process.platform !== 'win32' }, async () => {
  const source = (await readFile(launcherPs1, 'utf8')).replace(/\r\n/g, '\n');
  const start = source.lastIndexOf('  if ($autoOpenEnabled) {');
  const end = source.indexOf('\n  Complete-IgnitionLaunch', start);
  assert.ok(start >= 0 && end > start);
  for (const fixture of [{ closed: 'launcher' }, { closed: 'runtime' }, { sourceMoved: true }, {}]) {
    const closed = fixture.closed;
    const command = launcherStatusHarness(source) + terminalEvidenceCapture() + `
function Open-CockpitSurface { param($Url, $Label, $Id, $ExpectedTitle); if ($Id -eq 'openclaw') { ${closed ? `$script:liveWindows['${closed}'] = $null` : ''}; ${fixture.sourceMoved ? `$script:fixtureHead = '${'b'.repeat(40)}'; $script:supervisorFixture.sourceTruthVerdict.expectedHead = $script:fixtureHead; $script:supervisorFixture.services.stephanosUi4173.servedRuntimeProof.currentHead = $script:fixtureHead` : ''} } }
function Start-Sleep { param($Milliseconds) }
function Wait-ForUrl { throw 'optional OpenClaw may not impose a service wait' }
try {
${source.slice(start, end)}
  Complete-IgnitionLaunch -Extra @{ currentStage = 'ready' }
} catch { Fail-Step -Step $_.Exception.Message -ErrorRecord $_ }
`;
    const result = runPowerShell(command);
    const observed = readTerminalEvidence(result, !closed && !fixture.sourceMoved, closed || (fixture.sourceMoved ? 'source-moved-during-later-wait' : 'still-visible'));
    if (closed) assert.equal(observed.status.blocker, 'desktop-ignition-browser-proof-unproven');
    else if (fixture.sourceMoved) assert.equal(observed.status.blocker, 'desktop-ignition-service-proof-unproven');
    else {
      assert.equal(observed.status.currentBrowserObservation.surfaces.length, 2);
      assert.equal(observed.disposed, 2);
    }
  }
});

test('optional OpenClaw cannot block current core proof or demote either required Stephanos window', { skip: process.platform !== 'win32' }, async () => {
  const source = (await readFile(launcherPs1, 'utf8')).replace(/\r\n/g, '\n');
  const start = source.lastIndexOf('  if ($autoOpenEnabled) {');
  const end = source.indexOf('\n  Complete-IgnitionLaunch', start);
  assert.ok(start >= 0 && end > start);
  const fixtures = [
    { name: 'optional-service-down', setup: '$script:supervisorFixture.services.openClaw18789.ready = $false', ready: true, state: 'DEGRADED' },
    { name: 'optional-open-failed', failure: 'openclaw', ready: true, state: 'DEGRADED' },
    { name: 'optional-window-closed', setup: "$script:liveWindows['openclaw'] = $null", ready: true, state: 'CURRENT_UNPROVEN' },
    { name: 'optional-receipt-missing', setup: "$script:browserSurfaceReceipts = @($script:browserSurfaceReceipts | Where-Object { $_.id -ne 'openclaw' }); $script:liveWindows['openclaw'] = $null", ready: true, state: 'CURRENT_UNPROVEN' },
    { name: 'core-window-missing-with-forged-optional-flag', setup: "$browserSurfaces[0].RequiredForIgnition = $false; $browserSurfaces[0].optional = $true; $script:liveWindows['launcher'] = $null" },
    { name: 'core-window-missing-with-malformed-optional-flag', setup: "$browserSurfaces[1].RequiredForIgnition = 'false'; $browserSurfaces[1].optional = 'unknown'; $script:liveWindows['runtime'] = $null" },
    { name: 'unknown-surface-cannot-be-demoted', setup: "$browserSurfaces += @{ Id = 'unknown'; Url = 'fixture-unknown'; ExpectedTitle = 'unknown'; ProfilePath = 'fixture-unknown'; optional = $true }" },
    { name: 'core-and-optional-opening-both-fail', failure: 'runtime' },
  ];
  for (const fixture of fixtures) {
    const command = launcherStatusHarness(source) + terminalEvidenceCapture() + `
${fixture.setup || ''}
$script:attempts = @()
function Start-Sleep { param($Milliseconds) }
function Wait-ForUrl { throw 'optional service cannot add a startup wait' }
function Open-CockpitSurface {
  param($Url, $Label, $Id, $ExpectedTitle)
  $script:attempts += $Id
  if (${fixture.failure ? `$Id -eq '${fixture.failure}'` : '$false'} -or (${fixture.failure === 'runtime' ? '$true' : '$false'} -and $Id -eq 'openclaw')) { throw ('fixture-' + $Id + '-open-failed') }
}
try {
${source.slice(start, end)}
  Write-Output ('ATTEMPTS=' + (ConvertTo-Json -InputObject @($script:attempts) -Compress))
  Complete-IgnitionLaunch -Extra @{ currentStage = 'ready'; optionalBrowserSurfaces = @('forged') }
} catch { Fail-Step -Step $_.Exception.Message -ErrorRecord $_ }
`;
    const result = runPowerShell(command);
    const observed = readTerminalEvidence(result, fixture.ready === true, fixture.name);
    assert.deepEqual(observed.snapshot.optionalBrowserSurfaces, observed.status.optionalBrowserSurfaces, fixture.name);
    const optional = observed.status.optionalBrowserSurfaces[0];
    assert.equal(optional.id, 'openclaw', fixture.name);
    assert.equal(optional.requiredForIgnition, false, fixture.name);
    assert.equal(optional.currentWindowProof, 'UNPROVEN', fixture.name);
    if (fixture.ready) {
      const attempted = result.stdout.split(/\r?\n/).find(line => line.startsWith('ATTEMPTS='));
      assert.deepEqual(JSON.parse(attempted.slice(9)), ['launcher', 'runtime', 'openclaw'], fixture.name);
      assert.equal(observed.status.browserProofScope, 'verified-required-windows', fixture.name);
      assert.equal(optional.state, fixture.state, fixture.name);
      assert.deepEqual(observed.status.currentBrowserObservation.surfaces.map(row => row.id), ['launcher', 'runtime'], fixture.name);
      assert.equal(observed.disposed, 2, fixture.name);
    } else if (fixture.failure) {
      assert.match(observed.status.blocker, /fixture-runtime-open-failed/, fixture.name);
      assert.doesNotMatch(observed.status.blocker, /fixture-openclaw-open-failed/, fixture.name);
    } else assert.equal(observed.status.blocker, 'desktop-ignition-browser-proof-unproven', fixture.name);
  }
});

test('final aggregate observation rejects changed identities, later closure, source movement and expired capture', { skip: process.platform !== 'win32' }, async () => {
  const source = (await readFile(launcherPs1, 'utf8')).replace(/\r\n/g, '\n');
  const fixtures = [
    { name: 'window-closes-during-later-probe', setup: "$script:probeHook = { param($id,$aggregate); if ($id -eq 'runtime' -and -not $aggregate) { $script:liveWindows['launcher'] = $null } }", disposed: 2 },
    { name: 'process-exits-during-later-probe', setup: "$script:probeHook = { param($id,$aggregate); if ($id -eq 'runtime' -and -not $aggregate) { $script:exitedPids = @(124) } }", disposed: 2 },
    { name: 'process-exits-after-window-pass', setup: "function Get-RepositoryHeadForSupervisorProof { $script:headReads++; if ($script:headReads -eq 2) { $script:exitedPids = @(124) }; return $script:fixtureHead }", disposed: 2 },
    ...[
      ['pid', '$proof.pid = 999'], ['owner', '$proof.ownerProcessId = 999'],
      ['birth', "$proof.processStartTimeUtc = [datetime]::UtcNow.AddMinutes(-2).ToString('o')"],
      ['handle', '$proof.windowHandle = 999'], ['title', "$proof.windowTitle = 'substituted'"],
      ['path', "$proof.executablePath = 'C:\\foreign\\msedge.exe'"],
      ['profile', "$proof.profilePath = 'substituted-profile'"], ['url', "$proof.url = 'substituted-url'"],
    ].map(([name, mutation]) => ({ name: `substituted-${name}`, setup: `$script:observationMutation = { param($proof); ${mutation} }`, disposed: 2 })),
    { name: 'source-moves-across-capture', setup: `$script:headSequence = @('${'a'.repeat(40)}','${'b'.repeat(40)}')`, blocker: 'desktop-ignition-service-proof-unproven', disposed: 2 },
    { name: 'source-becomes-unproven', setup: `$script:headSequence = @('${'a'.repeat(40)}','')`, blocker: 'desktop-ignition-service-proof-unproven', disposed: 2 },
    { name: 'original-admitted-head-missing', setup: "$script:ignitionAdmittedSourceHead = ''", blocker: 'desktop-ignition-service-proof-unproven', disposed: 2 },
    { name: 'service-proof-unproven-before-capture', setup: 'function Get-BattleBridgeSupervisorCurrentRecord { $script:serviceReads++; if ($script:serviceReads -eq 1) { return $null }; return $script:supervisorFixture }', blocker: 'desktop-ignition-service-proof-unproven', disposed: 2 },
    { name: 'service-record-becomes-pending', setup: "$script:probeHook = { param($id,$aggregate); if ($id -eq 'runtime' -and $aggregate) { $script:supervisorFixture.currentPhase = 'build'; $script:supervisorFixture.trafficLight = 'blue' } }", blocker: 'desktop-ignition-service-proof-unproven', disposed: 2 },
    { name: 'capture-bound-expires', setup: "function New-IgnitionBrowserObservationClock { $value = [pscustomobject]@{ ElapsedMilliseconds = [long]15001 }; $value | Add-Member ScriptMethod Stop {}; return $value }", disposed: 0 },
    { name: 'capture-budget-includes-first-authority-read', setup: "$script:budgetElapsed = [long]0; function New-IgnitionBrowserObservationClock { $value = [pscustomobject]@{}; $value | Add-Member ScriptProperty ElapsedMilliseconds { return $script:budgetElapsed }; $value | Add-Member ScriptMethod Stop {}; return $value }; function Get-RepositoryHeadForSupervisorProof { $script:budgetElapsed = [long]15001; return $script:fixtureHead }", disposed: 0 },
    { name: 'forged-extra-cannot-replace-missing-observation', setup: "$script:liveWindows['launcher'] = $null", extra: "currentBrowserObservation = @{ schemaVersion = 'forged'; surfaces = @('forged') }", disposed: 0 },
  ];
  for (const fixture of fixtures) {
    const command = launcherStatusHarness(source) + terminalEvidenceCapture() + `
${fixture.setup}
try { Complete-IgnitionLaunch -Extra @{ currentStage = 'ready'; ${fixture.extra || ''} } } catch { Fail-Step -Step $_.Exception.Message -ErrorRecord $_ }
`;
    const observed = readTerminalEvidence(runPowerShell(command), false, fixture.name);
    assert.equal(observed.status.blocker, fixture.blocker || 'desktop-ignition-browser-proof-unproven', fixture.name);
    assert.equal(observed.disposed, fixture.disposed, fixture.name);
  }
});

function retainedObserverHarness(source) {
  const observer = source.match(/^function Get-VerifiedEdgeAppSurface\([\s\S]*?^}\r?$/m)?.[0];
  let native = source.match(/Add-Type -TypeDefinition @'\n([\s\S]*?)\n'@/)?.[1];
  assert.ok(observer && native);
  // Only the OS window enumeration is intercepted; the production argv parser and observer execute.
  const signature = native.indexOf('public static WindowRecord[] GetVisibleTopLevelWindows');
  const open = native.indexOf('{', signature);
  let depth = 1, close = open + 1;
  while (depth && close < native.length) { if (native[close] === '{') depth++; if (native[close] === '}') depth--; close++; }
  assert.equal(depth, 0);
  native = native.slice(0, open) + '{ FixtureReadCount++; return FixtureRecords; }' + native.slice(close);
  native = native.replace('public static class StephanosIgnitionWindowProbe\n{', 'public static class StephanosIgnitionWindowProbe\n{\n public static int FixtureReadCount;\n public static WindowRecord[] FixtureRecords;');
  return `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
${native}
'@
$script:retained = $false
$script:disposed = 0
$script:freshReads = 0
$script:fixtureExited = $false
$script:exitOnWindowRead = $false
$script:clockElapsed = [long]0
[long]$ticks = [datetime]::UtcNow.AddMinutes(-1).Ticks
$ticks = $ticks - ($ticks % 10)
$script:fullBirth = [datetime]::new(($ticks + 7), [DateTimeKind]::Utc)
$script:cimBirth = [datetime]::new($ticks, [DateTimeKind]::Utc)
$surface = @{ Id = 'launcher'; Url = 'http://127.0.0.1:4173/'; ExpectedTitle = 'Stephanos OS'; ProfilePath = 'C:\\fixture\\Profile One'; UseBrowserWindow = $true }
$edge = 'C:\\fixture\\msedge.exe'
$script:fixtureProcess = [pscustomobject]@{ Id = 124; Path = $edge; StartTime = $script:fullBirth }
$script:fixtureProcess | Add-Member ScriptProperty Handle { $script:retained = $true; return [IntPtr]5 }
$script:fixtureProcess | Add-Member ScriptProperty HasExited { return $script:fixtureExited -or ($script:exitOnWindowRead -and [StephanosIgnitionWindowProbe]::FixtureReadCount -gt 0) }
$script:fixtureProcess | Add-Member ScriptMethod Dispose { $script:disposed++; $script:retained = $false }
$commandLine = '"' + $edge + '" --new-window ' + $surface.Url + ' --user-data-dir="' + $surface.ProfilePath + '"'
$script:discovery = [pscustomobject]@{ ProcessId = 124; Name = 'msedge.exe'; ParentProcessId = 1; CommandLine = $commandLine; CreationDate = $script:cimBirth }
$script:fresh = $script:discovery | ConvertTo-Json | ConvertFrom-Json
$script:fresh.CreationDate = $script:cimBirth
[StephanosIgnitionWindowProbe]::FixtureRecords = @([StephanosIgnitionWindowProbe+WindowRecord]@{ ProcessId = 124; Handle = 457; Title = 'Stephanos OS' })
function Initialize-StephanosWindowProbe {}
function Get-Process { param($Id, $ErrorAction); return $script:fixtureProcess }
function Get-CimInstance {
 param($ClassName, $Filter, $OperationTimeoutSec, $ErrorAction)
 if ($OperationTimeoutSec -notin @(1,2)) { throw 'CIM read must have a finite positive bound' }
 if ($Filter -like 'ProcessId =*') { if (-not $script:retained) { throw 'fresh CIM preceded retained handle' }; $script:freshReads++; if ($script:denyFreshCim) { throw 'fixture-CIM-denied' }; if ($script:expireAfterFresh) { $script:clockElapsed = [long]15001 }; return $script:fresh }
 return $script:discovery
}
${observer}
`;
}

test('the retained fixed observer binds fresh command tokens and microsecond birth without PID or window substitution', { skip: process.platform !== 'win32' }, async () => {
  const source = (await readFile(launcherPs1, 'utf8')).replace(/\r\n/g, '\n');
  const fixtures = [
    { name: 'same-process-different-document-format-precision', setup: '', pass: true },
    { name: 'adjacent-real-magnitude-microsecond', setup: '$script:fresh.CreationDate = $script:cimBirth.AddTicks(10)' },
    { name: 'reused-pid-different-birth', setup: '$script:fixtureProcess.StartTime = $script:fullBirth.AddTicks(10000000)' },
    { name: 'fresh-pid-substitution', setup: '$script:fresh.ProcessId = 125' },
    { name: 'wrong-fixed-executable', setup: "$script:fixtureProcess.Path = 'C:\\foreign\\msedge.exe'", reads: 0 },
    { name: 'old-discovery-profile-not-authority', setup: "$script:fresh.CommandLine = $commandLine.Replace('Profile One','Profile Two')" },
    { name: 'profile-suffix', setup: "$script:fresh.CommandLine = $commandLine.Replace('Profile One','Profile One-extra')" },
    { name: 'quote-concatenated-profile', setup: "$script:fresh.CommandLine = $commandLine + 'suffix'" },
    { name: 'URL-prefix-lookalike', setup: "$script:fresh.CommandLine = $commandLine.Replace('http://127.0.0.1:4173/','http://127.0.0.1:4173/foreign')" },
    { name: 'duplicate-profile-argument', setup: "$script:fresh.CommandLine = $commandLine + ' --user-data-dir=foreign'" },
    { name: 'child-renderer', setup: "$script:fresh.CommandLine = $commandLine + ' --type=renderer'" },
    { name: 'wrong-window-owner', setup: '[StephanosIgnitionWindowProbe]::FixtureRecords[0].ProcessId = 125' },
    { name: 'closed-or-hidden-window', setup: '[StephanosIgnitionWindowProbe]::FixtureRecords = @()' },
    { name: 'wrong-window-title', setup: "[StephanosIgnitionWindowProbe]::FixtureRecords[0].Title = 'Foreign window'" },
    { name: 'zero-window-handle', setup: '[StephanosIgnitionWindowProbe]::FixtureRecords[0].Handle = 0' },
    { name: 'process-exits-after-window-observation', setup: '$script:exitOnWindowRead = $true' },
    { name: 'fresh-CIM-denied', setup: '$script:denyFreshCim = $true' },
    { name: 'deadline-expired-before-observation', setup: '$script:clockElapsed = [long]15001', reads: 0, disposed: 0 },
    { name: 'deadline-expires-during-fresh-read', setup: '$script:expireAfterFresh = $true' },
  ];
  for (const fixture of fixtures) {
    const command = retainedObserverHarness(source) + `
${fixture.setup}
$clock = [pscustomobject]@{}
$clock | Add-Member ScriptProperty ElapsedMilliseconds { return $script:clockElapsed }
$proof = Get-VerifiedEdgeAppSurface -Surface $surface -EdgeExecutable $edge -ObservationClock $clock
ConvertTo-Json -InputObject @{ found = [bool]$proof; proof = $proof; disposed = $script:disposed; freshReads = $script:freshReads; fullBirth = $script:fullBirth.ToString('o') } -Depth 8 -Compress
`;
    const result = runPowerShell(command);
    assert.equal(result.status, 0, `${fixture.name}: ${result.stderr || result.stdout || result.error?.message}`);
    const observed = JSON.parse(result.stdout.trim());
    assert.equal(observed.found, fixture.pass === true, fixture.name);
    assert.equal(observed.disposed, fixture.disposed ?? 1, fixture.name);
    assert.equal(observed.freshReads, fixture.reads ?? 1, fixture.name);
    if (fixture.pass) assert.equal(observed.proof.processStartTimeUtc, observed.fullBirth, fixture.name);
    assert.doesNotMatch(JSON.stringify(observed.proof), /processCapability|SafeHandle/, fixture.name);
  }
});

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
    const result = runPowerShell(command);
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
  const result = runPowerShell(command);
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
  const result = runPowerShell(command);
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
    const result = runPowerShell(command);
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
  const result = runPowerShell(command);
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
  assert.match(script, /GetVisibleTopLevelWindows\(\[int\]\$process\.Id\)/);
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
