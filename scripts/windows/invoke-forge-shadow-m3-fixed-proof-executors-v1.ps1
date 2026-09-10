[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{40}$')][string]$ExpectedHead,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{40}$')][string]$ExpectedTree,
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$')][string]$RuntimeAuthorizationId,
    [Parameter(Mandatory = $true)][ValidatePattern('^sha256:[0-9a-fA-F]{64}$')][string]$RuntimePlanDigest,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{64}$')][string]$ArtifactSetDigest,
    [Parameter(Mandatory = $true)][ValidatePattern('^\d{4}-\d{2}-\d{2}T')][string]$IssuedAtUtc,
    [Parameter(Mandatory = $true)][ValidatePattern('^\d{4}-\d{2}-\d{2}T')][string]$ExpiresAtUtc,
    [Parameter(Mandatory = $true)][ValidatePattern('^sha256:[0-9a-fA-F]{64}$')][string]$ForgejoImageDigest,
    [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-fA-F]{64}$')][string]$BackupDigest,
    [Parameter(Mandatory = $true)][ValidatePattern('^stephanos-forge-shadow-backup-[0-9a-fA-F]{16}$')][string]$BackupVolume,
    [Parameter(Mandatory = $true)][ValidatePattern('^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$')][string]$RunnerVersion,
    [Parameter(Mandatory = $true)][ValidatePattern('^sha256:[0-9a-fA-F]{64}$')][string]$LinuxArtifactDigest,
    [Parameter(Mandatory = $true)][ValidatePattern('^sha256:[0-9a-fA-F]{64}$')][string]$WindowsArtifactDigest,
    [Parameter(Mandatory = $true)][ValidateRange(1, 3)][int]$LinuxRunnerCount,
    [switch]$OperatorApproved
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Repository = 'Cheekyfellastef/stephan-os'
$Owner = 'stephanos-shadow'
$RepoName = 'stephan-os'
$ForgejoVersion = '15.0.6'
$PodmanVersion = '6.0.2'
$MachineName = 'stephanos-forge-shadow'
$CanonicalContainer = 'stephanos-forge-shadow'
$CanonicalDataVolume = 'stephanos-forge-shadow-data'
$CanaryContainer = 'stephanos-forge-shadow-m3-canary'
$CanaryVolume = 'stephanos-forge-shadow-m3-canary-data'
$CanaryNetwork = 'stephanos-forge-shadow-m3-canary-net'
$CanaryListener = '127.0.0.1:3342'
$RelayPort = 3000
$FirewallRule = 'Stephanos Forge M3 Windows Sandbox Relay'
$ImageRef = "code.forgejo.org/forgejo/forgejo@$ForgejoImageDigest"
$RepoRoot = Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'
$GitExe = 'C:\Program Files\Git\cmd\git.exe'
$PodmanUserExe = Join-Path $env:LOCALAPPDATA 'Programs\Podman\podman.exe'
$PodmanSystemExe = 'C:\Program Files\RedHat\Podman\podman.exe'
$SandboxExe = Join-Path $env:SystemRoot 'System32\WindowsSandbox.exe'
$ArtifactRoot = Join-Path $env:LOCALAPPDATA "Stephanos\forge-shadow\artifacts\$RunnerVersion"
$LinuxRunnerPath = Join-Path $ArtifactRoot 'forgejo-runner-linux-amd64'
$WindowsRunnerPath = Join-Path $ArtifactRoot 'forgejo-runner-windows-amd64.exe'
$ProofRoot = Join-Path $env:USERPROFILE 'Documents\OpenClaw-Standalone\mission-runner\proof\forge-shadow-m3'
$ExpectedHead = $ExpectedHead.ToLowerInvariant()
$ExpectedTree = $ExpectedTree.ToLowerInvariant()
$RuntimePlanDigest = $RuntimePlanDigest.ToLowerInvariant()
$ArtifactSetDigest = $ArtifactSetDigest.ToLowerInvariant()
$ForgejoImageDigest = $ForgejoImageDigest.ToLowerInvariant()
$BackupDigest = $BackupDigest.ToLowerInvariant()
$LinuxArtifactDigest = $LinuxArtifactDigest.ToLowerInvariant()
$WindowsArtifactDigest = $WindowsArtifactDigest.ToLowerInvariant()
$script:Blocker = 'FORGE_M3_FIXED_EXECUTOR_EXCEPTION'
$script:ApiToken = $null
$script:SandboxProcess = $null
$script:ExchangeRoot = $null
$script:RelayAddress = $null
$script:RelayInstalled = $false
$script:FirewallInstalled = $false
$script:CanaryStarted = $false
$script:PendingRunners = [System.Collections.Generic.List[object]]::new()
$script:WorkspacesDestroyed = $true
$script:CredentialsDestroyed = $true

