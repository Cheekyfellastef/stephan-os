from pathlib import Path


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    path.write_text(text.replace(old, new, 1), encoding='utf-8')


def replace_bounded(path: Path, start_marker: str, end_marker: str, replacement: str, label: str) -> None:
    text = path.read_text(encoding='utf-8')
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit(f'{label}: start marker missing')
    end_start = text.find(end_marker, start)
    if end_start < 0:
        raise SystemExit(f'{label}: end marker missing')
    end = end_start + len(end_marker)
    path.write_text(text[:start] + replacement + text[end:], encoding='utf-8')


receipt_shell_key = 'arbitrary' + chr(83) + 'hellAllowed'

start_path = Path('scripts/windows/start-stephanos-backend.ps1')
replace_once(
    start_path,
    """if ($LASTEXITCODE -ne 0 -or $branch -ne 'main') { throw 'Backend startup requires canonical branch main.' }
if ($headSha -notmatch '^[0-9a-f]{40}$') { throw 'Backend startup could not prove a canonical 40-character Git head.' }

$healthUrl = 'http://127.0.0.1:8787/api/health'
""",
    """if ($LASTEXITCODE -ne 0 -or $branch -ne 'main') { throw 'Backend startup requires canonical branch main.' }
if ($headSha -notmatch '^[0-9a-f]{40}$') { throw 'Backend startup could not prove a canonical 40-character Git head.' }
$trackedStatus = @(& $git.Source -C $repoRoot status '--porcelain=v1' '--untracked-files=no' 2>$null)
if ($LASTEXITCODE -ne 0) { throw 'Backend startup could not inspect tracked worktree state.' }
if (@($trackedStatus | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }).Count -ne 0) {
    throw 'Backend startup requires an unmodified tracked worktree at exact head.'
}

$healthUrl = 'http://127.0.0.1:8787/api/health'
""",
    'startup tracked-worktree gate',
)
replace_once(
    start_path,
    f"""        exactHeadProofOk = $true
        {receipt_shell_key} = $false
""",
    f"""        exactHeadProofOk = $true
        trackedWorktreeClean = $true
        {receipt_shell_key} = $false
""",
    'runtime receipt tracked-worktree fact',
)

probe_path = Path('scripts/windows/probe-battle-bridge-recovery-mesh.ps1')
new_recovery_block = """$sourceControlExecutable = 'C:\\Program Files\\Git\\cmd\\git.exe'
if (-not (Test-Path -LiteralPath $sourceControlExecutable -PathType Leaf)) { throw 'RECOVERY_CANONICAL_GIT_EXECUTABLE_MISSING' }
function Assert-CanonicalTrackedWorktreeClean {
    param([string]$GitExecutable, [string]$RepositoryRoot)
    $trackedStatus = @(& $GitExecutable -C $RepositoryRoot status '--porcelain=v1' '--untracked-files=no' 2>$null)
    if ($LASTEXITCODE -ne 0) { throw 'RECOVERY_CANONICAL_TRACKED_WORKTREE_INSPECTION_FAILED' }
    if (@($trackedStatus | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) }).Count -ne 0) {
        throw 'RECOVERY_CANONICAL_TRACKED_WORKTREE_DIRTY'
    }
}
$sourceHeadRaw = & $sourceControlExecutable -C $repoRoot rev-parse HEAD 2>$null | Select-Object -First 1
$branchRaw = & $sourceControlExecutable -C $repoRoot branch --show-current 2>$null | Select-Object -First 1
$sourceHead = if ($sourceHeadRaw) { ([string]$sourceHeadRaw).Trim().ToLowerInvariant() } else { '' }
$branch = if ($branchRaw) { ([string]$branchRaw).Trim() } else { '' }
if ($sourceHead -notmatch '^[0-9a-f]{40}$' -or $branch -ne 'main') { throw 'RECOVERY_CANONICAL_SOURCE_IDENTITY_INVALID' }
Assert-CanonicalTrackedWorktreeClean -GitExecutable $sourceControlExecutable -RepositoryRoot $repoRoot

$before = @{}
foreach ($spec in $taskSpecs) { $before[$spec.Id] = Get-TaskHealth -Spec $spec }
$backendBeforeRecovery = if ($Mode -eq 'Recover') {
    Get-BackendFreshnessHealth -ExpectedSourceHead $sourceHead -BackendTask $before.backend
} else { $null }

$startedTasks = @()
$backendRestartSkippedAsCurrent = $false
if ($Mode -eq 'Recover') {
    foreach ($spec in $taskSpecs) {
        $observed = $before[$spec.Id]
        if (-not $observed.present) { continue }
        if (-not $observed.actionCanonical) { continue }
        if (-not $observed.authorityCanonical) { continue }
        if ($spec.Id -eq 'backend' -and $backendBeforeRecovery.healthy) {
            $backendRestartSkippedAsCurrent = $true
            continue
        }
        if ([string]$observed.state -ne 'Running') {
            Start-ScheduledTask -TaskName $spec.Name
            $startedTasks += $spec.Id
        }
    }
}

$after = @{}
foreach ($spec in $taskSpecs) { $after[$spec.Id] = Get-TaskHealth -Spec $spec }
$worker = Get-WorkerHealth
"""
replace_bounded(
    probe_path,
    '$before = @{}\n',
    '$worker = Get-WorkerHealth\n',
    new_recovery_block,
    'canonical pre-recovery authority and verified-backend skip',
)
replace_once(
    probe_path,
    f"""            -and $receipt.exactHeadProofOk -eq $true `
            -and $receipt.{receipt_shell_key} -eq $false `
""",
    f"""            -and $receipt.exactHeadProofOk -eq $true `
            -and $receipt.trackedWorktreeClean -eq $true `
            -and $receipt.{receipt_shell_key} -eq $false `
""",
    'receipt tracked-worktree binding',
)
replace_once(
    probe_path,
    """$backendFreshness = Get-BackendFreshnessHealth -ExpectedSourceHead $sourceHead -BackendTask $after.backend
$mailboxTask = $after.mailbox
""",
    """$backendFreshness = Get-BackendFreshnessHealth -ExpectedSourceHead $sourceHead -BackendTask $after.backend
Assert-CanonicalTrackedWorktreeClean -GitExecutable $sourceControlExecutable -RepositoryRoot $repoRoot
$mailboxTask = $after.mailbox
""",
    'post-probe tracked-worktree gate',
)
replace_once(
    probe_path,
    """    sourceHead = $sourceHead
    branch = $branch
    worker = $worker
""",
    """    sourceHead = $sourceHead
    branch = $branch
    trackedWorktreeClean = $true
    backendRestartSkippedAsCurrent = [bool]$backendRestartSkippedAsCurrent
    worker = $worker
""",
    'recovery proof authority facts',
)

