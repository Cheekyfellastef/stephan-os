import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const BASE_PATH = './windowsAuthoritySpecialistReviewV1Base.mjs';
const WSL2_PATH = './windowsAuthorityForgeWsl2PrerequisiteReviewV1.mjs';
const STARFIELD_VR_SPLASH_PATH = './windowsAuthorityStarfieldVrSplashReviewV1.mjs';
const MAILBOX_CADENCE_PATH = './windowsAuthorityMailboxCadenceReviewV1.mjs';
const IGNITION_CONVERGENCE_PATH = './windowsAuthorityIgnitionConvergenceReviewV1.mjs';
const MISSION_WORKER_CLEANUP_PATH = './windowsAuthorityMissionWorkerCleanupReviewV1.mjs';
const BASE_BLOB_SHA = '210841bba782628f616c697df2f2eb859069828e';
const WSL2_BLOB_SHA = 'a03ab69af51d0a39a0d43d72df515f4a5a8329c0';
const STARFIELD_VR_SPLASH_BLOB_SHA = '2532106b7f2d4d75db535d8c32aa1c282f98e7e4';
const MAILBOX_CADENCE_BLOB_SHA = 'd1319d542b219c786a36e8063f4080369f1f9a51';
const IGNITION_CONVERGENCE_BLOB_SHA = '8115a382c5c7b9a0bfe5611d4931fcbd969d1162';
const MISSION_WORKER_CLEANUP_BLOB_SHA = '85ce19eab2434954c05dc9110581695be2ddb0d3';

const EXPECTED_IGNITION_CONVERGENCE_PATHS = Object.freeze(['scripts/windows/probe-battle-bridge-recovery-mesh.ps1','scripts/windows/repair-stephanos-battle-bridge.ps1','scripts/windows/restart-approved-stephanos-runtime.ps1','scripts/windows/start-stephanos-backend.ps1']);
const EXPECTED_MISSION_WORKER_CLEANUP_PATHS = Object.freeze(['scripts/windows/restart-approved-stephanos-runtime.ps1']);
const MAILBOX_RECOVERY_GUARDIAN_BLOB_SHA = '0750137480031f19a364915095c69b7ab6061799';
const WORKER_WATCHDOG_BLOB_SHA = '148972def36e1af880f21876f4203f802c697ecb';
const MAILBOX_CADENCE_ROUTE = 'mailboxCadence.analyzeWindowsAuthorityMailboxCadenceReviewV1';
const MAILBOX_CADENCE_INVENTORY_GUARD = 'WINDOWS_AUTHORITY_MAILBOX_CADENCE_PATH_INVENTORY_MISMATCH';
const IGNITION_PATH_INVENTORY = 'WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_PATHS_V1';
const MISSION_WORKER_PATH_INVENTORY = 'WINDOWS_AUTHORITY_MISSION_WORKER_CLEANUP_PATHS_V1';
const IGNITION_ROUTE_SEQUENCE = 'ignitionConvergence.analyzeWindowsAuthorityIgnitionConvergenceReview(input); if (ignitionConvergenceResult.eligible) return ignitionConvergenceResult;';
const MISSION_WORKER_ROUTE_SEQUENCE = 'missionWorkerCleanup.analyzeWindowsAuthorityMissionWorkerCleanupReviewV1(input); if (missionWorkerCleanupResult.eligible) return missionWorkerCleanupResult;';
const MAILBOX_RECOVERY_ROUTE = 'analyzeWindowsAuthorityMailboxRecoveryGuardianReview';
const LEGACY_RECOVERY_MESH_ROUTE = 'analyzeWindowsAuthorityRecoveryMeshGuardianReview';
const WORKER_WATCHDOG_ROUTE = 'analyzeWindowsAuthorityWorkerWatchdogReview';
const LEGACY_CORE_ROUTE = 'core.analyzeWindowsAuthoritySpecialistReview';

