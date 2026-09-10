import { createHash } from 'node:crypto';

export const WINDOWS_AUTHORITY_MAILBOX_RECOVERY_GUARDIAN_PATHS_V1 = Object.freeze([
  'scripts/windows/run-battle-bridge-recovery-mesh-guardian-hidden.ps1',
]);

const SCHEMA = 'stephanos.windows-authority-specialist-review.v1';
const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const SHA = /^[a-f0-9]{40}$/;
const PATH = WINDOWS_AUTHORITY_MAILBOX_RECOVERY_GUARDIAN_PATHS_V1[0];
const text = (value) => String(value ?? '').trim();
const finding = (code) => Object.freeze({ severity: 'P0', code, summary: code, path: PATH });

function blobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function exactSource(source, repository, head) {
  const content = typeof source?.content === 'string' ? source.content : '';
  const size = Buffer.byteLength(content, 'utf8');
  return Boolean(source && typeof source === 'object' && !Array.isArray(source)
    && source.schemaVersion === SOURCE_SCHEMA
    && source.repository === repository
    && source.path === PATH
    && source.ref === head
    && source.exists === true
    && Number.isSafeInteger(source.size)
    && source.size === size && size > 0 && size <= 256 * 1024
    && SHA.test(text(source.blobSha))
    && source.blobSha === blobSha(content));
}

function eligibleEscalation(analysis = {}) {
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  return findings.length === 1
    && text(findings[0]?.severity).toUpperCase() === 'P0'
    && text(findings[0]?.code) === 'unsupported-high-risk-surface'
    && text(findings[0]?.path) === PATH;
}

function requireLiterals(findings, source, rules) {
  for (const [literal, code] of rules) if (!source.includes(literal)) findings.push(finding(code));
}

function requirePatterns(findings, source, rules) {
  for (const [pattern, code] of rules) if (!pattern.test(source)) findings.push(finding(code));
}

function forbidPatterns(findings, source, rules) {
  for (const [pattern, code] of rules) if (pattern.test(source)) findings.push(finding(code));
}

function extractPowerShellBlock(source, marker) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0 || source.indexOf(marker, markerIndex + marker.length) >= 0) return null;
  const open = source.indexOf('{', markerIndex + marker.length - 1);
  if (open < 0) return null;
  let depth = 0;
  let quote = '';
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    const previous = index > 0 ? source[index - 1] : '';
    if (quote) {
      if (char === quote && previous !== '`') quote = '';
      continue;
    }
    if (char === "'" || char === '"') { quote = char; continue; }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return { start: open, end: index, body: source.slice(open + 1, index) };
      if (depth < 0) return null;
    }
  }
  return null;
}

function normalizedArgumentBody(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function validateFixedReadCalls(findings, source) {
  const gitAllowed = new Set([
    "'-C', $repoRoot, 'branch', '--show-current'",
    "'-C', $repoRoot, 'remote', 'get-url', 'origin'",
    "'-C', $repoRoot, 'rev-parse', 'HEAD'",
  ]);
  for (const match of source.matchAll(/Read-FixedGitText\s+-Arguments\s+@\(([^)]*)\)/g)) {
    if (!gitAllowed.has(normalizedArgumentBody(match[1]))) findings.push(finding('mailbox-recovery-guardian-git-read-surface-widened'));
  }
  const githubTextAllowed = new Set([
    "'api', 'repos/Cheekyfellastef/stephan-os/branches/main', '--jq', '.commit.sha'",
  ]);
  for (const match of source.matchAll(/Read-FixedGitHubText\s+-Arguments\s+@\(([^)]*)\)/g)) {
    if (!githubTextAllowed.has(normalizedArgumentBody(match[1]))) findings.push(finding('mailbox-recovery-guardian-gh-read-surface-widened'));
  }
  const githubJsonAllowed = new Set(["'api', $comparePath"]);
  for (const match of source.matchAll(/Read-FixedGitHubJson\s+-Arguments\s+@\(([^)]*)\)/g)) {
    if (!githubJsonAllowed.has(normalizedArgumentBody(match[1]))) findings.push(finding('mailbox-recovery-guardian-gh-read-surface-widened'));
  }
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('& $gitExe')) continue;
    const allowed = line === '& $gitExe @Arguments'
      || /^& \$gitExe -C \$repoRoot diff --quiet -- \$authorityPath$/.test(line)
      || /^& \$gitExe -C \$repoRoot diff --cached --quiet -- \$authorityPath$/.test(line);
    if (!allowed) findings.push(finding('mailbox-recovery-guardian-direct-git-invocation-widened'));
  }
}

