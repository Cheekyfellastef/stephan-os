import { createHash } from 'node:crypto';

export const WINDOWS_AUTHORITY_STARFIELD_VR_AER_OBSERVE_PATHS_V1 = Object.freeze([
  'scripts/windows/run-starfield-aer-stabilizer-observe.ps1',
]);

const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const EXACT_HEAD = /^[a-f0-9]{40}$/;
const GIT_BLOB = /^[a-f0-9]{40}$/;
const MAX_BYTES = 256 * 1024;

function text(value) { return String(value ?? '').trim(); }
function finding(code, summary, path) { return Object.freeze({ severity: 'P0', code, summary, path }); }
function gitBlobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`, 'utf8').update(bytes).digest('hex');
}
function exactSource(source, repository, head, path) {
  const content = typeof source?.content === 'string' ? source.content : '';
  const size = Buffer.byteLength(content, 'utf8');
  return Boolean(source
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
    && size <= MAX_BYTES
    && GIT_BLOB.test(text(source.blobSha))
    && source.blobSha === gitBlobSha(content));
}
function escalationPaths(analysis = {}) {
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  if (findings.length !== 1) return [];
  const item = findings[0];
  const path = text(item?.path);
  if (text(item?.severity).toUpperCase() !== 'P0'
      || text(item?.code) !== 'unsupported-high-risk-surface'
      || path !== WINDOWS_AUTHORITY_STARFIELD_VR_AER_OBSERVE_PATHS_V1[0]) return [];
  return [path];
}
function requireLiteral(findings, source, literal, code, summary, path) {
  if (!source.includes(literal)) findings.push(finding(code, summary, path));
}
function forbid(findings, source, pattern, code, summary, path) {
  if (pattern.test(source)) findings.push(finding(code, summary, path));
}
function matchingLines(source, pattern) {
  return source.split(/\r?\n/).map((line) => line.trim()).filter((line) => pattern.test(line));
}
function requireExactLineEstate(findings, source, tokenPattern, allowed, code, summary, path, { optional = [] } = {}) {
  const observed = matchingLines(source, tokenPattern);
  const allowedSet = new Set([...allowed, ...optional]);
  if (observed.some((line) => !allowedSet.has(line))) {
    findings.push(finding(code, summary, path));
    return;
  }
  for (const line of allowed) {
    if (!observed.includes(line)) {
      findings.push(finding(code, summary, path));
      return;
    }
  }
}

function reviewAerObserve(source, path, findings) {
  for (const [literal, code, summary] of [
    ["$gameRoot = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Starfield'", 'starfield-aer-game-root-not-fixed', 'AER Observe must remain bound to the fixed Starfield game root.'],
    ["$gameExe = Join-Path $gameRoot 'Starfield.exe'", 'starfield-aer-game-executable-not-fixed', 'AER Observe must derive Starfield.exe only from the fixed game root.'],
    ["$customDll = Join-Path $workspaceRoot 'vr\\aer-stabilizer\\builds\\public-v2.0.1-observe\\dxgi.dll'", 'starfield-aer-stabilizer-binary-not-fixed', 'The reviewed AER stabilizer binary path must remain fixed.'],
    ["$guardianScript = Join-Path $PSScriptRoot 'starfield-aer-stabilizer-guardian.ps1'", 'starfield-aer-rollback-guardian-not-fixed', 'The rollback guardian must remain repository-local and fixed.'],
    ["$canonicalLauncher = Join-Path $repoRoot 'scripts\\windows\\launch-starfield-vr.ps1'", 'starfield-aer-canonical-launcher-not-fixed', 'Readiness must remain delegated to the canonical Starfield VR launcher.'],
    ["$performanceScript = Join-Path $repoRoot 'scripts\\windows\\starfield-vr-performance-mode.ps1'", 'starfield-aer-performance-helper-not-fixed', 'Performance telemetry must remain bound to the reviewed helper.'],
    ["$resourceGovernorScript = Join-Path $repoRoot 'scripts\\windows\\run-vr-resource-governor.ps1'", 'starfield-aer-resource-governor-not-fixed', 'Gaming resource preparation must remain bound to the reviewed governor.'],
    ["$expectedBaselineHash = '63db15c370d3b8f15faa292a95d5c3abd4c6571cef0d35a45310d998adfeae41'", 'starfield-aer-baseline-hash-changed', 'The public MutaR rollback baseline hash must remain fixed.'],
    ["$expectedCustomHash = 'b0046baf0e4487c76d6a7c85c04b338e402f50f7557189e5e46a5b8c0932a76c'", 'starfield-aer-stabilizer-hash-changed', 'The reviewed AER Observe DLL hash must remain fixed.'],
    ["$expectedLoaderHash = '663f021e6ace3a5624ce1d273d4a2714bf8e42bd595dee4481190ad2aea31f60'", 'starfield-aer-loader-hash-changed', 'The reviewed OpenXR loader hash must remain fixed.'],
    ["VR_AsyncAER=false", 'starfield-aer-comfort-config-async-missing', 'The comfortable AER-off baseline must remain explicitly enforced or verified.'],
    ["DLSS_AER_Enabled=true", 'starfield-aer-comfort-config-dlss-missing', 'DLSS AER must remain explicitly enabled or verified.'],
    ["[string]$routeIdentity.provider -ne 'mutar-openxr'", 'starfield-aer-provider-identity-gate-missing', 'AER Observe must require verified mutar-openxr route identity.'],
    ["AER Observe requires a real Meta Air Link session; simulated readiness is test-only.", 'starfield-aer-real-airlink-gate-missing', 'AER Observe must reject simulated Air Link readiness.'],
    ["$env:STEPHANOS_SOURCE_HEAD = $runtimeSourceHead", 'starfield-aer-runtime-head-stamp-missing', 'AER Observe must stamp exact runtime source identity into canonical readiness.'],
    ["AER Observe blocked a stale readiness receipt", 'starfield-aer-stale-readiness-gate-missing', 'AER Observe must fail closed when canonical readiness does not match the executing source head.'],
    ["Fresh canonical telemetry session was not created before Starfield launch.", 'starfield-aer-fresh-telemetry-gate-missing', 'AER Observe must prove a fresh telemetry session exists before Starfield starts.'],
    ["$resourceGuard.localModelAllowed -ne $false", 'starfield-aer-local-ai-eviction-gate-missing', 'AER Observe must fail closed unless local AI is parked.'],
    ["@($resourceGuard.loadedModelsAfter).Count -gt 0", 'starfield-aer-loaded-model-gate-missing', 'AER Observe must fail closed when any local model remains resident.'],
    ["Copy-Item -LiteralPath $customDll -Destination $liveDll -Force", 'starfield-aer-reviewed-dll-swap-missing', 'Only the reviewed stabilizer DLL may replace the live MutaR DLL.'],
    ["Copy-Item -LiteralPath $baselineBackup -Destination $liveDll -Force", 'starfield-aer-failure-rollback-missing', 'Failure rollback to the validated public baseline must remain present.'],
    ["stabilizerMode = 'OBSERVE'", 'starfield-aer-observe-state-missing', 'The mode state must remain explicitly OBSERVE.'],
    ["rollback = 'ARMED'", 'starfield-aer-rollback-state-missing', 'Rollback must be armed before launch.'],
  ]) requireLiteral(findings, source, literal, code, summary, path);

  requireExactLineEstate(findings, source, /\bStart-Process\b/i, [
    '$game = Start-Process -FilePath $gameExe -WorkingDirectory $gameRoot -PassThru',
    '$rollbackGuardian = Start-Process -FilePath $powershellExe -ArgumentList $rollbackArgs -WindowStyle Hidden -PassThru',
  ], 'starfield-aer-process-estate-widened', 'AER Observe may start only the game and its independent fixed rollback guardian; telemetry guardian creation stays inside the fixed performance helper.', path);

  requireExactLineEstate(findings, source, /\bStop-Process\b/i, [], 'starfield-aer-process-termination-widened',
    'AER Observe may terminate only its own just-launched Starfield process during fail-closed rollback.', path, {
      optional: ["if (-not $game.HasExited) { Stop-Process -Id $game.Id -Force -ErrorAction SilentlyContinue }"],
    });

  requireExactLineEstate(findings, source, /\bCopy-Item\b/i, [
    'Copy-Item -LiteralPath $liveDll -Destination $baselineBackup -Force',
    'Copy-Item -LiteralPath $customDll -Destination $liveDll -Force',
    'Copy-Item -LiteralPath $baselineBackup -Destination $liveDll -Force',
  ], 'starfield-aer-copy-estate-widened', 'AER Observe copy authority must remain limited to validated baseline backup, reviewed stabilizer swap and rollback.', path);

  requireExactLineEstate(findings, source, /\bRemove-Item\b/i, [
    'Remove-Item -LiteralPath $liveLog -Force -ErrorAction SilentlyContinue',
    'Remove-Item -LiteralPath $protectFlag -Force -ErrorAction SilentlyContinue',
  ], 'starfield-aer-remove-estate-widened', 'AER Observe removal authority must remain limited to its log and protect flag.', path, {
      optional: ['Remove-Item -LiteralPath $protectFlag -Force -ErrorAction SilentlyContinue'],
    });

  const callLines = matchingLines(source, /&\s/);
  const allowedCallPatterns = [
    /^\$readinessText = & \$powershellExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \$canonicalLauncher -ReadinessOnly -ProfilePath \$profilePath 2>&1 \| Out-String$/,
    /^try \{ \$runtimeSourceHead = \(& git -C \$repoRoot rev-parse HEAD 2>\$null \| Select-Object -First 1\)\.Trim\(\)\.ToLowerInvariant\(\) \} catch \{ \$runtimeSourceHead = '' \}$/,
    /^\$resourceText = & \$powershellExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \$resourceGovernorScript -Action PrepareGaming -ProcessName 'Starfield' -ProfileName 'vr-maximum' 2>&1 \| Out-String$/,
    /^\$perfText = & \$powershellExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \$performanceScript -Action Enter -WorkspaceRoot \$workspaceRoot -GameRoot \$gameRoot -Provider 'mutar-openxr' -ProfilePath \$profilePath -ProfileSha256 \$profileSha256 -LaunchSessionId \$launchSessionId -SourceHead \$sourceHead 2>&1 \| Out-String$/,
    /^\$perfGuardianJson = & \$powershellExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \$performanceScript -Action StartGuard -SessionPath \(\[string\]\$performanceMode\.sessionPath\) -GameProcessId \(\[int\]\$game\.Id\) 2>&1 \| Out-String$/,
    /^& \$powershellExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \$performanceScript -Action Restore -SessionPath \(\[string\]\$performanceMode\.sessionPath\) \| Out-Null$/,
    /^& \$powershellExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \$resourceGovernorScript -Action CancelPrepare \| Out-Null$/,
  ];
  if (callLines.some((line) => !allowedCallPatterns.some((pattern) => pattern.test(line)))) {
    findings.push(finding('starfield-aer-call-operator-estate-widened', 'AER Observe call-operator authority must remain exactly the canonical readiness, Git head observation, resource governor and fixed performance Enter/StartGuard/Restore calls.', path));
  }
  for (const pattern of allowedCallPatterns.slice(0, 5)) {
    if (!callLines.some((line) => pattern.test(line))) {
      findings.push(finding('starfield-aer-required-call-missing', 'A required fixed AER Observe call is missing.', path));
      break;
    }
  }

  forbid(findings, source, /Invoke-Expression|Invoke-Command|ScriptBlock::Create|Start-Job|Start-ThreadJob/i,
    'starfield-aer-dynamic-execution-forbidden', 'Dynamic PowerShell execution is forbidden.', path);
  forbid(findings, source, /Invoke-WebRequest|Start-BitsTransfer|Expand-Archive|bitsadmin|curl\.exe|wget\.exe/i,
    'starfield-aer-download-authority-forbidden', 'Network download or archive-install authority is outside AER Observe.', path);
  forbid(findings, source, /Restart-Computer|shutdown\.exe|schtasks(?:\.exe)?|Register-ScheduledTask|Start-Service|Stop-Service/i,
    'starfield-aer-system-authority-forbidden', 'Restart, task and service authority is outside AER Observe.', path);
  forbid(findings, source, /\bgit(?:\.exe)?\s+(?:push|reset|clean|rebase|checkout|switch|merge|stash|commit)\b/i,
    'starfield-aer-git-mutation-forbidden', 'Git mutation is forbidden in AER Observe.', path);
  forbid(findings, source, /Set-ItemProperty|New-ItemProperty|Remove-ItemProperty/i,
    'starfield-aer-registry-mutation-forbidden', 'Registry mutation is outside AER Observe.', path);
  forbid(findings, source, /(?:^|\n)\s*['"]?[^\n]*Starfield\.exe[^\n]*(?:cmd\.exe|powershell\.exe|pwsh\.exe)/i,
    'starfield-aer-shell-game-launch-forbidden', 'Starfield must not be launched through a generic shell.', path);
}

export function analyzeWindowsAuthorityStarfieldVrAerObserveReviewV1(input = {}) {
  const repository = text(input.repository);
  const sourceHead = text(input.sourceHead).toLowerCase();
  const paths = escalationPaths(input.analysis);
  if (repository !== 'Cheekyfellastef/stephan-os' || !EXACT_HEAD.test(sourceHead) || paths.length !== 1) {
    return Object.freeze({
      eligible: false,
      clean: false,
      findings: Object.freeze([]),
      reviewedPaths: Object.freeze([]),
      proofRefs: Object.freeze([]),
      finalVerdict: 'WINDOWS_AUTHORITY_STARFIELD_VR_AER_OBSERVE_SPECIALIST_NOT_ELIGIBLE',
    });
  }
  const sources = Array.isArray(input.sources) ? input.sources : [];
  const findings = [];
  const proofRefs = [];
  const path = paths[0];
  const candidates = sources.filter((source) => source?.path === path);
  if (candidates.length !== 1 || !exactSource(candidates[0], repository, sourceHead, path)) {
    findings.push(finding('windows-authority-source-evidence-invalid', 'Exactly one immutable exact-head source record is required for Starfield VR AER Observe.', path));
  } else {
    reviewAerObserve(candidates[0].content, path, findings);
    proofRefs.push(`proofs/windows-authority-starfield-vr-aer-observe/${path}@${sourceHead}#${candidates[0].blobSha}:${candidates[0].size}`);
  }
  const clean = findings.length === 0;
  return Object.freeze({
    eligible: true,
    clean,
    findings: Object.freeze(findings),
    reviewedPaths: Object.freeze(paths),
    proofRefs: Object.freeze(proofRefs),
    finalVerdict: clean
      ? 'WINDOWS_AUTHORITY_STARFIELD_VR_AER_OBSERVE_SPECIALIST_CLEAN'
      : 'WINDOWS_AUTHORITY_STARFIELD_VR_AER_OBSERVE_SPECIALIST_FINDINGS',
  });
}
