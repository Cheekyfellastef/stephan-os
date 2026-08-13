import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import {
  WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V1,
  analyzeWindowsAuthorityWorkerWatchdogReview,
} from './windowsAuthorityWorkerWatchdogReviewV1.mjs';

const repository = 'Cheekyfellastef/stephan-os';
const prNumber = 1732;
const branch = 'agent/watchdog-control-plane-bootstrap-recovery-v1';
const head = '707f7db9964b5e100aab21d6735108a4c5e53457';
const blob = (content) => { const bytes = Buffer.from(content); return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'); };
const record = (path, content) => ({ schemaVersion: 'stephanos.windows-authority-source.v1', repository, path, ref: head, exists: true, size: Buffer.byteLength(content), blobSha: blob(content), content });
const analysis = { findings: WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V1.map((path) => ({ severity: 'P0', code: 'unsupported-high-risk-surface', path })) };
const fixedPowerShellInvocation = [
  '$restartArguments = @(',
  "'-NoProfile',",
  "'-NonInteractive',",
  "'-ExecutionPolicy',",
  "'Bypass',",
  "'-File',",
  '$runtimeRestartPath,',
  "'-Target',",
  "'mission-worker',",
  "'-ExpectedHead',",
  '$repositoryHead,',
  "'-TimeoutSeconds',",
  "'30'",
  ')',
  '$restartOutput = @(& $canonicalPowerShell @restartArguments 2>&1)',
].join('\n');
const fixedGitInvocationEstate = [
  'function Read-PublicMainHead {',
  '  param([string]$GitExecutable)',
  "  $output = @(& $GitExecutable 'ls-remote' '--exit-code' $publicRemote 'refs/heads/main' 2>&1)",
  '}',
  '$remoteMainHead = Read-PublicMainHead -GitExecutable $canonicalGit',
  "$repositoryBranchOutput = @(& $canonicalGit -C $repositoryRoot symbolic-ref --quiet --short HEAD 2>&1)",
  "$repositoryHeadOutput = @(& $canonicalGit -C $repositoryRoot rev-parse --verify HEAD 2>&1)",
  "$trackedStatus = @(& $canonicalGit -C $repositoryRoot status '--porcelain=v1' '--untracked-files=no' 2>&1)",
  '$remoteMainHeadAfterRestart = Read-PublicMainHead -GitExecutable $canonicalGit',
  "$repositoryBranchAfterRestart = ([string](@(& $canonicalGit -C $repositoryRoot symbolic-ref --quiet --short HEAD 2>&1))[0]).Trim()",
  "$repositoryHeadAfterRestart = ([string](@(& $canonicalGit -C $repositoryRoot rev-parse --verify HEAD 2>&1))[0]).Trim().ToLowerInvariant()",
  "$trackedStatusAfterRestart = @(& $canonicalGit -C $repositoryRoot status '--porcelain=v1' '--untracked-files=no' 2>&1)",
].join('\n');

const syntheticFixtures = Object.freeze({
  [WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V1[0]]: [
    "[ValidateSet('Inspect', 'StartApprovedWorkerTask')]", "$canonicalGit = 'C:\\Program Files\\Git\\cmd\\git.exe'", "$canonicalPowerShell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'", '$runtimeRestartPath = [System.IO.Path]::GetFullPath((Join-Path $repositoryRoot \'scripts\\windows\\restart-approved-stephanos-runtime.ps1\'))', "$publicRemote = 'https://github.com/Cheekyfellastef/stephan-os.git'", 'function Test-CanonicalWorkerTaskAction {}', 'function ConvertFrom-WindowsCommandLine {}', 'function Test-CanonicalWorkerProcessCommandLine {}', 'foreach ($requiredExecutable in @($canonicalGit, $canonicalPowerShell)) {}', fixedGitInvocationEstate, 'Test-Path -LiteralPath $runtimeRestartPath -PathType Leaf', fixedPowerShellInvocation, '$restartReceipt.exactHeadProofOk -eq $true', '$restartReceipt.proofFresh -eq $true',
  ].join('\n'),
  [WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V1[1]]: [
    'if (-not $git) { $git = Get-Command git }',
    "[ValidateSet('backend', 'mission-worker')]", '$git = Get-Command git.exe', "$canonicalGit = 'C:\\Program Files\\Git\\cmd\\git.exe'", 'function Stop-WithBlocker {}', 'function Get-CanonicalTaskPlan {}', 'function Wait-Until { param($Condition); if (& $Condition) {} }', 'function Test-BackendHealth {}', 'function Get-VerifiedBackendListener {}', 'function Read-FreshBackendReceipt {}', 'function Get-VerifiedWorkerProcessFromHeartbeat {}', 'function Read-FreshWorkerHeartbeat {}', '& $git.Source -C $repoRoot branch --show-current', '& $git.Source -C $repoRoot rev-parse HEAD', "@(& $canonicalGit -C $repoRoot status '--porcelain=v1' '--untracked-files=no')", 'CANONICAL_TRACKED_SOURCE_DIRTY', "Start-ScheduledTask -TaskName $plan.TaskName -TaskPath '\\'", 'CANONICAL_TRACKED_SOURCE_CHANGED_DURING_WORKER_START', "Stop-ScheduledTask -TaskName $plan.TaskName -TaskPath '\\' -ErrorAction SilentlyContinue", 'Get-VerifiedWorkerProcessFromHeartbeat', 'Stop-Process -Id $startedWorker.ProcessId', "@(& $canonicalGit -C $repoRoot status '--porcelain=v1' '--untracked-files=no')", 'headSha -ne $ExpectedSourceHead', 'MISSION_WORKER_EXACT_HEAD_HEARTBEAT_TIMEOUT',
  ].join('\n'),
  [WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V1[2]]: [
    "$canonicalNode = 'C:\\Program Files\\nodejs\\node.exe'", "$canonicalGit = 'C:\\Program Files\\Git\\cmd\\git.exe'", "$workerScript = Join-Path $repositoryRoot 'scripts\\mission-orchestrator-worker-supervised.mjs'", '@(& $canonicalGit -C $repositoryRoot branch --show-current)', "$branch -ne 'main'", '@(& $canonicalGit -C $repositoryRoot rev-parse HEAD)', "@(& $canonicalGit -C $repositoryRoot status '--porcelain=v1' '--untracked-files=no')", 'tracked-clean exact-head source', "@(& $canonicalGit 'ls-remote' '--exit-code' $publicRemote 'refs/heads/main')", 'exact current public main head', '& $canonicalNode $workerScript',
  ].join('\n'),
});

const canonicalSource = (encoded) => gunzipSync(Buffer.from(encoded, 'base64')).toString('utf8');
const fixtures = Object.freeze({
'scripts/windows/probe-mission-orchestrator-worker-watchdog.ps1': canonicalSource('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'),
'scripts/windows/restart-approved-stephanos-runtime.ps1': canonicalSource('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'),
  'scripts/windows/start-mission-orchestrator-worker.ps1': canonicalSource('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'),
});

const supersededFixtures = Object.freeze({
  'scripts/windows/probe-mission-orchestrator-worker-watchdog.ps1': canonicalSource('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'),
  'scripts/windows/restart-approved-stephanos-runtime.ps1': canonicalSource('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'),
});

const review = (overrides = {}) => analyzeWindowsAuthorityWorkerWatchdogReview({ repository, prNumber, branch, sourceHead: head, analysis, sources: Object.entries(fixtures).map(([path, content]) => record(path, content)), ...overrides });
const codes = (result) => result.findings.map((item) => item.code);
const withProbe = (probe) => Object.entries({
  ...fixtures,
  [WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V1[0]]: probe,
}).map(([path, content]) => record(path, content));
const withPath = (index, source) => Object.entries({
  ...fixtures,
  [WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V1[index]]: source,
}).map(([path, content]) => record(path, content));

test('owns exactly the three worker-watchdog authority paths and accepts their bounded contract', () => {
  assert.deepEqual(WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V1, [
    'scripts/windows/probe-mission-orchestrator-worker-watchdog.ps1',
    'scripts/windows/restart-approved-stephanos-runtime.ps1',
    'scripts/windows/start-mission-orchestrator-worker.ps1',
  ]);
  const result = review();
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true, JSON.stringify(result.findings));
  assert.equal(result.proofRefs.length, 3);
});

