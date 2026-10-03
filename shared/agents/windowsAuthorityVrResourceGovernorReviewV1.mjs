import { createHash } from 'node:crypto';

export const WINDOWS_AUTHORITY_VR_RESOURCE_GOVERNOR_PATHS_V1 = Object.freeze([
  'scripts/windows/run-vr-resource-governor.ps1',
]);

const SCHEMA = 'stephanos.windows-authority-specialist-review.v1';
const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const SHA = /^[a-f0-9]{40}$/;
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const PATH = WINDOWS_AUTHORITY_VR_RESOURCE_GOVERNOR_PATHS_V1[0];

const text = (value) => String(value ?? '').trim();
const finding = (code, summary = code) => Object.freeze({
  severity: 'P0',
  code,
  summary,
  path: PATH,
});

function blobSha(source) {
  const bytes = Buffer.from(source, 'utf8');
  return createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
}

function exactEscalation(analysis = {}) {
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  return findings.length === 1
    && text(findings[0]?.severity).toUpperCase() === 'P0'
    && text(findings[0]?.code) === 'unsupported-high-risk-surface'
    && text(findings[0]?.path) === PATH;
}

function exactSource(source, repository, head) {
  const body = typeof source?.content === 'string' ? source.content : '';
  const size = Buffer.byteLength(body, 'utf8');
  return Boolean(
    source
    && typeof source === 'object'
    && !Array.isArray(source)
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
    && source.blobSha === blobSha(body)
  );
}

function requireLiteral(findings, source, literal, code, summary) {
  if (!source.includes(literal)) findings.push(finding(code, summary));
}

function requirePattern(findings, source, pattern, code, summary) {
  if (!pattern.test(source)) findings.push(finding(code, summary));
}

function forbidPattern(findings, source, pattern, code, summary) {
  if (pattern.test(source)) findings.push(finding(code, summary));
}

function parameterPrefix(source) {
  const end = source.indexOf('Set-StrictMode');
  return end >= 0 ? source.slice(0, end) : source.slice(0, 2500);
}

