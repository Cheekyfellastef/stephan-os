#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BATTLE_BRIDGE_WINDOWS_HOST } from '../shared/agents/battleBridgeWindowsHosts.mjs';
import { buildBattleBridgeTelemetryAutorepairProjection } from '../shared/agents/battleBridgeTelemetryAutorepairV1.mjs';
import { resolveSharedWorkspacePath } from '../shared/agents/sharedAgentWorkspaceStore.mjs';
import { projectBoundedMissionWorkerRestartBlocker } from './battle-bridge-worker-watchdog-acceptance.mjs';
import * as core from './battle-bridge-outbound-health-beacon-core.mjs';

export * from './battle-bridge-outbound-health-beacon-core.mjs';

export const BATTLE_BRIDGE_COMPLETE_STATE_STATUS_FILE = 'battle-bridge-complete-state-current.json';
export const BATTLE_BRIDGE_COMPLETE_STATE_MIRROR_ROLE = 'battle-bridge-complete-state-projection';

const SHA40 = /^[0-9a-f]{40}$/;
const MAX_STATUS_BYTES = 64 * 1024;
const MAX_GITHUB_BYTES = 512 * 1024;
const WORKER_WATCHDOG_SPEC = Object.freeze({
  id: 'workerWatchdog',
  path: 'status/battle-bridge-worker-watchdog-current.json',
  staleAfterMs: 180_000,
});
const WORKER_WATCHDOG_CLASSIFICATIONS = new Set([
  'WORKER_WATCHDOG_HEALTHY',
  'WORKER_WATCHDOG_RECOVERED',
  'WORKER_WATCHDOG_RECOVERY_FAILED',
  'WORKER_WATCHDOG_RECOVERY_COOLDOWN',
  'WORKER_WATCHDOG_BLOCKED',
  'WORKER_WATCHDOG_PROBE_FAILED',
  'WORKER_WATCHDOG_START_FAILED',
  'WORKER_WATCHDOG_LIVE_LOCK',
]);
const WORKER_WATCHDOG_SUCCESS_CLASSIFICATIONS = new Set([
  'WORKER_WATCHDOG_HEALTHY',
  'WORKER_WATCHDOG_RECOVERED',
]);
const WATCHDOG_RESTART_VERDICTS = new Set([
  'APPROVED_RUNTIME_RESTART_PASS',
  'APPROVED_RUNTIME_RESTART_BLOCKED',
]);

function text(value, limit = 180) {
  const normalized = String(value ?? '').trim();
  return normalized.length > limit ? normalized.slice(0, limit) : normalized;
}

function validHead(value) {
  const normalized = text(value, 40).toLowerCase();
  return SHA40.test(normalized) ? normalized : '';
}

function numericCount(value) {
  const count = Number(value);
  return Number.isInteger(count) && count >= 0 ? count : null;
}

