import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

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
  assert.equal(blobSha(governor), '844e5d11b74a7fa864c0160f76fffd7addfbc221');
  assert.equal(Buffer.byteLength(governor, 'utf8'), 64032);
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

test('direct governor specialist refuses contradictory or noncanonical upstream P0 envelopes', () => {
  // Exercise the actual specialist with the registered exact source bytes;
  // a malformed upstream envelope cannot become a positive reviewer proof.
  const baseline = input(governor).analysis;
  const valid = analyzeWindowsAuthorityVrResourceGovernorReviewV1(
    input(governor, { analysis: { ...baseline, clean: false } }));
  assert.equal(valid.eligible, true);
  assert.equal(valid.clean, true);
  for (const [name, analysis] of [
    ['extra zero count category', { ...baseline, counts: { ...baseline.counts, P3: 0 } }],
    ['extra nonzero count category', { ...baseline, counts: { ...baseline.counts, P3: 1 } }],
    ['contradictory clean true', { ...baseline, clean: true }],
    ['wrong-typed clean', { ...baseline, clean: 'false' }],
    ['normalized lowercase severity', {
      ...baseline, findings: [{ ...baseline.findings[0], severity: 'p0' }],
    }],
    ['array severity', {
      ...baseline, findings: [{ ...baseline.findings[0], severity: ['P0'] }],
    }],
    ['inherited P0/P1/P2 count aliases hidden behind unrelated own keys', {
      ...baseline,
      counts: Object.assign(Object.create({ P0: 1, P1: 0, P2: 0 }), { x: 0, y: 0, z: 0 }),
    }],
    ['inherited full review envelope', Object.create(baseline)],
    ['inherited findings and verdict', Object.assign(Object.create({
      findings: baseline.findings, verdict: 'findings',
    }), { counts: { ...baseline.counts } })],
    ['inherited counts and verdict', Object.assign(Object.create({
      counts: baseline.counts, verdict: 'findings',
    }), { findings: baseline.findings })],
    ['inherited verdict only', Object.assign(Object.create({ verdict: 'findings' }), {
      findings: baseline.findings, counts: { ...baseline.counts },
    })],
    ['contradictory clean verdict', { ...baseline, verdict: 'clean' }],
  ]) {
    const result = analyzeWindowsAuthorityVrResourceGovernorReviewV1(
      input(governor, { analysis }));
    assert.equal(result.eligible, false, name);
    assert.equal(result.clean, false, name);
    assert.deepEqual(result.proofRefs, [], name);
    for (const key of ['sourceMutationAllowed', 'mergeAuthority',
      'runtimeMutationAllowed', 'providerQualificationAuthority']) {
      assert.equal(result[key], false, name + ':' + key);
    }
  }
});

test('direct governor reviewer refuses inherited Proxy-backed optional clean evidence without traps', () => {
  const baseline = input(governor);
  let trapsCalled = 0;
  const hostilePrototype = new Proxy({ clean: false }, {
    has() { trapsCalled++; throw new Error('INHERITED_PROXY_HAS_TRAP_EXECUTED'); },
    get() { trapsCalled++; throw new Error('INHERITED_PROXY_GET_TRAP_EXECUTED'); },
    getOwnPropertyDescriptor() {
      trapsCalled++; throw new Error('INHERITED_PROXY_DESCRIPTOR_TRAP_EXECUTED');
    },
  });
  const inherited = Object.create(hostilePrototype);
  for (const [key, value] of Object.entries(baseline.analysis)) {
    Object.defineProperty(inherited, key, {
      value, enumerable: true, configurable: true, writable: true,
    });
  }
  const rejected = analyzeWindowsAuthorityVrResourceGovernorReviewV1(
    input(governor, { analysis: inherited }));
  assert.equal(trapsCalled, 0, 'no Proxy traps executed during inherited evidence classification');
  assert.equal(rejected.eligible, false, 'nonliteral analysis prototype must not be admitted');
  assert.equal(rejected.clean, false);
  assert.deepEqual(rejected.proofRefs, []);
  assert.equal(rejected.mergeAuthority, false);
  assert.equal(rejected.providerQualificationAuthority, false);

  const inheritedData = Object.assign(Object.create({ clean: false }), baseline.analysis);
  const held = analyzeWindowsAuthorityVrResourceGovernorReviewV1(
    input(governor, { analysis: inheritedData }));
  assert.equal(held.eligible, false, 'even nonexecuting inherited clean must remain inadmissible');

  const nullPrototype = Object.assign(Object.create(null), baseline.analysis);
  const valid = analyzeWindowsAuthorityVrResourceGovernorReviewV1(
    input(governor, { analysis: nullPrototype }));
  assert.equal(valid.clean, true, 'literal null-prototype evidence remains compatible');
});

