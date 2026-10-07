[CmdletBinding(SupportsShouldProcess = $true)]
param()
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$repoRoot=[System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\\..'))
$git='C:\\Program Files\\Git\\cmd\\git.exe'
$hookPath=Join-Path $repoRoot '.githooks\\pre-commit'
$guardPath=Join-Path $repoRoot 'scripts\\source-mutation-commit-guard.mjs'
if(-not(Test-Path -LiteralPath $git -PathType Leaf)){throw 'SOURCE_MUTATION_GUARD_GIT_MISSING'}
if(-not(Test-Path -LiteralPath $hookPath -PathType Leaf)){throw 'SOURCE_MUTATION_GUARD_HOOK_MISSING'}
if(-not(Test-Path -LiteralPath $guardPath -PathType Leaf)){throw 'SOURCE_MUTATION_GUARD_SCRIPT_MISSING'}
$trackedHook=@(& $git -C $repoRoot ls-files --error-unmatch '.githooks/pre-commit' 2>$null)
if($LASTEXITCODE -ne 0 -or $trackedHook.Count -ne 1){throw 'SOURCE_MUTATION_GUARD_HOOK_NOT_TRACKED'}
$trackedGuard=@(& $git -C $repoRoot ls-files --error-unmatch 'scripts/source-mutation-commit-guard.mjs' 2>$null)
if($LASTEXITCODE -ne 0 -or $trackedGuard.Count -ne 1){throw 'SOURCE_MUTATION_GUARD_SCRIPT_NOT_TRACKED'}
if($PSCmdlet.ShouldProcess($repoRoot,'Configure repository-local source mutation commit guard')){& $git -C $repoRoot config --local core.hooksPath .githooks;if($LASTEXITCODE -ne 0){throw 'SOURCE_MUTATION_GUARD_CONFIG_FAILED'}}
$observed=(& $git -C $repoRoot config --local --get core.hooksPath).Trim()
if($observed -ne '.githooks'){throw 'SOURCE_MUTATION_GUARD_CONFIG_UNPROVEN'}
[pscustomobject]@{schemaVersion='stephanos.source-mutation-commit-guard-install.v1';repository='Cheekyfellastef/stephan-os';hooksPath=$observed;localMainCommitAllowed=$false;freshBranchLeaseRequired=$true;mergeAuthority=$false;leaseSeizureAllowed=$false;finalVerdict='SOURCE_MUTATION_COMMIT_GUARD_INSTALLED'}|ConvertTo-Json -Compress
