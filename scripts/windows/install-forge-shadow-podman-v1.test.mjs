import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./install-forge-shadow-podman-v1.ps1', import.meta.url), 'utf8');

function has(value) {
  assert.ok(source.includes(value), `expected installer source to contain: ${value}`);
}

function lacks(value) {
  assert.equal(source.includes(value), false, `installer source must not contain: ${value}`);
}

test('installer accepts only exact head, exact image digest and approval identity inputs', () => {
  has("[ValidatePattern('^[0-9a-fA-F]{40}$')]");
  has("[ValidatePattern('^sha256:[0-9a-fA-F]{64}$')]");
  has('[switch]$OperatorApproved');
  has("$Repository = 'Cheekyfellastef/stephan-os'");
  has("$RemoteUrl = 'https://github.com/Cheekyfellastef/stephan-os.git'");
  lacks('[string]$Command');
  lacks('[string]$Executable');
  lacks('[string]$Path');
  lacks('[string]$Url');
});

test('Windows and executable identities are fixed rather than PATH selected', () => {
  has("$GitExe = 'C:\\Program Files\\Git\\cmd\\git.exe'");
  has("$WslExe = Join-Path $env:SystemRoot 'System32\\wsl.exe'");
  has("$PodmanUserExe = Join-Path $env:LOCALAPPDATA 'Programs\\Podman\\podman.exe'");
  has("$PodmanSystemExe = 'C:\\Program Files\\RedHat\\Podman\\podman.exe'");
  has("'PODMAN_6_0_2_USER_PREREQUISITE_REQUIRED'");
  lacks('Get-Command podman');
  lacks('winget');
  lacks('choco');
  lacks('scoop');
});

test('Windows 10 x64 compatibility authority uses an exact build range and real WSL2 evidence', () => {
  has("$WindowsHostAdapter = 'podman-desktop-windows10-wsl2-v1'");
  has('$MinimumWindowsBuild = 19043');
  has('$MaximumWindowsBuildExclusive = 22000');
  has("$RequiredWindowsArchitecture = 'X64'");
  has("$PodmanDesktopVersion = '1.29.1'");
  has("$PodmanDesktopSourceCommit = 'a969ee0e0b07285122dd4988a58edb0a1a25d5fc'");
  has("$PodmanDesktopPodmanManifestBlob = '5acfedd1c3171414aa218a1d5d95ea7529687809'");
  has("Fail 'WINDOWS_10_BUILD_19043_OR_NEWER_REQUIRED'");
  has("$WindowsCurrentVersionKey = 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion'");
  has("Fail 'WINDOWS_PRODUCT_IDENTITY_UNAVAILABLE'");
  has("Fail 'WINDOWS_10_CLIENT_REQUIRED'");
  has("$ObservedWindowsInstallationType -ne 'Client'");
  has("$ObservedWindowsProductName -notmatch '^Windows 10(?:\\s|$)'");
  has('[System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()');
  has('$ObservedWindowsArchitecture -ne $RequiredWindowsArchitecture');
  has('$ObservedWindowsBuild -ge $MaximumWindowsBuildExclusive');
  has('function Get-Wsl2Evidence');
  has("@('--status')");
  has("@('--list', '--verbose')");
  has("return 'default-version-2'");
  has("return 'distribution-version-2'");
  has('$ObservedWsl2Evidence = Get-Wsl2Evidence');
  has("if (-not $ObservedWsl2Evidence) { Fail 'WSL2_NOT_AVAILABLE' }");
  has('maximumWindowsBuildExclusive = $MaximumWindowsBuildExclusive');
  has('requiredWindowsArchitecture = $RequiredWindowsArchitecture');
  has('observedWindowsArchitecture = $ObservedWindowsArchitecture');
  has('wsl2Evidence = $ObservedWsl2Evidence');
  lacks('$wslStatus = Invoke-Fixed');
  lacks('WINDOWS_11_OR_NEWER_REQUIRED');
});