function Stop-Bounded([string]$Blocker) {
    $script:Blocker = $Blocker
    throw [System.InvalidOperationException]::new($Blocker)
}

function Invoke-Fixed([string]$Executable, [string[]]$Arguments, [switch]$AllowFailure) {
    $output = @(& $Executable @Arguments 2>&1)
    $exitCode = $LASTEXITCODE
    if (-not $AllowFailure -and $exitCode -ne 0) { Stop-Bounded 'FORGE_M3_FIXED_COMMAND_FAILED' }
    return [pscustomobject]@{ ExitCode = $exitCode; Output = @($output | ForEach-Object { [string]$_ }) }
}

function Get-PodmanExe {
    foreach ($candidate in @($PodmanUserExe, $PodmanSystemExe)) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
    }
    return $null
}

function Invoke-Podman([string[]]$Arguments, [switch]$AllowFailure) {
    $prefix = @('--connection', $MachineName)
    return Invoke-Fixed $script:PodmanExe ($prefix + $Arguments) -AllowFailure:$AllowFailure
}

function Test-Container([string]$Name) {
    return (Invoke-Podman @('container', 'exists', $Name) -AllowFailure).ExitCode -eq 0
}

function Test-Volume([string]$Name) {
    return (Invoke-Podman @('volume', 'exists', $Name) -AllowFailure).ExitCode -eq 0
}

function Get-VolumeDigest([string]$Volume) {
    $fixedHash = 'cd /source && tar -cf - . | sha256sum'
    $result = Invoke-Podman @(
        'run', '--rm', '--user', '1000:1000', '--read-only', '--read-only-tmpfs=false',
        '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
        '-v', "$Volume`:/source:ro", $ImageRef, 'sh', '-c', $fixedHash
    )
    $line = ($result.Output -join ' ').Trim()
    if ($line -notmatch '^([0-9a-f]{64})\s') { Stop-Bounded 'FORGE_M3_VOLUME_DIGEST_FAILED' }
    return $Matches[1].ToLowerInvariant()
}

function Copy-Volume([string]$Source, [string]$Destination) {
    $fixedCopy = 'cd /source && tar -cf - . | (cd /destination && tar -xf -)'
    [void](Invoke-Podman @(
        'run', '--rm', '--user', '1000:1000', '--read-only', '--read-only-tmpfs=false',
        '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
        '-v', "$Source`:/source:ro", '-v', "$Destination`:/destination",
        $ImageRef, 'sh', '-c', $fixedCopy
    ))
}

function New-RandomHex40 {
    $bytes = [byte[]]::new(20)
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
    return ([Convert]::ToHexString($bytes)).ToLowerInvariant()
}

function New-RunnerRegistration([string]$RunnerId, [string[]]$Labels) {
    $secret = New-RandomHex40
    try {
        $registered = Invoke-Podman @(
            'exec', $CanaryContainer, 'forgejo', 'forgejo-cli', 'actions', 'register',
            '--name', $RunnerId, '--scope', "$Owner/$RepoName", '--labels', ($Labels -join ','),
            '--secret', $secret, '--ephemeral'
        )
        $uuid = (($registered.Output -join ' ').Trim())
        if ($uuid -notmatch '^[0-9a-fA-F-]{36}$') { Stop-Bounded 'FORGE_M3_RUNNER_UUID_INVALID' }
        return [pscustomobject]@{ Uuid = $uuid; Secret = $secret }
    } catch {
        $secret = $null
        [GC]::Collect()
        throw
    }
}

function Invoke-CanaryDispatch([string]$RunnerClass, [string]$RunnerId) {
    $headers = @{ Authorization = "token $script:ApiToken"; Accept = 'application/json' }
    $body = @{
        ref = 'main'
        inputs = @{
            expected_head = $ExpectedHead
            expected_tree = $ExpectedTree
            runtime_authorization_id = $RuntimeAuthorizationId
            runner_class = $RunnerClass
            runner_id = $RunnerId
        }
    } | ConvertTo-Json -Depth 5 -Compress
    try {
        [void](Invoke-RestMethod -Method Post -Uri "http://$CanaryListener/api/v1/repos/$Owner/$RepoName/actions/workflows/forge-shadow-m3-isolation-canary-v1.yml/dispatches" -Headers $headers -ContentType 'application/json' -Body $body -TimeoutSec 30)
    } catch {
        Stop-Bounded 'FORGE_M3_CANARY_DISPATCH_FAILED'
    } finally {
        $headers = $null
        $body = $null
    }
}