const MAILBOX_ROLLOVER_SCHEMA = 'stephanos.windows-authority-mailbox-rollover-review.v1';
const WINDOWS_AUTHORITY_SOURCE_SCHEMA = 'stephanos.windows-authority-source.v1';
const WINDOWS_AUTHORITY_LINEAGE_SCHEMA = 'stephanos.windows-authority-reconciliation-lineage.v1';
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const MAILBOX_ROLLOVER_PR_NUMBER = 2164;
const MAILBOX_ROLLOVER_BRANCH = 'fix/canonical-mailbox-rollover-2158-v1';
export const WINDOWS_AUTHORITY_MAILBOX_ROLLOVER_PATHS_V1 = Object.freeze([
  'scripts/windows/install-battle-bridge-github-command-mailbox.ps1',
  'scripts/windows/request-battle-bridge-recovery.ps1',
]);
const MAILBOX_ROLLOVER_BLOB_SHA_BY_PATH = Object.freeze({
  'scripts/windows/install-battle-bridge-github-command-mailbox.ps1': '91a1ee081465236dc2bf509c4ccff1836eab5cd4',
  'scripts/windows/request-battle-bridge-recovery.ps1': '4a9318654405855cba5b1e15aaf2e4a587530f7f',
});
const SHA40 = /^[a-f0-9]{40}$/;
const MAX_SOURCE_BYTES = 256 * 1024;

function text(value) {
  return String(value ?? '').trim();
}

function gitBlobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`, 'utf8').update(bytes).digest('hex');
}
function provePinnedModule(path, expectedBlobSha) {
  const url = new URL(path, import.meta.url);
  const content = readFileSync(url, 'utf8');
  const observedBlobSha = gitBlobSha(content);
  if (observedBlobSha !== expectedBlobSha) throw new Error(`WINDOWS_AUTHORITY_SPECIALIST_PIN_MISMATCH:${path}:${observedBlobSha}`);
  return Object.freeze({ url, content });
}
function proveLegacyRoutingInvariants(source) {
  if (!source.includes(`MAILBOX_CADENCE_PATH = '${MAILBOX_CADENCE_PATH}'`)) throw new Error('WINDOWS_AUTHORITY_MAILBOX_CADENCE_PATH_MISMATCH');
  if (!source.includes(`MAILBOX_CADENCE_BLOB_SHA = '${MAILBOX_CADENCE_BLOB_SHA}'`)) throw new Error('WINDOWS_AUTHORITY_MAILBOX_CADENCE_PIN_MISMATCH');
  if (!source.includes(MAILBOX_CADENCE_INVENTORY_GUARD)) throw new Error('WINDOWS_AUTHORITY_MAILBOX_CADENCE_INVENTORY_GUARD_MISSING');
  if (!source.includes(`IGNITION_CONVERGENCE_PATH = '${IGNITION_CONVERGENCE_PATH}'`) || !source.includes(`IGNITION_CONVERGENCE_BLOB_SHA = '${IGNITION_CONVERGENCE_BLOB_SHA}'`) || !source.includes(IGNITION_PATH_INVENTORY) || !source.includes(JSON.stringify(EXPECTED_IGNITION_CONVERGENCE_PATHS).replaceAll('"', "'")) || !source.includes(IGNITION_ROUTE_SEQUENCE)) throw new Error('WINDOWS_AUTHORITY_IGNITION_CONVERGENCE_LEGACY_CONTRACT_MISMATCH');
  if (!source.includes(`MISSION_WORKER_CLEANUP_PATH = '${MISSION_WORKER_CLEANUP_PATH}'`) || !source.includes(`MISSION_WORKER_CLEANUP_BLOB_SHA = '${MISSION_WORKER_CLEANUP_BLOB_SHA}'`) || !source.includes(MISSION_WORKER_PATH_INVENTORY) || !source.includes(MISSION_WORKER_ROUTE_SEQUENCE)) throw new Error('WINDOWS_AUTHORITY_MISSION_WORKER_CLEANUP_LEGACY_CONTRACT_MISMATCH');
  if (!source.includes(`MAILBOX_RECOVERY_GUARDIAN_BLOB_SHA = '${MAILBOX_RECOVERY_GUARDIAN_BLOB_SHA}'`)) throw new Error('WINDOWS_AUTHORITY_MAILBOX_RECOVERY_GUARDIAN_PIN_MISMATCH');
  if (!source.includes(`WORKER_WATCHDOG_BLOB_SHA = '${WORKER_WATCHDOG_BLOB_SHA}'`)) throw new Error('WINDOWS_AUTHORITY_WORKER_WATCHDOG_PIN_MISMATCH');
  const cadenceIndex = source.indexOf(MAILBOX_CADENCE_ROUTE);
  const cadenceCoreIndex = source.indexOf(LEGACY_CORE_ROUTE);
  if (cadenceIndex < 0 || cadenceCoreIndex < 0 || cadenceIndex >= cadenceCoreIndex) throw new Error('WINDOWS_AUTHORITY_MAILBOX_CADENCE_ROUTE_ORDER_MISMATCH');
  const mailboxIndex = source.indexOf(MAILBOX_RECOVERY_ROUTE);
  const recoveryMeshIndex = source.indexOf(LEGACY_RECOVERY_MESH_ROUTE);
  if (mailboxIndex < 0 || recoveryMeshIndex < 0 || mailboxIndex >= recoveryMeshIndex) throw new Error('WINDOWS_AUTHORITY_MAILBOX_RECOVERY_ROUTE_ORDER_MISMATCH');
  const watchdogIndex = source.indexOf(WORKER_WATCHDOG_ROUTE);
  const coreIndex = source.indexOf(LEGACY_CORE_ROUTE);
  if (watchdogIndex < 0 || coreIndex < 0 || watchdogIndex >= coreIndex) throw new Error('WINDOWS_AUTHORITY_WORKER_WATCHDOG_ROUTE_ORDER_MISMATCH');
}

function mailboxRolloverFinding(code, summary, path) {
  return Object.freeze({ severity: 'P0', code, summary, path });
}

function exactMailboxRolloverEscalation(analysis = {}) {
  const findings = Array.isArray(analysis?.findings) ? analysis.findings : [];
  const observedPaths = findings.map((item) => text(item?.path)).sort();
  const expectedPaths = [...WINDOWS_AUTHORITY_MAILBOX_ROLLOVER_PATHS_V1].sort();
  return findings.length === 2
    && findings.every((item) => text(item?.severity).toUpperCase() === 'P0' && text(item?.code) === 'unsupported-high-risk-surface')
    && observedPaths.length === expectedPaths.length
    && observedPaths.every((path, index) => path === expectedPaths[index])
    && Number(analysis?.counts?.P0) === 2
    && Number(analysis?.counts?.P1) === 0
    && Number(analysis?.counts?.P2 ?? 0) === 0;
}

function exactMailboxRolloverLineage(lineage, sourceHead, baseSha) {
  const parents = Array.isArray(lineage?.parents) ? lineage.parents.map((item) => text(item).toLowerCase()) : [];
  return lineage?.schemaVersion === WINDOWS_AUTHORITY_LINEAGE_SCHEMA
    && lineage.repository === REPOSITORY
    && lineage.sourceHead === sourceHead
    && lineage.sourceCommitSha === sourceHead
    && lineage.baseSha === baseSha
    && lineage.liveMainBeforeSha === baseSha
    && lineage.liveMainAfterSha === baseSha
    && parents.includes(baseSha)
    && lineage?.comparison?.status === 'ahead'
    && Number.isSafeInteger(lineage?.comparison?.aheadBy)
    && lineage.comparison.aheadBy > 0
    && lineage.comparison.behindBy === 0
    && lineage.comparison.baseCommitSha === baseSha
    && lineage.comparison.mergeBaseCommitSha === baseSha;
}

function exactMailboxRolloverSource(source, path, sourceHead) {
  const content = typeof source?.content === 'string' ? source.content : '';
  const bytes = Buffer.byteLength(content, 'utf8');
  const expectedBlobSha = MAILBOX_ROLLOVER_BLOB_SHA_BY_PATH[path];
  return Boolean(source && typeof source === 'object' && !Array.isArray(source)
    && source.schemaVersion === WINDOWS_AUTHORITY_SOURCE_SCHEMA
    && source.repository === REPOSITORY
    && source.path === path
    && source.ref === sourceHead
    && source.exists === true
    && Number.isSafeInteger(source.size)
    && source.size === bytes
    && bytes > 0
    && bytes <= MAX_SOURCE_BYTES
    && SHA40.test(text(source.blobSha))
    && source.blobSha === gitBlobSha(content)
    && source.blobSha === expectedBlobSha);
}

function requirePattern(findings, source, pattern, code, summary, path) {
  if (!pattern.test(source)) findings.push(mailboxRolloverFinding(code, summary, path));
}

function forbidPattern(findings, source, pattern, code, summary, path) {
  if (pattern.test(source)) findings.push(mailboxRolloverFinding(code, summary, path));
}

function inspectMailboxInstaller(source) {
  const path = WINDOWS_AUTHORITY_MAILBOX_ROLLOVER_PATHS_V1[0];
  const findings = [];
  requirePattern(findings, source, /param\(\s*\[switch\]\$StartNow\s*\)/i, 'mailbox-rollover-installer-parameter-surface-widened', 'Installer may accept only the optional StartNow switch.', path);
  requirePattern(findings, source, /\$taskName\s*=\s*'Stephanos Battle Bridge GitHub Command Mailbox'/, 'mailbox-rollover-installer-task-not-fixed', 'Installer must remain bound to the fixed command mailbox Scheduled Task.', path);
  requirePattern(findings, source, /\$expectedRepoRoot\s*=\s*Join-Path\s+\$env:USERPROFILE\s+'Documents\\GitHub\\stephan-os'/i, 'mailbox-rollover-installer-repo-not-fixed', 'Installer must remain bound to the canonical checkout.', path);
  requirePattern(findings, source, /\$wscriptExe\s*=\s*Join-Path\s+\$env:SystemRoot\s+'System32\\wscript\.exe'/i, 'mailbox-rollover-installer-host-not-fixed', 'Installer must use the canonical Windows Script Host executable.', path);
  requirePattern(findings, source, /github-command-mailbox/, 'mailbox-rollover-installer-launch-route-missing', 'Installer must launch only the canonical GitHub command mailbox route.', path);
  requirePattern(findings, source, /New-ScheduledTaskPrincipal\s+-UserId\s+\$currentUser\s+-LogonType\s+Interactive\s+-RunLevel\s+Limited/i, 'mailbox-rollover-installer-principal-widened', 'Installer must remain interactive and limited privilege.', path);
  requirePattern(findings, source, /-MultipleInstances\s+IgnoreNew/i, 'mailbox-rollover-installer-overlap-guard-missing', 'Installer must keep IgnoreNew overlap protection.', path);
  requirePattern(findings, source, /-ExecutionTimeLimit\s+\(New-TimeSpan\s+-Minutes\s+15\)/i, 'mailbox-rollover-installer-time-bound-missing', 'Installer must keep the fixed fifteen-minute execution limit.', path);
  requirePattern(findings, source, /-RepetitionInterval\s+\(New-TimeSpan\s+-Minutes\s+1\)/i, 'mailbox-rollover-installer-primary-cadence-missing', 'Installer must retain one-minute primary polling.', path);
  requirePattern(findings, source, /-RepetitionInterval\s+\(New-TimeSpan\s+-Minutes\s+5\)/i, 'mailbox-rollover-installer-compat-cadence-missing', 'Installer must retain the five-minute compatibility trigger.', path);
  requirePattern(findings, source, /Start-ScheduledTask\s+-TaskName\s+\$taskName/i, 'mailbox-rollover-installer-start-not-fixed', 'Optional immediate start must target only the fixed mailbox task.', path);
  forbidPattern(findings, source, /Invoke-Expression|\biex\b|\bStart-Process\b|\bStop-Process\b|\btaskkill(?:\.exe)?\b|cmd(?:\.exe)?\s+\/c|powershell(?:\.exe)?\s+-command|\bgh(?:\.exe)?\b|\bgit(?:\.exe)?\b/i, 'mailbox-rollover-installer-generic-execution-forbidden', 'Installer may not gain generic shell, process or source-control execution authority.', path);
  return findings;
}

function inspectMailboxRecoveryRequest(source) {
  const path = WINDOWS_AUTHORITY_MAILBOX_ROLLOVER_PATHS_V1[1];
  const findings = [];
  const parameterArea = source.slice(0, Math.max(0, source.indexOf('$ErrorActionPreference')));
  requirePattern(findings, parameterArea, /ValidateSet\('GITHUB_MAILBOX','TAILSCALE_CONTROL','OPENCLAW_WHATSAPP','AUTHENTICATED_BREAK_GLASS'\)/i, 'mailbox-rollover-recovery-route-allowlist-missing', 'Recovery request must retain the four-route closed allowlist.', path);
  forbidPattern(findings, parameterArea, /\$(?:TaskName|TaskPath|Executable|CommandLine|ProcessPath)\b/i, 'mailbox-rollover-recovery-caller-authority-forbidden', 'Recovery request may not accept caller-selected task, executable or process authority.', path);
  requirePattern(findings, source, /\$taskName\s*=\s*'Stephanos Battle Bridge Recovery Mesh'/, 'mailbox-rollover-recovery-task-not-fixed', 'Recovery request must remain bound to the fixed recovery mesh task.', path);
  requirePattern(findings, source, /\$repoRoot\s*=\s*\[System\.IO\.Path\]::GetFullPath\(\(Join-Path\s+\$env:USERPROFILE\s+'Documents\\GitHub\\stephan-os'\)\)/i, 'mailbox-rollover-recovery-repo-not-fixed', 'Recovery request must remain bound to the canonical checkout.', path);
  requirePattern(findings, source, /\$wscriptPath\s*=\s*'C:\\Windows\\System32\\wscript\.exe'/i, 'mailbox-rollover-recovery-host-not-fixed', 'Recovery request must verify the canonical Windows Script Host path.', path);
  requirePattern(findings, source, /canonicalMailboxAuthorityV1\.mjs/i, 'mailbox-rollover-recovery-authority-source-missing', 'Recovery request must derive mailbox authority from the canonical source-controlled contract.', path);
  requirePattern(findings, source, /Assert-NoReparseAncestor/i, 'mailbox-rollover-recovery-reparse-guard-missing', 'Recovery request must retain reparse-ancestor rejection.', path);
  requirePattern(findings, source, /Assert-StablePathBaseline/i, 'mailbox-rollover-recovery-path-identity-guard-missing', 'Recovery request must retain path identity revalidation.', path);
  requirePattern(findings, source, /\$sourceControlExecutable\s*=\s*'C:\\Program Files\\Git\\cmd\\git\.exe'/i, 'mailbox-rollover-recovery-git-not-fixed', 'Recovery request may use only the canonical Git executable for source-head observation.', path);
  requirePattern(findings, source, /&\s*\$sourceControlExecutable\s+-C\s+\$repoRoot\s+rev-parse\s+HEAD/i, 'mailbox-rollover-recovery-head-observation-missing', 'Recovery request must observe only the current checkout head.', path);
  const gitInvocations = source.match(/&\s*\$sourceControlExecutable\b/g) || [];
  if (gitInvocations.length !== 1) findings.push(mailboxRolloverFinding('mailbox-rollover-recovery-git-surface-widened', 'Canonical Git may be invoked exactly once and only for rev-parse HEAD.', path));
  requirePattern(findings, source, /operation\s+-ne\s+'WAKE_BATTLE_BRIDGE_RECOVERY_MESH'/i, 'mailbox-rollover-recovery-receipt-operation-check-missing', 'Mailbox evidence must remain bound to the wake-recovery operation.', path);
  requirePattern(findings, source, /issueNumber\s+-ne\s+\$canonicalMailboxIssue/i, 'mailbox-rollover-recovery-mailbox-identity-check-missing', 'Mailbox evidence must remain bound to the canonical mailbox issue.', path);
  requirePattern(findings, source, /expectedHead[\s\S]{0,500}\$currentSourceHead\.Trim\(\)/i, 'mailbox-rollover-recovery-head-binding-missing', 'Mailbox evidence must remain bound to the current source head.', path);
  requirePattern(findings, source, /\$expectedArguments\s*=\s*"\/\/B \/\/NoLogo `"\$launcherPath`" recovery-mesh"/i, 'mailbox-rollover-recovery-task-arguments-not-fixed', 'Installed task arguments must remain bound to the recovery-mesh launcher route.', path);
  requirePattern(findings, source, /Principal\.RunLevel\s+-ne\s+'Limited'/i, 'mailbox-rollover-recovery-principal-check-missing', 'Recovery request must reject a non-limited task principal.', path);
  requirePattern(findings, source, /ExecutionTimeLimit\s+-ne\s+'PT3M'/i, 'mailbox-rollover-recovery-runtime-bound-missing', 'Recovery request must reject tasks without the fixed three-minute bound.', path);
  requirePattern(findings, source, /Write-ExclusiveUtf8Json\s+-Path\s+\$temporaryPath\s+-Value\s+\$request/i, 'mailbox-rollover-recovery-exclusive-request-write-missing', 'Recovery requests must retain exclusive bounded JSON publication.', path);
  requirePattern(findings, source, /Start-ScheduledTask\s+-TaskName\s+\$taskName/i, 'mailbox-rollover-recovery-start-not-fixed', 'Recovery request may start only the fixed recovery mesh task.', path);
  requirePattern(findings, source, /arbitraryShellAllowed\s*=\s*\$false/i, 'mailbox-rollover-recovery-shell-denial-missing', 'Recovery request must continue to deny arbitrary shell authority.', path);
  requirePattern(findings, source, /sourceMutationAllowed\s*=\s*\$false/i, 'mailbox-rollover-recovery-source-mutation-denial-missing', 'Recovery request must continue to deny source mutation authority.', path);
  forbidPattern(findings, source, /Invoke-Expression|\biex\b|\bStart-Process\b|\bStop-Process\b|\btaskkill(?:\.exe)?\b|cmd(?:\.exe)?\s+\/c|powershell(?:\.exe)?\s+-command/i, 'mailbox-rollover-recovery-generic-execution-forbidden', 'Recovery request may not gain generic shell or process authority.', path);
  return findings;
}

