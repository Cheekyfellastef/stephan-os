import { createHash } from 'node:crypto';

export const OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1 = Object.freeze([
  'scripts/windows/restart-approved-stephanos-runtime.ps1',
]);

export const MONITOR_MULTIPLEXER_PR1639_SPECIALIST_PATHS_V1 = Object.freeze([
  'scripts/windows/install-battle-bridge-monitor-multiplexer.ps1',
  'scripts/windows/run-battle-bridge-monitor-multiplexer-hidden.ps1',
  'scripts/windows/run-stephanos-scheduled-task-windowless.vbs',
]);

const SCHEMA = 'stephanos.openclaw-builder-provider-specialist-review-successor.v1';
const MULTIPLEXER_SCHEMA = 'stephanos.monitor-multiplexer-pr1639-specialist-review.v1';
const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const CANONICAL_REPOSITORY = 'Cheekyfellastef/stephan-os';
const FULL_SHA = /^[a-f0-9]{40}$/;
const HARDLINK_PR = 2048;
const HARDLINK_BRANCH = 'fix/battle-bridge-canonical-git-hardlink-v1';
const HARDLINK_PATH = OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1[0];
const HARDLINK_BLOB_SHA = 'cbcf5972fc52be2ab459843be9c66382b5a6b569';
const MULTIPLEXER_PR = 1639;
const MULTIPLEXER_BRANCH = 'codex/1585-chatgpt-monitor-admission-bridge-v1';
const MULTIPLEXER_BLOB_SHA_BY_PATH = Object.freeze({
  'scripts/windows/install-battle-bridge-monitor-multiplexer.ps1': 'df93fed4ba5af91048f1ae8f748e5d5349d5cb2e',
  'scripts/windows/run-battle-bridge-monitor-multiplexer-hidden.ps1': 'ef2a8cf5a18cdb75ff545c52a89a6b81d933cbb2',
  'scripts/windows/run-stephanos-scheduled-task-windowless.vbs': 'fc29921523e76aa61ba8b5f594c9fe0fe5524723',
});

const text = (value) => String(value ?? '').trim();
const finding = (code, path = HARDLINK_PATH, summary = code) => Object.freeze({
  severity: 'P0',
  code,
  summary,
  path,
});

function gitBlobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function exactEscalation(analysis) {
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  return findings.length === 1
    && text(findings[0]?.severity).toUpperCase() === 'P0'
    && text(findings[0]?.code) === 'unsupported-high-risk-surface'
    && text(findings[0]?.path) === HARDLINK_PATH;
}

function exactMultiplexerEscalation(analysis) {
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  const paths = [...new Set(findings.map((item) => text(item?.path)))].sort();
  const expected = [...MONITOR_MULTIPLEXER_PR1639_SPECIALIST_PATHS_V1].sort();
  return findings.length === expected.length
    && findings.every((item) => text(item?.severity).toUpperCase() === 'P0'
      && text(item?.code) === 'unsupported-high-risk-surface')
    && paths.length === expected.length
    && paths.every((path, index) => path === expected[index])
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
    && parents.includes(baseSha)
    && lineage?.comparison?.status === 'ahead'
    && Number.isSafeInteger(lineage?.comparison?.aheadBy)
    && lineage.comparison.aheadBy > 0
    && lineage?.comparison?.behindBy === 0
    && lineage?.comparison?.baseCommitSha === baseSha
    && lineage?.comparison?.mergeBaseCommitSha === baseSha;
}

function exactHardlinkSource(source, sourceHead) {
  const content = typeof source?.content === 'string' ? source.content : '';
  const size = Buffer.byteLength(content, 'utf8');
  return Boolean(source && typeof source === 'object' && !Array.isArray(source)
    && source.schemaVersion === SOURCE_SCHEMA
    && source.repository === CANONICAL_REPOSITORY
    && source.path === HARDLINK_PATH
    && source.ref === sourceHead
    && source.exists === true
    && Number.isSafeInteger(source.size)
    && source.size === size
    && size > 0
    && size <= 256 * 1024
    && source.blobSha === HARDLINK_BLOB_SHA
    && gitBlobSha(content) === HARDLINK_BLOB_SHA
    && content.includes("$canonicalGit = 'C:\\Program Files\\Git\\cmd\\git.exe'")
    && content.includes('$canonicalGitLinkType = [string]$canonicalGitItem.LinkType')
    && content.includes("-and $canonicalGitLinkType -ne 'HardLink')")
    && content.includes('FileAttributes]::ReparsePoint')
    && content.includes('$resolvedCanonicalGit = [System.IO.Path]::GetFullPath($canonicalGitItem.FullName)')
    && content.includes('$canonicalNodeItem.LinkType'));
}

