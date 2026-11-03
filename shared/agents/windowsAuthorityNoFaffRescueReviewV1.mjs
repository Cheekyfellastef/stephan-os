import { createHash } from 'node:crypto';

export const WINDOWS_AUTHORITY_NO_FAFF_RESCUE_PATHS_V1 = Object.freeze([
  'scripts/windows/repair-battle-bridge-control-plane-now.ps1',
  'scripts/windows/Repair-Battle-Bridge-Control-Plane-Now.cmd',
  'scripts/windows/repair-battle-bridge-control-plane-now.test.mjs',
  'scripts/windows/status-stephanos-codex-dispatch-plugin.ps1',
]);

const SCHEMA = 'stephanos.windows-authority-specialist-review.v1';
const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const SHA = /^[a-f0-9]{40}$/;
const text = (value) => String(value ?? '').trim();
const finding = (code, path) => Object.freeze({ severity: 'P0', code, summary: code, path });
const unique = (values) => [...new Set(values)];

function blobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function escalationPaths(analysis) {
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  return findings.length && findings.every((item) => (
    text(item?.severity).toUpperCase() === 'P0'
    && text(item?.code) === 'unsupported-high-risk-surface'
    && text(item?.path).startsWith('scripts/windows/')
  )) ? unique(findings.map((item) => text(item.path))) : [];
}

function exactSource(source, repository, head, path) {
  const content = typeof source?.content === 'string' ? source.content : '';
  const size = Buffer.byteLength(content, 'utf8');
  return Boolean(source && !Array.isArray(source)
    && source.schemaVersion === SOURCE_SCHEMA
    && source.repository === repository
    && source.path === path
    && source.ref === head
    && source.exists === true
    && Number.isSafeInteger(source.size)
    && source.size === size && size > 0 && size <= 256 * 1024
    && SHA.test(text(source.blobSha))
    && source.blobSha === blobSha(content));
}

function requireLiterals(findings, source, path, rules) {
  for (const [literal, code] of rules) if (!source.includes(literal)) findings.push(finding(code, path));
}
function requirePatterns(findings, source, path, rules) {
  for (const [pattern, code] of rules) if (!pattern.test(source)) findings.push(finding(code, path));
}
function forbidPatterns(findings, source, path, rules) {
  for (const [pattern, code] of rules) if (pattern.test(source)) findings.push(finding(code, path));
}