function analyzeMailboxRolloverReview(input = {}) {
  const sourceHead = text(input.sourceHead).toLowerCase();
  const baseSha = text(input.baseSha).toLowerCase();
  const eligible = input.repository === REPOSITORY
    && Number(input.prNumber) === MAILBOX_ROLLOVER_PR_NUMBER
    && text(input.branch) === MAILBOX_ROLLOVER_BRANCH
    && SHA40.test(sourceHead)
    && SHA40.test(baseSha)
    && exactMailboxRolloverEscalation(input.analysis);
  if (!eligible) return Object.freeze({
    schemaVersion: MAILBOX_ROLLOVER_SCHEMA,
    eligible: false,
    clean: false,
    reviewedPaths: Object.freeze([]),
    findings: Object.freeze([]),
    proofRefs: Object.freeze([]),
    finalVerdict: 'WINDOWS_AUTHORITY_MAILBOX_ROLLOVER_NOT_APPLICABLE',
  });

  const findings = [];
  if (!exactMailboxRolloverLineage(input.lineageEvidence, sourceHead, baseSha)) {
    findings.push(mailboxRolloverFinding('mailbox-rollover-current-main-lineage-invalid', 'Review requires fresh exact-current-main ahead-only lineage.', WINDOWS_AUTHORITY_MAILBOX_ROLLOVER_PATHS_V1[0]));
  }
  const sources = Array.isArray(input.sources) ? input.sources : [];
  const byPath = new Map(sources.map((source) => [text(source?.path), source]));
  if (sources.length !== WINDOWS_AUTHORITY_MAILBOX_ROLLOVER_PATHS_V1.length || byPath.size !== WINDOWS_AUTHORITY_MAILBOX_ROLLOVER_PATHS_V1.length) {
    findings.push(mailboxRolloverFinding('mailbox-rollover-source-inventory-invalid', 'Review requires exactly the two canonical escalated Windows source files.', WINDOWS_AUTHORITY_MAILBOX_ROLLOVER_PATHS_V1[0]));
  }
  for (const path of WINDOWS_AUTHORITY_MAILBOX_ROLLOVER_PATHS_V1) {
    const source = byPath.get(path);
    if (!exactMailboxRolloverSource(source, path, sourceHead)) {
      findings.push(mailboxRolloverFinding('mailbox-rollover-exact-source-not-pinned', `Review requires the exact pinned source blob for ${path}.`, path));
      continue;
    }
    if (path === WINDOWS_AUTHORITY_MAILBOX_ROLLOVER_PATHS_V1[0]) findings.push(...inspectMailboxInstaller(source.content));
    else findings.push(...inspectMailboxRecoveryRequest(source.content));
  }
  const clean = findings.length === 0;
  return Object.freeze({
    schemaVersion: MAILBOX_ROLLOVER_SCHEMA,
    eligible: true,
    clean,
    reviewedPaths: WINDOWS_AUTHORITY_MAILBOX_ROLLOVER_PATHS_V1,
    findings: Object.freeze(findings),
    proofRefs: clean ? Object.freeze([
      `proofs/windows-authority/mailbox-rollover/pr-${MAILBOX_ROLLOVER_PR_NUMBER}`,
      ...WINDOWS_AUTHORITY_MAILBOX_ROLLOVER_PATHS_V1.map((path) => `proofs/windows-authority/mailbox-rollover/${path}#${MAILBOX_ROLLOVER_BLOB_SHA_BY_PATH[path]}`),
      'proofs/windows-authority/mailbox-rollover/current-main-ahead-only-lineage',
      'proofs/windows-authority/mailbox-rollover/no-generic-shell-source-or-process-authority',
    ]) : Object.freeze([]),
    sourceMutationAllowed: false,
    mergeAuthority: false,
    runtimeMutationAllowed: false,
    providerQualificationAuthority: false,
    finalVerdict: clean ? 'WINDOWS_AUTHORITY_MAILBOX_ROLLOVER_CLEAN' : 'WINDOWS_AUTHORITY_MAILBOX_ROLLOVER_FINDINGS',
  });
}