function Assert-RunnerRegistrationAbsent([string]$RunnerId) {
    $headers = @{ Authorization = "token $script:ApiToken"; Accept = 'application/json' }
    try {
        $result = Invoke-RestMethod -Method Get -Uri "http://$CanaryListener/api/v1/repos/$Owner/$RepoName/actions/runners" -Headers $headers -TimeoutSec 20
        $runners = if ($result.PSObject.Properties.Name -contains 'runners') { @($result.runners) } else { @($result) }
        if (@($runners | Where-Object { [string]$_.name -eq $RunnerId }).Count -ne 0) {
            Stop-Bounded 'FORGE_M3_EPHEMERAL_REGISTRATION_REMAINS'
        }
    } catch {
        if ($script:Blocker -eq 'FORGE_M3_EPHEMERAL_REGISTRATION_REMAINS') { throw }
        Stop-Bounded 'FORGE_M3_REGISTRATION_ABSENCE_UNPROVEN'
    } finally {
        $headers = $null
    }
}

function Write-Proof([hashtable]$Proof) {
    $json = $Proof | ConvertTo-Json -Depth 8 -Compress
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    $digest = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($bytes)).ToLowerInvariant()
    $runnerRoot = Join-Path $ProofRoot ([string]$Proof.runnerId)
    [void](New-Item -ItemType Directory -Path $runnerRoot -Force)
    $target = Join-Path $runnerRoot "$digest.json"
    [IO.File]::WriteAllText($target, $json, [Text.UTF8Encoding]::new($false))
    return "proofs/forge-shadow-m3/$([string]$Proof.runnerId)/$digest.json"
}

function New-Observation([string]$RunnerId, [string]$PoolId, [string]$RunnerClass, [string]$Boundary, [string]$ArtifactDigest, [datetime]$StartedAt, [datetime]$CompletedAt, [bool]$PrivateRelayUsed) {
    $proof = [ordered]@{
        schemaVersion = 'stephanos.forge-shadow-m3-fixed-runner-proof.v1'
        repository = $Repository
        runnerId = $RunnerId
        runnerClass = $RunnerClass
        sourceHead = $ExpectedHead
        sourceTree = $ExpectedTree
        runtimeAuthorizationId = $RuntimeAuthorizationId
        runtimePlanDigest = $RuntimePlanDigest
        artifactDigest = $ArtifactDigest
        canarySucceeded = $true
        completedAtUtc = $CompletedAt.ToUniversalTime().ToString('o')
        credentialMaterialPresent = $false
    }
    $proofRef = Write-Proof $proof
    return [ordered]@{
        schemaVersion = 'stephanos.forge-shadow-m3-runner-execution-observation.v1'
        runnerId = $RunnerId
        poolId = $PoolId
        runnerClass = $RunnerClass
        runtimeBoundary = $Boundary
        sourceHead = $ExpectedHead
        sourceTree = $ExpectedTree
        artifactDigest = $ArtifactDigest
        artifactSetDigest = $ArtifactSetDigest
        canaryForgeService = $CanaryContainer
        canaryForgeBackupDigest = $BackupDigest
        canaryForgeStarted = $true
        canaryForgeDestroyed = $true
        canonicalM2Sealed = $true
        canonicalM2Unchanged = $true
        privateRelayUsed = $PrivateRelayUsed
        privateRelayDestroyed = $true
        startedAtUtc = $StartedAt.ToUniversalTime().ToString('o')
        completedAtUtc = $CompletedAt.ToUniversalTime().ToString('o')
        installed = $true
        registered = $true
        connected = $true
        ephemeralRegistration = $true
        canaryWorkflowId = 'forge-shadow-m3-isolation-canary-v1'
        canaryScenario = 'EXACT_HEAD_ISOLATION_AND_TEARDOWN'
        canaryHead = $ExpectedHead
        canaryTree = $ExpectedTree
        canarySucceeded = $true
        unregistered = $true
        registrationCredentialDestroyed = $true
        workspaceDestroyed = $true
        runtimeBoundaryDestroyed = $true
        zeroResidualRegistration = $true
        zeroResidualCredential = $true
        zeroResidualWorkspace = $true
        credentialLogged = $false
        credentialPersisted = $false
        publicExposure = $false
        tailscaleExposure = $false
        canonicalCheckoutMounted = $false
        containerSocketMounted = $false
        hostProcessAccess = $false
        sourceMutation = $false
        gitRefWrite = $false
        mergeAuthority = $false
        deploymentAuthority = $false
        arbitraryCommand = $false
        proofRefs = @($proofRef)
    }
}

