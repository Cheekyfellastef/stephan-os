[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-fA-F]{40}$')]
    [string]$ExpectedHead,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^sha256:[0-9a-fA-F]{64}$')]
    [string]$ForgejoImageDigest,

    [switch]$OperatorApproved
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Repository = 'Cheekyfellastef/stephan-os'
$ForgejoVersion = '15.0.6'
$PodmanVersion = '6.0.2'
$WindowsHostAdapter = 'podman-desktop-windows10-wsl2-v1'
$MinimumWindowsBuild = 19043
$MaximumWindowsBuildExclusive = 22000
$RequiredWindowsArchitecture = 'X64'
$PodmanDesktopVersion = '1.29.1'
$PodmanDesktopSourceCommit = 'a969ee0e0b07285122dd4988a58edb0a1a25d5fc'
$PodmanDesktopPodmanManifestBlob = '5acfedd1c3171414aa218a1d5d95ea7529687809'
$CompatibilityAuthority = 'podman-desktop-v1.29.1-win32-x64-podman-v6.0.2'
$WindowsCurrentVersionKey = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
$ImageRepository = 'code.forgejo.org/forgejo/forgejo'
$MachineName = 'stephanos-forge-shadow'
$ContainerName = 'stephanos-forge-shadow'
$RestoreContainerName = 'stephanos-forge-shadow-restore-probe'
$DataVolume = 'stephanos-forge-shadow-data'
$RestoreVolume = 'stephanos-forge-shadow-restore-probe'
$Owner = 'stephanos-shadow'
$RepoName = 'stephan-os'
$RemoteUrl = 'https://github.com/Cheekyfellastef/stephan-os.git'
$HostAddress = '127.0.0.1'
$HostPort = 3340
$RestorePort = 3341
$BootstrapTokenName = 'stephanos-m2-bootstrap'
$MirrorRefreshTokenName = 'stephanos-m2-one-shot-refresh'
$RepoRoot = Join-Path $env:USERPROFILE 'Documents\GitHub\stephan-os'
$GitExe = 'C:\Program Files\Git\cmd\git.exe'
$WslExe = Join-Path $env:SystemRoot 'System32\wsl.exe'
$PodmanUserExe = Join-Path $env:LOCALAPPDATA 'Programs\Podman\podman.exe'
$PodmanSystemExe = 'C:\Program Files\RedHat\Podman\podman.exe'
$ExpectedHead = $ExpectedHead.ToLowerInvariant()
$ForgejoImageDigest = $ForgejoImageDigest.ToLowerInvariant()
$ObservedWindowsBuild = [Environment]::OSVersion.Version.Build
$ObservedWindowsProductName = ''
$ObservedWindowsInstallationType = ''
$ObservedWindowsArchitecture = ''
$ObservedWsl2Evidence = ''
$ImageRef = "$ImageRepository@$ForgejoImageDigest"
$ApiRoot = "http://$HostAddress`:$HostPort/api/v1"
$RestoreApiRoot = "http://$HostAddress`:$RestorePort/api/v1"

function Fail([string]$Blocker, [hashtable]$Details = @{}) {
    $result = [ordered]@{
        schemaVersion = 'stephanos.forge-shadow-podman-install-receipt.v1'
        ok = $false
        status = 'BLOCKED'
        blocker = $Blocker
        repository = $Repository
        expectedHead = $ExpectedHead
        imageDigest = $ForgejoImageDigest
        windowsHostAdapter = $WindowsHostAdapter
        minimumWindowsBuild = $MinimumWindowsBuild
        maximumWindowsBuildExclusive = $MaximumWindowsBuildExclusive
        requiredWindowsArchitecture = $RequiredWindowsArchitecture
        observedWindowsBuild = $ObservedWindowsBuild
        observedWindowsProductName = $ObservedWindowsProductName
        observedWindowsInstallationType = $ObservedWindowsInstallationType
        observedWindowsArchitecture = $ObservedWindowsArchitecture
        wsl2Evidence = $ObservedWsl2Evidence
        compatibilityAuthority = $CompatibilityAuthority
        podmanDesktopVersion = $PodmanDesktopVersion
        podmanDesktopSourceCommit = $PodmanDesktopSourceCommit
        podmanDesktopPodmanManifestBlob = $PodmanDesktopPodmanManifestBlob
        arbitraryShellAllowed = $false
        arbitraryPowerShellAllowed = $false
        githubCredentialUsed = $false
        credentialPersisted = $false
        credentialLogged = $false
        publicExposure = $false
        runnerRegistration = $false
        mergeAuthority = $false
    }
    foreach ($key in $Details.Keys) { $result[$key] = $Details[$key] }
    $result | ConvertTo-Json -Depth 8 -Compress
    exit 2
}

function Invoke-Fixed([string]$Exe, [string[]]$Arguments, [switch]$AllowFailure) {
    $output = @(& $Exe @Arguments 2>&1 | ForEach-Object { [string]$_ })
    $code = $LASTEXITCODE
    if ($code -ne 0 -and -not $AllowFailure) {
        throw "Fixed executable failed with exit code $code"
    }
    return [pscustomobject]@{ ExitCode = $code; Output = $output }
}

function Get-Wsl2Evidence {
    $status = Invoke-Fixed $WslExe @('--status') -AllowFailure
    if ($status.ExitCode -eq 0) {
        $statusText = (($status.Output -join "`n") -replace "`0", '')
        if ($statusText -match '(?im)^\s*Default Version:\s*2\s*$') {
            return 'default-version-2'
        }
    }

    $list = Invoke-Fixed $WslExe @('--list', '--verbose') -AllowFailure
    if ($list.ExitCode -eq 0) {
        $listText = (($list.Output -join "`n") -replace "`0", '')
        foreach ($line in @($listText -split '\r?\n')) {
            if ($line -match '^\s*\*?\s*\S.*\s+2\s*$') {
                return 'distribution-version-2'
            }
        }
    }
    return ''
}

function Invoke-PodmanRemote([string]$Podman, [string[]]$Arguments, [switch]$AllowFailure) {
    $boundArguments = @('--connection', $MachineName) + @($Arguments)
    if ($AllowFailure) { return Invoke-Fixed $Podman $boundArguments -AllowFailure }
    return Invoke-Fixed $Podman $boundArguments
}

function Get-PodmanExe {
    if (Test-Path -LiteralPath $PodmanUserExe -PathType Leaf) { return $PodmanUserExe }
    if (Test-Path -LiteralPath $PodmanSystemExe -PathType Leaf) { return $PodmanSystemExe }
    return ''
}