test('machine creation and inspection are WSL rootless bounded identities', () => {
  has("'machine', 'init', '--provider', 'wsl', '--rootful=false', '--cpus', '4', '--memory', '4096', '--disk-size', '40'");
  has("'machine', 'inspect', '--format', '{{json .}}', $MachineName");
  has("$MachineName = 'stephanos-forge-shadow'");
  has('function Assert-MachineIdentity');
  has("if ([string]$Machine.Name -ne $MachineName) { Fail 'PODMAN_MACHINE_NAME_MISMATCH' }");
  has("if ($machine.Rootful -ne $false) { Fail 'PODMAN_MACHINE_ROOTFUL_NOT_ALLOWED' }");
  has("if ([int]$Machine.Resources.CPUs -ne 4) { Fail 'PODMAN_MACHINE_CPU_LIMIT_MISMATCH' }");
  has("if ([int64]$Machine.Resources.Memory -ne 4096) { Fail 'PODMAN_MACHINE_MEMORY_LIMIT_MISMATCH' }");
  has("if ([int64]$Machine.Resources.DiskSize -ne 40) { Fail 'PODMAN_MACHINE_DISK_LIMIT_MISMATCH' }");
  has("Fail 'PODMAN_MACHINE_PROVIDER_NOT_WSL'");
  has('Assert-MachineIdentity $machine');
  has("Fail 'PODMAN_MACHINE_RUNNING_ROOTLESS_NOT_PROVED'");
  lacks('--privileged');
});

test('every remote Podman operation is bound to the named Forge machine connection', () => {
  has('function Invoke-PodmanRemote');
  has("$boundArguments = @('--connection', $MachineName) + @($Arguments)");
  has("$connectionProbe = Invoke-PodmanRemote $PodmanExe @('info') -AllowFailure");
  has("Fail 'PODMAN_MACHINE_CONNECTION_UNAVAILABLE'");
  has('podmanConnection = $MachineName');
  for (const unbound of [
    "Invoke-Fixed $Podman @('container'",
    "Invoke-Fixed $Podman @('volume'",
    "Invoke-Fixed $Podman @('inspect'",
    "Invoke-Fixed $Podman @('port'",
    "Invoke-Fixed $Podman @('run'",
    "Invoke-Fixed $Podman @('exec'",
    "Invoke-Fixed $Podman @('stop'",
    "Invoke-Fixed $Podman @('start'",
    "Invoke-Fixed $Podman @('rm'",
  ]) lacks(unbound);
});

test('Forgejo is current-LTS digest pinned and exposes only loopback HTTP with no SSH port', () => {
  has("$ForgejoVersion = '15.0.6'");
  has("$HostAddress = '127.0.0.1'");
  has('$HostPort = 3340');
  has("'-p', \"127.0.0.1:$Port`:3000\"");
  has("'-v', \"$Volume`:/var/lib/gitea\"");
  has("\"FORGEJO__server__ROOT_URL=http://127.0.0.1:$PublicPort/\"");
  has("'FORGEJO__server__DISABLE_SSH=true'");
  has("'FORGEJO__server__START_SSH_SERVER=false'");
  has("Invoke-PodmanRemote $PodmanExe @('pull', $ImageRef)");
  has("if ([string]$inspect.ImageName -ne $ImageRef) { Fail 'FORGE_CONTAINER_IMAGE_REFERENCE_MISMATCH' }");
  has("if ([string]$inspect.ImageDigest -ne $ForgejoImageDigest) { Fail 'FORGE_CONTAINER_IMAGE_DIGEST_MISMATCH' }");
  lacks('0.0.0.0:');
  lacks(':2222');
  lacks('/var/run/docker.sock');
  lacks('podman.sock');
});