function reviewGuardian(source, findings) {
  requireLiterals(findings, source, [
    ["$recoveryTaskName = 'Stephanos Battle Bridge Recovery Mesh'", 'mailbox-recovery-guardian-recovery-task-not-fixed'],
    ["$mailboxTaskName = 'Stephanos Battle Bridge GitHub Command Mailbox'", 'mailbox-recovery-guardian-mailbox-task-not-fixed'],
    ["$gitExe = 'C:\\Program Files\\Git\\cmd\\git.exe'", 'mailbox-recovery-guardian-git-not-fixed'],
    ["$githubCli = 'C:\\Program Files\\GitHub CLI\\gh.exe'", 'mailbox-recovery-guardian-gh-not-fixed'],
    ["$fixedPowerShellExe = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'", 'mailbox-recovery-guardian-powershell-not-fixed'],
    ["$wscriptExe = 'C:\\Windows\\System32\\wscript.exe'", 'mailbox-recovery-guardian-wscript-not-fixed'],
    ["$scheduledTaskMutationScope = 'REREGISTER_AND_START_CANONICAL_RECOVERY_MESH_OR_MAILBOX_ONLY'", 'mailbox-recovery-guardian-mutation-scope-not-fixed'],
    ["$mailboxStaleAfterMinutes = 12", 'mailbox-recovery-guardian-mailbox-stale-window-not-fixed'],
    ["'Documents\\GitHub\\stephan-os'", 'mailbox-recovery-guardian-repository-root-not-fixed'],
    ["$localHead = (Read-FixedGitText -Arguments @('-C', $repoRoot, 'rev-parse', 'HEAD')).ToLowerInvariant()", 'mailbox-recovery-guardian-local-head-provenance-missing'],
    ["$authoritySourcePaths = @(", 'mailbox-recovery-guardian-authority-source-list-missing'],
    ["'scripts/windows/install-battle-bridge-github-command-mailbox.ps1'", 'mailbox-recovery-guardian-mailbox-source-proof-missing'],
    ["'scripts/battle-bridge-github-command-mailbox-outbox-guard-v1.mjs'", 'mailbox-recovery-guardian-outbox-guard-source-proof-missing'],
    ["'scripts/windows/install-battle-bridge-recovery-mesh.ps1'", 'mailbox-recovery-guardian-recovery-source-proof-missing'],
    ["'scripts/windows/run-stephanos-scheduled-task-windowless.vbs'", 'mailbox-recovery-guardian-launcher-source-proof-missing'],
    ["Stop-Guardian -Blocker 'LOCAL_AUTHORITY_SOURCE_DIRTY'", 'mailbox-recovery-guardian-authority-dirt-blocker-missing'],
    ["Stop-Guardian -Blocker 'LOCAL_AUTHORITY_SOURCE_STAGED_DIRTY'", 'mailbox-recovery-guardian-authority-staged-dirt-blocker-missing'],
    ["$mailboxInstallerPath = Join-Path $repoRoot 'scripts\\windows\\install-battle-bridge-github-command-mailbox.ps1'", 'mailbox-recovery-guardian-mailbox-installer-not-fixed'],
    ["$mailboxRunnerPath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'scripts\\battle-bridge-github-command-mailbox-outbox-guard-v1.mjs'))", 'mailbox-recovery-guardian-runner-not-fixed'],
    ["$mailboxChildRunnerPath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'scripts\\battle-bridge-github-command-mailbox-with-receipt-index.mjs'))", 'mailbox-recovery-guardian-child-runner-not-fixed'],
    ["$recoveryInstallerPath = Join-Path $repoRoot 'scripts\\windows\\install-battle-bridge-recovery-mesh.ps1'", 'mailbox-recovery-guardian-recovery-installer-not-fixed'],
    ["function Test-MailboxTaskIdentity", 'mailbox-recovery-guardian-mailbox-identity-check-missing'],
    ["function Test-RecoveryTaskIdentity", 'mailbox-recovery-guardian-recovery-identity-check-missing'],
    ["github-command-mailbox", 'mailbox-recovery-guardian-mailbox-launcher-id-not-fixed'],
    ["recovery-mesh", 'mailbox-recovery-guardian-recovery-launcher-id-not-fixed'],
    ["'repos/Cheekyfellastef/stephan-os/branches/main'", 'mailbox-recovery-guardian-main-api-not-fixed'],
    ["'repos/Cheekyfellastef/stephan-os/compare/'", 'mailbox-recovery-guardian-compare-api-not-fixed'],
    ["sourceRelation = 'EXACT'", 'mailbox-recovery-guardian-exact-relation-missing'],
    ["sourceRelation = 'TRUSTED_ANCESTOR'", 'mailbox-recovery-guardian-ancestor-relation-missing'],
    ["Stop-Guardian -Blocker 'LOCAL_HEAD_NOT_TRUSTED_MAIN_ANCESTOR'", 'mailbox-recovery-guardian-divergence-blocker-missing'],
    ["-File $mailboxInstallerPath -StartNow", 'mailbox-recovery-guardian-mailbox-repair-call-not-fixed'],
    ["schemaVersion -ne 'stephanos.battle-bridge-github-command-mailbox-install.v1'", 'mailbox-recovery-guardian-mailbox-repair-schema-proof-missing'],
    ["Stop-Guardian -Blocker 'MAILBOX_REPAIR_TASK_IDENTITY_UNPROVEN'", 'mailbox-recovery-guardian-mailbox-postrepair-proof-missing'],
    ["if ($sourceRelation -eq 'EXACT') {", 'mailbox-recovery-guardian-recovery-exact-head-gate-missing'],
    ["-File $recoveryInstallerPath -StartNow -RecoveryMeshOnly", 'mailbox-recovery-guardian-recovery-repair-call-not-fixed'],
    ["schemaVersion -ne 'stephanos.battle-bridge-recovery-mesh-install.v1'", 'mailbox-recovery-guardian-recovery-repair-schema-proof-missing'],
    ["mailboxRepairAttempted = $mailboxRepairAttempted", 'mailbox-recovery-guardian-mailbox-attempt-receipt-missing'],
    ["mailboxRepairApplied = $mailboxRepairApplied", 'mailbox-recovery-guardian-mailbox-applied-receipt-missing'],
    ["recoveryRepairAttempted = $recoveryRepairAttempted", 'mailbox-recovery-guardian-recovery-attempt-receipt-missing'],
    ["sourceRelation = $sourceRelation", 'mailbox-recovery-guardian-source-relation-receipt-missing'],
    ['arbitraryShellAllowed = $false', 'mailbox-recovery-guardian-shell-denial-missing'],
    ['arbitraryTaskNameAllowed = $false', 'mailbox-recovery-guardian-arbitrary-task-denial-missing'],
    ['sourceMutationAllowed = $false', 'mailbox-recovery-guardian-source-denial-missing'],
    ['gitMutationAllowed = $false', 'mailbox-recovery-guardian-git-denial-missing'],
    ['mergeAuthority = $false', 'mailbox-recovery-guardian-merge-denial-missing'],
  ]);

  requirePatterns(findings, source, [
    [/\$remoteMainHead\s*=\s*\(Read-FixedGitHubText\s+-Arguments\s+@\('api',\s*'repos\/Cheekyfellastef\/stephan-os\/branches\/main',\s*'--jq',\s*'\.commit\.sha'\)\)\.ToLowerInvariant\(\)/, 'mailbox-recovery-guardian-main-read-not-fixed'],
    [/\$comparePath\s*=\s*'repos\/Cheekyfellastef\/stephan-os\/compare\/'\s*\+\s*\$localHead\s*\+\s*'\.\.\.'\s*\+\s*\$remoteMainHead/, 'mailbox-recovery-guardian-compare-path-not-head-bound'],
    [/\$comparison\.status\s+-eq\s*'ahead'[\s\S]*\$comparison\.ahead_by\s+-gt\s*0[\s\S]*\$comparison\.behind_by\s+-eq\s*0[\s\S]*\$comparison\.merge_base_commit\.sha\s+-eq\s*\$localHead/, 'mailbox-recovery-guardian-ancestor-proof-incomplete'],
    [/if \(\$localHead -eq \$remoteMainHead\) \{[\s\S]*sourceRelation = 'EXACT'[\s\S]*\} else \{[\s\S]*Read-FixedGitHubJson[\s\S]*sourceRelation = 'TRUSTED_ANCESTOR'/, 'mailbox-recovery-guardian-relation-branch-not-fixed'],
    [/if \(-not \$mailboxHealthy\) \{[\s\S]*-File \$mailboxInstallerPath -StartNow[\s\S]*Test-MailboxTaskIdentity/, 'mailbox-recovery-guardian-mailbox-repair-boundary-incomplete'],
    [/foreach \(\$authorityPath in \$authoritySourcePaths\) \{[\s\S]*& \$gitExe -C \$repoRoot diff --quiet -- \$authorityPath[\s\S]*LOCAL_AUTHORITY_SOURCE_DIRTY[\s\S]*& \$gitExe -C \$repoRoot diff --cached --quiet -- \$authorityPath[\s\S]*LOCAL_AUTHORITY_SOURCE_STAGED_DIRTY/, 'mailbox-recovery-guardian-authority-source-proof-incomplete'],
  ]);

  const exactMarker = "if ($sourceRelation -eq 'EXACT') {";
  const exactBlock = extractPowerShellBlock(source, exactMarker);
  const recoveryCall = '-File $recoveryInstallerPath -StartNow -RecoveryMeshOnly';
  if (!exactBlock || !exactBlock.body.includes(recoveryCall)) {
    findings.push(finding('mailbox-recovery-guardian-recovery-repair-not-exact-head-gated'));
  } else {
    const outsideExactBlock = source.slice(0, exactBlock.start) + source.slice(exactBlock.end + 1);
    if (outsideExactBlock.includes(recoveryCall)) findings.push(finding('mailbox-recovery-guardian-recovery-repair-outside-exact-head-gate'));
  }

  validateFixedReadCalls(findings, source);

  forbidPatterns(findings, source, [
    [/\bgit(?:\.exe)?\s+(?:fetch|push|reset|clean|rebase|checkout|switch|merge)\b/i, 'mailbox-recovery-guardian-git-mutation-forbidden'],
    [/["'](?:fetch|push|reset|clean|rebase|checkout|switch|merge)["']/i, 'mailbox-recovery-guardian-git-mutation-argument-forbidden'],
    [/\bRegister-ScheduledTask\b|\bNew-ScheduledTask(?:Action|Trigger|Principal|SettingsSet)?\b|\bStart-ScheduledTask\b/i, 'mailbox-recovery-guardian-direct-task-mutation-forbidden'],
    [/Invoke-Expression|\biex\b|Start-Process|cmd\.exe|Restart-Computer|shutdown\.exe|Stop-Process/i, 'mailbox-recovery-guardian-dynamic-execution-forbidden'],
    [/(?:^|\s)-(?:EncodedCommand|Command)\b/im, 'mailbox-recovery-guardian-dynamic-powershell-forbidden'],
    [/\$githubCli\s+(?:pr|issue|workflow|run|auth|secret|variable|repo)\b/i, 'mailbox-recovery-guardian-gh-surface-widened'],
    [/\$githubCli\s+api\b[^\r\n]*(?:-X|--method|--input|-f\s|--field|--raw-field)/i, 'mailbox-recovery-guardian-gh-mutation-forbidden'],
    [/repos\/(?!Cheekyfellastef\/stephan-os\/)/i, 'mailbox-recovery-guardian-other-repository-forbidden'],
    [/\[string\]\s*\$(?:TaskName|InstallerPath|Repository|Owner|Repo)\b/i, 'mailbox-recovery-guardian-caller-authority-forbidden'],
    [/RunLevel\s+Highest|-MultipleInstances\s+Parallel/i, 'windows-authority-expanded'],
  ]);
}

export function analyzeWindowsAuthorityMailboxRecoveryGuardianReview(input = {}) {
  const repository = text(input.repository);
  const sourceHead = text(input.sourceHead).toLowerCase();
  if (repository !== 'Cheekyfellastef/stephan-os' || !SHA.test(sourceHead) || !eligibleEscalation(input.analysis)) {
    return Object.freeze({
      schemaVersion: SCHEMA,
      eligible: false,
      clean: false,
      reviewedPaths: [],
      findings: [],
      blocker: '',
      finalVerdict: 'WINDOWS_AUTHORITY_SPECIALIST_NOT_APPLICABLE',
    });
  }

  const candidates = (Array.isArray(input.sources) ? input.sources : []).filter((source) => source?.path === PATH);
  const findings = [];
  if (candidates.length !== 1 || !exactSource(candidates[0], repository, sourceHead)) {
    findings.push(finding('windows-authority-source-evidence-invalid'));
  } else {
    reviewGuardian(candidates[0].content, findings);
  }

  const clean = findings.length === 0;
  return Object.freeze({
    schemaVersion: SCHEMA,
    eligible: true,
    clean,
    reviewedPaths: [PATH],
    findings: Object.freeze(findings),
    blocker: '',
    proofRefs: Object.freeze(candidates.length === 1 && exactSource(candidates[0], repository, sourceHead)
      ? [`proofs/windows-authority-specialist/${PATH}@${sourceHead}#${candidates[0].blobSha}:${candidates[0].size}`]
      : []),
    finalVerdict: clean ? 'WINDOWS_AUTHORITY_SPECIALIST_CLEAN' : 'WINDOWS_AUTHORITY_SPECIALIST_FINDINGS',
  });
}