function Test-PortFree([int]$Port) {
    $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    return $null -eq $listener
}

function Wait-Forgejo([string]$Root, [int]$Attempts = 30) {
    for ($attempt = 1; $attempt -le $Attempts; $attempt += 1) {
        try {
            $version = Invoke-RestMethod -Method Get -Uri "$Root/version" -TimeoutSec 3
            if ([string]$version.version -like "$ForgejoVersion*") { return [string]$version.version }
        } catch {
            Start-Sleep -Seconds 2
        }
    }
    return ''
}

function Get-ContainerExists([string]$Podman, [string]$Name) {
    $result = Invoke-PodmanRemote $Podman @('container', 'exists', $Name) -AllowFailure
    return $result.ExitCode -eq 0
}

function Get-VolumeExists([string]$Podman, [string]$Name) {
    $result = Invoke-PodmanRemote $Podman @('volume', 'exists', $Name) -AllowFailure
    return $result.ExitCode -eq 0
}

function Get-Machine([string]$Podman) {
    $result = Invoke-Fixed $Podman @('machine', 'inspect', '--format', '{{json .}}', $MachineName) -AllowFailure
    if ($result.ExitCode -ne 0) { return $null }
    try { return (($result.Output -join "`n") | ConvertFrom-Json) } catch { return $null }
}

function Assert-MachineIdentity([object]$Machine) {
    if ($null -eq $Machine) { Fail 'PODMAN_MACHINE_INSPECTION_FAILED' }
    if ([string]$Machine.Name -ne $MachineName) { Fail 'PODMAN_MACHINE_NAME_MISMATCH' }
    if ($machine.Rootful -ne $false) { Fail 'PODMAN_MACHINE_ROOTFUL_NOT_ALLOWED' }
    if ([int]$Machine.Resources.CPUs -ne 4) { Fail 'PODMAN_MACHINE_CPU_LIMIT_MISMATCH' }
    if ([int64]$Machine.Resources.Memory -ne 4096) { Fail 'PODMAN_MACHINE_MEMORY_LIMIT_MISMATCH' }
    if ([int64]$Machine.Resources.DiskSize -ne 40) { Fail 'PODMAN_MACHINE_DISK_LIMIT_MISMATCH' }
    $configPath = [string]$Machine.ConfigDir.Path
    if ($configPath -notmatch '(?i)(?:^|[\\/])wsl(?:[\\/]|$)') { Fail 'PODMAN_MACHINE_PROVIDER_NOT_WSL' }
}

function Convert-TmpfsSizeToBytes([string]$Token) {
    $normalized = $Token.Trim().ToLowerInvariant()
    if ($normalized -notmatch '^size=(\d+)([kmgt]?)$') { return [int64]-1 }
    $value = [int64]$Matches[1]
    switch ($Matches[2]) {
        'k' { return $value * 1KB }
        'm' { return $value * 1MB }
        'g' { return $value * 1GB }
        't' { return $value * 1TB }
        default { return $value }
    }
}

