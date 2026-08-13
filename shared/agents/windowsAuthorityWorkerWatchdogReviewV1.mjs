import { createHash } from 'node:crypto';

export const WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V1 = Object.freeze([
  'scripts/windows/probe-mission-orchestrator-worker-watchdog.ps1',
  'scripts/windows/restart-approved-stephanos-runtime.ps1',
  'scripts/windows/start-mission-orchestrator-worker.ps1',
]);

const SCHEMA = 'stephanos.windows-authority-specialist-review.v1';
const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const SHA = /^[a-f0-9]{40}$/;
const MAX_SOURCE_BYTES = 256 * 1024;
const FIXED_PROBE_POWERSHELL_INVOCATION = /\$restartArguments = @\(\s*'-NoProfile',\s*'-NonInteractive',\s*'-ExecutionPolicy',\s*'Bypass',\s*'-File',\s*\$runtimeRestartPath,\s*'-Target',\s*'mission-worker',\s*'-ExpectedHead',\s*\$repositoryHead,\s*'-TimeoutSeconds',\s*'30'\s*\)\s*\$restartOutput = @\(& \$canonicalPowerShell @restartArguments 2>&1\)/;
const FIXED_CALL_OPERATOR_TARGETS = Object.freeze({
  '$canonicalgit': 6,
  '$canonicalpowershell': 1,
  '$gitexecutable': 1,
});
const FIXED_PROBE_EXECUTION_ESTATE = Object.freeze([
  /\$runtimeRestartPath\s*=\s*\[System\.IO\.Path\]::GetFullPath\(\(Join-Path \$repositoryRoot 'scripts\\windows\\restart-approved-stephanos-runtime\.ps1'\)\)/,
  /foreach\s*\(\$requiredExecutable in @\(\$canonicalGit, \$canonicalPowerShell\)\)/,
  /function Read-PublicMainHead\s*\{[\s\S]*?param\(\[string\]\$GitExecutable\)[\s\S]*?\$output\s*=\s*@\(& \$GitExecutable 'ls-remote' '--exit-code' \$publicRemote 'refs\/heads\/main' 2>&1\)[\s\S]*?\}/,
  /\$repositoryBranchOutput\s*=\s*@\(& \$canonicalGit -C \$repositoryRoot symbolic-ref --quiet --short HEAD 2>&1\)/,
  /\$repositoryHeadOutput\s*=\s*@\(& \$canonicalGit -C \$repositoryRoot rev-parse --verify HEAD 2>&1\)/,
  /\$trackedStatus\s*=\s*@\(& \$canonicalGit -C \$repositoryRoot status '--porcelain=v1' '--untracked-files=no' 2>&1\)/,
  /\$repositoryBranchAfterRestart\s*=\s*\(\[string\]\(@\(& \$canonicalGit -C \$repositoryRoot symbolic-ref --quiet --short HEAD 2>&1\)\)\[0\]\)\.Trim\(\)/,
  /\$repositoryHeadAfterRestart\s*=\s*\(\[string\]\(@\(& \$canonicalGit -C \$repositoryRoot rev-parse --verify HEAD 2>&1\)\)\[0\]\)\.Trim\(\)\.ToLowerInvariant\(\)/,
  /\$trackedStatusAfterRestart\s*=\s*@\(& \$canonicalGit -C \$repositoryRoot status '--porcelain=v1' '--untracked-files=no' 2>&1\)/,
  /Test-Path -LiteralPath \$runtimeRestartPath -PathType Leaf/,
]);
const PROHIBITED_DYNAMIC_EXECUTION = /\b(?:Invoke-Expression|Invoke-Command|Start-Process|Start-Job|Set-Alias|New-Alias|iex|icm|saps|sal|nal)\b|\[\s*scriptblock\s*\]|ScriptBlock\s*::\s*Create|AddScript\s*\(|System\.Diagnostics\.Process|Invoke-CimMethod[^\r\n]*Win32_Process[^\r\n]*Create|WScript\.Shell|CreateProcess/i;

const text = (value) => String(value ?? '').trim();
const finding = (code, summary, path) => Object.freeze({ severity: 'P0', code, summary, path });
const blobSha = (content) => {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
};

function exactSource(source, repository, sourceHead, path) {
  const content = typeof source?.content === 'string' ? source.content : '';
  const size = Buffer.byteLength(content, 'utf8');
  return Boolean(source && typeof source === 'object' && !Array.isArray(source)
    && source.schemaVersion === SOURCE_SCHEMA
    && source.repository === repository
    && source.path === path
    && source.ref === sourceHead
    && source.exists === true
    && Number.isSafeInteger(source.size)
    && source.size === size
    && size > 0
    && size <= MAX_SOURCE_BYTES
    && SHA.test(text(source.blobSha))
    && source.blobSha === blobSha(content));
}

function escalationPaths(analysis = {}) {
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  if (findings.length !== WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V1.length) return [];
  const paths = findings.map((item) => text(item?.path));
  if (findings.some((item) => text(item?.severity).toUpperCase() !== 'P0'
    || text(item?.code) !== 'unsupported-high-risk-surface')
    || new Set(paths).size !== paths.length
    || paths.some((path) => !WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V1.includes(path))) return [];
  return [...paths].sort();
}

function requirePattern(findings, source, pattern, code, summary, path) {
  if (!pattern.test(source)) findings.push(finding(code, summary, path));
}

function forbidPattern(findings, source, pattern, code, summary, path) {
  if (pattern.test(source)) findings.push(finding(code, summary, path));
}

function inspectPowerShellLexically(source) {
  const commentsRemoved = [...source];
  const codeOnly = [...source];
  const mask = (target, index) => {
    if (target[index] !== '\r' && target[index] !== '\n') target[index] = ' ';
  };
  let index = 0;
  while (index < source.length) {
    const current = source[index];
    const next = source[index + 1];

    if (current === '<' && next === '#') {
      let depth = 1;
      mask(commentsRemoved, index);
      mask(codeOnly, index);
      index += 1;
      mask(commentsRemoved, index);
      mask(codeOnly, index);
      index += 1;
      while (index < source.length && depth > 0) {
        if (source[index] === '<' && source[index + 1] === '#') {
          depth += 1;
          mask(commentsRemoved, index);
          mask(codeOnly, index);
          index += 1;
        } else if (source[index] === '#' && source[index + 1] === '>') {
          depth -= 1;
          mask(commentsRemoved, index);
          mask(codeOnly, index);
          index += 1;
        }
        mask(commentsRemoved, index);
        mask(codeOnly, index);
        index += 1;
      }
      if (depth !== 0) return null;
      continue;
    }

    if (current === '#') {
      while (index < source.length && source[index] !== '\r' && source[index] !== '\n') {
        mask(commentsRemoved, index);
        mask(codeOnly, index);
        index += 1;
      }
      continue;
    }

    if (current === '@' && next === "'") {
      const closing = source.slice(index + 2).match(/\r?\n'@(?=\r?\n|$)/);
      if (!closing) return null;
      const end = index + 2 + closing.index + closing[0].length;
      while (index < end) {
        mask(codeOnly, index);
        index += 1;
      }
      continue;
    }
    if (current === '@' && next === '"') return null;

    if (current === "'" || current === '"') {
      const quote = current;
      mask(codeOnly, index);
      index += 1;
      let closed = false;
      while (index < source.length) {
        if (quote === '"' && source[index] === '$' && source[index + 1] === '(') return null;
        if (quote === '"' && source[index] === '`') {
          mask(codeOnly, index);
          index += 1;
          if (index < source.length) mask(codeOnly, index);
          index += 1;
          continue;
        }
        if (source[index] === quote) {
          if (quote === "'" && source[index + 1] === "'") {
            mask(codeOnly, index);
            mask(codeOnly, index + 1);
            index += 2;
            continue;
          }
          mask(codeOnly, index);
          index += 1;
          closed = true;
          break;
        }
        mask(codeOnly, index);
        index += 1;
      }
      if (!closed) return null;
      continue;
    }

    if (current === '`') {
      mask(codeOnly, index);
      index += 1;
      if (index >= source.length) return null;
      mask(codeOnly, index);
      index += 1;
      continue;
    }
    index += 1;
  }
  return Object.freeze({
    commentsRemoved: commentsRemoved.join(''),
    codeOnly: codeOnly.join(''),
  });
}

function commentsRemovedPowerShellSource(source) {
  return source
    .replace(/<#[\s\S]*?#>/g, '')
    .replace(/#.*$/gm, '');
}

function callOperatorTargets(codeOnly) {
  const targets = [];
  for (let index = 0; index < codeOnly.length; index += 1) {
    if (codeOnly[index] !== '&' || codeOnly[index - 1] === '>') continue;
    let cursor = index + 1;
    while (/\s/.test(codeOnly[cursor] ?? '')) cursor += 1;
    const match = codeOnly.slice(cursor).match(/^\$[A-Za-z_][A-Za-z0-9_]*/);
    if (!match || /[.:[\]]/.test(codeOnly[cursor + (match?.[0].length ?? 0)] ?? '')) {
      targets.push('<unsupported>');
      continue;
    }
    targets.push(match[0].toLowerCase());
  }
  return targets;
}

function exactOccurrenceCount(source, variable, expected) {
  const pattern = new RegExp(`\\$${variable}(?![A-Za-z0-9_])`, 'gi');
  return (source.match(pattern) ?? []).length === expected;
}

function exactAssignmentCount(source, variable, expected) {
  const pattern = new RegExp(`\\$${variable}\\s*=`, 'gi');
  return (source.match(pattern) ?? []).length === expected;
}

function hasFixedCallOperatorEstate(codeOnly) {
  const observed = new Map();
  for (const target of callOperatorTargets(codeOnly)) {
    observed.set(target, (observed.get(target) ?? 0) + 1);
  }
  const expectedEntries = Object.entries(FIXED_CALL_OPERATOR_TARGETS);
  return observed.size === expectedEntries.length
    && expectedEntries.every(([target, count]) => observed.get(target) === count);
}

function reviewFixedPowerShellInvocation(inspection, path, findings) {
  if (!inspection) {
    findings.push(finding(
      'watchdog-probe-powershell-execution-widened',
      'Watchdog PowerShell source must be lexically complete and unambiguous.',
      path,
    ));
    return;
  }
  const { commentsRemoved, codeOnly } = inspection;
  const directShell = /(?<![$A-Za-z0-9_])(?:powershell|pwsh)(?:\.exe)?\b/i.test(codeOnly);
  const dotSource = /(?:^|[\r\n;{}()])\s*\.\s+(?:\$|['"(])/m.test(commentsRemoved);
  const exactGitBindings = (commentsRemoved.match(/Read-PublicMainHead\s+-GitExecutable\s+\$canonicalGit\b/g) ?? []).length === 2;
  const fixedVariableEstate = exactOccurrenceCount(codeOnly, 'canonicalPowerShell', 3)
    && exactOccurrenceCount(codeOnly, 'canonicalGit', 10)
    && exactOccurrenceCount(codeOnly, 'GitExecutable', 2)
    && exactOccurrenceCount(codeOnly, 'runtimeRestartPath', 3)
    && exactOccurrenceCount(codeOnly, 'restartArguments', 1)
    && exactAssignmentCount(codeOnly, 'canonicalPowerShell', 1)
    && exactAssignmentCount(codeOnly, 'canonicalGit', 1)
    && exactAssignmentCount(codeOnly, 'GitExecutable', 0)
    && exactAssignmentCount(codeOnly, 'runtimeRestartPath', 1)
    && exactAssignmentCount(codeOnly, 'restartArguments', 1)
    && !/\$restartArguments\s*(?:\+=|-=|\*=|\/=|%=|\+\+|--)/i.test(codeOnly);
  const fixedExecutionEstate = FIXED_PROBE_EXECUTION_ESTATE.every((pattern) => pattern.test(commentsRemoved));
  if (
    !FIXED_PROBE_POWERSHELL_INVOCATION.test(commentsRemoved)
    || !hasFixedCallOperatorEstate(codeOnly)
    || !fixedVariableEstate
    || !fixedExecutionEstate
    || !exactGitBindings
    || directShell
    || dotSource
    || PROHIBITED_DYNAMIC_EXECUTION.test(codeOnly)
  ) {
    findings.push(finding(
      'watchdog-probe-powershell-execution-widened',
      'Watchdog PowerShell execution must remain the single fixed reviewed -File adapter invocation.',
      path,
    ));
  }
}

function reviewProbe(source, path, findings) {
  const inspection = inspectPowerShellLexically(source);
  const executableSource = inspection?.commentsRemoved ?? '';
  requirePattern(findings, executableSource, /ValidateSet\('Inspect', 'StartApprovedWorkerTask'\)/, 'watchdog-probe-mode-widened', 'Watchdog probe modes must remain closed.', path);
  requirePattern(findings, executableSource, /\$canonicalGit = 'C:\\Program Files\\Git\\cmd\\git\.exe'/, 'watchdog-probe-git-not-fixed', 'Watchdog Git must remain canonical.', path);
  requirePattern(findings, executableSource, /\$canonicalPowerShell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe'/, 'watchdog-probe-powershell-not-fixed', 'Watchdog PowerShell must remain canonical.', path);
  requirePattern(findings, executableSource, /\$publicRemote = 'https:\/\/github\.com\/Cheekyfellastef\/stephan-os\.git'/, 'watchdog-probe-remote-not-fixed', 'Watchdog public-main observation must remain repository-bound.', path);
  requirePattern(findings, executableSource, /status '--porcelain=v1' '--untracked-files=no'[\s\S]*\$trackedStatusAfterRestart/, 'watchdog-probe-clean-recheck-missing', 'Watchdog must prove tracked-clean source before and after restart.', path);
  requirePattern(findings, executableSource, /'-Target',[\s\S]*'mission-worker'[\s\S]*'-ExpectedHead'[\s\S]*\$repositoryHead[\s\S]*'-TimeoutSeconds'[\s\S]*'30'/, 'watchdog-probe-restart-binding-incomplete', 'Watchdog restart must remain fixed, exact-head and time-bounded.', path);
  requirePattern(findings, executableSource, /\$restartReceipt\.exactHeadProofOk -eq \$true[\s\S]*\$restartReceipt\.proofFresh -eq \$true/, 'watchdog-probe-receipt-proof-incomplete', 'Watchdog must require fresh exact-head restart proof.', path);
  forbidPattern(findings, executableSource, /Get-Command\s+(?:git|powershell)(?:\.exe)?|Invoke-Expression|Start-Process|Restart-Computer|shutdown\.exe/i, 'watchdog-probe-dynamic-authority-forbidden', 'Watchdog probe must not gain dynamic executable or host authority.', path);
  reviewFixedPowerShellInvocation(inspection, path, findings);
}

function reviewRestart(source, path, findings) {
  const executableSource = commentsRemovedPowerShellSource(source);
  requirePattern(findings, executableSource, /ValidateSet\('backend', 'mission-worker'\)/, 'watchdog-restart-target-widened', 'Approved restart targets must remain closed.', path);
  requirePattern(findings, executableSource, /\$canonicalGit = 'C:\\Program Files\\Git\\cmd\\git\.exe'/, 'watchdog-restart-git-not-fixed', 'Worker restart Git must remain canonical.', path);
  requirePattern(findings, executableSource, /CANONICAL_TRACKED_SOURCE_DIRTY[\s\S]*Start-ScheduledTask[\s\S]*CANONICAL_TRACKED_SOURCE_CHANGED_DURING_WORKER_START/, 'watchdog-restart-clean-boundary-incomplete', 'Worker restart must bracket task start with tracked-clean proof.', path);
  requirePattern(findings, executableSource, /Stop-ScheduledTask -TaskName \$plan\.TaskName -TaskPath '\\' -ErrorAction SilentlyContinue[\s\S]*Get-VerifiedWorkerProcessFromHeartbeat[\s\S]*Stop-Process -Id \$startedWorker\.ProcessId/, 'watchdog-restart-dirty-cleanup-missing', 'Worker started from changed source must be stopped through owned identity.', path);
  requirePattern(findings, executableSource, /headSha -ne \$ExpectedSourceHead[\s\S]*MISSION_WORKER_EXACT_HEAD_HEARTBEAT_TIMEOUT/, 'watchdog-restart-heartbeat-binding-incomplete', 'Worker restart must require a fresh exact-head heartbeat.', path);
  forbidPattern(findings, executableSource, /\[string\]\$TaskName|Invoke-Expression|Start-Process|Restart-Computer|shutdown\.exe|Stop-Process\s+-Name/i, 'watchdog-restart-arbitrary-authority-forbidden', 'Approved restart must not gain arbitrary target or execution authority.', path);
}

function reviewLauncher(source, path, findings) {
  const executableSource = commentsRemovedPowerShellSource(source);
  requirePattern(findings, executableSource, /\$canonicalNode = 'C:\\Program Files\\nodejs\\node\.exe'/, 'watchdog-launcher-node-not-fixed', 'Worker launcher Node must remain canonical.', path);
  requirePattern(findings, executableSource, /\$canonicalGit = 'C:\\Program Files\\Git\\cmd\\git\.exe'/, 'watchdog-launcher-git-not-fixed', 'Worker launcher Git must remain canonical.', path);
  requirePattern(findings, executableSource, /branch --show-current[\s\S]*\$branch -ne 'main'/, 'watchdog-launcher-main-branch-unproven', 'Worker launcher must require canonical main.', path);
  requirePattern(findings, executableSource, /status '--porcelain=v1' '--untracked-files=no'[\s\S]*tracked-clean exact-head source/, 'watchdog-launcher-clean-proof-missing', 'Worker launcher must reject tracked source drift before Node starts.', path);
  requirePattern(findings, executableSource, /ls-remote' '--exit-code' \$publicRemote 'refs\/heads\/main'[\s\S]*exact current public main head/, 'watchdog-launcher-public-main-proof-missing', 'Worker launcher must bind execution to current public main.', path);
  requirePattern(findings, executableSource, /& \$canonicalNode \$workerScript/, 'watchdog-launcher-node-invocation-not-fixed', 'Worker launcher must invoke only canonical Node and the fixed worker.', path);
  forbidPattern(findings, executableSource, /Get-Command\s+(?:git|node)(?:\.exe)?|Invoke-Expression|Start-Process|git\s+(?:reset|clean|checkout|switch|push)/i, 'watchdog-launcher-dynamic-authority-forbidden', 'Worker launcher must not gain path resolution or source mutation authority.', path);
}

export function analyzeWindowsAuthorityWorkerWatchdogReview(input = {}) {
  const repository = text(input.repository);
  const sourceHead = text(input.sourceHead).toLowerCase();
  const paths = escalationPaths(input.analysis);
  if (repository !== 'Cheekyfellastef/stephan-os' || !SHA.test(sourceHead) || paths.length === 0) {
    return Object.freeze({ schemaVersion: SCHEMA, eligible: false, clean: false, reviewedPaths: Object.freeze([]), findings: Object.freeze([]), proofRefs: Object.freeze([]), finalVerdict: 'WINDOWS_AUTHORITY_SPECIALIST_NOT_APPLICABLE' });
  }

  const findings = [];
  const proofRefs = [];
  for (const path of paths) {
    const candidates = (Array.isArray(input.sources) ? input.sources : []).filter((source) => source?.path === path);
    if (candidates.length !== 1 || !exactSource(candidates[0], repository, sourceHead, path)) {
      findings.push(finding('windows-authority-source-evidence-invalid', 'Specialist review requires one exact blob-bound source.', path));
      continue;
    }
    const source = candidates[0].content;
    if (path.endsWith('probe-mission-orchestrator-worker-watchdog.ps1')) reviewProbe(source, path, findings);
    if (path.endsWith('restart-approved-stephanos-runtime.ps1')) reviewRestart(source, path, findings);
    if (path.endsWith('start-mission-orchestrator-worker.ps1')) reviewLauncher(source, path, findings);
    proofRefs.push(`proofs/windows-authority-specialist/${path}@${sourceHead}#${candidates[0].blobSha}:${candidates[0].size}`);
  }
  const clean = findings.length === 0;
  return Object.freeze({
    schemaVersion: SCHEMA,
    eligible: true,
    clean,
    reviewedPaths: Object.freeze(paths),
    findings: Object.freeze(findings),
    proofRefs: Object.freeze(proofRefs),
    finalVerdict: clean ? 'WINDOWS_AUTHORITY_SPECIALIST_CLEAN' : 'WINDOWS_AUTHORITY_SPECIALIST_FINDINGS',
  });
}