function exactMultiplexerSource(source, sourceHead, path) {
  const content = typeof source?.content === 'string' ? source.content : '';
  const size = Buffer.byteLength(content, 'utf8');
  const expectedBlobSha = MULTIPLEXER_BLOB_SHA_BY_PATH[path];
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
    && source.blobSha === expectedBlobSha
    && gitBlobSha(content) === expectedBlobSha);
}

function requirePattern(findings, source, pattern, code, path, summary = code) {
  if (!pattern.test(source)) findings.push(finding(code, path, summary));
}

function forbidPattern(findings, source, pattern, code, path, summary = code) {
  if (pattern.test(source)) findings.push(finding(code, path, summary));
}

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

function analyzeMonitorMultiplexerPr1639(input = {}) {
  const repository = text(input.repository);
  const prNumber = Number(input.prNumber);
  const branch = text(input.branch);
  const sourceHead = text(input.sourceHead).toLowerCase();
  const baseSha = text(input.baseSha).toLowerCase();
  const eligible = repository === CANONICAL_REPOSITORY
    && prNumber === MULTIPLEXER_PR
    && branch === MULTIPLEXER_BRANCH
    && FULL_SHA.test(sourceHead)
    && FULL_SHA.test(baseSha)
    && exactMultiplexerEscalation(input.analysis);

  if (!eligible) return Object.freeze({
    schemaVersion: MULTIPLEXER_SCHEMA,
    eligible: false,
    clean: false,
    reviewedPaths: Object.freeze([]),
    findings: Object.freeze([]),
    proofRefs: Object.freeze([]),
    finalVerdict: 'MONITOR_MULTIPLEXER_PR1639_SPECIALIST_NOT_APPLICABLE',
  });

  if (!exactLineage(input.lineageEvidence, sourceHead, baseSha)) return Object.freeze({
    schemaVersion: MULTIPLEXER_SCHEMA,
    eligible: true,
    clean: false,
    reviewedPaths: MONITOR_MULTIPLEXER_PR1639_SPECIALIST_PATHS_V1,
    findings: Object.freeze([finding('multiplexer-pr1639-reconciliation-lineage-invalid', MONITOR_MULTIPLEXER_PR1639_SPECIALIST_PATHS_V1[0])]),
    proofRefs: Object.freeze([]),
    sourceMutationAllowed: false,
    mergeAuthority: false,
    runtimeMutationAllowed: false,
    providerQualificationAuthority: false,
    finalVerdict: 'MONITOR_MULTIPLEXER_PR1639_SPECIALIST_FINDINGS',
  });

  const sources = Array.isArray(input.sources) ? input.sources : [];
  const byPath = new Map(sources.map((source) => [text(source?.path), source]));
  const findings = [];
  const proofRefs = [];
  if (sources.length !== MONITOR_MULTIPLEXER_PR1639_SPECIALIST_PATHS_V1.length || byPath.size !== MONITOR_MULTIPLEXER_PR1639_SPECIALIST_PATHS_V1.length) {
    findings.push(finding('multiplexer-pr1639-source-inventory-invalid', MONITOR_MULTIPLEXER_PR1639_SPECIALIST_PATHS_V1[0]));
  }
  for (const path of MONITOR_MULTIPLEXER_PR1639_SPECIALIST_PATHS_V1) {
    const source = byPath.get(path);
    if (!exactMultiplexerSource(source, sourceHead, path)) {
      findings.push(finding('multiplexer-pr1639-exact-source-proof-invalid', path));
      continue;
    }
    if (path.endsWith('install-battle-bridge-monitor-multiplexer.ps1')) inspectMultiplexerInstaller(source.content, path, findings);
    else if (path.endsWith('run-battle-bridge-monitor-multiplexer-hidden.ps1')) inspectMultiplexerHiddenLauncher(source.content, path, findings);
    else inspectWindowlessLauncher(source.content, path, findings);
    proofRefs.push(`proofs/provider-neutral-windows-specialist/pr-${MULTIPLEXER_PR}/${path}@${sourceHead}#${source.blobSha}`);
  }
  const clean = findings.length === 0;
  return Object.freeze({
    schemaVersion: MULTIPLEXER_SCHEMA,
    eligible: true,
    clean,
    reviewedPaths: MONITOR_MULTIPLEXER_PR1639_SPECIALIST_PATHS_V1,
    findings: Object.freeze(findings),
    proofRefs: clean ? Object.freeze([
      ...proofRefs,
      'proofs/provider-neutral-windows-specialist/pr-1639/current-main-ahead-only-lineage',
      'proofs/provider-neutral-windows-specialist/pr-1639/fixed-host-fixed-route-no-source-or-merge-authority',
    ]) : Object.freeze([]),
    sourceMutationAllowed: false,
    mergeAuthority: false,
    runtimeMutationAllowed: false,
    providerQualificationAuthority: false,
    finalVerdict: clean
      ? 'MONITOR_MULTIPLEXER_PR1639_SPECIALIST_CLEAN'
      : 'MONITOR_MULTIPLEXER_PR1639_SPECIALIST_FINDINGS',
  });
}