function Assert-ContainerIdentity(
    [string]$Podman,
    [string]$Name,
    [string]$ExpectedVolume = $DataVolume,
    [int]$ExpectedPort = $HostPort,
    [switch]$AllowStaleHeadLabel
) {
    $inspectResult = Invoke-PodmanRemote $Podman @('inspect', '--format', '{{json .}}', $Name)
    try { $inspect = (($inspectResult.Output -join "`n") | ConvertFrom-Json) } catch { Fail 'FORGE_CONTAINER_INSPECTION_INVALID' }
    $labels = $inspect.Config.Labels
    if ([string]$labels.'stephanos.repository' -ne $Repository) { Fail 'FORGE_CONTAINER_REPOSITORY_LABEL_MISMATCH' }
    $labeledHead = ([string]$labels.'stephanos.main-head').ToLowerInvariant()
    if ($labeledHead -notmatch '^[0-9a-f]{40}$') { Fail 'FORGE_CONTAINER_HEAD_LABEL_INVALID' }
    if ([string]$labels.'stephanos.image-digest' -ne $ForgejoImageDigest) { Fail 'FORGE_CONTAINER_DIGEST_LABEL_MISMATCH' }
    $sealed = [string]$labels.'stephanos.sealed'
    if (@('true', 'false') -notcontains $sealed) { Fail 'FORGE_CONTAINER_SEAL_LABEL_INVALID' }
    if ($labeledHead -ne $ExpectedHead) {
        if (-not $AllowStaleHeadLabel) { Fail 'FORGE_CONTAINER_HEAD_LABEL_MISMATCH' }
        if ($sealed -ne 'true') { Fail 'UNSEALED_FORGE_CONTAINER_HEAD_LABEL_MISMATCH' }
    }
    if ([string]$inspect.ImageName -ne $ImageRef) { Fail 'FORGE_CONTAINER_IMAGE_REFERENCE_MISMATCH' }
    if ([string]$inspect.ImageDigest -ne $ForgejoImageDigest) { Fail 'FORGE_CONTAINER_IMAGE_DIGEST_MISMATCH' }
    if ([string]$inspect.Config.User -ne '1000:1000') { Fail 'FORGE_CONTAINER_USER_NOT_ROOTLESS' }
    if ($inspect.HostConfig.ReadonlyRootfs -ne $true) { Fail 'FORGE_CONTAINER_ROOTFS_NOT_READ_ONLY' }

    $capDrop = @($inspect.HostConfig.CapDrop | ForEach-Object { ([string]$_).ToUpperInvariant() })
    if ($capDrop -notcontains 'ALL') { Fail 'FORGE_CONTAINER_CAPABILITIES_NOT_DROPPED' }
    $securityOptions = @($inspect.HostConfig.SecurityOpt | ForEach-Object { ([string]$_).ToLowerInvariant() })
    if ($securityOptions -notcontains 'no-new-privileges') { Fail 'FORGE_CONTAINER_NO_NEW_PRIVILEGES_NOT_PROVED' }
    if ([int64]$inspect.HostConfig.PidsLimit -ne 512) { Fail 'FORGE_CONTAINER_PIDS_LIMIT_MISMATCH' }
    if ([int64]$inspect.HostConfig.Memory -ne 2GB) { Fail 'FORGE_CONTAINER_MEMORY_LIMIT_MISMATCH' }
    if ([int64]$inspect.HostConfig.CpuPeriod -ne 100000 -or [int64]$inspect.HostConfig.CpuQuota -ne 200000) {
        Fail 'FORGE_CONTAINER_CPU_LIMIT_MISMATCH'
    }

    $mounts = @($inspect.Mounts)
    $dataMounts = @($mounts | Where-Object {
        [string]$_.Destination -eq '/var/lib/gitea' -and
        [string]$_.Type -eq 'volume' -and
        [string]$_.Name -eq $ExpectedVolume -and
        $_.RW -eq $true
    })
    if ($dataMounts.Count -ne 1) { Fail 'FORGE_CONTAINER_DATA_VOLUME_MISMATCH' }
    $expectedTmpfsSizes = [ordered]@{
        '/run' = [int64](16MB)
        '/tmp' = [int64](64MB)
        '/var/tmp' = [int64](32MB)
    }
    $unexpectedMounts = @($mounts | Where-Object {
        $destination = [string]$_.Destination
        if ($destination -eq '/var/lib/gitea') {
            return -not (
                [string]$_.Type -eq 'volume' -and
                [string]$_.Name -eq $ExpectedVolume -and
                $_.RW -eq $true
            )
        }
        if ($expectedTmpfsSizes.Contains($destination)) {
            return [string]$_.Type -ne 'tmpfs'
        }
        return $true
    })
    if ($unexpectedMounts.Count -ne 0) { Fail 'FORGE_CONTAINER_UNEXPECTED_WRITABLE_SURFACE' }

    $tmpfsNames = @()
    if ($null -ne $inspect.HostConfig.Tmpfs) {
        $tmpfsNames = @($inspect.HostConfig.Tmpfs.PSObject.Properties.Name | Sort-Object)
    }
    $expectedTmpfsNames = @($expectedTmpfsSizes.Keys | Sort-Object)
    if (($tmpfsNames -join '|') -ne ($expectedTmpfsNames -join '|')) { Fail 'FORGE_CONTAINER_TMPFS_SURFACE_MISMATCH' }
    foreach ($tmpfsPath in $expectedTmpfsSizes.Keys) {
        $rawOptions = [string]$inspect.HostConfig.Tmpfs.PSObject.Properties[$tmpfsPath].Value
        $options = @($rawOptions.ToLowerInvariant().Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ })
        foreach ($requiredOption in @('rw', 'nosuid', 'nodev', 'noexec')) {
            if ($options -notcontains $requiredOption) { Fail 'FORGE_CONTAINER_TMPFS_OPTIONS_MISMATCH' @{ tmpfs = $tmpfsPath } }
        }
        $sizeOptions = @($options | Where-Object { $_ -like 'size=*' })
        if ($sizeOptions.Count -ne 1 -or (Convert-TmpfsSizeToBytes $sizeOptions[0]) -ne [int64]$expectedTmpfsSizes[$tmpfsPath]) {
            Fail 'FORGE_CONTAINER_TMPFS_SIZE_MISMATCH' @{ tmpfs = $tmpfsPath }
        }
    }

    $actualEnvironment = @($inspect.Config.Env | ForEach-Object { [string]$_ })
    $expectedEnvironment = @(Get-FixedEnvironment ($sealed -eq 'true') $ExpectedPort)
    foreach ($expectedEntry in $expectedEnvironment) {
        $separator = $expectedEntry.IndexOf('=')
        if ($separator -lt 1) { Fail 'FORGE_CONTAINER_EXPECTED_ENVIRONMENT_INVALID' }
        $key = $expectedEntry.Substring(0, $separator)
        $prefix = "$key="
        $matches = @($actualEnvironment | Where-Object { $_.StartsWith($prefix, [StringComparison]::Ordinal) })
        if ($matches.Count -ne 1 -or $matches[0] -ne $expectedEntry) {
            Fail 'FORGE_CONTAINER_ENVIRONMENT_SEAL_MISMATCH' @{ environmentKey = $key }
        }
    }

    $port = (Invoke-PodmanRemote $Podman @('port', $Name, '3000/tcp')).Output -join ''
    if ($port.Trim() -ne "$HostAddress`:$ExpectedPort") { Fail 'FORGE_CONTAINER_PORT_BINDING_MISMATCH' }
    return $sealed
}

function Get-FixedEnvironment([bool]$Final, [int]$PublicPort = $HostPort) {
    $environment = @(
        'USER_UID=1000',
        'USER_GID=1000',
        'FORGEJO__database__DB_TYPE=sqlite3',
        'FORGEJO__database__PATH=/var/lib/gitea/data/forgejo.db',
        'FORGEJO__security__INSTALL_LOCK=true',
        'FORGEJO__security__DISABLE_GIT_HOOKS=true',
        'FORGEJO__security__DISABLE_WEBHOOKS=true',
        'FORGEJO__security__IMPORT_LOCAL_PATHS=false',
        'FORGEJO__server__DOMAIN=127.0.0.1',
        "FORGEJO__server__ROOT_URL=http://127.0.0.1:$PublicPort/",
        'FORGEJO__server__HTTP_PORT=3000',
        'FORGEJO__server__DISABLE_SSH=true',
        'FORGEJO__server__START_SSH_SERVER=false',
        'FORGEJO__service__DISABLE_REGISTRATION=true',
        'FORGEJO__service__SHOW_REGISTRATION_BUTTON=false',
        'FORGEJO__service__DEFAULT_ALLOW_CREATE_ORGANIZATION=false',
        'FORGEJO__admin__DISABLE_REGULAR_ORG_CREATION=true',
        'FORGEJO__admin__USER_DISABLED_FEATURES=deletion,manage_ssh_keys,manage_gpg_keys,manage_password',
        'FORGEJO__repository__MAX_CREATION_LIMIT=1',
        'FORGEJO__repository__ENABLE_PUSH_CREATE_USER=false',
        'FORGEJO__repository__ENABLE_PUSH_CREATE_ORG=false',
        'FORGEJO__repository__DISABLE_FORKS=true',
        'FORGEJO__repository__ALLOW_FORK_WITHOUT_MAXIMUM_LIMIT=false',
        'FORGEJO__repository__DISABLED_REPO_UNITS=repo.issues,repo.pulls,repo.wiki,repo.projects,repo.packages,repo.actions',
        'FORGEJO__actions__ENABLED=false',
        'FORGEJO__packages__ENABLED=false',
        'FORGEJO__federation__ENABLED=false',
        'FORGEJO__migrations__ALLOWED_DOMAINS=github.com,*.github.com',
        'FORGEJO__migrations__ALLOW_LOCALNETWORKS=false',
        'FORGEJO__migrations__SKIP_TLS_VERIFY=false',
        'FORGEJO__mirror__DISABLE_NEW_PUSH=true',
        'FORGEJO__cron__ENABLED=false'
    )
    if ($Final) {
        $environment += @(
            'FORGEJO__repository__DISABLE_MIGRATIONS=true',
            'FORGEJO__mirror__ENABLED=false',
            'FORGEJO__mirror__DISABLE_NEW_PULL=true'
        )
    } else {
        $environment += @(
            'FORGEJO__repository__DISABLE_MIGRATIONS=false',
            'FORGEJO__mirror__ENABLED=true',
            'FORGEJO__mirror__DISABLE_NEW_PULL=false'
        )
    }
    return $environment
}

