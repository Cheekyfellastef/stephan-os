import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  WINDOWS_AUTHORITY_VR_RESOURCE_GOVERNOR_PATHS_V1,
  analyzeWindowsAuthorityVrResourceGovernorReviewV1,
} from './windowsAuthorityVrResourceGovernorReviewV1.mjs';
import { analyzeIndependentSecurityReviewV2 } from './operatorMergeApprovalBoundaryV2.mjs';
import { isApprovalBoundaryBootstrapAnalysis } from './operatorMergeApprovalGate.mjs';

const PATH = WINDOWS_AUTHORITY_VR_RESOURCE_GOVERNOR_PATHS_V1[0];
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const HEAD = 'a'.repeat(40);

function blobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
}

// Use the actual preserved governor, not a bag of literals that omits its
// executable control flow. Both fixture identities are authenticated source
// blobs from ca89e8b0 and c90b7caa; neither is runtime/qualification evidence.
const source = await readFile(new URL('../../scripts/windows/run-vr-resource-governor.ps1', import.meta.url), 'utf8');
const idleStart = source.indexOf('    # Keep an independently observed idle-state heartbeat fresh');
const idleEnd = idleStart < 0 ? -1 : source.indexOf('    if ($phaseChanged', idleStart);
const mainGovernor = idleStart < 0 ? source
  : (source.slice(0, idleStart) + '\n' + source.slice(idleEnd))
    .replace(' -or $idleHeartbeatDue', '');
const idleAddition = [
  '    # Keep an independently observed idle-state heartbeat fresh for bounded',
  '    # GPU/CPU model admission. Without this, Watch refreshes its JSON only on',
  "    # transitions and a safe idle state ages past the reviewer's 30s window.",
  '    # The watcher still scans game/headset signals on every tick BEFORE this.',
  '    $idleHeartbeatDue = $false',
  '    if (-not $effective.active) {',
  '        try {',
  '            $observedUtc = [DateTime]::Parse(',
  '                [string]$prior.updatedAtUtc,',
  '                [System.Globalization.CultureInfo]::InvariantCulture,',
  '                [System.Globalization.DateTimeStyles]::RoundtripKind',
  '            ).ToUniversalTime()',
  '            $idleHeartbeatDue = ($now.ToUniversalTime() - $observedUtc).TotalSeconds -ge 15',
  '        } catch {',
  '            $idleHeartbeatDue = $true',
  '        }',
  '    }',
].join('\n') + '\n';
const guardStatement = '    $guardDue = $effective.active -and ($now - $lastGuardAt).TotalSeconds -ge $guardIntervalSeconds\n';
const governor = mainGovernor.replace(guardStatement, guardStatement + idleAddition)
  .replace('$processChanged -or $guardDue)', '$processChanged -or $guardDue -or $idleHeartbeatDue)');

function input(content = governor, overrides = {}) {
  return {
    repository: REPOSITORY,
    prNumber: 3155,
    branch: 'repair/1574-native-vr-idle-state-freshness-20261017',
    sourceHead: HEAD,
    analysis: {
      findings: [{ severity: 'P0', code: 'unsupported-high-risk-surface', path: PATH }],
      counts: { P0: 1, P1: 0, P2: 0 },
      verdict: 'findings',
    },
    sources: [{
      schemaVersion: 'stephanos.windows-authority-source.v1',
      repository: REPOSITORY,
      path: PATH,
      ref: HEAD,
      exists: true,
      size: Buffer.byteLength(content, 'utf8'),
      blobSha: blobSha(content),
      content,
    }],
    ...overrides,
  };
}

function replaceOnce(content, before, after) {
  assert.equal(content.split(before).length, 2, 'mutation must change one real executable location: ' + before);
  return content.replace(before, after);
}

function rejects(content) {
  assert.notEqual(content, governor, 'adversarial fixture must change the source');
  const result = analyzeWindowsAuthorityVrResourceGovernorReviewV1(input(content));
  assert.equal(result.eligible, true);
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'vr-governor-source-contract-unregistered'),
    JSON.stringify(result.findings));
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.runtimeMutationAllowed, false);
}

test('fixtures preserve exact current-main and original idle-repair source blobs', () => {
  assert.equal(blobSha(mainGovernor), 'ae71e1e79ead63efeb5a4d73f4bce6a01ee0f1d9');
  assert.equal(blobSha(governor), '9513dfe995a35087e1d715ef0c4dff4ca3578295');
});