function readJsonBounded(path) {
  if (!existsSync(path)) return null;
  try {
    const source = readFileSync(path, 'utf8');
    if (Buffer.byteLength(source, 'utf8') > MAX_STATUS_BYTES) return null;
    const parsed = JSON.parse(source);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function safeWatchdogClassification(value) {
  const classification = text(value, 120).toUpperCase();
  return WORKER_WATCHDOG_CLASSIFICATIONS.has(classification) ? classification : 'UNKNOWN';
}

function safeWatchdogRestartVerdict(value) {
  const verdict = text(value, 120).toUpperCase();
  return WATCHDOG_RESTART_VERDICTS.has(verdict) ? verdict : '';
}

export function projectWorkerWatchdogBeaconFacts(record = {}, expectedHead = '') {
  const classification = safeWatchdogClassification(record.classification || record.status);
  const restartBlocker = projectBoundedMissionWorkerRestartBlocker(record.restartBlocker);
  const expected = validHead(expectedHead);
  const initial = record.initialAssessment && typeof record.initialAssessment === 'object' && !Array.isArray(record.initialAssessment)
    ? record.initialAssessment
    : {};
  const final = record.finalAssessment && typeof record.finalAssessment === 'object' && !Array.isArray(record.finalAssessment)
    ? record.finalAssessment
    : {};
  const sourceHead = validHead(record.restartSourceHead || final.sourceHead || initial.canonicalRepositoryHead);
  const heartbeatAgeMs = numericCount(final.heartbeatAgeMs ?? initial.heartbeatAgeMs);
  const exactHeadMatch = Boolean(expected && sourceHead && expected === sourceHead);
  let exactNextAction = 'READ_WATCHDOG_FAILURE_BOUNDARY';
  if (restartBlocker) exactNextAction = 'REPAIR_TYPED_MISSION_WORKER_RESTART_BLOCKER';
  else if (WORKER_WATCHDOG_SUCCESS_CLASSIFICATIONS.has(classification) && exactHeadMatch) {
    exactNextAction = 'VERIFY_MISSION_WORKER_HEARTBEAT_AND_BUILD_EXECUTION';
  } else if (classification === 'WORKER_WATCHDOG_RECOVERY_COOLDOWN') {
    exactNextAction = 'WAIT_FOR_EXISTING_WATCHDOG_RESTART_COOLDOWN';
  } else if (classification === 'UNKNOWN') {
    exactNextAction = 'READ_ONLY_WATCHDOG_STATUS_REPAIR';
  }
  return Object.freeze({
    classification,
    restartBlocker,
    restartVerdict: safeWatchdogRestartVerdict(record.restartVerdict),
    sourceHead,
    expectedHead: expected,
    exactHeadMatch,
    restartAttempted: record.restartAttempted === true,
    restartExactHeadProofOk: record.restartExactHeadProofOk === true,
    restartProofFresh: record.restartProofFresh === true,
    taskActionMatchesCanonicalWorker: initial.taskActionMatchesCanonicalWorker === true,
    processHealthy: final.processHealthy === true,
    processLaunchIdentityVerified: final.processLaunchIdentityVerified === true,
    heartbeatFresh: final.heartbeatFresh === true,
    heartbeatAgeMs,
    supervisorDetectedWorkerDown: record.supervisorDetectedWorkerDown === true,
    supervisorRestartedWorker: record.supervisorRestartedWorker === true,
    workerRecovered: record.workerRecovered === true,
    workerFromMain: record.workerFromMain === true,
    exactNextAction,
    arbitraryPathPublished: false,
    arbitraryCommandLinePublished: false,
    rawErrorPublished: false,
  });
}

export function projectBeaconStatus(record, spec, nowMs = Date.now(), expectedHead = '') {
  if (spec?.id !== 'workerWatchdog' || !record || !validHead(expectedHead)) {
    return core.projectBeaconStatus(record, spec, nowMs, expectedHead);
  }
  const base = core.projectBeaconStatus(record, spec, nowMs, expectedHead);
  const workerWatchdogFacts = projectWorkerWatchdogBeaconFacts(record, expectedHead);
  const watchdogBlocker = workerWatchdogFacts.restartBlocker
    || (!WORKER_WATCHDOG_SUCCESS_CLASSIFICATIONS.has(workerWatchdogFacts.classification)
      && workerWatchdogFacts.classification !== 'UNKNOWN'
      ? workerWatchdogFacts.classification
      : base.blocker);
  return Object.freeze({
    id: spec.id,
    state: base.state === 'STALE' ? 'STALE' : workerWatchdogFacts.classification,
    rawState: workerWatchdogFacts.classification,
    observedAtUtc: base.observedAtUtc,
    ageMs: base.ageMs,
    head: workerWatchdogFacts.sourceHead,
    blocker: watchdogBlocker,
    serviceFacts: Object.freeze({}),
    dirtFacts: Object.freeze({ known: false, blocksSync: false, blockingCount: 0 }),
    housekeeperFacts: Object.freeze({ observed: false, state: 'UNPROVEN', observedAtUtc: '', head: '', blocker: '' }),
    runtimeHeads: Object.freeze({ builtHead: '', servedHead: '', runtimeHead: '' }),
    workerWatchdogFacts,
  });
}

function augmentRecordWithWorkerWatchdog(record, workerWatchdogRecord, qualifiedRepairPolicies = []) {
  const nowMs = Date.parse(String(record?.observedAtUtc || ''));
  const workerSurface = projectBeaconStatus(
    workerWatchdogRecord,
    WORKER_WATCHDOG_SPEC,
    Number.isFinite(nowMs) ? nowMs : Date.now(),
    record?.sourceHead || '',
  );
  const existing = Array.isArray(record?.surfaces)
    ? record.surfaces.filter((surface) => surface?.id !== 'workerWatchdog')
    : [];
  const missionIndex = existing.findIndex((surface) => surface?.id === 'missionWorker');
  const surfaces = missionIndex >= 0
    ? [...existing.slice(0, missionIndex), workerSurface, ...existing.slice(missionIndex)]
    : [...existing, workerSurface];
  const telemetry = buildBattleBridgeTelemetryAutorepairProjection({
    sourceHead: record.sourceHead,
    surfaces,
    qualifiedRepairPolicies,
  });
  const blockers = telemetry.repairCandidates
    .map((candidate) => `${candidate.surfaceId}:${candidate.blocker || candidate.gapClass}`)
    .slice(0, 12);
  return Object.freeze({
    ...record,
    surfaces: Object.freeze(surfaces),
    blockerCount: blockers.length,
    blockers: Object.freeze(blockers),
    freshness: blockers.length > 0 ? 'DEGRADED' : 'FRESH',
    completeStateAnswerable: telemetry.completeStateAnswerable,
    telemetryCompleteness: telemetry.telemetryCompleteness,
    operatorNeeded: telemetry.operatorNeededNow,
    operatorAuthorizationState: telemetry.operatorAuthorizationState,
    nextAutomaticAction: telemetry.nextAutomaticAction,
    telemetry,
  });
}

export function buildBattleBridgeOutboundBeacon(args = {}) {
  const base = core.buildBattleBridgeOutboundBeacon(args);
  return augmentRecordWithWorkerWatchdog(
    base,
    args.statusRecords?.workerWatchdog || null,
    args.qualifiedRepairPolicies || [],
  );
}

function digestRecord(record) {
  return createHash('sha256').update(JSON.stringify(record)).digest('hex');
}

function assertMirrorRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('BATTLE_BRIDGE_COMPLETE_STATE_RECORD_INVALID');
  if (record.schemaVersion !== core.BATTLE_BRIDGE_OUTBOUND_BEACON_SCHEMA) throw new Error('BATTLE_BRIDGE_COMPLETE_STATE_SCHEMA_INVALID');
  if (record.repository !== core.BATTLE_BRIDGE_OUTBOUND_BEACON_REPOSITORY) throw new Error('BATTLE_BRIDGE_COMPLETE_STATE_REPOSITORY_INVALID');
  if (record.issueNumber !== core.BATTLE_BRIDGE_OUTBOUND_BEACON_ISSUE) throw new Error('BATTLE_BRIDGE_COMPLETE_STATE_ISSUE_INVALID');
  if (record.branch !== 'main' || !validHead(record.sourceHead)) throw new Error('BATTLE_BRIDGE_COMPLETE_STATE_SOURCE_IDENTITY_INVALID');
  if (!Number.isFinite(Date.parse(text(record.observedAtUtc)))) throw new Error('BATTLE_BRIDGE_COMPLETE_STATE_TIMESTAMP_INVALID');
  if (record.readOnly !== true
      || record.sourceMutationAllowed !== false
      || record.taskMutationAllowed !== false
      || record.processRestartAllowed !== false
      || record.arbitraryShellAllowed !== false
      || record.destructiveGitAllowed !== false
      || record.liveOpenClawUpdateAllowed !== false
      || record.pcRestartAllowed !== false) {
    throw new Error('BATTLE_BRIDGE_COMPLETE_STATE_AUTHORITY_INVALID');
  }
  return record;
}

export function mirrorBattleBridgeCompleteStateToSharedWorkspace({ workspaceRoot, repoRoot, record } = {}) {
  const validated = assertMirrorRecord(record);
  const resolved = resolveSharedWorkspacePath({
    root: workspaceRoot,
    repoRoot,
    segments: ['status', BATTLE_BRIDGE_COMPLETE_STATE_STATUS_FILE],
  });
  if (!resolved.ok) throw new Error(`BATTLE_BRIDGE_COMPLETE_STATE_MIRROR_${resolved.reason}`);

  mkdirSync(dirname(resolved.path), { recursive: true });
  const tempPath = `${resolved.path}.${process.pid}.${randomUUID()}.tmp`;
  const payload = `${JSON.stringify(validated, null, 2)}\n`;
  try {
    writeFileSync(tempPath, payload, { flag: 'wx', mode: 0o600 });
    renameSync(tempPath, resolved.path);
  } catch (error) {
    try { unlinkSync(tempPath); } catch {}
    throw error;
  }

  return Object.freeze({
    ok: true,
    state: 'SHARED_WORKSPACE_COMPLETE_STATE_MIRRORED',
    fileName: BATTLE_BRIDGE_COMPLETE_STATE_STATUS_FILE,
    schemaVersion: validated.schemaVersion,
    sourceHead: validated.sourceHead,
    observedAtUtc: validated.observedAtUtc,
    recordSha256: digestRecord(validated),
  });
}

export function compareBattleBridgeCompleteStateMirrors(githubRecord, sharedWorkspaceRecord) {
  if (!githubRecord || typeof githubRecord !== 'object' || Array.isArray(githubRecord)
      || !sharedWorkspaceRecord || typeof sharedWorkspaceRecord !== 'object' || Array.isArray(sharedWorkspaceRecord)) {
    return Object.freeze({ state: 'UNPROVEN', consistent: false, mismatches: Object.freeze(['record-missing']) });
  }

  const invalidRecords = [];
  try {
    assertMirrorRecord(githubRecord);
  } catch {
    invalidRecords.push('github-record-invalid');
  }
  try {
    assertMirrorRecord(sharedWorkspaceRecord);
  } catch {
    invalidRecords.push('shared-workspace-record-invalid');
  }
  if (invalidRecords.length > 0) {
    return Object.freeze({
      state: 'UNPROVEN',
      consistent: false,
      mismatches: Object.freeze(invalidRecords),
    });
  }

  const fields = [
    'schemaVersion',
    'repository',
    'issueNumber',
    'observedAtUtc',
    'sourceHead',
    'branch',
    'freshness',
    'completeStateAnswerable',
    'telemetryCompleteness',
    'operatorNeeded',
    'nextAutomaticAction',
  ];
  const mismatches = fields.filter((field) => JSON.stringify(githubRecord[field]) !== JSON.stringify(sharedWorkspaceRecord[field]));
  const githubDigest = digestRecord(githubRecord);
  const sharedWorkspaceDigest = digestRecord(sharedWorkspaceRecord);
  if (githubDigest !== sharedWorkspaceDigest && mismatches.length === 0) mismatches.push('record-digest');
  return Object.freeze({
    state: mismatches.length === 0 ? 'CONSISTENT' : 'CONFLICTING',
    consistent: mismatches.length === 0,
    sourceHead: validHead(githubRecord.sourceHead) || validHead(sharedWorkspaceRecord.sourceHead),
    observedAtUtc: text(githubRecord.observedAtUtc || sharedWorkspaceRecord.observedAtUtc),
    githubRecordSha256: githubDigest,
    sharedWorkspaceRecordSha256: sharedWorkspaceDigest,
    mismatches: Object.freeze(mismatches),
  });
}

function runFixed(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: options.timeout || 60_000,
    maxBuffer: MAX_GITHUB_BYTES,
  });
  return Object.freeze({
    ok: !result.error && result.status === 0,
    status: result.status ?? null,
    stdout: String(result.stdout || ''),
    stderr: text(result.stderr || result.error?.message || '', 500),
  });
}

