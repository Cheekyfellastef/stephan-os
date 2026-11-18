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

// Use the exact current reviewed governor as the adversarial mutation base.
// Historic complete-source registrations remain retained by production code.
// This candidate registration is still a protected self-change and the
// separate bootstrap regression at the end of this file must keep holding.
const governor = await readFile(new URL('./fixtures/windows-authority-vr-resource-governor-review-v1/sovereign-reviewer-256k.ps1', import.meta.url), 'utf8');

// Preserve the exact pre-repair c451 source independently of production edits.
// The historical transformations below reconstruct the two registered source
// blobs from ca89e8b0 and c90b7caa. No fixture qualifies the current governor.
const historicalFixture = JSON.parse(await readFile(
  new URL('./fixtures/vrResourceGovernorHistoricalC451V1.json', import.meta.url), 'utf8'));
const source = historicalFixture.source;
const productionGovernor = await readFile(new URL('../../scripts/windows/run-vr-resource-governor.ps1', import.meta.url), 'utf8');
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
const historicalIdleGovernor = mainGovernor.replace(guardStatement, guardStatement + idleAddition)
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

test('fixture preserves exact current reviewer governor source blob', () => {
  assert.equal(blobSha(governor), 'fec5255f808f303a3c0d61de9409c7eb98ceec92');
  assert.equal(Buffer.byteLength(governor, 'utf8'), 57827);
});

