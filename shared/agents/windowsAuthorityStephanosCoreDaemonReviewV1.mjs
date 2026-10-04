import { createHash } from 'node:crypto';

export const WINDOWS_AUTHORITY_STEPHANOS_CORE_DAEMON_PATHS_V1 = Object.freeze([
  'scripts/windows/run-sovereign-commander-hidden.ps1',
  'scripts/windows/status-stephanos-core-daemon.ps1',
]);

const SCHEMA = 'stephanos.windows-authority-specialist-review.v1';
const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const SHA = /^[a-f0-9]{40}$/;
const REPOSITORY = 'Cheekyfellastef/stephan-os';

const text = (value) => String(value ?? '').trim();
const finding = (code, path, summary = code) => Object.freeze({
  severity: 'P0',
  code,
  summary,
  path,
});

function blobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
}

function exactSource(source, repository, head, path) {
  const content = typeof source?.content === 'string' ? source.content : '';
  const size = Buffer.byteLength(content, 'utf8');
  return Boolean(
    source
    && typeof source === 'object'
    && !Array.isArray(source)
    && source.schemaVersion === SOURCE_SCHEMA
    && source.repository === repository
    && source.path === path
    && source.ref === head
    && source.exists === true
    && Number.isSafeInteger(source.size)
    && source.size === size
    && size > 0
    && size <= 256 * 1024
    && SHA.test(text(source.blobSha))
    && source.blobSha === blobSha(content)
  );
}

function exactEscalation(analysis = {}) {
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  if (findings.length !== WINDOWS_AUTHORITY_STEPHANOS_CORE_DAEMON_PATHS_V1.length) return false;
  const observed = findings.map((item) => text(item?.path));
  const expected = new Set(WINDOWS_AUTHORITY_STEPHANOS_CORE_DAEMON_PATHS_V1);
  return new Set(observed).size === expected.size
    && observed.every((path) => expected.has(path))
    && findings.every((item) => (
      text(item?.severity).toUpperCase() === 'P0'
      && text(item?.code) === 'unsupported-high-risk-surface'
    ));
}

function requireLiteral(findings, source, literal, code, path) {
  if (!source.includes(literal)) findings.push(finding(code, path));
}

function requirePattern(findings, source, pattern, code, path) {
  if (!pattern.test(source)) findings.push(finding(code, path));
}

function forbidPattern(findings, source, pattern, code, path) {
  if (pattern.test(source)) findings.push(finding(code, path));
}

