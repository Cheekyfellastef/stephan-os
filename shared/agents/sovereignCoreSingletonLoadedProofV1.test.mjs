import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const run=readFileSync(new URL('../../scripts/windows/run-sovereign-commander-hidden.ps1',import.meta.url),'utf8');
const status=readFileSync(new URL('../../scripts/windows/status-stephanos-core-daemon.ps1',import.meta.url),'utf8');
const reviewer=readFileSync(new URL('./windowsAuthorityStephanosCoreDaemonReviewV1.mjs',import.meta.url),'utf8');
const projection=readFileSync(new URL('./sovereignCommanderRemoteMailboxV1.mjs',import.meta.url),'utf8');
const core=readFileSync(new URL('../../scripts/stephanos-core-daemon.mjs',import.meta.url),'utf8');

test('the existing Commander singleton owner recycles two confirmed Core processes, never forks a second scheduler',()=>{
  assert.match(run,/function Get-StephanosCoreDaemonProcesses \{/);
  assert.match(run,/\.Name -eq 'node\.exe'/);
  assert.match(run,/\[string\]\$_\.CommandLine -match \$coreDaemonScriptPattern/);
  assert.match(run,/if \(\$coreBefore\.Count -gt 1\) \{\s*\$coreHealthBefore\.healthy = \$false/);
  assert.match(run,/if \(\$coreBefore\.Count -eq 0 -or -not \[bool\]\$coreHealthBefore\.healthy\)/);
  assert.match(run,/foreach \(\$process in \$coreBefore\)[\s\S]*Stop-Process -Id \(\[int\]\$process\.ProcessId\) -Force -ErrorAction Stop/);
  assert.match(run,/\$coreDaemonOk = \[bool\]\(\$coreAfter\.Count -eq 1 -and \$coreHealthAfter\.healthy\)/);
  assert.match(run,/\$coreDaemonOk = \[bool\]\(\$coreObserved\.Count -eq 1 -and \$coreObservedHealth\.healthy\)/);
  assert.match(run,/\$coreDaemonBlocker = 'SOVEREIGN_COMMANDER_CORE_DAEMON_STALE_RECYCLE_FAILED'/);
  assert.match(run,/\$coreDaemonStartedPid = \[int\]\$coreStarted\.Id/);
  assert.match(run,/\$coreDaemonScript = Join-Path \$repoRoot 'scripts\\stephanos-core-daemon\.mjs'/);
});

test('Core heartbeat contract rejects old loaded code while retaining gaming/first-cycle bootstrap',()=>{
  assert.match(core,/outerBridgeRunCount: outerBridgeState\.runCount/);
  assert.match(core,/outerBridgeLastVerdict: String\(outerBridgeState\.lastResult\?\.finalVerdict \|\| 'NOT_RUN'\)/);
  assert.match(run,/\$bridgeCountProperty = \$status\.PSObject\.Properties\['outerBridgeRunCount'\]/);
  assert.match(run,/\$bridgeVerdictProperty = \$status\.PSObject\.Properties\['outerBridgeLastVerdict'\]/);
  assert.match(run,/\$bridgeInFlightProperty = \$status\.PSObject\.Properties\['outerBridgeInFlight'\]/);
  assert.match(run,/\$bridgeContractReady -and[\s\S]*\(\$heartbeatFresh -or \$busyGraceActive\)/);
  assert.match(run,/(\$bridgeCountProperty\.Value -is \[int\] -or \$bridgeCountProperty\.Value -is \[long\])/);
  assert.match(run,/\$bridgeCountProperty\.Value -ge 0/);
  assert.match(run,/\$bridgeInFlightProperty\.Value -is \[bool\]/);
  assert.match(run,/\$SkipCoreDaemonLifecycle/);
  assert.doesNotMatch(run,/Start-ScheduledTask.*outer.bridge|Register-ScheduledTask.*outer.bridge/i);
  assert.match(reviewer,/core-daemon-runner-process-identity-not-bounded/);
});

test('both direct Windows status and the authenticated remote projection refuse false-green duplicate Core',()=>{
  assert.match(status,/\$processes\.Count -eq 1 -and/);
  assert.match(status,/\$bridgeContractCurrent -and/);
  assert.match(status,/singleInstanceProven = \[bool\]\(\$processes\.Count -eq 1\)/);
  assert.match(status,/outerBridgeRunCount = \$outerBridgeRunCount/);
  assert.match(projection,/singleInstanceProven: parsed\.singleInstanceProven === true && Number\(parsed\.processCount\) === 1/);
  assert.match(projection,/bridgeContractCurrent: parsed\.bridgeContractCurrent === true/);
  assert.match(projection,/coreDaemonStatus\?\.singleInstanceProven === true/);
  assert.match(projection,/coreDaemonStatus\?\.bridgeContractCurrent === true/);
  assert.match(projection,/outerBridgeRunCount: Number\.isSafeInteger\(parsed\.outerBridgeRunCount\)/);
});