for (const [name, content] of [['current reviewer governor', governor]]) {
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

test('historical fixture preserves exact pre-repair main bytes without qualification authority', () => {
  assert.equal(historicalFixture.schemaVersion, 'stephanos.test-only-historical-vr-governor-fixture.v1');
  assert.equal(historicalFixture.repository, REPOSITORY);
  assert.equal(historicalFixture.sourcePath, PATH);
  assert.equal(historicalFixture.sourceHead, 'c4515529b7aa0be44a2e959446744bfd24633e80');
  assert.equal(historicalFixture.blobSha, '5118b0727e47a5f29e33b6b7c58c49ba754ece1a');
  assert.equal(blobSha(source), historicalFixture.blobSha);
  assert.equal(Buffer.byteLength(source, 'utf8'), historicalFixture.size);
  assert.equal(historicalFixture.size, 49829);
  assert.equal(historicalFixture.sourceSha256, 'd70b83cf4a6620a02ebcc17a0f0c55dccd6bb204f39e5dde85babacd7b13c4a4');
  assert.equal(createHash('sha256').update(source, 'utf8').digest('hex'), historicalFixture.sourceSha256);
  assert.equal(historicalFixture.testOnly, true);
  for (const key of ['qualificationAuthority', 'runtimeMutationAllowed', 'mergeAuthority']) {
    assert.equal(historicalFixture[key], false);
  }
});

test('historical transformations preserve the exact registered main and idle-repair source blobs', () => {
  assert.equal(blobSha(mainGovernor), 'ae71e1e79ead63efeb5a4d73f4bce6a01ee0f1d9');
  assert.equal(blobSha(historicalIdleGovernor), '9513dfe995a35087e1d715ef0c4dff4ca3578295');
});

test('current production governor is not qualified by historical source registrations', () => {
  rejects(productionGovernor);
});

for (const [name, content] of [['historical main', mainGovernor], ['original idle repair', historicalIdleGovernor]]) {
  test(name + ' retains the registered historical protection contracts without granting authority', () => {
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
  ['idle refresh beyond its registered interval', '($now.ToUniversalTime() - $observedUtc).TotalSeconds -ge 5', '($now.ToUniversalTime() - $observedUtc).TotalSeconds -ge 30'],
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

test('rejected source variant must not emit positive proof references', () => {
  // This source has a self-consistent SHA, size and head envelope but unregistered executable bytes.
  const changed = replaceOnce(governor, observationMarker,
    '# non-registered adversarial source variant\n' + observationMarker);
  const rejected = analyzeWindowsAuthorityVrResourceGovernorReviewV1(input(changed));
  assert.equal(rejected.eligible, true);
  assert.equal(rejected.clean, false);
  assert.equal(rejected.findings.some((item) => item.code === 'vr-governor-source-contract-unregistered'), true);
  assert.deepEqual(rejected.proofRefs, [], 'P0 findings cannot emit a positive reviewed-source proof');
  const registered = analyzeWindowsAuthorityVrResourceGovernorReviewV1(input());
  assert.equal(registered.clean, true);
  assert.equal(registered.proofRefs.length, 1);
});

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


test('one exact P0 escalation rejects inconsistent typed counts and false-clean verdicts', () => {
  const baseline = input();
  assert.equal(analyzeWindowsAuthorityVrResourceGovernorReviewV1(baseline).clean, true);
  for (const [reason, override] of [
    ['widened P0', { counts: { P0: 13, P1: 0, P2: 0 } }],
    ['zero P0', { counts: { P0: 0, P1: 0, P2: 0 } }],
    ['missing P0', { counts: { P1: 0, P2: 0 } }],
    ['extra P1', { counts: { P0: 1, P1: 2, P2: 0 } }],
    ['extra P2', { counts: { P0: 1, P1: 0, P2: 1 } }],
    ['coerced P0', { counts: { P0: '1', P1: 0, P2: 0 } }],
    ['missing counts', { counts: undefined }],
    ['null counts', { counts: null }],
    ['array counts', { counts: [1, 0, 0] }],
    ['false clean', { verdict: 'clean' }],
    ['false pass', { verdict: 'pass' }],
    ['missing verdict', { verdict: undefined }],
  ]) {
    const candidate = input(governor, { analysis: { ...baseline.analysis, ...override } });
    const result = analyzeWindowsAuthorityVrResourceGovernorReviewV1(candidate);
    assert.equal(result.eligible, false, reason);
    assert.equal(result.clean, false, reason);
    assert.deepEqual(result.proofRefs, [], reason);
    assert.equal(result.mergeAuthority, false, reason);
    assert.equal(result.finalVerdict, 'WINDOWS_AUTHORITY_VR_RESOURCE_GOVERNOR_SPECIALIST_NOT_APPLICABLE', reason);
  }
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


test('virtual Air Link reviewer fixture requires a fresh UTC timestamp, not stale or future input', () => {
  const body = governor.split('function Test-VirtualAirLinkTestActive {')[1]
    ?.split('function Get-AirLinkSignal {')[0] || '';
  for (const marker of [
    '$updatedAtUtc -cnotmatch', '[DateTimeOffset]::TryParse(',
    '[System.Globalization.CultureInfo]::InvariantCulture',
    '[System.Globalization.DateTimeStyles]::AssumeUniversal',
    '$ageMinutes -lt 0', '$ageMinutes -gt 30',
  ]) assert.ok(body.includes(marker), marker);
  // Deterministic semantic model, not a substitute for Windows PowerShell tests.
  const now = Date.parse('2026-11-14T15:40:00.000Z');
  const valid = value => typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/.test(value)
    && Number.isFinite(Date.parse(value))
    && Date.parse(value) <= now && now - Date.parse(value) <= 1800000;
  for (const [value, expected] of [
    ['2026-11-14T15:39:59.000Z', true],
    ['2026-11-14T15:10:00.000Z', true],
    ['2026-11-14T15:09:59.000Z', false],
    ['2026-11-14T15:40:01.000Z', false],
    ['2026-11-15T15:40:00.000Z', false],
    ['bad', false], ['', false], [null, false], [undefined, false],
    ['2026-11-14T15:39:59.000+00:00', false],
    ['2026-11-14T15:39:59', false],
    ['2026-11-14T15:39:59.000z', false],
    ['2026-11-14T15:39:59.1234567Z', true],
  ]) assert.equal(valid(value), expected, String(value));
});

test('reviewer cooldown gate protects the prior phase before any reviewer lease or REVIEWING projection', () => {
  const helper = governor.split('function Test-ReviewerReservationBlockedByCooldown {')[1]
    ?.split('function Append-TelemetryEvent {')[0] || '';
  assert.match(helper, /phase -in @\('GAMING','PREPARING'\)/);
  assert.match(helper, /phase -ne 'COOLDOWN'/);
  assert.ok(helper.includes('Test-InconsistentGovernorIdleState -State $State'));
  assert.match(helper, /DateTimeOffset\]::TryParse/);
  assert.match(helper, /-not \$parsed -or/);
  const effective = governor.split('function Resolve-EffectiveState {')[1]
    ?.split('function Invoke-Reconcile {')[0] || '';
  const cooldownCheck = effective.indexOf('Test-ReviewerReservationBlockedByCooldown -State $PriorState');
  assert.ok(cooldownCheck > -1);
  assert.ok(cooldownCheck < effective.indexOf("phase = 'REVIEWING'"));
  assert.match(effective.slice(cooldownCheck, effective.indexOf("phase = 'REVIEWING'")),
    /phase = 'COOLDOWN'[\s\S]*active = \$true[\s\S]*cooldownUntilUtc = \$protectedUntilUtc/);
  assert.match(effective, /\$PriorState\.phase -ne 'COOLDOWN' -or -not \$deadlineKnown[\s\S]*\$nowUtc\.AddSeconds\(\$protectedSeconds\)/);
  assert.ok(effective.indexOf('$nowUtc.AddSeconds($protectedSeconds)') < effective.indexOf("phase = 'REVIEWING'"));
  const prepare = governor.split("if ($Action -eq 'PrepareGaming') {")[1]
    ?.split("if ($Action -eq 'CancelPrepare') {")[0] || '';
  assert.ok(prepare.indexOf('REVIEWER_RESERVATION_BLOCKED_BY_GAMING_COOLDOWN') > -1);
  assert.ok(prepare.indexOf('REVIEWER_RESERVATION_BLOCKED_BY_GAMING_COOLDOWN')
    < prepare.indexOf('Write-PrepareLease -RequestedProcessName'));
});

test('reviewer-only cooldown policy blocks active or unknown deadlines, allowing only expiry', () => {
  // Portable semantic branch model; not a native PowerShell or installed-runtime receipt.
  const now = Date.parse('2026-11-18T02:14:00.000Z');
  const blocked = (phase, deadline) => {
    if (phase === 'GAMING' || phase === 'PREPARING') return true;
    if (phase !== 'COOLDOWN') return false;
    const parsed = Date.parse(deadline);
    return !Number.isFinite(parsed) || now < parsed;
  };
  for (const [phase, deadline, expected] of [
    ['COOLDOWN', '2026-11-18T02:15:00Z', true],
    ['COOLDOWN', '2026-11-18T02:14:01Z', true],
    ['COOLDOWN', '2026-11-18T02:14:00Z', false],
    ['COOLDOWN', '2026-11-18T02:13:59Z', false],
    ['COOLDOWN', 'not-a-timestamp', true],
    ['COOLDOWN', '', true],
    ['COOLDOWN', null, true],
    ['GAMING', '', true],
    ['PREPARING', null, true],
    ['NORMAL', '2026-11-18T02:15:00Z', false],
    ['REVIEWING', '2026-11-18T02:15:00Z', false],
  ]) assert.equal(blocked(phase, deadline), expected, phase + ': ' + String(deadline));
});

test('game exit before watcher reconciliation cannot create a reviewer lease or clear prior game cooldown', () => {
  // Deterministic portable state model, NOT native PowerShell or installed proof.
  const prior = { phase: 'GAMING', profile: { name: 'game-vr', parkAllModels: true, cooldownSeconds: 90 }, cooldownUntilUtc: '' };
  const now = Date.parse('2026-11-18T03:20:00Z');
  const blocked = (state, at) => ['GAMING', 'PREPARING'].includes(state.phase)
    || (state.phase === 'COOLDOWN' && (!Number.isFinite(Date.parse(state.cooldownUntilUtc))
      || at < Date.parse(state.cooldownUntilUtc)));
  assert.equal(blocked(prior, now), true, 'reviewer lease rejected before writing any lease');
  const afterWatcher = {
    phase: 'COOLDOWN',
    active: true,
    profile: prior.profile,
    cooldownUntilUtc: new Date(now + prior.profile.cooldownSeconds * 1000).toISOString(),
  };
  assert.equal(afterWatcher.profile.parkAllModels, true);
  assert.equal(afterWatcher.profile.name, 'game-vr');
  assert.equal(blocked(afterWatcher, now + 30000), true, 'CancelPrepare must not release protected cooldown');
  assert.equal(blocked(afterWatcher, now + 90000), false, 'reviewer becomes eligible only after actual expiry');
  const helper = governor.split('function Test-ReviewerReservationBlockedByCooldown {')[1]
    ?.split('function Append-TelemetryEvent {')[0] || '';
  const effective = governor.split('function Resolve-EffectiveState {')[1]
    ?.split('function Invoke-Reconcile {')[0] || '';
  assert.ok(helper.includes("if ($phase -in @('GAMING','PREPARING')) { return $true }"));
  assert.match(effective, /\$protectedProfile = \$PriorState\.profile[\s\S]*\$protectedUntilUtc = \$nowUtc\.AddSeconds\(\$protectedSeconds\)/);
  assert.ok(effective.indexOf('$protectedUntilUtc = $nowUtc.AddSeconds($protectedSeconds)')
    < effective.indexOf("phase = 'REVIEWING'"));
});

test('corrupted persisted COOLDOWN cannot release gaming model protection during watcher or cancellation', () => {
  // Exact-fixture source assertion plus portable model; not native Windows/installed proof.
  const resolver = governor.split('function Resolve-EffectiveState {')[1]
    ?.split('function Invoke-Reconcile {')[0] || '';
  const guard = 'if ($priorWasProtected -and ($priorInconsistent -or $cooldownUntil -eq [DateTime]::MinValue)) {';
  assert.ok(resolver.includes(guard), 'missing or malformed COOLDOWN must reconstruct the deadline');
  const fallback = resolver.slice(resolver.indexOf('    $cooldownUntil = [DateTime]::MinValue'));
  assert.ok(!fallback.includes("[string]$PriorState.phase -ne 'COOLDOWN'"),
    'corrupt persisted COOLDOWN cannot be excluded from the no-lease recovery path');
  assert.ok(resolver.includes('$cooldownUntil = $nowUtc.AddSeconds([Math]::Max(30, [int]$profile.cooldownSeconds))'));
  assert.ok(resolver.indexOf(guard) < resolver.lastIndexOf("phase = 'NORMAL'"),
    'recovery must run before any NORMAL-state release');
  const now = Date.parse('2026-11-18T04:18:00Z');
  const resolve = (phase, raw, seconds) => {
    let deadline = typeof raw === 'string' && raw.trim() ? Date.parse(raw) : NaN;
    if (['GAMING', 'PREPARING', 'COOLDOWN'].includes(phase) && !Number.isFinite(deadline)) {
      deadline = now + Math.max(30, seconds) * 1000;
    }
    return deadline > now ? 'COOLDOWN' : 'NORMAL';
  };
  for (const [phase, raw, seconds, expected] of [
    ['COOLDOWN', '', 90, 'COOLDOWN'],
    ['COOLDOWN', 'corrupt-deadline', 90, 'COOLDOWN'],
    ['COOLDOWN', null, 45, 'COOLDOWN'],
    ['COOLDOWN', '2026-11-18T04:19:00Z', 90, 'COOLDOWN'],
    ['COOLDOWN', '2026-11-18T04:17:59Z', 90, 'NORMAL'],
    ['GAMING', '', 90, 'COOLDOWN'],
    ['PREPARING', null, 45, 'COOLDOWN'],
    ['NORMAL', '', 90, 'NORMAL'],
  ]) assert.equal(resolve(phase, raw, seconds), expected, phase + ':' + String(raw));
});


test('unknown or contradictory persisted gaming phase cannot admit reviewer or silently release protection', () => {
  // Exact inert fixture source and deterministic state model; no Windows runtime action.
  const helper = governor.split('function Test-ReviewerReservationBlockedByCooldown {')[1]
    ?.split('function Append-TelemetryEvent {')[0] || '';
  const resolve = governor.split('function Resolve-EffectiveState {')[1]
    ?.split('function Invoke-Reconcile {')[0] || '';
  const shared = governor.split('function Test-InconsistentGovernorIdleState {')[1]
    ?.split('function Test-ReviewerReservationBlockedByCooldown {')[0] || '';
  assert.ok(shared.includes("$phase -notin @('NORMAL','REVIEWING','GAMING','PREPARING','COOLDOWN')"));
  assert.ok(shared.includes("$State.active -eq $true -or $State.localModelAllowed -eq $false"));
  assert.ok(helper.includes('Test-InconsistentGovernorIdleState -State $State'));
  assert.ok(resolve.includes('Test-InconsistentGovernorIdleState -State $PriorState'));
  assert.ok(resolve.includes("if ([string]$PriorState.phase -ne 'COOLDOWN' -or -not $deadlineKnown) {"));
  const blocks = (state) => {
    if (['GAMING','PREPARING'].includes(state.phase)) return true;
    if (!['NORMAL','REVIEWING','COOLDOWN'].includes(state.phase)) return true;
    if (state.phase !== 'COOLDOWN') return state.active === true || state.localModelAllowed === false;
    const deadline = Date.parse(state.cooldownUntilUtc);
    return !Number.isFinite(deadline) || Date.parse('2026-11-18T10:00:00Z') < deadline;
  };
  for (const candidate of [
    {phase:'UNKNOWN',active:true,localModelAllowed:false},
    {phase:'',active:true,localModelAllowed:false},
    {phase:'NORMAL',active:true,localModelAllowed:false},
    {phase:'REVIEWING',active:false,localModelAllowed:false},
    {phase:'COOLDOWN',active:true,localModelAllowed:false,cooldownUntilUtc:'bad'},
  ]) assert.equal(blocks(candidate),true,JSON.stringify(candidate));
  for (const candidate of [
    {phase:'NORMAL',active:false,localModelAllowed:true},
    {phase:'REVIEWING',active:false,localModelAllowed:true},
    {phase:'COOLDOWN',active:false,localModelAllowed:true,cooldownUntilUtc:'2026-11-18T09:59:59Z'},
  ]) assert.equal(blocks(candidate),false,JSON.stringify(candidate));
});

test('watcher and cancellation preserve contradictory or unknown persisted idle state until cooldown, then admit only safe idle', () => {
  // Model/property regression tied to the same exact helper used by both
  // admission and no-lease reconciliation. Not native Windows proof.
  const resolver = governor.split('function Resolve-EffectiveState {')[1]
    ?.split('function Invoke-Reconcile {')[0] || '';
  const helper = governor.split('function Test-InconsistentGovernorIdleState {')[1]
    ?.split('function Test-ReviewerReservationBlockedByCooldown {')[0] || '';
  const admission = governor.split('function Test-ReviewerReservationBlockedByCooldown {')[1]
    ?.split('function Append-TelemetryEvent {')[0] || '';
  assert.ok(resolver.includes('$priorInconsistent = (Test-InconsistentGovernorIdleState -State $PriorState)'));
  assert.ok(resolver.includes('$priorInconsistent -or $cooldownUntil -eq [DateTime]::MinValue'));
  assert.ok(admission.includes('(Test-InconsistentGovernorIdleState -State $State)'));
  assert.ok(helper.includes("$phase -in @('NORMAL','REVIEWING')"));
  const now = Date.parse('2026-11-18T10:40:00Z');
  const inconsistent = state => !['NORMAL','REVIEWING','GAMING','PREPARING','COOLDOWN'].includes(state.phase)
    || (['NORMAL','REVIEWING'].includes(state.phase) &&
      (state.active === true || state.localModelAllowed === false));
  const protectWithoutLease = state => ['GAMING','PREPARING','COOLDOWN'].includes(state.phase)
    || inconsistent(state);
  const afterReconcile = state => {
    const expiry = Date.parse(state.cooldownUntilUtc || '');
    const deadline = protectWithoutLease(state) && (inconsistent(state) || !Number.isFinite(expiry))
      ? now + 90_000 : expiry;
    return Number.isFinite(deadline) && now < deadline ? 'COOLDOWN' : 'NORMAL';
  };
  for (const state of [
    { phase:'UNKNOWN', active:false, localModelAllowed:true },
    { phase:'', active:true, localModelAllowed:false },
    { phase:'NORMAL', active:true, localModelAllowed:true },
    { phase:'NORMAL', active:false, localModelAllowed:false },
    { phase:'REVIEWING', active:true, localModelAllowed:true },
    { phase:'REVIEWING', active:false, localModelAllowed:false },
    { phase:'NORMAL', active:false, localModelAllowed:false, cooldownUntilUtc:'2026-11-18T10:39:59Z' },
    { phase:'REVIEWING', active:true, localModelAllowed:true, cooldownUntilUtc:'2026-11-18T10:35:00Z' },
    { phase:'UNKNOWN', active:false, localModelAllowed:true, cooldownUntilUtc:'2026-11-18T10:39:59Z' },
    { phase:'UNKNOWN', active:false, localModelAllowed:true, cooldownUntilUtc:'2026-11-18T12:00:00Z' },
    { phase:'GAMING', active:true, localModelAllowed:false },
    { phase:'COOLDOWN', active:true, localModelAllowed:false, cooldownUntilUtc:'invalid' },
  ]) {
    assert.ok(protectWithoutLease(state), JSON.stringify(state));
    assert.equal(afterReconcile(state), 'COOLDOWN', JSON.stringify(state));
  }
  for (const state of [
    { phase:'NORMAL', active:false, localModelAllowed:true },
    { phase:'REVIEWING', active:false, localModelAllowed:true },
    { phase:'COOLDOWN', active:false, localModelAllowed:true, cooldownUntilUtc:'2026-11-18T10:39:59Z' },
  ]) assert.equal(afterReconcile(state), 'NORMAL', JSON.stringify(state));
  // An expired, consistent COOLDOWN is genuinely completed, not re-started.
  assert.equal(afterReconcile({phase:'COOLDOWN',active:true,localModelAllowed:false,
    cooldownUntilUtc:'2026-11-18T10:39:59Z'}), 'NORMAL');
});


test('unreadable persisted governor record cannot look like first boot and admit reviewer', () => {
  // Exact non-executable fixture assertions plus portable model, not a native
  // Windows PowerShell test or installation certificate.
  const reader = governor.split('function Read-GovernorState {')[1]
    ?.split('function Test-InconsistentGovernorIdleState {')[0] || '';
  assert.ok(reader.includes("throw 'GOVERNOR_PERSISTED_STATE_INVALID_SHAPE'"));
  assert.ok(reader.includes("throw 'GOVERNOR_PERSISTED_STATE_REQUIRED_FIELD_MISSING'"));
  assert.ok(reader.includes("throw 'GOVERNOR_PERSISTED_STATE_REQUIRED_FIELD_INVALID'"));
  assert.ok(reader.includes("foreach ($requiredName in @('phase','active','localModelAllowed'))"));
  assert.ok(reader.includes('$state.active -isnot [bool]'));
  assert.ok(reader.includes('$state.localModelAllowed -isnot [bool]'));
  assert.ok(reader.includes('$state -isnot [pscustomobject]'));
  assert.ok(reader.includes("phase = 'UNKNOWN'"));
  assert.ok(reader.includes('active = $true'));
  assert.ok(reader.includes('localModelAllowed = $false'));
  assert.ok(reader.includes("reason = 'unreadable-governor-state'"));
  const admission = governor.split('function Test-ReviewerReservationBlockedByCooldown {')[1]
    ?.split('function Append-TelemetryEvent {')[0] || '';
  assert.ok(admission.includes('Test-InconsistentGovernorIdleState -State $State'));
  const resolver = governor.split('function Resolve-EffectiveState {')[1]
    ?.split('function Invoke-Reconcile {')[0] || '';
  assert.ok(resolver.includes('$priorInconsistent = (Test-InconsistentGovernorIdleState -State $PriorState)'));
  assert.ok(resolver.includes('$cooldownUntil = $nowUtc.AddSeconds([Math]::Max(30, [int]$profile.cooldownSeconds))'));
  const read = (exists, raw) => {
    if (!exists) return null;
    try {
      const state = JSON.parse(raw);
      if (!state || Array.isArray(state) || typeof state !== 'object') throw new Error('shape');
      for (const key of ['phase','active','localModelAllowed']) {
        if (!Object.prototype.hasOwnProperty.call(state,key)) throw new Error('required');
      }
      if (typeof state.phase !== 'string' || typeof state.active !== 'boolean' ||
          typeof state.localModelAllowed !== 'boolean') throw new Error('type');
      return state;
    } catch {
      return { phase: 'UNKNOWN', active: true, localModelAllowed: false, cooldownUntilUtc: '' };
    }
  };
  assert.equal(read(false, '{bad'), null, 'missing file is distinct from malformed present file');
  for (const raw of ['{', '{bad', 'null', '[]', '17', '"ok"']) {
    const state = read(true, raw);
    assert.equal(state.phase, 'UNKNOWN', raw);
    assert.equal(state.active, true, raw);
    assert.equal(state.localModelAllowed, false, raw);
  }
  for (const raw of [
    '{}', '{"phase":"NORMAL"}', '{"phase":"NORMAL","active":false}',
    '{"phase":"NORMAL","localModelAllowed":true}',
    '{"phase":"NORMAL","active":"false","localModelAllowed":true}',
    '{"phase":"NORMAL","active":false,"localModelAllowed":"true"}',
    '{"phase":7,"active":false,"localModelAllowed":true}',
    '{"phase":"REVIEWING","active":null,"localModelAllowed":true}',
    '{"phase":"COOLDOWN","active":false,"localModelAllowed":null,"cooldownUntilUtc":"2026-11-18T10:00:00Z"}',
  ]) {
    const state = read(true,raw);
    assert.equal(state.phase,'UNKNOWN',raw);
    assert.equal(state.active,true,raw);
    assert.equal(state.localModelAllowed,false,raw);
  }
  for (const raw of [
    '{"phase":"NORMAL","active":false,"localModelAllowed":true}',
    '{"phase":"GAMING","active":true,"localModelAllowed":false}',
    '{"phase":"COOLDOWN","active":true,"localModelAllowed":false}',
  ]) assert.equal(read(true,raw).phase,JSON.parse(raw).phase,raw);
});
