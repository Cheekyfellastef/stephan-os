import { createHash } from 'node:crypto';

export const WINDOWS_AUTHORITY_STEPHANOS_NATIVE_CAPACITY_PUBLISHER_PATHS_V1 = Object.freeze([
  'scripts/windows/install-stephanos-native-capacity-publisher.ps1',
]);

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const EXPECTED_BLOB_SHA = '65253e069c91414bfe24cec8fc0db6ad14d9371c';
const MAX_BYTES = 256 * 1024;
const SHA40 = /^[a-f0-9]{40}$/;

function text(value) {
  return String(value ?? '').trim();
}

function finding(code, summary, path) {
  return Object.freeze({ severity: 'P0', code, summary, path });
}

function gitBlobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`, 'utf8').update(bytes).digest('hex');
}

function exactEscalation(analysis = {}) {
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  const path = WINDOWS_AUTHORITY_STEPHANOS_NATIVE_CAPACITY_PUBLISHER_PATHS_V1[0];
  return findings.length === 1
    && text(findings[0]?.severity).toUpperCase() === 'P0'
    && text(findings[0]?.code) === 'unsupported-high-risk-surface'
    && text(findings[0]?.path) === path
    && Number(analysis?.counts?.P0) === 1
    && Number(analysis?.counts?.P1) === 0
    && Number(analysis?.counts?.P2 ?? 0) === 0;
}

function exactSource(source, sourceHead, path) {
  const content = typeof source?.content === 'string' ? source.content : '';
  const bytes = Buffer.byteLength(content, 'utf8');
  return Boolean(
    source && typeof source === 'object' && !Array.isArray(source)
    && source.schemaVersion === SOURCE_SCHEMA
    && source.repository === REPOSITORY
    && source.path === path
    && source.ref === sourceHead
    && source.exists === true
    && Number.isSafeInteger(source.size)
    && source.size === bytes
    && bytes > 0
    && bytes <= MAX_BYTES
    && SHA40.test(text(source.blobSha))
    && source.blobSha === gitBlobSha(content)
    && source.blobSha === EXPECTED_BLOB_SHA
  );
}

function requireLiteral(findings, source, literal, code, summary, path) {
  if (!source.includes(literal)) findings.push(finding(code, summary, path));
}

function requirePattern(findings, source, pattern, code, summary, path) {
  if (!pattern.test(source)) findings.push(finding(code, summary, path));
}

function forbidPattern(findings, source, pattern, code, summary, path) {
  if (pattern.test(source)) findings.push(finding(code, summary, path));
}

function inspectInstaller(source, path) {
  const findings = [];
  for (const [literal, code, summary] of [
    ["$taskName = 'Stephanos Native Capacity Publisher'", 'native-capacity-task-not-fixed', 'Publisher task identity must remain fixed.'],
    ["$canonicalPowerShell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'", 'native-capacity-powershell-not-fixed', 'Publisher task must use canonical Windows PowerShell.'],
    ["$canonicalNode = 'C:\\Program Files\\nodejs\\node.exe'", 'native-capacity-node-not-fixed', 'Publisher must use canonical Node.'],
    ["$canonicalGit = 'C:\\Program Files\\Git\\cmd\\git.exe'", 'native-capacity-git-not-fixed', 'Publisher source proof must use canonical Git.'],
    ["'Documents\\GitHub\\stephan-os'", 'native-capacity-repository-not-fixed', 'Publisher must remain bound to the canonical checkout.'],
    ["'Documents\\OpenClaw-Standalone\\mission-runner'", 'native-capacity-mission-runner-not-fixed', 'Publisher signing authority must remain bound to the canonical Mission Runner root.'],
    ["'Documents\\Stephanos-openclaw-workspace'", 'native-capacity-workspace-not-fixed', 'Publisher status publication must remain bound to the canonical Shared Workspace.'],
    ["$sourceGateScript = Join-Path $repositoryRoot 'scripts\\stephanos-native-capacity-publisher-source-gate.mjs'", 'native-capacity-source-gate-not-fixed', 'Publisher dirt proof must use the fixed canonical source gate.'],
    ["$env:STEPHANOS_GIT_EXECUTABLE = `$canonicalGit", 'native-capacity-bootstrap-git-env-not-fixed', 'Bootstrap must overwrite Git identity before publisher load.'],
    ["$env:STEPHANOS_MISSION_WORKER_REPOSITORY_ROOT = `$repositoryRoot", 'native-capacity-bootstrap-repository-env-not-fixed', 'Bootstrap must overwrite repository identity before publisher load.'],
    ["$env:STEPHANOS_MISSION_RUNNER_ROOT = $(Quote-Single $missionRunnerRoot)", 'native-capacity-bootstrap-mission-runner-env-not-fixed', 'Bootstrap must overwrite Mission Runner identity before publisher load.'],
    ["$env:STEPHANOS_SHARED_AGENT_WORKSPACE = $(Quote-Single $workspaceRoot)", 'native-capacity-bootstrap-workspace-env-not-fixed', 'Bootstrap must overwrite Shared Workspace identity before publisher load.'],
    ["$action = New-ScheduledTaskAction -Execute $canonicalPowerShell -Argument $arguments -WorkingDirectory $repositoryRoot", 'native-capacity-task-action-not-fixed', 'Scheduled Task action must remain fixed to the guarded encoded bootstrap.'],
    ["$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited", 'native-capacity-principal-widened', 'Publisher task must remain interactive limited privilege.'],
    ["-MultipleInstances IgnoreNew", 'native-capacity-overlap-guard-missing', 'Publisher task must keep IgnoreNew overlap protection.'],
    ["Register-ScheduledTask -TaskName $taskName -InputObject $task -Force | Out-Null", 'native-capacity-registration-not-fixed', 'Only the fixed publisher task may be registered.'],
    ["if ($StartNow) { Start-ScheduledTask -TaskName $taskName }", 'native-capacity-start-not-fixed', 'Optional immediate start must target only the fixed publisher task.'],
    ["canonicalDirtPolicyRequired = $true", 'native-capacity-dirt-policy-proof-missing', 'Publisher install receipt must record canonical dirt-policy enforcement.'],
    ["mergeAuthority = $false", 'native-capacity-merge-authority-widened', 'Publisher installer must not gain merge authority.'],
    ["leaseSeizureAllowed = $false", 'native-capacity-lease-authority-widened', 'Publisher installer must not gain lease-seizure authority.'],
    ["arbitraryCommandAllowed = $false", 'native-capacity-command-authority-widened', 'Publisher installer must not gain arbitrary-command authority.'],
    ["sourceValidatedBeforePublisherLoad = $true", 'native-capacity-source-validation-proof-missing', 'Publisher install receipt must record source validation before publisher load.'],
  ]) requireLiteral(findings, source, literal, code, summary, path);

  requirePattern(findings, source, /\$branch\s*=\s*\(&\s*\$canonicalGit\s+-C\s+\$repositoryRoot\s+branch\s+--show-current\)\.Trim\(\)[\s\S]{0,220}\$branch\s+-ne\s+'main'/i, 'native-capacity-main-branch-proof-missing', 'Installer must prove canonical main before task registration.', path);
  requirePattern(findings, source, /\$headSha\s*=\s*\(&\s*\$canonicalGit\s+-C\s+\$repositoryRoot\s+rev-parse\s+HEAD\)\.Trim\(\)\.ToLowerInvariant\(\)/i, 'native-capacity-head-proof-missing', 'Installer must prove one exact source head.', path);
  requirePattern(findings, source, /\$sourceGateReceipt\s*=\s*\(&\s*\$canonicalNode\s+\$sourceGateScript\s*\|\s*Select-Object\s+-Last\s+1\)[\s\S]{0,900}STEPHANOS_NATIVE_PUBLISHER_SOURCE_GATE_PASS[\s\S]{0,900}dirtSummary\.blocksSync/i, 'native-capacity-canonical-dirt-proof-missing', 'Installer must require a passing canonical dirt-policy receipt before task registration.', path);
  requirePattern(findings, source, /`\$branch\s*=\s*\(&\s*`\$canonicalGit\s+-C\s+`\$repositoryRoot\s+branch\s+--show-current\)[\s\S]{0,500}exit\s+75/i, 'native-capacity-bootstrap-main-recheck-missing', 'Scheduled bootstrap must re-prove main and fail closed before publisher load.', path);
  requirePattern(findings, source, /`\$head\s*=\s*\(&\s*`\$canonicalGit\s+-C\s+`\$repositoryRoot\s+rev-parse\s+HEAD\)[\s\S]{0,500}exit\s+75/i, 'native-capacity-bootstrap-head-recheck-missing', 'Scheduled bootstrap must re-prove exact head before publisher load.', path);
  requirePattern(findings, source, /`\$sourceGateReceipt\s*=\s*\(&\s*`\$canonicalNode\s+`\$sourceGateScript\s*\|\s*Select-Object\s+-Last\s+1\)[\s\S]{0,1200}STEPHANOS_NATIVE_PUBLISHER_SOURCE_GATE_PASS[\s\S]{0,1200}exit\s+75/i, 'native-capacity-bootstrap-canonical-dirt-recheck-missing', 'Scheduled bootstrap must re-run the canonical dirt policy and fail closed before publisher load.', path);
  requirePattern(findings, source, /&\s*`\$canonicalNode\s+`\$publisherScript[\s\S]{0,80}exit\s+`\$LASTEXITCODE/i, 'native-capacity-publisher-launch-not-fixed', 'Bootstrap may launch only canonical Node with the fixed publisher script.', path);
  requirePattern(findings, source, /Get-ScheduledTask\s+-TaskName\s+\$taskName[\s\S]{0,900}registeredAction\.Execute[\s\S]{0,900}registeredAction\.Arguments[\s\S]{0,900}registeredAction\.WorkingDirectory/i, 'native-capacity-task-revalidation-missing', 'Installer must revalidate the registered task action identity.', path);

  const parameterBlock = source.slice(0, Math.max(0, source.indexOf("$ErrorActionPreference")));
  forbidPattern(findings, parameterBlock, /\$(?:TaskName|Executable|Command|CommandLine|Arguments|Url|Uri|Token|Credential)\b/i, 'native-capacity-caller-authority-forbidden', 'Caller-selected task, executable, command, network or credential authority is forbidden.', path);
  forbidPattern(findings, source, /Invoke-Expression|\biex\b|\bStart-Process\b|\bStop-Process\b|\btaskkill(?:\.exe)?\b|cmd(?:\.exe)?\s+\/c|powershell(?:\.exe)?\s+-command|-Verb\s+RunAs/i, 'native-capacity-generic-execution-forbidden', 'Generic shell/process/elevation authority is forbidden.', path);
  forbidPattern(findings, source, /git(?:\.exe)?\s+(?:push|reset|clean|rebase|checkout|switch|merge|stash|commit)\b/i, 'native-capacity-git-mutation-forbidden', 'Publisher installer may observe Git identity only and must not mutate source.', path);
  forbidPattern(findings, source, /Invoke-WebRequest|Invoke-RestMethod|curl(?:\.exe)?|wget(?:\.exe)?/i, 'native-capacity-network-authority-forbidden', 'Installer must not gain independent network/download authority.', path);
  forbidPattern(findings, source, /Unregister-ScheduledTask|Disable-ScheduledTask|Stop-ScheduledTask/i, 'native-capacity-task-destruction-forbidden', 'Installer must not gain task destruction authority.', path);

  return findings;
}