test('service container root filesystem resource and privilege posture are explicitly reproved', () => {
  has("'--read-only'");
  has("'--read-only-tmpfs=false'");
  has("'--cap-drop', 'ALL'");
  has("'--security-opt', 'no-new-privileges'");
  has("'--pids-limit', '512'");
  has("'--memory', '2g'");
  has("'--cpus', '2'");
  has("'--tmpfs', '/run:rw,nosuid,nodev,noexec,size=16m'");
  has("'--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=64m'");
  has("'--tmpfs', '/var/tmp:rw,nosuid,nodev,noexec,size=32m'");
  has("if ($inspect.HostConfig.ReadonlyRootfs -ne $true) { Fail 'FORGE_CONTAINER_ROOTFS_NOT_READ_ONLY' }");
  has("if ($capDrop -notcontains 'ALL') { Fail 'FORGE_CONTAINER_CAPABILITIES_NOT_DROPPED' }");
  has("if ($securityOptions -notcontains 'no-new-privileges') { Fail 'FORGE_CONTAINER_NO_NEW_PRIVILEGES_NOT_PROVED' }");
  has("if ([int64]$inspect.HostConfig.PidsLimit -ne 512) { Fail 'FORGE_CONTAINER_PIDS_LIMIT_MISMATCH' }");
  has("if ([int64]$inspect.HostConfig.Memory -ne 2GB) { Fail 'FORGE_CONTAINER_MEMORY_LIMIT_MISMATCH' }");
  has("if ([int64]$inspect.HostConfig.CpuPeriod -ne 100000 -or [int64]$inspect.HostConfig.CpuQuota -ne 200000)");
  has("Fail 'FORGE_CONTAINER_CPU_LIMIT_MISMATCH'");
  has("if ($dataMounts.Count -ne 1) { Fail 'FORGE_CONTAINER_DATA_VOLUME_MISMATCH' }");
  has("if ($unexpectedMounts.Count -ne 0) { Fail 'FORGE_CONTAINER_UNEXPECTED_WRITABLE_SURFACE' }");
  has("if (($tmpfsNames -join '|') -ne ($expectedTmpfsNames -join '|')) { Fail 'FORGE_CONTAINER_TMPFS_SURFACE_MISMATCH' }");
  has("Fail 'FORGE_CONTAINER_TMPFS_OPTIONS_MISMATCH'");
  has("Fail 'FORGE_CONTAINER_TMPFS_SIZE_MISMATCH'");
  has('function Convert-TmpfsSizeToBytes');
  has("Fail 'FORGE_CONTAINER_ENVIRONMENT_SEAL_MISMATCH'");
});

test('bootstrap is closed to signup org creation extra repos forks hooks and unsafe migrations', () => {
  has("'FORGEJO__service__DISABLE_REGISTRATION=true'");
  has("'FORGEJO__service__DEFAULT_ALLOW_CREATE_ORGANIZATION=false'");
  has("'FORGEJO__admin__DISABLE_REGULAR_ORG_CREATION=true'");
  has("'FORGEJO__admin__USER_DISABLED_FEATURES=deletion,manage_ssh_keys,manage_gpg_keys,manage_password'");
  has("'FORGEJO__repository__MAX_CREATION_LIMIT=1'");
  has("'FORGEJO__repository__ENABLE_PUSH_CREATE_USER=false'");
  has("'FORGEJO__repository__ENABLE_PUSH_CREATE_ORG=false'");
  has("'FORGEJO__repository__DISABLE_FORKS=true'");
  has("'FORGEJO__repository__ALLOW_FORK_WITHOUT_MAXIMUM_LIMIT=false'");
  has("'FORGEJO__security__DISABLE_GIT_HOOKS=true'");
  has("'FORGEJO__security__DISABLE_WEBHOOKS=true'");
  has("'FORGEJO__security__IMPORT_LOCAL_PATHS=false'");
  has("'FORGEJO__migrations__ALLOWED_DOMAINS=github.com,*.github.com'");
  has("'FORGEJO__migrations__ALLOW_LOCALNETWORKS=false'");
  has("'FORGEJO__migrations__SKIP_TLS_VERIFY=false'");
});

test('local mirror owner is deliberately non-admin and its random password is discarded', () => {
  has("'forgejo', 'admin', 'user', 'create'");
  has("'--random-password'");
  has("'--random-password-length', '40'");
  has('$created = $null');
  has('$users = $null');
  lacks("'--admin'");
});

