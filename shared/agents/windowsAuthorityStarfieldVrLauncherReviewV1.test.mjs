import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  WINDOWS_AUTHORITY_STARFIELD_VR_LAUNCHER_PATHS_V1,
  analyzeWindowsAuthorityStarfieldVrLauncherReviewV1,
} from './windowsAuthorityStarfieldVrLauncherReviewV1.mjs';

const repository = 'Cheekyfellastef/stephan-os';
const sourceHead = 'a'.repeat(40);
const path = WINDOWS_AUTHORITY_STARFIELD_VR_LAUNCHER_PATHS_V1[0];

function gitBlobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update('blob ' + bytes.length + '\0', 'utf8').update(bytes).digest('hex');
}
function source(content, overrides = {}) {
  return {
    schemaVersion: 'stephanos.windows-authority-source.v1',
    repository,
    path,
    ref: sourceHead,
    exists: true,
    size: Buffer.byteLength(content, 'utf8'),
    blobSha: gitBlobSha(content),
    content,
    ...overrides,
  };
}
const analysis = {
  findings: [{ severity: 'P0', code: 'unsupported-high-risk-surface', path }],
  counts: { P0: 1, P1: 0, P2: 0 },
};
const cleanLauncher = [
  "$decisionScript = Join-Path $repositoryRoot 'scripts\\\\starfield-vr-launch-decision.mjs'",
  "'stephanos.starfield-vr-launch-profile.v1'",
  "'meta-air-link'",
  "@('mutar-openxr', 'vorpx')",
  "Get-Process -Name 'OculusDash'",
  "Get-ItemPropertyValue -LiteralPath 'HKLM:\\\\SOFTWARE\\\\Khronos\\\\OpenXR\\\\1' -Name 'ActiveRuntime'",
  'Get-FileHash -LiteralPath $Path -Algorithm SHA256',
  '$metaClientPath = Resolve-MetaClient',
  '$airLinkActive = Test-AirLinkSessionActive',
  'if (-not $ReadinessOnly -and -not $airLinkActive -and $metaClientPath) {',
  '  Start-Process -FilePath $metaClientPath | Out-Null',
  '}',
  'try {',
  '  $observationsJson = $observations | ConvertTo-Json -Depth 10',
  '  [System.IO.File]::WriteAllText(',
  '    $observationsPath,',
  '    $observationsJson,',
  '    (New-Object System.Text.UTF8Encoding($false))',
  '  )',
  '  $decisionJson = & $NodeExecutablePath $decisionScript --profile $ProfilePath --observations $observationsPath 2>&1 | Out-String',
  '}',
  'catch {',
  "  Complete-BlockedLaunch -Blockers @('canonical-launch-decision-unreadable')",
  '}',
  'if ($ReadinessOnly) {',
  '  if (-not $decision.ok) { exit 2 }',
  '  exit 0',
  '}',
  'if (-not $decision.ok) {',
  "  Complete-BlockedLaunch -Blockers @('decision-blocked')",
  '}',
  '$launchExecutable = (Resolve-Path -LiteralPath $gameLaunchPath).Path',
  '$workingDirectory = (Resolve-Path -LiteralPath $gameInstallationRoot).Path',
  "if ($decision.action -eq 'LAUNCH_VORPX') {",
  '  $companionExecutable = (Resolve-Path -LiteralPath $companionExecutablePath).Path',
  '  $companionProcess = Start-Process -FilePath $companionExecutable -PassThru',
  '}',
  '$gameProcess = Start-Process -FilePath $launchExecutable -WorkingDirectory $workingDirectory -PassThru',
  "$message = 'Nothing was changed and flat Starfield was not started.'",
].join('\n');

function input(content = cleanLauncher, overrides = {}) {
  return {
    repository,
    sourceHead,
    analysis,
    sources: [source(content)],
    ...overrides,
  };
}

test('clean exact Starfield launcher escalation is specialist eligible and clean', () => {
  const result = analyzeWindowsAuthorityStarfieldVrLauncherReviewV1(input());
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true, JSON.stringify(result.findings));
  assert.deepEqual(result.reviewedPaths, [path]);
  assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_STARFIELD_VR_LAUNCHER_SPECIALIST_CLEAN');
});