export function analyzeWindowsAuthorityStephanosNativeCapacityPublisherReviewV1(input = {}) {
  const sourceHead = text(input.sourceHead).toLowerCase();
  const path = WINDOWS_AUTHORITY_STEPHANOS_NATIVE_CAPACITY_PUBLISHER_PATHS_V1[0];
  const eligible = input.repository === REPOSITORY
    && SHA40.test(sourceHead)
    && exactEscalation(input.analysis);

  if (!eligible) {
    return Object.freeze({
      eligible: false,
      clean: false,
      reviewedPaths: Object.freeze([]),
      findings: Object.freeze([]),
      proofRefs: Object.freeze([]),
      finalVerdict: 'WINDOWS_AUTHORITY_STEPHANOS_NATIVE_CAPACITY_PUBLISHER_NOT_ELIGIBLE',
    });
  }

  const sources = Array.isArray(input.sources) ? input.sources : [];
  const candidates = sources.filter((source) => text(source?.path) === path);
  const findings = [];
  const proofRefs = [];

  if (sources.length !== 1 || candidates.length !== 1 || !exactSource(candidates[0], sourceHead, path)) {
    findings.push(finding('windows-authority-source-evidence-invalid', 'Exactly one immutable exact-head native capacity publisher installer source record is required.', path));
  } else {
    findings.push(...inspectInstaller(candidates[0].content, path));
    proofRefs.push(`proofs/windows-authority/native-capacity-publisher/${path}@${sourceHead}#${EXPECTED_BLOB_SHA}:${candidates[0].size}`);
  }

  const clean = findings.length === 0;
  return Object.freeze({
    eligible: true,
    clean,
    reviewedPaths: Object.freeze([path]),
    findings: Object.freeze(findings),
    proofRefs: Object.freeze(proofRefs),
    sourceMutationAllowed: false,
    mergeAuthority: false,
    runtimeMutationAllowed: false,
    providerQualificationAuthority: false,
    finalVerdict: clean
      ? 'WINDOWS_AUTHORITY_STEPHANOS_NATIVE_CAPACITY_PUBLISHER_CLEAN'
      : 'WINDOWS_AUTHORITY_STEPHANOS_NATIVE_CAPACITY_PUBLISHER_FINDINGS',
  });
}