function Start-FixedContainer([string]$Podman, [bool]$Final, [string]$Name = $ContainerName, [string]$Volume = $DataVolume, [int]$Port = $HostPort) {
    $args = @(
        'run', '-d', '--name', $Name,
        '--user', '1000:1000',
        '--restart', 'no',
        '--read-only',
        '--read-only-tmpfs=false',
        '--cap-drop', 'ALL',
        '--security-opt', 'no-new-privileges',
        '--pids-limit', '512',
        '--memory', '2g',
        '--cpus', '2',
        '--tmpfs', '/run:rw,nosuid,nodev,noexec,size=16m',
        '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=64m',
        '--tmpfs', '/var/tmp:rw,nosuid,nodev,noexec,size=32m',
        '--label', "stephanos.repository=$Repository",
        '--label', "stephanos.main-head=$ExpectedHead",
        '--label', "stephanos.image-digest=$ForgejoImageDigest",
        '--label', "stephanos.sealed=$($Final.ToString().ToLowerInvariant())",
        '-p', "127.0.0.1:$Port`:3000",
        '-v', "$Volume`:/var/lib/gitea"
    )
    foreach ($entry in (Get-FixedEnvironment $Final $Port)) { $args += @('-e', $entry) }
    $args += $ImageRef
    [void](Invoke-PodmanRemote $Podman $args)
}

function Ensure-LocalOwner([string]$Podman) {
    $users = Invoke-PodmanRemote $Podman @('exec', $ContainerName, 'forgejo', 'admin', 'user', 'list')
    if (($users.Output -join "`n") -match "(?m)^\s*\d+\s+$([regex]::Escape($Owner))\s") {
        $users = $null
        return
    }
    $created = Invoke-PodmanRemote $Podman @(
        'exec', $ContainerName, 'forgejo', 'admin', 'user', 'create',
        '--username', $Owner,
        '--email', 'stephanos-shadow@invalid.local',
        '--random-password',
        '--random-password-length', '40',
        '--must-change-password=false'
    )
    if ($created.ExitCode -ne 0) { Fail 'FORGE_LOCAL_OWNER_CREATE_FAILED' }
    $created = $null
    $users = $null
    [GC]::Collect()
}

function Invoke-LocalMigration([string]$Podman) {
    $tokenResult = Invoke-PodmanRemote $Podman @(
        'exec', $ContainerName, 'forgejo', 'admin', 'user', 'generate-access-token',
        '--username', $Owner,
        '--token-name', $BootstrapTokenName,
        '--raw',
        '--scopes', 'write:repository,write:user'
    )
    $token = (($tokenResult.Output -join '').Trim())
    if ($token -notmatch '^[A-Za-z0-9._-]{20,}$') { Fail 'FORGE_BOOTSTRAP_TOKEN_INVALID' }

    $migrationSucceeded = $false
    $revocationSucceeded = $false
    $migrationErrorType = ''
    $revocationErrorType = ''
    $headers = @{ Authorization = "token $token"; Accept = 'application/json' }
    $body = @{
        clone_addr = $RemoteUrl
        repo_name = $RepoName
        service = 'git'
        mirror = $true
        private = $false
    } | ConvertTo-Json -Compress
    try {
        try {
            [void](Invoke-RestMethod -Method Post -Uri "$ApiRoot/repos/migrate" -Headers $headers -ContentType 'application/json' -Body $body -TimeoutSec 180)
            $migrationSucceeded = $true
        } catch {
            $migrationErrorType = $_.Exception.GetType().FullName
        } finally {
            try {
                [void](Invoke-RestMethod -Method Delete -Uri "$ApiRoot/users/$Owner/tokens/$BootstrapTokenName" -Headers $headers -TimeoutSec 20)
                $revocationSucceeded = $true
            } catch {
                $revocationErrorType = $_.Exception.GetType().FullName
            }
        }
    } finally {
        $headers = $null
        $body = $null
        $token = $null
        $tokenResult = $null
        [GC]::Collect()
    }

    if (-not $revocationSucceeded) {
        Fail 'FORGE_BOOTSTRAP_TOKEN_REVOCATION_FAILED' @{
            bootstrapTokenRevoked = $false
            credentialPersisted = $true
            errorType = $revocationErrorType
        }
    }
    if (-not $migrationSucceeded) {
        Fail 'FORGE_MIRROR_MIGRATION_FAILED' @{
            bootstrapTokenRevoked = $true
            errorType = $migrationErrorType
        }
    }
}

function Invoke-OneShotLocalMirrorRefresh([string]$Podman) {
    $tokenResult = Invoke-PodmanRemote $Podman @(
        'exec', $ContainerName, 'forgejo', 'admin', 'user', 'generate-access-token',
        '--username', $Owner,
        '--token-name', $MirrorRefreshTokenName,
        '--raw',
        '--scopes', 'write:repository,write:user'
    ) -AllowFailure
    $token = (($tokenResult.Output -join '').Trim())
    $tokenValid = $tokenResult.ExitCode -eq 0 -and $token -match '^[A-Za-z0-9._-]{20,}$'
    $refreshSucceeded = $false
    $revocationSucceeded = $false
    $refreshErrorType = if ($tokenValid) { '' } else { 'LOCAL_TOKEN_GENERATION_FAILED' }
    $revocationErrorType = ''
    $headers = $null
    try {
        if ($tokenValid) {
            $headers = @{ Authorization = "token $token"; Accept = 'application/json' }
            try {
                [void](Invoke-RestMethod -Method Post -Uri "$ApiRoot/repos/$Owner/$RepoName/mirror-sync" -Headers $headers -TimeoutSec 180)
                $refreshSucceeded = $true
            } catch {
                $refreshErrorType = $_.Exception.GetType().FullName
            } finally {
                try {
                    [void](Invoke-RestMethod -Method Delete -Uri "$ApiRoot/users/$Owner/tokens/$MirrorRefreshTokenName" -Headers $headers -TimeoutSec 20)
                    $revocationSucceeded = $true
                } catch {
                    $revocationErrorType = $_.Exception.GetType().FullName
                }
            }
        }
    } finally {
        $headers = $null
        $token = $null
        $tokenResult = $null
        [GC]::Collect()
    }

    return [pscustomobject]@{
        RefreshSucceeded = $refreshSucceeded
        RevocationSucceeded = $revocationSucceeded
        RefreshErrorType = $refreshErrorType
        RevocationErrorType = $revocationErrorType
    }
}

