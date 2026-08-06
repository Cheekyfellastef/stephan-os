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

test('machine creation and inspection are WSL rootless bounded identities', () => {
  has("'machine', 'init', '--provider', 'wsl', '--rootful=false', '--cpus', '4', '--memory', '4096', '--disk-size', '40'");
  has("'machine', 'inspect', '--format', '{{json .}}', $MachineName");
  has("$MachineName = 'stephanos-forge-shadow'");
  has("if ($machine.Rootful -eq $true) { Fail 'PODMAN_MACHINE_ROOTFUL_NOT_ALLOWED' }");
  has("if ($machine.State -ne 'running')");
  lacks('--privileged');
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
  has("'pull', $ImageRef");
  lacks('0.0.0.0:');
  lacks(':2222');
  lacks('/var/run/docker.sock');
  lacks('podman.sock');
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

test('one local bootstrap token is scoped memory-only and revoked after the mirror operation', () => {
  has("$BootstrapTokenName = 'stephanos-m2-bootstrap'");
  has("'--scopes', 'write:repository,write:user'");
  has("$token = (($tokenResult.Output -join '').Trim())");
  has("Invoke-RestMethod -Method Post -Uri \"$ApiRoot/repos/migrate\"");
  has("Invoke-RestMethod -Method Delete -Uri \"$ApiRoot/users/$Owner/tokens/$BootstrapTokenName\"");
  has('$token = $null');
  has('$tokenResult = $null');
  has('[GC]::Collect()');
  lacks('Set-Content $token');
  lacks('Add-Content $token');
  lacks('Write-Host $token');
  lacks('Write-Output $token');
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

test('existing runtime identity is rebound to exact repository head digest labels and fixed port', () => {
  has("'stephanos.repository'");
  has("'stephanos.main-head'");
  has("'stephanos.image-digest'");
  has("Fail 'FORGE_CONTAINER_REPOSITORY_LABEL_MISMATCH'");
  has("Fail 'FORGE_CONTAINER_HEAD_LABEL_MISMATCH'");
  has("Fail 'FORGE_CONTAINER_DIGEST_LABEL_MISMATCH'");
  has("Fail 'FORGE_CONTAINER_PORT_BINDING_MISMATCH'");
});

test('backup helper tools are proved before any content hashing or copy', () => {
  has("$fixedToolProbe = 'command -v tar >/dev/null 2>&1 && command -v sha256sum >/dev/null 2>&1'");
  has("Fail 'FORGE_BACKUP_HELPER_TOOLS_UNAVAILABLE'");
  has('Assert-BackupTools $PodmanExe');
});

test('backup is content hashed bounded and proved by a real restored service and exact main head', () => {
  has("'cd /source && tar -cf - . | sha256sum'");
  has("'cd /source && tar -cf - . | (cd /destination && tar -xf -)'");
  has("'label=stephanos.backup=forge-shadow'");
  has("if (@($existingBackups).Count -ge 7) { Fail 'FORGE_BACKUP_RETENTION_CAPACITY_REACHED' }");
  has("$RestoreContainerName = 'stephanos-forge-shadow-restore-probe'");
  has('$RestorePort = 3341');
  has('Get-FixedEnvironment $Final $Port');
  has("Fail 'FORGE_RESTORE_PROBE_HEALTH_FAILED'");
  has("Fail 'FORGE_RESTORE_PROBE_HEAD_MISMATCH'");
  has('restoreDrillPassed = $true');
});

test('M2 ready requires exact object and tree parity and emits no mutation authority', () => {
  has("$localTree = ((Invoke-Fixed $GitExe @('-C', $RepoRoot, 'rev-parse', \"$ExpectedHead^{tree}\"))");
  has("$forgeTree = Get-ForgeTree $ApiRoot $ExpectedHead");
  has("Fail 'FORGE_TREE_PARITY_MISMATCH'");
  has("status = 'FORGE_SHADOW_M2_READY'");
  has('exactObjectParity = $true');
  has('exactTreeParity = $true');
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
