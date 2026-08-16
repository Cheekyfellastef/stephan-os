import { createHash } from 'node:crypto';

export const WINDOWS_AUTHORITY_OPENCLAW_RECOVERY_PATHS_V1 = Object.freeze([
  'integrations/openclaw/stephanos-ignite-command/lib/recovery-wake.mjs',
  'integrations/openclaw/stephanos-ignite-command/lib/recovery-wake.test.mjs',
  'scripts/windows/request-battle-bridge-recovery-openclaw.ps1',
  'scripts/windows/request-battle-bridge-recovery-openclaw.test.mjs',
]);

const SCHEMA = 'stephanos.windows-authority-specialist-review.v1';
const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const SHA = /^[a-f0-9]{40}$/;
const text = (value) => String(value ?? '').trim();
const finding = (code, path) => Object.freeze({ severity: 'P0', code, summary: code, path });
const unique = (values) => [...new Set(values)];
const joinedPattern = (parts, flags = '') => new RegExp(parts.join(''), flags);

function blobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function escalationPaths(analysis) {
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  if (!findings.length || !findings.every((item) => (
    text(item?.severity).toUpperCase() === 'P0'
    && text(item?.code) === 'unsupported-high-risk-surface'
    && WINDOWS_AUTHORITY_OPENCLAW_RECOVERY_PATHS_V1.includes(text(item?.path))
  ))) return [];
  return unique(findings.map((item) => text(item.path)));
}

function exactSource(source, repository, head, path) {
  const content = typeof source?.content === 'string' ? source.content : '';
  const size = Buffer.byteLength(content, 'utf8');
  return Boolean(source && typeof source === 'object' && !Array.isArray(source)
    && source.schemaVersion === SOURCE_SCHEMA
    && source.repository === repository
    && source.path === path
    && source.ref === head
    && source.exists === true
    && Number.isSafeInteger(source.size)
    && source.size === size && size > 0 && size <= 256 * 1024
    && SHA.test(text(source.blobSha))
    && source.blobSha === blobSha(content));
}

function requireLiterals(findings, source, path, rules) {
  for (const [literal, code] of rules) if (!source.includes(literal)) findings.push(finding(code, path));
}
function requirePatterns(findings, source, path, rules) {
  for (const [pattern, code] of rules) if (!pattern.test(source)) findings.push(finding(code, path));
}
function forbidPatterns(findings, source, path, rules) {
  for (const [pattern, code] of rules) if (pattern.test(source)) findings.push(finding(code, path));
}
function requireLiteralCount(findings, source, path, literal, expected, code) {
  if (source.split(literal).length - 1 !== expected) findings.push(finding(code, path));
}