function existingBeaconCommentId(repoRoot) {
  const response = runFixed(BATTLE_BRIDGE_WINDOWS_HOST.githubCli, [
    'api',
    `repos/${core.BATTLE_BRIDGE_OUTBOUND_BEACON_REPOSITORY}/issues/${core.BATTLE_BRIDGE_OUTBOUND_BEACON_ISSUE}/comments?per_page=100`,
    '--paginate',
    '--slurp',
  ], { cwd: repoRoot, timeout: 120_000 });
  if (!response.ok) throw new Error('OUTBOUND_BEACON_GITHUB_READ_FAILED');
  let pages;
  try { pages = JSON.parse(response.stdout); } catch { throw new Error('OUTBOUND_BEACON_GITHUB_JSON_INVALID'); }
  const comments = Array.isArray(pages) ? pages.flat().filter((value) => value && typeof value === 'object') : [];
  const matches = comments.filter((comment) => String(comment.body || '').includes(core.BATTLE_BRIDGE_OUTBOUND_BEACON_MARKER));
  const id = Number(matches.at(-1)?.id || 0);
  return Number.isSafeInteger(id) && id > 0 ? id : 0;
}

function publishBeacon(repoRoot, body) {
  const existingId = existingBeaconCommentId(repoRoot);
  const args = existingId
    ? ['api', '-X', 'PATCH', `repos/${core.BATTLE_BRIDGE_OUTBOUND_BEACON_REPOSITORY}/issues/comments/${existingId}`, '-f', `body=${body}`]
    : ['api', '-X', 'POST', `repos/${core.BATTLE_BRIDGE_OUTBOUND_BEACON_REPOSITORY}/issues/${core.BATTLE_BRIDGE_OUTBOUND_BEACON_ISSUE}/comments`, '-f', `body=${body}`];
  const result = runFixed(BATTLE_BRIDGE_WINDOWS_HOST.githubCli, args, { cwd: repoRoot, timeout: 120_000 });
  if (!result.ok) throw new Error('OUTBOUND_BEACON_GITHUB_PUBLISH_FAILED');
  return existingId ? 'UPDATED' : 'CREATED';
}

