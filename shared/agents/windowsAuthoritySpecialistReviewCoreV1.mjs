import { createHash } from 'node:crypto';

export const WINDOWS_AUTHORITY_SPECIALIST_SCHEMA_VERSION = 'stephanos.windows-authority-specialist-review.v1';
export const WINDOWS_AUTHORITY_SOURCE_SCHEMA_VERSION = 'stephanos.windows-authority-source.v1';
export const WINDOWS_AUTHORITY_SOURCE_MAX_BYTES = 256 * 1024;

const EXACT_HEAD = /^[a-f0-9]{40}$/;
const GIT_BLOB = /^[a-f0-9]{40}$/;
const ALLOWED_PATHS = Object.freeze([
  'scripts/windows/install-stephanos-backend-autostart.ps1',
  'scripts/windows/probe-battle-bridge-recovery-mesh.ps1',
  'scripts/windows/start-stephanos-backend.ps1',
  'scripts/windows/install-forge-shadow-podman-v1.ps1',
  'scripts/windows/install-forge-shadow-podman-v1.test.mjs',
]);

function text(value) {
  return String(value ?? '').trim();
}

function unique(values) {
  return [...new Set(values)];
}

function finding(code, summary, path) {
  return Object.freeze({ severity: 'P0', code, summary, path });
}

function gitBlobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1')
    .update(`blob ${bytes.length}\0`, 'utf8')
    .update(bytes)
    .digest('hex');
}

function escalationPaths(analysis = {}) {
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  if (!findings.length) return [];
  if (!findings.every((item) => (
    text(item?.severity).toUpperCase() === 'P0'
    && text(item?.code) === 'unsupported-high-risk-surface'
    && text(item?.path).startsWith('scripts/windows/')
  ))) return [];
  return unique(findings.map((item) => text(item.path)));
}

function exactSource(source, repository, sourceHead, path) {
  const content = typeof source?.content === 'string' ? source.content : '';
  const bytes = Buffer.byteLength(content, 'utf8');
  return Boolean(
    source
    && typeof source === 'object'
    && !Array.isArray(source)
    && source.schemaVersion === WINDOWS_AUTHORITY_SOURCE_SCHEMA_VERSION
    && source.repository === repository
    && source.path === path
    && source.ref === sourceHead
    && source.exists === true
    && Number.isSafeInteger(source.size)
    && source.size === bytes
    && source.size > 0
    && source.size <= WINDOWS_AUTHORITY_SOURCE_MAX_BYTES
    && GIT_BLOB.test(text(source.blobSha))
    && source.blobSha === gitBlobSha(content)
  );
}

function requirePattern(findings, source, pattern, code, summary, path) {
  if (!pattern.test(source)) findings.push(finding(code, summary, path));
}

function forbidPattern(findings, source, pattern, code, summary, path) {
  if (pattern.test(source)) findings.push(finding(code, summary, path));
}

