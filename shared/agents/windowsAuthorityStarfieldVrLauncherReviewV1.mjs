import { createHash } from 'node:crypto';

export const WINDOWS_AUTHORITY_STARFIELD_VR_LAUNCHER_PATHS_V1 = Object.freeze([
  'scripts/windows/launch-starfield-vr.ps1',
]);

const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const EXACT_HEAD = /^[a-f0-9]{40}$/;
const GIT_BLOB = /^[a-f0-9]{40}$/;
const MAX_BYTES = 256 * 1024;

function text(value) { return String(value ?? '').trim(); }
function finding(code, summary, path) {
  return Object.freeze({ severity: 'P0', code, summary, path });
}
function gitBlobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update('blob ' + bytes.length + '\0', 'utf8').update(bytes).digest('hex');
}
function exactSource(source, repository, head, path) {
  const content = typeof source?.content === 'string' ? source.content : '';
  const size = Buffer.byteLength(content, 'utf8');
  return Boolean(
    source && typeof source === 'object' && !Array.isArray(source) &&
    source.schemaVersion === SOURCE_SCHEMA &&
    source.repository === repository &&
    source.path === path &&
    source.ref === head &&
    source.exists === true &&
    Number.isSafeInteger(source.size) &&
    source.size === size &&
    size > 0 && size <= MAX_BYTES &&
    GIT_BLOB.test(text(source.blobSha)) &&
    source.blobSha === gitBlobSha(content)
  );
}
function escalationPaths(analysis = {}) {
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  if (findings.length !== 1) return [];
  const item = findings[0];
  const path = text(item?.path);
  return text(item?.severity).toUpperCase() === 'P0' &&
    text(item?.code) === 'unsupported-high-risk-surface' &&
    path === WINDOWS_AUTHORITY_STARFIELD_VR_LAUNCHER_PATHS_V1[0]
      ? [path]
      : [];
}
function requireLiteral(findings, source, literal, code, summary, path) {
  if (!source.includes(literal)) findings.push(finding(code, summary, path));
}
function forbid(findings, source, pattern, code, summary, path) {
  if (pattern.test(source)) findings.push(finding(code, summary, path));
}
function reviewLauncher(source, path, findings) {
  const required = [
    ["$decisionScript = Join-Path $repositoryRoot 'scripts\\starfield-vr-launch-decision.mjs'", 'starfield-launcher-decision-policy-missing', 'Launcher must delegate launch authority to the canonical decision policy.'],
    ["'stephanos.starfield-vr-launch-profile.v1'", 'starfield-launcher-profile-schema-missing', 'Verified launch profile schema must remain explicit.'],
    ["'meta-air-link'", 'starfield-launcher-air-link-boundary-missing', 'Meta Air Link must remain the fixed transport boundary.'],
    ["@('mutar-openxr', 'vorpx')", 'starfield-launcher-provider-allowlist-missing', 'Provider selection must remain closed to Mutar OpenXR or vorpX.'],
    ["Get-Process -Name 'OculusDash'", 'starfield-launcher-air-link-proof-missing', 'Air Link readiness must remain bound to OculusDash observation.'],
    ["'HKLM:\\SOFTWARE\\Khronos\\OpenXR\\1'", 'starfield-launcher-openxr-observation-missing', 'OpenXR runtime observation must remain bound to the Khronos registry location.'],
    ["Get-FileHash -LiteralPath $Path -Algorithm SHA256", 'starfield-launcher-file-hash-proof-missing', 'Observed launch files must remain SHA-256 bound.'],
    ["[System.IO.File]::WriteAllText(", 'starfield-launcher-observation-write-not-bounded', 'Decision observations must use the explicit byte-writing path.'],
    ["New-Object System.Text.UTF8Encoding($false)", 'starfield-launcher-observation-bom-guard-missing', 'Decision observations must remain UTF-8 without BOM for Node JSON parsing.'],
    ["& $NodeExecutablePath $decisionScript --profile $ProfilePath --observations $observationsPath", 'starfield-launcher-canonical-decision-invocation-missing', 'Launcher must invoke only the canonical decision script with bounded profile and observation inputs.'],
    ["if ($ReadinessOnly)", 'starfield-launcher-readiness-gate-missing', 'Readiness-only mode must remain first-class and fail closed before launch.'],
    ["if (-not $decision.ok)", 'starfield-launcher-decision-gate-missing', 'Game launch must remain gated on a successful canonical decision.'],
    ["if ($decision.action -eq 'LAUNCH_VORPX')", 'starfield-launcher-vorpx-action-gate-missing', 'vorpX companion launch must remain gated on the canonical vorpX action.'],
    ["$launchExecutable = (Resolve-Path -LiteralPath $gameLaunchPath).Path", 'starfield-launcher-verified-executable-resolution-missing', 'Launch executable must be resolved only from the verified profile path.'],
    ["Start-Process -FilePath $launchExecutable -WorkingDirectory $workingDirectory -PassThru", 'starfield-launcher-game-start-boundary-missing', 'Game start must remain bound to the verified executable and working directory.'],
    ["Nothing was changed and flat Starfield was not started.", 'starfield-launcher-flat-fallback-boundary-missing', 'Fail-closed flat-game boundary must remain explicit.'],
  ];
  for (const [literal, code, summary] of required) {
    requireLiteral(findings, source, literal, code, summary, path);
  }

  forbid(findings, source, /Invoke-Expression|Invoke-Command|ScriptBlock::Create/i,
    'starfield-launcher-dynamic-execution-forbidden', 'Dynamic PowerShell execution is forbidden.', path);
  forbid(findings, source, /Invoke-WebRequest|Start-BitsTransfer|Expand-Archive|Copy-Item/i,
    'starfield-launcher-download-install-authority-forbidden', 'Download, archive or copy/install authority is outside the launcher.', path);
  forbid(findings, source, /Set-ItemProperty|New-ItemProperty|Remove-ItemProperty/i,
    'starfield-launcher-configuration-mutation-forbidden', 'Registry or provider configuration mutation is outside the launcher.', path);
  forbid(findings, source, /Restart-Computer|shutdown\.exe|schtasks(?:\.exe)?|Register-ScheduledTask|Start-Service|Stop-Service/i,
    'starfield-launcher-system-authority-forbidden', 'Restart, task or service authority is outside the launcher.', path);
  forbid(findings, source, /\bgit(?:\.exe)?\s+(?:push|reset|clean|rebase|checkout|switch|merge|stash)\b/i,
    'starfield-launcher-git-mutation-forbidden', 'Git mutation is forbidden in the launcher.', path);
  forbid(findings, source, /Set-Content\s+-LiteralPath\s+\$observationsPath\s+-Encoding\s+UTF8/i,
    'starfield-launcher-observation-bom-regression', 'Windows PowerShell UTF8 Set-Content must not reintroduce a BOM into decision observations.', path);
  forbid(findings, source, /Start-Process\s+-FilePath\s+['"][^'"]*(?:Starfield\.exe|sfse_loader\.exe)['"]/i,
    'starfield-launcher-direct-game-path-forbidden', 'A literal direct game launch may not bypass the verified profile and decision policy.', path);
}