function reviewPluginWake(source, path, findings) {
  requireLiterals(findings, source, path, [
    ["export const OPENCLAW_RECOVERY_ROUTE = 'OPENCLAW_WHATSAPP';", 'openclaw-recovery-route-not-fixed'],
    ["schemaVersion: 'stephanos.openclaw-authenticated-recovery-command.v1'", 'openclaw-host-proof-schema-missing'],
    ["subject: 'openclaw:authenticated-operator'", 'openclaw-host-proof-subject-not-fixed'],
    ["commandSurface: 'openclaw.plugin-sdk.authenticated-command'", 'openclaw-command-surface-not-fixed'],
    ["new Date(now.getTime() + 60_000).toISOString()", 'openclaw-host-proof-expiry-not-bounded'],
    ["openSync(proofPath, 'wx', 0o600)", 'openclaw-host-proof-exclusive-write-missing'],
    ["request-battle-bridge-recovery-openclaw.ps1", 'openclaw-recovery-adapter-not-fixed'],
    ["'-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath", 'openclaw-powershell-invocation-not-fixed'],
    ["'-OpenClawHostProofId', hostProofId", 'openclaw-proof-argument-not-fixed'],
    ["runtimeId: authenticatedOpenClawHostRuntimeId(authenticatedContext, hostPid)", 'openclaw-authenticated-host-fallback-missing'],
    ["source: 'authenticated-plugin-host'", 'openclaw-authenticated-host-fallback-unlabelled'],
    ["shell: false", 'openclaw-shell-denial-missing'],
    ["windowsHide: true", 'openclaw-windowless-invocation-missing'],
    ["timeout: 30_000", 'openclaw-recovery-timeout-not-bounded'],
    ["arbitraryShellAllowed: false", 'openclaw-arbitrary-shell-denial-missing'],
    ["sourceMutationAllowed: false", 'openclaw-source-mutation-denial-missing'],
  ]);
  requirePatterns(findings, source, path, [
    [/authenticatedContext\?\.authenticatedByHost !== true[\s\S]*commandName !== 'stephanos-ignite'[\s\S]*command !== 'wake'/, 'openclaw-authenticated-command-gate-missing'],
    [/fetchFn\('http:\/\/127\.0\.0\.1:18789\/identity'[\s\S]*AbortSignal\.timeout\(5_000\)/, 'openclaw-identity-probe-not-bounded'],
    [/identity\?\.product === 'OpenClaw'[\s\S]*identity\?\.runtimeId/, 'openclaw-json-identity-not-product-bound'],
  ]);
  forbidPatterns(findings, source, path, [
    [joinedPattern(['\\bex', 'ec(?:Sync|File|FileSync)?\\s*\\(|\\bsp', 'awn\\s*\\(|\\bfo', 'rk\\s*\\(']), 'openclaw-dynamic-process-execution-forbidden'],
    [joinedPattern(['shell\\s*:\\s*true|Invoke-', 'Expression|\\biex\\b|cmd\\.exe'], 'i'), 'openclaw-dynamic-shell-forbidden'],
    [/git(?:\.exe)?\s+(?:push|reset|clean|rebase|checkout|switch|merge|stash)\b/i, 'windows-authority-source-mutation-forbidden'],
    [joinedPattern(['Restart-', 'Computer|shutdown\\.exe|Stop-', 'Process'], 'i'), 'windows-authority-expanded'],
  ]);
}

function reviewPluginWakeTest(source, path, findings) {
  requireLiterals(findings, source, path, [
    ["from './recovery-wake.mjs'", 'openclaw-recovery-test-target-not-fixed'],
    ["authenticated OpenClaw plugin host is a bounded fallback when /identity serves the HTML control page", 'openclaw-html-fallback-regression-test-missing'],
    ["assert.equal(writtenProof.runtimeId, 'openclaw-plugin-host:4321')", 'openclaw-host-fallback-assertion-missing'],
    ["assert.equal(invocation.arbitraryShellAllowed, false)", 'openclaw-shell-denial-test-missing'],
    ["assert.equal(result.sourceMutationAllowed, false)", 'openclaw-source-denial-test-missing'],
  ]);
  forbidPatterns(findings, source, path, [
    [joinedPattern(["from ['\"]node:child_", "process['\"]|require\\(['\"]child_", "process['\"]\\)"]), 'openclaw-test-real-process-authority-forbidden'],
    [joinedPattern(['Restart-', 'Computer|shutdown\\.exe'], 'i'), 'windows-authority-expanded'],
  ]);
}

function reviewWindowsIngress(source, path, findings) {
  requireLiterals(findings, source, path, [
    ["[ValidatePattern('^[a-f0-9]{32}$')]", 'openclaw-proof-id-not-bounded'],
    ["$route = 'OPENCLAW_WHATSAPP'", 'openclaw-ingress-route-not-fixed'],
    ["$taskName = 'Stephanos Battle Bridge Recovery Mesh'", 'openclaw-ingress-task-not-fixed'],
    ["'Documents\\GitHub\\stephan-os'", 'openclaw-ingress-repository-root-not-fixed'],
    ["run-stephanos-scheduled-task-windowless.vbs", 'openclaw-ingress-launcher-not-fixed'],
    ["$wscriptPath = 'C:\\Windows\\System32\\wscript.exe'", 'openclaw-ingress-wscript-not-fixed'],
    ["schemaVersion -ne 'stephanos.openclaw-authenticated-recovery-command.v1'", 'openclaw-host-proof-schema-gate-missing'],
    ["subject -ne 'openclaw:authenticated-operator'", 'openclaw-host-proof-subject-gate-missing'],
    ["commandSurface -ne 'openclaw.plugin-sdk.authenticated-command'", 'openclaw-command-surface-gate-missing'],
    ["hostIssuedAt -lt $hostNow.AddSeconds(-60)", 'openclaw-proof-age-gate-missing'],
    ["OPENCLAW_HOST_PROCESS_IDENTITY_INVALID", 'openclaw-host-process-proof-missing'],
    ["Get-NetTCPConnection -State Listen -LocalPort 18789", 'openclaw-port-ownership-proof-missing'],
    ["OPENCLAW_GATEWAY_PROCESS_OWNERSHIP_INVALID", 'openclaw-port-ownership-blocker-missing'],
    ["OPENCLAW_HOST_PROOF_ALREADY_CONSUMED", 'openclaw-proof-replay-protection-missing'],
    ["[string]$task.Principal.LogonType -ne 'Interactive'", 'openclaw-task-logon-proof-missing'],
    ["[string]$task.Principal.RunLevel -ne 'Limited'", 'openclaw-task-runlevel-proof-missing'],
    ["[string]$task.Settings.MultipleInstances -ne 'IgnoreNew'", 'openclaw-task-overlap-proof-missing'],
    ["action = 'WAKE_CANONICAL_BATTLE_BRIDGE_DISPATCHER'", 'openclaw-ingress-action-not-fixed'],
    ["issuer = 'openclaw-authenticated-command'", 'openclaw-ingress-issuer-not-fixed'],
    ["arbitraryShellAllowed = $false", 'openclaw-ingress-shell-denial-missing'],
    ["arbitraryTaskNameAllowed = $false", 'openclaw-ingress-task-denial-missing'],
    ["sourceMutationAllowed = $false", 'openclaw-ingress-source-denial-missing'],
    ["Move-Item -LiteralPath $temporaryPath -Destination $requestPath -Force", 'openclaw-ingress-durable-request-missing'],
    ["if ($taskStateBefore -ne 'Running')", 'openclaw-ingress-idempotent-start-gate-missing'],
    ["Start-ScheduledTask -TaskName $taskName", 'openclaw-ingress-fixed-task-start-missing'],
  ]);
  requirePatterns(findings, source, path, [
    [/OwningProcess -eq \[int\]\$hostProof\.hostPid[\s\S]*LocalAddress -in @\('127\.0\.0\.1','::1','0\.0\.0\.0','::'\)/, 'openclaw-listener-owner-join-incomplete'],
    [/hostProof\.runtimeId -like 'openclaw-plugin-host:\*'[\s\S]*openclaw-plugin-host:\$\(\$hostProcess\.ProcessId\)/, 'openclaw-runtime-id-process-binding-missing'],
  ]);
  requireLiteralCount(findings, source, path, 'Start-ScheduledTask -TaskName $taskName', 1, 'openclaw-ingress-start-count-not-one');
  forbidPatterns(findings, source, path, [
    [/Invoke-RestMethod[^\r\n]*18789\/identity|127\.0\.0\.1:18789\/identity/i, 'openclaw-synthetic-identity-dependency-forbidden'],
    [joinedPattern(['Invoke-', 'Expression|\\biex\\b|Start-', 'Process|cmd\\.exe'], 'i'), 'openclaw-dynamic-execution-forbidden'],
    [/\b(?:Register|Unregister)-ScheduledTask\b|\bNew-ScheduledTask(?:Action|Trigger|Principal|SettingsSet)?\b/i, 'openclaw-task-construction-forbidden'],
    [/git(?:\.exe)?\s+(?:push|reset|clean|rebase|checkout|switch|merge|stash|fetch)\b/i, 'windows-authority-source-mutation-forbidden'],
    [/(?:^|\s)-(?:EncodedCommand|Command)\b/im, 'openclaw-dynamic-powershell-forbidden'],
    [joinedPattern(['Restart-', 'Computer|shutdown\\.exe|Stop-', 'Process|RunLevel\\s+Highest'], 'i'), 'windows-authority-expanded'],
    [/Start-ScheduledTask\s+-TaskName\s+\$(?!taskName\b)/i, 'openclaw-arbitrary-task-start-forbidden'],
  ]);
}

function reviewWindowsIngressTest(source, path, findings) {
  requireLiterals(findings, source, path, [
    ["request-battle-bridge-recovery-openclaw.ps1", 'openclaw-ingress-test-target-not-fixed'],
    ["assert.doesNotMatch(source, /127\\.0\\.0\\.1:18789\\/identity/i)", 'openclaw-no-synthetic-identity-test-missing'],
    ["assert.match(source, /Get-NetTCPConnection[\\s\\S]*LocalPort 18789/)", 'openclaw-port-owner-test-missing'],
    ["assert.match(source, /arbitraryShellAllowed = \\$false/)", 'openclaw-ingress-shell-denial-test-missing'],
    ["assert.match(source, /sourceMutationAllowed = \\$false/)", 'openclaw-ingress-source-denial-test-missing'],
    ["assert.match(source, /OPENCLAW_HOST_PROOF_ALREADY_CONSUMED/)", 'openclaw-replay-test-missing'],
  ]);
  forbidPatterns(findings, source, path, [
    [joinedPattern(["from ['\"]node:child_", "process['\"]|require\\(['\"]child_", "process['\"]\\)"]), 'openclaw-test-real-process-authority-forbidden'],
    [joinedPattern(['Restart-', 'Computer|shutdown\\.exe'], 'i'), 'windows-authority-expanded'],
  ]);
}

export function analyzeWindowsAuthorityOpenClawRecoveryReview(input = {}) {
  const repository = text(input.repository);
  const sourceHead = text(input.sourceHead).toLowerCase();
  const paths = escalationPaths(input.analysis);
  const eligible = repository.includes('/') && SHA.test(sourceHead) && paths.length > 0
    && paths.every((path) => WINDOWS_AUTHORITY_OPENCLAW_RECOVERY_PATHS_V1.includes(path));
  if (!eligible) return Object.freeze({ schemaVersion: SCHEMA, eligible: false, clean: false, reviewedPaths: Object.freeze([]), findings: Object.freeze([]), proofRefs: Object.freeze([]), finalVerdict: 'WINDOWS_AUTHORITY_SPECIALIST_NOT_APPLICABLE' });

  const sources = Array.isArray(input.sources) ? input.sources : [];
  const findings = [];
  const proofRefs = [];
  for (const path of paths) {
    const candidates = sources.filter((source) => text(source?.path) === path);
    if (candidates.length !== 1 || !exactSource(candidates[0], repository, sourceHead, path)) {
      findings.push(finding('windows-authority-source-evidence-invalid', path));
      continue;
    }
    const source = candidates[0].content;
    if (path === WINDOWS_AUTHORITY_OPENCLAW_RECOVERY_PATHS_V1[0]) reviewPluginWake(source, path, findings);
    if (path === WINDOWS_AUTHORITY_OPENCLAW_RECOVERY_PATHS_V1[1]) reviewPluginWakeTest(source, path, findings);
    if (path === WINDOWS_AUTHORITY_OPENCLAW_RECOVERY_PATHS_V1[2]) reviewWindowsIngress(source, path, findings);
    if (path === WINDOWS_AUTHORITY_OPENCLAW_RECOVERY_PATHS_V1[3]) reviewWindowsIngressTest(source, path, findings);
    proofRefs.push(`proofs/windows-authority-specialist/${path}@${sourceHead}#${candidates[0].blobSha}:${candidates[0].size}`);
  }
  const clean = findings.length === 0;
  return Object.freeze({ schemaVersion: SCHEMA, eligible: true, clean, reviewedPaths: Object.freeze(paths), findings: Object.freeze(findings), proofRefs: Object.freeze(proofRefs), finalVerdict: clean ? 'WINDOWS_AUTHORITY_SPECIALIST_CLEAN' : 'WINDOWS_AUTHORITY_SPECIALIST_FINDINGS' });
}
