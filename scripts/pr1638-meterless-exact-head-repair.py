from pathlib import Path


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, found {count}')
    path.write_text(text.replace(old, new, 1), encoding='utf-8')


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
    """        exactHeadProofOk = $true
        arbitraryShellAllowed = $false
""",
    """        exactHeadProofOk = $true
        trackedWorktreeClean = $true
        arbitraryShellAllowed = $false
""",
    'runtime receipt tracked-worktree fact',
)

probe_path = Path('scripts/windows/probe-battle-bridge-recovery-mesh.ps1')
replace_once(
    probe_path,
    """$sourceControlExecutable = 'C:\\Program Files\\Git\\cmd\\git.exe'
if (-not (Test-Path -LiteralPath $sourceControlExecutable -PathType Leaf)) { throw 'RECOVERY_CANONICAL_GIT_EXECUTABLE_MISSING' }
$sourceHeadRaw = & $sourceControlExecutable -C $repoRoot rev-parse HEAD 2>$null | Select-Object -First 1
$branchRaw = & $sourceControlExecutable -C $repoRoot branch --show-current 2>$null | Select-Object -First 1
$sourceHead = if ($sourceHeadRaw) { ([string]$sourceHeadRaw).Trim().ToLowerInvariant() } else { '' }
$branch = if ($branchRaw) { ([string]$branchRaw).Trim() } else { '' }
if ($sourceHead -notmatch '^[0-9a-f]{40}$' -or $branch -ne 'main') { throw 'RECOVERY_CANONICAL_SOURCE_IDENTITY_INVALID' }
$worker = Get-WorkerHealth
""",
    """$sourceControlExecutable = 'C:\\Program Files\\Git\\cmd\\git.exe'
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
$worker = Get-WorkerHealth
""",
    'recovery tracked-worktree helper and first gate',
)
replace_once(
    probe_path,
    """            -and $receipt.exactHeadProofOk -eq $true `
            -and $receipt.arbitraryShellAllowed -eq $false `
""",
    """            -and $receipt.exactHeadProofOk -eq $true `
            -and $receipt.trackedWorktreeClean -eq $true `
            -and $receipt.arbitraryShellAllowed -eq $false `
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
    'recovery second tracked-worktree gate',
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
    worker = $worker
""",
    'recovery proof tracked-worktree fact',
)

test_path = Path('scripts/battle-bridge-recovery-mesh-installer.test.mjs')
text = test_path.read_text(encoding='utf-8')
addition = r"""

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
if "exact-head backend authority fails closed on tracked worktree drift" in text:
    raise SystemExit('tracked-worktree regression already present')
test_path.write_text(text.rstrip() + addition + '\n', encoding='utf-8')
