import { createHash } from 'node:crypto';

export const WINDOWS_AUTHORITY_STARFIELD_VR_LAUNCHER_PATHS_V1 = Object.freeze([
  'scripts/windows/launch-starfield-vr.ps1',
]);

const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const EXACT_HEAD = /^[a-f0-9]{40}$/;
const GIT_BLOB = /^[a-f0-9]{40}$/;
const MAX_BYTES = 256 * 1024;

function text(value) { return String(value ?? '').trim(); }
function finding(code, summary, path) {
  return Object.freeze({ severity: 'P0', code, summary, path });
}
function gitBlobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update('blob ' + bytes.length + '\0', 'utf8').update(bytes).digest('hex');
}
function exactSource(source, repository, head, path) {
  const content = typeof source?.content === 'string' ? source.content : '';
  const size = Buffer.byteLength(content, 'utf8');
  return Boolean(
    source && typeof source === 'object' && !Array.isArray(source) &&
    source.schemaVersion === SOURCE_SCHEMA &&
    source.repository === repository &&
    source.path === path &&
    source.ref === head &&
    source.exists === true &&
    Number.isSafeInteger(source.size) &&
    source.size === size &&
    size > 0 && size <= MAX_BYTES &&
    GIT_BLOB.test(text(source.blobSha)) &&
    source.blobSha === gitBlobSha(content)
  );
}
function escalationPaths(analysis = {}) {
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  if (findings.length !== 1) return [];
  const item = findings[0];
  const path = text(item?.path);
  return text(item?.severity).toUpperCase() === 'P0' &&
    text(item?.code) === 'unsupported-high-risk-surface' &&
    path === WINDOWS_AUTHORITY_STARFIELD_VR_LAUNCHER_PATHS_V1[0]
      ? [path]
      : [];
}
function requireLiteral(findings, source, literal, code, summary, path) {
  if (!source.includes(literal)) findings.push(finding(code, summary, path));
}
function forbid(findings, source, pattern, code, summary, path) {
  if (pattern.test(source)) findings.push(finding(code, summary, path));
}
function parsePowerShellExecutableLines(source) {
  const rows = [];
  let blockComment = false;
  let hereQuote = '';
  let depth = 0;
  const blockStack = [];

  for (const rawLine of String(source ?? '').split(/\r?\n/)) {
    if (hereQuote) {
      if (rawLine.trim() === hereQuote + '@') hereQuote = '';
      continue;
    }

    let code = '';
    let structural = '';
    let single = false;
    let double = false;

    for (let index = 0; index < rawLine.length; index += 1) {
      const char = rawLine[index];
      const next = rawLine[index + 1] ?? '';

      if (blockComment) {
        if (char === '#' && next === '>') {
          blockComment = false;
          index += 1;
        }
        continue;
      }
      if (!single && !double && char === '<' && next === '#') {
        blockComment = true;
        index += 1;
        continue;
      }
      if (!single && !double && char === '#') break;

      if (single) {
        code += char;
        structural += ' ';
        if (char === "'" && next === "'") {
          code += next;
          structural += ' ';
          index += 1;
        } else if (char === "'") {
          single = false;
        }
        continue;
      }

      if (double) {
        code += char;
        structural += ' ';
        if (char === '`' && next) {
          code += next;
          structural += ' ';
          index += 1;
        } else if (char === '"') {
          double = false;
        }
        continue;
      }

      if (char === "'") {
        single = true;
        code += char;
        structural += ' ';
        continue;
      }
      if (char === '"') {
        double = true;
        code += char;
        structural += ' ';
        continue;
      }

      code += char;
      structural += char;
    }

    const trimmed = code.trim();
    const structuralTrimmed = structural.trim();
    const depthBefore = depth;
    const enclosingBlocks = Object.freeze([...blockStack]);
    if (trimmed) rows.push(Object.freeze({ code: trimmed, structural: structuralTrimmed, depthBefore, enclosingBlocks }));

    const hereStart = trimmed.match(/@(["'])\s*$/);
    if (hereStart) hereQuote = hereStart[1];

    for (const char of structural) {
      if (char === '}') {
        depth = Math.max(0, depth - 1);
        if (blockStack.length > 0) blockStack.pop();
      }
      if (char === '{') {
        depth += 1;
        blockStack.push(trimmed);
      }
    }
  }

  return rows;
}
function requireExecutableStatement(findings, rows, statement, depth, code, summary, path) {
  if (!rows.some((row) => row.code === statement && row.depthBefore === depth)) {
    findings.push(finding(code, summary, path));
  }
}
function requireExecutableStatementWithin(findings, rows, statement, depth, enclosingBlocks, code, summary, path) {
  const expected = Array.isArray(enclosingBlocks) ? enclosingBlocks : [];
  const clean = rows.some((row) => {
    if (row.code !== statement || row.depthBefore !== depth) return false;
    const actual = Array.isArray(row.enclosingBlocks) ? row.enclosingBlocks : [];
    if (actual.length < expected.length) return false;
    return expected.every((block, index) => actual[actual.length - expected.length + index] === block);
  });
  if (!clean) findings.push(finding(code, summary, path));
}
function requireUniqueExecutableAssignment(findings, rows, variableName, expectedStatement, code, summary, path) {
  const assignmentPattern = new RegExp('^\\$' + variableName + '\\s*(?:=|\\+=|-=|\\*=|/=|%=)', 'i');
  const setVariablePattern = new RegExp('^Set-Variable\\b.*(?:-Name\\s+[\"\\\']?' + variableName + '[\"\\\']?|[\"\\\']?' + variableName + '[\"\\\']?)', 'i');
  const assignments = rows.filter((row) => assignmentPattern.test(row.code) || setVariablePattern.test(row.code));
  if (assignments.length !== 1 || assignments[0].code !== expectedStatement) {
    findings.push(finding(code, summary, path));
  }
}
function requireExactExecutableSequence(findings, rows, sequence, depth, code, summary, path) {
  let matches = 0;
  for (let index = 0; index <= rows.length - sequence.length; index += 1) {
    const clean = sequence.every((statement, offset) => (
      rows[index + offset].code === statement && rows[index + offset].depthBefore === depth
    ));
    if (clean) matches += 1;
  }
  if (matches !== 1) findings.push(finding(code, summary, path));
}
function requireClosedProcessEstate(findings, rows, path) {
  const expectedStarts = new Map([
    ['Start-Process -FilePath $metaClientPath | Out-Null', 1],
    ['$companionProcess = Start-Process -FilePath $companionExecutable -PassThru', 1],
    ['$gameProcess = Start-Process -FilePath $launchExecutable -WorkingDirectory $workingDirectory -PassThru', 1],
    ['$performanceGuardian = Start-Process -FilePath $powershellExecutable -ArgumentList $guardianArguments -WindowStyle Hidden -PassThru', 1],
  ]);
  const starts = rows.filter((row) => /\bStart-Process\b/i.test(row.structural));
  const startsClean = starts.length === expectedStarts.size &&
    starts.every((row) => expectedStarts.get(row.code) === row.depthBefore);
  if (!startsClean) {
    findings.push(finding(
      'starfield-launcher-process-estate-not-closed',
      'Launcher process starts must remain exactly the reviewed Meta client, vorpX companion, verified game executable and hidden performance guardian boundaries.',
      path,
    ));
  }

  const expectedCalls = new Map([
    ['$decisionJson = & $NodeExecutablePath $decisionScript --profile $ProfilePath --observations $observationsPath 2>&1 | Out-String', 1],
    ["$resourceGuardJson = & $powershellExecutable -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $gamingResourceGovernorScript -Action PrepareGaming -ProcessName 'Starfield' -ProfileName 'vr-maximum' 2>&1 | Out-String", 1],
    ['$performanceJson = & $powershellExecutable -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $performanceModeScript -Action Enter -WorkspaceRoot $workspaceRoot -GameRoot $workingDirectory 2>&1 | Out-String', 2],
    ['& $powershellExecutable -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $performanceModeScript -Action Restore -SessionPath ([string]$performanceMode.sessionPath) | Out-Null', 2],
  ]);
  const calls = rows.filter((row) => /(^|[=;(]\s*)&\s+\$/i.test(row.structural));
  const callsClean = calls.length === expectedCalls.size
    && calls.every((row) => expectedCalls.get(row.code) === row.depthBefore);
  if (!callsClean) {
    findings.push(finding(
      'starfield-launcher-call-operator-estate-not-closed',
      'PowerShell call-operator authority must remain exactly the canonical decision, gaming resource preflight, and bounded MutaR performance enter/restore commands.',
      path,
    ));
  }
}
function reviewLauncher(source, path, findings) {
  const required = [
    ["$decisionScript = Join-Path $repositoryRoot 'scripts\\starfield-vr-launch-decision.mjs'", 'starfield-launcher-decision-policy-missing', 'Launcher must delegate launch authority to the canonical decision policy.'],
    ["$performanceModeScript = Join-Path $repositoryRoot 'scripts\\windows\\starfield-vr-performance-mode.ps1'", 'starfield-launcher-performance-mode-path-missing', 'MutaR performance mode must remain bound to the repository-local reviewed helper.'],
    ["$gamingResourceGovernorScript = Join-Path $repositoryRoot 'scripts\\windows\\run-vr-resource-governor.ps1'", 'starfield-launcher-gaming-resource-governor-path-missing', 'Gaming resource preflight must remain bound to the repository-local reviewed governor.'],
    ["$resourceGuardJson = & $powershellExecutable -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $gamingResourceGovernorScript -Action PrepareGaming -ProcessName 'Starfield' -ProfileName 'vr-maximum' 2>&1 | Out-String", 'starfield-launcher-gaming-resource-preflight-missing', 'Starfield must enter the bounded gaming resource preflight before process launch.'],
    ["$powershellExecutable = Join-Path $PSHOME 'powershell.exe'", 'starfield-launcher-powershell-boundary-missing', 'MutaR helper execution must remain bound to the current canonical PowerShell host.'],
    ["'stephanos.starfield-vr-launch-profile.v1'", 'starfield-launcher-profile-schema-missing', 'Verified launch profile schema must remain explicit.'],
    ["'meta-air-link'", 'starfield-launcher-air-link-boundary-missing', 'Meta Air Link must remain the fixed transport boundary.'],
    ["@('mutar-openxr', 'vorpx')", 'starfield-launcher-provider-allowlist-missing', 'Provider selection must remain closed to Mutar OpenXR or vorpX.'],
    ["Get-Process -Name 'OculusDash'", 'starfield-launcher-air-link-proof-missing', 'Air Link readiness must remain bound to OculusDash observation.'],
    ["'HKLM:\\SOFTWARE\\Khronos\\OpenXR\\1'", 'starfield-launcher-openxr-observation-missing', 'OpenXR runtime observation must remain bound to the Khronos registry location.'],
    ["Get-FileHash -LiteralPath $Path -Algorithm SHA256", 'starfield-launcher-file-hash-proof-missing', 'Observed launch files must remain SHA-256 bound.'],
    ["[System.IO.File]::WriteAllText(", 'starfield-launcher-observation-write-not-bounded', 'Decision observations must use the explicit byte-writing path.'],
    ["New-Object System.Text.UTF8Encoding($false)", 'starfield-launcher-observation-bom-guard-missing', 'Decision observations must remain UTF-8 without BOM for Node JSON parsing.'],
    ["& $NodeExecutablePath $decisionScript --profile $ProfilePath --observations $observationsPath", 'starfield-launcher-canonical-decision-invocation-missing', 'Launcher must invoke only the canonical decision script with bounded profile and observation inputs.'],
    ["if ($ReadinessOnly)", 'starfield-launcher-readiness-gate-missing', 'Readiness-only mode must remain first-class and fail closed before launch.'],
    ["if (-not $decision.ok)", 'starfield-launcher-decision-gate-missing', 'Game launch must remain gated on a successful canonical decision.'],
    ["if ($decision.action -eq 'LAUNCH_VORPX')", 'starfield-launcher-vorpx-action-gate-missing', 'vorpX companion launch must remain gated on the canonical vorpX action.'],
    ["$launchExecutable = (Resolve-Path -LiteralPath $gameLaunchPath).Path", 'starfield-launcher-verified-executable-resolution-missing', 'Launch executable must be resolved only from the verified profile path.'],
    ["Start-Process -FilePath $launchExecutable -WorkingDirectory $workingDirectory -PassThru", 'starfield-launcher-game-start-boundary-missing', 'Game start must remain bound to the verified executable and working directory.'],
    ["Nothing was changed and flat Starfield was not started.", 'starfield-launcher-flat-fallback-boundary-missing', 'Fail-closed flat-game boundary must remain explicit.'],
  ];
  for (const [literal, code, summary] of required) {
    requireLiteral(findings, source, literal, code, summary, path);
  }

  const executableRows = parsePowerShellExecutableLines(source);
  requireUniqueExecutableAssignment(
    findings, executableRows, 'performanceModeScript',
    "$performanceModeScript = Join-Path $repositoryRoot 'scripts\\windows\\starfield-vr-performance-mode.ps1'",
    'starfield-launcher-performance-mode-binding-not-immutable',
    'The performance helper binding must have exactly one executable assignment to the reviewed repository-local script.', path,
  );
  requireUniqueExecutableAssignment(
    findings, executableRows, 'powershellExecutable',
    "$powershellExecutable = Join-Path $PSHOME 'powershell.exe'",
    'starfield-launcher-powershell-binding-not-immutable',
    'The PowerShell host binding must have exactly one executable assignment to the canonical host.', path,
  );
  requireUniqueExecutableAssignment(
    findings, executableRows, 'guardianArguments', '$guardianArguments = @(',
    'starfield-launcher-guardian-arguments-binding-not-immutable',
    'Guardian arguments must be assigned exactly once from the reviewed fixed argument estate.', path,
  );
  requireExactExecutableSequence(
    findings, executableRows, [
      '$guardianArguments = @(',
      "'-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass',",
      "'-File', ('\"{0}\"' -f $performanceModeScript), '-Action', 'Guard',",
      "'-SessionPath', ('\"{0}\"' -f [string]$performanceMode.sessionPath),",
      "'-GameProcessId', [string]$gameProcess.Id",
      ')',
    ], 1,
    'starfield-launcher-guardian-arguments-not-bound',
    'Guardian arguments must remain bound to the reviewed helper, Guard action, exact session path and launched game PID.', path,
  );
  requireExecutableStatement(
    findings, executableRows, 'if ($ReadinessOnly) {', 0,
    'starfield-launcher-readiness-gate-not-executable',
    'Readiness-only mode must remain an executable top-level launch gate.',
    path,
  );
  requireExecutableStatement(
    findings, executableRows, 'if (-not $decision.ok) {', 0,
    'starfield-launcher-decision-gate-not-executable',
    'The canonical decision must remain an executable top-level gate before any game launch.',
    path,
  );
  requireExecutableStatement(
    findings, executableRows, '$launchExecutable = (Resolve-Path -LiteralPath $gameLaunchPath).Path', 0,
    'starfield-launcher-verified-executable-not-top-level',
    'The verified launch executable must be resolved at the reviewed top-level launch boundary.',
    path,
  );
  requireExecutableStatement(
    findings, executableRows, "if ($decision.action -eq 'LAUNCH_VORPX') {", 0,
    'starfield-launcher-vorpx-gate-not-executable',
    'The vorpX companion must remain behind the executable canonical action gate.',
    path,
  );
  requireExecutableStatementWithin(
    findings, executableRows, '$gameProcess = Start-Process -FilePath $launchExecutable -WorkingDirectory $workingDirectory -PassThru', 1,
    ['try {'],
    'starfield-launcher-game-start-not-top-level',
    'The game process start must remain directly inside the reviewed top-level launch try/catch boundary.',
    path,
  );
  requireExecutableStatementWithin(
    findings, executableRows, '$performanceJson = & $powershellExecutable -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $performanceModeScript -Action Enter -WorkspaceRoot $workspaceRoot -GameRoot $workingDirectory 2>&1 | Out-String', 2,
    ["if ($decision.action -eq 'LAUNCH_MUTAR_OPENXR') {", 'try {'],
    'starfield-launcher-performance-enter-not-bounded',
    'MutaR performance entry must remain inside the canonical action gate and its fail-closed try/catch.',
    path,
  );
  requireExecutableStatementWithin(
    findings, executableRows, '& $powershellExecutable -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $performanceModeScript -Action Restore -SessionPath ([string]$performanceMode.sessionPath) | Out-Null', 2,
    ['catch {', 'if ($performanceMode -and $performanceMode.sessionPath) {'],
    'starfield-launcher-performance-restore-not-bounded',
    'MutaR performance rollback must remain inside the game-launch failure path.',
    path,
  );
  requireExecutableStatementWithin(
    findings, executableRows, '$performanceGuardian = Start-Process -FilePath $powershellExecutable -ArgumentList $guardianArguments -WindowStyle Hidden -PassThru', 1,
    ['if ($performanceMode -and $performanceMode.sessionPath) {'],
    'starfield-launcher-performance-guardian-not-bounded',
    'MutaR performance guardian must remain behind the proven performance-session gate.',
    path,
  );
  requireClosedProcessEstate(findings, executableRows, path);

  forbid(findings, source, /Invoke-Expression|Invoke-Command|ScriptBlock::Create/i,
    'starfield-launcher-dynamic-execution-forbidden', 'Dynamic PowerShell execution is forbidden.', path);
  forbid(findings, executableRows.map((row) => row.structural).join('\n'),
    /\b(?:Start-Job|Start-ThreadJob|Invoke-Item)\b|System\.Diagnostics\.Process|WScript\.Shell/i,
    'starfield-launcher-alternate-process-authority-forbidden',
    'Alternate process-launch authority is outside the closed Starfield VR launcher estate.', path);
  forbid(findings, source, /Invoke-WebRequest|Start-BitsTransfer|Expand-Archive|Copy-Item/i,
    'starfield-launcher-download-install-authority-forbidden', 'Download, archive or copy/install authority is outside the launcher.', path);
  forbid(findings, source, /Set-ItemProperty|New-ItemProperty|Remove-ItemProperty/i,
    'starfield-launcher-configuration-mutation-forbidden', 'Registry or provider configuration mutation is outside the launcher.', path);
  forbid(findings, source, /Restart-Computer|shutdown\.exe|schtasks(?:\.exe)?|Register-ScheduledTask|Start-Service|Stop-Service/i,
    'starfield-launcher-system-authority-forbidden', 'Restart, task or service authority is outside the launcher.', path);
  forbid(findings, source, /\bgit(?:\.exe)?\s+(?:push|reset|clean|rebase|checkout|switch|merge|stash)\b/i,
    'starfield-launcher-git-mutation-forbidden', 'Git mutation is forbidden in the launcher.', path);
  forbid(findings, source, /Set-Content\s+-LiteralPath\s+\$observationsPath\s+-Encoding\s+UTF8/i,
    'starfield-launcher-observation-bom-regression', 'Windows PowerShell UTF8 Set-Content must not reintroduce a BOM into decision observations.', path);
  forbid(findings, source, /Start-Process\s+-FilePath\s+['"][^'"]*(?:Starfield\.exe|sfse_loader\.exe)['"]/i,
    'starfield-launcher-direct-game-path-forbidden', 'A literal direct game launch may not bypass the verified profile and decision policy.', path);
}

export function analyzeWindowsAuthorityStarfieldVrLauncherReviewV1(input = {}) {
  const repository = text(input.repository);
  const sourceHead = text(input.sourceHead).toLowerCase();
  const paths = escalationPaths(input.analysis);
  if (repository !== 'Cheekyfellastef/stephan-os' || !EXACT_HEAD.test(sourceHead) || paths.length !== 1) {
    return Object.freeze({
      eligible: false,
      clean: false,
      findings: Object.freeze([]),
      reviewedPaths: Object.freeze([]),
      proofRefs: Object.freeze([]),
      finalVerdict: 'WINDOWS_AUTHORITY_STARFIELD_VR_LAUNCHER_SPECIALIST_NOT_ELIGIBLE',
    });
  }

  const sources = Array.isArray(input.sources) ? input.sources : [];
  const findings = [];
  const proofRefs = [];
  const path = paths[0];
  const candidates = sources.filter((source) => source?.path === path);
  if (candidates.length !== 1 || !exactSource(candidates[0], repository, sourceHead, path)) {
    findings.push(finding(
      'windows-authority-source-evidence-invalid',
      'Exactly one immutable exact-head source record is required for the Starfield VR launcher.',
      path,
    ));
  } else {
    reviewLauncher(candidates[0].content, path, findings);
    proofRefs.push('proofs/windows-authority-starfield-vr-launcher/' + path + '@' + sourceHead + '#' + candidates[0].blobSha + ':' + candidates[0].size);
  }

  const clean = findings.length === 0;
  return Object.freeze({
    eligible: true,
    clean,
    findings: Object.freeze(findings),
    reviewedPaths: Object.freeze(paths),
    proofRefs: Object.freeze(proofRefs),
    finalVerdict: clean
      ? 'WINDOWS_AUTHORITY_STARFIELD_VR_LAUNCHER_SPECIALIST_CLEAN'
      : 'WINDOWS_AUTHORITY_STARFIELD_VR_LAUNCHER_SPECIALIST_FINDINGS',
  });
}