test('direct governor reviewer rejects prototype-inherited finding identity even with registered source', () => {
  const baseline = input(governor).analysis;
  const control = analyzeWindowsAuthorityVrResourceGovernorReviewV1(input(governor));
  assert.equal(control.clean, true, 'valid own-key source and finding remain admissible');
  for (const field of ['severity', 'code', 'path']) {
    const finding = { ...baseline.findings[0] };
    const inherited = finding[field];
    delete finding[field];
    Object.setPrototypeOf(finding, { [field]: inherited });
    assert.equal(Object.hasOwn(finding, field), false, field);
    const rejected = analyzeWindowsAuthorityVrResourceGovernorReviewV1(input(governor, {
      analysis: { ...baseline, findings: [finding] },
    }));
    assert.equal(rejected.eligible, false, field);
    assert.equal(rejected.clean, false, field);
    assert.deepEqual(rejected.proofRefs, [], field);
    assert.equal(rejected.mergeAuthority, false, field);
    assert.equal(rejected.providerQualificationAuthority, false, field);
  }
  const inherited = Object.create(baseline.findings[0]);
  const rejected = analyzeWindowsAuthorityVrResourceGovernorReviewV1(input(governor, {
    analysis: { ...baseline, findings: [inherited] },
  }));
  assert.equal(rejected.eligible, false, 'fully inherited finding identity');
  assert.deepEqual(rejected.proofRefs, []);
});

test('direct governor reviewer refuses executable or collection-valued blob identities without coercion', () => {
  const baseline = input(governor);
  assert.equal(analyzeWindowsAuthorityVrResourceGovernorReviewV1(baseline).clean, true);
  for (const mode of ['toString', 'toPrimitive']) {
    let calls = 0;
    const objectSha = mode === 'toString'
      ? { toString() { calls++; return baseline.sources[0].blobSha; } }
      : { [Symbol.toPrimitive]() { calls++; return baseline.sources[0].blobSha; } };
    const evidence = { ...baseline.sources[0], blobSha: objectSha };
    const rejected = analyzeWindowsAuthorityVrResourceGovernorReviewV1(input(governor, { sources: [evidence] }));
    assert.equal(calls, 0, mode + ': no user-defined hash coercion may execute');
    assert.equal(rejected.eligible, true);
    assert.equal(rejected.clean, false);
    assert.deepEqual(rejected.proofRefs, []);
    assert.ok(rejected.findings.some((item) =>
      item.code === 'windows-authority-vr-resource-governor-source-evidence-invalid'));
    for (const key of ['sourceMutationAllowed', 'mergeAuthority',
      'runtimeMutationAllowed', 'providerQualificationAuthority']) {
      assert.equal(rejected[key], false, mode + ':' + key);
    }
  }
  for (const invalid of [[baseline.sources[0].blobSha], 17, null]) {
    const rejected = analyzeWindowsAuthorityVrResourceGovernorReviewV1(
      input(governor, { sources: [{ ...baseline.sources[0], blobSha: invalid }] }));
    assert.equal(rejected.eligible, true);
    assert.equal(rejected.clean, false);
    assert.deepEqual(rejected.proofRefs, []);
  }
});

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

