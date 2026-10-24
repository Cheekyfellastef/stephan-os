import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  WINDOWS_AUTHORITY_STEPHANOS_CORE_DAEMON_PATHS_V1,
  analyzeWindowsAuthorityStephanosCoreDaemonReviewV1,
} from './windowsAuthorityStephanosCoreDaemonReviewV1.mjs';
import { analyzeWindowsAuthoritySpecialistReview } from './windowsAuthoritySpecialistReviewV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const HEAD = 'a'.repeat(40);
const [RUNNER_PATH, STATUS_PATH, HELPER_PATH] = WINDOWS_AUTHORITY_STEPHANOS_CORE_DAEMON_PATHS_V1;

function blobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
}
function source(path, content) {
  return {
    schemaVersion: 'stephanos.windows-authority-source.v1',
    repository: REPOSITORY,
    path,
    ref: HEAD,
    exists: true,
    size: Buffer.byteLength(content, 'utf8'),
    blobSha: blobSha(content),
    content,
  };
}
const analysis = {
  findings: WINDOWS_AUTHORITY_STEPHANOS_CORE_DAEMON_PATHS_V1.map((path) => ({
    severity: 'P0',
    code: 'unsupported-high-risk-surface',
    path,
  })),
};

const runner = await readFile(
  new URL('../../scripts/windows/run-sovereign-commander-hidden.ps1', import.meta.url), 'utf8',
);
const status = await readFile(
  new URL('../../scripts/windows/status-stephanos-core-daemon.ps1', import.meta.url), 'utf8',
);
const helper = await readFile(new URL('../../scripts/windows/stephanos-core-process-observation.ps1', import.meta.url), 'utf8');

function review(runnerSource = runner, statusSource = status, extra = []) {
  return analyzeWindowsAuthorityStephanosCoreDaemonReviewV1({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis,
    sources: [source(RUNNER_PATH, runnerSource), source(STATUS_PATH, statusSource), source(HELPER_PATH, helper), ...extra],
  });
}

test('successor candidate covers the complete Core Windows estate and grants zero authority', () => {
  const result = review();
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true, result.findings.map(x => x.code).join(','));
  assert.deepEqual(result.reviewedPaths, WINDOWS_AUTHORITY_STEPHANOS_CORE_DAEMON_PATHS_V1);
  assert.equal(result.sourceMutationAllowed, false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.runtimeMutationAllowed, false);
  assert.equal(result.providerQualificationAuthority, false);
});

test('top-level candidate specialist plans all three transitive Core sources before fallback', () => {
  const result = analyzeWindowsAuthoritySpecialistReview({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis,
    sources: [source(RUNNER_PATH, runner), source(STATUS_PATH, status), source(HELPER_PATH, helper)],
  });
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true, result.findings.map(x => x.code).join(','));
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_STEPHANOS_CORE_DAEMON_SPECIALIST_CLEAN');
});

test('omitted, duplicated, extra, wrong-head or rehashed altered helpers never inherit the two-consumer qualification', () => {
  const sources = [source(RUNNER_PATH, runner), source(STATUS_PATH, status), source(HELPER_PATH, helper)];
  const invoke = rows => analyzeWindowsAuthorityStephanosCoreDaemonReviewV1({ repository: REPOSITORY,
    sourceHead: HEAD, analysis, sources: rows });
  for (const rows of [sources.slice(0, 2), [...sources, sources[2]],
    [...sources, source('scripts/windows/other.ps1', 'x')],
    [sources[0], sources[1], { ...sources[2], ref: 'b'.repeat(40) }]]) {
    assert.equal(invoke(rows).clean, false);
  }
  for (const altered of [helper + '\nStop-Process -Id 12 -Force',
    helper.replace('$complete = $false', '$complete = $true'),
    helper.replace('else { $null }', 'else { 0 }'),
    helper.replace('-ErrorAction Stop', '-ErrorAction SilentlyContinue'),
    helper + '\n$script:unexpected = 1']) {
    assert.notEqual(altered, helper);
    const result = invoke([sources[0], sources[1], source(HELPER_PATH, altered)]);
    assert.equal(result.clean, false);
    assert.ok(result.findings.some(x => x.code === 'windows-authority-core-source-blob-unreviewed'));
  }
});