test('Actions packages federation and scheduled mirror updates are disabled', () => {
  has("'FORGEJO__actions__ENABLED=false'");
  has("'FORGEJO__packages__ENABLED=false'");
  has("'FORGEJO__federation__ENABLED=false'");
  has("'FORGEJO__cron__ENABLED=false'");
  has("'FORGEJO__repository__DISABLE_MIGRATIONS=true'");
  has("'FORGEJO__mirror__ENABLED=false'");
  has("'FORGEJO__mirror__DISABLE_NEW_PULL=true'");
  has("'FORGEJO__mirror__DISABLE_NEW_PUSH=true'");
});

test('bootstrap token revocation is attempted even when mirror migration fails', () => {
  has("$BootstrapTokenName = 'stephanos-m2-bootstrap'");
  has("'--scopes', 'write:repository,write:user'");
  has("$token = (($tokenResult.Output -join '').Trim())");
  has('$migrationSucceeded = $false');
  has('$revocationSucceeded = $false');
  has("Invoke-RestMethod -Method Post -Uri \"$ApiRoot/repos/migrate\"");
  has("Invoke-RestMethod -Method Delete -Uri \"$ApiRoot/users/$Owner/tokens/$BootstrapTokenName\"");
  has("Fail 'FORGE_BOOTSTRAP_TOKEN_REVOCATION_FAILED'");
  has('bootstrapTokenRevoked = $false');
  has('credentialPersisted = $true');
  has("Fail 'FORGE_MIRROR_MIGRATION_FAILED'");
  has('bootstrapTokenRevoked = $true');
  has('$token = $null');
  has('$tokenResult = $null');
  has('[GC]::Collect()');
  lacks('Set-Content $token');
  lacks('Add-Content $token');
  lacks('Write-Host $token');
  lacks('Write-Output $token');
});

test('a sealed stale canonical mirror has one fixed loopback-only refresh and local token lifecycle', () => {
  has("$MirrorRefreshTokenName = 'stephanos-m2-one-shot-refresh'");
  has('function Invoke-OneShotLocalMirrorRefresh');
  has("'--token-name', $MirrorRefreshTokenName");
  has("'--scopes', 'write:repository,write:user'");
  has('Invoke-RestMethod -Method Post -Uri "$ApiRoot/repos/$Owner/$RepoName/mirror-sync"');
  has('Invoke-RestMethod -Method Delete -Uri "$ApiRoot/users/$Owner/tokens/$MirrorRefreshTokenName"');
  has('$refreshSucceeded = $false');
  has('$revocationSucceeded = $false');
  has("Fail 'FORGE_MIRROR_REFRESH_TOKEN_REVOCATION_FAILED'");
  has('credentialPersisted = $true');
  has("Fail 'FORGE_MIRROR_REFRESH_REQUEST_FAILED'");
  lacks('mirror-sync?');
});

test('stale-head admission is restricted to an already sealed fixed container', () => {
  has('[switch]$AllowStaleHeadLabel');
  has("if ($labeledHead -notmatch '^[0-9a-f]{40}$') { Fail 'FORGE_CONTAINER_HEAD_LABEL_INVALID' }");
  has("if (-not $AllowStaleHeadLabel) { Fail 'FORGE_CONTAINER_HEAD_LABEL_MISMATCH' }");
  has("if ($sealed -ne 'true') { Fail 'UNSEALED_FORGE_CONTAINER_HEAD_LABEL_MISMATCH' }");
  has('Assert-ContainerIdentity $PodmanExe $ContainerName $DataVolume $HostPort -AllowStaleHeadLabel');
});