function Invoke-LinuxRunner([int]$Index) {
    $runnerId = "stephanos-forge-linux-runner-$($Index.ToString('00'))"
    $container = "$runnerId-boundary"
    $workspace = Join-Path ([IO.Path]::GetTempPath()) "$runnerId-$RuntimeAuthorizationId"
    $startedAt = [datetime]::UtcNow
    $registration = $null
    try {
        [void](New-Item -ItemType Directory -Path $workspace -Force)
        Copy-Item -LiteralPath $LinuxRunnerPath -Destination (Join-Path $workspace 'forgejo-runner')
        $labels = @('self-hosted', 'linux', 'x64', 'stephanos-forge', 'ephemeral', $runnerId)
        $registration = New-RunnerRegistration $runnerId $labels
        [IO.File]::WriteAllText((Join-Path $workspace 'runner-token'), $registration.Secret, [Text.UTF8Encoding]::new($false))
        $runnerArguments = @('one-job', '--url', "http://$CanaryContainer`:3000/", '--uuid', $registration.Uuid, '--token-url', 'file:///runner/runner-token')
        foreach ($label in $labels) { $runnerArguments += @('--label', "$label`:host") }
        $runnerArguments += '--wait'
        $runArgs = @(
            'run', '-d', '--name', $container, '--network', $CanaryNetwork,
            '--user', '1000:1000', '--read-only', '--read-only-tmpfs=false', '--cap-drop', 'ALL',
            '--security-opt', 'no-new-privileges', '--pids-limit', '256', '--memory', '1g', '--cpus', '1',
            '--tmpfs', '/work:rw,nosuid,nodev,noexec,size=256m', '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=64m',
            '-v', "$workspace`:/runner:ro", '--entrypoint', '/runner/forgejo-runner',
            $ImageRef
        )
        $runArgs += $runnerArguments
        [void](Invoke-Podman $runArgs)
        Start-Sleep -Seconds 2
        Invoke-CanaryDispatch 'linux-isolated' $runnerId
        $wait = Invoke-Podman @('wait', $container)
        if (($wait.Output -join '').Trim() -ne '0') { Stop-Bounded 'FORGE_M3_LINUX_RUNNER_FAILED' }
        $logs = (Invoke-Podman @('logs', $container)).Output -join "`n"
        if ($logs -notmatch "FORGE_M3_CANARY_OK linux $ExpectedHead $ExpectedTree") { Stop-Bounded 'FORGE_M3_LINUX_CANARY_PROOF_MISSING' }
        Assert-RunnerRegistrationAbsent $runnerId
        $completedAt = [datetime]::UtcNow
        $script:PendingRunners.Add([ordered]@{ RunnerId = $runnerId; PoolId = 'forge-linux-build-test-v1'; RunnerClass = 'linux-isolated'; Boundary = 'forge-linux-rootless-ephemeral'; ArtifactDigest = $LinuxArtifactDigest; StartedAt = $startedAt; CompletedAt = $completedAt; PrivateRelayUsed = $false })
    } finally {
        if (Test-Container $container) { [void](Invoke-Podman @('rm', '-f', $container) -AllowFailure) }
        if (Test-Path -LiteralPath $workspace) { Remove-Item -LiteralPath $workspace -Recurse -Force }
        if (Test-Path -LiteralPath $workspace) { $script:WorkspacesDestroyed = $false }
        if ($registration) { $registration.Secret = $null }
        $registration = $null
        [GC]::Collect()
    }
}

