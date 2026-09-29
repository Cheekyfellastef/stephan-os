import { createHash } from 'node:crypto';

export const WINDOWS_AUTHORITY_MAILBOX_CADENCE_PATHS_V1 = Object.freeze([
  'scripts/windows/install-battle-bridge-github-command-mailbox.ps1',
]);

const SCHEMA = 'stephanos.windows-authority-specialist-review.v1';
const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const SHA = /^[a-f0-9]{40}$/;
const PATH = WINDOWS_AUTHORITY_MAILBOX_CADENCE_PATHS_V1[0];
const REVIEWED_IDENTITY = Object.freeze({
  repository: 'Cheekyfellastef/stephan-os',
  prNumber: 2082,
  branch: 'fix/battle-bridge-mailbox-one-minute-cadence-v1',
});
const REVIEWED_BLOB_SHA = '5729ef0d26c966f9fa32fc44cb2bc5626ba835b9';
const text = (value) => String(value ?? '').trim();
const finding = (code, summary = code) => Object.freeze({ severity: 'P0', code, summary, path: PATH });

function blobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function exactEscalation(analysis = {}) {
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  return findings.length === 1
    && text(findings[0]?.severity).toUpperCase() === 'P0'
    && text(findings[0]?.code) === 'unsupported-high-risk-surface'
    && text(findings[0]?.path) === PATH;
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
    && source.size === size
    && size > 0
    && size <= 256 * 1024
    && SHA.test(text(source.blobSha))
    && source.blobSha === blobSha(content)
    && source.blobSha === REVIEWED_BLOB_SHA);
}

function requireLiteral(findings, source, literal, code) {
  if (!source.includes(literal)) findings.push(finding(code));
}

function requirePattern(findings, source, pattern, code) {
  if (!pattern.test(source)) findings.push(finding(code));
}

function forbidPattern(findings, source, pattern, code) {
  if (pattern.test(source)) findings.push(finding(code));
}