for (const [name, content] of [['current main', mainGovernor], ['existing idle repair', governor]]) {
  test(name + ' retains the registered current protection contracts without granting authority', () => {
    const result = analyzeWindowsAuthorityVrResourceGovernorReviewV1(input(content));
    assert.equal(result.eligible, true);
    assert.equal(result.clean, true);
    assert.deepEqual(result.findings, []);
    assert.deepEqual(result.reviewedPaths, [PATH]);
    for (const key of ['sourceMutationAllowed', 'mergeAuthority', 'runtimeMutationAllowed', 'providerQualificationAuthority']) {
      assert.equal(result[key], false);
    }
  });
}

test('even harmless comment and indentation changes need a new complete source contract', () => {
  const commented = governor.replace('function Test-RealAirLinkActive {',
    '# formatting-only explanation\nfunction Test-RealAirLinkActive {\n    <# outer <# nested #> comment #>');
  rejects(commented);
});

const observationMarker = "if ($Action -eq 'ObserveAdmission') {";
const injections = [
  ['action reassignment', "$Action = 'Reconcile'"],
  ['Stop-Process alias', 'spps -Id 1 -Force'],
  ['static process launch', "[System.Diagnostics.Process]::Start('calc.exe')"],
  ['native PowerShell launch', "powershell.exe -NoProfile -EncodedCommand 'RwBlAHQALQBEAGEAdABlAA=='"],
  ['dot-sourced process launch', ". { [System.Diagnostics.Process]::Start('calc.exe') }"],
  ['extra model helper definition', 'function Stop-OllamaModel { return $true }'],
  ['newline-before-brace helper shadow', 'function Test-RealAirLinkActive\n{\n    return $false\n}'],
  ['cmdlet shadow', 'function Get-CimInstance { return @() }'],
  ['scoped helper shadow', 'function global:Test-RealAirLinkActive { return $false }'],
  ['an extra suppression call', 'Stop-OllamaRuntimeForRealVr -Enabled $true'],
  ['a second observed-PID stop', 'Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction Stop'],
  ['taskkill', 'taskkill /F /PID 1'],
  ['alternate process kill API', '[System.Diagnostics.Process]::GetProcessById(1).Kill()'],
  ['ordinary new executable binding', '$unregisteredAuthority = $true'],
];

for (const [name, addition] of injections) {
  test('closed executable estate rejects ' + name + ' before action dispatch', () => {
    rejects(replaceOnce(governor, observationMarker, addition + '\n' + observationMarker));
  });
}

const mutations = [
  ['caller-selected action', "'ObserveAdmission','PrepareGaming'", "'ObserveAdmission','RunCommand','PrepareGaming'"],
  ['read-only observation running reconcile', observationMarker + '\n', observationMarker + '\n    Invoke-CurrentReconcile | Out-Null\n'],
  ['read-only observation clearing a lease', '        preparePending = [bool](Test-Path -LiteralPath $preparePath)', '        preparePending = [bool](Clear-PrepareLease)'],
  ['widened real-VR process names', "foreach ($name in @('vrcompositor', 'vrdashboard'))", "foreach ($name in @('vrcompositor', 'vrdashboard', 'notepad'))"],
  ['bypassed Oculus crash evidence', 'return -not (Test-StaleOculusDashAfterCrash)', 'return $false'],
  ['unscoped process inventory', '$underOllamaRoot -and $isRuntime', '$isRuntime'],
  ['unbounded process stopping', 'Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction Stop', 'Stop-Process -Name node -Force -ErrorAction Stop'],
  ['disabled real-VR suppression gate', 'if (-not (Test-RealAirLinkActive)) { return $false }', 'if ($false) { return $false }'],
  ['disabled suppression enable gate', 'if (-not $Enabled) { return [pscustomobject]$result }', 'if ($false) { return [pscustomobject]$result }'],
  ['runtime reappearance bypass', '$reappearanceDetected = [bool]($runtimeReappearanceDetected -or $modelReappearanceDetected)', '$reappearanceDetected = $true'],
  ['slower active-VR guard', '{ 0.5 } else { 5 }', '{ 1 } else { 5 }'],
  ['removed immediate headset eviction', '[void](Invoke-ImmediateVrModelEviction)', '[void]$false'],
  ['idle refresh beyond its registered interval', '$observedUtc).TotalSeconds -ge 15', '$observedUtc).TotalSeconds -ge 30'],
  ['widened Ollama command', '& $OllamaExecutable stop $Model *> $null', '& $OllamaExecutable run $Model *> $null'],
  ['missing prepare proof', '$prepared.zeroLocalModelInvariant -ne $true', '$false'],
];

for (const [name, before, after] of mutations) {
  test('specialist rejects ' + name, () => {
    rejects(replaceOnce(governor, before, after));
  });
}

