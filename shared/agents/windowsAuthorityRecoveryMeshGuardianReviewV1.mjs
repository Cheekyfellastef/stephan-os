import { createHash } from 'node:crypto';

export const WINDOWS_AUTHORITY_RECOVERY_MESH_GUARDIAN_PATHS_V1 = Object.freeze([
  'scripts/windows/install-battle-bridge-recovery-mesh.ps1',
  'scripts/windows/run-battle-bridge-recovery-mesh-guardian-hidden.ps1',
  'scripts/windows/run-stephanos-scheduled-task-windowless.vbs',
  'scripts/windows/uninstall-battle-bridge-recovery-mesh.ps1',
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
  return Boolean(source && typeof source === 'object' && !Array.isArray(source)
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

function reviewInstaller(source, path, findings) {
  requireLiterals(findings, source, path, [
    ["$taskName = 'Stephanos Battle Bridge Recovery Mesh'", 'recovery-guardian-parent-task-not-fixed'],
    ["$guardianTaskName = 'Stephanos Battle Bridge Recovery Mesh Guardian'", 'recovery-guardian-task-not-fixed'],
    ["[switch]$RecoveryMeshOnly", 'recovery-guardian-recursion-guard-missing'],
    ["$wscriptExe = 'C:\\Windows\\System32\\wscript.exe'", 'recovery-guardian-wscript-not-fixed'],
    ['run-battle-bridge-recovery-mesh-guardian-hidden.ps1', 'recovery-guardian-runner-not-fixed'],
    ['recovery-mesh-guardian', 'recovery-guardian-launcher-id-not-fixed'],
    ['RepetitionInterval (New-TimeSpan -Minutes 5)', 'recovery-guardian-cadence-not-fixed'],
    ['-MultipleInstances IgnoreNew', 'recovery-guardian-overlap-not-rejected'],
    ['-LogonType Interactive -RunLevel Limited', 'recovery-guardian-principal-not-limited'],
    ["guardianAuthority = 'REREGISTER_AND_START_CANONICAL_RECOVERY_MESH_ONLY'", 'recovery-guardian-authority-not-fixed'],
    ["schemaVersion = 'stephanos.battle-bridge-recovery-mesh-install.v1'", 'recovery-guardian-install-schema-incompatible'],
    ["recoveryRoutes = @('LOCAL_WINDOWS_SUPERVISOR','GITHUB_MAILBOX','TAILSCALE_CONTROL','OPENCLAW_WHATSAPP','AUTHENTICATED_BREAK_GLASS')", 'recovery-guardian-routes-incompatible'],
    ['arbitraryTaskNameAllowed = $false', 'recovery-guardian-arbitrary-task-denial-missing'],
    ['sourceMutationAllowed = $false', 'recovery-guardian-source-denial-missing'],
    ['gitMutationAllowed = $false', 'recovery-guardian-git-denial-missing'],
    ['mergeAuthority = $false', 'recovery-guardian-merge-denial-missing'],
  ]);
  requirePatterns(findings, source, path, [
    [/if \(-not \$RecoveryMeshOnly\) \{[\s\S]*Register-ScheduledTask -TaskName \$guardianTaskName/, 'recovery-guardian-recursion-boundary-missing'],
  ]);
  forbidPatterns(findings, source, path, [
    [/RunLevel\s+Highest|-MultipleInstances\s+Parallel/i, 'windows-authority-expanded'],
    [/Invoke-Expression|Restart-Computer|shutdown\.exe|Stop-Process/i, 'windows-authority-expanded'],
    [/(?:^|\s)-(?:EncodedCommand|Command)\b/im, 'recovery-guardian-dynamic-powershell-forbidden'],
  ]);
}

function reviewGuardian(source, path, findings) {
  requireLiterals(findings, source, path, [
    ["[ValidateRange(2, 15)]", 'recovery-guardian-stale-range-unbounded'],
    ["[int]$StaleAfterMinutes = 4", 'recovery-guardian-stale-default-not-fixed'],
    ["$taskName = 'Stephanos Battle Bridge Recovery Mesh'", 'recovery-guardian-parent-task-not-fixed'],
    ["$gitExe = 'C:\\Program Files\\Git\\cmd\\git.exe'", 'recovery-guardian-git-not-fixed'],
    ["$fixedPowerShellExe = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'", 'recovery-guardian-powershell-not-fixed'],
    ["$wscriptExe = 'C:\\Windows\\System32\\wscript.exe'", 'recovery-guardian-wscript-not-fixed'],
    ["$scheduledTaskMutationScope = 'REREGISTER_AND_START_CANONICAL_RECOVERY_MESH_ONLY'", 'recovery-guardian-mutation-scope-not-fixed'],
    ["'Documents\\GitHub\\stephan-os'", 'recovery-guardian-repository-root-not-fixed'],
    ["'ls-remote', $origin, 'refs/heads/main'", 'recovery-guardian-trusted-remote-read-missing'],
    ["Stop-Guardian -Blocker 'LOCAL_HEAD_NOT_TRUSTED_REMOTE_MAIN'", 'recovery-guardian-exact-remote-head-gate-missing'],
    ["Stop-Guardian -Blocker 'RECOVERY_SOURCE_DIRTY'", 'recovery-guardian-dirty-source-gate-missing'],
    ["Stop-Guardian -Blocker 'RECOVERY_SOURCE_STAGED_DIRTY'", 'recovery-guardian-staged-source-gate-missing'],
    ['function Test-RecoveryTaskIdentity', 'recovery-guardian-task-identity-check-missing'],
    ["Task.Principal.LogonType", 'recovery-guardian-principal-proof-missing'],
    ["Task.Principal.RunLevel", 'recovery-guardian-runlevel-proof-missing'],
    ["Task.Settings.MultipleInstances", 'recovery-guardian-overlap-proof-missing'],
    ["'TASK_IDENTITY_DRIFTED'", 'recovery-guardian-task-drift-condition-missing'],
    ["'TASK_HEARTBEAT_STALE'", 'recovery-guardian-stale-condition-missing'],
    ['-File $installerPath -StartNow -RecoveryMeshOnly', 'recovery-guardian-repair-call-not-fixed'],
    ["schemaVersion -ne 'stephanos.battle-bridge-recovery-mesh-install.v1'", 'recovery-guardian-repair-schema-proof-missing'],
    ["Stop-Guardian -Blocker 'RECOVERY_MESH_REPAIR_TASK_IDENTITY_UNPROVEN'", 'recovery-guardian-postrepair-identity-proof-missing'],
    ['arbitraryShellAllowed = $false', 'recovery-guardian-shell-denial-missing'],
    ['sourceMutationAllowed = $false', 'recovery-guardian-source-denial-missing'],
    ['gitMutationAllowed = $false', 'recovery-guardian-git-denial-missing'],
    ['arbitraryRuntimeMutationAllowed = $false', 'recovery-guardian-runtime-denial-missing'],
    ['mergeAuthority = $false', 'recovery-guardian-merge-denial-missing'],
  ]);
  requirePatterns(findings, source, path, [
    [/\$expectedArguments\s*=\s*"\/\/B \/\/NoLogo `"\$ExpectedLauncherPath`" recovery-mesh"/, 'recovery-guardian-parent-action-not-fixed'],
    [/\$localHead\s+-ne\s+\$remoteMainHead/, 'recovery-guardian-exact-head-comparison-missing'],
    [/\$healthy\s*=\s*\$null -ne \$task[\s\S]*\$taskIdentityCanonical[\s\S]*\$lastTaskResult -eq 0[\s\S]*\$lastRunAgeMinutes -le \$StaleAfterMinutes/, 'recovery-guardian-health-join-incomplete'],
  ]);
  forbidPatterns(findings, source, path, [
    [/Register-ScheduledTask|New-ScheduledTaskAction|New-ScheduledTaskTrigger/, 'recovery-guardian-direct-registration-forbidden'],
    [/Invoke-Expression|\biex\b|Start-Process|cmd\.exe/i, 'recovery-guardian-dynamic-execution-forbidden'],
    [/git(?:\.exe)?\s+(?:push|reset|clean|rebase|checkout|switch|merge|fetch)\b/i, 'windows-authority-source-mutation-forbidden'],
    [/(?:^|\s)-(?:EncodedCommand|Command)\b/im, 'recovery-guardian-dynamic-powershell-forbidden'],
    [/Restart-Computer|shutdown\.exe|Stop-Process|RunLevel\s+Highest/i, 'windows-authority-expanded'],
  ]);
}

function reviewLauncher(source, path, findings) {
  requireLiterals(findings, source, path, [
    ['If WScript.Arguments.Count <> 1 Then', 'recovery-guardian-launcher-argument-count-not-fixed'],
    ['Case "recovery-mesh-guardian"', 'recovery-guardian-launcher-case-missing'],
    ['run-battle-bridge-recovery-mesh-guardian-hidden.ps1', 'recovery-guardian-launcher-path-not-fixed'],
    ['WScript.Quit 2', 'recovery-guardian-launcher-unknown-id-not-rejected'],
    ['exitCode = shell.Run(command, 0, True)', 'recovery-guardian-launcher-not-windowless-waited'],
  ]);
  forbidPatterns(findings, source, path, [
    [/WScript\.Arguments\(1\)/i, 'recovery-guardian-launcher-extra-argument-forbidden'],
    [/ExecuteGlobal|\bEval\s*\(/i, 'recovery-guardian-launcher-dynamic-code-forbidden'],
  ]);
}

function reviewUninstaller(source, path, findings) {
  requireLiterals(findings, source, path, [
    ['[CmdletBinding(SupportsShouldProcess = $true)]', 'recovery-guardian-uninstall-shouldprocess-missing'],
    ["$taskName = 'Stephanos Battle Bridge Recovery Mesh'", 'recovery-guardian-uninstall-parent-not-fixed'],
    ["$guardianTaskName = 'Stephanos Battle Bridge Recovery Mesh Guardian'", 'recovery-guardian-uninstall-task-not-fixed'],
    ["Unregister-ScheduledTask -TaskName $guardianTaskName -Confirm:$false", 'recovery-guardian-uninstall-guardian-call-missing'],
    ["throw 'RECOVERY_MESH_GUARDIAN_UNINSTALL_FAILED'", 'recovery-guardian-uninstall-failclosed-missing'],
    ["Unregister-ScheduledTask -TaskName $taskName -Confirm:$false", 'recovery-guardian-uninstall-parent-call-missing'],
    ['guardianRemovedBeforeRecoveryMesh = $true', 'recovery-guardian-uninstall-order-receipt-missing'],
    ['workerPreserved = $true', 'recovery-guardian-uninstall-worker-preservation-missing'],
    ['mailboxPreserved = $true', 'recovery-guardian-uninstall-mailbox-preservation-missing'],
    ['sourcePreserved = $true', 'recovery-guardian-uninstall-source-preservation-missing'],
  ]);
  requirePatterns(findings, source, path, [
    [/Unregister-ScheduledTask -TaskName \$guardianTaskName[\s\S]*Unregister-ScheduledTask -TaskName \$taskName/, 'recovery-guardian-uninstall-order-not-proved'],
  ]);
  forbidPatterns(findings, source, path, [
    [/(?:^|[\s;|&])(?:Register-ScheduledTask|Start-ScheduledTask|New-ScheduledTask(?:Action|Trigger|Principal|SettingsSet)?)(?=\s|$)/im, 'recovery-guardian-uninstall-start-or-register-forbidden'],
    [/Invoke-Expression|Start-Process|Restart-Computer|shutdown\.exe|Stop-Process/i, 'windows-authority-expanded'],
    [/\bgit(?:\.exe)?\b/i, 'recovery-guardian-uninstall-git-forbidden'],
  ]);
}

export function analyzeWindowsAuthorityRecoveryMeshGuardianReview(input = {}) {
  const repository = text(input.repository);
  const sourceHead = text(input.sourceHead).toLowerCase();
  const paths = escalationPaths(input.analysis);
  const eligible = repository.includes('/') && SHA.test(sourceHead) && paths.length > 0
    && paths.every((path) => WINDOWS_AUTHORITY_RECOVERY_MESH_GUARDIAN_PATHS_V1.includes(path));
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
    if (path === WINDOWS_AUTHORITY_RECOVERY_MESH_GUARDIAN_PATHS_V1[0]) reviewInstaller(source, path, findings);
    if (path === WINDOWS_AUTHORITY_RECOVERY_MESH_GUARDIAN_PATHS_V1[1]) reviewGuardian(source, path, findings);
    if (path === WINDOWS_AUTHORITY_RECOVERY_MESH_GUARDIAN_PATHS_V1[2]) reviewLauncher(source, path, findings);
    if (path === WINDOWS_AUTHORITY_RECOVERY_MESH_GUARDIAN_PATHS_V1[3]) reviewUninstaller(source, path, findings);
    proofRefs.push(`proofs/windows-authority-specialist/${path}@${sourceHead}#${candidates[0].blobSha}:${candidates[0].size}`);
  }
  const clean = findings.length === 0;
  return Object.freeze({ schemaVersion: SCHEMA, eligible: true, clean, reviewedPaths: Object.freeze(paths), findings: Object.freeze(findings), proofRefs: Object.freeze(proofRefs), finalVerdict: clean ? 'WINDOWS_AUTHORITY_SPECIALIST_CLEAN' : 'WINDOWS_AUTHORITY_SPECIALIST_FINDINGS' });
}