test('revokes superseded reviewer-capable governor blobs with weak lease custody', async () => {
  // Assert real production source registration, not a synthetic policy model.
  const reviewerSource = await readFile(new URL('./windowsAuthorityVrResourceGovernorReviewV1.mjs', import.meta.url), 'utf8');
  const registry = reviewerSource.split('const CURRENT_GOVERNOR_SOURCE_CONTRACTS = Object.freeze([')[1]?.split(']);')[0] || '';
  const rows = registry.split('\n').filter(line => line.includes('Object.freeze({ blobSha:'));
  assert.equal(rows.length, 3, 'only two non-reviewer histories plus one current array-root-safe reviewer remain');
  for (const sha of [
    '1cbe6687741338d29caa86c7828638137eb99f24',
    'fec5255f808f303a3c0d61de9409c7eb98ceec92',
    '849e0cc3f00dbcb5b3213a16f7552c21f9dde481',
    '69c3396479d83e0f9521958f3f4dc13671863c68',
    '5a6b7672c406f941d06d1fabc2f7d31636122122',
    'c6ea953880d63b61d494259ccc8e8ecd423b14d0',
    '3804c153495a5f6be89eba33790b73f28854b15b',
  ]) assert.equal(registry.includes(sha), false, 'unbounded legacy reviewer remains registered: ' + sha);
  const reviewerRows = rows.filter(line => line.includes('reviewerReservation: true'));
  assert.equal(reviewerRows.length, 1);
  for (const row of reviewerRows) {
    assert.match(row, /typedPrepareLease: true/);
    assert.match(row, /dateParsedUtcLease: true/);
    assert.match(row, /objectRootOverride: true/);
  }
  assert.ok(reviewerSource.includes('!sourceContract.typedPrepareLease || !sourceContract.dateParsedUtcLease || !sourceContract.objectRootOverride'),
    'future reviewer-capable unbounded registrations must fail closed');
  const current = analyzeWindowsAuthorityVrResourceGovernorReviewV1(input(governor));
  assert.equal(current.clean, true, 'the current bounded reviewer contract remains admissible');
  for (const key of ['mergeAuthority','runtimeMutationAllowed','providerQualificationAuthority','sourceMutationAllowed']) {
    assert.equal(current[key], false);
  }
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

test('rejects inherited source provenance even with matching bytes and blob', () => {
  const accepted = analyzeWindowsAuthorityVrResourceGovernorReviewV1(input());
  assert.equal(accepted.eligible, true);
  assert.equal(accepted.clean, true);
  for (const field of ['schemaVersion', 'repository', 'path', 'ref', 'exists', 'size', 'blobSha', 'content']) {
    const candidate = input();
    const evidence = candidate.sources[0];
    const inheritedValue = evidence[field];
    delete evidence[field];
    Object.setPrototypeOf(evidence, { [field]: inheritedValue });
    assert.equal(Object.hasOwn(evidence, field), false, field);
    assert.equal(evidence[field], inheritedValue, field);
    const rejected = analyzeWindowsAuthorityVrResourceGovernorReviewV1(candidate);
    assert.equal(rejected.eligible, true, field);
    assert.equal(rejected.clean, false, field);
    assert.deepEqual(rejected.proofRefs, [], field);
    assert.equal(rejected.mergeAuthority, false, field);
    assert.equal(rejected.runtimeMutationAllowed, false, field);
    assert.equal(rejected.providerQualificationAuthority, false, field);
  }
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

test('specialist refuses noncanonical case-modified source head even when it aliases the same Git object', () => {
  const baseline = input();
  const accepted = analyzeWindowsAuthorityVrResourceGovernorReviewV1(baseline);
  assert.equal(accepted.clean, true);
  assert.equal(accepted.proofRefs.length, 1);
  for (const [name, sourceHead] of [
    ['uppercase head', HEAD.toUpperCase()],
    ['mixed case head', HEAD.slice(0, 8).toUpperCase() + HEAD.slice(8)],
    ['padded head', ' ' + HEAD + ' '],
  ]) {
    const rejected = analyzeWindowsAuthorityVrResourceGovernorReviewV1(
      input(governor, { sourceHead }));
    assert.equal(rejected.eligible, false, name);
    assert.equal(rejected.clean, false, name);
    assert.deepEqual(rejected.proofRefs, [], name);
    assert.equal(rejected.mergeAuthority, false, name);
    assert.equal(rejected.providerQualificationAuthority, false, name);
  }
});

test('rejects array-coerced source and escalation identities before reviewer proof', () => {
  const baseline = input();
  const finding = baseline.analysis.findings[0];
  const cases = [
    ['repository array', { repository: [REPOSITORY] }],
    ['source head array', { sourceHead: [HEAD] }],
    ['severity array', { analysis: { ...baseline.analysis, findings: [{ ...finding, severity: ['P0'] }] } }],
    ['code array', { analysis: { ...baseline.analysis, findings: [{ ...finding, code: ['unsupported-high-risk-surface'] }] } }],
    ['path array', { analysis: { ...baseline.analysis, findings: [{ ...finding, path: [PATH] }] } }],
    ['object severity', { analysis: { ...baseline.analysis, findings: [{ ...finding, severity: { toString: 'P0' } }] } }],
    ['absent repository', { repository: undefined }],
    ['absent source head', { sourceHead: undefined }],
  ];
  assert.equal(analyzeWindowsAuthorityVrResourceGovernorReviewV1(baseline).clean, true);
  for (const [reason, overrides] of cases) {
    const result = analyzeWindowsAuthorityVrResourceGovernorReviewV1(input(governor, overrides));
    assert.equal(result.eligible, false, reason);
    assert.equal(result.clean, false, reason);
    assert.deepEqual(result.proofRefs, [], reason);
    assert.equal(result.mergeAuthority, false, reason);
    assert.equal(result.providerQualificationAuthority, false, reason);
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

test('PowerShell engine preserves explicit UTC synthetic Air Link readiness with mocked filesystem', () => {
  const reader = 'function Test-VirtualAirLinkTestActive {' + (governor.split('function Test-VirtualAirLinkTestActive {')[1]
    ?.split('function Get-AirLinkSignal {')[0] || '');
  assert.match(reader, /\$members\.Count -ne 4/);
  assert.match(reader, /\$seen\.ContainsKey\(\$key\)/);
  assert.match(reader, /\$inner\.Substring\(\$cursor\)/);
  assert.match(reader, /\$state\.updatedAtUtc -isnot \[datetime\]/);
  const now = Date.now();
  const good = {
    schemaVersion:'stephanos.starfield-vr-sim-air-link.v1', enabled:true,
    purpose:'readiness-only', updatedAtUtc:new Date(now - 60000).toISOString(),
  };
  const wire = value => typeof value === 'string' ? value : JSON.stringify(value);
  const cases = [
    [good,true], [{...good, updatedAtUtc:new Date(now - 1500000).toISOString()},true],
    [{...good, updatedAtUtc:new Date(now - 1860000).toISOString()},false],
    [{...good, updatedAtUtc:new Date(now + 120000).toISOString()},false],
    [{...good, updatedAtUtc:good.updatedAtUtc.replace('Z','+00:00')},false],
    [{...good, updatedAtUtc:good.updatedAtUtc.toLowerCase()},false],
    [{...good, updatedAtUtc:[good.updatedAtUtc]},false],
    [{...good, schemaVersion:[good.schemaVersion]},false],
    [{...good, enabled:[true]},false],
    [{...good, purpose:['readiness-only']},false],
    [{...good, enabled:'true'},false],
    [[good],false],
    ['{"schemaVersion":"stephanos.starfield-vr-sim-air-link.v1","enabled":true,"purpose":"readiness-only","updatedAtUtc":"'
      + good.updatedAtUtc + '","updatedAtUtc":"' + good.updatedAtUtc + '"}',false],
    // Flat members are intentionally order-independent.
    ['{"updatedAtUtc":"' + good.updatedAtUtc
      + '","purpose":"readiness-only","enabled":true,"schemaVersion":"stephanos.starfield-vr-sim-air-link.v1"}',true],
    // Escaped stale root key + fresh nested literal key must never satisfy age.
    ['{"schemaVersion":"stephanos.starfield-vr-sim-air-link.v1","enabled":true,"purpose":"readiness-only","updatedAt'
      + '\\u0055' + 'tc":"2000-01-01T00:00:00Z","extra":{"updatedAtUtc":"'
      + good.updatedAtUtc + '"}}',false],
    ['{"schemaVersion":"stephanos.starfield-vr-sim-air-link.v1","enabled":true,"purpose":"readiness-only","updatedAt'
      + '\\u0055' + 'tc":"' + good.updatedAtUtc + '"}',false],
    ['{"schemaVersion":"stephanos.starfield-vr-sim-air-link.v1","enabled":true,"purpose":"readiness-only","updatedAtUtc":"'
      + good.updatedAtUtc + '","extra":{"payload":"not-authorized"}}',false],
    ['{"schemaVersion":"stephanos.starfield-vr-sim-air-link.v1","enabled":true,"purpose":"readiness-only","updatedAtUtc":"'
      + good.updatedAtUtc + '","purpose":"readiness-only"}',false],
    [null,false],
  ];
  const quote = value => "'" + String(value).replaceAll("'","''") + "'";
  const script = [
    'Set-StrictMode -Version Latest',
    'function Test-Path { param([string]$LiteralPath,[string]$PathType) return $script:mockExists }',
    'function Get-Content { param([string]$LiteralPath,[switch]$Raw) return $script:mockContent }',
    "$simAirLinkStatePath = 'mock-no-filesystem'",
    reader,
    ...cases.map(([obj,expected],n) => [
      '$script:mockExists = $true',
      '$script:mockContent = ' + quote(wire(obj)),
      '$actual = Test-VirtualAirLinkTestActive',
      'if ($actual -ne ' + (expected ? '$true' : '$false') + ') { throw '
        + quote('AIRLINK_MOCK_CASE_' + n) + ' }',
    ].join('\n')),
    "'AIRLINK_MOCK_CASES_PASSED'",
  ].join('\n');
  const engine = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
  const result = spawnSync(engine,['-NoProfile','-NonInteractive','-Command',script],{
    encoding:'utf8',timeout:30000,windowsHide:true,
  });
  assert.equal(result.status,0,String(result.stderr || result.error || 'Air Link mocked reader failed'));
  assert.match(result.stdout,/AIRLINK_MOCK_CASES_PASSED/);
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

test('corrupt-state cooldown carries model denial and park-all eviction intent', () => {
  // Exact source-text checks and a portable behavior model; not Windows calibration.
  const resolve = governor.split('function Resolve-EffectiveState {')[1]
    ?.split('function Invoke-Reconcile {')[0] || '';
  const reconcile = governor.split('function Invoke-Reconcile {')[1]
    ?.split('function Invoke-CurrentReconcile {')[0] || '';
  assert.ok(resolve.includes('$recoveryProfileRequired = [bool]('));
  assert.ok(resolve.includes('Test-InconsistentGovernorIdleState -State $PriorState'));
  assert.ok(resolve.includes('($PriorState.localModelAllowed -eq $false -and -not [bool]$profile.parkAllModels)'));
  const guarded = resolve.split('if ($recoveryProfileRequired) {')[1]
    ?.split("if ($override -eq 'FORCE_OFF')")[0] || '';
  for (const needle of ["name = 'protected-cooldown-recovery'", 'lightweightOnly = $true',
    'parkAllModels = $true', 'customProfileApplied = $false']) {
    assert.ok(guarded.includes(needle), 'fail-closed recovery profile must retain ' + needle);
  }
  assert.ok(reconcile.includes('$modelsToPark = if ($parkAllModels) { @($loadedBefore) } else { @($heavyBefore) }'));
  assert.ok(governor.includes('heavyModelAllowed = -not $ShouldParkHeavy'));
  assert.ok(governor.includes('localModelAllowed = -not ($Active -and $ParkAllModels)'));
  for (const prior of [
    { phase:'REVIEWING', active:false, localModelAllowed:false, profile:{parkAllModels:false,lightweightOnly:false} },
    { phase:'UNKNOWN', active:true, localModelAllowed:false, profile:{parkAllModels:false,lightweightOnly:true} },
    { phase:'NORMAL', active:true, localModelAllowed:true, profile:{parkAllModels:false,lightweightOnly:true} },
    { phase:'COOLDOWN', active:true, localModelAllowed:false, profile:{parkAllModels:false,lightweightOnly:true} },
  ]) {
    const inconsistent = !['NORMAL','REVIEWING','GAMING','PREPARING','COOLDOWN'].includes(prior.phase)
      || (['NORMAL','REVIEWING'].includes(prior.phase) && (prior.active || !prior.localModelAllowed));
    const protect = inconsistent || (!prior.localModelAllowed && !prior.profile.parkAllModels);
    assert.equal(protect,true, prior.phase);
    const p = protect ? {parkAllModels:true,lightweightOnly:true} : prior.profile;
    const parkAll = true && p.parkAllModels;
    const parkHeavy = true && p.lightweightOnly;
    assert.deepEqual(parkAll ? ['Qwen32B','Qwen3B'] : ['Qwen32B'], ['Qwen32B','Qwen3B']);
    assert.equal(!parkHeavy,false,'heavy model admission must be denied');
    assert.equal(!parkAll,false,'local model admission must be denied');
  }
  // Consistent cooldowns without prior model denial may expire normally.
  const consistent = {phase:'COOLDOWN',active:true,localModelAllowed:true,profile:{parkAllModels:false}};
  assert.equal(!consistent.localModelAllowed && !consistent.profile.parkAllModels,false);
});


test('present corrupt gaming override fails closed instead of clearing operator ForceOn', () => {
  const read = governor.split('function Read-OverrideMode {')[1]
    ?.split('function Write-OverrideMode {')[0] || '';
  assert.ok(read.includes("if (-not (Test-Path -LiteralPath $overridePath -PathType Leaf)) { return 'AUTO' }"));
  assert.ok(read.includes("schemaVersion -eq 'stephanos.gaming-resource-override.v1'"));
  assert.ok(read.includes('$state.schemaVersion -is [string]'));
  assert.ok(read.includes("$raw -notmatch '^\\s*\\{'"));
  assert.ok(read.indexOf("$raw -notmatch '^\\s*\\{'") < read.indexOf('$state = $raw | ConvertFrom-Json'),
    'wire-root guard must execute before PowerShell can unwrap a single-item JSON array');
  assert.ok(read.includes("$state.mode -is [string]"));
  assert.ok(read.includes("$state.mode -in @('AUTO','FORCE_ON','FORCE_OFF')"));
  assert.ok(read.trimEnd().endsWith("return 'FORCE_ON'\n}"));
  const classify = (exists, raw) => {
    if (!exists) return 'AUTO';
    try {
      const obj = JSON.parse(raw);
      return obj && !Array.isArray(obj) && obj.schemaVersion === 'stephanos.gaming-resource-override.v1'
        && typeof obj.mode === 'string' && ['AUTO','FORCE_ON','FORCE_OFF'].includes(obj.mode)
        ? obj.mode : 'FORCE_ON';
    } catch { return 'FORCE_ON'; }
  };
  const valid = mode => JSON.stringify({schemaVersion:'stephanos.gaming-resource-override.v1',mode});
  for (const [exists,raw,expected] of [
    [false,'','AUTO'],[true,valid('AUTO'),'AUTO'],
    [true,valid('FORCE_ON'),'FORCE_ON'],[true,valid('FORCE_OFF'),'FORCE_OFF'],
    [true,'{bad-json','FORCE_ON'],[true,'null','FORCE_ON'],
    [true,'[]','FORCE_ON'],
    [true,JSON.stringify([{schemaVersion:'stephanos.gaming-resource-override.v1',mode:'FORCE_OFF'}]),'FORCE_ON'],
    [true,JSON.stringify([{schemaVersion:'stephanos.gaming-resource-override.v1',mode:'AUTO'}]),'FORCE_ON'],
    [true,'   '+valid('AUTO'),'AUTO'],
    [true,JSON.stringify({mode:'AUTO'}),'FORCE_ON'],
    [true,JSON.stringify({schemaVersion:'other',mode:'AUTO'}),'FORCE_ON'],
    [true,JSON.stringify({schemaVersion:['stephanos.gaming-resource-override.v1','invalid'],mode:'FORCE_OFF'}),'FORCE_ON'],
    [true,JSON.stringify({schemaVersion:{value:'stephanos.gaming-resource-override.v1'},mode:'FORCE_OFF'}),'FORCE_ON'],
    [true,JSON.stringify({schemaVersion:'stephanos.gaming-resource-override.v1',mode:0}),'FORCE_ON'],
    [true,valid('UNRECOGNISED'),'FORCE_ON'],
  ]) assert.equal(classify(exists,raw),expected,String(raw));
});

test('Windows PowerShell executes the isolated gaming override reader with mocked filesystem', {
  skip: process.platform !== 'win32',
}, () => {
  const fn = 'function Read-OverrideMode {' + (governor.split('function Read-OverrideMode {')[1]
    ?.split('function Write-OverrideMode {')[0] || '');
  assert.match(fn,/return 'FORCE_ON'/);
  const good = mode => JSON.stringify({schemaVersion:'stephanos.gaming-resource-override.v1',mode});
  const cases = [
    [false,'','AUTO'],[true,good('AUTO'),'AUTO'],
    [true,good('FORCE_ON'),'FORCE_ON'],[true,good('FORCE_OFF'),'FORCE_OFF'],
    [true,'{bad-json','FORCE_ON'],[true,'null','FORCE_ON'],
    [true,'[]','FORCE_ON'],
    [true,JSON.stringify([{schemaVersion:'stephanos.gaming-resource-override.v1',mode:'FORCE_OFF'}]),'FORCE_ON'],
    [true,JSON.stringify([{schemaVersion:'stephanos.gaming-resource-override.v1',mode:'AUTO'}]),'FORCE_ON'],
    [true,'   '+good('AUTO'),'AUTO'],
    [true,JSON.stringify({mode:'AUTO'}),'FORCE_ON'],
    [true,JSON.stringify({schemaVersion:'wrong',mode:'AUTO'}),'FORCE_ON'],
    [true,JSON.stringify({schemaVersion:['stephanos.gaming-resource-override.v1','invalid'],mode:'FORCE_OFF'}),'FORCE_ON'],
    [true,JSON.stringify({schemaVersion:{value:'stephanos.gaming-resource-override.v1'},mode:'FORCE_OFF'}),'FORCE_ON'],
    [true,JSON.stringify({schemaVersion:'stephanos.gaming-resource-override.v1',mode:42}),'FORCE_ON'],
    [true,good('UNKNOWN'),'FORCE_ON'],
  ];
  const quote = value => "'" + String(value).replaceAll("'","''") + "'";
  const ps = [
    'Set-StrictMode -Version Latest',
    "function Test-Path { param([string]$LiteralPath,[string]$PathType) return $script:mockExists }",
    "function Get-Content { param([string]$LiteralPath,[switch]$Raw) return $script:mockContent }",
    "$overridePath = 'mock-override-no-filesystem'",
    fn,
    ...cases.map(([exists,raw,expected],i) => [
      "$script:mockExists = $" + (exists ? "true" : "false"),
      "$script:mockContent = " + quote(raw),
      "$actual = Read-OverrideMode",
      "if ($actual -ne " + quote(expected) + ") { throw " + quote("OVERRIDE_CASE_"+i+"_FAILED") + " }",
    ].join('\n')),
    "'OVERRIDE_MOCK_CASES_PASSED'",
  ].join('\n');
  const result = spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',ps],{
    encoding:'utf8',timeout:30000,windowsHide:true,
  });
  assert.equal(result.status,0,String(result.stderr || result.error || 'PowerShell override evaluation failed'));
  assert.match(result.stdout,/OVERRIDE_MOCK_CASES_PASSED/);
});

test('persisted reviewer prepare lease must have scalar, two-minute UTC custody', () => {
  const reader = governor.split('function Read-PrepareLease {')[1]
    ?.split('function Get-ProfileOverride {')[0] || '';
  for (const guard of [
    "$raw -notmatch '^\\s*\\{'", '$lease -isnot [pscustomobject]',
    '$lease.schemaVersion -isnot [string]', '$lease.active -isnot [bool]',
    '$lease.processName -isnot [string]', '$lease.profileName -isnot [string]',
    '$lease.createdAtUtc -isnot [string]', '$lease.expiresAtUtc -isnot [string]',
    '$lease.createdAtUtc -isnot [datetime]', '$lease.expiresAtUtc -isnot [datetime]',
    '$lease.createdAtUtc.ToUniversalTime().ToString', '$lease.expiresAtUtc.ToUniversalTime().ToString',
    '$created -gt $nowUtc.AddSeconds(5)', '$expiry -le $created',
    '$expiry -gt $created.AddMinutes(2)', '$nowUtc -ge $expiry', 'Clear-PrepareLease',
  ]) assert.ok(reader.includes(guard), 'missing safety guard ' + guard);
  const now = Date.now();
  const good = {
    schemaVersion: 'stephanos.gaming-resource-prepare.v1', active: true,
    processName: 'SovereignReviewer', profileName: 'review-large-context',
    createdAtUtc: new Date(now - 10000).toISOString(),
    expiresAtUtc: new Date(now + 90000).toISOString(),
  };
  const permitted = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    if (typeof value.schemaVersion !== 'string' || value.schemaVersion !== good.schemaVersion
      || value.active !== true || typeof value.processName !== 'string'
      || !value.processName.trim() || typeof value.profileName !== 'string'
      || typeof value.createdAtUtc !== 'string' || typeof value.expiresAtUtc !== 'string') return false;
    const created = Date.parse(value.createdAtUtc), expires = Date.parse(value.expiresAtUtc);
    return Number.isFinite(created) && Number.isFinite(expires)
      && created <= now + 5000 && expires > created
      && expires <= created + 120000 && now < expires;
  };
  assert.equal(permitted(good), true);
  for (const candidate of [
    [good], null, {}, { ...good, schemaVersion: [good.schemaVersion] },
    { ...good, active: [true] }, { ...good, active: 'true' },
    { ...good, processName: ['SovereignReviewer'] },
    { ...good, profileName: ['review-large-context'] },
    { ...good, createdAtUtc: [good.createdAtUtc] },
    { ...good, expiresAtUtc: [good.expiresAtUtc] },
    { ...good, createdAtUtc: new Date(now + 20000).toISOString() },
    { ...good, expiresAtUtc: new Date(now + 300000).toISOString() },
    { ...good, expiresAtUtc: new Date(now - 1000).toISOString() },
    { ...good, processName: '' },
  ]) assert.equal(permitted(candidate), false, JSON.stringify(candidate));
});

test('PowerShell engine checks valid reviewer and game leases plus malformed persisted leases without disk effects', () => {
  const reader = 'function Read-PrepareLease {' + (governor.split('function Read-PrepareLease {')[1]
    ?.split('function Get-ProfileOverride {')[0] || '');
  const now = Date.now();
  const good = {
    schemaVersion: 'stephanos.gaming-resource-prepare.v1', active: true,
    processName: 'SovereignReviewer', profileName: 'review-large-context',
    createdAtUtc: new Date(now - 10000).toISOString(),
    expiresAtUtc: new Date(now + 90000).toISOString(),
  };
  const cases = [
    [good, true], [{...good, processName:'Starfield', profileName:'vr-maximum'}, true],
    [[good], false], [null, false], [{...good, schemaVersion:[good.schemaVersion]}, false],
    [{...good, active:[true]}, false], [{...good, active:'true'}, false],
    [{...good, active:false}, false], [{...good, schemaVersion:'unknown'}, false],
    [{...good, processName:['SovereignReviewer']}, false],
    [{...good, profileName:['review-large-context']}, false],
    [{...good, createdAtUtc:[good.createdAtUtc]}, false],
    [{...good, expiresAtUtc:[good.expiresAtUtc]}, false],
    [{...good, createdAtUtc:new Date(now+20000).toISOString()}, false],
    [{...good, expiresAtUtc:new Date(now+300000).toISOString()}, false],
    [{...good, expiresAtUtc:new Date(now-1000).toISOString()}, false],
  ];
  const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
  const script = [
    'Set-StrictMode -Version Latest',
    'function Test-Path { param([string]$LiteralPath,[string]$PathType) return $true }',
    'function Get-Content { param([string]$LiteralPath,[switch]$Raw) return $script:mockContent }',
    'function Clear-PrepareLease { $script:cleared = $true; $script:leaseError = [string]$Error[0] }',
    "$preparePath = 'mock-no-disk-access'",
    reader,
    ...cases.map(([obj, expected], n) => [
      '$script:mockContent = ' + quote(JSON.stringify(obj)),
      '$script:cleared = $false',
      "$script:leaseError = ''",
      '$observed = Read-PrepareLease',
      'if ($observed.active -ne ' + (expected ? '$true' : '$false')
        + ') { throw (' + quote('ACTIVE_CASE_' + n) + " + ': ' + $script:leaseError) }",
      'if ($script:cleared -ne ' + (expected ? '$false' : '$true')
        + ') { throw ' + quote('CLEAR_CASE_' + n) + ' }',
    ].join('\n')),
    "'LEASE_MOCK_CASES_PASSED'",
  ].join('\n');
  // Linux hosted CI uses PowerShell 7; the Windows host uses native Windows PowerShell 5.1.
  // Both must execute the *actual* isolated reader rather than a JavaScript surrogate.
  const engine = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
  const result = spawnSync(engine, ['-NoProfile','-NonInteractive','-Command',script], {
    encoding:'utf8', timeout:30000, windowsHide:true,
  });
  assert.equal(result.status,0,String(result.stderr || result.error || 'Windows lease mock failed'));
  assert.match(result.stdout,/LEASE_MOCK_CASES_PASSED/);
});

test('ForceOn never inherits retired reviewer model permissions after cancellation or expiry', () => {
  // Exact-source control-flow verification, not a claim of installed PowerShell runtime.
  const resolver = governor.split('function Resolve-EffectiveState {')[1]
    ?.split('function Invoke-Reconcile {')[0] || '';
  const forceOn = resolver.split("if ($override -eq 'FORCE_ON') {")[1]
    ?.split('    # A reviewer reservation may not replace an unexpired gaming cooldown.')[0] || '';
  for (const value of ["name = 'operator-forced-gaming'",'lightweightOnly = $true',
    'parkAllModels = $true','customProfileApplied = $false','minFreeVramMiB = 12288']) {
    assert.ok(forceOn.includes(value), 'forced gaming must retain ' + value);
  }
  assert.ok(forceOn.indexOf("name = 'operator-forced-gaming'") < forceOn.indexOf("phase = 'GAMING'"));
  const reconcile = governor.split('function Invoke-Reconcile {')[1]
    ?.split('function Invoke-CurrentReconcile {')[0] || '';
  assert.ok(reconcile.includes('$parkAllModels = [bool]($Effective.active -and $Effective.profile.parkAllModels)'));
  assert.ok(reconcile.includes('$modelsToPark = if ($parkAllModels) { @($loadedBefore) } else { @($heavyBefore) }'));
  for (const retired of ['cancelled','expired']) {
    const prior = { leaseActive:false, profile:'review-large-context', retired };
    const effective = { phase:'GAMING', active:true,
      profile:{ name:'operator-forced-gaming', parkAllModels:true, lightweightOnly:true } };
    const loaded = ['Qwen32B','Qwen3B'];
    const parkAll = effective.active && effective.profile.parkAllModels;
    assert.equal(parkAll,true,JSON.stringify(prior));
    assert.deepEqual(parkAll ? loaded : ['Qwen32B'],loaded);
    assert.equal(!effective.profile.lightweightOnly,false);
    assert.equal(!parkAll,false);
    assert.notEqual(effective.profile.name,prior.profile);
  }
});

test('ForceOn source parses with Windows PowerShell AST without executing it', {
  skip: process.platform !== 'win32',
}, () => {
  const parse = "$t=$null; $e=$null; [void][System.Management.Automation.Language.Parser]::ParseInput([Console]::In.ReadToEnd(),[ref]$t,[ref]$e); if ($e.Count -ne 0) { $e | ForEach-Object { [Console]::Error.WriteLine($_.ToString()) }; exit 4 }";
  const r = spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',parse],{
    input:governor,encoding:'utf8',timeout:30000,
  });
  assert.equal(r.status,0,String(r.stderr || r.error || 'PowerShell parse failed'));
});

test('reviewer P0 source evidence rejects accessor-backed claims before executing getters', () => {
  const checkedPaths = ['repository', 'sourceHead', 'analysis', 'sources'];
  const cases = [];
  for (const field of checkedPaths) cases.push(['input.' + field, (claim, trap) => trap(claim, field)]);
  for (const field of ['findings', 'counts', 'verdict', 'clean']) {
    cases.push(['analysis.' + field, (claim, trap) => {
      if (field === 'clean') claim.analysis.clean = false;
      trap(claim.analysis, field);
    }]);
  }
  cases.push(['findings[0]', (claim, trap) => trap(claim.analysis.findings, '0')]);
  for (const field of ['severity', 'code', 'path']) {
    cases.push(['finding.' + field, (claim, trap) => trap(claim.analysis.findings[0], field)]);
  }
  for (const field of ['P0', 'P1', 'P2']) {
    cases.push(['counts.' + field, (claim, trap) => trap(claim.analysis.counts, field)]);
  }
  for (const field of ['schemaVersion', 'repository', 'path', 'ref', 'exists', 'size', 'blobSha', 'content']) {
    cases.push(['source.' + field, (claim, trap) => trap(claim.sources[0], field)]);
  }
  assert.equal(analyzeWindowsAuthorityVrResourceGovernorReviewV1(input()).clean, true,
    'unchanged frozen source must remain eligible');
  for (const [name, mutate] of cases) {
    const claim = input();
    let getterCalls = 0;
    mutate(claim, (target, key) => {
      const value = Object.getOwnPropertyDescriptor(target, key)?.value;
      Object.defineProperty(target, key, {
        configurable: true, enumerable: true, get() {
          getterCalls++;
          return value;
        },
      });
    });
    const review = analyzeWindowsAuthorityVrResourceGovernorReviewV1(claim);
    assert.equal(review.clean, false, name + ' must not produce clean review');
    assert.deepEqual(review.proofRefs, [], name + ' must have no positive source proof');
    assert.equal(getterCalls, 0, name + ' accessor must never execute');
    for (const authority of ['mergeAuthority', 'runtimeMutationAllowed',
      'providerQualificationAuthority', 'sourceMutationAllowed']) {
      assert.equal(review[authority], false, name + ' authority: ' + authority);
    }
  }
});

test('reviewer P0 and source claims reject Proxy traps without executing user code', () => {
  const cases = [
    ['root input', (claim, guard) => guard(claim)],
    ['analysis', (claim, guard) => { claim.analysis = guard(claim.analysis); return claim; }],
    ['finding array', (claim, guard) => { claim.analysis.findings = guard(claim.analysis.findings); return claim; }],
    ['finding object', (claim, guard) => { claim.analysis.findings[0] = guard(claim.analysis.findings[0]); return claim; }],
    ['counts', (claim, guard) => { claim.analysis.counts = guard(claim.analysis.counts); return claim; }],
    ['source array', (claim, guard) => { claim.sources = guard(claim.sources); return claim; }],
    ['source object', (claim, guard) => { claim.sources[0] = guard(claim.sources[0]); return claim; }],
  ];
  assert.equal(analyzeWindowsAuthorityVrResourceGovernorReviewV1(input()).clean, true);
  for (const [name, mutate] of cases) {
    let traps = 0;
    const guard = (value) => new Proxy(value, {
      get() { traps++; throw new Error('untrusted Proxy get: ' + name); },
      getOwnPropertyDescriptor() { traps++; throw new Error('untrusted Proxy descriptor: ' + name); },
      ownKeys() { traps++; throw new Error('untrusted Proxy keys: ' + name); },
      getPrototypeOf() { traps++; throw new Error('untrusted Proxy prototype: ' + name); },
    });
    const review = analyzeWindowsAuthorityVrResourceGovernorReviewV1(mutate(input(), guard));
    assert.equal(review.clean, false, name);
    assert.deepEqual(review.proofRefs, [], name);
    assert.equal(traps, 0, name + ' must never execute Proxy traps');
    for (const authority of ['sourceMutationAllowed', 'mergeAuthority', 'runtimeMutationAllowed', 'providerQualificationAuthority']) {
      assert.equal(review[authority], false, name + ': ' + authority);
    }
  }
  for (const target of ['root', 'findings', 'sources']) {
    const claim = input();
    const revoked = Proxy.revocable(target === 'root' ? claim
      : target === 'findings' ? claim.analysis.findings : claim.sources, {});
    revoked.revoke();
    if (target === 'findings') claim.analysis.findings = revoked.proxy;
    if (target === 'sources') claim.sources = revoked.proxy;
    const review = analyzeWindowsAuthorityVrResourceGovernorReviewV1(target === 'root' ? revoked.proxy : claim);
    assert.equal(review.clean, false, target + ' revoked proxy');
    assert.deepEqual(review.proofRefs, [], target + ' revoked proxy');
  }
});