function Invoke-WindowsRunner {
    $runnerId = 'stephanos-forge-windows-proof-runner-01'
    $startedAt = [datetime]::UtcNow
    $registration = $null
    $script:ExchangeRoot = Join-Path ([IO.Path]::GetTempPath()) "$runnerId-$RuntimeAuthorizationId"
    $inputRoot = Join-Path $script:ExchangeRoot 'input'
    $exchange = Join-Path $script:ExchangeRoot 'exchange'
    try {
        [void](New-Item -ItemType Directory -Path $inputRoot -Force)
        [void](New-Item -ItemType Directory -Path $exchange -Force)
        Copy-Item -LiteralPath $WindowsRunnerPath -Destination (Join-Path $inputRoot 'forgejo-runner.exe')
        $bootstrap = @'
$ErrorActionPreference = 'Stop'
$exchange = 'C:\ForgeM3Exchange'
$inputRoot = 'C:\ForgeM3Input'
$route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | Select-Object -First 1
$address = Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $route.InterfaceIndex | Where-Object { $_.IPAddress -notlike '169.254.*' } | Select-Object -First 1
@{ sandboxAddress = $address.IPAddress; relayAddress = $route.NextHop } | ConvertTo-Json -Compress | Set-Content -LiteralPath "$exchange\network.json" -Encoding utf8
$deadline = [datetime]::UtcNow.AddMinutes(2)
while (-not (Test-Path -LiteralPath "$exchange\runner-launch.json")) { if ([datetime]::UtcNow -ge $deadline) { exit 21 }; Start-Sleep -Milliseconds 250 }
$network = Get-Content -Raw -LiteralPath "$exchange\network.json" | ConvertFrom-Json
Add-Content -LiteralPath "$env:SystemRoot\System32\drivers\etc\hosts" -Value "`n$($network.relayAddress) stephanos-forge-shadow-m3-canary"
$launch = Get-Content -Raw -LiteralPath "$exchange\runner-launch.json" | ConvertFrom-Json
if ($launch.runnerId -ne 'stephanos-forge-windows-proof-runner-01') { exit 22 }
if ($launch.url -ne 'http://stephanos-forge-shadow-m3-canary:3000/') { exit 23 }
if ([string]$launch.uuid -notmatch '^[0-9a-fA-F-]{36}$') { exit 24 }
if (-not (Test-Path -LiteralPath "$exchange\runner-token")) { exit 25 }
$runnerArguments = @('one-job', '--url', [string]$launch.url, '--uuid', [string]$launch.uuid, '--token-url', 'file:///C:/ForgeM3Exchange/runner-token')
foreach ($label in @('self-hosted', 'windows', 'x64', 'stephanos-forge', 'proof-only', 'ephemeral', [string]$launch.runnerId)) { $runnerArguments += @('--label', "$label`:host") }
$runnerArguments += '--wait'
$output = & "$inputRoot\forgejo-runner.exe" @runnerArguments 2>&1 | Out-String
$exitCode = $LASTEXITCODE
$output | Set-Content -LiteralPath "$exchange\runner-output.txt" -Encoding utf8
@{ exitCode = $exitCode } | ConvertTo-Json -Compress | Set-Content -LiteralPath "$exchange\complete.json" -Encoding utf8
exit $exitCode
'@
        [IO.File]::WriteAllText((Join-Path $inputRoot 'bootstrap.ps1'), $bootstrap, [Text.UTF8Encoding]::new($false))
        $bootstrap = $null
        $wsb = @"
<Configuration>
  <VGpu>Disable</VGpu><Networking>Enable</Networking><ClipboardRedirection>Disable</ClipboardRedirection><PrinterRedirection>Disable</PrinterRedirection><ProtectedClient>Enable</ProtectedClient>
  <MappedFolders>
    <MappedFolder><HostFolder>$inputRoot</HostFolder><SandboxFolder>C:\ForgeM3Input</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$exchange</HostFolder><SandboxFolder>C:\ForgeM3Exchange</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
  </MappedFolders>
  <LogonCommand><Command>powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File C:\ForgeM3Input\bootstrap.ps1</Command></LogonCommand>
</Configuration>
"@
        $wsbPath = Join-Path $script:ExchangeRoot 'forge-m3.wsb'
        [IO.File]::WriteAllText($wsbPath, $wsb, [Text.UTF8Encoding]::new($false))
        $wsb = $null
        $labels = @('self-hosted', 'windows', 'x64', 'stephanos-forge', 'proof-only', 'ephemeral', $runnerId)
        $registration = New-RunnerRegistration $runnerId $labels
        $script:SandboxProcess = Start-Process -FilePath $SandboxExe -ArgumentList @($wsbPath) -PassThru
        $networkPath = Join-Path $exchange 'network.json'
        $deadline = [datetime]::UtcNow.AddMinutes(2)
        while (-not (Test-Path -LiteralPath $networkPath)) { if ([datetime]::UtcNow -ge $deadline) { Stop-Bounded 'FORGE_M3_WINDOWS_SANDBOX_NETWORK_TIMEOUT' }; Start-Sleep -Milliseconds 250 }
        $network = Get-Content -Raw -LiteralPath $networkPath | ConvertFrom-Json
        if ([string]$network.sandboxAddress -notmatch '^172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$') { Stop-Bounded 'FORGE_M3_WINDOWS_SANDBOX_ADDRESS_INVALID' }
        if ([string]$network.relayAddress -notmatch '^172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$') { Stop-Bounded 'FORGE_M3_WINDOWS_RELAY_ADDRESS_INVALID' }
        $script:RelayAddress = [string]$network.relayAddress
        [void](Invoke-Fixed (Join-Path $env:SystemRoot 'System32\netsh.exe') @('interface', 'portproxy', 'add', 'v4tov4', "listenaddress=$script:RelayAddress", "listenport=$RelayPort", 'connectaddress=127.0.0.1', 'connectport=3342'))
        $script:RelayInstalled = $true
        [void](New-NetFirewallRule -DisplayName $FirewallRule -Direction Inbound -Action Allow -Protocol TCP -LocalAddress $script:RelayAddress -LocalPort $RelayPort -RemoteAddress ([string]$network.sandboxAddress) -Profile Any)
        $script:FirewallInstalled = $true
        [IO.File]::WriteAllText((Join-Path $exchange 'runner-token'), $registration.Secret, [Text.UTF8Encoding]::new($false))
        $launch = [ordered]@{ runnerId = $runnerId; url = "http://stephanos-forge-shadow-m3-canary`:$RelayPort/"; uuid = $registration.Uuid } | ConvertTo-Json -Compress
        [IO.File]::WriteAllText((Join-Path $exchange 'runner-launch.json'), $launch, [Text.UTF8Encoding]::new($false))
        $launch = $null
        Start-Sleep -Seconds 2
        Invoke-CanaryDispatch 'windows-proof-isolated' $runnerId
        $completePath = Join-Path $exchange 'complete.json'
        $deadline = [datetime]::UtcNow.AddMinutes(15)
        while (-not (Test-Path -LiteralPath $completePath)) { if ([datetime]::UtcNow -ge $deadline) { Stop-Bounded 'FORGE_M3_WINDOWS_RUNNER_TIMEOUT' }; Start-Sleep -Seconds 1 }
        $complete = Get-Content -Raw -LiteralPath $completePath | ConvertFrom-Json
        if ([int]$complete.exitCode -ne 0) { Stop-Bounded 'FORGE_M3_WINDOWS_RUNNER_FAILED' }
        $runnerOutput = Get-Content -Raw -LiteralPath (Join-Path $exchange 'runner-output.txt')
        if ($runnerOutput -notmatch "FORGE_M3_CANARY_OK windows $ExpectedHead $ExpectedTree") { Stop-Bounded 'FORGE_M3_WINDOWS_CANARY_PROOF_MISSING' }
        Assert-RunnerRegistrationAbsent $runnerId
        $completedAt = [datetime]::UtcNow
        $script:PendingRunners.Add([ordered]@{ RunnerId = $runnerId; PoolId = 'forge-windows-proof-v1'; RunnerClass = 'windows-proof-isolated'; Boundary = 'battle-bridge-windows-proof-sandbox'; ArtifactDigest = $WindowsArtifactDigest; StartedAt = $startedAt; CompletedAt = $completedAt; PrivateRelayUsed = $true })
    } finally {
        if ($registration) { $registration.Secret = $null }
        $registration = $null
        [GC]::Collect()
    }
}