test('wrong or widened escalation estate is not eligible', () => {
  assert.equal(analyzeWindowsAuthorityStarfieldVrLauncherReviewV1({
    ...input(),
    analysis: { findings: [{ severity: 'P0', code: 'unsupported-high-risk-surface', path: 'scripts/windows/other.ps1' }] },
  }).eligible, false);
  assert.equal(analyzeWindowsAuthorityStarfieldVrLauncherReviewV1({
    ...input(),
    analysis: { findings: [...analysis.findings, ...analysis.findings] },
  }).eligible, false);
});

test('wrong-head or malformed source evidence fails closed', () => {
  const bad = source(cleanLauncher, { ref: 'b'.repeat(40) });
  const result = analyzeWindowsAuthorityStarfieldVrLauncherReviewV1(input(cleanLauncher, { sources: [bad] }));
  assert.equal(result.eligible, true);
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'windows-authority-source-evidence-invalid'));
});

test('BOM regression and dynamic authority are rejected', () => {
  const hostile = cleanLauncher + '\n' +
    '$observations | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $observationsPath -Encoding UTF8\n' +
    'Invoke-Expression $payload\n';
  const result = analyzeWindowsAuthorityStarfieldVrLauncherReviewV1(input(hostile));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'starfield-launcher-observation-bom-regression'));
  assert.ok(result.findings.some((item) => item.code === 'starfield-launcher-dynamic-execution-forbidden'));
});

test('literal direct game launch, downloads and system authority are rejected', () => {
  const hostile = cleanLauncher + '\n' +
    "Start-Process -FilePath 'C:\\Games\\Starfield.exe'\n" +
    'Invoke-WebRequest https://example.invalid/mod.zip\n' +
    "Register-ScheduledTask -TaskName 'x'\n";
  const result = analyzeWindowsAuthorityStarfieldVrLauncherReviewV1(input(hostile));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'starfield-launcher-direct-game-path-forbidden'));
  assert.ok(result.findings.some((item) => item.code === 'starfield-launcher-download-install-authority-forbidden'));
  assert.ok(result.findings.some((item) => item.code === 'starfield-launcher-system-authority-forbidden'));
});

test('comment, string and dead-code copies cannot satisfy the executable decision gate', () => {
  const gate = [
    'if (-not $decision.ok) {',
    "  Complete-BlockedLaunch -Blockers @('decision-blocked')",
    '}',
  ].join('\n');

  const commentOnly = cleanLauncher.replace(gate, [
    '# if (-not $decision.ok) {',
    "Complete-BlockedLaunch -Blockers @('decision-blocked')",
    '# }',
  ].join('\n'));
  const stringOnly = cleanLauncher.replace(gate, [
    "$decoy = 'if (-not $decision.ok)'",
    "Complete-BlockedLaunch -Blockers @('decision-blocked')",
  ].join('\n'));
  const deadCode = cleanLauncher.replace(gate, [
    'if ($false) {',
    '  if (-not $decision.ok) {',
    "    Complete-BlockedLaunch -Blockers @('decision-blocked')",
    '  }',
    '}',
  ].join('\n'));

  for (const candidate of [commentOnly, stringOnly, deadCode]) {
    const result = analyzeWindowsAuthorityStarfieldVrLauncherReviewV1(input(candidate));
    assert.equal(result.clean, false);
    assert.ok(result.findings.some((item) => item.code === 'starfield-launcher-decision-gate-not-executable'));
  }
});

test('variable-backed extra process start is rejected by the closed process estate', () => {
  const hostile = cleanLauncher + '\n' +
    "$flat = Join-Path $gameInstallationRoot 'Starfield.exe'\n" +
    'Start-Process -FilePath $flat\n';
  const result = analyzeWindowsAuthorityStarfieldVrLauncherReviewV1(input(hostile));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'starfield-launcher-process-estate-not-closed'));
});

test('extra call-operator process invocation is rejected', () => {
  const hostile = cleanLauncher + '\n' +
    "$flat = Join-Path $gameInstallationRoot 'Starfield.exe'\n" +
    '& $flat\n';
  const result = analyzeWindowsAuthorityStarfieldVrLauncherReviewV1(input(hostile));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'starfield-launcher-call-operator-estate-not-closed'));
});