function Get-MirrorHead([string]$Git, [int]$Port = $HostPort) {
    $url = "http://127.0.0.1:$Port/$Owner/$RepoName.git"
    $result = Invoke-Fixed $Git @('ls-remote', '--exit-code', $url, 'refs/heads/main') -AllowFailure
    if ($result.ExitCode -ne 0) { return '' }
    $line = ($result.Output | Select-Object -First 1)
    if ($line -match '^([0-9a-f]{40})\s+refs/heads/main$') { return $Matches[1].ToLowerInvariant() }
    return ''
}

function Assert-FixedMirrorMetadata {
    try {
        $mirror = Invoke-RestMethod -Method Get -Uri "$ApiRoot/repos/$Owner/$RepoName" -TimeoutSec 10
    } catch {
        Fail 'FORGE_MIRROR_METADATA_UNAVAILABLE'
    }
    if ([string]$mirror.owner.login -ne $Owner) { Fail 'FORGE_MIRROR_OWNER_MISMATCH' }
    if ([string]$mirror.name -ne $RepoName) { Fail 'FORGE_MIRROR_REPOSITORY_NAME_MISMATCH' }
    if ($mirror.mirror -isnot [bool] -or $mirror.mirror -ne $true) { Fail 'FORGE_REPOSITORY_NOT_PULL_MIRROR' }
    if ([string]$mirror.original_url -ne $RemoteUrl) { Fail 'FORGE_MIRROR_REMOTE_MISMATCH' }
}

function Wait-ExpectedMirrorHead([string]$Git, [int]$Attempts = 30) {
    $observedHead = ''
    for ($attempt = 1; $attempt -le $Attempts; $attempt += 1) {
        $observedHead = Get-MirrorHead $Git
        if ($observedHead -eq $ExpectedHead) { return $observedHead }
        Start-Sleep -Seconds 2
    }
    return $observedHead
}

function Get-ForgeTree([string]$Root, [string]$Head) {
    try {
        $commit = Invoke-RestMethod -Method Get -Uri "$Root/repos/$Owner/$RepoName/git/commits/$Head" -TimeoutSec 10
        return ([string]$commit.tree.sha).ToLowerInvariant()
    } catch { return '' }
}

function Assert-BackupTools([string]$Podman) {
    $fixedToolProbe = 'command -v tar >/dev/null 2>&1 && command -v sha256sum >/dev/null 2>&1'
    $probe = Invoke-PodmanRemote $Podman @(
        'run', '--rm', '--read-only', '--read-only-tmpfs=false', '--cap-drop', 'ALL',
        '--security-opt', 'no-new-privileges', $ImageRef, 'sh', '-c', $fixedToolProbe
    ) -AllowFailure
    if ($probe.ExitCode -ne 0) { Fail 'FORGE_BACKUP_HELPER_TOOLS_UNAVAILABLE' }
}

function Get-VolumeDigest([string]$Podman, [string]$Volume) {
    $fixedHashCommand = 'cd /source && tar -cf - . | sha256sum'
    $result = Invoke-PodmanRemote $Podman @(
        'run', '--rm', '--user', '1000:1000', '--read-only', '--read-only-tmpfs=false',
        '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
        '-v', "$Volume`:/source:ro",
        $ImageRef, 'sh', '-c', $fixedHashCommand
    )
    $text = ($result.Output -join ' ').Trim()
    if ($text -match '^([0-9a-f]{64})\s') { return $Matches[1].ToLowerInvariant() }
    return ''
}

function Copy-Volume([string]$Podman, [string]$Source, [string]$Destination) {
    $fixedCopyCommand = 'cd /source && tar -cf - . | (cd /destination && tar -xf -)'
    [void](Invoke-PodmanRemote $Podman @(
        'run', '--rm', '--user', '1000:1000', '--read-only', '--read-only-tmpfs=false',
        '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
        '-v', "$Source`:/source:ro",
        '-v', "$Destination`:/destination",
        $ImageRef, 'sh', '-c', $fixedCopyCommand
    ))
}