test('jointly binds the exact independently supplied PR identity and prepared source estate', () => {
  const mismatches = [
    { repository: 'Cheekyfellastef/other-repository' },
    { prNumber: 1731 },
    { prNumber: '1732' },
    { branch: 'agent/watchdog-control-plane-bootstrap-recovery-v2' },
    { sourceHead: 'a'.repeat(40) },
    { sourceHead: 'a840305054393a8bd50966d2c3b500e0b4816bfb' },
    { sourceHead: 'bdae956a7e6e448c67728aea53d3d6e77ff4d61f' },
  ];
  for (const mismatch of mismatches) {
    const result = review(mismatch);
    assert.equal(result.eligible, true);
    assert.equal(result.clean, false);
    assert.ok(codes(result).includes('windows-authority-reviewed-identity-mismatch'));
  }
});

test('missing, coerced or caller-manufactured identity values fail closed without falling through', () => {
  const cases = [
    { prNumber: undefined },
    { branch: undefined },
    { repository: new String(repository) },
    { branch: new String(branch) },
    { sourceHead: { toString: () => head } },
  ];
  for (const candidate of cases) {
    const result = review(candidate);
    assert.equal(result.eligible, true);
    assert.equal(result.clean, false);
    assert.ok(codes(result).includes('windows-authority-reviewed-identity-mismatch'));
  }
});