test('one-shot refresh verifies the stored pull mirror still has the one canonical identity and remote', () => {
  has('function Assert-FixedMirrorMetadata');
  has('Invoke-RestMethod -Method Get -Uri "$ApiRoot/repos/$Owner/$RepoName"');
  has("if ([string]$mirror.owner.login -ne $Owner) { Fail 'FORGE_MIRROR_OWNER_MISMATCH' }");
  has("if ([string]$mirror.name -ne $RepoName) { Fail 'FORGE_MIRROR_REPOSITORY_NAME_MISMATCH' }");
  has("if ($mirror.mirror -isnot [bool] -or $mirror.mirror -ne $true) { Fail 'FORGE_REPOSITORY_NOT_PULL_MIRROR' }");
  has("if ([string]$mirror.original_url -ne $RemoteUrl) { Fail 'FORGE_MIRROR_REMOTE_MISMATCH' }");
  assert.equal(source.match(/Assert-FixedMirrorMetadata/g)?.length, 3);
});

test('one-shot refresh opens a bounded migration window then reseals and reproves exact head', () => {
  has('function Wait-ExpectedMirrorHead');
  has("if ($sealed -ne 'true') { Fail 'FORGE_MIRROR_HEAD_MISMATCH' @{ observedHead = $mirrorHead } }");
  has('Run one fixed loopback-only mirror refresh to ${ExpectedHead}, revoke its local token, and reseal');
  has('Start-FixedContainer $PodmanExe $false');
  has('$refreshResult = Invoke-OneShotLocalMirrorRefresh $PodmanExe');
  has('$refreshedMirrorHead = Wait-ExpectedMirrorHead $GitExe');
  has('Start-FixedContainer $PodmanExe $true');
  has("Fail 'FORGE_MIRROR_REFRESH_HEAD_MISMATCH'");
  has('oneShotMirrorRefreshPerformed = $mirrorRefreshPerformed');
  has('mirrorRefreshTokenRevoked = $mirrorRefreshTokenRevoked');
});

test('mirror creation is exactly the canonical public unauthenticated repository', () => {
  has('clone_addr = $RemoteUrl');
  has('repo_name = $RepoName');
  has("service = 'git'");
  has('mirror = $true');
  has('private = $false');
  has("'ls-remote', '--exit-code', $url, 'refs/heads/main'");
  has("Fail 'FORGE_MIRROR_HEAD_MISMATCH'");
  lacks('auth_token =');
  lacks('auth_password =');
  lacks('github.com/login');
});

test('existing runtime identity is rebound to exact repository head digest image environment labels fixed port and privilege proof', () => {
  has("'stephanos.repository'");
  has("'stephanos.main-head'");
  has("'stephanos.image-digest'");
  has("Fail 'FORGE_CONTAINER_REPOSITORY_LABEL_MISMATCH'");
  has("Fail 'FORGE_CONTAINER_HEAD_LABEL_MISMATCH'");
  has("Fail 'FORGE_CONTAINER_DIGEST_LABEL_MISMATCH'");
  has("Fail 'FORGE_CONTAINER_SEAL_LABEL_INVALID'");
  has("Fail 'FORGE_CONTAINER_IMAGE_REFERENCE_MISMATCH'");
  has("Fail 'FORGE_CONTAINER_IMAGE_DIGEST_MISMATCH'");
  has("Fail 'FORGE_CONTAINER_USER_NOT_ROOTLESS'");
  has("Fail 'FORGE_CONTAINER_ENVIRONMENT_SEAL_MISMATCH'");
  has("Fail 'FORGE_CONTAINER_PORT_BINDING_MISMATCH'");
  has('Assert-ContainerIdentity $PodmanExe $ContainerName $DataVolume $HostPort');
});

test('backup helpers inherit the same read-only no-capability no-new-privilege posture', () => {
  has("$fixedToolProbe = 'command -v tar >/dev/null 2>&1 && command -v sha256sum >/dev/null 2>&1'");
  has("Fail 'FORGE_BACKUP_HELPER_TOOLS_UNAVAILABLE'");
  has("'run', '--rm', '--read-only', '--read-only-tmpfs=false', '--cap-drop', 'ALL'");
  has("'--security-opt', 'no-new-privileges'");
  has('Assert-BackupTools $PodmanExe');
});

