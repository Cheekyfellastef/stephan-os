# Windows-only source process-tree custody prototype. It does not sign a receipt
# and MUST NOT be used to release any existing source-mutation lease.
# The trusted caller supplies an allowlisted executable and a bounded argv JSON.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Executable,
  [Parameter(Mandatory = $true)][string]$Worktree,
  [Parameter(Mandatory = $true)][string]$ArgumentsBase64,
  [ValidateRange(1,600)][int]$TimeoutSeconds = 120
)
$ErrorActionPreference = 'Stop'
try {
  if (-not [System.IO.Path]::IsPathRooted($Executable) -or
      -not [System.IO.Path]::IsPathRooted($Worktree) -or
      -not (Test-Path -LiteralPath $Executable -PathType Leaf) -or
      -not (Test-Path -LiteralPath $Worktree -PathType Container)) {
    throw 'SOURCE_CUSTODY_INPUT_PATH_NOT_TRUSTED'
  }
  $leaf = [System.IO.Path]::GetFileName($Executable).ToLowerInvariant()
  if ($leaf -notin @('node.exe', 'git.exe')) {
    throw 'SOURCE_CUSTODY_EXECUTABLE_NOT_ALLOWLISTED'
  }
  if ($ArgumentsBase64.Length -gt 32768) { throw 'SOURCE_CUSTODY_ARGUMENTS_UNBOUNDED' }
  $decoded = [System.Text.Encoding]::UTF8.GetString(
    [Convert]::FromBase64String($ArgumentsBase64))
  $parsed = ConvertFrom-Json -InputObject $decoded
  if (-not ($parsed -is [array]) -or $parsed.Length -gt 128) {
    throw 'SOURCE_CUSTODY_ARGUMENTS_NOT_ARRAY'
  }
  $strings = @()
  foreach ($arg in $parsed) {
    if (-not ($arg -is [string]) -or $arg.Contains([char]0)) {
      throw 'SOURCE_CUSTODY_ARGUMENTS_NOT_STRINGS'
    }
    $strings += $arg
  }
  Add-Type -Path (Join-Path $PSScriptRoot 'StephanosSourceJobCustody.cs')
  $result = [Stephanos.SourceCustody.JobRunner]::Run(
    [System.IO.Path]::GetFullPath($Executable),
    [string[]]$strings,
    [System.IO.Path]::GetFullPath($Worktree),
    $TimeoutSeconds * 1000)
  if (-not $result.Completed -or -not $result.AllProcessesExited -or
      -not $result.AssignedBeforeResume -or -not $result.KillOnJobClose -or
      $result.BreakawayPermitted -or -not $result.JobClosed -or
      $result.LastActiveProcessCount -ne 0) {
    throw 'SOURCE_CUSTODY_OS_LIFETIME_UNPROVEN'
  }
  # This is a per-command bounded execution result, never an issuer signature.
  # Keep stderr and stdout free of a fake original-writer attestation.
  exit $result.ExitCode
} catch {
  [Console]::Error.WriteLine('SOURCE_CUSTODY_BLOCKED:' + $_.Exception.Message)
  exit 125
}
