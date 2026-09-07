import { createHash } from 'node:crypto';

export const WINDOWS_AUTHORITY_STARFIELD_VR_SPLASH_PATHS_V1 = Object.freeze([
  'scripts/windows/install-starfield-vr-desktop-shortcut.ps1',
  'scripts/windows/launch-starfield-vr-with-splash.ps1',
]);

const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const MAX_BYTES = 256 * 1024;
const EXACT_HEAD = /^[a-f0-9]{40}$/;
const GIT_BLOB = /^[a-f0-9]{40}$/;

function text(value) { return String(value ?? '').trim(); }
function finding(code, summary, path) { return Object.freeze({ severity: 'P0', code, summary, path }); }
function gitBlobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`, 'utf8').update(bytes).digest('hex');
}
function exactSource(source, repository, sourceHead, path) {
  const content = typeof source?.content === 'string' ? source.content : '';
  const bytes = Buffer.byteLength(content, 'utf8');
  return Boolean(source && typeof source === 'object' && !Array.isArray(source)
    && source.schemaVersion === SOURCE_SCHEMA && source.repository === repository
    && source.path === path && source.ref === sourceHead && source.exists === true
    && Number.isSafeInteger(source.size) && source.size === bytes && source.size > 0 && source.size <= MAX_BYTES
    && GIT_BLOB.test(text(source.blobSha)) && source.blobSha === gitBlobSha(content));
}
function escalationPaths(analysis = {}) {
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  if (findings.length !== 2) return [];
  const paths = findings.map((item) => (
    text(item?.severity).toUpperCase() === 'P0'
      && text(item?.code) === 'unsupported-high-risk-surface'
      ? text(item?.path)
      : ''
  )).sort();
  return JSON.stringify(paths) === JSON.stringify([...WINDOWS_AUTHORITY_STARFIELD_VR_SPLASH_PATHS_V1].sort())
    ? paths : [];
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

function reviewInstaller(source, path, findings) {
  for (const [literal, code, summary] of [
    ['[CmdletBinding(SupportsShouldProcess = $true)]', 'starfield-shortcut-shouldprocess-missing', 'Shortcut installation must remain ShouldProcess-gated.'],
    ["$splashLauncherScript = Join-Path $repositoryRoot 'scripts\\windows\\launch-starfield-vr-with-splash.ps1'", 'starfield-shortcut-splash-route-missing', 'The singular Starfield VR shortcut must target the splash wrapper.'],
    ["$shortcutPath = Join-Path $desktopPath 'Starfield VR.lnk'", 'starfield-shortcut-name-not-fixed', 'Shortcut identity must remain exactly Starfield VR.lnk.'],
    ["$powershellExecutable = Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'", 'starfield-shortcut-powershell-not-fixed', 'Shortcut execution host must remain fixed Windows PowerShell.'],
    ['New-Object -ComObject WScript.Shell', 'starfield-shortcut-wscript-shell-missing', 'Shortcut creation must remain bounded to WScript.Shell.'],
    ['-WindowStyle Hidden', 'starfield-shortcut-windowstyle-missing', 'Shortcut must keep raw PowerShell hidden.'],
  ]) requireLiteral(findings, source, literal, code, summary, path);

  requirePattern(findings, source, /\$shortcut\.TargetPath\s*=\s*\$powershellExecutable/, 'starfield-shortcut-target-not-fixed', 'Shortcut target must remain the fixed PowerShell executable.', path);
  requirePattern(findings, source, /\$shortcut\.Arguments\s*=\s*\$arguments/, 'starfield-shortcut-arguments-not-bounded', 'Shortcut arguments must remain the bounded splash invocation.', path);

  for (const [pattern, code, summary] of [
    [/RunAs|Verb\s*=\s*['"]runas['"]/i, 'starfield-shortcut-elevation-forbidden', 'Shortcut installation must not elevate.'],
    [/Invoke-WebRequest|Invoke-RestMethod|Start-BitsTransfer|curl(?:\.exe)?|wget(?:\.exe)?/i, 'starfield-shortcut-network-forbidden', 'Shortcut installation must not gain download/network authority.'],
    [/Register-ScheduledTask|New-ScheduledTask|schtasks(?:\.exe)?/i, 'starfield-shortcut-task-authority-forbidden', 'Shortcut installation must not create scheduled tasks.'],
    [/\bgit(?:\.exe)?\s+(?:push|reset|clean|rebase|checkout|switch|merge|stash)\b/i, 'starfield-shortcut-git-mutation-forbidden', 'Shortcut installation must not mutate repository history.'],
    [/sfse_loader\.exe|Starfield\.exe|Start-Process\s+-FilePath\s+.*Starfield/i, 'starfield-shortcut-direct-game-launch-forbidden', 'Shortcut installation must not gain direct game-launch authority.'],
  ]) forbidPattern(findings, source, pattern, code, summary, path);
}

function reviewSplash(source, path, findings) {
  for (const [literal, code, summary] of [
    ['[CmdletBinding()]', 'starfield-splash-cmdlet-binding-missing', 'Splash wrapper must remain a bounded presentation command.'],
    ["$launcherScript = Join-Path $repositoryRoot 'scripts\\windows\\launch-starfield-vr.ps1'", 'starfield-splash-canonical-launcher-missing', 'Splash must delegate to the canonical Starfield VR launcher.'],
    ["$powershellExecutable = Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'", 'starfield-splash-powershell-not-fixed', 'Splash child process host must remain fixed Windows PowerShell.'],
    ['Invoke-StarfieldVrLauncher -ReadinessOnly', 'starfield-splash-readiness-first-missing', 'Splash must perform canonical readiness before launch.'],
    ['STARFIELD_VR_LAUNCH_READY', 'starfield-splash-ready-verdict-missing', 'Splash must require the canonical ready verdict.'],
    ['Flat Starfield was not started', 'starfield-splash-fail-closed-wording-missing', 'Blocked splash must explicitly state that flat Starfield was not started.'],
    ['Show details', 'starfield-splash-details-boundary-missing', 'Splash must retain progressive sanitized blocker details.'],
  ]) requireLiteral(findings, source, literal, code, summary, path);

  requirePattern(findings, source, /\$startInfo\.FileName\s*=\s*\$powershellExecutable/, 'starfield-splash-child-not-fixed', 'Splash child must use only fixed Windows PowerShell.', path);
  requirePattern(findings, source, /if\s*\(\$ReadinessOnly\)\s*\{\s*\$arguments\s*\+=\s*'-ReadinessOnly'\s*\}/, 'starfield-splash-readiness-argument-not-fixed', 'Readiness mode must remain the fixed canonical launcher switch.', path);

  for (const [pattern, code, summary] of [
    [/Invoke-WebRequest|Invoke-RestMethod|Start-BitsTransfer|Expand-Archive|Copy-Item|Set-ItemProperty/i, 'starfield-splash-install-mutation-forbidden', 'Splash must not download, install or mutate provider/game configuration.'],
    [/sfse_loader\.exe|dxgi\.dll|Start-Process\s+-FilePath\s+.*Starfield/i, 'starfield-splash-direct-game-launch-forbidden', 'Splash must not bypass the canonical launcher with direct game authority.'],
    [/RunAs|Verb\s*=\s*['"]runas['"]/i, 'starfield-splash-elevation-forbidden', 'Splash must not elevate.'],
    [/Register-ScheduledTask|New-ScheduledTask|schtasks(?:\.exe)?/i, 'starfield-splash-task-authority-forbidden', 'Splash must not create scheduled tasks.'],
    [/\bgit(?:\.exe)?\s+(?:push|reset|clean|rebase|checkout|switch|merge|stash)\b/i, 'starfield-splash-git-mutation-forbidden', 'Splash must not mutate repository history.'],
  ]) forbidPattern(findings, source, pattern, code, summary, path);
}

export function analyzeWindowsAuthorityStarfieldVrSplashReviewV1(input = {}) {
  const repository = text(input.repository);
  const sourceHead = text(input.sourceHead).toLowerCase();
  const paths = escalationPaths(input.analysis);
  if (repository !== 'Cheekyfellastef/stephan-os' || !EXACT_HEAD.test(sourceHead) || paths.length !== 2) {
    return Object.freeze({ eligible: false, clean: false, findings: Object.freeze([]), reviewedPaths: Object.freeze([]), proofRefs: Object.freeze([]), finalVerdict: 'WINDOWS_AUTHORITY_STARFIELD_VR_SPLASH_SPECIALIST_NOT_ELIGIBLE' });
  }

  const sources = Array.isArray(input.sources) ? input.sources : [];
  const findings = [];
  const proofRefs = [];
  if (sources.length !== 2) {
    findings.push(finding('windows-authority-source-evidence-invalid', 'Exactly two immutable exact-head Starfield VR splash source records are required.', WINDOWS_AUTHORITY_STARFIELD_VR_SPLASH_PATHS_V1[0]));
  } else {
    for (const path of WINDOWS_AUTHORITY_STARFIELD_VR_SPLASH_PATHS_V1) {
      const candidates = sources.filter((source) => source?.path === path);
      if (candidates.length !== 1 || !exactSource(candidates[0], repository, sourceHead, path)) {
        findings.push(finding('windows-authority-source-evidence-invalid', 'Each Starfield VR splash surface requires one immutable exact-head source record.', path));
        continue;
      }
      if (path.endsWith('install-starfield-vr-desktop-shortcut.ps1')) reviewInstaller(candidates[0].content, path, findings);
      else reviewSplash(candidates[0].content, path, findings);
      proofRefs.push(`proofs/windows-authority-starfield-vr-splash/${path}@${sourceHead}#${candidates[0].blobSha}:${candidates[0].size}`);
    }
  }

  const clean = findings.length === 0;
  return Object.freeze({
    eligible: true,
    clean,
    findings: Object.freeze(findings),
    reviewedPaths: WINDOWS_AUTHORITY_STARFIELD_VR_SPLASH_PATHS_V1,
    proofRefs: Object.freeze(proofRefs),
    finalVerdict: clean ? 'WINDOWS_AUTHORITY_STARFIELD_VR_SPLASH_SPECIALIST_CLEAN' : 'WINDOWS_AUTHORITY_STARFIELD_VR_SPLASH_SPECIALIST_FINDINGS',
  });
}