test('identity and exact content are jointly required and cannot override one another', () => {
  const changedSources = Object.entries(fixtures).map(([path, content]) => record(path, content));
  changedSources[0].content = `${changedSources[0].content}\n# changed`;
  changedSources[0].size = Buffer.byteLength(changedSources[0].content);
  changedSources[0].blobSha = blob(changedSources[0].content);
  const changedContent = review({ sources: changedSources });
  assert.equal(changedContent.clean, false);
  assert.ok(codes(changedContent).includes('windows-authority-source-not-reviewed'));

  const changedIdentity = review({ sourceHead: 'a'.repeat(40) });
  assert.equal(changedIdentity.clean, false);
  assert.ok(codes(changedIdentity).includes('windows-authority-reviewed-identity-mismatch'));
});

test('rejects partial, widened or non-watchdog escalation estates', () => {
  for (const paths of [
    WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V1.slice(0, 2),
    [...WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V1, 'scripts/windows/other.ps1'],
  ]) {
    const result = review({ analysis: { findings: paths.map((path) => ({ severity: 'P0', code: 'unsupported-high-risk-surface', path })) } });
    assert.equal(result.eligible, false);
  }
});

test('rejects unbound source evidence', () => {
  const sources = Object.entries(fixtures).map(([path, content]) => record(path, content));
  sources[0].blobSha = 'b'.repeat(40);
  assert.ok(codes(review({ sources })).includes('windows-authority-source-evidence-invalid'));
});

test('rejects each removed exact-head, clean-source, fixed-executable or owned-cleanup invariant', () => {
  const mutations = [
    [0, "$canonicalGit = 'C:\\Program Files\\Git\\cmd\\git.exe'", '$git = Get-Command git', 'watchdog-probe-git-not-fixed'],
    [0, '$restartReceipt.postStartSourceProofOk -eq $true', '$false', 'watchdog-probe-clean-recheck-missing'],
    [1, "-Phase 'PRE_START'", "-Phase 'POST_START'", 'watchdog-restart-clean-boundary-incomplete'],
    [1, 'Stop-NewlyStartedOwnedWorker `', '# cleanup removed', 'watchdog-restart-dirty-cleanup-missing'],
    [2, "status '--porcelain=v1' '--untracked-files=no'", '', 'watchdog-launcher-clean-proof-missing'],
    [2, '& $canonicalNode $workerScript', '& node $env:CALLER_SCRIPT', 'watchdog-launcher-node-invocation-not-fixed'],
  ];
  for (const [index, from, to, expected] of mutations) {
    const changed = { ...fixtures, [WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V1[index]]: fixtures[WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V1[index]].replace(from, to) };
    const result = review({ sources: Object.entries(changed).map(([path, content]) => record(path, content)) });
    assert.equal(result.clean, false, expected);
    assert.ok(codes(result).includes('windows-authority-source-not-reviewed'), expected);
  }
});

