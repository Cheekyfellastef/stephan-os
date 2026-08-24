import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const scriptUrl = new URL('./invoke-forge-shadow-m3-fixed-proof-executors-v1.ps1', import.meta.url);

test('fixed host executor is exact-source, exact-artifact, exact-plan and authorization bound', async () => {
  const source = await readFile(scriptUrl, 'utf8');
  for (const binding of [
    'ExpectedHead', 'ExpectedTree', 'RuntimeAuthorizationId', 'RuntimePlanDigest',
    'ArtifactSetDigest', 'IssuedAtUtc', 'ExpiresAtUtc', 'ForgejoImageDigest',
    'BackupDigest', 'BackupVolume', 'RunnerVersion', 'LinuxArtifactDigest',
    'WindowsArtifactDigest', 'LinuxRunnerCount', 'OperatorApproved',
  ]) assert.match(source, new RegExp(`\\$${binding}\\b`));
  assert.match(source, /branch', '--show-current'/);
  assert.match(source, /rev-parse', 'HEAD'/);
  assert.match(source, /rev-parse', "\$ExpectedHead\^\{tree\}"/);
  assert.match(source, /Get-FileHash -Algorithm SHA256 -LiteralPath \$LinuxRunnerPath/);
  assert.match(source, /Get-FileHash -Algorithm SHA256 -LiteralPath \$WindowsRunnerPath/);
  assert.match(source, /TotalHours -gt 2/);
  assert.match(source, /EXACT_RUNTIME_OPERATOR_APPROVAL_REQUIRED/);
});

test('Linux execution is a rootless outer Podman boundary with repository-scoped ephemeral one-job registration', async () => {
  const source = await readFile(scriptUrl, 'utf8');
  assert.match(source, /'--connection', \$MachineName/);
  assert.match(source, /forgejo', 'forgejo-cli', 'actions', 'register'/);
  assert.match(source, /'--scope', "\$Owner\/\$RepoName"/);
  assert.match(source, /'--ephemeral'/);
  assert.match(source, /@\('one-job', '--url'/);
  assert.match(source, /'--token-url', 'file:\/\/\/runner\/runner-token'/);
  assert.match(source, /\$runnerArguments \+= '--wait'/);
  assert.match(source, /'--user', '1000:1000'/);
  assert.match(source, /'--read-only'/);
  assert.match(source, /'--cap-drop', 'ALL'/);
  assert.match(source, /'no-new-privileges'/);
  assert.match(source, /'--network', \$CanaryNetwork/);
  assert.match(source, /Invoke-CanaryDispatch 'linux-isolated' \$runnerId/);
  assert.doesNotMatch(source, /docker\.sock|podman\.sock/);
});

test('Windows proof uses only a disposable Sandbox exchange and an exact-address temporary relay', async () => {
  const source = await readFile(scriptUrl, 'utf8');
  assert.match(source, /WindowsSandbox\.exe/);
  assert.match(source, /<MappedFolder><HostFolder>\$inputRoot<\/HostFolder><SandboxFolder>C:\\ForgeM3Input<\/SandboxFolder><ReadOnly>true<\/ReadOnly><\/MappedFolder>/);
  assert.match(source, /<MappedFolder><HostFolder>\$exchange<\/HostFolder><SandboxFolder>C:\\ForgeM3Exchange<\/SandboxFolder><ReadOnly>false<\/ReadOnly><\/MappedFolder>/);
  assert.match(source, /<ClipboardRedirection>Disable<\/ClipboardRedirection>/);
  assert.match(source, /<ProtectedClient>Enable<\/ProtectedClient>/);
  assert.match(source, /RemoteAddress \(\[string\]\$network\.sandboxAddress\)/);
  assert.match(source, /portproxy', 'add', 'v4tov4'/);
  assert.match(source, /portproxy', 'delete', 'v4tov4'/);
  assert.match(source, /Invoke-CanaryDispatch 'windows-proof-isolated' \$runnerId/);
  assert.match(source, /Stop-Process -Id \$script:SandboxProcess\.Id/);
  assert.doesNotMatch(source, /Documents\\GitHub\\stephan-os<\/HostFolder>/i);
});

test('disposable Actions surface is copied from the proven backup and canonical M2 stays sealed', async () => {
  const source = await readFile(scriptUrl, 'utf8');
  assert.match(source, /Get-VolumeDigest \$BackupVolume/);
  assert.match(source, /Copy-Volume \$BackupVolume \$CanaryVolume/);
  assert.match(source, /FORGEJO__actions__ENABLED=true/);
  assert.match(source, /FORGEJO__actions__ENABLED=false/);
  assert.match(source, /stephanos\.sealed\.\*true/);
  assert.match(source, /FORGE_M3_CANONICAL_M2_CHANGED/);
  assert.match(source, /'rm', '-f', \$CanaryContainer/);
  assert.match(source, /'volume', 'rm', '-f', \$CanaryVolume/);
  assert.match(source, /'network', 'rm', '-f', \$CanaryNetwork/);
  assert.ok(source.indexOf('Remove-FixedRuntime\n    $canonicalM2DigestAfter') < source.indexOf('$observations = @('));
});

test('executor emits only post-teardown closed-world observations and no reusable authority', async () => {
  const source = await readFile(scriptUrl, 'utf8');
  assert.match(source, /stephanos\.forge-shadow-m3-fixed-proof-execution-receipt\.v1/);
  assert.match(source, /FORGE_SHADOW_M3_FIXED_PROOF_EXECUTORS_READY/);
  assert.match(source, /if \(\$OperatorApproved\) \{ \$ConfirmPreference = 'None' \}/);
  assert.match(source, /credentialLogged = \$false/);
  assert.match(source, /credentialPersisted = \$false/);
  assert.match(source, /canonicalCheckoutMounted = \$false/);
  assert.match(source, /containerSocketMounted = \$false/);
  assert.match(source, /sourceMutation = \$false/);
  assert.match(source, /gitRefWrite = \$false/);
  assert.match(source, /mergeAuthority = \$false/);
  assert.match(source, /deploymentAuthority = \$false/);
  assert.match(source, /arbitraryCommand = \$false/);
  assert.match(source, /Assert-RunnerRegistrationAbsent \$runnerId/g);
  assert.match(source, /actions\/runners/);
  assert.match(source, /FORGE_M3_EPHEMERAL_REGISTRATION_REMAINS/);
  assert.match(source, /users\/\$Owner\/tokens\/stephanos-m3-dispatch/);
  assert.match(source, /api\/v1\/user/);
  assert.match(source, /\$script:CredentialsDestroyed = \$false/);
  assert.doesNotMatch(source, /Invoke-Expression|ScriptBlock::Create|cmd\.exe|Start-Job|git(?:\.exe)?\s+(?:push|reset|clean|checkout|rebase)/i);
});