export function runBattleBridgeOutboundHealthBeacon(options = {}) {
  const requestedPublish = typeof options.publish === 'function' ? options.publish : publishBeacon;
  const coreResult = core.runBattleBridgeOutboundHealthBeacon({
    ...options,
    publish: () => 'CAPTURED_FOR_WATCHDOG_AUGMENTATION',
  });
  const env = options.env || process.env;
  const repoRoot = resolve(env.USERPROFILE || homedir(), 'Documents', 'GitHub', 'stephan-os');
  const workspaceRoot = resolve(env.STEPHANOS_SHARED_AGENT_WORKSPACE || join(env.USERPROFILE || homedir(), 'Documents', 'Stephanos-openclaw-workspace'));
  const workerWatchdogRecord = readJsonBounded(join(workspaceRoot, ...WORKER_WATCHDOG_SPEC.path.split('/')));
  const record = augmentRecordWithWorkerWatchdog(coreResult.record, workerWatchdogRecord);
  const publication = requestedPublish(repoRoot, core.buildBattleBridgeOutboundBeaconBody(record));
  const mirror = typeof options.mirror === 'function' ? options.mirror : mirrorBattleBridgeCompleteStateToSharedWorkspace;
  const workspaceMirror = mirror({ workspaceRoot, repoRoot, record });
  return Object.freeze({ ...coreResult, publication, record, workspaceMirror });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = runBattleBridgeOutboundHealthBeacon();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${text(error?.message || error, 200)}\n`);
    process.exitCode = 1;
  }
}
