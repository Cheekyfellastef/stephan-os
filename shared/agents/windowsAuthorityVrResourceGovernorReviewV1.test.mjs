import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  WINDOWS_AUTHORITY_VR_RESOURCE_GOVERNOR_PATHS_V1,
  analyzeWindowsAuthorityVrResourceGovernorReviewV1,
} from './windowsAuthorityVrResourceGovernorReviewV1.mjs';

const PATH = WINDOWS_AUTHORITY_VR_RESOURCE_GOVERNOR_PATHS_V1[0];
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const HEAD = 'a'.repeat(40);

function blobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
}

const governor = [
  '[CmdletBinding()]',
  'param(',
  "    [ValidateSet('Watch','Reconcile','Status','PrepareGaming','CancelPrepare','SetAuto','ForceOn','ForceOff')][string]$Action = 'Watch'",
  ')',
  'Set-StrictMode -Version Latest',
  "$workspaceRoot = Join-Path $env:USERPROFILE 'Documents\\Stephanos-openclaw-workspace'",
  "$statePath = Join-Path $stateRoot 'vr-resource-governor-current.json'",
  "$overridePath = Join-Path $stateRoot 'gaming-resource-override.json'",
  "$preparePath = Join-Path $stateRoot 'gaming-resource-prepare.json'",
  "$profilesPath = Join-Path $stateRoot 'gaming-resource-profiles.json'",
  "$telemetryPath = Join-Path $stateRoot 'gaming-resource-governor-events.jsonl'",
  "$lightweightModel = 'llama3.2:3b'",
  "foreach ($name in @('OculusDash', 'vrcompositor', 'vrdashboard')) { }",
  "$name = 'vr-maximum'",
  '$parkAllModels = $true',
  "if ($RequestedProfileName -eq 'vr-maximum') {",
  '    $minFree = 12288',
  '    $parkAllModels = $true',
  '}',
  'function Get-LoadedOllamaModels {',
  '    $lines = @(& $OllamaExecutable ps 2>$null)',
  '}',
  'function Stop-OllamaModel {',
  '    & $OllamaExecutable stop $Model *> $null',
  '}',
  '$modelsToPark = if ($parkAllModels) { @($loadedBefore) } else { @($heavyBefore) }',
  'localModelAllowed = -not ($Active -and $ParkAllModels)',
  'zeroLocalModelInvariant = [bool]$ZeroLocalModelInvariant',
  'reappearanceDetected = [bool]$ReappearanceDetected',
  'reappearanceCount = [int]$ReappearanceCount',
  '$zeroLocalModelInvariant = [bool](',
  '    -not ($Effective.active -and $parkAllModels) -or $loadedAfter.Count -eq 0',
  ')',
  '$priorParkAllModels = $false',
  '$profile = $PriorState.profile',
  '$reappearanceDetected = [bool](',
  '    $parkAllModels -and $PriorState.localModelAllowed -eq $false',
  ')',
  'evictionHealthy = [bool](',
  '    (-not $ShouldParkHeavy -or $HeavyModelsAfter.Count -eq 0) -and',
  '    $ZeroLocalModelInvariant',
  ')',
  '$guardIntervalSeconds = if ($effective.active -and $effective.profile.parkAllModels) { 1 } else { 5 }',
  '@($prepared.loadedModelsAfter).Count -gt 0',
  '$prepared.zeroLocalModelInvariant -ne $true',
].join('\n');

function input(content = governor, overrides = {}) {
  return {
    repository: REPOSITORY,
    prNumber: 2662,
    branch: 'fix/vr-zero-ollama-residency-v1',
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

test('zero-model VR governor contract is eligible and clean', () => {
  const result = analyzeWindowsAuthorityVrResourceGovernorReviewV1(input());
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.reviewedPaths, [PATH]);
  assert.equal(result.sourceMutationAllowed, false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.runtimeMutationAllowed, false);
  assert.equal(result.providerQualificationAuthority, false);
});

test('specialist rejects widened arbitrary process authority', () => {
  const result = analyzeWindowsAuthorityVrResourceGovernorReviewV1(
    input(governor + "\nStart-Process -FilePath 'cmd.exe'\n"),
  );
  assert.equal(result.eligible, true);
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'vr-governor-process-mutation-widened'));
});

test('specialist rejects a widened Ollama command estate', () => {
  const widened = governor.replace(
    '& $OllamaExecutable stop $Model *> $null',
    '& $OllamaExecutable run $Model *> $null',
  );
  const result = analyzeWindowsAuthorityVrResourceGovernorReviewV1(input(widened));
  assert.equal(result.eligible, true);
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'vr-governor-model-stop-command-not-fixed'));
  assert.ok(result.findings.some((item) => item.code === 'vr-governor-ollama-command-estate-widened'));
});

test('specialist rejects removal of fail-closed zero-model proof', () => {
  const weakened = governor.replace('$prepared.zeroLocalModelInvariant -ne $true', '# missing invariant gate');
  const result = analyzeWindowsAuthorityVrResourceGovernorReviewV1(input(weakened));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'vr-governor-prepare-invariant-failclose-missing'));
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