function reviewGovernor(source, findings) {
  for (const [literal, code, summary] of [
    ["[ValidateSet('Watch','Reconcile','Status','PrepareGaming','CancelPrepare','SetAuto','ForceOn','ForceOff')][string]$Action = 'Watch'", 'vr-governor-action-estate-widened', 'Governor actions must remain the fixed eight-value control surface.'],
    ["$workspaceRoot = Join-Path $env:USERPROFILE 'Documents\\Stephanos-openclaw-workspace'", 'vr-governor-workspace-root-not-fixed', 'Governor state must remain inside the fixed Stephanos workspace.'],
    ["$statePath = Join-Path $stateRoot 'vr-resource-governor-current.json'", 'vr-governor-state-path-not-fixed', 'Canonical governor state path must remain fixed.'],
    ["$overridePath = Join-Path $stateRoot 'gaming-resource-override.json'", 'vr-governor-override-path-not-fixed', 'Gaming override state path must remain fixed.'],
    ["$preparePath = Join-Path $stateRoot 'gaming-resource-prepare.json'", 'vr-governor-prepare-path-not-fixed', 'Prepare lease path must remain fixed.'],
    ["$profilesPath = Join-Path $stateRoot 'gaming-resource-profiles.json'", 'vr-governor-profiles-path-not-fixed', 'Gaming profile path must remain fixed.'],
    ["$telemetryPath = Join-Path $stateRoot 'gaming-resource-governor-events.jsonl'", 'vr-governor-telemetry-path-not-fixed', 'Governor telemetry path must remain fixed.'],
    ["$lightweightModel = 'llama3.2:3b'", 'vr-governor-lightweight-identity-not-fixed', 'The lightweight fallback identity must remain explicit.'],
    ["foreach ($name in @('OculusDash', 'vrcompositor', 'vrdashboard'))", 'vr-governor-vr-runtime-signal-estate-widened', 'VR runtime detection must remain a closed process-name set.'],
    ["$name = 'vr-maximum'", 'vr-governor-vr-profile-missing', 'VR maximum profile must remain explicit.'],
    ["$parkAllModels = $true", 'vr-governor-park-all-contract-missing', 'VR maximum must retain park-all-models behavior.'],
    ["if ($RequestedProfileName -eq 'vr-maximum')", 'vr-governor-explicit-vr-profile-gate-missing', 'Explicit VR preparation must remain a dedicated profile gate.'],
    ["function Get-LoadedOllamaModels", 'vr-governor-loaded-model-enumerator-missing', 'Loaded Ollama models must be enumerated before eviction.'],
    ["$lines = @(& $OllamaExecutable ps 2>$null)", 'vr-governor-ollama-ps-not-fixed', 'Loaded-model discovery must use only the fixed Ollama ps operation.'],
    ["function Stop-OllamaModel", 'vr-governor-model-stop-helper-missing', 'Model eviction must remain isolated in the fixed helper.'],
    ["& $OllamaExecutable stop $Model *> $null", 'vr-governor-model-stop-command-not-fixed', 'Model eviction must use only Ollama stop for the observed model identity.'],
    ["$modelsToPark = if ($parkAllModels) { @($loadedBefore) } else { @($heavyBefore) }", 'vr-governor-park-all-selection-not-fixed', 'Park-all mode must target every observed loaded model.'],
    ["localModelAllowed = -not ($Active -and $ParkAllModels)", 'vr-governor-local-model-denial-missing', 'Active park-all mode must publish local-model denial.'],
  ]) requireLiteral(findings, source, literal, code, summary);

  requirePattern(
    findings,
    source,
    /if \(\$RequestedProfileName -eq 'vr-maximum'\)[\s\S]{0,500}\$parkAllModels = \$true/,
    'vr-governor-requested-vr-profile-not-park-all',
    'An explicitly requested VR maximum profile must force park-all behavior.',
  );
  const params = parameterPrefix(source);
  if (/\$(?:Path|Executable|Command|Script|Arguments?|Url|Uri|TaskName|ServiceName)\b/i.test(params)) {
    findings.push(finding(
      'vr-governor-caller-command-authority-forbidden',
      'Governor parameters may not accept caller-selected paths, executables, commands, tasks, services or URLs.',
    ));
  }

  for (const [pattern, code, summary] of [
    [/\b(?:Invoke-Expression|Invoke-Command|Start-Job|ScriptBlock::Create)\b|\biex\b|cmd\.exe/i, 'vr-governor-dynamic-execution-forbidden', 'Dynamic shell or PowerShell execution is forbidden.'],
    [/\bStart-Process\b|\bStop-Process\b|taskkill/i, 'vr-governor-process-mutation-widened', 'The governor may evict Ollama models but may not start or kill arbitrary processes.'],
    [/\b(?:Register|New|Start|Stop|Unregister)-ScheduledTask(?:Action|Trigger|Principal|SettingsSet)?\b/i, 'vr-governor-scheduled-task-authority-forbidden', 'Scheduled-task mutation is outside the governor.'],
    [/\b(?:Start|Stop|Restart|Set|New|Remove)-Service\b|sc\.exe/i, 'vr-governor-service-authority-forbidden', 'Windows service mutation is outside the governor.'],
    [/\b(?:Set-ItemProperty|New-ItemProperty|Remove-ItemProperty)\b/i, 'vr-governor-registry-mutation-forbidden', 'Registry mutation is outside the governor.'],
    [/\b(?:Invoke-WebRequest|Invoke-RestMethod|WebClient|HttpClient|curl|wget)\b/i, 'vr-governor-network-authority-forbidden', 'Network authority is outside the governor.'],
    [/\bgit(?:\.exe)?\s+(?:push|reset|clean|rebase|checkout|switch|merge|stash|fetch)\b/i, 'vr-governor-git-mutation-forbidden', 'Git mutation is outside the governor.'],
    [/\b(?:Restart-Computer|Stop-Computer|shutdown\.exe)\b/i, 'vr-governor-host-mutation-forbidden', 'Host restart or shutdown authority is outside the governor.'],
    [/\$env:[A-Z0-9_]+_COMMAND\b/i, 'vr-governor-command-env-forbidden', 'Environment-selected command authority is forbidden.'],
  ]) forbidPattern(findings, source, pattern, code, summary);

  const ollamaInvocations = source.split(/\r?\n/).filter((line) => /&\s+\$OllamaExecutable\b/.test(line));
  if (ollamaInvocations.length !== 2
    || ollamaInvocations.some((line) => !/\$OllamaExecutable (?:ps|stop \$Model)/.test(line))) {
    findings.push(finding(
      'vr-governor-ollama-command-estate-widened',
      'The Ollama command estate must remain exactly ps plus stop of an observed model.',
    ));
  }
}

export function analyzeWindowsAuthorityVrResourceGovernorReviewV1(input = {}) {
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
      finalVerdict: 'WINDOWS_AUTHORITY_VR_RESOURCE_GOVERNOR_SPECIALIST_NOT_APPLICABLE',
    });
  }

  const sources = Array.isArray(input.sources) ? input.sources : [];
  const source = sources.length === 1 ? sources[0] : null;
  const findings = [];
  const proofRefs = [];
  if (!exactSource(source, repository, sourceHead)) {
    findings.push(finding('windows-authority-vr-resource-governor-source-evidence-invalid'));
  } else {
    reviewGovernor(source.content, findings);
    proofRefs.push(
      'proofs/windows-authority-vr-resource-governor/'
      + PATH + '@' + sourceHead + '#' + source.blobSha + ':' + source.size,
    );
  }
  if (sources.length !== 1) findings.push(finding('windows-authority-vr-resource-governor-source-estate-widened'));

  const clean = findings.length === 0;
  return Object.freeze({
    schemaVersion: SCHEMA,
    eligible: true,
    clean,
    reviewedPaths: WINDOWS_AUTHORITY_VR_RESOURCE_GOVERNOR_PATHS_V1,
    findings: Object.freeze(findings),
    proofRefs: Object.freeze(proofRefs),
    sourceMutationAllowed: false,
    mergeAuthority: false,
    runtimeMutationAllowed: false,
    providerQualificationAuthority: false,
    finalVerdict: clean
      ? 'WINDOWS_AUTHORITY_VR_RESOURCE_GOVERNOR_SPECIALIST_CLEAN'
      : 'WINDOWS_AUTHORITY_VR_RESOURCE_GOVERNOR_SPECIALIST_FINDINGS',
  });
}