const baseModule = provePinnedModule(BASE_PATH, BASE_BLOB_SHA);
const wsl2Module = provePinnedModule(WSL2_PATH, WSL2_BLOB_SHA);
const starfieldVrSplashModule = provePinnedModule(STARFIELD_VR_SPLASH_PATH, STARFIELD_VR_SPLASH_BLOB_SHA);
const mailboxCadenceModule = provePinnedModule(MAILBOX_CADENCE_PATH, MAILBOX_CADENCE_BLOB_SHA);
provePinnedModule(IGNITION_CONVERGENCE_PATH, IGNITION_CONVERGENCE_BLOB_SHA);
provePinnedModule(MISSION_WORKER_CLEANUP_PATH, MISSION_WORKER_CLEANUP_BLOB_SHA);
proveLegacyRoutingInvariants(baseModule.content);
const base = await import(baseModule.url.href);
const wsl2 = await import(wsl2Module.url.href);
const starfieldVrSplash = await import(starfieldVrSplashModule.url.href);
const mailboxCadence = await import(mailboxCadenceModule.url.href);

export * from './windowsAuthoritySpecialistReviewV1Base.mjs';
export const WINDOWS_AUTHORITY_FORGE_WSL2_PREREQUISITE_PATHS_V1 = wsl2.WINDOWS_AUTHORITY_FORGE_WSL2_PREREQUISITE_PATHS_V1;
export const WINDOWS_AUTHORITY_STARFIELD_VR_SPLASH_PATHS_V1 = starfieldVrSplash.WINDOWS_AUTHORITY_STARFIELD_VR_SPLASH_PATHS_V1;

export function analyzeWindowsAuthoritySpecialistReview(input = {}) {
  const mailboxRolloverResult = analyzeMailboxRolloverReview(input);
  if (mailboxRolloverResult.eligible) return mailboxRolloverResult;
  const wsl2Result = wsl2.analyzeWindowsAuthorityForgeWsl2PrerequisiteReview(input);
  if (wsl2Result.eligible) return wsl2Result;
  const starfieldVrSplashResult = starfieldVrSplash.analyzeWindowsAuthorityStarfieldVrSplashReviewV1(input);
  if (starfieldVrSplashResult.eligible) return starfieldVrSplashResult;
  const mailboxCadenceResult = mailboxCadence.analyzeWindowsAuthorityMailboxCadenceReviewV1(input);
  if (mailboxCadenceResult.eligible) return mailboxCadenceResult;
  return base.analyzeWindowsAuthoritySpecialistReview(input);
}