test('requires every prepared public-main, worker-identity and cleanup lifecycle invariant', () => {
  const cases = [
    [0, '[string]$restartReceipt.publicMainHead -eq $repositoryHead', '$false', 'watchdog-probe-receipt-proof-incomplete'],
    [0, '$restartReceipt.postStartSourceProofOk -eq $true', '$false', 'watchdog-probe-clean-recheck-missing'],
    [0, '$restartReceipt.cleanupAttempted -eq $false', '$false', 'watchdog-probe-receipt-proof-incomplete'],
    [1, 'Get-Item -LiteralPath $canonicalGit -Force', 'Get-Item -LiteralPath $env:GIT -Force', 'watchdog-restart-git-identity-incomplete'],
    [1, '$canonicalGitItem.LinkType', '$false', 'watchdog-restart-git-identity-incomplete'],
    [1, "-Phase 'PRE_START'", "-Phase 'POST_START'", 'watchdog-restart-clean-boundary-incomplete'],
    [1, 'Read-PublicMainHead -GitExecutable $GitExecutable', '$ExpectedSourceHead', 'watchdog-restart-source-proof-incomplete'],
    [1, '$processStartedAtUtc -le $StartedAfterUtc', '$false', 'watchdog-restart-worker-identity-incomplete'],
    [1, '[string]$Plan.TaskName -ne \'Stephanos Mission Orchestrator Worker\'', '$false', 'watchdog-restart-cleanup-identity-incomplete'],
    [1, 'Stop-NewlyStartedOwnedWorker `', '# cleanup removed', 'watchdog-restart-dirty-cleanup-missing'],
    [1, 'Stop-WithBlocker $cleanupBlocker', '# cleanup failure ignored', 'watchdog-restart-dirty-cleanup-missing'],
  ];
  for (const [index, from, to, expected] of cases) {
    const path = WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V1[index];
    const changed = fixtures[path].replace(from, to);
    assert.notEqual(changed, fixtures[path], `${expected}: fixture mutation missing`);
    const result = review({ sources: withPath(index, changed) });
    assert.equal(result.clean, false, expected);
    assert.ok(codes(result).includes('windows-authority-source-not-reviewed'), expected);
    assert.ok(codes(result).includes(expected), expected);
  }
});

test('rejects caller-controlled PowerShell command and script-block execution', () => {
  const probe = fixtures[WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V1[0]];
  for (const widened of [
    "param([string]$Command)\n& $canonicalPowerShell -Command $Command",
    "param([string]$Encoded)\n& $canonicalPowerShell -EncodedCommand $Encoded",
    'param([scriptblock]$Action)\n& $Action',
    "$switch = '-' + 'Command'\n& $canonicalPowerShell $switch $Command",
    '$shell = $canonicalPowerShell\n& $shell $Command',
    "param([string]$Command)\n$shell = [string]$canonicalPowerShell\n$mode = [string]::Concat('-', 'Command')\n& $shell $mode $Command",
    '$copy = $canonicalPowerShell\n$alias = [string]$copy\n& $alias $Command',
    '& ([string]$canonicalPowerShell) -Command $Command',
    '. $canonicalPowerShell -Command $Command',
    'Set-Alias -Name approved -Value $canonicalPowerShell\napproved -Command $Command',
    'iex $Command',
    'icm $Action',
    '[System.Diagnostics.Process]::Start($Command)',
    '(New-Object -ComObject WScript.Shell).Run($Command)',
  ]) {
    const result = review({ sources: withProbe(`${probe}\n${widened}`) });
    assert.ok(
      codes(result).includes('watchdog-probe-powershell-execution-widened'),
      widened,
    );
  }
});

test('required literals in comments or dead code cannot conceal widened execution', () => {
  const probe = fixtures[WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V1[0]];
  const commentedOnly = `${probe}\n<#\n${fixedPowerShellInvocation}\n#>\nInvoke-Item $env:CALLER_COMMAND`;
  const deadWidening = `${probe}\nif ($false) { & $canonicalPowerShell -Command $Command }`;

  for (const source of [commentedOnly, deadWidening]) {
    const result = review({ sources: withProbe(source) });
    assert.ok(codes(result).includes('windows-authority-source-not-reviewed'));
  }
});

