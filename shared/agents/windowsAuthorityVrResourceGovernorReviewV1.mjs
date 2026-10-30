import { createHash } from 'node:crypto';

export const WINDOWS_AUTHORITY_VR_RESOURCE_GOVERNOR_PATHS_V1 = Object.freeze([
  'scripts/windows/run-vr-resource-governor.ps1',
]);

const SCHEMA = 'stephanos.windows-authority-specialist-review.v1';
const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const SHA = /^[a-f0-9]{40}$/;
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const PATH = WINDOWS_AUTHORITY_VR_RESOURCE_GOVERNOR_PATHS_V1[0];

// Closed source contracts for current main ca89e8b0 and the original #3155
// idle-refresh delta c90b7caa. Both preserve ObserveAdmission, immediate
// headset eviction, the 0.5s/5s guard, real-VR-bound Ollama runtime suppression,
// and prior-protection-bound model/runtime reappearance evidence.
//
// Do not normalize PowerShell. Comments can contain #Requires directives and
// # inside an argument need not start a comment. A helper/literal match cannot
// qualify executable additions, action reassignment, aliases or shadowing.
// Every other byte sequence requires a newly qualified source contract.
// Changing these registrations is an approval-boundary self-change, not
// independent review, runtime proof, or permission to merge/install.
const CURRENT_GOVERNOR_SOURCE_CONTRACTS = Object.freeze([
  Object.freeze({ blobSha: 'ae71e1e79ead63efeb5a4d73f4bce6a01ee0f1d9', size: 48838 }),
  Object.freeze({ blobSha: '9513dfe995a35087e1d715ef0c4dff4ca3578295', size: 49674 }),
]);

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
  const observed = { blobSha: blobSha(source), size: Buffer.byteLength(source, 'utf8') };
  if (!CURRENT_GOVERNOR_SOURCE_CONTRACTS.some((entry) =>
    entry.blobSha === observed.blobSha && entry.size === observed.size)) {
    findings.push(finding('vr-governor-source-contract-unregistered',
      'Governor bytes do not match a registered complete source contract; unknown variants require independent qualification.'));
    return;
  }
  for (const [literal, code, summary] of [
    ["[ValidateSet('Watch','Reconcile','Status','ObserveAdmission','PrepareGaming','CancelPrepare','SetAuto','ForceOn','ForceOff')][string]$Action = 'Watch'", 'vr-governor-action-estate-widened', 'Governor actions must remain the fixed nine-value surface including read-only observation.'],
    ["if ($Action -eq 'ObserveAdmission') {", 'vr-governor-readonly-admission-observation-missing', 'The fresh read-only admission observation must remain separate from reconciliation.'],
    ["$workspaceRoot = Join-Path $env:USERPROFILE 'Documents\\Stephanos-openclaw-workspace'", 'vr-governor-workspace-root-not-fixed', 'Governor state must remain inside the fixed Stephanos workspace.'],
    ["$statePath = Join-Path $stateRoot 'vr-resource-governor-current.json'", 'vr-governor-state-path-not-fixed', 'Canonical governor state path must remain fixed.'],
    ["$overridePath = Join-Path $stateRoot 'gaming-resource-override.json'", 'vr-governor-override-path-not-fixed', 'Gaming override state path must remain fixed.'],
    ["$preparePath = Join-Path $stateRoot 'gaming-resource-prepare.json'", 'vr-governor-prepare-path-not-fixed', 'Prepare lease path must remain fixed.'],
    ["$profilesPath = Join-Path $stateRoot 'gaming-resource-profiles.json'", 'vr-governor-profiles-path-not-fixed', 'Gaming profile path must remain fixed.'],
    ["$telemetryPath = Join-Path $stateRoot 'gaming-resource-governor-events.jsonl'", 'vr-governor-telemetry-path-not-fixed', 'Governor telemetry path must remain fixed.'],
    ["$lightweightModel = 'llama3.2:3b'", 'vr-governor-lightweight-identity-not-fixed', 'The lightweight fallback identity must remain explicit.'],
    ["foreach ($name in @('vrcompositor', 'vrdashboard'))", 'vr-governor-vr-runtime-signal-estate-widened', 'SteamVR detection must retain its closed process-name set.'],
    ['return -not (Test-StaleOculusDashAfterCrash)', 'vr-governor-vr-runtime-signal-estate-widened', 'OculusDash must remain protected unless the complete stale-crash evidence holds.'],
    ["$name = 'vr-maximum'", 'vr-governor-vr-profile-missing', 'VR maximum profile must remain explicit.'],
    ["$parkAllModels = $true", 'vr-governor-park-all-contract-missing', 'VR maximum must retain park-all-models behavior.'],
    ["if ($RequestedProfileName -eq 'vr-maximum')", 'vr-governor-explicit-vr-profile-gate-missing', 'Explicit VR preparation must remain a dedicated profile gate.'],
    ["function Get-LoadedOllamaModels", 'vr-governor-loaded-model-enumerator-missing', 'Loaded Ollama models must be enumerated before eviction.'],
    ["$lines = @(& $OllamaExecutable ps 2>$null)", 'vr-governor-ollama-ps-not-fixed', 'Loaded-model discovery must use only the fixed Ollama ps operation.'],
    ["function Stop-OllamaModel", 'vr-governor-model-stop-helper-missing', 'Model eviction must remain isolated in the fixed helper.'],
    ["& $OllamaExecutable stop $Model *> $null", 'vr-governor-model-stop-command-not-fixed', 'Model eviction must use only Ollama stop for the observed model identity.'],
    ["$modelsToPark = if ($parkAllModels) { @($loadedBefore) } else { @($heavyBefore) }", 'vr-governor-park-all-selection-not-fixed', 'Park-all mode must target every observed loaded model.'],
    ["localModelAllowed = -not ($Active -and $ParkAllModels)", 'vr-governor-local-model-denial-missing', 'Active park-all mode must publish local-model denial.'],
    ["zeroLocalModelInvariant = [bool]$ZeroLocalModelInvariant", 'vr-governor-zero-model-proof-missing', 'Governor state must publish the zero-local-model invariant.'],
    ["reappearanceDetected = [bool]$ReappearanceDetected", 'vr-governor-reappearance-proof-missing', 'Governor telemetry must expose model reappearance.'],
    ["reappearanceCount = [int]$ReappearanceCount", 'vr-governor-reappearance-count-missing', 'Governor telemetry must count model reappearance.'],
    ["$zeroLocalModelInvariant = [bool](", 'vr-governor-zero-model-evaluation-missing', 'The zero-model invariant must be evaluated after eviction.'],
    ["$priorParkAllModels = $false", 'vr-governor-prior-vr-latch-missing', 'VR park-all state must be carried across transient runtime-signal loss.'],
    ["$profile = $PriorState.profile", 'vr-governor-prior-profile-latch-missing', 'A protected prior VR profile must be retained for the active game session.'],
    ["$guardIntervalSeconds = if ($effective.active -and $effective.profile.parkAllModels) { 0.5 } else { 5 }", 'vr-governor-vr-guard-cadence-not-fixed', 'Active park-all VR protection must retain the stronger half-second guard.'],
    ['[void](Invoke-ImmediateVrModelEviction)', 'vr-governor-immediate-headset-eviction-missing', 'Every Watch tick must retain immediate real-headset model eviction.'],
    ['Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction Stop', 'vr-governor-bounded-runtime-suppression-missing', 'The exact source contract permits only observed-PID stopping inside real-VR Ollama suppression.'],
    ["@($prepared.loadedModelsAfter).Count -gt 0", 'vr-governor-prepare-loaded-model-failclose-missing', 'VR preparation must fail closed if any model remains loaded.'],
    ["$prepared.zeroLocalModelInvariant -ne $true", 'vr-governor-prepare-invariant-failclose-missing', 'VR preparation must fail closed when zero-model proof is absent.'],
  ]) requireLiteral(findings, source, literal, code, summary);

  requirePattern(
    findings,
    source,
    /if \(\$RequestedProfileName -eq 'vr-maximum'\)[\s\S]{0,500}\$parkAllModels = \$true/,
    'vr-governor-requested-vr-profile-not-park-all',
    'An explicitly requested VR maximum profile must force park-all behavior.',
  );
  requirePattern(
    findings,
    source,
    /\$runtimeReappearanceDetected = \[bool\]\([\s\S]{0,700}\$PriorState\.localModelAllowed -eq \$false[\s\S]{0,700}\$modelReappearanceDetected = \[bool\]\([\s\S]{0,700}\$PriorState\.localModelAllowed -eq \$false/,
    'vr-governor-reappearance-not-protection-bound',
    'Both runtime and model reappearance must remain bound to an already protected session.',
  );
  requireLiteral(findings, source,
    '$reappearanceDetected = [bool]($runtimeReappearanceDetected -or $modelReappearanceDetected)',
    'vr-governor-reappearance-composition-missing',
    'Reappearance evidence must retain both independently protected sources.');
  requirePattern(
    findings,
    source,
    /evictionHealthy = \[bool\]\([\s\S]{0,300}\$ZeroLocalModelInvariant/,
    'vr-governor-eviction-health-not-zero-model-bound',
    'Eviction health must include the zero-model invariant.',
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
    [/\bStart-Process\b|taskkill/i, 'vr-governor-process-mutation-widened', 'The registered real-VR stop helper grants no additional process-start or arbitrary kill authority.'],
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
