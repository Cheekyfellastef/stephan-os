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
const REVIEWED_IDENTITY = Object.freeze({
  repository: 'Cheekyfellastef/stephan-os',
  prNumber: 1732,
  branch: 'agent/watchdog-control-plane-bootstrap-recovery-v1',
  sourceHead: '707f7db9964b5e100aab21d6735108a4c5e53457',
});
const REVIEWED_SOURCE_MANIFEST = Object.freeze({
  'scripts/windows/probe-mission-orchestrator-worker-watchdog.ps1': Object.freeze({
    blobSha: '4167e76e0b79d3986712b590c6fe49fe9bb3ba85',
    size: 15375,
  }),
  'scripts/windows/restart-approved-stephanos-runtime.ps1': Object.freeze({
    blobSha: '98223fd525f4777de0dee009540238d9fdfe3487',
    size: 25782,
  }),
  'scripts/windows/start-mission-orchestrator-worker.ps1': Object.freeze({
    blobSha: 'cac4b824c6656e4f45cda405cf807afddb8b1441',
    size: 5213,
  }),
});
const SOURCE_RECORD_KEYS = Object.freeze([
  'blobSha', 'content', 'exists', 'path', 'ref', 'repository', 'schemaVersion', 'size',
]);
const FIXED_PROBE_POWERSHELL_INVOCATION = /\$restartArguments = @\(\s*'-NoProfile',\s*'-NonInteractive',\s*'-ExecutionPolicy',\s*'Bypass',\s*'-File',\s*\$runtimeRestartPath,\s*'-Target',\s*'mission-worker',\s*'-ExpectedHead',\s*\$repositoryHead,\s*'-TimeoutSeconds',\s*'30'\s*\)\s*\$restartStartedAtUtc = \[datetime\]::UtcNow\s*\$restartOutput = @\(& \$canonicalPowerShell @restartArguments 2>&1\)/;
const EXECUTION_ESTATE_BY_PATH = Object.freeze({
  'scripts/windows/probe-mission-orchestrator-worker-watchdog.ps1': Object.freeze({
    callTargets: Object.freeze({ '$canonicalgit': 3, '$canonicalpowershell': 1, '$gitexecutable': 1 }),
    functions: Object.freeze(['convertfrom-windowscommandline', 'read-publicmainhead', 'test-canonicalworkerprocesscommandline', 'test-canonicalworkertaskaction']),
    fixedBindings: Object.freeze({ canonicalgit: 1, canonicalpowershell: 1, runtimerestartpath: 1, restartarguments: 1 }),
  }),
  'scripts/windows/restart-approved-stephanos-runtime.ps1': Object.freeze({
    callTargets: Object.freeze({ '$canonicalgit': 2, '$condition': 1, '$gitexecutable': 4 }),
    functions: Object.freeze(['get-canonicaltaskplan', 'get-verifiedbackendlistener', 'get-verifiedfreshworkerinstance', 'get-verifiedworkerprocessfromheartbeat', 'read-canonicalworkersourceproof', 'read-freshbackendreceipt', 'read-publicmainhead', 'stop-newlystartedownedworker', 'stop-withblocker', 'test-backendhealth', 'wait-until']),
    fixedBindings: Object.freeze({ canonicalgit: 1, missionworkercleanuptimeoutseconds: 1, missionworkerstoptimeoutseconds: 1, publicremote: 1 }),
  }),
  'scripts/windows/start-mission-orchestrator-worker.ps1': Object.freeze({
    callTargets: Object.freeze({ '$canonicalgit': 4, '$canonicalnode': 1 }),
    functions: Object.freeze([]),
    fixedBindings: Object.freeze({ canonicalgit: 1, canonicalnode: 1, workerscript: 1 }),
  }),
});
const FIXED_PROBE_EXECUTION_ESTATE = Object.freeze([
  /\$runtimeRestartPath\s*=\s*\[System\.IO\.Path\]::GetFullPath\(\(Join-Path \$repositoryRoot 'scripts\\windows\\restart-approved-stephanos-runtime\.ps1'\)\)/,
  /foreach\s*\(\$requiredExecutable in @\(\$canonicalGit, \$canonicalPowerShell\)\)/,
  /function Read-PublicMainHead\s*\{[\s\S]*?param\(\[string\]\$GitExecutable\)[\s\S]*?\$output\s*=\s*@\(& \$GitExecutable 'ls-remote' '--exit-code' \$publicRemote 'refs\/heads\/main' 2>&1\)[\s\S]*?\}/,
  /\$repositoryBranchOutput\s*=\s*@\(& \$canonicalGit -C \$repositoryRoot symbolic-ref --quiet --short HEAD 2>&1\)/,
  /\$repositoryHeadOutput\s*=\s*@\(& \$canonicalGit -C \$repositoryRoot rev-parse --verify HEAD 2>&1\)/,
  /\$trackedStatus\s*=\s*@\(& \$canonicalGit -C \$repositoryRoot status '--porcelain=v1' '--untracked-files=no' 2>&1\)/,
  /Test-Path -LiteralPath \$runtimeRestartPath -PathType Leaf/,
  /\[string\]\$restartReceipt\.publicMainHead -eq \$repositoryHead/,
  /\$restartReceipt\.postStartSourceProofOk -eq \$true/,
  /\$restartReceipt\.sourceTrackedClean -eq \$true/,
  /\$restartWorkerPidValid[\s\S]*\$restartStartedWorkerPid -gt 0/,
  /\$restartWorkerStartedAtValid[\s\S]*\$restartWorkerStartedAtUtc\.ToUniversalTime\(\) -ge \$restartStartedAtUtc/,
  /\$restartReceipt\.cleanupAttempted -eq \$false[\s\S]*\$restartReceipt\.cleanupCompleted -eq \$false/,
]);
const PROHIBITED_DYNAMIC_EXECUTION = /\b(?:Invoke-Expression|Invoke-Command|Start-Process|Start-Job|Set-Alias|New-Alias|iex|icm|saps|sal|nal)\b|\[\s*scriptblock\s*\]|ScriptBlock\s*::\s*Create|AddScript\s*\(|System\.Diagnostics\.Process|Invoke-CimMethod[^\r\n]*Win32_Process[^\r\n]*Create|WScript\.Shell|CreateProcess/i;
const PROHIBITED_EXECUTION_REBINDING = /\b(?:Set|New|Remove|Clear)-Variable\b|\b(?:Set|New|Remove|Clear)-Alias\b|\b(?:Set|New|Remove|Clear|Get)-Item(?:Property)?\b[^\r\n]*(?:variable|alias|function):|\bGet-Variable\b|\b(?:sv|nv|rv|cv|sal|nal|ral|clv|gv)\b|\$ExecutionContext\b|\.InvokeScript\s*\(|\.InvokeMember\s*\(|\.GetMethod\s*\(|System\.Reflection/i;

const text = (value) => String(value ?? '').trim();
const finding = (code, summary, path) => Object.freeze({ severity: 'P0', code, summary, path });
const blobSha = (content) => {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
};

function exactSource(source, repository, sourceHead, path) {
  try {
    if (!source || typeof source !== 'object' || Array.isArray(source)
      || Object.getPrototypeOf(source) !== Object.prototype) return false;
    const keys = Reflect.ownKeys(source);
    if (keys.some((key) => typeof key !== 'string')
      || keys.length !== SOURCE_RECORD_KEYS.length
      || keys.map(String).sort().some((key, index) => key !== SOURCE_RECORD_KEYS[index])) return false;
    const descriptors = Object.fromEntries(keys.map((key) => [key, Object.getOwnPropertyDescriptor(source, key)]));
    if (Object.values(descriptors).some((descriptor) => !descriptor
      || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true)) return false;
    const value = (key) => descriptors[key].value;
    const content = typeof value('content') === 'string' ? value('content') : '';
    const size = Buffer.byteLength(content, 'utf8');
    return Boolean(value('schemaVersion') === SOURCE_SCHEMA
      && value('repository') === repository
      && value('path') === path
      && value('ref') === sourceHead
      && value('exists') === true
      && Number.isSafeInteger(value('size'))
      && value('size') === size
      && size > 0
      && size <= MAX_SOURCE_BYTES
      && SHA.test(text(value('blobSha')))
      && value('blobSha') === blobSha(content));
  } catch {
    return false;
  }
}

function exactReviewedSource(source, path) {
  const expected = REVIEWED_SOURCE_MANIFEST[path];
  return Boolean(expected
    && source.size === expected.size
    && source.blobSha === expected.blobSha);
}

function exactReviewedIdentity(input) {
  try {
    return Boolean(input
      && typeof input === 'object'
      && !Array.isArray(input)
      && typeof input.repository === 'string'
      && input.repository === REVIEWED_IDENTITY.repository
      && Number.isSafeInteger(input.prNumber)
      && input.prNumber === REVIEWED_IDENTITY.prNumber
      && typeof input.branch === 'string'
      && input.branch === REVIEWED_IDENTITY.branch
      && typeof input.sourceHead === 'string'
      && input.sourceHead === REVIEWED_IDENTITY.sourceHead);
  } catch {
    return false;
  }
}

function exactSourceEstate(sources) {
  try {
    if (!Array.isArray(sources) || sources.length !== WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V1.length) return false;
    const ownKeys = Reflect.ownKeys(sources);
    const expectedKeys = [...sources.keys()].map(String).concat('length');
    if (ownKeys.length !== expectedKeys.length || ownKeys.some((key, index) => String(key) !== expectedKeys[index])) return false;
    return sources.every((source, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(source, 'path');
      return descriptor && Object.hasOwn(descriptor, 'value')
        && descriptor.value === WINDOWS_AUTHORITY_WORKER_WATCHDOG_PATHS_V1[index];
    });
  } catch {
    return false;
  }
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

    if (current === '"') {
      mask(codeOnly, index);
      index += 1;
      let closed = false;
      while (index < source.length) {
        if (source[index] === '`') {
          mask(codeOnly, index);
          index += 1;
          if (index < source.length) mask(codeOnly, index);
          index += 1;
          continue;
        }
        if (source[index] === '$' && source[index + 1] === '(') {
          let depth = 1;
          index += 2;
          while (index < source.length && depth > 0) {
            if (source[index] === '`') {
              mask(codeOnly, index);
              if (index + 1 < source.length) mask(codeOnly, index + 1);
              index += 2;
              continue;
            }
            if (source[index] === '"') return null;
            if (source[index] === "'") {
              mask(codeOnly, index);
              index += 1;
              let subexpressionStringClosed = false;
              while (index < source.length) {
                mask(codeOnly, index);
                if (source[index] === "'") {
                  if (source[index + 1] === "'") {
                    mask(codeOnly, index + 1);
                    index += 2;
                    continue;
                  }
                  index += 1;
                  subexpressionStringClosed = true;
                  break;
                }
                index += 1;
              }
              if (!subexpressionStringClosed) return null;
              continue;
            }
            if (source[index] === '(') depth += 1;
            if (source[index] === ')') depth -= 1;
            index += 1;
          }
          if (depth !== 0) return null;
          continue;
        }
        if (source[index] === '"') {
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

    if (current === "'") {
      const quote = current;
      mask(codeOnly, index);
      index += 1;
      let closed = false;
      while (index < source.length) {
        if (source[index] === quote) {
          if (source[index + 1] === "'") {
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

function callOperatorTargets(codeOnly) {
  const targets = [];
  for (let index = 0; index < codeOnly.length; index += 1) {
    if (codeOnly[index] !== '&' || codeOnly[index - 1] === '>') continue;
    let cursor = index + 1;
    while (/\s/.test(codeOnly[cursor] ?? '')) cursor += 1;
    const match = codeOnly.slice(cursor).match(/^\$[A-Za-z_][A-Za-z0-9_]*(?:\.Source)?/i);
    const tail = codeOnly[cursor + (match?.[0].length ?? 0)] ?? '';
    if (!match || /[.:[\]]/.test(tail)) {
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

function hasFixedCallOperatorEstate(codeOnly, expectedTargets) {
  const observed = new Map();
  for (const target of callOperatorTargets(codeOnly)) {
    observed.set(target, (observed.get(target) ?? 0) + 1);
  }
  const expectedEntries = Object.entries(expectedTargets);
  return observed.size === expectedEntries.length
    && expectedEntries.every(([target, count]) => observed.get(target) === count);
}

function exactFunctionEstate(codeOnly, expectedFunctions) {
  const observed = [...codeOnly.matchAll(/\bfunction\s+([A-Za-z_][A-Za-z0-9_-]*)\b/gi)]
    .map((match) => match[1].toLowerCase())
    .sort();
  return observed.length === expectedFunctions.length
    && observed.every((name, index) => name === expectedFunctions[index]);
}

function fixedBindingEstate(codeOnly, fixedBindings) {
  return Object.entries(fixedBindings).every(([variable, expected]) => {
    const ordinary = new RegExp(`\\$${variable}\\s*=`, 'gi');
    const anyMutation = new RegExp(`\\$(?:(?:global|script|local|private):)?${variable}\\s*(?:=|\\+=|-=|\\*=|/=|%=|\\+\\+|--)`, 'gi');
    const scoped = new RegExp(`\\$(?:global|script|local|private):${variable}\\b`, 'i');
    return (codeOnly.match(ordinary) ?? []).length === expected
      && (codeOnly.match(anyMutation) ?? []).length === expected
      && !scoped.test(codeOnly);
  });
}

function reviewSharedPowerShellExecutionEstate(inspection, path, findings) {
  const expected = EXECUTION_ESTATE_BY_PATH[path];
  if (!inspection || !expected) {
    findings.push(finding('watchdog-powershell-execution-estate-invalid', 'Owned PowerShell execution must be lexically complete and use a reviewed execution estate.', path));
    return;
  }
  const { commentsRemoved, codeOnly } = inspection;
  const directShell = /(?<![$A-Za-z0-9_])(?:powershell|pwsh)(?:\.exe)?\b/i.test(codeOnly);
  const directHostExecutable = /(?<![$A-Za-z0-9_])(?:cmd|wscript|cscript|mshta|rundll32|regsvr32|bash|sh|python|node)(?:\.exe)?\b/i.test(codeOnly);
  const dotSource = /(?:^|[\r\n;{}()])\s*\.\s+(?:\$|['"(])/m.test(commentsRemoved);
  if (!hasFixedCallOperatorEstate(codeOnly, expected.callTargets)
    || !exactFunctionEstate(codeOnly, expected.functions)
    || !fixedBindingEstate(codeOnly, expected.fixedBindings)
    || PROHIBITED_EXECUTION_REBINDING.test(codeOnly)
    || directShell
    || directHostExecutable
    || dotSource) {
    findings.push(finding(
      'watchdog-powershell-execution-estate-invalid',
      'Owned PowerShell execution must remain the exact reviewed call, function and immutable-binding estate.',
      path,
    ));
  }
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
  const exactGitBindings = (commentsRemoved.match(/Read-PublicMainHead\s+-GitExecutable\s+\$canonicalGit\b/g) ?? []).length === 1;
  const fixedVariableEstate = exactOccurrenceCount(codeOnly, 'canonicalPowerShell', 3)
    && exactOccurrenceCount(codeOnly, 'canonicalGit', 6)
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
    || !hasFixedCallOperatorEstate(codeOnly, EXECUTION_ESTATE_BY_PATH[path].callTargets)
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
  requirePattern(findings, executableSource, /\$restartReceipt\.postStartSourceProofOk -eq \$true[\s\S]*\$restartReceipt\.sourceTrackedClean -eq \$true/, 'watchdog-probe-clean-recheck-missing', 'Watchdog must require the restart adapter’s post-start tracked-clean proof.', path);
  requirePattern(findings, executableSource, /'-Target',[\s\S]*'mission-worker'[\s\S]*'-ExpectedHead'[\s\S]*\$repositoryHead[\s\S]*'-TimeoutSeconds'[\s\S]*'30'/, 'watchdog-probe-restart-binding-incomplete', 'Watchdog restart must remain fixed, exact-head and time-bounded.', path);
  requirePattern(findings, executableSource, /\$restartReceipt\.publicMainHead -eq \$repositoryHead[\s\S]*\$restartReceipt\.exactHeadProofOk -eq \$true[\s\S]*\$restartReceipt\.postStartSourceProofOk -eq \$true[\s\S]*\$restartReceipt\.sourceTrackedClean -eq \$true[\s\S]*\$restartReceipt\.proofFresh -eq \$true[\s\S]*\$restartWorkerPidValid[\s\S]*\$restartStartedWorkerPid -gt 0[\s\S]*\$restartWorkerStartedAtValid[\s\S]*\$restartWorkerStartedAtUtc\.ToUniversalTime\(\) -ge \$restartStartedAtUtc[\s\S]*\$restartReceipt\.cleanupAttempted -eq \$false[\s\S]*\$restartReceipt\.cleanupCompleted -eq \$false/, 'watchdog-probe-receipt-proof-incomplete', 'Watchdog must require fresh exact-head, public-main, worker-identity and cleanup proof.', path);
  forbidPattern(findings, executableSource, /Get-Command\s+(?:git|powershell)(?:\.exe)?|Invoke-Expression|Start-Process|Restart-Computer|shutdown\.exe/i, 'watchdog-probe-dynamic-authority-forbidden', 'Watchdog probe must not gain dynamic executable or host authority.', path);
  reviewFixedPowerShellInvocation(inspection, path, findings);
  reviewSharedPowerShellExecutionEstate(inspection, path, findings);
}

function reviewRestart(source, path, findings) {
  const inspection = inspectPowerShellLexically(source);
  const executableSource = inspection?.commentsRemoved ?? '';
  requirePattern(findings, executableSource, /ValidateSet\('backend', 'mission-worker'\)/, 'watchdog-restart-target-widened', 'Approved restart targets must remain closed.', path);
  requirePattern(findings, executableSource, /\$canonicalGit = 'C:\\Program Files\\Git\\cmd\\git\.exe'/, 'watchdog-restart-git-not-fixed', 'Worker restart Git must remain canonical.', path);
  requirePattern(findings, executableSource, /Get-Item -LiteralPath \$canonicalGit -Force[\s\S]*\$canonicalGitItem\.LinkType[\s\S]*\[System\.IO\.FileAttributes\]::ReparsePoint[\s\S]*CANONICAL_GIT_IDENTITY_INVALID/, 'watchdog-restart-git-identity-incomplete', 'Worker restart must reject linked, substituted or non-file Git identities.', path);
  requirePattern(findings, executableSource, /\$preStartSourceProof = Read-CanonicalWorkerSourceProof[\s\S]*-Phase 'PRE_START'[\s\S]*Start-ScheduledTask[\s\S]*\$postStartSourceProof = Read-CanonicalWorkerSourceProof[\s\S]*-Phase 'POST_START'/, 'watchdog-restart-clean-boundary-incomplete', 'Worker restart must bracket task start with canonical branch, head, public-main and tracked-clean proof.', path);
  requirePattern(findings, executableSource, /function Read-CanonicalWorkerSourceProof[\s\S]*symbolic-ref --quiet --short HEAD[\s\S]*rev-parse --verify HEAD[\s\S]*status '--porcelain=v1' '--untracked-files=no'[\s\S]*Read-PublicMainHead/, 'watchdog-restart-source-proof-incomplete', 'Worker restart source proof must bind branch, head, tracked source and public main through fixed Git.', path);
  requirePattern(findings, executableSource, /function Get-VerifiedFreshWorkerInstance[\s\S]*\[string\]\$heartbeat\.headSha -ne \$ExpectedSourceHead[\s\S]*\[string\]\$heartbeat\.repositoryRoot -ne \$ExpectedRepoRoot[\s\S]*\$processStartedAtUtc -le \$StartedAfterUtc[\s\S]*\$expectedWorkerPath[\s\S]*\$commandLine\.Contains\(\$expectedWorkerPath\)/, 'watchdog-restart-worker-identity-incomplete', 'Fresh worker identity must bind repository, head, process start time and canonical command.', path);
  requirePattern(findings, executableSource, /if \(\$startupBlocker\) \{[\s\S]*Stop-NewlyStartedOwnedWorker[\s\S]*Stop-WithBlocker \$cleanupBlocker[\s\S]*Stop-WithBlocker \$startupBlocker/, 'watchdog-restart-dirty-cleanup-missing', 'Every post-start failure must enter the bounded owned-worker cleanup path before terminal blocking.', path);
  requirePattern(findings, executableSource, /function Stop-NewlyStartedOwnedWorker[\s\S]*\[string\]\$Plan\.TaskName -ne 'Stephanos Mission Orchestrator Worker'[\s\S]*Get-VerifiedFreshWorkerInstance[\s\S]*\$verifiedWorker\.ProcessId -ne \$ExpectedProcessId[\s\S]*Stop-ScheduledTask[\s\S]*Stop-Process -Id \$verifiedWorker\.ProcessId -Force/, 'watchdog-restart-cleanup-identity-incomplete', 'Cleanup must remain fixed-task and fresh-worker identity bound.', path);
  requirePattern(findings, executableSource, /headSha -ne \$ExpectedSourceHead[\s\S]*MISSION_WORKER_EXACT_HEAD_HEARTBEAT_TIMEOUT/, 'watchdog-restart-heartbeat-binding-incomplete', 'Worker restart must require a fresh exact-head heartbeat.', path);
  forbidPattern(findings, executableSource, /\[string\]\$TaskName|Get-Command\s+git(?:\.exe)?|Invoke-Expression|Start-Process|Restart-Computer|shutdown\.exe|Stop-Process\s+-Name/i, 'watchdog-restart-arbitrary-authority-forbidden', 'Approved restart must not gain arbitrary target, executable or execution authority.', path);
  reviewSharedPowerShellExecutionEstate(inspection, path, findings);
}

function reviewLauncher(source, path, findings) {
  const inspection = inspectPowerShellLexically(source);
  const executableSource = inspection?.commentsRemoved ?? '';
  requirePattern(findings, executableSource, /\$canonicalNode = 'C:\\Program Files\\nodejs\\node\.exe'/, 'watchdog-launcher-node-not-fixed', 'Worker launcher Node must remain canonical.', path);
  requirePattern(findings, executableSource, /\$canonicalGit = 'C:\\Program Files\\Git\\cmd\\git\.exe'/, 'watchdog-launcher-git-not-fixed', 'Worker launcher Git must remain canonical.', path);
  requirePattern(findings, executableSource, /branch --show-current[\s\S]*\$branch -ne 'main'/, 'watchdog-launcher-main-branch-unproven', 'Worker launcher must require canonical main.', path);
  requirePattern(findings, executableSource, /status '--porcelain=v1' '--untracked-files=no'[\s\S]*tracked-clean exact-head source/, 'watchdog-launcher-clean-proof-missing', 'Worker launcher must reject tracked source drift before Node starts.', path);
  requirePattern(findings, executableSource, /ls-remote' '--exit-code' \$publicRemote 'refs\/heads\/main'[\s\S]*exact current public main head/, 'watchdog-launcher-public-main-proof-missing', 'Worker launcher must bind execution to current public main.', path);
  requirePattern(findings, executableSource, /& \$canonicalNode \$workerScript/, 'watchdog-launcher-node-invocation-not-fixed', 'Worker launcher must invoke only canonical Node and the fixed worker.', path);
  forbidPattern(findings, executableSource, /Get-Command\s+(?:git|node)(?:\.exe)?|Invoke-Expression|Start-Process|git\s+(?:reset|clean|checkout|switch|push)/i, 'watchdog-launcher-dynamic-authority-forbidden', 'Worker launcher must not gain path resolution or source mutation authority.', path);
  reviewSharedPowerShellExecutionEstate(inspection, path, findings);
}

export function analyzeWindowsAuthorityWorkerWatchdogReview(input = {}) {
  const paths = escalationPaths(input.analysis);
  if (paths.length === 0) {
    return Object.freeze({ schemaVersion: SCHEMA, eligible: false, clean: false, reviewedPaths: Object.freeze([]), findings: Object.freeze([]), proofRefs: Object.freeze([]), finalVerdict: 'WINDOWS_AUTHORITY_SPECIALIST_NOT_APPLICABLE' });
  }

  const repository = typeof input.repository === 'string' ? input.repository : '';
  const sourceHead = typeof input.sourceHead === 'string' ? input.sourceHead : '';
  const findings = [];
  const proofRefs = [];
  if (!exactReviewedIdentity(input)) {
    findings.push(finding(
      'windows-authority-reviewed-identity-mismatch',
      'Specialist review requires the exact independently supplied repository, PR, branch and prepared source head.',
      '',
    ));
  }
  const sources = input.sources;
  const sourceEstateExact = exactSourceEstate(sources);
  if (!sourceEstateExact) {
    findings.push(finding(
      'windows-authority-source-estate-invalid',
      'Specialist review requires the exact ordered three-source closed-world estate.',
      '',
    ));
  }
  for (const [sourceIndex, path] of paths.entries()) {
    const candidates = sourceEstateExact ? [sources[sourceIndex]] : [];
    if (candidates.length !== 1 || !exactSource(candidates[0], repository, sourceHead, path)) {
      findings.push(finding('windows-authority-source-evidence-invalid', 'Specialist review requires one exact blob-bound source.', path));
      continue;
    }
    if (!exactReviewedSource(candidates[0], path)) {
      findings.push(finding(
        'windows-authority-source-not-reviewed',
        'Specialist review admits only the exact independently reviewed watchdog source manifest.',
        path,
      ));
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