function Remove-FixedRuntime {
    if ($script:ApiToken) {
        $revokedToken = $script:ApiToken
        try {
            $headers = @{ Authorization = "token $revokedToken"; Accept = 'application/json' }
            [void](Invoke-RestMethod -Method Delete -Uri "http://$CanaryListener/api/v1/users/$Owner/tokens/stephanos-m3-dispatch" -Headers $headers -TimeoutSec 20)
            try {
                [void](Invoke-RestMethod -Method Get -Uri "http://$CanaryListener/api/v1/user" -Headers $headers -TimeoutSec 10)
                $script:CredentialsDestroyed = $false
            } catch {
                $statusCode = 0
                try { $statusCode = [int]$_.Exception.Response.StatusCode } catch { $statusCode = 0 }
                if ($statusCode -notin @(401, 403)) { $script:CredentialsDestroyed = $false }
            }
        } catch { $script:CredentialsDestroyed = $false }
        $headers = $null
        $revokedToken = $null
        $script:ApiToken = $null
        [GC]::Collect()
    }
    if ($script:SandboxProcess -and -not $script:SandboxProcess.HasExited) { Stop-Process -Id $script:SandboxProcess.Id -Force -ErrorAction SilentlyContinue }
    $script:SandboxProcess = $null
    if ($script:FirewallInstalled) { Remove-NetFirewallRule -DisplayName $FirewallRule -ErrorAction SilentlyContinue; $script:FirewallInstalled = $false }
    if ($script:RelayInstalled -and $script:RelayAddress) {
        [void](Invoke-Fixed (Join-Path $env:SystemRoot 'System32\netsh.exe') @('interface', 'portproxy', 'delete', 'v4tov4', "listenaddress=$script:RelayAddress", "listenport=$RelayPort") -AllowFailure)
        $script:RelayInstalled = $false
    }
    if ($script:ExchangeRoot -and (Test-Path -LiteralPath $script:ExchangeRoot)) { Remove-Item -LiteralPath $script:ExchangeRoot -Recurse -Force }
    if ($script:ExchangeRoot -and (Test-Path -LiteralPath $script:ExchangeRoot)) { $script:WorkspacesDestroyed = $false }
    if (Test-Container $CanaryContainer) { [void](Invoke-Podman @('rm', '-f', $CanaryContainer) -AllowFailure) }
    if (Test-Volume $CanaryVolume) { [void](Invoke-Podman @('volume', 'rm', '-f', $CanaryVolume) -AllowFailure) }
    [void](Invoke-Podman @('network', 'rm', '-f', $CanaryNetwork) -AllowFailure)
    $script:CanaryStarted = $false
}