function reviewRunner(source, path, findings) {
  for (const [literal, code] of [
    ["$canonicalNode = 'C:\\Program Files\\nodejs\\node.exe'", 'core-daemon-runner-node-not-fixed'],
    ["$coreDaemonScript = Join-Path $repoRoot 'scripts\\stephanos-core-daemon.mjs'", 'core-daemon-runner-script-not-fixed'],
    ["$coreDaemonStatusPath = Join-Path $env:USERPROFILE 'Documents\\Stephanos-openclaw-workspace\\status\\stephanos-core-daemon-current.json'", 'core-daemon-runner-status-path-not-fixed'],
    ['$coreDaemonScriptPattern = [regex]::Escape($coreDaemonScript)', 'core-daemon-runner-process-pattern-not-fixed'],
    ["$coreDaemonBlocker = 'SOVEREIGN_COMMANDER_CORE_DAEMON_SCRIPT_MISSING'", 'core-daemon-runner-missing-script-blocker-absent'],
    ["$coreDaemonBlocker = 'SOVEREIGN_COMMANDER_CORE_DAEMON_NODE_MISSING'", 'core-daemon-runner-missing-node-blocker-absent'],
    ['$coreDaemonRestartRequested = $true', 'core-daemon-runner-stale-recycle-marker-absent'],
    ['Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction Stop', 'core-daemon-runner-bounded-stop-absent'],
    ['$coreDaemonStartRequested = $true', 'core-daemon-runner-start-marker-absent'],
    ['Start-Process -FilePath $canonicalNode -ArgumentList @($quotedCoreDaemonScript) -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru', 'core-daemon-runner-fixed-start-absent'],
    ["$coreDaemonBlocker = 'SOVEREIGN_COMMANDER_CORE_DAEMON_NOT_HEALTHY'", 'core-daemon-runner-health-blocker-absent'],
    ['coreDaemonHealthy = [bool]$coreDaemonOk', 'core-daemon-runner-health-receipt-absent'],
    ['sourceMutationDelegatedToMissionWorker = $true', 'core-daemon-runner-mission-worker-boundary-absent'],
    ['duplicateSchedulerAllowed = $false', 'core-daemon-runner-duplicate-scheduler-denial-absent'],
    ['duplicateLeaseAllowed = $false', 'core-daemon-runner-duplicate-lease-denial-absent'],
    ['arbitraryExecutableAllowed = $false', 'core-daemon-runner-executable-denial-absent'],
    ['arbitraryShellAllowed = $false', 'core-daemon-runner-shell-denial-absent'],
    ['unrelatedProcessRestartAllowed = $false', 'core-daemon-runner-unrelated-restart-denial-absent'],
    ['pcRestartAllowed = $false', 'core-daemon-runner-pc-restart-denial-absent'],
  ]) requireLiteral(findings, source, literal, code, path);

  requirePattern(findings, source,
    /function\s+Get-StephanosCoreDaemonProcesses[\s\S]*\.Name\s+-eq\s+'node\.exe'[\s\S]*CommandLine\s+-match\s+\$coreDaemonScriptPattern/,
    'core-daemon-runner-process-identity-not-bounded', path);
  requirePattern(findings, source,
    /if \(\$coreBefore\.Count -eq 0 -or -not \[bool\]\$coreHealthBefore\.healthy\)[\s\S]*if \(\$coreBefore\.Count -gt 0\)[\s\S]*Stop-Process -Id \(\[int\]\$process\.ProcessId\) -Force/,
    'core-daemon-runner-recycle-not-health-gated', path);

  const startLines = source.split(/\r?\n/).filter((line) => /\bStart-Process\b/.test(line));
  if (startLines.length !== 3) findings.push(finding('core-daemon-runner-process-start-estate-widened', path));
  if (startLines.some((line) => !line.includes('-FilePath $canonicalNode') && !line.includes('-FilePath $powershellExecutable'))) {
    findings.push(finding('core-daemon-runner-process-executable-widened', path));
  }

  for (const [pattern, code] of [
    [/Stop-Process\s+-Name/i, 'core-daemon-runner-name-based-kill-forbidden'],
    [/Invoke-Expression|\biex\b|cmd\.exe|Restart-Computer|shutdown\.exe/i, 'core-daemon-runner-dynamic-or-pc-authority-forbidden'],
    [/\b(?:Register|New|Start)-ScheduledTask(?:Action|Trigger|Principal|SettingsSet)?\b/i, 'core-daemon-runner-task-mutation-forbidden'],
    [/\bgit(?:\.exe)?\s+(?:push|reset|clean|rebase|checkout|switch|merge|stash)\b/i, 'core-daemon-runner-git-mutation-forbidden'],
    [/\$env:[A-Z0-9_]+_COMMAND\b/i, 'core-daemon-runner-command-env-forbidden'],
    [/\[(?:string|object)\]\s*\$(?:CoreDaemonScript|CoreDaemonStatusPath|Executable|Command|Arguments)\b/i, 'core-daemon-runner-caller-authority-forbidden'],
  ]) forbidPattern(findings, source, pattern, code, path);
}

