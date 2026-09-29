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
  return Object.freeze({
    schemaVersion: SCHEMA, eligible: false, clean: false, reviewedPaths: Object.freeze([]), findings: Object.freeze([]), proofRefs: Object.freeze([]),
    finalVerdict: 'OPENCLAW_BUILDER_PROVIDER_SUCCESSOR_SPECIALIST_NOT_APPLICABLE',
  });
}
