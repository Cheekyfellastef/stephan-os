import { createHash } from 'node:crypto';

import {
  analyzeWindowsAuthorityRecoveryMeshGuardianReview,
} from './windowsAuthorityRecoveryMeshGuardianReviewV1.mjs';

export const WINDOWS_AUTHORITY_MAILBOX_ROLLOVER_PATHS_V1 = Object.freeze([
  'scripts/windows/install-battle-bridge-github-command-mailbox.ps1',
  'scripts/windows/request-battle-bridge-recovery.ps1',
]);

const SCHEMA = 'stephanos.windows-authority-specialist-review.v1';
const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const SHA = /^[a-f0-9]{40}$/;
const TARGET = Object.freeze({
  repository: 'Cheekyfellastef/stephan-os',
  prNumber: 2164,
  branch: 'fix/canonical-mailbox-rollover-2158-v1',
});
const INSTALLER_PATH = WINDOWS_AUTHORITY_MAILBOX_ROLLOVER_PATHS_V1[0];
const RECOVERY_PATH = WINDOWS_AUTHORITY_MAILBOX_ROLLOVER_PATHS_V1[1];
const TARGET_BLOBS = Object.freeze({
  [INSTALLER_PATH]: '91a1ee081465236dc2bf509c4ccff1836eab5cd4',
  [RECOVERY_PATH]: '4a9318654405855cba5b1e15aaf2e4a587530f7f',
});

const text = (value) => String(value ?? '').trim();
const finding = (code, path, summary = code) => Object.freeze({
  severity: 'P0',
  code,
  summary,
  path,
});

function blobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`, 'utf8').update(bytes).digest('hex');
}

function exactUnsupportedPair(analysis = {}) {
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  if (findings.length !== WINDOWS_AUTHORITY_MAILBOX_ROLLOVER_PATHS_V1.length) return false;
  const paths = findings.map((item) => text(item?.path)).sort();
  return findings.every((item) => (
    text(item?.severity).toUpperCase() === 'P0'
    && text(item?.code) === 'unsupported-high-risk-surface'
  )) && JSON.stringify(paths) === JSON.stringify([...WINDOWS_AUTHORITY_MAILBOX_ROLLOVER_PATHS_V1].sort());
}

function exactTargetSource(source, repository, sourceHead, path) {
  const content = typeof source?.content === 'string' ? source.content : '';
  const size = Buffer.byteLength(content, 'utf8');
  return Boolean(source && typeof source === 'object' && !Array.isArray(source)
    && source.schemaVersion === SOURCE_SCHEMA
    && source.repository === repository
    && source.path === path
    && source.ref === sourceHead
    && source.exists === true
    && Number.isSafeInteger(source.size)
    && source.size === size
    && size > 0
    && size <= 256 * 1024
    && SHA.test(text(source.blobSha))
    && source.blobSha === blobSha(content)
    && source.blobSha === TARGET_BLOBS[path]);
}

function requireLiteral(findings, source, path, literal, code) {
  if (!source.includes(literal)) findings.push(finding(code, path));
}

function requirePattern(findings, source, path, pattern, code) {
  if (!pattern.test(source)) findings.push(finding(code, path));
}

function forbidPattern(findings, source, path, pattern, code) {
  if (pattern.test(source)) findings.push(finding(code, path));
}

function reviewMailboxInstaller(source, findings) {
  const path = INSTALLER_PATH;
  for (const [literal, code] of [
    ['[CmdletBinding(SupportsShouldProcess = $true)]', 'mailbox-rollover-shouldprocess-missing'],
    ['[switch]$StartNow', 'mailbox-rollover-start-switch-not-fixed'],
    ["$taskName = 'Stephanos Battle Bridge GitHub Command Mailbox'", 'mailbox-rollover-task-not-fixed'],
    ["'Documents\\GitHub\\stephan-os'", 'mailbox-rollover-repository-not-fixed'],
    ["'scripts\\windows\\run-stephanos-scheduled-task-windowless.vbs'", 'mailbox-rollover-launcher-not-fixed'],
    ["'scripts\\battle-bridge-github-command-mailbox-outbox-guard-v1.mjs'", 'mailbox-rollover-runner-not-fixed'],
    ["'scripts\\battle-bridge-github-command-mailbox-with-receipt-index.mjs'", 'mailbox-rollover-child-runner-not-fixed'],
    ["'System32\\wscript.exe'", 'mailbox-rollover-wscript-not-fixed'],
    ['-RepetitionInterval (New-TimeSpan -Minutes 1)', 'mailbox-rollover-one-minute-trigger-missing'],
    ['-RepetitionInterval (New-TimeSpan -Minutes 5)', 'mailbox-rollover-five-minute-fallback-missing'],
    ['-Trigger @($logonTrigger, $fastIntervalTrigger, $compatibilityIntervalTrigger)', 'mailbox-rollover-trigger-estate-not-fixed'],
    ['-LogonType Interactive -RunLevel Limited', 'mailbox-rollover-principal-not-limited'],
    ['-MultipleInstances IgnoreNew', 'mailbox-rollover-overlap-guard-missing'],
    ['-ExecutionTimeLimit (New-TimeSpan -Minutes 15)', 'mailbox-rollover-execution-ceiling-missing'],
    ['canonical mailbox authority issue', 'mailbox-rollover-authority-description-not-canonical'],
    ['effectivePollIntervalMinutes = 1', 'mailbox-rollover-effective-field-missing'],
    ['compatibilityIntervalMinutes = 5', 'mailbox-rollover-fallback-field-missing'],
    ["pollStrategy = 'ONE_MINUTE_PRIMARY_FIVE_MINUTE_COMPATIBILITY_FALLBACK'", 'mailbox-rollover-strategy-field-missing'],
    ['receiptIndexEnabled = $true', 'mailbox-rollover-receipt-index-missing'],
    ['outboxGuardEnabled = $true', 'mailbox-rollover-outbox-guard-missing'],
    ['arbitraryShellAllowed = $false', 'mailbox-rollover-shell-denial-missing'],
    ['destructiveGitAllowed = $false', 'mailbox-rollover-git-denial-missing'],
    ['liveOpenClawUpdateAllowed = $false', 'mailbox-rollover-openclaw-denial-missing'],
  ]) requireLiteral(findings, source, path, literal, code);

  requirePattern(
    findings,
    source,
    path,
    /\$actionArguments = "\/\/B \/\/NoLogo `"\$escapedLauncherPath`" github-command-mailbox"[\s\S]*?New-ScheduledTaskAction -Execute \$wscriptExe -Argument \$actionArguments/,
    'mailbox-rollover-action-not-fixed',
  );
  requirePattern(
    findings,
    source,
    path,
    /if \(\$StartNow\) \{\s*Start-ScheduledTask -TaskName \$taskName\s*\}/,
    'mailbox-rollover-start-boundary-not-fixed',
  );

  const oneMinute = source.match(/-RepetitionInterval \(New-TimeSpan -Minutes 1\)/g) || [];
  const fiveMinute = source.match(/-RepetitionInterval \(New-TimeSpan -Minutes 5\)/g) || [];
  if (oneMinute.length !== 1) findings.push(finding('mailbox-rollover-one-minute-trigger-estate-invalid', path));
  if (fiveMinute.length !== 1) findings.push(finding('mailbox-rollover-five-minute-trigger-estate-invalid', path));

  for (const [pattern, code] of [
    [/Invoke-Expression|\biex\b|Start-Process|Invoke-Command|ScriptBlock\s*::\s*Create/i, 'mailbox-rollover-dynamic-execution-forbidden'],
    [/(?:^|\s)-(?:EncodedCommand|Command)\b/im, 'mailbox-rollover-dynamic-powershell-forbidden'],
    [/Restart-Computer|shutdown\.exe|Stop-Process|RunLevel\s+Highest/i, 'mailbox-rollover-host-authority-expanded'],
    [/git(?:\.exe)?\s+(?:push|reset|clean|rebase|checkout|switch|merge|fetch)\b/i, 'mailbox-rollover-git-mutation-forbidden'],
    [/Invoke-WebRequest|Invoke-RestMethod|WebClient|HttpClient|curl|wget/i, 'mailbox-rollover-network-authority-forbidden'],
    [/New-ScheduledTaskAction[\s\S]*?(?:powershell|cmd\.exe)/i, 'mailbox-rollover-task-executable-widened'],
  ]) forbidPattern(findings, source, path, pattern, code);
}