function Create-And-ProveBackup([string]$Podman, [string]$Git) {
    $mainStopped = $false
    $backupResult = $null
    try {
        if (Get-ContainerExists $Podman $RestoreContainerName) { [void](Invoke-PodmanRemote $Podman @('rm', '-f', $RestoreContainerName)) }
        if (Get-VolumeExists $Podman $RestoreVolume) { [void](Invoke-PodmanRemote $Podman @('volume', 'rm', '-f', $RestoreVolume)) }

        [void](Invoke-PodmanRemote $Podman @('stop', '--time', '20', $ContainerName))
        $mainStopped = $true
        $digest = Get-VolumeDigest $Podman $DataVolume
        if ($digest -notmatch '^[0-9a-f]{64}$') { Fail 'FORGE_BACKUP_DIGEST_FAILED' }

        $backupName = "stephanos-forge-shadow-backup-$($digest.Substring(0, 16))"
        $existingBackups = (Invoke-PodmanRemote $Podman @('volume', 'ls', '--filter', 'label=stephanos.backup=forge-shadow', '--format', '{{.Name}}')).Output | Where-Object { $_ }
        if (-not (Get-VolumeExists $Podman $backupName)) {
            if (@($existingBackups).Count -ge 7) { Fail 'FORGE_BACKUP_RETENTION_CAPACITY_REACHED' }
            [void](Invoke-PodmanRemote $Podman @('volume', 'create', '--label', 'stephanos.backup=forge-shadow', '--label', "stephanos.backup-digest=$digest", $backupName))
            Copy-Volume $Podman $DataVolume $backupName
        }
        $backupDigest = Get-VolumeDigest $Podman $backupName
        if ($backupDigest -ne $digest) {
            Fail 'FORGE_BACKUP_COPY_DIGEST_MISMATCH' @{ sourceDigest = $digest; backupDigest = $backupDigest }
        }

        [void](Invoke-PodmanRemote $Podman @('volume', 'create', $RestoreVolume))
        Copy-Volume $Podman $backupName $RestoreVolume
        $restoreDigest = Get-VolumeDigest $Podman $RestoreVolume
        if ($restoreDigest -ne $digest) {
            Fail 'FORGE_RESTORE_COPY_DIGEST_MISMATCH' @{ backupDigest = $digest; restoreDigest = $restoreDigest }
        }

        if (-not (Test-PortFree $RestorePort)) { Fail 'FORGE_RESTORE_PROBE_PORT_NOT_AVAILABLE' }
        Start-FixedContainer $Podman $true $RestoreContainerName $RestoreVolume $RestorePort
        $restoreVersion = Wait-Forgejo $RestoreApiRoot
        if (-not $restoreVersion) { Fail 'FORGE_RESTORE_PROBE_HEALTH_FAILED' }
        [void](Assert-ContainerIdentity $Podman $RestoreContainerName $RestoreVolume $RestorePort)
        $restoreHead = Get-MirrorHead $Git $RestorePort
        if ($restoreHead -ne $ExpectedHead) { Fail 'FORGE_RESTORE_PROBE_HEAD_MISMATCH' @{ observedHead = $restoreHead } }
        $backupResult = [pscustomobject]@{ Digest = $digest; Volume = $backupName }
    } finally {
        if (Get-ContainerExists $Podman $RestoreContainerName) {
            [void](Invoke-PodmanRemote $Podman @('rm', '-f', $RestoreContainerName) -AllowFailure)
        }
        if (Get-VolumeExists $Podman $RestoreVolume) {
            [void](Invoke-PodmanRemote $Podman @('volume', 'rm', '-f', $RestoreVolume) -AllowFailure)
        }
        if ($mainStopped -and (Get-ContainerExists $Podman $ContainerName)) {
            [void](Invoke-PodmanRemote $Podman @('start', $ContainerName) -AllowFailure)
        }
    }

    if ($null -eq $backupResult) { Fail 'FORGE_BACKUP_RESTORE_PROOF_INCOMPLETE' }
    $mainVersion = Wait-Forgejo $ApiRoot
    if (-not $mainVersion) { Fail 'FORGE_POST_BACKUP_RESTART_HEALTH_FAILED' }
    [void](Assert-ContainerIdentity $Podman $ContainerName $DataVolume $HostPort)
    return [pscustomobject]@{ Digest = $backupResult.Digest; Volume = $backupResult.Volume; Version = $mainVersion }
}

try {
    $windowsIdentity = Get-ItemProperty -LiteralPath $WindowsCurrentVersionKey -ErrorAction Stop
    $ObservedWindowsProductName = ([string]$windowsIdentity.ProductName).Trim()
    $ObservedWindowsInstallationType = ([string]$windowsIdentity.InstallationType).Trim()
    $ObservedWindowsArchitecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
} catch {
    Fail 'WINDOWS_PRODUCT_IDENTITY_UNAVAILABLE'
}
if ($ObservedWindowsInstallationType -ne 'Client' -or $ObservedWindowsProductName -notmatch '^Windows 10(?:\s|$)') {
    Fail 'WINDOWS_10_CLIENT_REQUIRED'
}
if ($ObservedWindowsArchitecture -ne $RequiredWindowsArchitecture) {
    Fail 'WINDOWS_10_CLIENT_REQUIRED' @{ observedWindowsArchitecture = $ObservedWindowsArchitecture }
}

if (-not (Test-Path -LiteralPath $RepoRoot -PathType Container)) { Fail 'CANONICAL_REPOSITORY_ROOT_MISSING' }
if (-not (Test-Path -LiteralPath $GitExe -PathType Leaf)) { Fail 'FIXED_GIT_EXECUTABLE_MISSING' }
if (-not (Test-Path -LiteralPath $WslExe -PathType Leaf)) { Fail 'WSL_EXECUTABLE_MISSING' }
if ($ObservedWindowsBuild -lt $MinimumWindowsBuild) { Fail 'WINDOWS_10_BUILD_19043_OR_NEWER_REQUIRED' }
if ($ObservedWindowsBuild -ge $MaximumWindowsBuildExclusive) {
    Fail 'WINDOWS_10_CLIENT_REQUIRED' @{ observedWindowsBuild = $ObservedWindowsBuild }
}

$branch = ((Invoke-Fixed $GitExe @('-C', $RepoRoot, 'branch', '--show-current')).Output -join '').Trim()
if ($branch -ne 'main') { Fail 'CANONICAL_REPOSITORY_NOT_MAIN' @{ branch = $branch } }
$localHead = ((Invoke-Fixed $GitExe @('-C', $RepoRoot, 'rev-parse', 'HEAD')).Output -join '').Trim().ToLowerInvariant()
if ($localHead -ne $ExpectedHead) { Fail 'CANONICAL_REPOSITORY_HEAD_MISMATCH' @{ localHead = $localHead } }
$localTree = ((Invoke-Fixed $GitExe @('-C', $RepoRoot, 'rev-parse', "$ExpectedHead^{tree}")).Output -join '').Trim().ToLowerInvariant()

$ObservedWsl2Evidence = Get-Wsl2Evidence
if (-not $ObservedWsl2Evidence) { Fail 'WSL2_NOT_AVAILABLE' }

$PodmanExe = Get-PodmanExe
if (-not $PodmanExe) { Fail 'PODMAN_6_0_2_USER_PREREQUISITE_REQUIRED' }
$podmanVersionText = ((Invoke-Fixed $PodmanExe @('--version')).Output -join ' ').Trim()
if ($podmanVersionText -notmatch 'podman version 6\.0\.2(?:\s|$)') { Fail 'PODMAN_VERSION_MISMATCH' @{ observedVersion = $podmanVersionText } }

