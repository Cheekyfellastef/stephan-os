[CmdletBinding()]
param(
    [string]$OpenClawStateRoot = "$env:USERPROFILE\.openclaw"
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$targets = @('standalone', 'scout-coder')
$allowedExtensions = @('.js', '.mjs', '.cjs', '.ts', '.json', '.json5', '.md', '.yaml', '.yml')
$excludedNamePattern = '(?i)(secret|credential|token|auth-profile|session|transcript|history|message|log)'
$maxFileBytes = 2MB

function Invoke-CapturedCommand([string[]]$Arguments) {
    $output = @(& $script:openclaw.Source @Arguments 2>&1)
    return [ordered]@{
        arguments = $Arguments
        exitCode = $LASTEXITCODE
        output = @($output | ForEach-Object { [string]$_ })
    }
}

$openclaw = Get-Command openclaw.cmd -ErrorAction SilentlyContinue
if ($null -eq $openclaw) {
    $openclaw = Get-Command openclaw -ErrorAction Stop
}
$script:openclaw = $openclaw
$stateRoot = [System.IO.Path]::GetFullPath($OpenClawStateRoot)

$version = Invoke-CapturedCommand @('--version')
$gateway = Invoke-CapturedCommand @('status', '--json')
$agentsCommand = Invoke-CapturedCommand @('agents', 'list', '--json')
$pluginsCommand = Invoke-CapturedCommand @('plugins', 'list', '--json')
$configCommands = Invoke-CapturedCommand @('config', 'get', 'commands')

$agents = @()
if ($agentsCommand.exitCode -eq 0) {
    try {
        $parsedAgents = ($agentsCommand.output -join [Environment]::NewLine) | ConvertFrom-Json
        if ($parsedAgents -is [System.Array]) { $agents = @($parsedAgents) }
        elseif ($null -ne $parsedAgents.agents) { $agents = @($parsedAgents.agents) }
    } catch {
        $agents = @()
    }
}

$matches = New-Object System.Collections.Generic.List[object]
if (Test-Path -LiteralPath $stateRoot -PathType Container) {
    Get-ChildItem -LiteralPath $stateRoot -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object {
            $allowedExtensions -contains $_.Extension.ToLowerInvariant() -and
            $_.Length -le $maxFileBytes -and
            $_.Name -notmatch $excludedNamePattern -and
            $_.FullName -notmatch '(?i)[\\/](node_modules|logs?|sessions?|transcripts?|history|cache|tmp)[\\/]'
        } |
        ForEach-Object {
            $file = $_
            try {
                foreach ($target in $targets) {
                    $lineMatches = @(Select-String -LiteralPath $file.FullName -SimpleMatch -Pattern $target -ErrorAction Stop)
                    foreach ($lineMatch in $lineMatches | Select-Object -First 8) {
                        $excerpt = [string]$lineMatch.Line
                        if ($excerpt.Length -gt 500) { $excerpt = $excerpt.Substring(0, 500) }
                        $matches.Add([ordered]@{
                            target = $target
                            path = [System.IO.Path]::GetRelativePath($stateRoot, $file.FullName)
                            lineNumber = $lineMatch.LineNumber
                            excerpt = $excerpt
                            fileSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $file.FullName).Hash.ToLowerInvariant()
                        })
                    }
                }
            } catch {
                # Unreadable files are omitted; the audit reports only grounded matches.
            }
        }
}

$result = [ordered]@{
    schemaVersion = 1
    auditKind = 'openclaw-agent-command-runtime-inventory'
    readOnlyOperation = $true
    filesWritten = 0
    targets = $targets
    stateRoot = $stateRoot
    openclawExecutable = $openclaw.Source
    version = $version
    gateway = $gateway
    agentsCommand = $agentsCommand
    pluginsCommand = $pluginsCommand
    commandsConfig = $configCommands
    agents = $agents
    matches = @($matches)
    finalVerdict = if ($gateway.exitCode -eq 0) { 'OPENCLAW_AGENT_COMMAND_RUNTIME_INVENTORY_PASS' } else { 'OPENCLAW_AGENT_COMMAND_RUNTIME_INVENTORY_BLOCKED_GATEWAY' }
}

$result | ConvertTo-Json -Depth 12