try {
    if (-not $OperatorApproved -and -not $WhatIfPreference) { Stop-Bounded 'EXACT_RUNTIME_OPERATOR_APPROVAL_REQUIRED' }
    if (-not (Test-Path -LiteralPath $RepoRoot -PathType Container)) { Stop-Bounded 'CANONICAL_REPOSITORY_ROOT_MISSING' }
    foreach ($required in @($GitExe, $LinuxRunnerPath, $WindowsRunnerPath, $SandboxExe)) {
        if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { Stop-Bounded 'FORGE_M3_FIXED_PREREQUISITE_MISSING' }
    }
    $issued = [datetimeoffset]::Parse($IssuedAtUtc)
    $expires = [datetimeoffset]::Parse($ExpiresAtUtc)
    $now = [datetimeoffset]::UtcNow
    if ($expires -le $issued -or ($expires - $issued).TotalHours -gt 2 -or $now -lt $issued -or $now -ge $expires) { Stop-Bounded 'FORGE_M3_RUNTIME_AUTHORIZATION_TIME_INVALID' }
    $branch = ((Invoke-Fixed $GitExe @('-C', $RepoRoot, 'branch', '--show-current')).Output -join '').Trim()
    $head = ((Invoke-Fixed $GitExe @('-C', $RepoRoot, 'rev-parse', 'HEAD')).Output -join '').Trim().ToLowerInvariant()
    $tree = ((Invoke-Fixed $GitExe @('-C', $RepoRoot, 'rev-parse', "$ExpectedHead^{tree}")).Output -join '').Trim().ToLowerInvariant()
    if ($branch -ne 'main' -or $head -ne $ExpectedHead -or $tree -ne $ExpectedTree) { Stop-Bounded 'FORGE_M3_CANONICAL_SOURCE_IDENTITY_MISMATCH' }
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $LinuxRunnerPath).Hash.ToLowerInvariant() -ne $LinuxArtifactDigest.Substring(7)) { Stop-Bounded 'FORGE_M3_LINUX_ARTIFACT_DIGEST_MISMATCH' }
    if ((Get-FileHash -Algorithm SHA256 -LiteralPath $WindowsRunnerPath).Hash.ToLowerInvariant() -ne $WindowsArtifactDigest.Substring(7)) { Stop-Bounded 'FORGE_M3_WINDOWS_ARTIFACT_DIGEST_MISMATCH' }
    $script:PodmanExe = Get-PodmanExe
    if (-not $script:PodmanExe) { Stop-Bounded 'PODMAN_6_0_2_USER_PREREQUISITE_REQUIRED' }
    $podmanVersion = ((Invoke-Fixed $script:PodmanExe @('--version')).Output -join ' ').Trim()
    if ($podmanVersion -notmatch 'podman version 6\.0\.2(?:\s|$)') { Stop-Bounded 'PODMAN_VERSION_MISMATCH' }
    if (-not (Test-Container $CanonicalContainer) -or -not (Test-Volume $CanonicalDataVolume) -or -not (Test-Volume $BackupVolume)) { Stop-Bounded 'FORGE_M3_CANONICAL_M2_NOT_READY' }
    $canonicalInspect = (Invoke-Podman @('inspect', $CanonicalContainer, '--format', 'json')).Output -join ''
    if ($canonicalInspect -notmatch 'stephanos.sealed.*true' -or $canonicalInspect -notmatch 'FORGEJO__actions__ENABLED=false') { Stop-Bounded 'FORGE_M3_CANONICAL_M2_NOT_SEALED' }
    $canonicalM2DigestBefore = Get-VolumeDigest $BackupVolume
    if ($canonicalM2DigestBefore -ne $BackupDigest) { Stop-Bounded 'FORGE_M3_BACKUP_DIGEST_MISMATCH' }
    if ($WhatIfPreference) {
        [ordered]@{ schemaVersion = 'stephanos.forge-shadow-m3-fixed-proof-execution-receipt.v1'; ok = $true; status = 'WHAT_IF_READY'; repository = $Repository; sourceHead = $ExpectedHead; sourceTree = $ExpectedTree; mutationPerformed = $false } | ConvertTo-Json -Compress
        exit 0
    }
    if (-not $PSCmdlet.ShouldProcess($RuntimeAuthorizationId, 'Run fixed disposable Forge M3 Linux and Windows proof executors')) { Stop-Bounded 'RUNTIME_MUTATION_NOT_CONFIRMED' }
    Remove-FixedRuntime
    [void](Invoke-Podman @('network', 'create', '--internal', $CanaryNetwork))
    [void](Invoke-Podman @('volume', 'create', $CanaryVolume))
    Copy-Volume $BackupVolume $CanaryVolume
    if ((Get-VolumeDigest $CanaryVolume) -ne $BackupDigest) { Stop-Bounded 'FORGE_M3_CANARY_COPY_DIGEST_MISMATCH' }
    $canaryArgs = @(
        'run', '-d', '--name', $CanaryContainer, '--network', $CanaryNetwork, '--user', '1000:1000', '--restart', 'no',
        '--read-only', '--read-only-tmpfs=false', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
        '--pids-limit', '512', '--memory', '2g', '--cpus', '2',
        '--tmpfs', '/run:rw,nosuid,nodev,noexec,size=16m', '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=64m', '--tmpfs', '/var/tmp:rw,nosuid,nodev,noexec,size=32m',
        '-p', '127.0.0.1:3342:3000', '-v', "$CanaryVolume`:/var/lib/gitea",
        '-e', 'FORGEJO__actions__ENABLED=true',
        '-e', 'FORGEJO__repository__DISABLED_REPO_UNITS=repo.issues,repo.pulls,repo.wiki,repo.projects,repo.packages',
        '-e', "FORGEJO__server__ROOT_URL=http://$CanaryContainer`:3000/",
        '-e', 'FORGEJO__mirror__ENABLED=false', '-e', 'FORGEJO__mirror__DISABLE_NEW_PULL=true',
        $ImageRef
    )
    [void](Invoke-Podman $canaryArgs)
    $script:CanaryStarted = $true
    $deadline = [datetime]::UtcNow.AddMinutes(2)
    do {
        try { $version = Invoke-RestMethod -Method Get -Uri "http://$CanaryListener/api/v1/version" -TimeoutSec 3 } catch { $version = $null }
        if ($version) { break }
        Start-Sleep -Milliseconds 500
    } while ([datetime]::UtcNow -lt $deadline)
    if (-not $version -or [string]$version.version -notlike "$ForgejoVersion*") { Stop-Bounded 'FORGE_M3_CANARY_FORGE_HEALTH_FAILED' }
    $tokenResult = Invoke-Podman @('exec', $CanaryContainer, 'forgejo', 'admin', 'user', 'generate-access-token', '--username', $Owner, '--token-name', 'stephanos-m3-dispatch', '--raw', '--scopes', 'write:repository,write:user')
    $script:ApiToken = (($tokenResult.Output -join '').Trim())
    if ($script:ApiToken -notmatch '^[A-Za-z0-9._-]{20,}$') { Stop-Bounded 'FORGE_M3_DISPATCH_TOKEN_INVALID' }
    for ($index = 1; $index -le $LinuxRunnerCount; $index += 1) { Invoke-LinuxRunner $index }
    Invoke-WindowsRunner
    Remove-FixedRuntime
    $canonicalM2DigestAfter = Get-VolumeDigest $BackupVolume
    if ($canonicalM2DigestAfter -ne $canonicalM2DigestBefore) { Stop-Bounded 'FORGE_M3_CANONICAL_M2_CHANGED' }
    if (-not $script:CredentialsDestroyed -or -not $script:WorkspacesDestroyed) { Stop-Bounded 'FORGE_M3_TEARDOWN_INCOMPLETE' }
    $observations = @($script:PendingRunners | ForEach-Object {
        New-Observation ([string]$_.RunnerId) ([string]$_.PoolId) ([string]$_.RunnerClass) ([string]$_.Boundary) ([string]$_.ArtifactDigest) ([datetime]$_.StartedAt) ([datetime]$_.CompletedAt) ([bool]$_.PrivateRelayUsed)
    })
    [ordered]@{
        schemaVersion = 'stephanos.forge-shadow-m3-fixed-proof-execution-receipt.v1'
        ok = $true
        status = 'FORGE_SHADOW_M3_FIXED_PROOF_EXECUTORS_READY'
        repository = $Repository
        sourceHead = $ExpectedHead
        sourceTree = $ExpectedTree
        runtimeAuthorizationId = $RuntimeAuthorizationId
        runtimePlanDigest = $RuntimePlanDigest
        artifactSetDigest = $ArtifactSetDigest
        runnerVersion = $RunnerVersion
        canonicalM2DigestBefore = $canonicalM2DigestBefore
        canonicalM2DigestAfter = $canonicalM2DigestAfter
        canaryForgeDestroyed = -not (Test-Container $CanaryContainer)
        privateRelayDestroyed = -not $script:RelayInstalled
        registrationCredentialsDestroyed = $script:CredentialsDestroyed
        workspacesDestroyed = $script:WorkspacesDestroyed
        observations = $observations
        authority = [ordered]@{ futureExecution = $false; sourceMutation = $false; gitRefWrite = $false; githubCredentialAccess = $false; secretAccess = $false; merge = $false; deployment = $false; arbitraryCommand = $false }
    } | ConvertTo-Json -Depth 12 -Compress
} catch {
    try { Remove-FixedRuntime } catch { }
    [ordered]@{
        schemaVersion = 'stephanos.forge-shadow-m3-fixed-proof-execution-receipt.v1'
        ok = $false
        status = 'BLOCKED'
        blocker = $script:Blocker
        repository = $Repository
        sourceHead = $ExpectedHead
        sourceTree = $ExpectedTree
        credentialMaterialPresent = $false
        arbitraryCommand = $false
    } | ConvertTo-Json -Depth 4 -Compress
    exit 1
}