if (-not $OperatorApproved -and -not $WhatIfPreference) { Fail 'EXACT_RUNTIME_OPERATOR_APPROVAL_REQUIRED' }
if ($WhatIfPreference) {
    [ordered]@{
        schemaVersion = 'stephanos.forge-shadow-podman-install-receipt.v1'
        ok = $true
        status = 'WHAT_IF_READY'
        repository = $Repository
        expectedHead = $ExpectedHead
        imageDigest = $ForgejoImageDigest
        forgejoVersion = $ForgejoVersion
        podmanVersion = $PodmanVersion
        windowsHostAdapter = $WindowsHostAdapter
        minimumWindowsBuild = $MinimumWindowsBuild
        maximumWindowsBuildExclusive = $MaximumWindowsBuildExclusive
        requiredWindowsArchitecture = $RequiredWindowsArchitecture
        observedWindowsBuild = $ObservedWindowsBuild
        observedWindowsProductName = $ObservedWindowsProductName
        observedWindowsInstallationType = $ObservedWindowsInstallationType
        observedWindowsArchitecture = $ObservedWindowsArchitecture
        wsl2Evidence = $ObservedWsl2Evidence
        compatibilityAuthority = $CompatibilityAuthority
        podmanDesktopVersion = $PodmanDesktopVersion
        podmanDesktopSourceCommit = $PodmanDesktopSourceCommit
        podmanDesktopPodmanManifestBlob = $PodmanDesktopPodmanManifestBlob
        listener = "$HostAddress`:$HostPort"
        mutationPerformed = $false
        githubCredentialUsed = $false
        credentialPersisted = $false
        credentialLogged = $false
        runnerRegistration = $false
        mergeAuthority = $false
    } | ConvertTo-Json -Depth 8 -Compress
    exit 0
}