test('backup is content hashed bounded and proved by a real restored service and exact main head', () => {
  has("'cd /source && tar -cf - . | sha256sum'");
  has("'cd /source && tar -cf - . | (cd /destination && tar -xf -)'");
  has("'label=stephanos.backup=forge-shadow'");
  has("if (@($existingBackups).Count -ge 7) { Fail 'FORGE_BACKUP_RETENTION_CAPACITY_REACHED' }");
  has('$backupDigest = Get-VolumeDigest $Podman $backupName');
  has("Fail 'FORGE_BACKUP_COPY_DIGEST_MISMATCH'");
  has('$restoreDigest = Get-VolumeDigest $Podman $RestoreVolume');
  has("Fail 'FORGE_RESTORE_COPY_DIGEST_MISMATCH'");
  has("$RestoreContainerName = 'stephanos-forge-shadow-restore-probe'");
  has('$RestorePort = 3341');
  has('Get-FixedEnvironment $Final $Port');
  has('Assert-ContainerIdentity $Podman $RestoreContainerName $RestoreVolume $RestorePort');
  has("Fail 'FORGE_RESTORE_PROBE_HEALTH_FAILED'");
  has("Fail 'FORGE_RESTORE_PROBE_HEAD_MISMATCH'");
  has("Fail 'FORGE_BACKUP_RESTORE_PROOF_INCOMPLETE'");
  has('restoreDrillPassed = $true');
});

test('backup restore probe always cleans temporary state and restarts the canonical Forge container', () => {
  has('$mainStopped = $false');
  has('$mainStopped = $true');
  has("Invoke-PodmanRemote $Podman @('rm', '-f', $RestoreContainerName) -AllowFailure");
  has("Invoke-PodmanRemote $Podman @('volume', 'rm', '-f', $RestoreVolume) -AllowFailure");
  has("Invoke-PodmanRemote $Podman @('start', $ContainerName) -AllowFailure");
  has('if ($mainStopped -and (Get-ContainerExists $Podman $ContainerName))');
  has("Fail 'FORGE_POST_BACKUP_RESTART_HEALTH_FAILED'");
  has('Assert-ContainerIdentity $Podman $ContainerName $DataVolume $HostPort');
});

test('M2 ready requires exact object tree and privilege proofs and emits no mutation authority', () => {
  has("$localTree = ((Invoke-Fixed $GitExe @('-C', $RepoRoot, 'rev-parse', \"$ExpectedHead^{tree}\"))");
  has("$forgeTree = Get-ForgeTree $ApiRoot $ExpectedHead");
  has("Fail 'FORGE_TREE_PARITY_MISMATCH'");
  has("status = 'FORGE_SHADOW_M2_READY'");
  has('exactObjectParity = $true');
  has('exactTreeParity = $true');
  has('rootFilesystemReadOnly = $true');
  has('allCapabilitiesDropped = $true');
  has('noNewPrivileges = $true');
  has("persistentWritableSurface = '/var/lib/gitea'");
  has("boundedEphemeralWritableSurfaces = @('/run', '/tmp', '/var/tmp')");
  has('readyForM3 = $true');
  has('runnerRegistration = $false');
  has('actionsExecution = $false');
  has('mergeAuthority = $false');
});

test('operator approval and ShouldProcess protect all live mutation', () => {
  has("[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]");
  has("if (-not $OperatorApproved -and -not $WhatIfPreference) { Fail 'EXACT_RUNTIME_OPERATOR_APPROVAL_REQUIRED' }");
  has('$PSCmdlet.ShouldProcess');
  has("status = 'WHAT_IF_READY'");
  has('mutationPerformed = $false');
});

test('dangerous generic execution and destructive host commands are absent', () => {
  for (const forbidden of [
    'Invoke-Expression',
    ' iex ',
    'cmd.exe',
    'powershell.exe',
    'pwsh.exe',
    'git reset',
    'git clean',
    'git rebase',
    'git push',
    'Remove-Item -Recurse',
    'Restart-Computer',
    'Stop-Computer',
    'taskkill',
  ]) lacks(forbidden);
});