test('rejects every executable call-operator addition outside the fixed invocation estate', () => {
  const probe = fixtures[WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V1[0]];
  for (const widened of [
    '& $canonicalGit --version',
    '& $GitExecutable --version',
    '& $runtimeRestartPath',
    '& ${canonicalPowerShell} -File $runtimeRestartPath',
    '& "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command $Command',
  ]) {
    const result = review({ sources: withProbe(`${probe}\n${widened}`) });
    assert.ok(codes(result).includes('watchdog-probe-powershell-execution-widened'), widened);
  }
});

test('rejects malformed, interpolated or unsupported PowerShell lexical forms', () => {
  const probe = fixtures[WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V1[0]];
  for (const widened of [
    "'unterminated",
    '"unterminated',
    '<# unterminated',
    '@\'unsupported here string',
    '"$(& $canonicalPowerShell -Command $Command)"',
    '"$(\')\' + (& $env:CALLER_COMMAND))"',
    '`',
  ]) {
    const result = review({ sources: withProbe(`${probe}\n${widened}`) });
    assert.ok(codes(result).includes('watchdog-probe-powershell-execution-widened'), widened);
  }
});

test('rejects every appended here string regardless of its lexical classification', () => {
  const probe = fixtures[WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V1[0]];
  const inert = `${probe}\n$definition = @'\nliteral C# & $notExecutable\n'@`;
  assert.ok(codes(review({ sources: withProbe(inert) })).includes('windows-authority-source-not-reviewed'));
  const expandable = `${probe}\n$definition = @\"\n$(& $canonicalPowerShell -Command $Command)\n\"@`;
  assert.ok(codes(review({ sources: withProbe(expandable) })).includes('windows-authority-source-not-reviewed'));
});

test('rejects reassignment or mutation of fixed executable and argument bindings', () => {
  const probe = fixtures[WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V1[0]];
  for (const widened of [
    '$canonicalGit = $canonicalPowerShell',
    '$canonicalPowerShell = $canonicalGit',
    '$runtimeRestartPath = $Command',
    '$restartArguments += $Command',
    '$restartArguments = @($Command)',
    '$GitExecutable = $canonicalPowerShell',
    'Read-PublicMainHead -GitExecutable $canonicalPowerShell',
  ]) {
    const result = review({ sources: withProbe(`${probe}\n${widened}`) });
    assert.ok(codes(result).includes('watchdog-probe-powershell-execution-widened'), widened);
  }
});

test('rejects rewiring any fixed call while preserving raw variable counts', () => {
  const probe = fixtures[WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V1[0]];
  for (const changed of [
    probe.replace("@($canonicalGit, $canonicalPowerShell)", '@($canonicalPowerShell, $canonicalGit)'),
    probe.replace("symbolic-ref --quiet --short HEAD", 'rev-parse --verify $Command'),
    probe.replace("status '--porcelain=v1' '--untracked-files=no'", 'status $Command'),
    probe.replace("'scripts\\windows\\restart-approved-stephanos-runtime.ps1'", '$Command'),
    probe.replace('Test-Path -LiteralPath $runtimeRestartPath -PathType Leaf', 'Test-Path -LiteralPath $Command -PathType Leaf'),
  ]) {
    const result = review({ sources: withProbe(changed) });
    assert.ok(codes(result).includes('watchdog-probe-powershell-execution-widened'));
  }
});

test('accepts exactly one fixed reviewed PowerShell -File adapter invocation', () => {
  const probe = fixtures[WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V1[0]];
  const result = review({ sources: withProbe(probe) });
  assert.equal(result.clean, true, JSON.stringify(result.findings));
  assert.equal((probe.match(/&\s+\$canonicalPowerShell\b/g) ?? []).length, 1);
  assert.match(probe, /'-File',\s*\$runtimeRestartPath/);
});

