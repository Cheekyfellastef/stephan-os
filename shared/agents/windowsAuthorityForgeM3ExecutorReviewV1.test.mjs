import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  WINDOWS_AUTHORITY_FORGE_M3_EXECUTOR_PATHS_V1,
  analyzeWindowsAuthorityForgeM3ExecutorReview,
} from './windowsAuthorityForgeM3ExecutorReviewV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const HEAD = 'a'.repeat(40);

function blobSha(content) {
  const bytes = Buffer.from(content);
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function record(path, content) {
  return {
    schemaVersion: 'stephanos.windows-authority-source.v1',
    repository: REPOSITORY,
    path,
    ref: HEAD,
    exists: true,
    size: Buffer.byteLength(content),
    blobSha: blobSha(content),
    content,
  };
}

function escalation() {
  return {
    findings: WINDOWS_AUTHORITY_FORGE_M3_EXECUTOR_PATHS_V1.map((path) => ({
      severity: 'P0',
      code: 'unsupported-high-risk-surface',
      summary: 'specialist',
      path,
    })),
  };
}

const executor = `
[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]
[switch]$OperatorApproved
$Repository = 'Cheekyfellastef/stephan-os'
$MachineName = 'stephanos-forge-shadow'
$CanaryListener = '127.0.0.1:3342'
$SandboxExe = Join-Path $env:SystemRoot 'System32\\WindowsSandbox.exe'
'--connection', $MachineName
'--read-only'
'--cap-drop', 'ALL'
'no-new-privileges'
'--ephemeral'
@('one-job', '--url'
'--token-url', 'file:///runner/runner-token'
branch', '--show-current'
rev-parse', 'HEAD'
rev-parse', "$ExpectedHead^{tree}"
Invoke-CanaryDispatch 'linux-isolated' $runnerId
Invoke-CanaryDispatch 'windows-proof-isolated' $runnerId
Assert-RunnerRegistrationAbsent $runnerId
Stop-Process -Id $script:SandboxProcess.Id
gitRefWrite = $false
mergeAuthority = $false
deploymentAuthority = $false
arbitraryCommand = $false
`;

const staticTest = `
const scriptUrl = new URL('./invoke-forge-shadow-m3-fixed-proof-executors-v1.ps1', import.meta.url);
test('fixed host executor is exact-source, exact-artifact, exact-plan and authorization bound', () => {});
test('Linux execution is a rootless outer Podman boundary with repository-scoped ephemeral one-job registration', () => {});
test('Windows proof uses only a disposable Sandbox exchange and an exact-address temporary relay', () => {});
test('executor emits only post-teardown closed-world observations and no reusable authority', () => {});
'FORGE_M3_EPHEMERAL_REGISTRATION_REMAINS'
`;

const authorityFindingCodes = Object.freeze([
  'forge-m3-executor-git-authority-not-zero',
  'forge-m3-executor-merge-authority-not-zero',
  'forge-m3-executor-deploy-authority-not-zero',
  'forge-m3-executor-arbitrary-authority-not-zero',
]);

function reviewExecutorSource(source) {
  return analyzeWindowsAuthorityForgeM3ExecutorReview({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: escalation(),
    sources: [
      record(WINDOWS_AUTHORITY_FORGE_M3_EXECUTOR_PATHS_V1[0], source),
      record(WINDOWS_AUTHORITY_FORGE_M3_EXECUTOR_PATHS_V1[1], staticTest),
    ],
  });
}

function authorityCodes(result) {
  return result.findings
    .map((item) => item.code)
    .filter((code) => authorityFindingCodes.includes(code))
    .sort();
}

test('qualifies exactly the Forge M3 executor and static hostile test', () => {
  const result = analyzeWindowsAuthorityForgeM3ExecutorReview({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: escalation(),
    sources: [
      record(WINDOWS_AUTHORITY_FORGE_M3_EXECUTOR_PATHS_V1[0], executor),
      record(WINDOWS_AUTHORITY_FORGE_M3_EXECUTOR_PATHS_V1[1], staticTest),
    ],
  });
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true);
  assert.deepEqual(result.reviewedPaths, [...WINDOWS_AUTHORITY_FORGE_M3_EXECUTOR_PATHS_V1]);
});

