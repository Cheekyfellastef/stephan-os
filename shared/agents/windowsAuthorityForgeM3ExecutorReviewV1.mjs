import { createHash } from 'node:crypto';

export const WINDOWS_AUTHORITY_FORGE_M3_EXECUTOR_PATHS_V1 = Object.freeze([
  'scripts/windows/invoke-forge-shadow-m3-fixed-proof-executors-v1.ps1',
  'scripts/windows/invoke-forge-shadow-m3-fixed-proof-executors-v1.test.mjs',
]);

const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const MAX_BYTES = 256 * 1024;
const EXACT_HEAD = /^[a-f0-9]{40}$/;
const GIT_BLOB = /^[a-f0-9]{40}$/;

function text(value) {
  return String(value ?? '').trim();
}

function finding(code, summary, path) {
  return Object.freeze({ severity: 'P0', code, summary, path });
}

function gitBlobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1')
    .update(`blob ${bytes.length}\0`, 'utf8')
    .update(bytes)
    .digest('hex');
}

function exactSource(source, repository, sourceHead, path) {
  const content = typeof source?.content === 'string' ? source.content : '';
  const bytes = Buffer.byteLength(content, 'utf8');
  return Boolean(
    source
    && typeof source === 'object'
    && !Array.isArray(source)
    && source.schemaVersion === SOURCE_SCHEMA
    && source.repository === repository
    && source.path === path
    && source.ref === sourceHead
    && source.exists === true
    && Number.isSafeInteger(source.size)
    && source.size === bytes
    && source.size > 0
    && source.size <= MAX_BYTES
    && GIT_BLOB.test(text(source.blobSha))
    && source.blobSha === gitBlobSha(content)
  );
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

function escalationPaths(analysis = {}) {
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  if (findings.length !== WINDOWS_AUTHORITY_FORGE_M3_EXECUTOR_PATHS_V1.length) return [];
  if (!findings.every((item) => (
    text(item?.severity).toUpperCase() === 'P0'
    && text(item?.code) === 'unsupported-high-risk-surface'
  ))) return [];
  const paths = findings.map((item) => text(item?.path)).sort();
  const expected = [...WINDOWS_AUTHORITY_FORGE_M3_EXECUTOR_PATHS_V1].sort();
  return JSON.stringify(paths) === JSON.stringify(expected) ? paths : [];
}

function reviewExecutor(source, path, findings) {
  for (const [literal, code, summary] of [
    ["[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'High')]", 'forge-m3-executor-shouldprocess-missing', 'Forge M3 host execution must remain high-impact ShouldProcess-gated.'],
    ["[switch]$OperatorApproved", 'forge-m3-executor-operator-approval-missing', 'Forge M3 host execution must require explicit operator approval.'],
    ["$Repository = 'Cheekyfellastef/stephan-os'", 'forge-m3-executor-repository-not-fixed', 'Forge M3 repository identity must remain fixed.'],
    ["$MachineName = 'stephanos-forge-shadow'", 'forge-m3-executor-machine-not-fixed', 'Forge M3 Podman machine identity must remain fixed.'],
    ["$CanaryListener = '127.0.0.1:3342'", 'forge-m3-executor-listener-not-loopback', 'Forge M3 canary must remain bound to loopback.'],
    ["$SandboxExe = Join-Path $env:SystemRoot 'System32\\WindowsSandbox.exe'", 'forge-m3-executor-sandbox-not-fixed', 'Windows proof execution must remain bound to Windows Sandbox.'],
    ["'--connection', $MachineName", 'forge-m3-executor-podman-connection-not-fixed', 'Every Podman operation must remain bound to the named machine.'],
    ["'--read-only'", 'forge-m3-executor-readonly-boundary-missing', 'Forge M3 isolated execution must retain a read-only outer boundary.'],
    ["'--cap-drop', 'ALL'", 'forge-m3-executor-cap-drop-missing', 'Forge M3 isolated execution must drop all container capabilities.'],
    ["'no-new-privileges'", 'forge-m3-executor-new-privileges-not-blocked', 'Forge M3 isolated execution must block new privileges.'],
    ["'--ephemeral'", 'forge-m3-executor-ephemeral-registration-missing', 'Forge M3 runner registration must remain ephemeral.'],
    ["@('one-job', '--url'", 'forge-m3-executor-one-job-missing', 'Forge M3 runners must remain one-job only.'],
    ["'--token-url', 'file:///runner/runner-token'", 'forge-m3-executor-token-file-not-fixed', 'Forge M3 runner token delivery must remain the fixed local token file.'],
    ["Invoke-CanaryDispatch 'linux-isolated' $runnerId", 'forge-m3-executor-linux-dispatch-not-fixed', 'Linux canary dispatch must remain exact-runner bound.'],
    ["Invoke-CanaryDispatch 'windows-proof-isolated' $runnerId", 'forge-m3-executor-windows-dispatch-not-fixed', 'Windows canary dispatch must remain exact-runner bound.'],
    ["Assert-RunnerRegistrationAbsent $runnerId", 'forge-m3-executor-registration-teardown-unproven', 'Forge M3 must negatively prove runner registration removal.'],
    ["'gitRefWrite = $false'", 'forge-m3-executor-git-authority-not-zero', 'Forge M3 receipt authority must deny Git ref writes.'],
    ["'mergeAuthority = $false'", 'forge-m3-executor-merge-authority-not-zero', 'Forge M3 receipt authority must deny merge authority.'],
    ["'deploymentAuthority = $false'", 'forge-m3-executor-deploy-authority-not-zero', 'Forge M3 receipt authority must deny deployment authority.'],
    ["'arbitraryCommand = $false'", 'forge-m3-executor-arbitrary-authority-not-zero', 'Forge M3 receipt authority must deny arbitrary command authority.'],
  ]) requireLiteral(findings, source, literal, code, summary, path);

  requirePattern(findings, source, /branch', '--show-current'/, 'forge-m3-executor-branch-proof-missing', 'Forge M3 must prove the canonical branch.', path);
  requirePattern(findings, source, /rev-parse', 'HEAD'/, 'forge-m3-executor-head-proof-missing', 'Forge M3 must prove the exact source head.', path);
  requirePattern(findings, source, /rev-parse', "\$ExpectedHead\^\{tree\}"/, 'forge-m3-executor-tree-proof-missing', 'Forge M3 must prove the exact source tree.', path);
  requirePattern(findings, source, /Stop-Process -Id \$script:SandboxProcess\.Id/, 'forge-m3-executor-sandbox-teardown-missing', 'Forge M3 must destroy the owned Windows Sandbox process.', path);
  forbidPattern(findings, source, /Invoke-Expression|ScriptBlock::Create|cmd\.exe|Start-Job/i, 'forge-m3-executor-dynamic-execution-forbidden', 'Forge M3 executor must not gain dynamic execution authority.', path);
  forbidPattern(findings, source, /git(?:\.exe)?\s+(?:push|reset|clean|checkout|rebase)\b/i, 'forge-m3-executor-git-mutation-forbidden', 'Forge M3 executor must not mutate Git refs or working state.', path);
}

function reviewStaticTest(source, path, findings) {
  for (const [literal, code, summary] of [
    ["new URL('./invoke-forge-shadow-m3-fixed-proof-executors-v1.ps1'", 'forge-m3-static-test-source-not-fixed', 'Forge M3 static test must inspect only its adjacent fixed executor source.'],
    ["test('fixed host executor is exact-source, exact-artifact, exact-plan and authorization bound'", 'forge-m3-static-test-source-binding-missing', 'Forge M3 static test must guard source, artifact, plan and authorization binding.'],
    ["test('Linux execution is a rootless outer Podman boundary with repository-scoped ephemeral one-job registration'", 'forge-m3-static-test-linux-isolation-missing', 'Forge M3 static test must guard Linux rootless one-job isolation.'],
    ["test('Windows proof uses only a disposable Sandbox exchange and an exact-address temporary relay'", 'forge-m3-static-test-windows-isolation-missing', 'Forge M3 static test must guard Windows Sandbox and exact-address relay isolation.'],
    ["test('executor emits only post-teardown closed-world observations and no reusable authority'", 'forge-m3-static-test-teardown-authority-missing', 'Forge M3 static test must guard teardown and zero reusable authority.'],
    ["FORGE_M3_EPHEMERAL_REGISTRATION_REMAINS", 'forge-m3-static-test-registration-teardown-missing', 'Forge M3 static test must guard zero residual runner registration.'],
  ]) requireLiteral(findings, source, literal, code, summary, path);

  forbidPattern(findings, source, /node:child_process|spawnSync|execSync|execFile|fork\(/, 'forge-m3-static-test-child-process-forbidden', 'Forge M3 static reviewer test must remain non-executing.', path);
}

export function analyzeWindowsAuthorityForgeM3ExecutorReview(input = {}) {
  const repository = text(input.repository);
  const sourceHead = text(input.sourceHead).toLowerCase();
  const paths = escalationPaths(input.analysis);
  if (repository !== 'Cheekyfellastef/stephan-os' || !EXACT_HEAD.test(sourceHead) || !paths.length) {
    return Object.freeze({
      eligible: false,
      clean: false,
      findings: Object.freeze([]),
      reviewedPaths: Object.freeze([]),
      proofRefs: Object.freeze([]),
      finalVerdict: 'WINDOWS_AUTHORITY_FORGE_M3_EXECUTOR_SPECIALIST_NOT_ELIGIBLE',
    });
  }

  const sources = Array.isArray(input.sources) ? input.sources : [];
  const findings = [];
  const proofRefs = [];

  for (const path of WINDOWS_AUTHORITY_FORGE_M3_EXECUTOR_PATHS_V1) {
    const candidates = sources.filter((source) => source?.path === path);
    if (candidates.length !== 1 || !exactSource(candidates[0], repository, sourceHead, path)) {
      findings.push(finding('windows-authority-source-evidence-invalid', 'Forge M3 specialist requires one exact immutable source record per reviewed path.', path));
      continue;
    }
    const source = candidates[0].content;
    if (path.endsWith('.ps1')) reviewExecutor(source, path, findings);
    else reviewStaticTest(source, path, findings);
    proofRefs.push(`proofs/windows-authority-forge-m3-executor/${path}@${sourceHead}#${candidates[0].blobSha}:${candidates[0].size}`);
  }

  if (sources.length !== WINDOWS_AUTHORITY_FORGE_M3_EXECUTOR_PATHS_V1.length) {
    findings.push(finding('windows-authority-source-estate-invalid', 'Forge M3 specialist source estate must contain exactly the two qualified files.', WINDOWS_AUTHORITY_FORGE_M3_EXECUTOR_PATHS_V1[0]));
  }

  const clean = findings.length === 0;
  return Object.freeze({
    eligible: true,
    clean,
    findings: Object.freeze(findings),
    reviewedPaths: Object.freeze([...WINDOWS_AUTHORITY_FORGE_M3_EXECUTOR_PATHS_V1]),
    proofRefs: Object.freeze(proofRefs),
    finalVerdict: clean
      ? 'WINDOWS_AUTHORITY_FORGE_M3_EXECUTOR_SPECIALIST_CLEAN'
      : 'WINDOWS_AUTHORITY_FORGE_M3_EXECUTOR_SPECIALIST_FINDINGS',
  });
}
