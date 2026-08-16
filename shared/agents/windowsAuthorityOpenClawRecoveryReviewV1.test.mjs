import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  WINDOWS_AUTHORITY_OPENCLAW_RECOVERY_PATHS_V1,
  analyzeWindowsAuthorityOpenClawRecoveryReview,
} from './windowsAuthorityOpenClawRecoveryReviewV1.mjs';

const repository = 'Cheekyfellastef/stephan-os';
const head = 'a'.repeat(40);
const blobSha = (content) => {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
};
const sourceRecord = (path, content) => ({
  schemaVersion: 'stephanos.windows-authority-source.v1', repository, path, ref: head,
  exists: true, size: Buffer.byteLength(content, 'utf8'), blobSha: blobSha(content), content,
});
const analysisFor = (paths) => ({ findings: paths.map((path) => ({ severity: 'P0', code: 'unsupported-high-risk-surface', path })) });
const analyze = (entries) => analyzeWindowsAuthorityOpenClawRecoveryReview({
  repository, sourceHead: head, analysis: analysisFor(entries.map(([path]) => path)),
  sources: entries.map(([path, content]) => sourceRecord(path, content)),
});
const codes = (result) => result.findings.map((item) => item.code);

function pluginFixture() {
  return [
    "export const OPENCLAW_RECOVERY_ROUTE = 'OPENCLAW_WHATSAPP';",
    "schemaVersion: 'stephanos.openclaw-authenticated-recovery-command.v1'",
    "subject: 'openclaw:authenticated-operator'",
    "commandSurface: 'openclaw.plugin-sdk.authenticated-command'",
    "new Date(now.getTime() + 60_000).toISOString()",
    "openSync(proofPath, 'wx', 0o600)",
    "request-battle-bridge-recovery-openclaw.ps1",
    "'-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath",
    "'-OpenClawHostProofId', hostProofId",
    "runtimeId: authenticatedOpenClawHostRuntimeId(authenticatedContext, hostPid)",
    "source: 'authenticated-plugin-host'",
    "shell: false",
    "windowsHide: true",
    "timeout: 30_000",
    "arbitraryShellAllowed: false",
    "sourceMutationAllowed: false",
    "if (authenticatedContext?.authenticatedByHost !== true || authenticatedContext?.commandName !== 'stephanos-ignite' || authenticatedContext?.command !== 'wake') throw new Error('RECOVERY_WAKE_OPENCLAW_AUTH_REQUIRED');",
    "const response = await fetchFn('http://127.0.0.1:18789/identity', { signal: AbortSignal.timeout(5_000) });",
    "if (identity?.product === 'OpenClaw' && identity?.runtimeId) return identity;",
  ].join('\n');
}
function pluginTestFixture() {
  return [
    "from './recovery-wake.mjs'",
    "authenticated OpenClaw plugin host is a bounded fallback when /identity serves the HTML control page",
    "assert.equal(writtenProof.runtimeId, 'openclaw-plugin-host:4321')",
    "assert.equal(invocation.arbitraryShellAllowed, false)",
    "assert.equal(result.sourceMutationAllowed, false)",
  ].join('\n');
}
function ingressFixture() {
  return [
    "[ValidatePattern('^[a-f0-9]{32}$')]",
    "$route = 'OPENCLAW_WHATSAPP'",
    "$taskName = 'Stephanos Battle Bridge Recovery Mesh'",
    "$repoRoot = Join-Path $env:USERPROFILE 'Documents\\GitHub\\stephan-os'",
    "run-stephanos-scheduled-task-windowless.vbs",
    "$wscriptPath = 'C:\\Windows\\System32\\wscript.exe'",
    "if ([string]$hostProof.schemaVersion -ne 'stephanos.openclaw-authenticated-recovery-command.v1' -or [string]$hostProof.subject -ne 'openclaw:authenticated-operator' -or [string]$hostProof.commandSurface -ne 'openclaw.plugin-sdk.authenticated-command') { throw 'OPENCLAW_HOST_PROOF_INVALID' }",
    "if ($hostIssuedAt -lt $hostNow.AddSeconds(-60)) { throw 'OPENCLAW_HOST_PROOF_INVALID' }",
    "throw 'OPENCLAW_HOST_PROCESS_IDENTITY_INVALID'",
    "Get-NetTCPConnection -State Listen -LocalPort 18789 | Where-Object { $_.OwningProcess -eq [int]$hostProof.hostPid -and $_.LocalAddress -in @('127.0.0.1','::1','0.0.0.0','::') }",
    "throw 'OPENCLAW_GATEWAY_PROCESS_OWNERSHIP_INVALID'",
    "if ([string]$hostProof.runtimeId -like 'openclaw-plugin-host:*') { $expected = \"openclaw-plugin-host:$($hostProcess.ProcessId)\" }",
    "throw 'OPENCLAW_HOST_PROOF_ALREADY_CONSUMED'",
    "if ([string]$task.Principal.LogonType -ne 'Interactive') { throw 'x' }",
    "if ([string]$task.Principal.RunLevel -ne 'Limited') { throw 'x' }",
    "if ([string]$task.Settings.MultipleInstances -ne 'IgnoreNew') { throw 'x' }",
    "action = 'WAKE_CANONICAL_BATTLE_BRIDGE_DISPATCHER'",
    "issuer = 'openclaw-authenticated-command'",
    "arbitraryShellAllowed = $false",
    "arbitraryTaskNameAllowed = $false",
    "sourceMutationAllowed = $false",
    "Move-Item -LiteralPath $temporaryPath -Destination $requestPath -Force",
    "$taskStateBefore = [string]$task.State",
    "if ($taskStateBefore -ne 'Running') { Start-ScheduledTask -TaskName $taskName }",
  ].join('\n');
}
function ingressTestFixture() {
  return [
    "request-battle-bridge-recovery-openclaw.ps1",
    "assert.doesNotMatch(source, /127\\.0\\.0\\.1:18789\\/identity/i)",
    "assert.match(source, /Get-NetTCPConnection[\\s\\S]*LocalPort 18789/)",
    "assert.match(source, /arbitraryShellAllowed = \\$false/)",
    "assert.match(source, /sourceMutationAllowed = \\$false/)",
    "assert.match(source, /OPENCLAW_HOST_PROOF_ALREADY_CONSUMED/)",
  ].join('\n');
}