test('zero-authority proof requires genuine unquoted whole-line false assignments', () => {
  const hostileSources = [
    executor
      .replace('gitRefWrite = $false', "'gitRefWrite = $false'")
      .replace('mergeAuthority = $false', "'mergeAuthority = $false'")
      .replace('deploymentAuthority = $false', "'deploymentAuthority = $false'")
      .replace('arbitraryCommand = $false', "'arbitraryCommand = $false'"),
    executor
      .replace('gitRefWrite = $false', '# gitRefWrite = $false')
      .replace('mergeAuthority = $false', '# mergeAuthority = $false')
      .replace('deploymentAuthority = $false', '# deploymentAuthority = $false')
      .replace('arbitraryCommand = $false', '# arbitraryCommand = $false'),
    executor
      .replace('gitRefWrite = $false', 'Write-Output "gitRefWrite = $false"')
      .replace('mergeAuthority = $false', 'Write-Output "mergeAuthority = $false"')
      .replace('deploymentAuthority = $false', 'Write-Output "deploymentAuthority = $false"')
      .replace('arbitraryCommand = $false', 'Write-Output "arbitraryCommand = $false"'),
    executor
      .replace(/^gitRefWrite = \$false\n/m, '')
      .replace(/^mergeAuthority = \$false\n/m, '')
      .replace(/^deploymentAuthority = \$false\n/m, '')
      .replace(/^arbitraryCommand = \$false\n/m, ''),
  ];

  for (const source of hostileSources) {
    const result = reviewExecutorSource(source);
    assert.equal(result.clean, false);
    assert.deepEqual(authorityCodes(result), [...authorityFindingCodes].sort());
  }
});

test('true authority assignments fail closed with the exact finding codes', () => {
  const source = executor
    .replace('gitRefWrite = $false', 'gitRefWrite = $true')
    .replace('mergeAuthority = $false', 'mergeAuthority = $true')
    .replace('deploymentAuthority = $false', 'deploymentAuthority = $true')
    .replace('arbitraryCommand = $false', 'arbitraryCommand = $true');
  const result = reviewExecutorSource(source);
  assert.equal(result.clean, false);
  assert.deepEqual(authorityCodes(result), [...authorityFindingCodes].sort());
});

test('rejects widened or incomplete specialist estates', () => {
  const onePath = {
    findings: [{
      severity: 'P0',
      code: 'unsupported-high-risk-surface',
      path: WINDOWS_AUTHORITY_FORGE_M3_EXECUTOR_PATHS_V1[0],
    }],
  };
  assert.equal(analyzeWindowsAuthorityForgeM3ExecutorReview({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: onePath,
    sources: [],
  }).eligible, false);
});

test('fails closed when execution or teardown authority widens', () => {
  const insecure = executor
    .replace("'--cap-drop', 'ALL'", '')
    .replace('Assert-RunnerRegistrationAbsent $runnerId', '')
    + '\nInvoke-Expression $anything\n';
  const result = analyzeWindowsAuthorityForgeM3ExecutorReview({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: escalation(),
    sources: [
      record(WINDOWS_AUTHORITY_FORGE_M3_EXECUTOR_PATHS_V1[0], insecure),
      record(WINDOWS_AUTHORITY_FORGE_M3_EXECUTOR_PATHS_V1[1], staticTest),
    ],
  });
  assert.equal(result.clean, false);
  const codes = result.findings.map((item) => item.code);
  assert.ok(codes.includes('forge-m3-executor-cap-drop-missing'));
  assert.ok(codes.includes('forge-m3-executor-registration-teardown-unproven'));
  assert.ok(codes.includes('forge-m3-executor-dynamic-execution-forbidden'));
});

test('static specialist test cannot execute child processes', () => {
  const insecure = `${staticTest}\nconst childProcessModule = 'node:' + 'child_process';\nvoid childProcessModule;\n`;
  const result = analyzeWindowsAuthorityForgeM3ExecutorReview({
    repository: REPOSITORY,
    sourceHead: HEAD,
    analysis: escalation(),
    sources: [
      record(WINDOWS_AUTHORITY_FORGE_M3_EXECUTOR_PATHS_V1[0], executor),
      record(WINDOWS_AUTHORITY_FORGE_M3_EXECUTOR_PATHS_V1[1], `${insecure}\nspawnSync(command);\n`),
    ],
  });
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'forge-m3-static-test-child-process-forbidden'));
});