function onePathAnalysis(original = {}, path) {
  const item = (Array.isArray(original?.findings) ? original.findings : [])
    .find((candidate) => text(candidate?.path) === path);
  return Object.freeze({
    ...original,
    findings: Object.freeze(item ? [item] : []),
  });
}

export function analyzeWindowsAuthorityMailboxRolloverReviewV1(input = {}) {
  const repository = text(input.repository);
  const sourceHead = text(input.sourceHead).toLowerCase();
  const eligible = repository === TARGET.repository
    && Number(input.prNumber) === TARGET.prNumber
    && text(input.branch) === TARGET.branch
    && SHA.test(sourceHead)
    && exactUnsupportedPair(input.analysis);

  if (!eligible) {
    return Object.freeze({
      schemaVersion: SCHEMA,
      eligible: false,
      clean: false,
      reviewedPaths: Object.freeze([]),
      findings: Object.freeze([]),
      proofRefs: Object.freeze([]),
      finalVerdict: 'WINDOWS_AUTHORITY_MAILBOX_ROLLOVER_SPECIALIST_NOT_APPLICABLE',
    });
  }

  const sources = Array.isArray(input.sources) ? input.sources : [];
  const findings = [];
  const proofRefs = [];
  const sourceByPath = new Map();

  if (sources.length !== WINDOWS_AUTHORITY_MAILBOX_ROLLOVER_PATHS_V1.length) {
    findings.push(finding('windows-authority-mailbox-rollover-source-estate-invalid', INSTALLER_PATH));
  } else {
    for (const path of WINDOWS_AUTHORITY_MAILBOX_ROLLOVER_PATHS_V1) {
      const candidates = sources.filter((source) => text(source?.path) === path);
      if (candidates.length !== 1 || !exactTargetSource(candidates[0], repository, sourceHead, path)) {
        findings.push(finding('windows-authority-mailbox-rollover-source-evidence-invalid', path));
      } else {
        sourceByPath.set(path, candidates[0]);
        proofRefs.push(`proofs/windows-authority-mailbox-rollover/${path}@${sourceHead}#${candidates[0].blobSha}:${candidates[0].size}`);
      }
    }
  }

  const installer = sourceByPath.get(INSTALLER_PATH);
  if (installer) reviewMailboxInstaller(installer.content, findings);

  const recovery = sourceByPath.get(RECOVERY_PATH);
  if (recovery) {
    const recoveryResult = analyzeWindowsAuthorityRecoveryMeshGuardianReview({
      ...input,
      analysis: onePathAnalysis(input.analysis, RECOVERY_PATH),
      sources: [recovery],
    });
    if (!recoveryResult.eligible || !recoveryResult.clean) {
      const childFindings = Array.isArray(recoveryResult.findings) ? recoveryResult.findings : [];
      if (childFindings.length > 0) findings.push(...childFindings);
      else findings.push(finding('windows-authority-mailbox-rollover-recovery-specialist-not-clean', RECOVERY_PATH));
    } else {
      proofRefs.push(...(Array.isArray(recoveryResult.proofRefs) ? recoveryResult.proofRefs : []));
    }
  }

  const clean = findings.length === 0;
  return Object.freeze({
    schemaVersion: SCHEMA,
    eligible: true,
    clean,
    reviewedPaths: Object.freeze([...WINDOWS_AUTHORITY_MAILBOX_ROLLOVER_PATHS_V1]),
    findings: Object.freeze(findings),
    proofRefs: Object.freeze([...new Set(proofRefs)]),
    finalVerdict: clean
      ? 'WINDOWS_AUTHORITY_MAILBOX_ROLLOVER_SPECIALIST_CLEAN'
      : 'WINDOWS_AUTHORITY_MAILBOX_ROLLOVER_SPECIALIST_FINDINGS',
  });
}
