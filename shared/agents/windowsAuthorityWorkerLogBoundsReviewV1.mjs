import { createHash } from 'node:crypto';

export const WINDOWS_AUTHORITY_WORKER_LOG_BOUNDS_PATHS_V1 = Object.freeze([
  'scripts/windows/start-mission-orchestrator-worker.ps1',
]);

const SCHEMA = 'stephanos.windows-authority-worker-log-bounds-review.v1';
const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const LINEAGE_SCHEMA = 'stephanos.windows-authority-reconciliation-lineage.v1';
const SHA = /^[a-f0-9]{40}$/;
const MAX_SOURCE_BYTES = 256 * 1024;
const REVIEWED_IDENTITY = Object.freeze({
  repository: 'Cheekyfellastef/stephan-os',
  prNumber: 2029,
  branch: 'codex/mission-worker-log-bounds-current-main-v1',
});
const REVIEWED_SOURCE_PARENT = '21f7c9475faa24ea5f1b666d5f17bbf73fb063f4';
const REVIEWED_SOURCE_MANIFEST = Object.freeze({
  blobSha: '5b3375d3cfffa186a1d375e5f5cdbf5513054cab',
  size: 10873,
});
const SOURCE_RECORD_KEYS = Object.freeze([
  'blobSha', 'content', 'exists', 'path', 'ref', 'repository', 'schemaVersion', 'size',
]);
const INPUT_KEYS = Object.freeze([
  'analysis', 'baseSha', 'branch', 'lineageEvidence', 'prNumber', 'repository', 'sourceHead', 'sources',
]);
const FINDING_KEYS = Object.freeze(['code', 'path', 'severity', 'summary']);
const LINEAGE_KEYS = Object.freeze([
  'baseSha', 'comparison', 'liveMainAfterSha', 'liveMainBeforeSha', 'parents',
  'repository', 'schemaVersion', 'sourceCommitSha', 'sourceHead',
]);
const COMPARISON_KEYS = Object.freeze([
  'aheadBy', 'baseCommitSha', 'behindBy', 'mergeBaseCommitSha', 'status',
]);

const text = (value) => String(value ?? '').trim();
const finding = (code, summary, path) => Object.freeze({ severity: 'P0', code, summary, path });

function gitBlobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`, 'utf8').update(bytes).digest('hex');
}

function exactDataRecord(value, expectedKeys) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.getPrototypeOf(value) !== Object.prototype) return false;
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== 'string') || keys.length !== expectedKeys.length) return false;
    const sorted = keys.map(String).sort();
    if (sorted.some((key, index) => key !== expectedKeys[index])) return false;
    return keys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable === true;
    });
  } catch {
    return false;
  }
}

function exactParentEstate(parents) {
  try {
    if (!Array.isArray(parents) || parents.length !== 2) return false;
    const keys = Reflect.ownKeys(parents).map(String);
    if (keys.length !== 3 || keys[0] !== '0' || keys[1] !== '1' || keys[2] !== 'length') return false;
    return parents.every((parent, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(parents, String(index));
      return descriptor && Object.hasOwn(descriptor, 'value')
        && descriptor.enumerable === true && typeof parent === 'string' && SHA.test(parent);
    });
  } catch {
    return false;
  }
}

function exactOneItemArray(value) {
  try {
    if (!Array.isArray(value) || value.length !== 1) return false;
    const keys = Reflect.ownKeys(value).map(String);
    if (keys.length !== 2 || keys[0] !== '0' || keys[1] !== 'length') return false;
    const item = Object.getOwnPropertyDescriptor(value, '0');
    const length = Object.getOwnPropertyDescriptor(value, 'length');
    return Boolean(item && length && Object.hasOwn(item, 'value') && Object.hasOwn(length, 'value')
      && item.enumerable === true && length.value === 1);
  } catch {
    return false;
  }
}

function exactIdentityAndLineage(input) {
  try {
    if (!exactDataRecord(input, INPUT_KEYS)) return false;
    const sourceHead = text(input.sourceHead).toLowerCase();
    const baseSha = text(input.baseSha).toLowerCase();
    const lineage = input.lineageEvidence;
    if (input.repository !== REVIEWED_IDENTITY.repository
      || input.prNumber !== REVIEWED_IDENTITY.prNumber
      || input.branch !== REVIEWED_IDENTITY.branch
      || !SHA.test(sourceHead) || !SHA.test(baseSha) || sourceHead === baseSha
      || !exactDataRecord(lineage, LINEAGE_KEYS)
      || lineage.schemaVersion !== LINEAGE_SCHEMA
      || lineage.repository !== REVIEWED_IDENTITY.repository
      || lineage.sourceHead !== sourceHead
      || lineage.sourceCommitSha !== sourceHead
      || lineage.baseSha !== baseSha
      || lineage.liveMainBeforeSha !== baseSha
      || lineage.liveMainAfterSha !== baseSha
      || !exactParentEstate(lineage.parents)
      || lineage.parents[0] !== REVIEWED_SOURCE_PARENT
      || lineage.parents[1] !== baseSha
      || !exactDataRecord(lineage.comparison, COMPARISON_KEYS)) return false;
    return lineage.comparison.status === 'ahead'
      && Number.isSafeInteger(lineage.comparison.aheadBy)
      && lineage.comparison.aheadBy >= 1
      && lineage.comparison.behindBy === 0
      && lineage.comparison.baseCommitSha === baseSha
      && lineage.comparison.mergeBaseCommitSha === baseSha;
  } catch {
    return false;
  }
}

function exactSource(source, repository, sourceHead, path) {
  try {
    if (!exactDataRecord(source, SOURCE_RECORD_KEYS)) return false;
    const content = typeof source.content === 'string' ? source.content : '';
    const size = Buffer.byteLength(content, 'utf8');
    return source.schemaVersion === SOURCE_SCHEMA
      && source.repository === repository
      && source.path === path
      && source.ref === sourceHead
      && source.exists === true
      && Number.isSafeInteger(source.size)
      && source.size === size
      && size > 0
      && size <= MAX_SOURCE_BYTES
      && SHA.test(text(source.blobSha))
      && source.blobSha === gitBlobSha(content)
      && source.blobSha === REVIEWED_SOURCE_MANIFEST.blobSha
      && source.size === REVIEWED_SOURCE_MANIFEST.size;
  } catch {
    return false;
  }
}

function escalationPaths(analysis = {}) {
  try {
    if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis)
      || Object.getPrototypeOf(analysis) !== Object.prototype) return [];
    const findingsDescriptor = Object.getOwnPropertyDescriptor(analysis, 'findings');
    if (!findingsDescriptor || !Object.hasOwn(findingsDescriptor, 'value')
      || findingsDescriptor.enumerable !== true || !exactOneItemArray(findingsDescriptor.value)) return [];
    const findings = findingsDescriptor.value;
    const path = WINDOWS_AUTHORITY_WORKER_LOG_BOUNDS_PATHS_V1[0];
    const item = Object.getOwnPropertyDescriptor(findings, '0').value;
    if (!exactDataRecord(item, FINDING_KEYS)) return [];
    return text(item?.severity).toUpperCase() === 'P0'
      && text(item?.code) === 'unsupported-high-risk-surface'
      && text(item?.path) === path ? [path] : [];
  } catch {
    return [];
  }
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

function exactFunctionEstate(source) {
  const names = [...source.matchAll(/\bfunction\s+([A-Za-z_][A-Za-z0-9_-]*)\b/gi)]
    .map((match) => match[1].toLowerCase())
    .sort();
  return names.length === 2
    && names[0] === 'invoke-boundedworkerlogretention'
    && names[1] === 'write-boundedworkerlogline';
}

function exactCallOperatorEstate(source) {
  const targets = [...source.matchAll(/(?:^|[^>])&\s*(\$[A-Za-z_][A-Za-z0-9_]*(?:\.Source)?)/gm)]
    .map((match) => match[1].toLowerCase());
  return targets.length === 3
    && targets.filter((target) => target === '$git.source').length === 2
    && targets.filter((target) => target === '$node.source').length === 1;
}

function reviewWorkerLogBounds(source, path, findings) {
  if (!exactFunctionEstate(source)) {
    findings.push(finding(
      'worker-log-function-estate-widened',
      'The launcher may add only the two reviewed bounded log functions.',
      path,
    ));
  }
  if (!exactCallOperatorEstate(source)) {
    findings.push(finding(
      'worker-log-execution-estate-widened',
      'The launcher must retain only two fixed Git reads and one fixed Node worker invocation.',
      path,
    ));
  }

  for (const [literal, code, summary] of [
    ["$maximumLogBytes = 64MB", 'worker-log-current-bound-missing', 'The current worker log must rotate at the reviewed 64 MB bound.'],
    ["$retainedArchiveBytes = 8MB", 'worker-log-archive-bound-missing', 'The retained worker log must be capped at the reviewed 8 MB bound.'],
    ["$maximumLineCharacters = 4000", 'worker-log-line-bound-missing', 'Each emitted worker line must remain bounded.'],
    ["$truncationMarker = '...[worker-log-line-truncated]'", 'worker-log-truncation-marker-missing', 'Bounded line truncation must remain visible.'],
    ["'worker.log'", 'worker-log-current-name-not-fixed', 'The current log name must remain fixed.'],
    ["'worker.previous.log'", 'worker-log-archive-name-not-fixed', 'The retained log name must remain fixed.'],
    ["'.worker.previous.replaced.log'", 'worker-log-backup-name-not-fixed', 'The replacement backup name must remain fixed.'],
    ["'.worker.previous.{0}.tmp'", 'worker-log-temp-name-not-fixed', 'Temporary archive identity must remain fixed and randomised.'],
    ['[System.IO.FileMode]::CreateNew', 'worker-log-temp-create-not-exclusive', 'The temporary archive must be created exclusively.'],
    ['[System.IO.FileShare]::None', 'worker-log-temp-share-not-exclusive', 'The temporary archive must not be shared while written.'],
    ['$destinationStream.Flush($true)', 'worker-log-temp-flush-missing', 'The bounded tail must be flushed before promotion.'],
    ['[System.IO.File]::Replace($temporaryArchivePath, $resolvedArchivePath, $replacementBackupPath, $true)', 'worker-log-atomic-replace-missing', 'Archive replacement must remain atomic and backup-bound.'],
    ['[System.IO.File]::Move($resolvedLogPath, $resolvedArchivePath)', 'worker-log-rotation-move-missing', 'Oversized current logs must move to the fixed archive.'],
    ['if ($destinationStream) { $destinationStream.Dispose() }', 'worker-log-destination-cleanup-missing', 'Destination handles must close on every exit.'],
    ['if ($sourceStream) { $sourceStream.Dispose() }', 'worker-log-source-cleanup-missing', 'Source handles must close on every exit.'],
    ['Invoke-BoundedWorkerLogRetention -LogRoot $logRoot -LogPath $logPath -ArchivePath $workerLogArchivePath', 'worker-log-startup-retention-missing', 'Retention must run before the worker starts.'],
    ['Write-BoundedWorkerLogLine -LogRoot $logRoot -LogPath $logPath -ArchivePath $workerLogArchivePath -Line ([string]$_)', 'worker-log-stream-writer-not-bounded', 'Worker output must pass through the bounded writer.'],
    ['& $node.Source $workerScript 2>&1 | ForEach-Object', 'worker-log-worker-invocation-not-fixed', 'The launcher must retain the fixed Node worker invocation.'],
  ]) requireLiteral(findings, source, literal, code, summary, path);

  requirePattern(findings, source,
    /\$resolvedRoot\s*=\s*\[System\.IO\.Path\]::GetFullPath\(\$LogRoot\)[\s\S]*?Split-Path -Parent \$resolvedLogPath[\s\S]*?Split-Path -Parent \$resolvedArchivePath/,
    'worker-log-path-containment-missing',
    'Both log files must be proven below the exact fixed log root.',
    path);
  requirePattern(findings, source,
    /\$rootItem\.Attributes -band \[System\.IO\.FileAttributes\]::ReparsePoint[\s\S]*?\$logItem\.Attributes -band \[System\.IO\.FileAttributes\]::ReparsePoint[\s\S]*?\$archiveItem\.Attributes -band \[System\.IO\.FileAttributes\]::ReparsePoint/,
    'worker-log-reparse-guards-incomplete',
    'The root, current log, and archive must all reject redirected paths.',
    path);
  requirePattern(findings, source,
    /Invoke-BoundedWorkerLogRetention -LogRoot \$LogRoot -LogPath \$LogPath -ArchivePath \$ArchivePath[\s\S]*?AppendAllText\([\s\S]*?Invoke-BoundedWorkerLogRetention -LogRoot \$LogRoot -LogPath \$LogPath -ArchivePath \$ArchivePath/,
    'worker-log-append-not-double-bounded',
    'Every append must be guarded by retention both before and after the write.',
    path);
  requirePattern(findings, source,
    /\$singleLine\s*=\s*\(\[string\]\$Line\)\.Replace\("`r", ' '\)\.Replace\("`n", ' '\)/,
    'worker-log-multiline-normalization-missing',
    'Worker output must be reduced to one bounded line before publication.',
    path);
  requirePattern(findings, source,
    /\$repositoryRoot -ne \$expectedRepositoryRoot[\s\S]*?\$missionRunnerRoot -ne \$expectedMissionRunnerRoot/,
    'worker-log-canonical-root-gates-missing',
    'Caller-provided roots must remain constrained to the canonical checkout and mission runner.',
    path);

  for (const [pattern, code, summary] of [
    [/\b(?:Invoke-Expression|Invoke-Command|Start-Process|Start-Job|Set-Alias|New-Alias)\b|ScriptBlock\s*::\s*Create/i, 'worker-log-dynamic-execution-forbidden', 'Dynamic process or script execution is forbidden.'],
    [/\b(?:Remove-Item|Clear-Content|Set-Content|Add-Content|Out-File)\b/i, 'worker-log-unbounded-filesystem-cmdlet-forbidden', 'Unbounded filesystem-writing cmdlets are forbidden.'],
    [/Restart-Computer|shutdown\.exe|Stop-Process|Register-ScheduledTask|Start-ScheduledTask|Unregister-ScheduledTask/i, 'worker-log-host-mutation-forbidden', 'Host, process, and Scheduled Task mutation are forbidden.'],
    [/(?:^|\s)-(?:EncodedCommand|Command)\b/im, 'worker-log-dynamic-powershell-forbidden', 'Dynamic PowerShell payloads are forbidden.'],
    [/git(?:\.exe)?\s+(?:push|reset|clean|rebase|checkout|switch|merge)\b/i, 'worker-log-git-mutation-forbidden', 'Git mutation is forbidden.'],
    [/System\.Net\.|Invoke-WebRequest|Invoke-RestMethod|WebClient|HttpClient/i, 'worker-log-network-authority-forbidden', 'The log retention path may not introduce network authority.'],
  ]) forbidPattern(findings, source, pattern, code, summary, path);
}

export function analyzeWindowsAuthorityWorkerLogBoundsReviewV1(input = {}) {
  const path = WINDOWS_AUTHORITY_WORKER_LOG_BOUNDS_PATHS_V1[0];
  if (!exactIdentityAndLineage(input)) {
    return Object.freeze({
      schemaVersion: SCHEMA,
      eligible: false,
      clean: false,
      reviewedPaths: Object.freeze([]),
      findings: Object.freeze([]),
      proofRefs: Object.freeze([]),
      finalVerdict: 'WINDOWS_AUTHORITY_WORKER_LOG_BOUNDS_SPECIALIST_NOT_ELIGIBLE',
    });
  }

  const sourceHead = text(input.sourceHead).toLowerCase();
  const paths = escalationPaths(input.analysis);
  if (paths.length !== 1) {
    return Object.freeze({
      schemaVersion: SCHEMA,
      eligible: false,
      clean: false,
      reviewedPaths: Object.freeze([]),
      findings: Object.freeze([]),
      proofRefs: Object.freeze([]),
      finalVerdict: 'WINDOWS_AUTHORITY_WORKER_LOG_BOUNDS_SPECIALIST_NOT_ELIGIBLE',
    });
  }

  const sources = input.sources;
  const sourceDescriptor = exactOneItemArray(sources)
    ? Object.getOwnPropertyDescriptor(sources, '0')
    : null;
  const candidate = sourceDescriptor?.value;
  const findings = [];
  const proofRefs = [];
  if (!sourceDescriptor || !exactSource(candidate, REVIEWED_IDENTITY.repository, sourceHead, path)) {
    findings.push(finding(
      'windows-authority-worker-log-source-evidence-invalid',
      'Exactly one immutable reviewed launcher blob is required.',
      path,
    ));
  } else {
    reviewWorkerLogBounds(candidate.content, path, findings);
    proofRefs.push(`proofs/windows-authority-worker-log-bounds/${path}@${sourceHead}#${candidate.blobSha}:${candidate.size}`);
  }
  const clean = findings.length === 0;
  return Object.freeze({
    schemaVersion: SCHEMA,
    eligible: true,
    clean,
    reviewedPaths: Object.freeze([path]),
    findings: Object.freeze(findings),
    proofRefs: Object.freeze(proofRefs),
    finalVerdict: clean
      ? 'WINDOWS_AUTHORITY_WORKER_LOG_BOUNDS_SPECIALIST_CLEAN'
      : 'WINDOWS_AUTHORITY_WORKER_LOG_BOUNDS_SPECIALIST_FINDINGS',
  });
}
