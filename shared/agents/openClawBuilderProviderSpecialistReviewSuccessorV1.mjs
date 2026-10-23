import { createHash } from 'node:crypto';

export const OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1 = Object.freeze([
  'scripts/windows/restart-approved-stephanos-runtime.ps1',
]);

export const OPENCLAW_UPDATE_PREFLIGHT_SUCCESSOR_SPECIALIST_PATHS_V1 = Object.freeze([
  '.github/workflows/openclaw-update-preflight-proof.yml',
  'scripts/openclaw-update-preflight.mjs',
  'scripts/openclaw-update-preflight.test.mjs',
  'shared/agents/openClawUpdatePreflightV1.mjs',
  'shared/agents/openClawUpdatePreflightV1.test.mjs',
]);

export const MONITOR_MULTIPLEXER_PR1639_SPECIALIST_PATHS_V1 = Object.freeze([
  'scripts/windows/install-battle-bridge-monitor-multiplexer.ps1',
  'scripts/windows/run-battle-bridge-monitor-multiplexer-hidden.ps1',
  'scripts/windows/run-stephanos-scheduled-task-windowless.vbs',
]);

const SCHEMA = 'stephanos.openclaw-builder-provider-specialist-review-successor.v1';
const OC9_SCHEMA = 'stephanos.openclaw-update-preflight-specialist-review.v1';
const MULTIPLEXER_SCHEMA = 'stephanos.monitor-multiplexer-pr1639-specialist-review.v1';
const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const CANONICAL_REPOSITORY = 'Cheekyfellastef/stephan-os';
const FULL_SHA = /^[a-f0-9]{40}$/;
const HARDLINK_PR = 2048;
const HARDLINK_BRANCH = 'fix/battle-bridge-canonical-git-hardlink-v1';
const HARDLINK_PATH = OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1[0];
const HARDLINK_BLOB_SHA = 'cbcf5972fc52be2ab459843be9c66382b5a6b569';
const OC9_PR = 1654;
const OC9_BRANCH = 'agent/1415-openclaw-update-preflight-v1';
const MULTIPLEXER_PR = 1639;
const MULTIPLEXER_BRANCH = 'codex/1585-chatgpt-monitor-admission-bridge-v1';
const MULTIPLEXER_BLOB_SHA_BY_PATH = Object.freeze({
  'scripts/windows/install-battle-bridge-monitor-multiplexer.ps1': 'df93fed4ba5af91048f1ae8f748e5d5349d5cb2e',
  'scripts/windows/run-battle-bridge-monitor-multiplexer-hidden.ps1': 'ef2a8cf5a18cdb75ff545c52a89a6b81d933cbb2',
  'scripts/windows/run-stephanos-scheduled-task-windowless.vbs': 'fc29921523e76aa61ba8b5f594c9fe0fe5524723',
});

const text = (value) => String(value ?? '').trim();
const finding = (code, path = HARDLINK_PATH, summary = code) => Object.freeze({
  severity: 'P0', code, summary, path,
});

function gitBlobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function exactUnsupportedEscalation(analysis, expectedPaths) {
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  if (findings.length !== expectedPaths.length) return false;
  if (!findings.every((item) => text(item?.severity).toUpperCase() === 'P0'
    && text(item?.code) === 'unsupported-high-risk-surface')) return false;
  const paths = [...new Set(findings.map((item) => text(item?.path)))].sort();
  return JSON.stringify(paths) === JSON.stringify([...expectedPaths].sort());
}

function exactHardlinkEscalation(analysis) {
  return exactUnsupportedEscalation(analysis, [HARDLINK_PATH]);
}

function exactOc9Escalation(analysis) {
  return exactUnsupportedEscalation(analysis, OPENCLAW_UPDATE_PREFLIGHT_SUCCESSOR_SPECIALIST_PATHS_V1);
}

function exactMultiplexerEscalation(analysis) {
  return exactUnsupportedEscalation(analysis, MONITOR_MULTIPLEXER_PR1639_SPECIALIST_PATHS_V1)
    && Number(analysis?.counts?.P0) === 3
    && Number(analysis?.counts?.P1 ?? 0) === 0
    && Number(analysis?.counts?.P2 ?? 0) === 0;
}

function exactLineage(lineage, sourceHead, baseSha) {
  const parents = Array.isArray(lineage?.parents) ? lineage.parents.map((item) => text(item).toLowerCase()) : [];
  return lineage?.schemaVersion === 'stephanos.windows-authority-reconciliation-lineage.v1'
    && lineage?.repository === CANONICAL_REPOSITORY
    && lineage?.sourceHead === sourceHead
    && lineage?.sourceCommitSha === sourceHead
    && lineage?.baseSha === baseSha
    && lineage?.liveMainBeforeSha === baseSha
    && lineage?.liveMainAfterSha === baseSha
    && parents.length > 0
    && parents.every((parent) => FULL_SHA.test(parent))
    && lineage?.comparison?.status === 'ahead'
    && Number.isSafeInteger(lineage?.comparison?.aheadBy)
    && lineage.comparison.aheadBy > 0
    && lineage?.comparison?.behindBy === 0
    && lineage?.comparison?.baseCommitSha === baseSha
    && lineage?.comparison?.mergeBaseCommitSha === baseSha;
}

function exactMultiplexerLineage(lineage, sourceHead, baseSha) {
  const parents = Array.isArray(lineage?.parents) ? lineage.parents.map((item) => text(item).toLowerCase()) : [];
  return exactLineage(lineage, sourceHead, baseSha) && parents.includes(baseSha);
}

function exactSource(source, sourceHead, path, expectedBlobSha = '') {
  const content = typeof source?.content === 'string' ? source.content : '';
  const size = Buffer.byteLength(content, 'utf8');
  const blobSha = text(source?.blobSha).toLowerCase();
  return Boolean(source && typeof source === 'object' && !Array.isArray(source)
    && source.schemaVersion === SOURCE_SCHEMA
    && source.repository === CANONICAL_REPOSITORY
    && source.path === path
    && source.ref === sourceHead
    && source.exists === true
    && Number.isSafeInteger(source.size)
    && source.size === size
    && size > 0
    && size <= 256 * 1024
    && FULL_SHA.test(blobSha)
    && (!expectedBlobSha || blobSha === expectedBlobSha)
    && blobSha === gitBlobSha(content));
}

function exactHardlinkSource(source, sourceHead) {
  if (!exactSource(source, sourceHead, HARDLINK_PATH, HARDLINK_BLOB_SHA)) return false;
  const content = source.content;
  return content.includes("$canonicalGit = 'C:\\Program Files\\Git\\cmd\\git.exe'")
    && content.includes('$canonicalGitLinkType = [string]$canonicalGitItem.LinkType')
    && content.includes("-and $canonicalGitLinkType -ne 'HardLink')")
    && content.includes('FileAttributes]::ReparsePoint')
    && content.includes('$resolvedCanonicalGit = [System.IO.Path]::GetFullPath($canonicalGitItem.FullName)')
    && content.includes('$canonicalNodeItem.LinkType');
}

function maskCommentsAndStrings(source, { preserveStrings = false } = {}) {
  let out = ''; let quote = ''; let lineComment = false; let blockComment = false; let escaped = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]; const next = source[i + 1] || '';
    if (lineComment) { if (ch === '\n') { lineComment = false; out += '\n'; } else out += ' '; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; out += '  '; i += 1; } else out += ch === '\n' ? '\n' : ' '; continue; }
    if (quote) {
      out += preserveStrings ? ch : (ch === '\n' ? '\n' : ' ');
      if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; out += '  '; i += 1; continue; }
    if (ch === '/' && next === '*') { blockComment = true; out += '  '; i += 1; continue; }
    if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; out += preserveStrings ? ch : ' '; continue; }
    out += ch;
  }
  return out;
}

const stripComments = (source) => maskCommentsAndStrings(source, { preserveStrings: true });
const executableOnly = (source) => maskCommentsAndStrings(source);

function literalStartsInExecutableSource(source, literal) {
  const masked = executableOnly(source);
  let index = source.indexOf(literal);
  while (index >= 0) {
    if (masked[index] === source[index] && masked[index] !== ' ') return true;
    index = source.indexOf(literal, index + 1);
  }
  return false;
}

function requireExecutableLiterals(findings, source, path, rules) {
  for (const [literal, code] of rules) if (!literalStartsInExecutableSource(source, literal)) findings.push(finding(code, path));
}