test('applies one positive execution estate to probe, restart adapter and launcher', () => {
  const attacks = [
    '& $env:CALLER_COMMAND',
    '& $additionalTarget',
    'Set-Variable -Name canonicalPowerShell -Value $env:CALLER_COMMAND',
    'Set-Item variable:canonicalGit $env:CALLER_COMMAND',
    'New-Variable -Name canonicalNode -Value $env:CALLER_COMMAND',
    '$script:canonicalGit = $env:CALLER_COMMAND',
    'Set-Alias approved $env:CALLER_COMMAND',
    '$ExecutionContext.InvokeCommand.InvokeScript($env:CALLER_COMMAND)',
    'Get-Variable canonicalGit | ForEach-Object { $_.Value = $env:CALLER_COMMAND }',
    'cmd.exe /c $env:CALLER_COMMAND',
  ];
  for (let index = 0; index < WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V1.length; index += 1) {
    const original = fixtures[WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V1[index]];
    for (const attack of attacks) {
      const result = review({ sources: withPath(index, `${original}\n${attack}`) });
      assert.ok(codes(result).includes('watchdog-powershell-execution-estate-invalid'), `${index}: ${attack}`);
    }
  }
});

test('rejects copied, cast, constructed and extra invocation routes in restart and launcher', () => {
  for (const index of [1, 2]) {
    const original = fixtures[WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V1[index]];
    for (const attack of [
      '$shell = [string]$canonicalPowerShell\n$mode = [string]::Concat(\'-\', \'Command\')\n& $shell $mode $Command',
      '$copy = $canonicalNode\n& $copy $env:CALLER_SCRIPT',
      '& ([string]$canonicalGit) $env:CALLER_ARGUMENTS',
      'if ($false) { & $env:CALLER_COMMAND }',
    ]) {
      const result = review({ sources: withPath(index, `${original}\n${attack}`) });
      assert.ok(codes(result).includes('watchdog-powershell-execution-estate-invalid'), `${index}: ${attack}`);
    }
    const bindingAttack = index === 1
      ? '$canonicalGit = $env:CALLER_COMMAND'
      : '$workerScript = $env:CALLER_SCRIPT';
    const result = review({ sources: withPath(index, `${original}\n${bindingAttack}`) });
    assert.ok(codes(result).includes('watchdog-powershell-execution-estate-invalid'), `${index}: ${bindingAttack}`);
  }
});

test('rejects function wrappers, malformed syntax and mutation hidden beside inert text', () => {
  const restart = fixtures[WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V1[1]];
  for (const attack of [
    'function Invoke-Caller { & $env:CALLER_COMMAND }',
    "'unterminated",
    '<# unterminated',
    '"fixed invocation"\nSet-Variable -Name canonicalGit -Value $env:CALLER_COMMAND',
  ]) {
    const result = review({ sources: withPath(1, `${restart}\n${attack}`) });
    assert.ok(codes(result).includes('watchdog-powershell-execution-estate-invalid'), attack);
  }
});

test('binds the accepted estate to the exact independently reviewed blobs and byte sizes', () => {
  const expected = [
    ['4167e76e0b79d3986712b590c6fe49fe9bb3ba85', 15375],
    ['98223fd525f4777de0dee009540238d9fdfe3487', 25782],
    ['cac4b824c6656e4f45cda405cf807afddb8b1441', 5213],
  ];
  for (const [index, path] of WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V1.entries()) {
    assert.equal(blob(fixtures[path]), expected[index][0]);
    assert.equal(Buffer.byteLength(fixtures[path], 'utf8'), expected[index][1]);
  }
  assert.equal(review().clean, true);
});

test('rejects the superseded reviewed probe and restart identities', () => {
  const expectedSuperseded = [
    ['5d1792a8e6090f38b0013670af717b3e07f98fa5', 15403],
    ['a8a96092a22ad6f40e33e8bbe4c04a90e880ab85', 14058],
  ];
  for (const [index, path] of WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V1.slice(0, 2).entries()) {
    const content = supersededFixtures[path];
    assert.equal(blob(content), expectedSuperseded[index][0]);
    assert.equal(Buffer.byteLength(content, 'utf8'), expectedSuperseded[index][1]);
    const result = review({ sources: withPath(index, content) });
    assert.equal(result.clean, false);
    assert.ok(codes(result).includes('windows-authority-source-not-reviewed'));
  }
});