function reviewMailboxCadence(source, findings) {
  for (const [literal, code] of [
    ['[CmdletBinding(SupportsShouldProcess = $true)]', 'mailbox-cadence-shouldprocess-missing'],
    ["[switch]$StartNow", 'mailbox-cadence-start-switch-not-fixed'],
    ["$taskName = 'Stephanos Battle Bridge GitHub Command Mailbox'", 'mailbox-cadence-task-not-fixed'],
    ["'Documents\\GitHub\\stephan-os'", 'mailbox-cadence-repository-not-fixed'],
    ["'scripts\\windows\\run-stephanos-scheduled-task-windowless.vbs'", 'mailbox-cadence-launcher-not-fixed'],
    ["'scripts\\battle-bridge-github-command-mailbox-outbox-guard-v1.mjs'", 'mailbox-cadence-runner-not-fixed'],
    ["'scripts\\battle-bridge-github-command-mailbox-with-receipt-index.mjs'", 'mailbox-cadence-child-runner-not-fixed'],
    ["'System32\\wscript.exe'", 'mailbox-cadence-wscript-not-fixed'],
    ["github-command-mailbox", 'mailbox-cadence-launcher-identity-not-fixed'],
    ['$fastIntervalTrigger = New-ScheduledTaskTrigger', 'mailbox-cadence-fast-trigger-missing'],
    ['-At (Get-Date).AddMinutes(1)', 'mailbox-cadence-fast-start-not-fixed'],
    ['-RepetitionInterval (New-TimeSpan -Minutes 1)', 'mailbox-cadence-one-minute-trigger-missing'],
    ['$compatibilityIntervalTrigger = New-ScheduledTaskTrigger', 'mailbox-cadence-compatibility-trigger-missing'],
    ['-At (Get-Date).AddMinutes(5)', 'mailbox-cadence-compatibility-start-not-fixed'],
    ['-RepetitionInterval (New-TimeSpan -Minutes 5)', 'mailbox-cadence-five-minute-fallback-missing'],
    ['-Trigger @($logonTrigger, $fastIntervalTrigger, $compatibilityIntervalTrigger)', 'mailbox-cadence-trigger-estate-not-fixed'],
    ['-LogonType Interactive -RunLevel Limited', 'mailbox-cadence-principal-not-limited'],
    ['-MultipleInstances IgnoreNew', 'mailbox-cadence-overlap-guard-missing'],
    ['-ExecutionTimeLimit (New-TimeSpan -Minutes 15)', 'mailbox-cadence-execution-ceiling-missing'],
    ['intervalMinutes = 5', 'mailbox-cadence-legacy-compatibility-field-missing'],
    ['effectivePollIntervalMinutes = 1', 'mailbox-cadence-effective-field-missing'],
    ['compatibilityIntervalMinutes = 5', 'mailbox-cadence-fallback-field-missing'],
    ["pollStrategy = 'ONE_MINUTE_PRIMARY_FIVE_MINUTE_COMPATIBILITY_FALLBACK'", 'mailbox-cadence-strategy-field-missing'],
    ["multipleInstances = 'IgnoreNew'", 'mailbox-cadence-overlap-receipt-missing'],
    ['executionTimeLimitMinutes = 15', 'mailbox-cadence-execution-receipt-missing'],
    ['receiptIndexEnabled = $true', 'mailbox-cadence-receipt-index-denial-missing'],
    ['outboxGuardEnabled = $true', 'mailbox-cadence-outbox-guard-missing'],
    ['arbitraryShellAllowed = $false', 'mailbox-cadence-shell-denial-missing'],
    ['destructiveGitAllowed = $false', 'mailbox-cadence-git-denial-missing'],
    ['liveOpenClawUpdateAllowed = $false', 'mailbox-cadence-openclaw-denial-missing'],
    ['headlessLauncher = $true', 'mailbox-cadence-headless-proof-missing'],
  ]) requireLiteral(findings, source, literal, code);

  requirePattern(
    findings,
    source,
    /\$actionArguments = "\/\/B \/\/NoLogo `"\$escapedLauncherPath`" github-command-mailbox"[\s\S]*?New-ScheduledTaskAction -Execute \$wscriptExe -Argument \$actionArguments/,
    'mailbox-cadence-action-not-fixed',
  );
  requirePattern(
    findings,
    source,
    /if \(\$PSCmdlet\.ShouldProcess\(\$taskName,[\s\S]*?Register-ScheduledTask[\s\S]*?-TaskName \$taskName[\s\S]*?-Action \$action[\s\S]*?-Trigger @\(\$logonTrigger, \$fastIntervalTrigger, \$compatibilityIntervalTrigger\)[\s\S]*?-Principal \$principal[\s\S]*?-Settings \$settings/,
    'mailbox-cadence-registration-boundary-incomplete',
  );
  requirePattern(
    findings,
    source,
    /if \(\$StartNow\) \{\s*Start-ScheduledTask -TaskName \$taskName\s*\}/,
    'mailbox-cadence-start-boundary-not-fixed',
  );

  const minuteOne = source.match(/-RepetitionInterval \(New-TimeSpan -Minutes 1\)/g) || [];
  const minuteFive = source.match(/-RepetitionInterval \(New-TimeSpan -Minutes 5\)/g) || [];
  if (minuteOne.length !== 1) findings.push(finding('mailbox-cadence-one-minute-trigger-estate-invalid'));
  if (minuteFive.length !== 1) findings.push(finding('mailbox-cadence-five-minute-trigger-estate-invalid'));

  for (const [pattern, code] of [
    [/Invoke-Expression|\biex\b|Start-Process|Invoke-Command|ScriptBlock\s*::\s*Create/i, 'mailbox-cadence-dynamic-execution-forbidden'],
    [/(?:^|\s)-(?:EncodedCommand|Command)\b/im, 'mailbox-cadence-dynamic-powershell-forbidden'],
    [/Restart-Computer|shutdown\.exe|Stop-Process|RunLevel\s+Highest/i, 'mailbox-cadence-host-authority-expanded'],
    [/git(?:\.exe)?\s+(?:push|reset|clean|rebase|checkout|switch|merge|fetch)\b/i, 'mailbox-cadence-git-mutation-forbidden'],
    [/Invoke-WebRequest|Invoke-RestMethod|WebClient|HttpClient|curl|wget/i, 'mailbox-cadence-network-authority-forbidden'],
    [/New-ScheduledTaskAction[\s\S]*?(?:powershell|cmd\.exe)/i, 'mailbox-cadence-task-executable-widened'],
  ]) forbidPattern(findings, source, pattern, code);
}

export function analyzeWindowsAuthorityMailboxCadenceReviewV1(input = {}) {
  const repository = text(input.repository);
  const sourceHead = text(input.sourceHead).toLowerCase();
  const eligible = repository === REVIEWED_IDENTITY.repository
    && Number(input.prNumber) === REVIEWED_IDENTITY.prNumber
    && text(input.branch) === REVIEWED_IDENTITY.branch
    && SHA.test(sourceHead)
    && exactEscalation(input.analysis);

  if (!eligible) {
    return Object.freeze({
      schemaVersion: SCHEMA,
      eligible: false,
      clean: false,
      reviewedPaths: Object.freeze([]),
      findings: Object.freeze([]),
      proofRefs: Object.freeze([]),
      finalVerdict: 'WINDOWS_AUTHORITY_MAILBOX_CADENCE_SPECIALIST_NOT_APPLICABLE',
    });
  }

  const findings = [];
  const sources = Array.isArray(input.sources) ? input.sources : [];
  const source = sources.length === 1 ? sources[0] : null;
  const proofRefs = [];
  if (!exactSource(source, repository, sourceHead)) {
    findings.push(finding('windows-authority-mailbox-cadence-source-evidence-invalid'));
  } else {
    reviewMailboxCadence(source.content, findings);
    proofRefs.push(`proofs/windows-authority-mailbox-cadence/${PATH}@${sourceHead}#${source.blobSha}:${source.size}`);
  }

  const clean = findings.length === 0;
  return Object.freeze({
    schemaVersion: SCHEMA,
    eligible: true,
    clean,
    reviewedPaths: Object.freeze([PATH]),
    findings: Object.freeze(findings),
    proofRefs: Object.freeze(proofRefs),
    finalVerdict: clean
      ? 'WINDOWS_AUTHORITY_MAILBOX_CADENCE_SPECIALIST_CLEAN'
      : 'WINDOWS_AUTHORITY_MAILBOX_CADENCE_SPECIALIST_FINDINGS',
  });
}