function requireLiteral(findings, source, literal, code, summary, path) {
  if (!source.includes(literal)) findings.push(finding(code, summary, path));
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function requireUniqueAssignment(findings, source, variable, expectedLine, code, summary, path) {
  const pattern = new RegExp(`^\\s*\\$${escapeRegex(variable)}\\s*=`, 'gm');
  const matches = [...source.matchAll(pattern)];
  const exact = source.split(/\r?\n/).filter((line) => line.trim() === expectedLine);
  if (matches.length !== 1 || exact.length !== 1) findings.push(finding(code, summary, path));
}

function reviewInstaller(source, path, findings) {
  requirePattern(findings, source, /\$taskName\s*=\s*'Stephanos Battle Bridge Backend'/, 'windows-backend-task-name-not-fixed', 'Backend scheduled-task identity must remain fixed.', path);
  requirePattern(findings, source, /\$wscriptExe\s*=\s*'C:\\Windows\\System32\\wscript\.exe'/, 'windows-backend-task-host-not-fixed', 'Backend scheduled-task host must remain the fixed Windows wscript executable.', path);
  requirePattern(findings, source, /Test-Path -LiteralPath \$wscriptExe -PathType Leaf/, 'windows-backend-task-host-not-proved', 'Backend scheduled-task host must be proved before registration.', path);
  requirePattern(findings, source, /New-ScheduledTaskPrincipal[^\r\n]*-LogonType\s+Interactive[^\r\n]*-RunLevel\s+Limited/, 'windows-backend-task-principal-not-limited', 'Backend task principal must remain interactive and limited.', path);
  requirePattern(findings, source, /New-ScheduledTaskSettingsSet[^\r\n]*-MultipleInstances\s+IgnoreNew/, 'windows-backend-task-overlap-not-rejected', 'Backend task must reject overlapping instances.', path);
  requirePattern(findings, source, /New-ScheduledTaskAction\s+-Execute\s+\$wscriptExe\s+-Argument\s+\$taskArgs/, 'windows-backend-task-action-not-fixed', 'Backend task action must remain bound to the fixed windowless launcher.', path);
  requirePattern(findings, source, /\$PSCmdlet\.ShouldProcess\(\$taskName,\s*'Register\/Update scheduled task'\)/, 'windows-backend-task-shouldprocess-missing', 'Backend task installation must remain ShouldProcess-gated.', path);
  forbidPattern(findings, source, /RunLevel\s+Highest|-MultipleInstances\s+Parallel/i, 'windows-backend-task-authority-expanded', 'Backend task must not gain elevated or parallel authority.', path);
}

function reviewProbe(source, path, findings) {
  for (const literal of [
    "'C:\\Program Files\\Git\\cmd\\git.exe'",
    "'C:\\Program Files\\nodejs\\node.exe'",
    "'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'",
    "'C:\\Windows\\System32\\wscript.exe'",
  ]) {
    if (!source.includes(literal)) findings.push(finding(
      'windows-recovery-canonical-executable-missing',
      'Recovery proof must pin canonical executables.',
      path,
    ));
  }
  requirePattern(findings, source, /function\s+Test-TaskAuthority[\s\S]*LogonType[\s\S]*Interactive[\s\S]*RunLevel[\s\S]*Limited[\s\S]*MultipleInstances[\s\S]*IgnoreNew/, 'windows-recovery-task-authority-not-proved', 'Recovery task authority must be proved before task start.', path);
  requirePattern(findings, source, /Assert-CanonicalTrackedWorktreeClean[\s\S]*Assert-CanonicalTrackedWorktreeClean/, 'windows-recovery-clean-source-recheck-missing', 'Recovery must prove tracked source cleanliness before and after probing.', path);
  requirePattern(findings, source, /branch --show-current[\s\S]*\$branch\s+-ne\s+'main'/, 'windows-recovery-main-binding-missing', 'Recovery must bind to canonical main.', path);
  requirePattern(findings, source, /Start-ScheduledTask\s+-TaskName\s+\$spec\.Name/, 'windows-recovery-task-start-not-allowlisted', 'Recovery may start only the fixed task selected from the allowlist.', path);
  requirePattern(findings, source, /if\s*\(-not\s+\$observed\.authorityCanonical\)\s*\{\s*continue\s*\}/, 'windows-recovery-authority-gate-missing', 'Recovery must refuse non-canonical task authority.', path);
  requirePattern(findings, source, /\[string\]::Equals\(\$executable,\s*\$canonicalNode/, 'windows-recovery-listener-executable-not-exact', 'Backend listener executable must match canonical Node exactly.', path);
  requirePattern(findings, source, /\[string\]::Equals\(\$commandLine,\s*\$expectedQuotedCommand[\s\S]*\[string\]::Equals\(\$commandLine,\s*\$expectedUnquotedCommand/, 'windows-recovery-listener-command-not-exact', 'Backend listener command line must match one of the exact canonical forms.', path);
  requirePattern(findings, source, /schemaVersion\s+-eq\s+'stephanos\.backend-runtime\.v1'[\s\S]*headSha[\s\S]*ExpectedSourceHead[\s\S]*pid[\s\S]*listenerAfter\.pid[\s\S]*processStartTimeUtc/, 'windows-recovery-runtime-receipt-not-bound', 'Backend runtime receipt must bind schema, head, PID and process start identity.', path);
  requirePattern(findings, source, /backendRestartSkippedAsCurrent/, 'windows-recovery-current-backend-preservation-missing', 'Recovery must preserve an already-current backend.', path);
}

function reviewStarter(source, path, findings) {
  requirePattern(findings, source, /\$canonicalGit\s*=\s*'C:\\Program Files\\Git\\cmd\\git\.exe'/, 'windows-backend-starter-git-unpinned', 'Backend startup must pin the canonical Git executable instead of resolving PATH.', path);
  requirePattern(findings, source, /\$canonicalNpm\s*=\s*'C:\\Program Files\\nodejs\\npm\.cmd'/, 'windows-backend-starter-npm-unpinned', 'Backend startup must pin the canonical npm executable instead of resolving PATH.', path);
  requirePattern(findings, source, /\$canonicalNode\s*=\s*'C:\\Program Files\\nodejs\\node\.exe'/, 'windows-backend-starter-node-unpinned', 'Backend startup must pin canonical Node for listener identity.', path);
  requirePattern(findings, source, /\[string\]::Equals\(\$executable,\s*\$canonicalNode/, 'windows-backend-starter-listener-executable-not-exact', 'Backend startup must prove the listener executable exactly.', path);
  requirePattern(findings, source, /\[string\]::Equals\(\$commandLine,\s*\$expectedQuotedCommand[\s\S]*\[string\]::Equals\(\$commandLine,\s*\$expectedUnquotedCommand/, 'windows-backend-starter-listener-command-not-exact', 'Backend startup must prove the listener command line exactly.', path);
  forbidPattern(findings, source, /\.Contains\(['"]stephanos-server\/server\.js['"]\)/i, 'windows-backend-starter-substring-listener-proof', 'Substring listener proof cannot mint an exact-head runtime receipt.', path);
  forbidPattern(findings, source, /Get-Command\s+(?:git(?:\.exe)?|npm(?:\.cmd)?)/i, 'windows-backend-starter-path-resolution-forbidden', 'Backend startup must not resolve Git or npm from PATH.', path);
  forbidPattern(findings, source, /(^|\r?\n)\s*npm(?:\.cmd)?\s+run/im, 'windows-backend-starter-unpinned-npm-invocation', 'Every npm invocation in backend startup must use the canonical npm path.', path);
  requirePattern(findings, source, /schemaVersion\s+-eq\s+'stephanos\.backend-health\.v1'[\s\S]*runtimeId\s+-eq\s+'stephanos-battle-bridge-backend'[\s\S]*sourceHead/, 'windows-backend-starter-health-identity-incomplete', 'Backend health must bind schema, runtime identity and exact source head.', path);
  requirePattern(findings, source, /status\s+'--porcelain=v1'\s+'--untracked-files=no'/, 'windows-backend-starter-clean-source-proof-missing', 'Backend startup must reject tracked worktree drift.', path);
  requirePattern(findings, source, /Start-Process\s+-FilePath\s+\$canonicalNpm[\s\S]*-ArgumentList\s+\$arguments/, 'windows-backend-starter-process-not-pinned', 'Backend process launch must use canonical npm and fixed arguments.', path);
  requirePattern(findings, source, /STEPHANOS_BACKEND_SOURCE_HEAD\s*=\s*\$headSha/, 'windows-backend-starter-head-env-missing', 'Backend process must receive the exact source head.', path);
  requirePattern(findings, source, /Write-BackendRuntimeReceipt[\s\S]*ProcessStartTimeUtc/, 'windows-backend-starter-runtime-receipt-incomplete', 'Backend startup receipt must include process start identity.', path);
  requirePattern(findings, source, /function\s+Publish-VerifiedBackendRuntimeReceipt[\s\S]*Write-BackendRuntimeReceipt[\s\S]*\$confirmedListener[\s\S]*ProcessId\s+-ne\s+\$Listener\.ProcessId[\s\S]*ProcessStartTimeUtc\s+-ne\s+\$Listener\.ProcessStartTimeUtc[\s\S]*Test-BackendHealth/, 'windows-backend-starter-receipt-stability-recheck-missing', 'Runtime receipt publication must recheck exact listener PID, process start identity, and exact-head health.', path);
  requirePattern(findings, source, /\$existingListener[\s\S]*if\s*\(\$existingListener\)[\s\S]*Publish-VerifiedBackendRuntimeReceipt[\s\S]*exit\s+0/, 'windows-backend-starter-reuse-receipt-missing', 'Reusing an already-current backend must refresh and recheck its exact runtime receipt before success.', path);
}

function reviewForgeInstaller(source, path, findings) {
  for (const [literal, code, summary] of [
    ["[ValidatePattern('^[0-9a-fA-F]{40}$')]", 'forge-expected-head-input-not-fixed', 'Forge installer must accept only an exact 40-character head.'],
    ["[ValidatePattern('^sha256:[0-9a-fA-F]{64}$')]", 'forge-image-digest-input-not-fixed', 'Forge installer must accept only an immutable sha256 image digest.'],
    ["[switch]$OperatorApproved", 'forge-operator-approval-input-missing', 'Forge installer mutation must require explicit operator approval.'],
    ["$Repository = 'Cheekyfellastef/stephan-os'", 'forge-repository-identity-not-fixed', 'Forge repository identity must remain fixed.'],
    ["$ForgejoVersion = '15.0.6'", 'forge-version-not-fixed', 'Forgejo version must remain fixed to the reviewed LTS line.'],
    ["$PodmanVersion = '6.0.2'", 'forge-podman-version-not-fixed', 'Podman version must remain fixed.'],
    ["$MachineName = 'stephanos-forge-shadow'", 'forge-machine-identity-not-fixed', 'Forge Podman machine identity must remain fixed.'],
    ["$ContainerName = 'stephanos-forge-shadow'", 'forge-container-identity-not-fixed', 'Forge container identity must remain fixed.'],
    ["$RemoteUrl = 'https://github.com/Cheekyfellastef/stephan-os.git'", 'forge-remote-not-fixed', 'Forge mirror source must remain the exact public canonical repository.'],
    ["$HostAddress = '127.0.0.1'", 'forge-listener-host-not-loopback', 'Forge listener must remain loopback-only.'],
    ["function Invoke-PodmanRemote", 'forge-podman-remote-wrapper-missing', 'Forge remote Podman operations must use one fixed wrapper.'],
    ["$boundArguments = @('--connection', $MachineName) + @($Arguments)", 'forge-podman-connection-not-fixed', 'Every remote Podman operation must bind the named machine connection.'],
    ["'machine', 'init', '--provider', 'wsl', '--rootful=false'", 'forge-rootless-machine-init-not-fixed', 'Forge Podman machine must be initialized rootless on WSL.'],
    ["if ($machine.Rootful -ne $false)", 'forge-rootless-machine-proof-missing', 'Forge machine must prove Rootful=false.'],
    ["'--user', '1000:1000'", 'forge-container-user-not-fixed', 'Forge containers must run as the fixed rootless user.'],
    ["'--read-only'", 'forge-container-rootfs-not-readonly', 'Forge container root filesystem must remain read-only.'],
    ["'--cap-drop', 'ALL'", 'forge-container-capabilities-not-dropped', 'Forge containers must drop all capabilities.'],
    ["'--security-opt', 'no-new-privileges'", 'forge-container-new-privileges-not-blocked', 'Forge containers must set no-new-privileges.'],
    ["'FORGEJO__server__DISABLE_SSH=true'", 'forge-ssh-not-disabled', 'Forge SSH must remain disabled.'],
    ["'FORGEJO__actions__ENABLED=false'", 'forge-actions-not-disabled', 'Forge Actions must remain disabled.'],
    ["'FORGEJO__security__DISABLE_GIT_HOOKS=true'", 'forge-git-hooks-not-disabled', 'Forge custom Git hooks must remain disabled.'],
    ["'FORGEJO__security__DISABLE_WEBHOOKS=true'", 'forge-webhooks-not-disabled', 'Forge webhooks must remain disabled.'],
    ["'FORGEJO__repository__DISABLE_MIGRATIONS=true'", 'forge-final-migrations-not-disabled', 'Forge migrations must be disabled in the sealed posture.'],
    ["Invoke-RestMethod -Method Delete -Uri \"$ApiRoot/users/$Owner/tokens/$BootstrapTokenName\"", 'forge-bootstrap-token-revocation-missing', 'Forge bootstrap token must be explicitly revoked.'],
    ["Fail 'FORGE_BOOTSTRAP_TOKEN_REVOCATION_FAILED'", 'forge-token-revocation-failclosed-missing', 'Token revocation failure must block readiness.'],
    ["Fail 'FORGE_BACKUP_COPY_DIGEST_MISMATCH'", 'forge-backup-copy-hash-proof-missing', 'Forge backup copy must be content-hash verified.'],
    ["Fail 'FORGE_RESTORE_COPY_DIGEST_MISMATCH'", 'forge-restore-copy-hash-proof-missing', 'Forge restore copy must be content-hash verified.'],
    ["Invoke-PodmanRemote $Podman @('start', $ContainerName) -AllowFailure", 'forge-canonical-restart-cleanup-missing', 'Forge canonical service restart must occur from bounded cleanup.'],
    ["Fail 'FORGE_POST_BACKUP_RESTART_HEALTH_FAILED'", 'forge-post-backup-health-proof-missing', 'Forge canonical service must be re-proved healthy after restore cleanup.'],
    ["Fail 'FORGE_TREE_PARITY_MISMATCH'", 'forge-tree-parity-proof-missing', 'Forge mirror tree must match the exact canonical tree.'],
    ["Fail 'FORGE_CONTAINER_IMAGE_DIGEST_MISMATCH'", 'forge-container-image-digest-blocker-missing', 'Forge container identity must fail closed when the actual OCI image digest drifts.'],
    ["status = 'FORGE_SHADOW_M2_READY'", 'forge-m2-ready-receipt-missing', 'Forge installer must emit only the bounded M2-ready receipt after proof.'],
    ["runnerRegistration = $false", 'forge-runner-authority-not-denied', 'M2 must explicitly deny runner registration.'],
    ["mergeAuthority = $false", 'forge-merge-authority-not-denied', 'M2 must explicitly deny merge authority.'],
  ]) requireLiteral(findings, source, literal, code, summary, path);

  for (const [variable, expectedLine, code, summary] of [
    ['Repository', "$Repository = 'Cheekyfellastef/stephan-os'", 'forge-repository-assignment-not-unique', 'Forge repository assignment must be unique.'],
    ['ForgejoVersion', "$ForgejoVersion = '15.0.6'", 'forge-version-assignment-not-unique', 'Forgejo version assignment must be unique.'],
    ['PodmanVersion', "$PodmanVersion = '6.0.2'", 'forge-podman-version-assignment-not-unique', 'Podman version assignment must be unique.'],
    ['WindowsHostAdapter', "$WindowsHostAdapter = 'podman-desktop-windows10-wsl2-v1'", 'forge-windows-host-adapter-assignment-not-unique', 'Windows host adapter assignment must be unique.'],
    ['MinimumWindowsBuild', '$MinimumWindowsBuild = 19043', 'forge-windows-build-floor-assignment-not-unique', 'Windows build floor must be exactly 19043 and assigned once.'],
    ['MaximumWindowsBuildExclusive', '$MaximumWindowsBuildExclusive = 22000', 'forge-windows-build-ceiling-assignment-not-unique', 'Windows build ceiling must be exactly 22000 exclusive and assigned once.'],
    ['RequiredWindowsArchitecture', "$RequiredWindowsArchitecture = 'X64'", 'forge-windows-architecture-assignment-not-unique', 'Windows architecture must be exactly X64 and assigned once.'],
    ['MachineName', "$MachineName = 'stephanos-forge-shadow'", 'forge-machine-assignment-not-unique', 'Forge machine identity must be assigned exactly once.'],
    ['ContainerName', "$ContainerName = 'stephanos-forge-shadow'", 'forge-container-assignment-not-unique', 'Forge container identity must be assigned exactly once.'],
    ['RemoteUrl', "$RemoteUrl = 'https://github.com/Cheekyfellastef/stephan-os.git'", 'forge-remote-assignment-not-unique', 'Forge remote must be assigned exactly once.'],
    ['HostAddress', "$HostAddress = '127.0.0.1'", 'forge-host-assignment-not-unique', 'Forge listener host must be assigned exactly once.'],
  ]) requireUniqueAssignment(findings, source, variable, expectedLine, code, summary, path);

  requirePattern(findings, source, /\$ObservedWindowsInstallationType\s+-ne\s+'Client'[\s\S]*\$ObservedWindowsProductName\s+-notmatch\s+'\^Windows 10/, 'forge-windows10-client-gate-missing', 'Forge host must prove Windows 10 client identity.', path);
  requirePattern(findings, source, /\$ObservedWindowsArchitecture\s+-ne\s+\$RequiredWindowsArchitecture/, 'forge-windows-x64-gate-missing', 'Forge host must prove X64 architecture.', path);
  requirePattern(findings, source, /\$ObservedWindowsBuild\s+-lt\s+\$MinimumWindowsBuild/, 'forge-windows-build-floor-gate-missing', 'Forge host must enforce the Windows 10 build floor.', path);
  requirePattern(findings, source, /\$ObservedWindowsBuild\s+-ge\s+\$MaximumWindowsBuildExclusive/, 'forge-windows-build-ceiling-gate-missing', 'Forge host must reject Windows 11 build range from the Windows 10 adapter.', path);
  requirePattern(findings, source, /function\s+Get-Wsl2Evidence[\s\S]*@\('--status'\)[\s\S]*Default Version:[\\s\*]*2[\s\S]*@\('--list',\s*'--verbose'\)[\s\S]*distribution-version-2/, 'forge-wsl2-proof-missing', 'Forge host must parse real WSL2 evidence.', path);
  requirePattern(findings, source, /\$ObservedWsl2Evidence\s*=\s*Get-Wsl2Evidence[\s\S]*if\s*\(-not\s+\$ObservedWsl2Evidence\)\s*\{\s*Fail\s+'WSL2_NOT_AVAILABLE'/, 'forge-wsl2-gate-missing', 'Forge runtime must block without parsed WSL2 evidence.', path);
  requirePattern(findings, source, /'-p',\s*"127\.0\.0\.1:\$Port`:3000"/, 'forge-published-port-not-loopback', 'Forge HTTP publication must remain bound to loopback.', path);
  requirePattern(findings, source, /finally\s*\{[\s\S]*Invoke-RestMethod -Method Delete -Uri "\$ApiRoot\/users\/\$Owner\/tokens\/\$BootstrapTokenName"/, 'forge-token-revocation-not-finally-bound', 'Forge temporary-token cleanup must be in a finally path.', path);
  requirePattern(findings, source, /function Create-And-ProveBackup[\s\S]*finally\s*\{[\s\S]*\$RestoreContainerName[\s\S]*\$RestoreVolume[\s\S]*\('start', \$ContainerName\) -AllowFailure/, 'forge-backup-restore-finally-cleanup-missing', 'Forge restore artifacts and canonical restart must be handled in finally cleanup.', path);
  requirePattern(findings, source, /\$inspect\.ImageDigest[\s\S]*\$ForgejoImageDigest|image inspect[\s\S]*\.Digest/, 'forge-container-image-digest-not-independently-proved', 'Forge container identity must independently prove the actual OCI image digest, not only a caller-controlled label.', path);

  for (const [pattern, code, summary] of [
    [/Get-Command\s+podman/i, 'forge-podman-path-resolution-forbidden', 'Forge installer must not resolve Podman from PATH.'],
    [/--privileged/i, 'forge-privileged-container-forbidden', 'Forge containers must never run privileged.'],
    [/0\.0\.0\.0:/, 'forge-public-listener-forbidden', 'Forge must not expose a wildcard listener.'],
    [/auth_(?:token|password)\s*=/i, 'forge-github-credential-forbidden', 'Forge public mirror migration must not receive GitHub credentials.'],
    [/Invoke-Expression/i, 'forge-arbitrary-expression-forbidden', 'Forge installer must not gain arbitrary expression authority.'],
  ]) forbidPattern(findings, source, pattern, code, summary, path);
}

function reviewForgeInstallerStaticTest(source, path, findings) {
  for (const [literal, code, summary] of [
    ["readFileSync(new URL('./install-forge-shadow-podman-v1.ps1'", 'forge-static-test-source-not-fixed', 'Forge specialist test must inspect only its adjacent fixed installer source.'],
    ["test('Windows 10 x64 compatibility authority uses an exact build range and real WSL2 evidence'", 'forge-static-test-host-proof-missing', 'Forge static regression must guard the exact Windows 10 x64 WSL2 host boundary.'],
    ["test('every remote Podman operation is bound to the named Forge machine connection'", 'forge-static-test-connection-proof-missing', 'Forge static regression must guard named Podman connection binding.'],
    ["test('bootstrap token revocation is attempted even when mirror migration fails'", 'forge-static-test-token-proof-missing', 'Forge static regression must guard temporary-token cleanup.'],
    ["test('backup restore probe always cleans temporary state and restarts the canonical Forge container'", 'forge-static-test-backup-cleanup-proof-missing', 'Forge static regression must guard restore cleanup and canonical restart.'],
    ["test('dangerous generic execution and destructive host commands are absent'", 'forge-static-test-dangerous-command-guard-missing', 'Forge static regression must guard dangerous generic execution and host commands.'],
    ["FORGE_CONTAINER_IMAGE_DIGEST_MISMATCH", 'forge-static-test-image-digest-proof-missing', 'Forge static regression must guard actual image-digest proof.'],
  ]) requireLiteral(findings, source, literal, code, summary, path);

  for (const [pattern, code, summary] of [
    [/node:child_process/, 'forge-static-test-child-process-forbidden', 'Forge specialist test must remain static and must not execute child processes.'],
    [/\b(?:writeFileSync|appendFileSync|rmSync|unlinkSync|renameSync)\b/, 'forge-static-test-filesystem-mutation-forbidden', 'Forge specialist test must not mutate the filesystem.'],
    [/\bfetch\s*\(/, 'forge-static-test-network-forbidden', 'Forge specialist test must not gain network authority.'],
  ]) forbidPattern(findings, source, pattern, code, summary, path);
}

function generalAuthorityScan(source, path, findings) {
  const forbidden = [
    [/Invoke-Expression/i, 'windows-authority-invoke-expression-forbidden'],
    [/Restart-Computer|shutdown\.exe/i, 'windows-authority-pc-restart-forbidden'],
    [/Stop-Process/i, 'windows-authority-process-kill-forbidden'],
    [/git(?:\.exe)?\s+(?:push|reset|clean|rebase|checkout|switch)\b/i, 'windows-authority-source-mutation-forbidden'],
    [/RunLevel\s+Highest/i, 'windows-authority-elevation-forbidden'],
  ];
  for (const [pattern, code] of forbidden) forbidPattern(findings, source, pattern, code, 'Specialist-reviewed Windows authority must remain bounded and non-mutating.', path);
}

export function analyzeWindowsAuthoritySpecialistReview(input = {}) {
  const repository = text(input.repository);
  const sourceHead = text(input.sourceHead).toLowerCase();
  const paths = escalationPaths(input.analysis);
  const eligible = Boolean(
    repository.includes('/')
    && EXACT_HEAD.test(sourceHead)
    && paths.length > 0
    && paths.every((path) => ALLOWED_PATHS.includes(path))
  );
  if (!eligible) {
    return Object.freeze({
      schemaVersion: WINDOWS_AUTHORITY_SPECIALIST_SCHEMA_VERSION,
      eligible: false,
      clean: false,
      reviewedPaths: Object.freeze([]),
      findings: Object.freeze([]),
      proofRefs: Object.freeze([]),
      finalVerdict: 'WINDOWS_AUTHORITY_SPECIALIST_NOT_APPLICABLE',
    });
  }

  const sources = Array.isArray(input.sources) ? input.sources : [];
  const findings = [];
  const proofRefs = [];
  for (const path of paths) {
    const candidates = sources.filter((source) => text(source?.path) === path);
    if (candidates.length !== 1 || !exactSource(candidates[0], repository, sourceHead, path)) {
      findings.push(finding('windows-authority-source-evidence-invalid', 'Specialist review requires one exact-head, size-bound and blob-bound source record.', path));
      continue;
    }
    const source = candidates[0].content;
    if (path.endsWith('.ps1')) generalAuthorityScan(source, path, findings);
    if (path.endsWith('install-stephanos-backend-autostart.ps1')) reviewInstaller(source, path, findings);
    if (path.endsWith('probe-battle-bridge-recovery-mesh.ps1')) reviewProbe(source, path, findings);
    if (path.endsWith('start-stephanos-backend.ps1')) reviewStarter(source, path, findings);
    if (path.endsWith('install-forge-shadow-podman-v1.ps1')) reviewForgeInstaller(source, path, findings);
    if (path.endsWith('install-forge-shadow-podman-v1.test.mjs')) reviewForgeInstallerStaticTest(source, path, findings);
    proofRefs.push(`proofs/windows-authority-specialist/${path}@${sourceHead}#${candidates[0].blobSha}:${candidates[0].size}`);
  }

  const clean = findings.length === 0;
  return Object.freeze({
    schemaVersion: WINDOWS_AUTHORITY_SPECIALIST_SCHEMA_VERSION,
    eligible: true,
    clean,
    reviewedPaths: Object.freeze(paths),
    findings: Object.freeze(findings),
    proofRefs: Object.freeze(proofRefs),
    finalVerdict: clean
      ? 'WINDOWS_AUTHORITY_SPECIALIST_CLEAN'
      : 'WINDOWS_AUTHORITY_SPECIALIST_FINDINGS',
  });
}
