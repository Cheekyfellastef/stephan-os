import { createHash } from 'node:crypto';

export const WINDOWS_AUTHORITY_SOVEREIGN_COMMANDER_PATHS_V1 = Object.freeze([
  'scripts/windows/configure-sovereign-commander-tailscale.ps1',
  'scripts/windows/install-sovereign-commander.ps1',
  'scripts/windows/run-sovereign-commander-hidden.ps1',
  'scripts/windows/run-stephanos-scheduled-task-windowless.vbs',
]);

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const MAX_BYTES = 256 * 1024;
const SHA40 = /^[a-f0-9]{40}$/;
const EXPECTED_BLOB_SHA_BY_PATH = Object.freeze({
  'scripts/windows/configure-sovereign-commander-tailscale.ps1': 'f101d1075037d2ac1ddd58e1b330b9bb32256c74',
  'scripts/windows/install-sovereign-commander.ps1': '177eed5464088586c0863180653821284e559c59',
  'scripts/windows/run-sovereign-commander-hidden.ps1': '9c9d9fb39997482da1ebe8bbe17b731db87df6d0',
  'scripts/windows/run-stephanos-scheduled-task-windowless.vbs': '0fccdb4a2415ed33bf5e6ea0c147711c31499274',
});

function text(value) {
  return String(value ?? '').trim();
}

function finding(code, summary, path) {
  return Object.freeze({ severity: 'P0', code, summary, path });
}

function gitBlobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`, 'utf8').update(bytes).digest('hex');
}

function exactEscalation(analysis = {}) {
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  if (findings.length !== WINDOWS_AUTHORITY_SOVEREIGN_COMMANDER_PATHS_V1.length
    || Number(analysis?.counts?.P0) !== WINDOWS_AUTHORITY_SOVEREIGN_COMMANDER_PATHS_V1.length
    || Number(analysis?.counts?.P1) !== 0
    || Number(analysis?.counts?.P2 ?? 0) !== 0) return false;
  const expected = new Set(WINDOWS_AUTHORITY_SOVEREIGN_COMMANDER_PATHS_V1);
  const observed = new Set();
  for (const item of findings) {
    const path = text(item?.path);
    if (text(item?.severity).toUpperCase() !== 'P0'
      || text(item?.code) !== 'unsupported-high-risk-surface'
      || !expected.has(path)
      || observed.has(path)) return false;
    observed.add(path);
  }
  return observed.size === expected.size;
}

function exactSource(source, sourceHead, path) {
  const content = typeof source?.content === 'string' ? source.content : '';
  const bytes = Buffer.byteLength(content, 'utf8');
  return Boolean(
    source && typeof source === 'object' && !Array.isArray(source)
    && source.schemaVersion === SOURCE_SCHEMA
    && source.repository === REPOSITORY
    && source.path === path
    && source.ref === sourceHead
    && source.exists === true
    && Number.isSafeInteger(source.size)
    && source.size === bytes
    && bytes > 0
    && bytes <= MAX_BYTES
    && SHA40.test(text(source.blobSha))
    && source.blobSha === gitBlobSha(content)
    && source.blobSha === EXPECTED_BLOB_SHA_BY_PATH[path]
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

function inspectTailnet(source, path) {
  const findings = [];
  for (const [literal, code, summary] of [
    ['[switch]$ApproveTailnetExposure', 'sovereign-tailnet-approval-switch-missing', 'Tailnet publication must require the explicit approval switch.'],
    ["throw 'APPROVE_TAILNET_EXPOSURE_REQUIRED'", 'sovereign-tailnet-approval-gate-missing', 'Tailnet publication must fail closed without operator approval.'],
    ['$localPort = 18791', 'sovereign-tailnet-local-port-not-fixed', 'Local Sovereign Commander port must remain fixed.'],
    ['$servePort = 18791', 'sovereign-tailnet-serve-port-not-fixed', 'Tailnet Serve port must remain fixed.'],
    ['$target = "http://127.0.0.1:$localPort"', 'sovereign-tailnet-loopback-target-missing', 'Tailscale Serve must proxy only the loopback backend.'],
    ['SOVEREIGN_COMMANDER_LOCAL_HEALTH_REQUIRED', 'sovereign-tailnet-health-gate-missing', 'Tailnet publication must require local health proof.'],
    ["if ([string]$status.BackendState -ne 'Running')", 'sovereign-tailnet-tailscale-state-gate-missing', 'Tailscale must already be running.'],
    ['serve --bg --https=$servePort $target', 'sovereign-tailnet-serve-command-not-fixed', 'Only the fixed private Serve route may be configured.'],
    ['publicFunnelEnabledByThisAction = $false', 'sovereign-tailnet-public-funnel-boundary-missing', 'The receipt must explicitly deny Funnel exposure.'],
    ['bearerAuthenticationStillRequired = $true', 'sovereign-tailnet-bearer-boundary-missing', 'Tailnet transport must preserve application bearer authentication.'],
    ['backendLoopbackOnly = $true', 'sovereign-tailnet-loopback-receipt-missing', 'The receipt must prove the backend remains loopback-only.'],
    ['vendorMeterRequired = $false', 'sovereign-tailnet-meterless-proof-missing', 'Tailnet route must remain vendor-meter independent.'],
  ]) requireLiteral(findings, source, literal, code, summary, path);
  forbidPattern(findings, source, /(?:^|\s)funnel(?:\s|$)|--funnel|0\.0\.0\.0|Invoke-Expression|\biex\b|-Verb\s+RunAs|Restart-Computer|Stop-Computer|shutdown(?:\.exe)?/im, 'sovereign-tailnet-authority-widened', 'Tailnet route must not gain public exposure, elevation, arbitrary code, or PC power authority.', path);
  return findings;
}

function inspectInstaller(source, path) {
  const findings = [];
  for (const [literal, code, summary] of [
    ["$taskName = 'Stephanos Sovereign Commander'", 'sovereign-install-task-not-fixed', 'Scheduled task identity must remain fixed.'],
    ["'Documents\\GitHub\\stephan-os'", 'sovereign-install-repository-not-fixed', 'Installer must remain bound to the canonical checkout.'],
    ["'scripts\\windows\\run-stephanos-scheduled-task-windowless.vbs'", 'sovereign-install-launcher-not-fixed', 'Installer must use the fixed windowless launcher.'],
    ["'scripts\\windows\\run-sovereign-commander-hidden.ps1'", 'sovereign-install-runner-not-fixed', 'Installer must use the fixed hidden runner.'],
    ["'scripts\\sovereign-commander-http.mjs'", 'sovereign-install-server-not-fixed', 'Installer must use the fixed local HTTP server.'],
    ["'sovereign-commander-token.txt'", 'sovereign-install-token-path-not-fixed', 'Bearer token location must remain fixed outside the repository.'],
    ["$wscriptExe = Join-Path $env:SystemRoot 'System32\\wscript.exe'", 'sovereign-install-wscript-not-fixed', 'Scheduled action must use Windows Script Host.'],
    ['RandomNumberGenerator]::Create()', 'sovereign-install-token-rng-missing', 'Bearer token must use the platform cryptographic RNG.'],
    ['$acl.SetAccessRuleProtection($true, $false)', 'sovereign-install-token-acl-protection-missing', 'Token ACL inheritance must be disabled.'],
    ['[System.Security.AccessControl.FileSystemRights]::FullControl', 'sovereign-install-token-user-rights-missing', 'Current user must receive the explicit token ACL.'],
    ['sovereign-commander-watchdog', 'sovereign-install-fixed-launch-id-missing', 'Scheduled action must select only the Sovereign Commander watchdog route.'],
    ['New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited', 'sovereign-install-principal-widened', 'Task must remain limited, interactive user scope.'],
    ['-Hidden -StartWhenAvailable -MultipleInstances IgnoreNew', 'sovereign-install-hidden-overlap-guard-missing', 'Task must stay hidden and single-instance.'],
    ["if ($StartNow) { Start-ScheduledTask -TaskName $taskName }", 'sovereign-install-start-boundary-missing', 'Immediate start may target only the fixed task.'],
    ['vendorMeterRequired = $false', 'sovereign-install-meterless-proof-missing', 'Install receipt must state vendor-meter independence.'],
    ['arbitraryShellAllowed = $false', 'sovereign-install-shell-boundary-missing', 'Install receipt must deny arbitrary shell authority.'],
    ['pcRestartAllowed = $false', 'sovereign-install-restart-boundary-missing', 'Install receipt must deny PC restart authority.'],
  ]) requireLiteral(findings, source, literal, code, summary, path);
  const parameterBlock = source.slice(0, Math.max(0, source.indexOf('$ErrorActionPreference')));
  forbidPattern(findings, parameterBlock, /\$(?:TaskName|Executable|Command|CommandLine|Arguments|Url|Uri|Token|Credential|Port)\b/i, 'sovereign-install-caller-authority-forbidden', 'Caller-selected executable, command, endpoint, credential, token, port or task authority is forbidden.', path);
  forbidPattern(findings, source, /Invoke-Expression|\biex\b|cmd(?:\.exe)?\s+\/c|-Verb\s+RunAs|Restart-Computer|Stop-Computer|shutdown(?:\.exe)?|npm\s+install|npx\s+@wonderwhy-er|desktop-commander/i, 'sovereign-install-generic-authority-forbidden', 'Installer must not gain arbitrary shell, elevation, PC power, package install or legacy Commander dependency.', path);
  forbidPattern(findings, source, /Invoke-WebRequest|Invoke-RestMethod|curl(?:\.exe)?|wget(?:\.exe)?/i, 'sovereign-install-network-authority-forbidden', 'Installer must not gain independent network authority.', path);
  return findings;
}

function inspectRunner(source, path) {
  const findings = [];
  for (const [literal, code, summary] of [
    ["'Documents\\GitHub\\stephan-os'", 'sovereign-runner-repository-not-fixed', 'Runner must remain bound to the canonical checkout.'],
    ["'scripts\\sovereign-commander-http.mjs'", 'sovereign-runner-server-not-fixed', 'Runner may launch only the fixed Sovereign Commander server.'],
    ["'sovereign-commander-token.txt'", 'sovereign-runner-token-path-not-fixed', 'Runner must require the fixed token file.'],
    ['$port = 18791', 'sovereign-runner-port-not-fixed', 'Health probe port must remain fixed.'],
    ["$_.Name -eq 'node.exe'", 'sovereign-runner-process-name-not-fixed', 'Process discovery must remain restricted to Node.'],
    ["-match 'sovereign-commander-http\\.mjs'", 'sovereign-runner-process-identity-not-fixed', 'Process discovery must bind the Sovereign Commander script identity.'],
    ['http://127.0.0.1:$port/health', 'sovereign-runner-loopback-health-missing', 'Health proof must remain loopback-only.'],
    ["[string]$health.service -eq 'stephanos-sovereign-commander'", 'sovereign-runner-health-identity-missing', 'Health proof must bind the Sovereign Commander service identity.'],
    ['Start-Process -FilePath $node.Source -ArgumentList @($quotedServerScript) -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru', 'sovereign-runner-fixed-hidden-launch-missing', 'Runner must launch only canonical Node with the fixed server script and hidden window.'],
    ['arbitraryExecutableAllowed = $false', 'sovereign-runner-executable-boundary-missing', 'Runner receipt must deny arbitrary executable authority.'],
    ['arbitraryShellAllowed = $false', 'sovereign-runner-shell-boundary-missing', 'Runner receipt must deny arbitrary shell authority.'],
    ['unrelatedProcessRestartAllowed = $false', 'sovereign-runner-process-boundary-missing', 'Runner receipt must deny unrelated process restart authority.'],
    ['pcRestartAllowed = $false', 'sovereign-runner-restart-boundary-missing', 'Runner receipt must deny PC restart authority.'],
  ]) requireLiteral(findings, source, literal, code, summary, path);
  requirePattern(findings, source, /Get-Command\s+node(?:\.exe)?[\s\S]{0,220}SOVEREIGN_COMMANDER_NODE_NOT_FOUND/i, 'sovereign-runner-node-resolution-not-bounded', 'Runner may resolve only Node and must fail closed if it is absent.', path);
  forbidPattern(findings, source, /Invoke-Expression|\biex\b|cmd(?:\.exe)?\s+\/c|-Verb\s+RunAs|Restart-Computer|Stop-Computer|shutdown(?:\.exe)?|npm\s+install|npx\s+@wonderwhy-er|desktop-commander/i, 'sovereign-runner-authority-widened', 'Runner must not gain arbitrary shell, elevation, PC power, package install or legacy Commander dependency.', path);
  return findings;
}

function inspectLauncher(source, path) {
  const findings = [];
  for (const [literal, code, summary] of [
    ['If WScript.Arguments.Count <> 1 Then', 'sovereign-launcher-single-argument-guard-missing', 'Windowless launcher must accept exactly one route identifier.'],
    ['powershellExe = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"', 'sovereign-launcher-powershell-not-fixed', 'Windowless launcher must use canonical Windows PowerShell.'],
    ['Case "sovereign-commander-watchdog"', 'sovereign-launcher-route-missing', 'Windowless launcher must expose the fixed Sovereign Commander watchdog route.'],
    ['"scripts\\windows\\run-sovereign-commander-hidden.ps1"', 'sovereign-launcher-runner-not-fixed', 'Sovereign route must target only the fixed hidden runner.'],
    ['" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File " & Quote(targetPath)', 'sovereign-launcher-file-adapter-missing', 'Sovereign route must use the fixed PowerShell -File adapter.'],
    ['Case Else', 'sovereign-launcher-default-deny-missing', 'Unknown launcher routes must fail closed.'],
    ['WScript.Quit 2', 'sovereign-launcher-default-deny-code-missing', 'Unknown or malformed launcher requests must terminate.'],
    ['exitCode = shell.Run(command, 0, True)', 'sovereign-launcher-hidden-execution-missing', 'Launcher must run hidden and synchronously.'],
  ]) requireLiteral(findings, source, literal, code, summary, path);
  requirePattern(findings, source, /Case "sovereign-commander-watchdog"[\s\S]{0,420}run-sovereign-commander-hidden\.ps1[\s\S]{0,420}-File /i, 'sovereign-launcher-route-boundary-incomplete', 'Sovereign route must remain an exact fixed-script PowerShell -File call.', path);
  return findings;
}

function inspectSource(path, source) {
  if (path.endsWith('configure-sovereign-commander-tailscale.ps1')) return inspectTailnet(source, path);
  if (path.endsWith('install-sovereign-commander.ps1')) return inspectInstaller(source, path);
  if (path.endsWith('run-sovereign-commander-hidden.ps1')) return inspectRunner(source, path);
  if (path.endsWith('run-stephanos-scheduled-task-windowless.vbs')) return inspectLauncher(source, path);
  return [finding('sovereign-specialist-path-not-supported', 'Only the exact Sovereign Commander Windows authority estate is supported.', path)];
}

export function analyzeWindowsAuthoritySovereignCommanderReviewV1(input = {}) {
  const sourceHead = text(input.sourceHead).toLowerCase();
  const eligible = input.repository === REPOSITORY
    && SHA40.test(sourceHead)
    && exactEscalation(input.analysis);
  if (!eligible) {
    return Object.freeze({
      eligible: false,
      clean: false,
      reviewedPaths: Object.freeze([]),
      findings: Object.freeze([]),
      proofRefs: Object.freeze([]),
      finalVerdict: 'WINDOWS_AUTHORITY_SOVEREIGN_COMMANDER_SPECIALIST_NOT_ELIGIBLE',
    });
  }

  const sources = Array.isArray(input.sources) ? input.sources : [];
  const findings = [];
  const proofRefs = [];
  if (sources.length !== WINDOWS_AUTHORITY_SOVEREIGN_COMMANDER_PATHS_V1.length) {
    findings.push(finding('sovereign-specialist-source-inventory-invalid', 'Exactly four immutable exact-head source records are required.', WINDOWS_AUTHORITY_SOVEREIGN_COMMANDER_PATHS_V1[0]));
  } else {
    for (const path of WINDOWS_AUTHORITY_SOVEREIGN_COMMANDER_PATHS_V1) {
      const candidates = sources.filter((source) => text(source?.path) === path);
      if (candidates.length !== 1 || !exactSource(candidates[0], sourceHead, path)) {
        findings.push(finding('sovereign-specialist-exact-source-invalid', 'Exact reviewed source bytes are required for every Sovereign Commander Windows authority file.', path));
        continue;
      }
      findings.push(...inspectSource(path, candidates[0].content));
      proofRefs.push(`proofs/windows-authority/sovereign-commander/${path}@${sourceHead}#${EXPECTED_BLOB_SHA_BY_PATH[path]}:${candidates[0].size}`);
    }
  }

  const clean = findings.length === 0;
  return Object.freeze({
    eligible: true,
    clean,
    reviewedPaths: WINDOWS_AUTHORITY_SOVEREIGN_COMMANDER_PATHS_V1,
    findings: Object.freeze(findings),
    proofRefs: Object.freeze(proofRefs),
    sourceMutationAllowed: false,
    mergeAuthority: false,
    runtimeMutationAllowed: false,
    providerQualificationAuthority: false,
    arbitraryShellAuthority: false,
    pcRestartAuthority: false,
    publicInternetExposureAuthority: false,
    finalVerdict: clean
      ? 'WINDOWS_AUTHORITY_SOVEREIGN_COMMANDER_SPECIALIST_CLEAN'
      : 'WINDOWS_AUTHORITY_SOVEREIGN_COMMANDER_SPECIALIST_FINDINGS',
  });
}