test('incomplete inventory and timeout hold cannot be bypassed while safe snippets remain', () => {
  for (const changed of [
    runner.replace('if ($healthBefore.timeoutCustodyHeld -eq $true)', 'if ($false)'),
    runner.replace('elseif ($healthBefore.maintenanceInFlight -eq $true)', 'elseif ($false)'),
    runner.replace('if (-not $coreBeforeComplete -or -not $script:coreProcessObservation.complete)', 'if ($false)'),
    runner.replace('$script:coreProcessObservation.complete -and', '$true -and'),
  ]) {
    assert.notEqual(changed, runner);
    assert.equal(review(changed).clean, false);
  }
});

test('widened execution, process kill, task, Git and writable-status authority fail closed', () => {
  const attacks = [
    [runner + "\nStart-Process -FilePath $canonicalNode -ArgumentList @($callerArgs)", status],
    [runner.replace("Start-Process -FilePath $canonicalNode -ArgumentList @($quotedRelayDaemonScript) -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru", ''), status],
    [runner.replace('Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction Stop', 'Stop-Process -Name node -Force'), status],
    [runner.replace("[string]$_.CommandLine -match $relayDaemonScriptPattern", "($true)"), status],
    [runner.replace('[string]$_.CommandLine -match $relayDaemonScriptPattern', '$true'), status],
    [runner.replace('$relayDaemonScriptPattern = [regex]::Escape($relayDaemonScript)', "$relayDaemonScriptPattern = [regex]::Escape($relayDaemonScript)\n$relayDaemonScriptPattern = '.*'"), status],
    [runner.replace('$age = [math]::Max(0, [int]([DateTimeOffset]::UtcNow - $heartbeat).TotalSeconds)', '$age = 0'), status],
    [runner.replace('$age -le 30 -and', '$age -le 3000 -and'), status],
    [runner.replace('if ($relayBefore.Count -eq 0 -or -not [bool]$relayHealthBefore.healthy)', 'if ($relayBefore.Count -eq 0)'), status],
    [runner.replace('$relayStarted = Start-Process -FilePath $canonicalNode -ArgumentList @($quotedRelayDaemonScript) -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru', '# $relayStarted = Start-Process -FilePath $canonicalNode -ArgumentList @($quotedRelayDaemonScript) -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru'), status],
    [runner.replace('$relayStarted = Start-Process -FilePath $canonicalNode -ArgumentList @($quotedRelayDaemonScript) -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru', '$x = 1 # $relayStarted = Start-Process -FilePath $canonicalNode -ArgumentList @($quotedRelayDaemonScript) -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru'), status],
    [runner.replace('$relayStarted = Start-Process -FilePath $canonicalNode -ArgumentList @($quotedRelayDaemonScript) -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru', '<#\n$relayStarted = Start-Process -FilePath $canonicalNode -ArgumentList @($quotedRelayDaemonScript) -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru\n#>'), status],
    [runner + "\nStart-ScheduledTask -TaskName $TaskName", status],
    [runner + "\nStart-ScheduledTask -TaskName $arbitraryTask", status],
    [runner + "\n$desktopCommanderTaskName = 'Other Task'\nStart-ScheduledTask -TaskName $desktopCommanderTaskName", status],
    [runner, status + "\ngit reset --hard HEAD~1"],
    [runner + "\nInvoke-Expression $env:CORE_COMMAND", status],
    [runner + "\ngit reset --hard HEAD~1", status],
    [runner, status + "\nSet-Content -LiteralPath $statusPath -Value bad"],
    [runner, status + "\nInvoke-RestMethod http://example.invalid"],
  ];
  for (const [runnerSource, statusSource] of attacks) {
    const result = review(runnerSource, statusSource);
    assert.equal(result.clean, false);
    assert.ok(result.findings.length > 0);
  }
});

test('specialist full-source pin blocks attacks outside narrow textual scan windows', () => {
  const attackRows = [
    [
      runner.replace('$coreHealthBefore = Get-StephanosCoreDaemonHealth',
        '$coreHealthBefore = Get-StephanosCoreDaemonHealth\nStop-Process -Id ([int]$coreBefore[0].ProcessId) -Force'),
      status,
    ],
    [
      runner.replace('Start-ScheduledTask -TaskName $desktopCommanderTaskName',
        "$desktopCommanderTaskName = 'Untrusted Task'\nStart-ScheduledTask -TaskName $desktopCommanderTaskName"),
      status,
    ],
    [runner, status + "\n& $gitExe update-ref refs/heads/main $sourceHead"],
    [
      runner,
      status.replace('$healthy = [bool](',
        '$singleWriterProven = $true\n$rescueGenerationPresent = $true\n$healthy = [bool]('),
    ],
  ];
  for (const [changedRunner, changedStatus] of attackRows) {
    assert.ok(changedRunner !== runner || changedStatus !== status);
    const result = review(changedRunner, changedStatus);
    assert.equal(result.clean, false);
    assert.ok(result.findings.some(x => x.code === 'windows-authority-core-source-blob-unreviewed'));
  }
});