test('both reappearance sources must retain prior active local-model denial', () => {
  const before = "        $null -ne $PriorState.PSObject.Properties['localModelAllowed'] -and\n        $PriorState.localModelAllowed -eq $false";
  assert.equal(governor.split(before).length, 3);
  for (const index of [0, 1]) {
    let occurrence = 0;
    const mutated = governor.replaceAll(before, () => occurrence++ === index ? '        $true' : before);
    rejects(mutated);
  }
});

test('commented protection code does not count as an executable helper', () => {
  const start = governor.indexOf('function Stop-OllamaRuntimeForRealVr {');
  const end = governor.indexOf('function Invoke-ImmediateVrModelEviction {', start);
  assert.ok(start >= 0 && end > start);
  const mutated = governor.slice(0, start) + '<#\n' + governor.slice(start, end) + '#>\n' + governor.slice(end);
  rejects(mutated);
});

test('wrapping the registered program in an unreachable block fails closed', () => {
  rejects('if ($false) {\n' + governor + '\n}\n');
});

for (const [name, addition] of [
  ['unterminated block comment', '<#'],
  ['unmatched closing brace', '}'],
  ['unterminated string', '"'],
  ['unsupported here-string proof', '@"\nfunction Test-RealAirLinkActive { return $false }\n"@'],
  ['escaped command name', 'St' + String.fromCharCode(96) + 'op-Process -Id 1 -Force'],
]) {
  test('unregistered malformed or unsupported source rejects ' + name, () => {
    rejects(governor + '\n' + addition + '\n');
  });
}

test('block comments cannot splice executable tokens into the registered program', () => {
  const mutated = replaceOnce(governor, 'function Get-LoadedOllamaModels {', 'func<# separator #>tion Get-LoadedOllamaModels {');
  rejects(mutated);
});

for (const [name, mutate] of [
  ['required module import', (body) => '#requires -Modules ExampleUnsafeModule\n' + body],
  ['required elevation', (body) => '#Requires -RunAsAdministrator\n' + body],
  ['argument-mode hash and executable subexpression', (body) => body.replace(
    'Set-StrictMode -Version Latest',
    "Set-StrictMode -Version Latest#$([System.Diagnostics.Process]::Start('calc.exe'))")],
  ['UTF-8 BOM', (body) => '\uFEFF' + body],
  ['CRLF conversion', (body) => body.replaceAll('\n', '\r\n')],
  ['trailing newline', (body) => body + '\n'],
  ['leading indentation', (body) => ' ' + body],
]) {
  test('exact byte contract rejects ' + name + ' without interpreting PowerShell', () => {
    rejects(mutate(governor));
  });
}

test('source identity and single-source custody checks remain fail closed', () => {
  const wrongBlob = input();
  wrongBlob.sources[0].blobSha = '0'.repeat(40);
  assert.equal(analyzeWindowsAuthorityVrResourceGovernorReviewV1(wrongBlob).clean, false);
  const extraSource = input();
  extraSource.sources.push({ ...extraSource.sources[0], path: 'scripts/windows/other.ps1' });
  const result = analyzeWindowsAuthorityVrResourceGovernorReviewV1(extraSource);
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'windows-authority-vr-resource-governor-source-estate-widened'));
});

test('specialist ignores unrelated high-risk surfaces', () => {
  const result = analyzeWindowsAuthorityVrResourceGovernorReviewV1(input(governor, {
    analysis: {
      findings: [{ severity: 'P0', code: 'unsupported-high-risk-surface', path: 'scripts/windows/other.ps1' }],
      counts: { P0: 1, P1: 0, P2: 0 },
      verdict: 'findings',
    },
  }));
  assert.equal(result.eligible, false);
});

test('reviewer and registration changes still require the separate bootstrap boundary', () => {
  const paths = [
    'shared/agents/windowsAuthorityVrResourceGovernorReviewV1.mjs',
    'shared/agents/windowsAuthoritySpecialistReviewV1.mjs',
  ];
  const analysis = analyzeIndependentSecurityReviewV2({
    changedFiles: paths,
    diff: paths.map((path) => 'diff --git a/' + path + ' b/' + path
      + '\n--- a/' + path + '\n+++ b/' + path
      + '\n@@ -1 +1 @@\n-previous\n+current\n').join('\n'),
  });
  assert.equal(analysis.verdict, 'findings');
  assert.equal(analysis.findings.length, 2);
  assert.ok(analysis.findings.every((item) =>
    item.code === 'approval-boundary-v2-self-change-requires-qualified-review'));
  assert.equal(isApprovalBoundaryBootstrapAnalysis(analysis), true);
});