function reviewRescue(source, path, findings) {
  requireLiterals(findings, source, path, [
    ['[CmdletBinding(SupportsShouldProcess = $true)]', 'no-faff-rescue-shouldprocess-missing'],
    ['[ValidateRange(60, 900)]', 'no-faff-rescue-timeout-not-bounded'],
    ['[ValidateRange(1, 15)]', 'no-faff-rescue-poll-not-bounded'],
    ["$repository = 'Cheekyfellastef/stephan-os'", 'no-faff-rescue-repository-not-fixed'],
    ["$publicRemote = 'https://github.com/Cheekyfellastef/stephan-os.git'", 'no-faff-rescue-public-remote-not-fixed'],
    ["$gitExe = 'C:\\Program Files\\Git\\cmd\\git.exe'", 'no-faff-rescue-git-not-fixed'],
    ["$syncTaskName = 'Stephanos Battle Bridge GitHub Sync'", 'no-faff-rescue-sync-task-not-fixed'],
    ["$recoveryTaskName = 'Stephanos Battle Bridge Recovery Mesh'", 'no-faff-rescue-recovery-task-not-fixed'],
    ["$mailboxTaskName = 'Stephanos Battle Bridge GitHub Command Mailbox'", 'no-faff-rescue-mailbox-task-not-fixed'],
    ["'scripts\\windows\\install-battle-bridge-github-sync.ps1'", 'no-faff-rescue-sync-installer-not-fixed'],
    ["'scripts\\windows\\install-battle-bridge-recovery-mesh.ps1'", 'no-faff-rescue-recovery-installer-not-fixed'],
    ["'scripts\\windows\\install-battle-bridge-github-command-mailbox.ps1'", 'no-faff-rescue-mailbox-installer-not-fixed'],
    ["'scripts\\windows\\install-stephanos-codex-dispatch-plugin.ps1'", 'no-faff-rescue-dispatch-installer-not-fixed'],
    ["'scripts\\windows\\status-stephanos-codex-dispatch-plugin.ps1'", 'no-faff-rescue-dispatch-status-not-fixed'],
    ["Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'", 'no-faff-rescue-powershell-not-fixed'],
    ["@('ls-remote', $publicRemote, 'refs/heads/main')", 'no-faff-rescue-main-read-not-fixed'],
    ["$PSCmdlet.ShouldProcess($repoRoot, 'Start the three existing reviewed Battle Bridge control-plane tasks, converge to public main, and repair the existing Codex dispatch attachment')", 'no-faff-rescue-mutation-gate-missing'],
    ['Invoke-FixedInstaller -Path $syncInstaller -ExpectedTaskName $syncTaskName', 'no-faff-rescue-sync-call-not-fixed'],
    ['Invoke-FixedInstaller -Path $recoveryInstaller -ExpectedTaskName $recoveryTaskName', 'no-faff-rescue-recovery-call-not-fixed'],
    ['Invoke-FixedInstaller -Path $mailboxInstaller -ExpectedTaskName $mailboxTaskName', 'no-faff-rescue-mailbox-call-not-fixed'],
    ['if ([string]$receipt.taskName -ne $ExpectedTaskName)', 'no-faff-rescue-installer-identity-proof-missing'],
    ['if ($receipt.installed -ne $true -or $receipt.startedNow -ne $true)', 'no-faff-rescue-installer-start-proof-missing'],
    ['for ($round = 1; $round -le 3; $round += 1)', 'no-faff-rescue-main-stability-bound-missing'],
    ["Stop-BoundedRescue -Blocker 'EXACT_MAIN_CONVERGENCE_TIMEOUT'", 'no-faff-rescue-convergence-failclosed-missing'],
    ["Stop-BoundedRescue -Blocker 'PUBLIC_MAIN_MOVED_DURING_RESCUE'", 'no-faff-rescue-moving-main-failclosed-missing'],
    ["Stop-BoundedRescue -Blocker 'EXACT_TREE_PROOF_FAILED'", 'no-faff-rescue-tree-failclosed-missing'],
    ['Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue', 'no-faff-rescue-task-presence-proof-missing'],
    ['-File $dispatchInstaller -RepositoryRoot $repoRoot', 'no-faff-rescue-dispatch-install-call-not-fixed'],
    ['-File $dispatchStatus -RepositoryRoot $repoRoot', 'no-faff-rescue-dispatch-status-call-not-fixed'],
    ["blocker = if ($dispatchProof.localBridgeReady -eq $true) { 'CHATGPT_DESKTOP_PLUGIN_ATTACHMENT_REQUIRED' }", 'no-faff-rescue-attachment-blocker-missing'],
    ['newWorkerCreated = $false', 'no-faff-rescue-new-worker-denial-missing'],
    ['newMailboxCreated = $false', 'no-faff-rescue-new-mailbox-denial-missing'],
    ['sourceMutationPerformedByRescue = $false', 'no-faff-rescue-source-mutation-denial-missing'],
    ['sourceConvergencePerformedByExistingReviewedSync = $true', 'no-faff-rescue-sync-delegation-proof-missing'],
    ['destructiveGitAllowed = $false', 'no-faff-rescue-destructive-git-denial-missing'],
    ['arbitraryShellAllowed = $false', 'no-faff-rescue-arbitrary-shell-denial-missing'],
    ['tailscaleCredentialRequired = $false', 'no-faff-rescue-tailscale-denial-missing'],
    ['forgeMutationPerformed = $false', 'no-faff-rescue-forge-mutation-denial-missing'],
    ["finalVerdict = 'BATTLE_BRIDGE_NO_FAFF_RESCUE_REMOTE_CODEX_ATTACHMENT_REQUIRED'", 'no-faff-rescue-attachment-verdict-missing'],
    ["finalVerdict = 'BATTLE_BRIDGE_NO_FAFF_RESCUE_REMOTE_CODEX_READY'", 'no-faff-rescue-ready-verdict-missing'],
  ]);
  requirePatterns(findings, source, path, [
    [/Read-FixedGitText -Arguments @\('-C', \$repoRoot, 'rev-parse', "\$observedHead`\$\{tree\}"\)/, 'no-faff-rescue-tree-binding-missing'],
    [/\$origin -notmatch '\^\(https:\\\/\\\/github\\\.com\\\/Cheekyfellastef\\\/stephan-os/, 'no-faff-rescue-origin-guard-missing'],
    [/\(\$taskProof \| Where-Object \{ \$_\.present -ne \$true \}\)\.Count -gt 0/, 'no-faff-rescue-task-set-failclosed-missing'],
  ]);
  forbidPatterns(findings, source, path, [
    [/\b(?:Start-ScheduledTask|Register-ScheduledTask|New-ScheduledTask)\b/i, 'no-faff-rescue-direct-task-mutation-forbidden'],
    [/\bStart-Process\b/i, 'no-faff-rescue-process-launch-forbidden'],
    [/\b(?:Invoke-WebRequest|Invoke-RestMethod|curl|wget|bitsadmin|certutil)\b/i, 'no-faff-rescue-generic-network-forbidden'],
    [/["'](?:fetch|merge)["']/i, 'no-faff-rescue-direct-source-convergence-forbidden'],
    [/\b(?:TS_OAUTH_CLIENT_ID|TS_AUDIENCE|SSH_PRIVATE_KEY|SSH_KNOWN_HOSTS)\b/, 'no-faff-rescue-credential-surface-forbidden'],
    [/\b(?:INSTALL_FORGE_SHADOW_M2|podman|forgejo)\b/i, 'no-faff-rescue-forge-authority-forbidden'],
    [/(?:^|\s)-(?:EncodedCommand|Command)\b/im, 'no-faff-rescue-dynamic-powershell-forbidden'],
    [/Invoke-Expression|Restart-Computer|shutdown\.exe|Stop-Process|RunLevel\s+Highest/i, 'windows-authority-expanded'],
    [/git(?:\.exe)?\s+(?:push|reset|clean|rebase|checkout|switch)\b/i, 'windows-authority-source-mutation-forbidden'],
  ]);
}

function reviewDispatchStatus(source, path, findings) {
  requireLiterals(findings, source, path, [
    ['.codex\\plugins\\stephanos-codex-dispatch', 'dispatch-status-install-root-not-fixed'],
    ['scripts\\stephanos-codex-dispatch-mcp.mjs', 'dispatch-status-server-path-not-fixed'],
    ['codex-dispatch\\surface-attachment-latest.json', 'dispatch-status-attachment-path-not-fixed'],
    ["$fixedGitPath = 'C:\\Program Files\\Git\\cmd\\git.exe'", 'dispatch-status-git-not-fixed'],
    ['Get-FileHash -LiteralPath $mcpServerPath -Algorithm SHA256', 'dispatch-status-server-hash-proof-missing'],
    ["'stephanos.codex-dispatch-surface-attachment.v1'", 'dispatch-status-attachment-schema-missing'],
    ['[string]$attachmentProof.sourceHead -eq $sourceHead', 'dispatch-status-head-binding-missing'],
    ['[string]$attachmentProof.serverSourceSha256 -eq $serverSourceSha256', 'dispatch-status-source-hash-binding-missing'],
    ['$age.TotalMinutes -le 10', 'dispatch-status-freshness-bound-missing'],
    ["@('dispatch_codex_task', 'get_codex_task_status', 'read_codex_task_result')", 'dispatch-status-required-tools-not-fixed'],
    ['executionSurfaceHandshake = [ordered]@{', 'dispatch-status-handshake-missing'],
    ['can_local_windows_proof = $attachmentProofValid', 'dispatch-status-windows-capability-proof-missing'],
    ['heartbeatFresh = $attachmentProofFresh -and $attachmentProofValid', 'dispatch-status-heartbeat-proof-missing'],
    ['readyForRemoteChatDispatch = $status.localBridgeReady -and $attachmentProofValid', 'dispatch-status-readiness-join-missing'],
    ['STEPHANOS_CODEX_DISPATCH_BRIDGE_ATTACHED_READY', 'dispatch-status-ready-verdict-missing'],
    ['BLOCKED_CHATGPT_PLUGIN_ATTACHMENT_UNPROVEN', 'dispatch-status-blocked-verdict-missing'],
    ['if (-not $status.readyForRemoteChatDispatch) { exit 1 }', 'dispatch-status-failclosed-exit-missing'],
  ]);
  forbidPatterns(findings, source, path, [
    [/\b(?:Start-ScheduledTask|Register-ScheduledTask|New-ScheduledTask|Start-Process)\b/i, 'dispatch-status-process-mutation-forbidden'],
    [/\b(?:Invoke-WebRequest|Invoke-RestMethod|curl|wget|bitsadmin|certutil)\b/i, 'dispatch-status-network-forbidden'],
    [/Invoke-Expression|Restart-Computer|shutdown\.exe|Stop-Process|RunLevel\s+Highest/i, 'windows-authority-expanded'],
    [/git(?:\.exe)?\s+(?:push|reset|clean|rebase|checkout|switch|merge|fetch)\b/i, 'windows-authority-source-mutation-forbidden'],
  ]);
}

function reviewLauncher(source, path, findings) {
  requireLiterals(findings, source, path, [
    ['set "SCRIPT=%USERPROFILE%\\Documents\\GitHub\\stephan-os\\scripts\\windows\\repair-battle-bridge-control-plane-now.ps1"', 'no-faff-launcher-script-not-fixed'],
    ['set "POWERSHELL=%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"', 'no-faff-launcher-powershell-not-fixed'],
    ['if not exist "%POWERSHELL%"', 'no-faff-launcher-powershell-proof-missing'],
    ['if not exist "%SCRIPT%"', 'no-faff-launcher-source-proof-missing'],
    ['"%POWERSHELL%" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%SCRIPT%"', 'no-faff-launcher-invocation-not-fixed'],
    ['exit /b %EXITCODE%', 'no-faff-launcher-exit-propagation-missing'],
  ]);
  forbidPatterns(findings, source, path, [
    [/%(?:\*|[1-9])/, 'no-faff-launcher-caller-arguments-forbidden'],
    [/(?:-Command|-EncodedCommand)\b/i, 'no-faff-launcher-dynamic-powershell-forbidden'],
    [/\b(?:curl|wget|Invoke-WebRequest|bitsadmin|certutil)\b/i, 'no-faff-launcher-network-forbidden'],
    [/\b(?:runas|cmd\s+\/c|start\s+\/b)\b/i, 'no-faff-launcher-authority-expansion-forbidden'],
  ]);
}

function reviewStaticTest(source, path, findings) {
  requireLiterals(findings, source, path, [
    ["new URL('./repair-battle-bridge-control-plane-now.ps1'", 'no-faff-static-test-ps1-not-fixed'],
    ["new URL('./Repair-Battle-Bridge-Control-Plane-Now.cmd'", 'no-faff-static-test-launcher-not-fixed'],
    ["new URL('./status-stephanos-codex-dispatch-plugin.ps1'", 'no-faff-static-test-status-not-fixed'],
    ["test('rescue is fixed to the canonical repository and three existing task installers'", 'no-faff-static-test-identity-guard-missing'],
    ["test('rescue reads Git identity but delegates all source convergence to the reviewed sync task'", 'no-faff-static-test-source-boundary-missing'],
    ["test('rescue does not require or expose Tailscale and Forge credentials or mutate Forge'", 'no-faff-static-test-credential-boundary-missing'],
    ["test('one-click launcher invokes only the fixed source-controlled rescue script'", 'no-faff-static-test-launcher-boundary-missing'],
    ['BATTLE_BRIDGE_NO_FAFF_RESCUE_REMOTE_CODEX_READY', 'no-faff-static-test-verdict-guard-missing'],
    ["test('dispatch readiness requires a fresh exact-head Windows tools-list attachment proof'", 'no-faff-static-test-attachment-guard-missing'],
    ['sourceMutationPerformedByRescue = \\$false', 'no-faff-static-test-source-denial-missing'],
    ['[\'\"](?:fetch|merge)[\'\"]', 'no-faff-static-test-convergence-denial-missing'],
  ]);
  forbidPatterns(findings, source, path, [
    [/node:child_process/, 'no-faff-static-test-child-process-forbidden'],
    [/\b(?:writeFileSync|appendFileSync|rmSync|unlinkSync|renameSync)\b/, 'no-faff-static-test-filesystem-mutation-forbidden'],
    [/\bfetch\s*\(/, 'no-faff-static-test-network-forbidden'],
  ]);
}

export function analyzeWindowsAuthorityNoFaffRescueReview(input = {}) {
  const repository = text(input.repository);
  const sourceHead = text(input.sourceHead).toLowerCase();
  const paths = escalationPaths(input.analysis);
  const eligible = repository.includes('/') && SHA.test(sourceHead) && paths.length > 0
    && paths.every((path) => WINDOWS_AUTHORITY_NO_FAFF_RESCUE_PATHS_V1.includes(path));
  if (!eligible) return Object.freeze({ schemaVersion: SCHEMA, eligible: false, clean: false, reviewedPaths: Object.freeze([]), findings: Object.freeze([]), proofRefs: Object.freeze([]), finalVerdict: 'WINDOWS_AUTHORITY_SPECIALIST_NOT_APPLICABLE' });

  const sources = Array.isArray(input.sources) ? input.sources : [];
  const findings = [];
  const proofRefs = [];
  for (const path of paths) {
    const candidates = sources.filter((source) => text(source?.path) === path);
    if (candidates.length !== 1 || !exactSource(candidates[0], repository, sourceHead, path)) {
      findings.push(finding('windows-authority-source-evidence-invalid', path));
      continue;
    }
    const source = candidates[0].content;
    if (path.endsWith('repair-battle-bridge-control-plane-now.ps1')) reviewRescue(source, path, findings);
    if (path.endsWith('Repair-Battle-Bridge-Control-Plane-Now.cmd')) reviewLauncher(source, path, findings);
    if (path.endsWith('repair-battle-bridge-control-plane-now.test.mjs')) reviewStaticTest(source, path, findings);
    if (path.endsWith('status-stephanos-codex-dispatch-plugin.ps1')) reviewDispatchStatus(source, path, findings);
    proofRefs.push(`proofs/windows-authority-specialist/${path}@${sourceHead}#${candidates[0].blobSha}:${candidates[0].size}`);
  }
  const clean = findings.length === 0;
  return Object.freeze({ schemaVersion: SCHEMA, eligible: true, clean, reviewedPaths: Object.freeze(paths), findings: Object.freeze(findings), proofRefs: Object.freeze(proofRefs), finalVerdict: clean ? 'WINDOWS_AUTHORITY_SPECIALIST_CLEAN' : 'WINDOWS_AUTHORITY_SPECIALIST_FINDINGS' });
}