test('widened source estate and wrong escalation do not inherit qualification', () => {
  assert.equal(review(runner, status, [source('scripts/windows/other.ps1', 'x')]).clean, false);
  const wrong = analyzeWindowsAuthorityStephanosCoreDaemonReviewV1({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: { findings: [analysis.findings[0]] },
    sources: [source(RUNNER_PATH, runner), source(STATUS_PATH, status)],
  });
  assert.equal(wrong.eligible, false);
});

test('specialist rejects a Core writer mass-recycle even when relay recycle is approved', () => {
  const inserted = runner.replace(
    "$coreDaemonBlocker = 'SOVEREIGN_COMMANDER_CORE_DAEMON_CUSTODY_AMBIGUOUS'",
    "$coreDaemonBlocker = 'SOVEREIGN_COMMANDER_CORE_DAEMON_CUSTODY_AMBIGUOUS'\n  Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction Stop",
  );
  const result = review(inserted, status);
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((x) => x.code === 'windows-authority-core-source-blob-unreviewed'));
});

test('specialist applies no-kill custody invariants to actual checked-in Windows sources', async () => {
  const realRunner = await readFile(new URL('../../scripts/windows/run-sovereign-commander-hidden.ps1', import.meta.url), 'utf8');
  const realStatus = await readFile(new URL('../../scripts/windows/status-stephanos-core-daemon.ps1', import.meta.url), 'utf8');
  const result = review(realRunner, realStatus);
  assert.equal(result.clean, true, result.findings.map(x => x.code).join(','));
});

test('trusted switchboard byte-pins and invokes the Core Daemon specialist', async () => {
  const wrapper = await readFile(new URL('./windowsAuthoritySpecialistReviewV1.mjs', import.meta.url), 'utf8');
  const child = await readFile(new URL('./windowsAuthorityStephanosCoreDaemonReviewV1.mjs', import.meta.url), 'utf8');
  assert.match(wrapper, new RegExp("STEPHANOS_CORE_DAEMON_BLOB_SHA = '" + blobSha(child) + "'"));
  assert.match(wrapper, /analyzeWindowsAuthorityStephanosCoreDaemonReviewV1/);
  assert.ok(wrapper.indexOf('analyzeWindowsAuthorityStephanosCoreDaemonReviewV1')
    < wrapper.lastIndexOf('return base.analyzeWindowsAuthoritySpecialistReview(input)'));
});

test('only the two exact pinned v4 and v6 runner blobs qualify, never an arbitrary default or extra authority', () => {
  const v4 = '2026-10-05-continuous-repair-reporting-v4';
  const v6 = '2026-10-18-island-action-contract-v6';
  // The protected runner may be at either reviewed generation when this
  // reviewer lands. Reconstruct the counterpart from the *observed* source,
  // rather than assuming the checkout still contains v4 after v6 rollout.
  const installedV4 = runner.includes(v4) && !runner.includes(v6);
  const installedV6 = runner.includes(v6) && !runner.includes(v4);
  assert.equal(installedV4 || installedV6, true,
    'checked-in runner must contain exactly one reviewed capability default');
  const candidateV4 = installedV4 ? runner : runner.replace(v6, v4);
  const candidateV6 = installedV6 ? runner : runner.replace(v4, v6);
  assert.notEqual(candidateV4, candidateV6);
  for (const candidate of [candidateV4, candidateV6]) {
    const accepted = review(candidate, status);
    assert.equal(accepted.clean, true, accepted.findings.map(x => x.code).join(','));
  }
  for (const candidate of [
    candidateV6.replace(v6, '2026-10-19-unreviewed-v7'),
    candidateV6 + '\nStart-Process -FilePath $env:USER_COMMAND',
    candidateV6.replace('duplicateLeaseAllowed = $false', 'duplicateLeaseAllowed = $true'),
  ]) {
    const rejected = review(candidate, status);
    assert.equal(rejected.clean, false);
    assert.ok(rejected.findings.some(x => x.code === 'windows-authority-core-source-blob-unreviewed'));
  }
});