export function analyzeWindowsAuthorityStarfieldVrLauncherReviewV1(input = {}) {
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
      finalVerdict: 'WINDOWS_AUTHORITY_STARFIELD_VR_LAUNCHER_SPECIALIST_NOT_ELIGIBLE',
    });
  }

  const sources = Array.isArray(input.sources) ? input.sources : [];
  const findings = [];
  const proofRefs = [];
  const path = paths[0];
  const candidates = sources.filter((source) => source?.path === path);
  if (candidates.length !== 1 || !exactSource(candidates[0], repository, sourceHead, path)) {
    findings.push(finding(
      'windows-authority-source-evidence-invalid',
      'Exactly one immutable exact-head source record is required for the Starfield VR launcher.',
      path,
    ));
  } else {
    reviewLauncher(candidates[0].content, path, findings);
    proofRefs.push('proofs/windows-authority-starfield-vr-launcher/' + path + '@' + sourceHead + '#' + candidates[0].blobSha + ':' + candidates[0].size);
  }

  const clean = findings.length === 0;
  return Object.freeze({
    eligible: true,
    clean,
    findings: Object.freeze(findings),
    reviewedPaths: Object.freeze(paths),
    proofRefs: Object.freeze(proofRefs),
    finalVerdict: clean
      ? 'WINDOWS_AUTHORITY_STARFIELD_VR_LAUNCHER_SPECIALIST_CLEAN'
      : 'WINDOWS_AUTHORITY_STARFIELD_VR_LAUNCHER_SPECIALIST_FINDINGS',
  });
}
