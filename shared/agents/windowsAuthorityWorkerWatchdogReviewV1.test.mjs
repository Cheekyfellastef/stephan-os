import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import {
  WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V1,
  analyzeWindowsAuthorityWorkerWatchdogReview,
} from './windowsAuthorityWorkerWatchdogReviewV1.mjs';

const repository = 'Cheekyfellastef/stephan-os';
const head = 'a'.repeat(40);
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
'scripts/windows/probe-mission-orchestrator-worker-watchdog.ps1': canonicalSource('H4sIAAAAAAAACsVbbW/buhX+7l9BFMaVvUZu2t4Bm4sMTdOkN3d5MWK3HeZ4HSMd22wlUiUpp15v/vtAUi+kTDlO2mH9UCQizysPz3l4yEyP0jgB+YbQmNBFrz/rZJjjtNdBCKHpB5yQGEsYg+wFp1RkEMlgDwVjibk8zDLOVhB/ZPwL8AkWX4L+zNAJyQldzLrnLAZ0gCrSTr/T6R5zzvhhJAmjIw5z4EAjPWssWRZ0uiPOFhyEaAySBKhM1keMSkJzCDpjkOFYchJJLSb8AFwQRtEZliBkp9OVWHy5wGnBG7IlpkygcyL0tEseLUFIjiXjyNgQdMgc9ULKJOoCXQ3fj4+vRleXJ6dnx330XZsml5zdosAaQUQgDl9zwiFGkiEOgiUrQBGmjJIIJ+hWM0e3WEbLmC1QhuVSDILOXafLIWOCSMbXV4xJdICm47WQkA5OLwcjLJez4fAdyJM8SdRvvd7vjNBQ/bihIAresihPgUpx/Y7I3/Kba2FsDpkI+v1O16ihiR8ip6FiICJOMimuU+PHkFl+DI2MUOQZ8BUREA/Sz7b0M5zTaPkTtbglNGa34lqoiAy36DTIxHOtCM+pJClcgSb56YpwwzfExe4IRRl5YSG50sSQJCDE/8wtPKeWAiJaQpwnEIdqa4S1/MHqxqxSFbTviIrG4Gh4rbcjTtEJSUCH1nWUxtcLIgfwDQKLZMRugY+XkCQF5cdCCWPNyxflh3ri9er5YP86U78L9XvBMstvEhJdQcqk3rxLKTMxfPZsQeQyvxlELH12tAT4sp5DkmAhYf6sjvXBgsjAxJvIcAQ/c2NVWSRkGdAowbdhJUf7bwmYyxvAZVxZbF2FAiGxzLfvoorZ4LNgNDAJDR2gdyrxlUup8i4KJ2Wqq5NeaOVZ1Myenc48p2ZoAkKGR+Ui1sm8oDRpzxSFKbv5DJGcdR3p/Y6eUqdOdxR9RxxkzinqznEiAN1V06s64VAMKmNCahn0SEba+YpRcB1sY+FRfWBcIFDIeMvQ4IjlVGr+z33cNfsuNq48aGEy3TdlswvfIMp1yFcGGdLBsRkx0yKWppjGZ4T6ph7yhYlWh+cZ4HnrLiAJKA/3ysn9yisOufbirUkxeqdusbhUAh2g170jRlfA5QlnaVjkgCPLhtD+xbbO0qNiaHn8151CoqKc7s+MCc+evdkaCh7S5xXpBTtjC9ZKL/m62DLaD+xGAF9B/KAE75H/YmZ8YYRECklYYhxFrHlVXJcch8PjrzlORM+r2B5qKUl7lcJjzeeIpRnmRDA6Gw4veUwoTk4XlHE4wgL6bb4pvnnMezlDIXxFQZkNbws4dmflqXuCyMlTpYQjO5Y21nc4PBUXeZJc8o9LImGsknPPobEsed3rN73aq1HlwKK6wJKsIEAhFmgq1xnM+n1rsQ7jOJysM0D6/7cwJ5RoA18HnVwQukDG16+c3wZXBXg4pRI4y8YKX0UgXnUoTkHXFVRj3MIZuowiVWlIhKIEC4E29LQ0m75NktM0Y1z2nuhy/PLFIE6SJ3toDPIMC6krCjpAkudQQP1NOfBNAqfolMqR5La8CTvki9XHXkWnZZ5jLpY4ORS99zTFFC8gVn4ZnI0+jiXvz5BZLGSlhT2HA8slIlSiMpp0fui/8lr1BTiF0qwdLThjEU5OOECv+JBCyvi6kHDXuesEr4sf3dxnEtUB2q8+r0aMqOXTGaA9dGbDocdtdmDuoSmH+cwV5WbLSpbaWFOj+mw4/CdwZuqZq2aYANrfCHdfSrNT+wXchpcaExTLNJ01GFd0c8ZRr0toDN+UT16h4ucwkQ2ScujpU3vbaNlEQmr5sGVPDIqYmg2HV4BjY7sbds0V2dscNer9yfLdmPwHnHn9TpNfkc8M8Ww3HUeST5hJrO8p6dlG1gLuNpI9duq8GZ+rTJzYyzVdMRLP7om2OsRtn/SrAN8OFkecRSBak3GtSokeC4La57583TEObuCzglRH8KPSuFOQfgSmHO0GUxKJXrTDpAJdFajAU649llXOKnxRYEN8k2g+Tq25Z65ZYARKJQ+RjZysIHsUpNSqtcFKJonKOAFlMWhguYf0z4F35XxJyYDSEvo+BmE9fzDC8mGaCmC1qVYHvdWPsXbCA3BWsUPs7anSXTjSxewcE/ob4NgPjN4RWYdCscu6LJdZLvVW+AW5U1CQiJDrA3mAgjCEb0SGkVoi5J7WAw5z8WwJOBbPUkxogF787Zfn1sqfHY4nx/84nRxdvj3WmHrfDljTXusFCyJRJRHNMUkgHqLv+3cBCueo1yt1/QOdMH6Mo2VZhr7X4fsJ3fVR+JkRigKkTudWCKdqfQldqO1rNn/N8eMSOHj5hZoMBf+a7od/xeH8MDyZff91/+5aPG2Y3Q3QnWW0I65xZmzYHkyWUOIRxQnVXdCYxEilh7LDKBmCbziSyRoxChohETkIbDvnBJJYGVgvvaPLdH/WH0w4SXt9FIosIRIF1+JpUKtuOFg6vzDwwXyvDkYby25P0gcvJlu81w0e5AUOImNUgOq7pjiZM55C7FhdbdZS+mDCzlSP6ZSuMCeYyp7eNrq1YM7g50o1EI3Khg7u6440+jCaY8du677hmEYquQeB/VnvzObHCcfRF4iPEsC6WWCSTYNKbfEShxtytUWq3e772CRZEHm4wiTRG7uSU2fUOeOAoyXqdcu+tpUIdKZ2+oR7yNcDdOpQfWTS/jQ9mTMigeOkbGRuSNLT9ElJlYl+EwyWqeKq7L3XDXew1BVIHyrpok4fHmFNoFVsn6an1MHHjDRX+NLJnU4bNTza6NOKdXrDEhKFHOYoDL/mBCQKQ7FkXKLfjg/fPj5rOqw9ibNF8ccmUk+k16nGL8vKOU0eKlof5kkOqzDDXAAKwxVwMl//oP9qhludZ2n6464rdq7PcbUcy22+fFaZurEiOj9bSbkh15OZ29NylQlRzQXdaDk6+6OMMzZXu47Qlbo8dMuRNBlurHvfO28WMzsIw4zxCBJM6MHquYYhOS04hnN1O3FA2Q/gjUKOZ9ldtR+53lobh5NVVD1K+X1dMECC5TzS6S0mXK5dN7eXFJ3A7jo2vG0pVv4Q3RzwFy0PtV2Fup8Gx98iyHTD+hyEwAullnaRnXOrW1cX7W/UPB/uDV0A64TZFqTvLagtg/eahMoDtLbMXFOrPmfr/XmhSH3g1Vc+9mlXf2m/IvHhqDn5BrH/3ru4mtZSiNDoklAhcZI0MJWr0TbQ9GNKFFclhS7Vmm3o8hPTHPp3pa8iNFa2BLg7tRkrW2T4VYImixbnRb5UoPNt4SgdSRRhYU4EKMo5VwdhG0KrDpxZhcLhxVW1f53bkdrm/fkWpGYZUd6Io4JDKR/hGGeqo1djtWY60/MOnWZNJSEIL9iIM1UAgj3nK9U9NxVRK3fIpAX1/kQhpbU99madYSGc2ScuZ48D7NkTzBcgbQaNSw1XEfUsBmK19I4IJ1Ac9iQFlssxRIzGjp4v94OiI2A7rQVNWXf1rzfc+4gKutsCm9LqXdzfhb4g7TX03rHWTo/pinBGlf6z4fACbqsWYsnwCiIgmfKEI/IP515JffJR6XdQSj17iRy2IabxZgfNnTRQ7y9SXL5T0pWgepwxqB6MFN4Ly+2psM5O7KUOPe9N2q4MyqoCX+2XBLvQghXKhr6Z7XbykIY1u/Fo0lbBbarTB3UaIFAwUsBnO7lOnErKSEHYyy+70mnEe8JBLHelYK2829yi+/ofgMckKtb3cDS6uvxw/PbT1fuLyen58aer4/Hk8GryaXQ4HtuJoC7cnpB+6EbmRbS34Xu3mB3OJfAiTT4WpG3U+QbT6szU+5kH737zjNqeCHc4GaGI5Ylp3d0oX4aFd7Eypa7C/nPhj9m79Xjc3/VI+XDDNTZ5mNnO0ahh9f/lnGgwW6taP+H0Fi0xXUCM4lxfccsKJt8D0LZvCgsIb8DV1sgqsKiTbbeCXR+1A4YfTG3L9jh0ZEHZxzhumokoF5KlxTXk61pCap4p6wNaLbZ+PVyVQmfwns5x3SxU/7Q+EG98LzT1jFil8KDpHou8cVjd4ueKaKPS+UV7ewflFKvqNYck8JRQLCEuS/DlLYW4vLo9QNMbxpJN8LGVrOK+8gxOClLC6CVN1m1OLgvowU51tqLG/IZIjvm6PHQfJgm7NStWdzucmYVefydJssPkCou3zl0RQdSdbTWzano7U+9qODthGsyi8C1kcon+3DELTyTa11cf1dtSxYHmSWJ9atwXqIzTdhh037s2zoH+5o0tWb1kVU9S1VF1K+MrfNsG1VvaOF5rtjdpLKEa7e+btk2tsMJqxlsmZ9UPdLMaSxUvLog+iUz4eqTKb93adWjKdzy2YHU1Vd4NV1vGLJGrjlIyXMi6+mxQafeS9FR1dNTV2UdCX774VL2hOCGJqsS9J8WXU2X09/27J/qSxNHpntfEd53Go1StqaNO3z66OSP2k5TqNQIKFDCwuT7ois7zJsXUo7C0vuGsYrTtJWqn01I+hHP/d7CtylgFxfSCi9fRLZ091xM2E+u5yBYmepafiSj771tYKMBjK3FuOjM2G7y9ABZp/r5SaW1iCylt9eTGX800oGA18aZsaG8gpmqKQqrjJd65xlZz7Y/18rg1s6p0vmaio0Lhm6uKrdNtQJ5mfPMxQtVptA+UyNPRfgihK9GcyL2G9x1rRqYdebDLe6Ym8nM5Odm75UKhZaUapN4hK/iyGp9sibycUoU4q6V1skjrVr83jan9Vzdc/Ls200WpJbOqctNIq3VWr/jtW+x2Sa2FkfdOtdxol3e3XjkP09pdrP1HUgXM0uy9jGy4VhdPe4ZDuvkXdZvELdnCyRgeshs3c7jZwzO/GHQtqyPDZ1XznFGvu1lhBz04s9TfQU1I9MUDcmuixqSKQfHoYeMl4INWybon8y5EY/ymcdm46dLGgP3nnIHHQ/v3+MMiuvMFbFFWXejZmMJBmPeFjwHELi8nPW1+1ZN3O3rsepLY4RTRfoL4S+e/eeT30ys8AAA='),
  'scripts/windows/restart-approved-stephanos-runtime.ps1': canonicalSource('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'),
  'scripts/windows/start-mission-orchestrator-worker.ps1': canonicalSource('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'),
});