function analyzeHardlinkSuccessor(input = {}) {
  const repository = text(input.repository);
  const prNumber = Number(input.prNumber);
  const branch = text(input.branch);
  const sourceHead = text(input.sourceHead).toLowerCase();
  const baseSha = text(input.baseSha).toLowerCase();
  const eligible = repository === CANONICAL_REPOSITORY
    && prNumber === HARDLINK_PR
    && branch === HARDLINK_BRANCH
    && FULL_SHA.test(sourceHead)
    && FULL_SHA.test(baseSha)
    && exactEscalation(input.analysis);

  if (!eligible) return Object.freeze({
    schemaVersion: SCHEMA,
    eligible: false,
    clean: false,
    reviewedPaths: Object.freeze([]),
    findings: Object.freeze([]),
    proofRefs: Object.freeze([]),
    finalVerdict: 'OPENCLAW_BUILDER_PROVIDER_SUCCESSOR_SPECIALIST_NOT_APPLICABLE',
  });

  if (!exactLineage(input.lineageEvidence, sourceHead, baseSha)) return Object.freeze({
    schemaVersion: SCHEMA,
    eligible: true,
    clean: false,
    reviewedPaths: OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1,
    findings: Object.freeze([finding('battle-bridge-hardlink-reconciliation-lineage-invalid')]),
    proofRefs: Object.freeze([]),
    finalVerdict: 'OPENCLAW_BUILDER_PROVIDER_SUCCESSOR_SPECIALIST_FINDINGS',
  });

  const sources = Array.isArray(input.sources) ? input.sources : [];
  const candidate = sources.length === 1 ? sources[0] : null;
  const clean = exactHardlinkSource(candidate, sourceHead);
  const findings = clean
    ? Object.freeze([])
    : Object.freeze([finding('battle-bridge-hardlink-exact-source-proof-invalid')]);
  const proofRefs = clean
    ? Object.freeze([
      `proofs/provider-neutral-windows-specialist/pr-${HARDLINK_PR}`,
      `proofs/provider-neutral-windows-specialist/${HARDLINK_PATH}@${sourceHead}#${HARDLINK_BLOB_SHA}`,
      'proofs/provider-neutral-windows-specialist/hardlink-only-canonical-git-identity',
    ])
    : Object.freeze([]);

  return Object.freeze({
    schemaVersion: SCHEMA,
    eligible: true,
    clean,
    reviewedPaths: OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1,
    findings,
    proofRefs,
    finalVerdict: clean
      ? 'OPENCLAW_BUILDER_PROVIDER_SUCCESSOR_SPECIALIST_CLEAN'
      : 'OPENCLAW_BUILDER_PROVIDER_SUCCESSOR_SPECIALIST_FINDINGS',
  });
}

export function analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(input = {}) {
  const multiplexer = analyzeMonitorMultiplexerPr1639(input);
  if (multiplexer.eligible) return multiplexer;
  return analyzeHardlinkSuccessor(input);
}