function reviewStatus(source, path, findings) {
  for (const [literal, code] of [
    ['[CmdletBinding()]\nparam()', 'core-daemon-status-parameterless-contract-absent'],
    ["$coreScript = Join-Path $repoRoot 'scripts\\stephanos-core-daemon.mjs'", 'core-daemon-status-script-not-fixed'],
    ["$statusPath = Join-Path $env:USERPROFILE 'Documents\\Stephanos-openclaw-workspace\\status\\stephanos-core-daemon-current.json'", 'core-daemon-status-path-not-fixed'],
    ['$corePattern = [regex]::Escape($coreScript)', 'core-daemon-status-process-pattern-not-fixed'],
    ['Get-CimInstance Win32_Process -ErrorAction SilentlyContinue', 'core-daemon-status-process-read-absent'],
    ["$_.Name -eq 'node.exe'", 'core-daemon-status-node-identity-absent'],
    ['[string]$_.CommandLine -match $corePattern', 'core-daemon-status-command-identity-absent'],
    ['Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json', 'core-daemon-status-fixed-read-absent'],
    ["schemaVersion = 'stephanos.core-daemon-status.v1'", 'core-daemon-status-schema-absent'],
    ['uiRequired = $false', 'core-daemon-status-ui-independence-absent'],
    ['sourceMutationAllowed = $false', 'core-daemon-status-source-denial-absent'],
    ['schedulerAuthority = $false', 'core-daemon-status-scheduler-denial-absent'],
    ['mergeAuthority = $false', 'core-daemon-status-merge-denial-absent'],
    ['vendorMeterRequired = $false', 'core-daemon-status-meter-denial-absent'],
    ['remoteCommanderRequired = $false', 'core-daemon-status-remote-commander-denial-absent'],
    ['ConvertTo-Json -Depth 4', 'core-daemon-status-json-output-absent'],
  ]) requireLiteral(findings, source, literal, code, path);

  for (const [pattern, code] of [
    [/\bStart-Process\b|\bStop-Process\b/i, 'core-daemon-status-process-mutation-forbidden'],
    [/\b(?:Register|New|Start|Stop|Unregister)-ScheduledTask(?:Action|Trigger|Principal|SettingsSet)?\b/i, 'core-daemon-status-task-mutation-forbidden'],
    [/Invoke-Expression|\biex\b|cmd\.exe|Restart-Computer|shutdown\.exe/i, 'core-daemon-status-dynamic-or-pc-authority-forbidden'],
    [/\b(?:Set-Content|Add-Content|Out-File|Remove-Item|Move-Item|Copy-Item|New-Item)\b/i, 'core-daemon-status-filesystem-mutation-forbidden'],
    [/Invoke-RestMethod|Invoke-WebRequest|System\.Net\.Http/i, 'core-daemon-status-network-authority-forbidden'],
    [/\bgit(?:\.exe)?\b/i, 'core-daemon-status-git-authority-forbidden'],
    [/(^|\r?\n)\s*exit\s+[1-9]\d*\b/im, 'core-daemon-status-failing-diagnostic-forbidden'],
  ]) forbidPattern(findings, source, pattern, code, path);
}

export function analyzeWindowsAuthorityStephanosCoreDaemonReviewV1(input = {}) {
  const repository = text(input.repository);
  const sourceHead = text(input.sourceHead).toLowerCase();
  if (repository !== REPOSITORY || !SHA.test(sourceHead) || !exactEscalation(input.analysis)) {
    return Object.freeze({
      schemaVersion: SCHEMA,
      eligible: false,
      clean: false,
      reviewedPaths: Object.freeze([]),
      findings: Object.freeze([]),
      proofRefs: Object.freeze([]),
      sourceMutationAllowed: false,
      mergeAuthority: false,
      runtimeMutationAllowed: false,
      providerQualificationAuthority: false,
      finalVerdict: 'WINDOWS_AUTHORITY_SPECIALIST_NOT_APPLICABLE',
    });
  }

  const sources = Array.isArray(input.sources) ? input.sources : [];
  const findings = [];
  const proofRefs = [];
  for (const path of WINDOWS_AUTHORITY_STEPHANOS_CORE_DAEMON_PATHS_V1) {
    const candidates = sources.filter((source) => text(source?.path) === path);
    if (candidates.length !== 1 || !exactSource(candidates[0], repository, sourceHead, path)) {
      findings.push(finding('windows-authority-source-evidence-invalid', path));
      continue;
    }
    if (path.endsWith('status-stephanos-core-daemon.ps1')) reviewStatus(candidates[0].content, path, findings);
    else reviewRunner(candidates[0].content, path, findings);
    proofRefs.push('proofs/windows-authority-stephanos-core-daemon/' + path + '@' + sourceHead + '#' + candidates[0].blobSha + ':' + candidates[0].size);
  }
  if (sources.length !== WINDOWS_AUTHORITY_STEPHANOS_CORE_DAEMON_PATHS_V1.length) {
    findings.push(finding('windows-authority-source-estate-widened', ''));
  }

  const clean = findings.length === 0;
  return Object.freeze({
    schemaVersion: SCHEMA,
    eligible: true,
    clean,
    reviewedPaths: WINDOWS_AUTHORITY_STEPHANOS_CORE_DAEMON_PATHS_V1,
    findings: Object.freeze(findings),
    proofRefs: Object.freeze(proofRefs),
    sourceMutationAllowed: false,
    mergeAuthority: false,
    runtimeMutationAllowed: false,
    providerQualificationAuthority: false,
    finalVerdict: clean
      ? 'WINDOWS_AUTHORITY_STEPHANOS_CORE_DAEMON_SPECIALIST_CLEAN'
      : 'WINDOWS_AUTHORITY_STEPHANOS_CORE_DAEMON_SPECIALIST_FINDINGS',
  });
}