const review = (overrides = {}) => analyzeWindowsAuthorityWorkerWatchdogReview({ repository, sourceHead: head, analysis, sources: Object.entries(fixtures).map(([path, content]) => record(path, content)), ...overrides });
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
    [0, '$trackedStatusAfterRestart', '', 'watchdog-probe-clean-recheck-missing'],
    [1, 'CANONICAL_TRACKED_SOURCE_DIRTY', '', 'watchdog-restart-clean-boundary-incomplete'],
    [1, 'Stop-Process -Id $startedWorker.ProcessId', 'Stop-Process -Name node', 'watchdog-restart-dirty-cleanup-missing'],
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
    ['5d1792a8e6090f38b0013670af717b3e07f98fa5', 15403],
    ['a8a96092a22ad6f40e33e8bbe4c04a90e880ab85', 14058],
    ['cac4b824c6656e4f45cda405cf807afddb8b1441', 5213],
  ];
  for (const [index, path] of WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V1.entries()) {
    assert.equal(blob(fixtures[path]), expected[index][0]);
    assert.equal(Buffer.byteLength(fixtures[path], 'utf8'), expected[index][1]);
  }
  assert.equal(review().clean, true);
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
  assert.match(source, /WORKER_WATCHDOG_BLOB_SHA = 'a3dc0f57524b4c31ff803eaea6bab08842ed15e9'/);
  assert.ok(source.indexOf('analyzeWindowsAuthorityWorkerWatchdogReview') < source.indexOf('core.analyzeWindowsAuthoritySpecialistReview'));
});