test('rejects every changed source byte even when semantic inspection would accept it', () => {
  const mutations = [
    '\nInvoke-Item $env:CALLER_COMMAND',
    '\nStart-Process $env:CALLER_COMMAND',
    '\n& $env:CALLER_COMMAND',
    '\nfunction Invoke-Caller { & $env:CALLER_COMMAND }',
    '\n[System.Diagnostics.Process]::Start($env:CALLER_COMMAND)',
    '\nSet-Item variable:canonicalPowerShell $env:CALLER_COMMAND',
    '\n$mode = "-" + "Command"',
    '\n}',
    '\n(',
    '\n"unterminated',
    '\n@"\nunterminated',
    '\n# harmless semantic comment',
  ];
  for (const mutation of mutations) {
    const result = review({ sources: withPath(0, `${fixtures[WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V1[0]]}${mutation}`) });
    assert.equal(result.clean, false, mutation);
    assert.ok(codes(result).includes('windows-authority-source-not-reviewed'), mutation);
  }
});

test('rejects whitespace, line-ending and encoding changes to a reviewed source', () => {
  const path = WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V1[0];
  const original = fixtures[path];
  for (const changed of [
    `${original} `,
    original.replace(/\r?\n/g, '\r\n'),
    `\uFEFF${original}`,
  ]) {
    const result = review({ sources: withPath(0, changed) });
    assert.ok(codes(result).includes('windows-authority-source-not-reviewed'));
  }
});

test('rejects missing, duplicate, reordered, sparse and widened source estates', () => {
  const sources = Object.entries(fixtures).map(([path, content]) => record(path, content));
  const sparse = [...sources];
  delete sparse[1];
  const widened = [...sources];
  widened.extra = sources[0];
  for (const candidate of [
    sources.slice(0, 2),
    [sources[0], sources[0], sources[2]],
    [sources[1], sources[0], sources[2]],
    [...sources, sources[0]],
    sparse,
    widened,
  ]) {
    const result = review({ sources: candidate });
    assert.equal(result.clean, false);
    assert.ok(codes(result).includes('windows-authority-source-estate-invalid'));
  }
});

test('rejects changed content despite self-reported reviewed blob and size values', () => {
  const sources = Object.entries(fixtures).map(([path, content]) => record(path, content));
  sources[0].content = `${sources[0].content}\nInvoke-Item $env:CALLER_COMMAND`;
  const result = review({ sources });
  assert.equal(result.clean, false);
  assert.ok(codes(result).includes('windows-authority-source-evidence-invalid'));
});

test('rejects widened source records and provides no alternate manifest identity', async () => {
  const variants = [
    (source) => { source.alternateBlobSha = source.blobSha; },
    (source) => { Object.defineProperty(source, 'hiddenAuthority', { value: true }); },
    (source) => { source[Symbol('authority')] = true; },
    (source) => { Object.defineProperty(source, 'content', { get: () => fixtures[source.path], enumerable: true }); },
  ];
  for (const widen of variants) {
    const sources = Object.entries(fixtures).map(([path, content]) => record(path, content));
    widen(sources[0]);
    const result = review({ sources });
    assert.equal(result.clean, false);
    assert.ok(codes(result).includes('windows-authority-source-evidence-invalid'));
  }
  const { readFile } = await import('node:fs/promises');
  const moduleSource = await readFile(new URL('./windowsAuthorityWorkerWatchdogReviewV1.mjs', import.meta.url), 'utf8');
  assert.equal((moduleSource.match(/const REVIEWED_SOURCE_MANIFEST\b/g) ?? []).length, 1);
  assert.doesNotMatch(moduleSource, /alternate(?:Source|Blob|Manifest)|fallback(?:Source|Blob|Manifest)/i);
});

test('top-level specialist pins and routes the watchdog reviewer before the legacy core', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('./windowsAuthoritySpecialistReviewV1.mjs', import.meta.url), 'utf8');
  assert.match(source, /WORKER_WATCHDOG_BLOB_SHA = '8b7ed1328af57cf00792dc4ce2ecc03bf43e9c7a'/);
  assert.ok(source.indexOf('analyzeWindowsAuthorityWorkerWatchdogReview') < source.indexOf('core.analyzeWindowsAuthoritySpecialistReview'));
});
