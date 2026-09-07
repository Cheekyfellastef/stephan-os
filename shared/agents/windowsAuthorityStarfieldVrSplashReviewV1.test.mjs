import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import {
  WINDOWS_AUTHORITY_STARFIELD_VR_SPLASH_PATHS_V1,
  analyzeWindowsAuthorityStarfieldVrSplashReviewV1,
} from './windowsAuthorityStarfieldVrSplashReviewV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const HEAD = 'a'.repeat(40);

function gitBlobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`, 'utf8').update(bytes).digest('hex');
}
function source(path, content) {
  return {
    schemaVersion: 'stephanos.windows-authority-source.v1',
    repository: REPOSITORY,
    path,
    ref: HEAD,
    exists: true,
    size: Buffer.byteLength(content, 'utf8'),
    blobSha: gitBlobSha(content),
    content,
  };
}
const installer = `[CmdletBinding(SupportsShouldProcess = $true)]
$repositoryRoot = 'x'
$splashLauncherScript = Join-Path $repositoryRoot 'scripts\\windows\\launch-starfield-vr-with-splash.ps1'
$desktopPath = 'x'
$shortcutPath = Join-Path $desktopPath 'Starfield VR.lnk'
$powershellExecutable = Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'
$arguments = "-WindowStyle Hidden"
$ws = New-Object -ComObject WScript.Shell
$shortcut = $ws.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $powershellExecutable
$shortcut.Arguments = $arguments
`;
const splash = `[CmdletBinding()]
$repositoryRoot = 'x'
$launcherScript = Join-Path $repositoryRoot 'scripts\\windows\\launch-starfield-vr.ps1'
$powershellExecutable = Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'
function Invoke-StarfieldVrLauncher { param([switch]$ReadinessOnly)
  $arguments = @()
  if ($ReadinessOnly) { $arguments += '-ReadinessOnly' }
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $powershellExecutable
}
Invoke-StarfieldVrLauncher -ReadinessOnly
$ready = 'STARFIELD_VR_LAUNCH_READY'
$blocked = 'Flat Starfield was not started'
$details = 'Show details'
`;

function input(overrides = {}) {
  return {
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: {
      findings: WINDOWS_AUTHORITY_STARFIELD_VR_SPLASH_PATHS_V1.map((path) => ({
        severity: 'P0',
        code: 'unsupported-high-risk-surface',
        path,
      })),
    },
    sources: [
      source(WINDOWS_AUTHORITY_STARFIELD_VR_SPLASH_PATHS_V1[0], installer),
      source(WINDOWS_AUTHORITY_STARFIELD_VR_SPLASH_PATHS_V1[1], splash),
    ],
    ...overrides,
  };
}

test('qualifies only the exact two Starfield VR splash PowerShell escalations', () => {
  const result = analyzeWindowsAuthorityStarfieldVrSplashReviewV1(input());
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true);
  assert.deepEqual(result.findings, []);
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_STARFIELD_VR_SPLASH_SPECIALIST_CLEAN');
});

test('wrong or partial escalation estate is not eligible', () => {
  const partial = input();
  partial.analysis.findings = partial.analysis.findings.slice(0, 1);
  assert.equal(analyzeWindowsAuthorityStarfieldVrSplashReviewV1(partial).eligible, false);
});

test('exact source identity is mandatory', () => {
  const tampered = input();
  tampered.sources[0] = { ...tampered.sources[0], blobSha: 'b'.repeat(40) };
  const result = analyzeWindowsAuthorityStarfieldVrSplashReviewV1(tampered);
  assert.equal(result.eligible, true);
  assert.equal(result.clean, false);
  assert.match(result.findings[0].code, /source-evidence-invalid/);
});

test('elevation, direct game launch and download authority fail closed', () => {
  const widened = input();
  widened.sources = [
    source(WINDOWS_AUTHORITY_STARFIELD_VR_SPLASH_PATHS_V1[0], `${installer}\nStart-Process -Verb RunAs\n`),
    source(WINDOWS_AUTHORITY_STARFIELD_VR_SPLASH_PATHS_V1[1], `${splash}\nInvoke-WebRequest https://example.test\nStart-Process -FilePath Starfield.exe\n`),
  ];
  const result = analyzeWindowsAuthorityStarfieldVrSplashReviewV1(widened);
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'starfield-shortcut-elevation-forbidden'));
  assert.ok(result.findings.some((item) => item.code === 'starfield-splash-install-mutation-forbidden'));
  assert.ok(result.findings.some((item) => item.code === 'starfield-splash-direct-game-launch-forbidden'));
});