try {
    $machine = Get-Machine $PodmanExe
    if ($null -eq $machine) {
        if (-not $PSCmdlet.ShouldProcess($MachineName, 'Initialize fixed rootless WSL Podman machine')) { Fail 'RUNTIME_MUTATION_NOT_CONFIRMED' }
        [void](Invoke-Fixed $PodmanExe @('machine', 'init', '--provider', 'wsl', '--rootful=false', '--cpus', '4', '--memory', '4096', '--disk-size', '40', '--update-connection=false', $MachineName))
        $machine = Get-Machine $PodmanExe
    }
    Assert-MachineIdentity $machine
    if ([string]$machine.State -ne 'running') {
        if (-not $PSCmdlet.ShouldProcess($MachineName, 'Start fixed Podman machine')) { Fail 'RUNTIME_MUTATION_NOT_CONFIRMED' }
        [void](Invoke-Fixed $PodmanExe @('machine', 'start', '--update-connection=false', $MachineName))
        $machine = Get-Machine $PodmanExe
    }
    Assert-MachineIdentity $machine
    if ([string]$machine.State -ne 'running') {
        Fail 'PODMAN_MACHINE_RUNNING_ROOTLESS_NOT_PROVED'
    }
    $connectionProbe = Invoke-PodmanRemote $PodmanExe @('info') -AllowFailure
    if ($connectionProbe.ExitCode -ne 0) { Fail 'PODMAN_MACHINE_CONNECTION_UNAVAILABLE' }
    $connectionProbe = $null

    $imageExists = Invoke-PodmanRemote $PodmanExe @('image', 'exists', $ImageRef) -AllowFailure
    if ($imageExists.ExitCode -ne 0) {
        if (-not $PSCmdlet.ShouldProcess($ImageRef, 'Pull exact Forgejo OCI digest')) { Fail 'RUNTIME_MUTATION_NOT_CONFIRMED' }
        [void](Invoke-PodmanRemote $PodmanExe @('pull', $ImageRef))
    }
    Assert-BackupTools $PodmanExe

    if (-not (Get-VolumeExists $PodmanExe $DataVolume)) {
        if (-not $PSCmdlet.ShouldProcess($DataVolume, 'Create fixed Forgejo data volume')) { Fail 'RUNTIME_MUTATION_NOT_CONFIRMED' }
        [void](Invoke-PodmanRemote $PodmanExe @('volume', 'create', $DataVolume))
    }

    $sealed = ''
    $mirrorRefreshPerformed = $false
    $mirrorRefreshTokenRevoked = $false
    if (Get-ContainerExists $PodmanExe $ContainerName) {
        $sealed = Assert-ContainerIdentity $PodmanExe $ContainerName $DataVolume $HostPort -AllowStaleHeadLabel
    } else {
        if (-not (Test-PortFree $HostPort)) { Fail 'FIXED_LOOPBACK_PORT_NOT_AVAILABLE' }
        if (-not $PSCmdlet.ShouldProcess($ContainerName, 'Start fixed Forgejo bootstrap container')) { Fail 'RUNTIME_MUTATION_NOT_CONFIRMED' }
        Start-FixedContainer $PodmanExe $false
    }

    $version = Wait-Forgejo $ApiRoot
    if (-not $version) { Fail 'FORGE_SERVICE_HEALTH_FAILED' }
    [void](Assert-ContainerIdentity $PodmanExe $ContainerName $DataVolume $HostPort -AllowStaleHeadLabel)

    $mirrorHead = Get-MirrorHead $GitExe
    if (-not $mirrorHead) {
        if ($sealed -eq 'true') { Fail 'SEALED_FORGE_MIRROR_MISSING' }
        Ensure-LocalOwner $PodmanExe
        if (-not $PSCmdlet.ShouldProcess($RemoteUrl, 'Create one exact public pull mirror and revoke bootstrap token')) { Fail 'RUNTIME_MUTATION_NOT_CONFIRMED' }
        Invoke-LocalMigration $PodmanExe
        $mirrorHead = Get-MirrorHead $GitExe
    }
    if ($mirrorHead -ne $ExpectedHead) {
        if ($sealed -ne 'true') { Fail 'FORGE_MIRROR_HEAD_MISMATCH' @{ observedHead = $mirrorHead } }
        Assert-FixedMirrorMetadata
        if (-not $PSCmdlet.ShouldProcess("$Owner/$RepoName", "Run one fixed loopback-only mirror refresh to ${ExpectedHead}, revoke its local token, and reseal")) {
            Fail 'RUNTIME_MUTATION_NOT_CONFIRMED'
        }

        $refreshResult = $null
        $refreshedMirrorHead = ''
        try {
            [void](Invoke-PodmanRemote $PodmanExe @('rm', '-f', $ContainerName))
            Start-FixedContainer $PodmanExe $false
            $refreshVersion = Wait-Forgejo $ApiRoot
            if (-not $refreshVersion) { Fail 'FORGE_MIRROR_REFRESH_SERVICE_HEALTH_FAILED' }
            $refreshSeal = Assert-ContainerIdentity $PodmanExe $ContainerName $DataVolume $HostPort
            if ($refreshSeal -ne 'false') { Fail 'FORGE_MIRROR_REFRESH_WINDOW_NOT_PROVED' }
            Ensure-LocalOwner $PodmanExe
            $refreshResult = Invoke-OneShotLocalMirrorRefresh $PodmanExe
            if ($refreshResult.RefreshSucceeded) {
                $refreshedMirrorHead = Wait-ExpectedMirrorHead $GitExe
            }
        } finally {
            if (Get-ContainerExists $PodmanExe $ContainerName) {
                [void](Invoke-PodmanRemote $PodmanExe @('rm', '-f', $ContainerName) -AllowFailure)
            }
            Start-FixedContainer $PodmanExe $true
        }

        $sealed = Assert-ContainerIdentity $PodmanExe $ContainerName $DataVolume $HostPort
        if ($sealed -ne 'true') { Fail 'FORGE_FINAL_SEAL_NOT_PROVED' }
        $version = Wait-Forgejo $ApiRoot
        if (-not $version) { Fail 'FORGE_SEALED_SERVICE_HEALTH_FAILED' }
        if ($null -eq $refreshResult) { Fail 'FORGE_MIRROR_REFRESH_RESULT_MISSING' }
        if (-not $refreshResult.RevocationSucceeded) {
            Fail 'FORGE_MIRROR_REFRESH_TOKEN_REVOCATION_FAILED' @{
                mirrorRefreshTokenRevoked = $false
                credentialPersisted = $true
                errorType = $refreshResult.RevocationErrorType
            }
        }
        $mirrorRefreshTokenRevoked = $true
        if (-not $refreshResult.RefreshSucceeded) {
            Fail 'FORGE_MIRROR_REFRESH_REQUEST_FAILED' @{
                mirrorRefreshTokenRevoked = $true
                errorType = $refreshResult.RefreshErrorType
            }
        }
        if ($refreshedMirrorHead -ne $ExpectedHead) {
            Fail 'FORGE_MIRROR_REFRESH_HEAD_MISMATCH' @{ observedHead = $refreshedMirrorHead; mirrorRefreshTokenRevoked = $true }
        }
        Assert-FixedMirrorMetadata
        $mirrorRefreshPerformed = $true
        $mirrorHead = Get-MirrorHead $GitExe
    }

    if ($sealed -ne 'true') {
        if (-not $PSCmdlet.ShouldProcess($ContainerName, 'Seal Forgejo read-only M2 posture')) { Fail 'RUNTIME_MUTATION_NOT_CONFIRMED' }
        [void](Invoke-PodmanRemote $PodmanExe @('rm', '-f', $ContainerName))
        Start-FixedContainer $PodmanExe $true
        $sealed = Assert-ContainerIdentity $PodmanExe $ContainerName $DataVolume $HostPort
        if ($sealed -ne 'true') { Fail 'FORGE_FINAL_SEAL_NOT_PROVED' }
        $version = Wait-Forgejo $ApiRoot
        if (-not $version) { Fail 'FORGE_SEALED_SERVICE_HEALTH_FAILED' }
    }

    $mirrorHead = Get-MirrorHead $GitExe
    if ($mirrorHead -ne $ExpectedHead) { Fail 'FORGE_SEALED_MIRROR_HEAD_MISMATCH' @{ observedHead = $mirrorHead } }
    $forgeTree = Get-ForgeTree $ApiRoot $ExpectedHead
    if ($forgeTree -notmatch '^[0-9a-f]{40}$') { Fail 'FORGE_TREE_PROOF_UNAVAILABLE' }
    if ($forgeTree -ne $localTree) { Fail 'FORGE_TREE_PARITY_MISMATCH' @{ forgeTree = $forgeTree; canonicalTree = $localTree } }

    if (-not $PSCmdlet.ShouldProcess($DataVolume, 'Create content-addressed backup and restore probe')) { Fail 'RUNTIME_MUTATION_NOT_CONFIRMED' }
    $backup = Create-And-ProveBackup $PodmanExe $GitExe

    [ordered]@{
        schemaVersion = 'stephanos.forge-shadow-podman-install-receipt.v1'
        ok = $true
        status = 'FORGE_SHADOW_M2_READY'
        repository = $Repository
        expectedHead = $ExpectedHead
        canonicalTree = $localTree
        mirrorHead = $mirrorHead
        mirrorTree = $forgeTree
        exactObjectParity = $true
        exactTreeParity = $true
        imageDigest = $ForgejoImageDigest
        forgejoVersion = $backup.Version
        podmanVersion = $PodmanVersion
        windowsHostAdapter = $WindowsHostAdapter
        minimumWindowsBuild = $MinimumWindowsBuild
        maximumWindowsBuildExclusive = $MaximumWindowsBuildExclusive
        requiredWindowsArchitecture = $RequiredWindowsArchitecture
        observedWindowsBuild = $ObservedWindowsBuild
        observedWindowsProductName = $ObservedWindowsProductName
        observedWindowsInstallationType = $ObservedWindowsInstallationType
        observedWindowsArchitecture = $ObservedWindowsArchitecture
        wsl2Evidence = $ObservedWsl2Evidence
        compatibilityAuthority = $CompatibilityAuthority
        podmanDesktopVersion = $PodmanDesktopVersion
        podmanDesktopSourceCommit = $PodmanDesktopSourceCommit
        podmanDesktopPodmanManifestBlob = $PodmanDesktopPodmanManifestBlob
        machine = $MachineName
        podmanConnection = $MachineName
        container = $ContainerName
        listener = "$HostAddress`:$HostPort"
        readOnlySealed = $true
        rootFilesystemReadOnly = $true
        allCapabilitiesDropped = $true
        noNewPrivileges = $true
        persistentWritableSurface = '/var/lib/gitea'
        boundedEphemeralWritableSurfaces = @('/run', '/tmp', '/var/tmp')
        automaticMirrorUpdatesEnabled = $false
        oneShotMirrorRefreshPerformed = $mirrorRefreshPerformed
        mirrorRefreshTokenRevoked = $mirrorRefreshTokenRevoked
        githubCredentialUsed = $false
        bootstrapTokenRevoked = $true
        credentialPersisted = $false
        credentialLogged = $false
        backupDigest = $backup.Digest
        backupVolume = $backup.Volume
        restoreDrillPassed = $true
        arbitraryShellAllowed = $false
        arbitraryPowerShellAllowed = $false
        publicExposure = $false
        tailscaleExposure = $false
        runnerRegistration = $false
        actionsExecution = $false
        mergeAuthority = $false
        readyForM3 = $true
    } | ConvertTo-Json -Depth 8 -Compress
} catch {
    Fail 'FORGE_SHADOW_INSTALLER_EXCEPTION' @{ errorType = $_.Exception.GetType().FullName }
}