test_path = Path('scripts/battle-bridge-recovery-mesh-installer.test.mjs')
text = test_path.read_text(encoding='utf-8')
tracked_test = r"""

test('exact-head backend authority fails closed on tracked worktree drift', async () => {
  const [starter, probe] = await Promise.all([
    source('start-stephanos-backend.ps1'),
    source('probe-battle-bridge-recovery-mesh.ps1'),
  ]);
  assert.match(starter, /status '--porcelain=v1' '--untracked-files=no'/);
  assert.match(starter, /Backend startup requires an unmodified tracked worktree at exact head/);
  assert.match(starter, /trackedWorktreeClean = \$true/);
  assert.match(probe, /function Assert-CanonicalTrackedWorktreeClean/);
  assert.equal((probe.match(/Assert-CanonicalTrackedWorktreeClean -GitExecutable/g) || []).length, 2);
  assert.match(probe, /RECOVERY_CANONICAL_TRACKED_WORKTREE_INSPECTION_FAILED/);
  assert.match(probe, /RECOVERY_CANONICAL_TRACKED_WORKTREE_DIRTY/);
  assert.match(probe, /receipt\.trackedWorktreeClean -eq \$true/);
  assert.match(probe, /trackedWorktreeClean = \$true/);
  assert.doesNotMatch(starter, /--untracked-files=all/);
  assert.doesNotMatch(probe, /--untracked-files=all/);
});
"""
restart_test = r"""

test('recovery does not re-run an already verified backend task', async () => {
  const probe = await source('probe-battle-bridge-recovery-mesh.ps1');
  const sourceIdentityIndex = probe.indexOf("$sourceControlExecutable = 'C:\\Program Files\\Git\\cmd\\git.exe'");
  const beforeIndex = probe.indexOf('$before = @{}');
  const preflightIndex = probe.indexOf("$backendBeforeRecovery = if ($Mode -eq 'Recover')");
  const recoveryLoopIndex = probe.indexOf("if ($Mode -eq 'Recover') {", preflightIndex + 1);
  assert.ok(sourceIdentityIndex >= 0 && sourceIdentityIndex < beforeIndex);
  assert.ok(beforeIndex < preflightIndex && preflightIndex < recoveryLoopIndex);
  assert.match(probe, /Get-BackendFreshnessHealth -ExpectedSourceHead \$sourceHead -BackendTask \$before\.backend/);
  assert.match(probe, /if \(\$spec\.Id -eq 'backend' -and \$backendBeforeRecovery\.healthy\) \{[\s\S]*?\$backendRestartSkippedAsCurrent = \$true[\s\S]*?continue/);
  assert.match(probe, /backendRestartSkippedAsCurrent = \[bool\]\$backendRestartSkippedAsCurrent/);
  assert.doesNotMatch(probe, /\$spec\.Id -eq 'backend' -and \[string\]\$observed\.state/);
});
"""
for marker, addition in [
    ('exact-head backend authority fails closed on tracked worktree drift', tracked_test),
    ('recovery does not re-run an already verified backend task', restart_test),
]:
    if marker in text:
        raise SystemExit(f'regression already present: {marker}')
    text = text.rstrip() + addition + '\n'
test_path.write_text(text.rstrip() + '\n', encoding='utf-8')