function activeTestTitle(source, title) {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\btest\\s*\\(\\s*(['\"])${escaped}\\1\\s*,`).test(stripComments(source));
}

function requireActiveTests(findings, source, path, rules) {
  for (const [title, code] of rules) if (!activeTestTitle(source, title)) findings.push(finding(code, path));
}

function forbidPatterns(findings, source, path, rules) {
  const uncommented = stripComments(source);
  for (const [pattern, code] of rules) if (pattern.test(uncommented)) findings.push(finding(code, path));
}

function workflowWritePermissionViolation(source) {
  const uncommented = source.split('\n').filter((line) => !line.trimStart().startsWith('#')).join('\n');
  return /^\s*permissions\s*:\s*write-all\s*(?:#.*)?$/im.test(uncommented)
    || /^\s*[A-Za-z0-9_-]+\s*:\s*write\s*(?:#.*)?$/im.test(uncommented)
    || /\bpermissions\s*:\s*\{[^}]*:\s*write\b/i.test(uncommented);
}

function workflowHasExactLine(source, line) {
  return source.split('\n').some((candidate) => !candidate.trim().startsWith('#') && candidate.trim() === line);
}

function dynamicAuthorityViolation(source) {
  const uncommented = stripComments(source);
  return /\bfrom\s+['\"](?:node:)?(?:child_process|fs|http|https|net)['\"]/i.test(uncommented)
    || /\bimport\s*\(\s*['\"](?:node:)?(?:child_process|fs|http|https|net)['\"]\s*\)/i.test(uncommented)
    || /\brequire\s*\(\s*['\"](?:node:)?(?:child_process|fs|http|https|net)['\"]\s*\)/i.test(uncommented)
    || /\b(?:exec|execSync|execFile|execFileSync|spawn|spawnSync|fork)\s*\(/i.test(uncommented)
    || /\[\s*['"](?:exec|execSync|execFile|execFileSync|spawn|spawnSync|fork)['"]\s*\]\s*\(/i.test(uncommented);
}

function reviewOc9Workflow(source, path, findings) {
  if (!/^permissions:\s*\n\s+contents:\s*read\s*$/m.test(source)) findings.push(finding('oc9-workflow-read-only-permission-missing', path));
  for (const [line, code] of [
    ['node --check shared/agents/openClawUpdatePreflightV1.mjs', 'oc9-workflow-model-parse-proof-missing'],
    ['node --check scripts/openclaw-update-preflight.mjs', 'oc9-workflow-cli-parse-proof-missing'],
    ['node --test shared/agents/openClawUpdatePreflightV1.test.mjs scripts/openclaw-update-preflight.test.mjs', 'oc9-workflow-focused-proof-missing'],
    ['git diff --check', 'oc9-workflow-patch-hygiene-proof-missing'],
  ]) if (!workflowHasExactLine(source, line)) findings.push(finding(code, path));
  forbidPatterns(findings, source, path, [
    [/pull_request_target\s*:/i, 'oc9-workflow-pull-request-target-forbidden'],
    [/\bsecrets\.[A-Za-z0-9_]+/i, 'oc9-workflow-secret-consumption-forbidden'],
  ]);
  if (workflowWritePermissionViolation(source)) findings.push(finding('oc9-workflow-write-permission-forbidden', path));
}

function reviewOc9Cli(source, path, findings) {
  requireExecutableLiterals(findings, source, path, [
    ['const MAX_INPUT_BYTES = 256 * 1024;', 'oc9-cli-bounded-input-missing'],
    ['buildOpenClawUpdatePreflightV1(input)', 'oc9-cli-canonical-model-call-missing'],
    ['BLOCKED_WITH_RESTORE_PATH ? 2 : 0', 'oc9-cli-blocked-exit-contract-missing'],
  ]);
  if (!/\bstderr\.write\s*\(\s*`OPENCLAW_UPDATE_PREFLIGHT_ERROR=/.test(stripComments(source))) findings.push(finding('oc9-cli-fail-closed-error-missing', path));
  forbidPatterns(findings, source, path, [[/shell\s*:\s*true|\beval\s*\(|new\s+Function\s*\(/i, 'oc9-cli-dynamic-execution-forbidden']]);
  if (dynamicAuthorityViolation(source)) findings.push(finding('oc9-cli-process-filesystem-network-authority-forbidden', path));
}

function reviewOc9CliTests(source, path, findings) {
  requireActiveTests(findings, source, path, [
    ['CLI reads one bounded JSON observation from stdin and writes no mutation claim', 'oc9-cli-test-mutation-denial-missing'],
    ['CLI exits 2 for a blocked preflight while still returning the rollback packet', 'oc9-cli-test-blocked-rollback-missing'],
    ['CLI rejects malformed JSON without emitting a packet', 'oc9-cli-test-malformed-json-missing'],
    ['CLI entrypoint detection handles Windows paths without depending on file URL spelling', 'oc9-cli-test-windows-entrypoint-missing'],
  ]);
  forbidPatterns(findings, source, path, [
    [/shell\s*:\s*true|\beval\s*\(|new\s+Function\s*\(/i, 'oc9-cli-test-dynamic-execution-forbidden'],
    [/from ['"]node:(?:http|https|net)['"]|require\(['"](?:http|https|net)['"]\)/, 'oc9-cli-test-network-authority-forbidden'],
  ]);
}

function reviewOc9Model(source, path, findings) {
  requireExecutableLiterals(findings, source, path, [
    ["APPROVAL_REQUIRED: 'APPROVAL_REQUIRED'", 'oc9-model-approval-status-missing'],
    ["BLOCKED_WITH_RESTORE_PATH: 'BLOCKED_WITH_RESTORE_PATH'", 'oc9-model-blocked-status-missing'],
    ["MANUAL_ONLY: 'MANUAL_ONLY'", 'oc9-model-manual-only-class-missing'],
    ['SECRET_PATH_PATTERN', 'oc9-model-secret-path-gate-missing'],
    ['OPENCLAW_GATEWAY_APPROVED_ENDPOINT', 'oc9-model-gateway-endpoint-binding-missing'],
    ['OPENCLAW_GATEWAY_STARTUP_SOURCE', 'oc9-model-gateway-source-binding-missing'],
    ['getOpenClawGatewayStartupCommand()', 'oc9-model-gateway-command-binding-missing'],
    ['mutationAllowed: false', 'oc9-model-mutation-denial-missing'],
    ['updateAttempted: false', 'oc9-model-update-attempt-denial-missing'],
    ['absolutePathsPublished: false', 'oc9-model-absolute-path-denial-missing'],
    ["action: 'REQUEST_EXACT_OPERATOR_APPROVAL'", 'oc9-model-exact-approval-step-missing'],
    ["action: 'RESTORE_PREVIOUS_PINNED_OPENCLAW_PACKAGE'", 'oc9-model-rollback-package-step-missing'],
    ["action: 'RESTORE_PROTECTED_CONFIG_SOURCE_AND_RUNTIME_IDENTITIES'", 'oc9-model-rollback-protected-state-step-missing'],
  ]);
  forbidPatterns(findings, source, path, [
    [/from ['"]node:(?:child_process|fs|http|https|net)['"]|require\(['"](?:child_process|fs|http|https|net)['"]\)/, 'oc9-model-process-filesystem-network-authority-forbidden'],
    [/\b(?:exec|execSync|execFile|spawn|spawnSync|fork)\s*\(|shell\s*:\s*true|\beval\s*\(|new\s+Function\s*\(/i, 'oc9-model-dynamic-execution-forbidden'],
  ]);
}

function reviewOc9ModelTests(source, path, findings) {
  requireActiveTests(findings, source, path, [
    ['builds a deterministic approval-required manifest without publishing absolute paths', 'oc9-model-test-deterministic-manifest-missing'],
    ['blocks unknown and secret-bearing inventory paths while retaining a rollback plan', 'oc9-model-test-secret-block-missing'],
    ['fails closed on gateway identity drift and unpinned update packets', 'oc9-model-test-gateway-drift-missing'],
    ['requires digests for protected identities but not rebuildable generated output', 'oc9-model-test-protected-digest-missing'],
    ['rejects conflicting duplicate path identities with order-independent blocked evidence', 'oc9-model-test-conflict-order-independence-missing'],
    ['fails closed on links, malformed existence evidence, invalid sizes and stale absent digests', 'oc9-model-test-malformed-inventory-missing'],
    ['reports no update needed when the pinned target version already matches', 'oc9-model-test-no-update-missing'],
  ]);
  forbidPatterns(findings, source, path, [
    [/shell\s*:\s*true|\beval\s*\(|new\s+Function\s*\(/i, 'oc9-model-test-dynamic-execution-forbidden'],
    [/from ['"]node:(?:http|https|net)['"]|require\(['"](?:http|https|net)['"]\)/, 'oc9-model-test-network-authority-forbidden'],
  ]);
}

function reviewOc9Source(source, path, findings) {
  if (path === '.github/workflows/openclaw-update-preflight-proof.yml') reviewOc9Workflow(source, path, findings);
  else if (path === 'scripts/openclaw-update-preflight.mjs') reviewOc9Cli(source, path, findings);
  else if (path === 'scripts/openclaw-update-preflight.test.mjs') reviewOc9CliTests(source, path, findings);
  else if (path === 'shared/agents/openClawUpdatePreflightV1.mjs') reviewOc9Model(source, path, findings);
  else if (path === 'shared/agents/openClawUpdatePreflightV1.test.mjs') reviewOc9ModelTests(source, path, findings);
}

function requirePattern(findings, source, pattern, code, path) { if (!pattern.test(source)) findings.push(finding(code, path)); }
function forbidPattern(findings, source, pattern, code, path) { if (pattern.test(source)) findings.push(finding(code, path)); }

function inspectMultiplexerInstaller(source, path, findings) {
  requirePattern(findings, source, /\[CmdletBinding\(SupportsShouldProcess\s*=\s*\$true\)\]/i, 'multiplexer-installer-shouldprocess-capability-missing', path);
  requirePattern(findings, source, /param\(\s*\[switch\]\$StartNow\s*\)/i, 'multiplexer-installer-parameter-surface-widened', path);
  requirePattern(findings, source, /\$taskName\s*=\s*'Stephanos Battle Bridge Monitor Multiplexer'/, 'multiplexer-installer-task-not-fixed', path);
  requirePattern(findings, source, /Documents\\GitHub\\stephan-os/i, 'multiplexer-installer-repo-not-fixed', path);
  requirePattern(findings, source, /scripts\\windows\\run-stephanos-scheduled-task-windowless\.vbs/i, 'multiplexer-installer-windowless-launcher-not-fixed', path);
  requirePattern(findings, source, /System32\\wscript\.exe/i, 'multiplexer-installer-host-not-fixed', path);
  requirePattern(findings, source, /monitor-multiplexer/i, 'multiplexer-installer-route-not-fixed', path);
  requirePattern(findings, source, /New-ScheduledTaskPrincipal[\s\S]*-LogonType\s+Interactive[\s\S]*-RunLevel\s+Limited/i, 'multiplexer-installer-principal-widened', path);
  requirePattern(findings, source, /New-ScheduledTaskSettingsSet[\s\S]*-MultipleInstances\s+IgnoreNew[\s\S]*-ExecutionTimeLimit\s+\(New-TimeSpan\s+-Minutes\s+5\)/i, 'multiplexer-installer-task-bounds-missing', path);
  requirePattern(findings, source, /-RepetitionInterval\s+\(New-TimeSpan\s+-Minutes\s+1\)/i, 'multiplexer-installer-cadence-not-fixed', path);
  requirePattern(findings, source, /\$PSCmdlet\.ShouldProcess\(\$taskName,[\s\S]*Register-ScheduledTask/i, 'multiplexer-installer-registration-not-shouldprocess-gated', path);
  requirePattern(findings, source, /if\s*\(\$StartNow\)[\s\S]*Start-ScheduledTask\s+-TaskName\s+\$taskName/i, 'multiplexer-installer-start-not-fixed', path);
  for (const field of ['arbitraryShellAllowed', 'arbitraryPowerShellAllowed', 'sourceMutationAllowed', 'mergeAuthority']) {
    requirePattern(findings, source, new RegExp(`${field}\\s*=\\s*\\$false`, 'i'), `multiplexer-installer-${field.toLowerCase()}-denial-missing`, path);
  }
  forbidPattern(findings, source, /Invoke-Expression|\biex\b|\bStart-Process\b|\bStop-Process\b|\btaskkill(?:\.exe)?\b|cmd(?:\.exe)?\s+\/c|powershell(?:\.exe)?\s+-command/i, 'multiplexer-installer-generic-execution-forbidden', path);
  forbidPattern(findings, source, /RunLevel\s+Highest|-MultipleInstances\s+Parallel/i, 'multiplexer-installer-authority-expanded', path);
  forbidPattern(findings, source, /(?:^|[\r\n;{}|&]\s*)(?:git(?:\.exe)?|gh(?:\.exe)?)(?=\s|$)/im, 'multiplexer-installer-source-control-authority-forbidden', path);
  const parameterArea = source.slice(0, Math.max(0, source.indexOf('$ErrorActionPreference')));
  forbidPattern(findings, parameterArea, /\$(?:TaskName|TaskPath|Executable|Command|CommandLine|ProcessPath|ScriptPath)\b/i, 'multiplexer-installer-caller-selected-authority-forbidden', path);
}

function inspectMultiplexerHiddenLauncher(source, path, findings) {
  requirePattern(findings, source, /param\(\s*\)/i, 'multiplexer-launcher-parameter-surface-widened', path);
  requirePattern(findings, source, /Documents\\GitHub\\stephan-os/i, 'multiplexer-launcher-repo-not-fixed', path);
  requirePattern(findings, source, /scripts\\battle-bridge-monitor-multiplexer-runtime-v2\.mjs/i, 'multiplexer-launcher-runtime-not-fixed', path);
  requirePattern(findings, source, /\$canonicalNode\s*=\s*'C:\\Program Files\\nodejs\\node\.exe'/i, 'multiplexer-launcher-node-not-fixed', path);
  requirePattern(findings, source, /Test-Path\s+-LiteralPath\s+\$canonicalNode\s+-PathType\s+Leaf/i, 'multiplexer-launcher-node-proof-missing', path);
  requirePattern(findings, source, /&\s*\$canonicalNode\s+\$runtimePath/i, 'multiplexer-launcher-execution-not-fixed', path);
  requirePattern(findings, source, /exit\s+\$LASTEXITCODE/i, 'multiplexer-launcher-exit-propagation-missing', path);
  forbidPattern(findings, source, /Invoke-Expression|\biex\b|\bStart-Process\b|\bStop-Process\b|\btaskkill(?:\.exe)?\b|cmd(?:\.exe)?\s+\/c|powershell(?:\.exe)?\s+-command|Get-Command\s+(?:node|node\.exe)/i, 'multiplexer-launcher-generic-execution-forbidden', path);
  forbidPattern(findings, source, /(?:^|[\r\n;{}|&]\s*)(?:git(?:\.exe)?|gh(?:\.exe)?)(?=\s|$)/im, 'multiplexer-launcher-source-control-authority-forbidden', path);
}

function inspectWindowlessLauncher(source, path, findings) {
  requirePattern(findings, source, /If\s+WScript\.Arguments\.Count\s*<>\s*1\s+Then[\s\S]*WScript\.Quit\s+2/i, 'multiplexer-vbs-argument-count-not-fixed', path);
  requirePattern(findings, source, /Documents\\GitHub\\stephan-os/i, 'multiplexer-vbs-repo-not-fixed', path);
  requirePattern(findings, source, /powershellExe\s*=\s*"C:\\Windows\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe"/i, 'multiplexer-vbs-powershell-not-fixed', path);
  requirePattern(findings, source, /Case\s+"monitor-multiplexer"[\s\S]*run-battle-bridge-monitor-multiplexer-hidden\.ps1[\s\S]*-NoProfile\s+-NonInteractive\s+-ExecutionPolicy\s+Bypass\s+-File/i, 'multiplexer-vbs-route-not-fixed', path);
  requirePattern(findings, source, /Case\s+Else[\s\S]*WScript\.Quit\s+2/i, 'multiplexer-vbs-allowlist-not-closed', path);
  requirePattern(findings, source, /If\s+Not\s+fileSystem\.FileExists\(targetPath\)\s+Then[\s\S]*WScript\.Quit\s+4/i, 'multiplexer-vbs-target-existence-proof-missing', path);
  requirePattern(findings, source, /exitCode\s*=\s*shell\.Run\(command,\s*0,\s*True\)/i, 'multiplexer-vbs-hidden-synchronous-run-missing', path);
  forbidPattern(findings, source, /\bEval\s*\(|\bExecute(?:Global)?\b|WScript\.Arguments\([^)]*\)[\s\S]{0,120}(?:targetPath|command)\s*=/i, 'multiplexer-vbs-dynamic-authority-forbidden', path);
}

function analyzeMonitorMultiplexerPr1639(input, repository, prNumber, branch, sourceHead, baseSha) {
  const identityMatches = repository === CANONICAL_REPOSITORY
    && prNumber === MULTIPLEXER_PR && branch === MULTIPLEXER_BRANCH
    && FULL_SHA.test(sourceHead) && FULL_SHA.test(baseSha);
  if (!identityMatches || !exactMultiplexerEscalation(input.analysis)) return Object.freeze({
    schemaVersion: MULTIPLEXER_SCHEMA, eligible: false, clean: false,
    reviewedPaths: Object.freeze([]), findings: Object.freeze([]), proofRefs: Object.freeze([]),
    finalVerdict: 'MONITOR_MULTIPLEXER_PR1639_SPECIALIST_NOT_APPLICABLE',
  });
  if (!exactMultiplexerLineage(input.lineageEvidence, sourceHead, baseSha)) return Object.freeze({
    schemaVersion: MULTIPLEXER_SCHEMA, eligible: true, clean: false,
    reviewedPaths: MONITOR_MULTIPLEXER_PR1639_SPECIALIST_PATHS_V1,
    findings: Object.freeze([finding('multiplexer-pr1639-reconciliation-lineage-invalid', MONITOR_MULTIPLEXER_PR1639_SPECIALIST_PATHS_V1[0])]),
    proofRefs: Object.freeze([]), sourceMutationAllowed: false, mergeAuthority: false,
    runtimeMutationAllowed: false, providerQualificationAuthority: false,
    finalVerdict: 'MONITOR_MULTIPLEXER_PR1639_SPECIALIST_FINDINGS',
  });
  const sources = Array.isArray(input.sources) ? input.sources : [];
  const byPath = new Map(sources.map((source) => [text(source?.path), source]));
  const findings = []; const proofRefs = [];
  if (sources.length !== 3 || byPath.size !== 3) findings.push(finding('multiplexer-pr1639-source-inventory-invalid', MONITOR_MULTIPLEXER_PR1639_SPECIALIST_PATHS_V1[0]));
  for (const path of MONITOR_MULTIPLEXER_PR1639_SPECIALIST_PATHS_V1) {
    const source = byPath.get(path);
    if (!exactSource(source, sourceHead, path, MULTIPLEXER_BLOB_SHA_BY_PATH[path])) { findings.push(finding('multiplexer-pr1639-exact-source-proof-invalid', path)); continue; }
    if (path.endsWith('install-battle-bridge-monitor-multiplexer.ps1')) inspectMultiplexerInstaller(source.content, path, findings);
    else if (path.endsWith('run-battle-bridge-monitor-multiplexer-hidden.ps1')) inspectMultiplexerHiddenLauncher(source.content, path, findings);
    else inspectWindowlessLauncher(source.content, path, findings);
    proofRefs.push(`proofs/provider-neutral-windows-specialist/pr-${MULTIPLEXER_PR}/${path}@${sourceHead}#${source.blobSha}`);
  }
  const clean = findings.length === 0;
  return Object.freeze({
    schemaVersion: MULTIPLEXER_SCHEMA, eligible: true, clean,
    reviewedPaths: MONITOR_MULTIPLEXER_PR1639_SPECIALIST_PATHS_V1,
    findings: Object.freeze(findings),
    proofRefs: clean ? Object.freeze([...proofRefs,
      'proofs/provider-neutral-windows-specialist/pr-1639/current-main-ahead-only-lineage',
      'proofs/provider-neutral-windows-specialist/pr-1639/fixed-host-fixed-route-no-source-or-merge-authority']) : Object.freeze([]),
    sourceMutationAllowed: false, mergeAuthority: false, runtimeMutationAllowed: false, providerQualificationAuthority: false,
    finalVerdict: clean ? 'MONITOR_MULTIPLEXER_PR1639_SPECIALIST_CLEAN' : 'MONITOR_MULTIPLEXER_PR1639_SPECIALIST_FINDINGS',
  });
}

function analyzeHardlink(input, repository, prNumber, branch, sourceHead, baseSha) {
  const eligible = repository === CANONICAL_REPOSITORY && prNumber === HARDLINK_PR && branch === HARDLINK_BRANCH
    && FULL_SHA.test(sourceHead) && FULL_SHA.test(baseSha) && exactHardlinkEscalation(input.analysis);
  if (!eligible) return null;
  if (!exactLineage(input.lineageEvidence, sourceHead, baseSha)) return Object.freeze({
    schemaVersion: SCHEMA, eligible: true, clean: false, reviewedPaths: OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1,
    findings: Object.freeze([finding('battle-bridge-hardlink-reconciliation-lineage-invalid')]), proofRefs: Object.freeze([]),
    finalVerdict: 'OPENCLAW_BUILDER_PROVIDER_SUCCESSOR_SPECIALIST_FINDINGS',
  });
  const sources = Array.isArray(input.sources) ? input.sources : [];
  const candidate = sources.length === 1 ? sources[0] : null;
  const clean = exactHardlinkSource(candidate, sourceHead);
  return Object.freeze({
    schemaVersion: SCHEMA, eligible: true, clean, reviewedPaths: OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1,
    findings: clean ? Object.freeze([]) : Object.freeze([finding('battle-bridge-hardlink-exact-source-proof-invalid')]),
    proofRefs: clean ? Object.freeze([
      `proofs/provider-neutral-windows-specialist/pr-${HARDLINK_PR}`,
      `proofs/provider-neutral-windows-specialist/${HARDLINK_PATH}@${sourceHead}#${HARDLINK_BLOB_SHA}`,
      'proofs/provider-neutral-windows-specialist/hardlink-only-canonical-git-identity',
    ]) : Object.freeze([]),
    finalVerdict: clean ? 'OPENCLAW_BUILDER_PROVIDER_SUCCESSOR_SPECIALIST_CLEAN' : 'OPENCLAW_BUILDER_PROVIDER_SUCCESSOR_SPECIALIST_FINDINGS',
  });
}

function analyzeOc9(input, repository, prNumber, branch, sourceHead, baseSha) {
  const eligible = repository === CANONICAL_REPOSITORY && prNumber === OC9_PR && branch === OC9_BRANCH
    && FULL_SHA.test(sourceHead) && FULL_SHA.test(baseSha) && exactOc9Escalation(input.analysis);
  if (!eligible) return null;
  if (!exactLineage(input.lineageEvidence, sourceHead, baseSha)) return Object.freeze({
    schemaVersion: OC9_SCHEMA, eligible: true, clean: false, reviewedPaths: OPENCLAW_UPDATE_PREFLIGHT_SUCCESSOR_SPECIALIST_PATHS_V1,
    findings: Object.freeze([finding('oc9-update-preflight-reconciliation-lineage-invalid', OPENCLAW_UPDATE_PREFLIGHT_SUCCESSOR_SPECIALIST_PATHS_V1[0])]),
    proofRefs: Object.freeze([]), finalVerdict: 'OPENCLAW_UPDATE_PREFLIGHT_SPECIALIST_FINDINGS',
  });
  const sources = Array.isArray(input.sources) ? input.sources : [];
  const findings = []; const proofRefs = [];
  if (sources.length !== OPENCLAW_UPDATE_PREFLIGHT_SUCCESSOR_SPECIALIST_PATHS_V1.length) findings.push(finding('oc9-update-preflight-source-evidence-estate-mismatch', OPENCLAW_UPDATE_PREFLIGHT_SUCCESSOR_SPECIALIST_PATHS_V1[0]));
  for (const path of OPENCLAW_UPDATE_PREFLIGHT_SUCCESSOR_SPECIALIST_PATHS_V1) {
    const candidates = sources.filter((source) => text(source?.path) === path);
    if (candidates.length !== 1 || !exactSource(candidates[0], sourceHead, path)) { findings.push(finding('oc9-update-preflight-source-evidence-invalid', path)); continue; }
    reviewOc9Source(candidates[0].content, path, findings);
    proofRefs.push(`proofs/openclaw-update-preflight-specialist/pr-${OC9_PR}/${path}@${sourceHead}#${candidates[0].blobSha}`);
  }
  const clean = findings.length === 0;
  return Object.freeze({
    schemaVersion: OC9_SCHEMA, eligible: true, clean, reviewedPaths: OPENCLAW_UPDATE_PREFLIGHT_SUCCESSOR_SPECIALIST_PATHS_V1,
    findings: Object.freeze(findings), proofRefs: Object.freeze(proofRefs),
    finalVerdict: clean ? 'OPENCLAW_UPDATE_PREFLIGHT_SPECIALIST_CLEAN' : 'OPENCLAW_UPDATE_PREFLIGHT_SPECIALIST_FINDINGS',
  });
}


const OPENCLAW_OC2_SUCCESSOR_PROFILE_V1 = (() => {
const OPENCLAW_OC2_SPECIALIST_PATHS_V1 = Object.freeze([
  'integrations/openclaw/stephanos-builder-provider/index.js',
  'integrations/openclaw/stephanos-builder-provider/lib/oc2-deterministic-test-build.mjs',
  'integrations/openclaw/stephanos-builder-provider/lib/oc2-gateway-provider.mjs',
  'integrations/openclaw/stephanos-builder-provider/oc2-deterministic-test-build.test.mjs',
  'integrations/openclaw/stephanos-builder-provider/oc2-gateway-provider.test.mjs',
  'integrations/openclaw/stephanos-builder-provider/openclaw.plugin.json',
]);

const OPENCLAW_OC2_SPECIALIST_SCHEMA_V1 = 'stephanos.openclaw-oc2-specialist-review.v1';

const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const CANONICAL_REPOSITORY = 'Cheekyfellastef/stephan-os';
const CANONICAL_OC2_BRANCH = 'agent/openclaw-oc2-deterministic-test-build-v1';
const OC2_PR = 1931;
const SHA = /^[a-f0-9]{40}$/;
const text = (value) => String(value ?? '').trim();
const unique = (values) => [...new Set(values)];
const finding = (code, path) => Object.freeze({ severity: 'P0', code, summary: code, path });

function blobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function escalationPaths(analysis) {
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  if (findings.length !== OPENCLAW_OC2_SPECIALIST_PATHS_V1.length) return [];
  if (!findings.every((item) => (
    text(item?.severity).toUpperCase() === 'P0'
    && text(item?.code) === 'unsupported-high-risk-surface'
  ))) return [];
  const paths = unique(findings.map((item) => text(item?.path))).sort();
  const expected = [...OPENCLAW_OC2_SPECIALIST_PATHS_V1].sort();
  return JSON.stringify(paths) === JSON.stringify(expected) ? paths : [];
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
    && source.size === size
    && size > 0
    && size <= 256 * 1024
    && SHA.test(text(source.blobSha))
    && source.blobSha === blobSha(content));
}

function exactLineage(lineage, repository, sourceHead, baseSha) {
  const parents = Array.isArray(lineage?.parents) ? lineage.parents : [];
  return lineage?.schemaVersion === 'stephanos.windows-authority-reconciliation-lineage.v1'
    && lineage?.repository === repository
    && lineage?.sourceHead === sourceHead
    && lineage?.sourceCommitSha === sourceHead
    && lineage?.baseSha === baseSha
    && lineage?.liveMainBeforeSha === baseSha
    && lineage?.liveMainAfterSha === baseSha
    && parents.includes(baseSha)
    && lineage?.comparison?.status === 'ahead'
    && Number.isSafeInteger(lineage?.comparison?.aheadBy)
    && lineage.comparison.aheadBy > 0
    && lineage?.comparison?.behindBy === 0
    && lineage?.comparison?.baseCommitSha === baseSha
    && lineage?.comparison?.mergeBaseCommitSha === baseSha;
}

function maskCommentsAndStrings(source, { preserveStrings = false } = {}) {
  let out = '';
  let quote = '';
  let lineComment = false;
  let blockComment = false;
  let escaped = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1] || '';
    if (lineComment) {
      if (ch === '\n') { lineComment = false; out += '\n'; } else out += ' ';
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') { blockComment = false; out += '  '; i += 1; }
      else out += ch === '\n' ? '\n' : ' ';
      continue;
    }
    if (quote) {
      if (preserveStrings) out += ch;
      else out += ch === '\n' ? '\n' : ' ';
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; out += '  '; i += 1; continue; }
    if (ch === '/' && next === '*') { blockComment = true; out += '  '; i += 1; continue; }
    if (ch === '\'' || ch === '"' || ch === '`') {
      quote = ch;
      out += preserveStrings ? ch : ' ';
      continue;
    }
    out += ch;
  }
  return out;
}

const stripComments = (source) => maskCommentsAndStrings(source, { preserveStrings: true });
const executableOnly = (source) => maskCommentsAndStrings(source);

function matchBalanced(masked, openIndex, openChar, closeChar) {
  let depth = 0;
  for (let i = openIndex; i < masked.length; i += 1) {
    if (masked[i] === openChar) depth += 1;
    else if (masked[i] === closeChar) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function functionBody(source, names) {
  const masked = executableOnly(source);
  for (const name of names) {
    const pattern = new RegExp(`\\bfunction\\s+${name}\\s*\\(|\\b(?:async\\s+)?function\\s+${name}\\s*\\(`);
    const match = pattern.exec(masked);
    if (!match) continue;
    const brace = masked.indexOf('{', match.index + match[0].length);
    if (brace < 0) continue;
    const end = matchBalanced(masked, brace, '{', '}');
    if (end < 0) continue;
    return {
      raw: source.slice(brace + 1, end),
      masked: masked.slice(brace + 1, end),
      uncommented: stripComments(source.slice(brace + 1, end)),
    };
  }
  return null;
}

function callbackTopLevel(source) {
  const masked = executableOnly(source);
  let depth = 0;
  let out = '';
  for (let i = 0; i < masked.length; i += 1) {
    const ch = masked[i];
    if (ch === '{') { depth += 1; out += ' '; continue; }
    if (ch === '}') { depth = Math.max(0, depth - 1); out += ' '; continue; }
    out += depth === 0 ? ch : (ch === '\n' ? '\n' : ' ');
  }
  return out;
}

function conditionBlocks(bodySource) {
  const blocks = [];
  const masked = executableOnly(bodySource);
  const ifPattern = /\bif\s*\(/g;
  for (const match of masked.matchAll(ifPattern)) {
    const open = match.index + match[0].lastIndexOf('(');
    const close = matchBalanced(masked, open, '(', ')');
    if (close < 0) continue;
    let cursor = close + 1;
    while (/\s/.test(masked[cursor] || '')) cursor += 1;
    let consequent = '';
    if (masked[cursor] === '{') {
      const end = matchBalanced(masked, cursor, '{', '}');
      if (end < 0) continue;
      consequent = bodySource.slice(cursor + 1, end);
    } else {
      const semi = masked.indexOf(';', cursor);
      if (semi < 0) continue;
      consequent = bodySource.slice(cursor, semi + 1);
    }
    const top = callbackTopLevel(consequent);
    if (!/\b(?:return|throw)\b/.test(top)) continue;
    blocks.push(bodySource.slice(open + 1, close));
  }
  return blocks;
}

function requireRejectingPredicates(findings, body, path, rules) {
  if (!body) {
    for (const [, code] of rules) findings.push(finding(code, path));
    return;
  }
  const conditions = conditionBlocks(body.uncommented);
  for (const [pattern, code] of rules) {
    if (!conditions.some((condition) => pattern.test(condition))) findings.push(finding(code, path));
  }
}

function requireLiterals(findings, source, path, rules) {
  const uncommented = stripComments(source);
  for (const [literal, code] of rules) if (!uncommented.includes(literal)) findings.push(finding(code, path));
}

function requireExecutablePatterns(findings, source, path, rules) {
  const executable = executableOnly(source);
  for (const [pattern, code] of rules) if (!pattern.test(executable)) findings.push(finding(code, path));
}

function forbidExecutablePatterns(findings, source, path, rules) {
  const executable = executableOnly(source);
  for (const [pattern, code] of rules) if (pattern.test(executable)) findings.push(finding(code, path));
}

function countMatches(source, pattern) {
  const matches = source.match(pattern);
  return matches ? matches.length : 0;
}

function activeTestHas(source, title, assertionPattern) {
  const uncommented = stripComments(source);
  if (/\b(?:test|it|describe)\.(?:skip|todo|only)\s*\(/.test(uncommented)) return false;
  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\export function analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(input = {}) {');
  const opener = new RegExp(`\\btest\\s*\\(\\s*(['\"])${escapedTitle}\\1\\s*,`);
  const match = opener.exec(uncommented);
  if (!match) return false;
  const masked = executableOnly(uncommented);
  const start = masked.indexOf('=>', match.index + match[0].length);
  if (start < 0) return false;
  const brace = masked.indexOf('{', start + 2);
  if (brace < 0) return false;
  const end = matchBalanced(masked, brace, '{', '}');
  if (end < 0) return false;
  const body = uncommented.slice(brace + 1, end);
  const top = callbackTopLevel(body);
  const assertion = assertionPattern.exec(top);
  if (!assertion) return false;
  const before = top.slice(0, assertion.index);
  if (/\b(?:return|throw)\b/.test(before)) return false;
  return true;
}

function importAuthorityViolation(source) {
  const uncommented = stripComments(source);
  const executable = executableOnly(source);
  if (/\bimport\s*\(/.test(executable)) return true;
  if (/\brequire\s*\(/.test(executable)) return true;
  if (/\bfrom\s+['"]node:(?:http|https|net|tls|dgram|dns)['"]/.test(uncommented)) return true;
  if (/\b(?:fs|fsp|http|https|net|tls|dgram|dns|childProcess|child_process)\s*\[[^\]]+\]/.test(uncommented)) return true;
  if (/\b(?:globalThis|global)\s*\[\s*['"]fetch['"]\s*\]/.test(uncommented)) return true;
  if (/\bprocess\s*\.\s*getBuiltinModule\s*\(/.test(executable)) return true;
  const fsImports = [...uncommented.matchAll(/\bimport\s*\{([^}]*)\}\s*from\s*['"]node:fs(?:\/promises)?['"]/g)];
  const allowedFs = new Set(['existsSync', 'readFileSync', 'readFile', 'stat', 'statSync', 'lstat', 'lstatSync', 'readdir', 'readdirSync', 'access', 'accessSync']);
  for (const match of fsImports) {
    for (const item of match[1].split(',').map((part) => part.trim()).filter(Boolean)) {
      const original = item.split(/\s+as\s+/i)[0].trim();
      if (!allowedFs.has(original)) return true;
    }
  }
  if (/\bimport\s+(?!\{)[^;\n]+\s+from\s+['"]node:fs(?:\/promises)?['"]/.test(uncommented)) return true;
  const childImports = [...uncommented.matchAll(/\bimport\s*\{([^}]*)\}\s*from\s*['"]node:child_process['"]/g)];
  for (const match of childImports) {
    const items = match[1].split(',').map((part) => part.trim()).filter(Boolean);
    if (items.length !== 1 || !/^spawnSync$/.test(items[0])) return true;
  }
  if (/\bimport\s+(?!\{)[^;\n]+\s+from\s+['"]node:child_process['"]/.test(uncommented)) return true;
  return false;
}

function hasProcessAlias(source) {
  const code = executableOnly(source);
  if (/\b(?:const|let|var)\s+(?!spawnSyncFn\b)[A-Za-z_$][\w$]*\s*=\s*spawnSyncFn\b/.test(code)) return true;
  if (/\bspawnSyncFn\s*\.\s*(?:bind|call|apply)\b/.test(code)) return true;
  if (/\bimport\s*\{[^}]*spawnSync\s+as\s+/i.test(stripComments(source))) return true;
  if (/[{,]\s*[A-Za-z_$][\w$]*\s*:\s*spawnSyncFn\b/.test(code)) return true;
  if (/\[\s*spawnSyncFn\s*(?:,|\])/.test(code) || /,\s*spawnSyncFn\s*\]/.test(code)) return true;
  if (/\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])\s*=\s*spawnSyncFn\b/.test(code)) return true;
  return false;
}

function hasGatewayAlias(source) {
  const code = executableOnly(source);
  const uncommented = stripComments(source);
  return /\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*api\.registerGatewayMethod\b/.test(code)
    || /\bapi\.registerGatewayMethod\s*\.\s*bind\b/.test(code)
    || /\{\s*registerGatewayMethod\s*(?::|,|\})/.test(code)
    || /\bapi\s*\[\s*['"]registerGatewayMethod['"]\s*\]/.test(uncommented)
    || /\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]]+\])\s*=\s*api\.registerGatewayMethod\b/.test(code);
}

function hasExecutorAlias(source) {
  const code = executableOnly(source);
  return /\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*executeOpenClawOc2GatewayRequest\b/.test(code)
    || /\bexecuteOpenClawOc2GatewayRequest\s*\.\s*bind\b/.test(code)
    || /\bexecuteOpenClawOc2GatewayRequest\s+as\s+/i.test(stripComments(source));
}

function reviewIndex(source, path, findings) {
  requireLiterals(findings, source, path, [
    ['OPENCLAW_OC1_GATEWAY_METHOD', 'openclaw-oc2-index-oc1-method-import-missing'],
    ['OPENCLAW_OC2_GATEWAY_METHOD', 'openclaw-oc2-index-method-import-missing'],
    ['executeOpenClawOc2GatewayRequest', 'openclaw-oc2-index-executor-import-missing'],
    ["pluginId: 'stephanos-builder-provider'", 'openclaw-oc2-index-plugin-id-not-fixed'],
    ['providerInstance: `openclaw-gateway:${process.pid}`', 'openclaw-oc2-index-provider-instance-not-host-bound'],
    ["{ scope: 'operator.write' }", 'openclaw-oc2-index-gateway-scope-not-explicit'],
    ['Qualification is reserved for canonical Mission Worker claims executed by the OpenClaw Gateway plugin.', 'openclaw-oc2-index-manual-qualification-denial-missing'],
  ]);
  const code = executableOnly(source);
  if (countMatches(code, /\bapi\.registerGatewayMethod\s*\(/g) !== 2 || hasGatewayAlias(source)) {
    findings.push(finding('openclaw-oc2-index-gateway-registration-set-not-closed', path));
  }
  if (hasExecutorAlias(source)
    || countMatches(code, /\bexecuteOpenClawOc2GatewayRequest\b/g) !== 2
    || countMatches(code, /\bexecuteOpenClawOc2GatewayRequest\s*\(/g) !== 1) {
    findings.push(finding('openclaw-oc2-index-executor-binding-incomplete', path));
  }
  const oc2Call = /api\.registerGatewayMethod\s*\(\s*OPENCLAW_OC2_GATEWAY_METHOD\s*,/.exec(code);
  if (!oc2Call) {
    findings.push(finding('openclaw-oc2-index-registration-binding-incomplete', path));
  } else {
    const open = code.indexOf('(', oc2Call.index);
    const close = matchBalanced(code, open, '(', ')');
    const call = close >= 0 ? code.slice(open + 1, close) : '';
    if (countMatches(call, /\bexecuteOpenClawOc2GatewayRequest\s*\(/g) !== 1
      || !/gatewayContext\s*\(\s*OPENCLAW_OC2_GATEWAY_METHOD\s*\)/.test(call)) {
      findings.push(finding('openclaw-oc2-index-executor-binding-incomplete', path));
    }
  }
  requireExecutablePatterns(findings, source, path, [
    [/api\.registerGatewayMethod\s*\(\s*OPENCLAW_OC1_GATEWAY_METHOD\s*,/, 'openclaw-oc2-index-oc1-registration-missing'],
    [/gatewayContext\s*\(\s*OPENCLAW_OC2_GATEWAY_METHOD\s*\)/, 'openclaw-oc2-index-gateway-binding-missing'],
  ]);
  forbidExecutablePatterns(findings, source, path, [
    [/\b(?:exec|execSync|spawn|spawnSync|fork)\s*\(/, 'openclaw-oc2-index-dynamic-process-forbidden'],
    [/\bshell\s*:\s*true|\beval\s*\(|new\s+Function\s*\(/i, 'openclaw-oc2-index-dynamic-code-forbidden'],
  ]);
}

function reviewDeterministicExecutor(source, path, findings) {
  requireLiterals(findings, source, path, [
    ["export const OPENCLAW_OC2_TASK_CLASS = 'OC2_DETERMINISTIC_TEST_BUILD';", 'openclaw-oc2-task-class-not-fixed'],
    ["export const OPENCLAW_OC2_OPERATION = 'oc2-provider-regression-v1';", 'openclaw-oc2-operation-not-fixed'],
    ["export const OPENCLAW_OC2_PROVIDER = 'openclaw-standalone';", 'openclaw-oc2-provider-not-fixed'],
    ["export const OPENCLAW_OC2_PROVIDER_VERSION = '1.0.0';", 'openclaw-oc2-provider-version-not-fixed'],
    ['export const OPENCLAW_OC2_ISSUE = 1725;', 'openclaw-oc2-goal-not-fixed'],
    ["const REPOSITORY = 'Cheekyfellastef/stephan-os';", 'openclaw-oc2-repository-not-fixed'],
    ["const BRANCH = 'main';", 'openclaw-oc2-branch-not-fixed'],
    ['const MAX_OUTPUT_BYTES = 1024 * 1024;', 'openclaw-oc2-output-bound-missing'],
    ["testId: 'OC2_PROVIDER_SOURCE_PARSE_V1'", 'openclaw-oc2-fixed-source-parse-plan-missing'],
    ["testId: 'OC2_PROVIDER_REGRESSION_V1'", 'openclaw-oc2-fixed-regression-plan-missing'],
    ['BATTLE_BRIDGE_WINDOWS_HOST.git', 'openclaw-oc2-git-executable-not-fixed'],
    ['BATTLE_BRIDGE_WINDOWS_HOST.node', 'openclaw-oc2-node-executable-not-fixed'],
    ['shell: false', 'openclaw-oc2-shell-denial-missing'],
    ['windowsHide: true', 'openclaw-oc2-windowless-execution-missing'],
    ['120_000', 'openclaw-oc2-test-timeout-not-bounded'],
    ['15_000', 'openclaw-oc2-git-timeout-not-bounded'],
    ['sourceMutationPerformed: false', 'openclaw-oc2-source-mutation-denial-missing'],
    ['arbitraryShellAllowed: false', 'openclaw-oc2-arbitrary-shell-denial-missing'],
    ['arbitraryCommandAllowed: false', 'openclaw-oc2-arbitrary-command-denial-missing'],
    ['mergeAllowed: false', 'openclaw-oc2-result-merge-denial-missing'],
    ['deploymentAllowed: false', 'openclaw-oc2-result-deployment-denial-missing'],
    ['selfQualificationAllowed: false', 'openclaw-oc2-self-qualification-denial-missing'],
    ["workerType: 'openclaw'", 'openclaw-oc2-receipt-worker-type-not-fixed'],
    ["channel: 'openclaw-provider-qualification'", 'openclaw-oc2-proof-channel-not-fixed'],
  ]);

  const validate = functionBody(source, ['validateOpenClawOc2QualificationContext', 'validate']);
  requireRejectingPredicates(findings, validate, path, [
    [/grant\?\.schemaVersion\s*!==/, 'openclaw-oc2-grant-schema-gate-missing'],
    [/grant\?\.boundedActionCount\s*!==\s*1/, 'openclaw-oc2-bounded-action-gate-missing'],
    [/grant\?\.mergeAuthority\s*!==\s*false/, 'openclaw-oc2-merge-authority-denial-missing'],
    [/grant\?\.leaseSeizureAllowed\s*!==\s*false/, 'openclaw-oc2-lease-denial-missing'],
    [/grant\?\.(?:adapter|operation|repository)|text\s*\(\s*grant\?\.(?:adapter|operation|repository)/, 'openclaw-oc2-operation-gate-missing'],
    [/sourceRevision/, 'openclaw-oc2-source-head-gate-missing'],
    [/claim\?\.item\?\.schemaVersion/, 'openclaw-oc2-claim-schema-gate-missing'],
    [/action\?\.schemaVersion/, 'openclaw-oc2-action-schema-gate-missing'],
    [/claim\.item\.payload\s*!==\s*action/, 'openclaw-oc2-claim-payload-identity-gate-missing'],
  ]);
  requireExecutablePatterns(findings, source, path, [
    [/JSON\.stringify\s*\(\s*persisted\s*\)\s*!==\s*JSON\.stringify\s*\(\s*claim\.item\s*\)/, 'openclaw-oc2-persisted-claim-equality-gate-missing'],
    [/for\s*\(\s*const\s+plan\s+of\s+OPENCLAW_OC2_FIXED_PLAN\s*\)/, 'openclaw-oc2-fixed-plan-execution-binding-missing'],
    [/runFixed\s*\(\s*spawnSyncFn\s*,\s*BATTLE_BRIDGE_WINDOWS_HOST\.node\s*,/, 'openclaw-oc2-fixed-node-execution-binding-missing'],
  ]);

  const execute = functionBody(source, ['executeClaimedOpenClawOc2DeterministicTestBuild', 'execute']);
  requireRejectingPredicates(findings, execute, path, [
    [/platform\s*!==\s*['"]win32['"]/, 'openclaw-oc2-windows-runtime-gate-missing'],
    [/sourceHead\s*!==\s*task\.requestedSourceHead/, 'openclaw-oc2-pre-test-head-binding-missing'],
    [/finalHead\s*!==\s*sourceHead/, 'openclaw-oc2-post-test-head-binding-missing'],
    [/statusAfter\s*!==\s*statusBefore/, 'openclaw-oc2-post-test-state-binding-missing'],
  ]);

  const code = executableOnly(source);
  if (countMatches(code, /\bspawnSyncFn\s*\(/g) !== 1 || hasProcessAlias(source)) {
    findings.push(finding('openclaw-oc2-unbounded-process-authority-forbidden', path));
  }
  forbidExecutablePatterns(findings, source, path, [
    [/\b(?:exec|execSync|execFile|fork|spawn|spawnSync)\s*\(/, 'openclaw-oc2-unbounded-process-authority-forbidden'],
    [/\bshell\s*:\s*true|\beval\s*\(|new\s+Function\s*\(/i, 'openclaw-oc2-dynamic-code-forbidden'],
    [/\bgit(?:\.exe)?\b[^\r\n]*(?:push|reset|clean|rebase|checkout|switch|merge|stash|fetch)\b/i, 'openclaw-oc2-git-mutation-forbidden'],
    [/\b(?:writeFile|writeFileSync|appendFile|appendFileSync|rm|rmSync|unlink|unlinkSync|rename|renameSync|createWriteStream)\s*\(/, 'openclaw-oc2-filesystem-authority-forbidden'],
    [/\bfetch\s*\(|\b(?:http|https|net|tls|dgram)\s*\./, 'openclaw-oc2-network-authority-forbidden'],
  ]);
  if (importAuthorityViolation(source)) findings.push(finding('openclaw-oc2-filesystem-or-network-authority-forbidden', path));
}

function reviewGateway(source, path, findings) {
  requireLiterals(findings, source, path, [
    ["export const OPENCLAW_OC2_GATEWAY_METHOD = 'stephanos-builder-provider.oc2Qualification';", 'openclaw-oc2-gateway-method-not-fixed'],
    ["export const OPENCLAW_OC2_GATEWAY_REQUEST_SCHEMA = 'stephanos.openclaw-oc2-gateway-request.v1';", 'openclaw-oc2-gateway-request-schema-not-fixed'],
    ["export const OPENCLAW_OC2_GATEWAY_RESULT_SCHEMA = 'stephanos.openclaw-oc2-gateway-result.v1';", 'openclaw-oc2-gateway-result-schema-not-fixed'],
    ["const REPOSITORY = 'Cheekyfellastef/stephan-os';", 'openclaw-oc2-gateway-repository-not-fixed'],
    ["const REQUEST_KEYS = new Set(['schemaVersion', 'actionGrant']);", 'openclaw-oc2-gateway-request-shape-not-closed'],
    ["executionSurface: 'openclaw-gateway-plugin'", 'openclaw-oc2-gateway-surface-not-fixed'],
  ]);
  requireExecutablePatterns(findings, source, path, [
    [/context\?\.executingInsideOpenClawGateway\s*===\s*true/, 'openclaw-oc2-gateway-runtime-marker-missing'],
    [/context\?\.pluginId\s*===/, 'openclaw-oc2-gateway-plugin-binding-missing'],
    [/context\?\.method\s*===\s*OPENCLAW_OC2_GATEWAY_METHOD/, 'openclaw-oc2-gateway-method-binding-missing'],
    [/GATEWAY_INSTANCE\.test\s*\(\s*providerInstance\s*\)/, 'openclaw-oc2-gateway-instance-binding-missing'],
    [/executeClaimedOpenClawOc2DeterministicTestBuild\s*\(/, 'openclaw-oc2-gateway-executor-binding-missing'],
    [/result\.success\s*===\s*true\s*&&\s*result\.qualificationEligible\s*===\s*true/, 'openclaw-oc2-gateway-result-not-bound'],
  ]);
  const grantBody = functionBody(source, ['requestBlocker', 'executeOpenClawOc2GatewayRequest', 'execute']);
  requireRejectingPredicates(findings, grantBody, path, [
    [/grant\?\.boundedActionCount\s*!==\s*1/, 'openclaw-oc2-gateway-bounded-action-gate-missing'],
    [/grant\?\.mergeAuthority\s*!==\s*false/, 'openclaw-oc2-gateway-merge-denial-missing'],
    [/grant\?\.leaseSeizureAllowed\s*!==\s*false/, 'openclaw-oc2-gateway-lease-denial-missing'],
  ]);
  if (!/path\.resolve\s*\(\s*queueRoot\s*,\s*['"]openclaw-readonly['"]\s*,\s*['"]processing['"]\s*\)/.test(stripComments(source))) {
    findings.push(finding('openclaw-oc2-gateway-processing-root-not-fixed', path));
  }
  forbidExecutablePatterns(findings, source, path, [
    [/\b(?:exec|execSync|spawn|spawnSync|execFile|fork)\s*\(/, 'openclaw-oc2-gateway-process-authority-forbidden'],
    [/\bshell\s*:\s*true|\beval\s*\(|new\s+Function\s*\(/i, 'openclaw-oc2-gateway-dynamic-code-forbidden'],
    [/\b(?:writeFile|writeFileSync|appendFile|appendFileSync|rm|rmSync|unlink|unlinkSync|rename|renameSync|createWriteStream|fetch)\s*\(/, 'openclaw-oc2-gateway-authority-widening-forbidden'],
  ]);
  if (importAuthorityViolation(source)) findings.push(finding('openclaw-oc2-gateway-authority-widening-forbidden', path));
}

function reviewExecutorTest(source, path, findings) {
  const checks = [
    ['OC2 admits only the exact canonical claimed action and fixed operation', /assert\.equal\s*\(\s*valid\.task\.arbitraryCommandAuthority\s*,\s*false\s*\)/],
    ['OC2 executes only fixed node test IDs and proves source state unchanged', /assert\.deepEqual\s*\(\s*result\.changedFiles\s*,\s*\[\s*\]\s*\)/],
    ['OC2 fails closed if a fixed test changes repository source state', /assert\.equal\s*\(\s*result\.error\s*,/],
  ];
  for (const [title, assertion] of checks) if (!activeTestHas(source, title, assertion)) findings.push(finding('openclaw-oc2-test-active-regression-missing', path));
}

function reviewGatewayTest(source, path, findings) {
  const checks = [
    ['OC2 gateway rejects execution outside the actual OpenClaw Gateway plugin', /assert\.equal\s*\(\s*result\.success\s*,\s*false\s*\)/],
    ['OC2 gateway rejects caller-selected operation or extra request fields', /assert\.equal\s*\(\s*extra\.error\s*,/],
    ['OC2 gateway binds the persisted claimed item and executes the fixed plan', /assert\.equal\s*\(\s*result\.executionSurface\s*,/],
  ];
  for (const [title, assertion] of checks) if (!activeTestHas(source, title, assertion)) findings.push(finding('openclaw-oc2-gateway-test-active-regression-missing', path));
}

function reviewPlugin(source, path, findings) {
  let parsed;
  try { parsed = JSON.parse(source); } catch { findings.push(finding('openclaw-oc2-plugin-json-invalid', path)); return; }
  if (parsed?.id !== 'stephanos-builder-provider') findings.push(finding('openclaw-oc2-plugin-id-not-fixed', path));
  if (parsed?.activation?.onStartup !== true) findings.push(finding('openclaw-oc2-plugin-startup-activation-missing', path));
  if (!text(parsed?.description).includes('OC2 deterministic test/build')) findings.push(finding('openclaw-oc2-plugin-description-missing-task-bound', path));
  if (parsed?.configSchema?.type !== 'object' || parsed?.configSchema?.additionalProperties !== false
    || !parsed?.configSchema?.properties || Object.keys(parsed.configSchema.properties).length !== 0) {
    findings.push(finding('openclaw-oc2-plugin-config-not-closed', path));
  }
}

const REVIEWERS = Object.freeze([
  reviewIndex,
  reviewDeterministicExecutor,
  reviewGateway,
  reviewExecutorTest,
  reviewGatewayTest,
  reviewPlugin,
]);

function analyzeOpenClawOc2SpecialistReviewV1(input = {}) {
  const repository = text(input.repository);
  const sourceHead = text(input.sourceHead).toLowerCase();
  const baseSha = text(input.baseSha).toLowerCase();
  const escalation = escalationPaths(input.analysis);
  const eligible = repository === CANONICAL_REPOSITORY
    && input.prNumber === OC2_PR
    && text(input.branch) === CANONICAL_OC2_BRANCH
    && SHA.test(sourceHead)
    && SHA.test(baseSha)
    && escalation.length === OPENCLAW_OC2_SPECIALIST_PATHS_V1.length;
  if (!eligible) return Object.freeze({ eligible: false, clean: false, findings: Object.freeze([]), proofRefs: Object.freeze([]) });

  const reviewedPaths = Object.freeze([...OPENCLAW_OC2_SPECIALIST_PATHS_V1]);
  const findings = [];
  if (!exactLineage(input.lineageEvidence, repository, sourceHead, baseSha)) findings.push(finding('openclaw-oc2-exact-lineage-invalid', reviewedPaths[0]));

  const sources = Array.isArray(input.sources) ? input.sources : [];
  const sourceByPath = new Map(sources.map((item) => [text(item?.path), item]));
  if (sourceByPath.size !== reviewedPaths.length || sources.length !== reviewedPaths.length) findings.push(finding('openclaw-oc2-source-estate-not-closed', reviewedPaths[0]));
  for (let index = 0; index < reviewedPaths.length; index += 1) {
    const path = reviewedPaths[index];
    const evidence = sourceByPath.get(path);
    if (!exactSource(evidence, repository, sourceHead, path)) {
      findings.push(finding('openclaw-oc2-source-evidence-invalid', path));
      continue;
    }
    REVIEWERS[index](evidence.content, path, findings);
  }

  const proofRefs = Object.freeze(reviewedPaths.map((path) => `proofs/openclaw-oc2-specialist/${path}`));
  return Object.freeze({
    schemaVersion: OPENCLAW_OC2_SPECIALIST_SCHEMA_V1,
    eligible: true,
    clean: findings.length === 0,
    findings: Object.freeze(findings),
    reviewedPaths,
    proofRefs,
    finalVerdict: findings.length === 0 ? 'OPENCLAW_OC2_SPECIALIST_CLEAN' : 'OPENCLAW_OC2_SPECIALIST_FINDINGS',
  });
}

return Object.freeze({
  paths: OPENCLAW_OC2_SPECIALIST_PATHS_V1,
  schemaVersion: OPENCLAW_OC2_SPECIALIST_SCHEMA_V1,
  analyze: analyzeOpenClawOc2SpecialistReviewV1,
});
})();

export const OPENCLAW_OC2_SUCCESSOR_SPECIALIST_PATHS_V1 = OPENCLAW_OC2_SUCCESSOR_PROFILE_V1.paths;

export function analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(input = {}) {
  const repository = text(input.repository);
  const prNumber = Number(input.prNumber);
  const branch = text(input.branch);
  const sourceHead = text(input.sourceHead).toLowerCase();
  const baseSha = text(input.baseSha).toLowerCase();

  if (prNumber === MULTIPLEXER_PR && branch === MULTIPLEXER_BRANCH) {
    return analyzeMonitorMultiplexerPr1639(input, repository, prNumber, branch, sourceHead, baseSha);
  }
  const hardlink = analyzeHardlink(input, repository, prNumber, branch, sourceHead, baseSha);
  if (hardlink) return hardlink;
  const oc9 = analyzeOc9(input, repository, prNumber, branch, sourceHead, baseSha);
  if (oc9) return oc9;
  const oc2 = OPENCLAW_OC2_SUCCESSOR_PROFILE_V1.analyze(input);
  if (oc2.eligible) return oc2;
  return Object.freeze({
    schemaVersion: SCHEMA, eligible: false, clean: false, reviewedPaths: Object.freeze([]), findings: Object.freeze([]), proofRefs: Object.freeze([]),
    finalVerdict: 'OPENCLAW_BUILDER_PROVIDER_SUCCESSOR_SPECIALIST_NOT_APPLICABLE',
  });
}