test('reviewer owns exactly the four OpenClaw recovery authority files', () => {
  assert.deepEqual(WINDOWS_AUTHORITY_OPENCLAW_RECOVERY_PATHS_V1, [
    'integrations/openclaw/stephanos-ignite-command/lib/recovery-wake.mjs',
    'integrations/openclaw/stephanos-ignite-command/lib/recovery-wake.test.mjs',
    'scripts/windows/request-battle-bridge-recovery-openclaw.ps1',
    'scripts/windows/request-battle-bridge-recovery-openclaw.test.mjs',
  ]);
});

test('reviewer accepts the closed-world OpenClaw recovery contract', () => {
  const entries = [
    [WINDOWS_AUTHORITY_OPENCLAW_RECOVERY_PATHS_V1[0], pluginFixture()],
    [WINDOWS_AUTHORITY_OPENCLAW_RECOVERY_PATHS_V1[1], pluginTestFixture()],
    [WINDOWS_AUTHORITY_OPENCLAW_RECOVERY_PATHS_V1[2], ingressFixture()],
    [WINDOWS_AUTHORITY_OPENCLAW_RECOVERY_PATHS_V1[3], ingressTestFixture()],
  ];
  const result = analyze(entries);
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true, JSON.stringify(result.findings));
  assert.deepEqual(result.reviewedPaths, WINDOWS_AUTHORITY_OPENCLAW_RECOVERY_PATHS_V1);
});

test('reviewer rejects unrelated high-risk paths and invalid exact-head evidence', () => {
  const unrelated = 'scripts/windows/arbitrary-admin.ps1';
  const no = analyzeWindowsAuthorityOpenClawRecoveryReview({ repository, sourceHead: head, analysis: analysisFor([unrelated]), sources: [sourceRecord(unrelated, 'x')] });
  assert.equal(no.eligible, false);
  const path = WINDOWS_AUTHORITY_OPENCLAW_RECOVERY_PATHS_V1[2];
  const record = sourceRecord(path, ingressFixture());
  record.blobSha = 'b'.repeat(40);
  const bad = analyzeWindowsAuthorityOpenClawRecoveryReview({ repository, sourceHead: head, analysis: analysisFor([path]), sources: [record] });
  assert.ok(codes(bad).includes('windows-authority-source-evidence-invalid'));
});

test('reviewer blocks widened shell, task, Git and restart authority', () => {
  const pluginPath = WINDOWS_AUTHORITY_OPENCLAW_RECOVERY_PATHS_V1[0];
  assert.ok(codes(analyze([[pluginPath, `${pluginFixture()}\nshell: true`]])).includes('openclaw-dynamic-shell-forbidden'));
  const ingressPath = WINDOWS_AUTHORITY_OPENCLAW_RECOVERY_PATHS_V1[2];
  for (const [extra, code] of [
    ['Register-ScheduledTask -TaskName x', 'openclaw-task-construction-forbidden'],
    ['Start-ScheduledTask -TaskName $CallerTask', 'openclaw-arbitrary-task-start-forbidden'],
    ['Invoke-Expression $payload', 'openclaw-dynamic-execution-forbidden'],
    ['git reset --hard HEAD', 'windows-authority-source-mutation-forbidden'],
    ['Restart-Computer', 'windows-authority-expanded'],
  ]) assert.ok(codes(analyze([[ingressPath, `${ingressFixture()}\n${extra}`]])).includes(code), extra);
});
