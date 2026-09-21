#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { ensureBattleBridgeGitHubCommandMailbox } from '../shared/agents/battleBridgeGitHubCommandMailboxBootstrap.mjs';
import { BATTLE_BRIDGE_WINDOWS_HOST } from '../shared/agents/battleBridgeWindowsHosts.mjs';
import { runDurableFlywheelStartupCycle } from '../shared/agents/durableFlywheelControllerVNext.mjs';
import {
  createSharedWorkspaceGoalRecord,
  createSharedWorkspaceStatusRecord,
  resolveSharedWorkspacePath,
  validateSharedWorkspaceRecord,
  writeAtomicJson,
} from '../shared/agents/sharedAgentWorkspaceStore.mjs';
import {
  fetchGithubGoalIssues,
  resolveGithubTokenConfig,
} from '../stephanos-server/services/githubPrEvidenceService.js';
import { readMissionControllerCapacityRoutingInput } from '../stephanos-server/services/programmeAuthorityService.js';
import { classifyDirt } from './battle-bridge-github-sync-policy.mjs';
import { readMissionWorkerActiveClaim } from './mission-orchestrator-worker-heartbeat-active-claim.mjs';
import { runMissionWorkerTick } from './mission-orchestrator-worker.mjs';
import { writeMissionWorkerHeartbeat } from './mission-orchestrator-worker-heartbeat.mjs';

export const MISSION_WORKER_LOG_PROJECTION_SCHEMA = 'stephanos.mission-worker-log-projection.v1';
export const MISSION_WORKER_CANONICAL_RELOAD_EXIT_CODE = 75;
export const MISSION_WORKER_LOG_MAX_BYTES = 1_024;
export const MISSION_WORKER_ACTIVE_CLAIM_PROBE_INTERVAL_MS = 10;
export const MISSION_WORKER_GOAL_ESTATE_REFRESH_INTERVAL_MS = 120_000;
export const MISSION_WORKER_GOAL_ESTATE_ADMISSION_SOURCE = 'github-goal-estate';

const SHA_40 = /^[0-9a-f]{40}$/;
const MAX_GIT_STATUS_BYTES = 64 * 1024;
const PROGRESS_RECHECK_INTERVAL_MS = 250;
const MAX_CONSECUTIVE_PROGRESS_RECHECKS = 8;
const CANONICAL_GOAL_REPOSITORY = 'Cheekyfellastef/stephan-os';
const GOAL_ESTATE_STATUS_ID = 'github-goal-estate-intake-current';
const GOAL_ESTATE_PARTICIPANT_ID = 'goal-building-agent';

function ownData(value, key) {
  if (!value || typeof value !== 'object') return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function boundedText(value, maximumEncodedBytes = 96) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  let encodedBytes = 0;
  let output = '';
  for (const character of normalized) {
    const encodedCharacter = JSON.stringify(character).slice(1, -1);
    const nextBytes = Buffer.byteLength(encodedCharacter);
    if (encodedBytes + nextBytes > maximumEncodedBytes) break;
    output += character;
    encodedBytes += nextBytes;
  }
  return output;
}

function boundedTextList(value, maximumItems = 4, maximumItemEncodedBytes = 48) {
  try {
    if (!Array.isArray(value)) return [];
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    const length = lengthDescriptor && Object.hasOwn(lengthDescriptor, 'value') ? lengthDescriptor.value : Number.NaN;
    if (!Number.isInteger(length) || length < 0 || length > maximumItems) return [];
    const output = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return [];
      const item = boundedText(descriptor.value, maximumItemEncodedBytes);
      if (item) output.push(item);
    }
    return output;
  } catch {
    return [];
  }
}

function positiveInteger(value) {
  const normalized = typeof value === 'number' ? String(value) : boundedText(String(value ?? ''), 16).replace(/^#/, '');
  if (!/^[1-9]\d*$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function goalPriorityFromLabels(labels = []) {
  const normalized = new Set((Array.isArray(labels) ? labels : []).map((label) => String(label).trim().toLowerCase()));
  if (normalized.has('priority-critical') || normalized.has('priority-urgent')) return 100;
  if (normalized.has('priority-high')) return 80;
  if (normalized.has('priority-medium')) return 50;
  if (normalized.has('priority-low')) return 20;
  return 0;
}

function githubGoalRecord(issue, timestampUtc) {
  const issueNumber = positiveInteger(issue?.issueNumber);
  if (!issueNumber) return null;
  const record = {
    ...createSharedWorkspaceGoalRecord({
      goalId: `goal-${issueNumber}`,
      participantId: GOAL_ESTATE_PARTICIPANT_ID,
      timestampUtc,
      title: boundedText(issue?.title, 240) || `Goal #${issueNumber}`,
      status: 'READY',
    }),
    issueNumber,
    repository: CANONICAL_GOAL_REPOSITORY,
    state: 'READY',
    route: 'CHATGPT_GITHUB',
    prerequisites: [],
    priority: goalPriorityFromLabels(issue?.labels),
    criticalPathWeight: 0,
    reversibility: 'UNKNOWN',
    approvalRequired: false,
    operatorPriority: false,
    proofState: 'DISCOVERED',
    evidenceAt: timestampUtc,
    resultProofRefs: [],
    admissionSource: MISSION_WORKER_GOAL_ESTATE_ADMISSION_SOURCE,
    sourceIssueUrl: boundedText(issue?.htmlUrl, 512),
  };
  const validation = validateSharedWorkspaceRecord(record, { nowMs: Date.parse(timestampUtc) });
  return validation.valid ? Object.freeze(record) : null;
}

function existingGoalIsRicher(record = {}) {
  if (record.admissionSource !== MISSION_WORKER_GOAL_ESTATE_ADMISSION_SOURCE) return true;
  if (positiveInteger(record.activePr) || boundedText(record.headSha, 40)) return true;
  if (record.operatorApprovalReceipt) return true;
  if (Array.isArray(record.resultProofRefs) && record.resultProofRefs.length > 0) return true;
  if (Array.isArray(record.prerequisites) && record.prerequisites.length > 0) return true;
  const state = boundedText(record.state ?? record.status, 48).toUpperCase();
  if (state && !['OPEN', 'QUEUED', 'READY'].includes(state)) return true;
  const proofState = boundedText(record.proofState, 48).toUpperCase();
  return Boolean(proofState && !['UNKNOWN', 'DISCOVERED'].includes(proofState));
}

async function publishGoalEstateStatus({ root, repoRoot, timestampUtc, status, summary, counts = {}, writeAtomicJsonFn = writeAtomicJson }) {
  const record = {
    ...createSharedWorkspaceStatusRecord({
      statusId: GOAL_ESTATE_STATUS_ID,
      participantId: GOAL_ESTATE_PARTICIPANT_ID,
      timestampUtc,
      status,
      summary,
    }),
    observedGoalCount: Number(counts.observed || 0),
    admittedGoalCount: Number(counts.admitted || 0),
    refreshedGoalCount: Number(counts.refreshed || 0),
    preservedGoalCount: Number(counts.preserved || 0),
    mergeAuthority: false,
    runtimeMutationAuthority: false,
    arbitraryShellAllowed: false,
  };
  return writeAtomicJsonFn(root, ['status', `${GOAL_ESTATE_STATUS_ID}.json`], record, {
    repoRoot,
    nowMs: Date.parse(timestampUtc),
  });
}

export async function refreshDurableGithubGoalEstate({
  env = process.env,
  nowUtc = new Date().toISOString(),
  resolveGithubAuth = resolveGithubTokenConfig,
  fetchGoals = fetchGithubGoalIssues,
  readFileFn = readFile,
  writeAtomicJsonFn = writeAtomicJson,
} = {}) {
  const root = boundedText(env.STEPHANOS_SHARED_AGENT_WORKSPACE, 1024);
  const repoRoot = boundedText(env.STEPHANOS_MISSION_WORKER_REPOSITORY_ROOT, 1024);
  const timestampUtc = Number.isFinite(Date.parse(nowUtc)) ? new Date(Date.parse(nowUtc)).toISOString() : new Date().toISOString();
  const [owner, repo] = CANONICAL_GOAL_REPOSITORY.split('/');
  if (!root || !repoRoot) {
    return Object.freeze({ ok: false, reason: 'GITHUB_GOAL_ESTATE_WORKSPACE_UNAVAILABLE', observed: 0, admitted: 0, refreshed: 0, preserved: 0 });
  }
  let auth;
  try {
    auth = await resolveGithubAuth({ env });
  } catch {
    auth = null;
  }
  if (!auth?.configured) {
    const counts = { observed: 0, admitted: 0, refreshed: 0, preserved: 0 };
    const statusWrite = await publishGoalEstateStatus({
      root, repoRoot, timestampUtc, status: 'BLOCKED', summary: 'GitHub durable goal intake blocked: read authority unavailable.', counts, writeAtomicJsonFn,
    });
    return Object.freeze({ ok: false, reason: 'GITHUB_GOAL_ESTATE_AUTH_UNAVAILABLE', ...counts, statusWrite });
  }
  let observed;
  try {
    observed = await fetchGoals({ owner, repo, auth });
  } catch {
    observed = null;
  }
  if (observed?.status !== 'fetched' || !Array.isArray(observed?.issues)) {
    const counts = { observed: 0, admitted: 0, refreshed: 0, preserved: 0 };
    const statusWrite = await publishGoalEstateStatus({
      root, repoRoot, timestampUtc, status: 'BLOCKED', summary: 'GitHub durable goal intake blocked: goal estate read failed.', counts, writeAtomicJsonFn,
    });
    return Object.freeze({ ok: false, reason: 'GITHUB_GOAL_ESTATE_READ_FAILED', ...counts, statusWrite });
  }
  let admitted = 0;
  let refreshed = 0;
  let preserved = 0;
  for (const issue of observed.issues) {
    const record = githubGoalRecord(issue, observed.retrievedAt || timestampUtc);
    if (!record) continue;
    const resolved = resolveSharedWorkspacePath({
      root,
      repoRoot,
      segments: ['goals', `${record.goalId}.json`],
    });
    if (!resolved.ok) {
      const counts = { observed: observed.issues.length, admitted, refreshed, preserved };
      const statusWrite = await publishGoalEstateStatus({
        root, repoRoot, timestampUtc, status: 'BLOCKED', summary: `GitHub durable goal intake blocked: ${resolved.reason}.`, counts, writeAtomicJsonFn,
      });
      return Object.freeze({ ok: false, reason: resolved.reason, ...counts, statusWrite });
    }
    let existing = null;
    try {
      existing = JSON.parse(await readFileFn(resolved.path, 'utf8'));
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        const counts = { observed: observed.issues.length, admitted, refreshed, preserved };
        const statusWrite = await publishGoalEstateStatus({
          root, repoRoot, timestampUtc, status: 'BLOCKED', summary: 'GitHub durable goal intake blocked: existing goal record unreadable.', counts, writeAtomicJsonFn,
        });
        return Object.freeze({ ok: false, reason: 'GITHUB_GOAL_EXISTING_RECORD_READ_FAILED', ...counts, statusWrite });
      }
    }
    if (existing) {
      const validation = validateSharedWorkspaceRecord(existing, { nowMs: Date.parse(timestampUtc) });
      const sameIssue = positiveInteger(existing.issueNumber) === record.issueNumber || existing.goalId === record.goalId;
      if (!validation.valid || !sameIssue) {
        const counts = { observed: observed.issues.length, admitted, refreshed, preserved };
        const statusWrite = await publishGoalEstateStatus({
          root, repoRoot, timestampUtc, status: 'BLOCKED', summary: `GitHub durable goal intake blocked: goal #${record.issueNumber} conflicts with existing workspace identity.`, counts, writeAtomicJsonFn,
        });
        return Object.freeze({ ok: false, reason: 'GITHUB_GOAL_EXISTING_RECORD_CONFLICT', issueNumber: record.issueNumber, ...counts, statusWrite });
      }
      if (existingGoalIsRicher(existing)) {
        preserved += 1;
        continue;
      }
    }
    const write = await writeAtomicJsonFn(root, ['goals', `${record.goalId}.json`], record, {
      repoRoot,
      nowMs: Date.parse(record.timestampUtc),
    });
    if (!write?.ok) {
      const counts = { observed: observed.issues.length, admitted, refreshed, preserved };
      const statusWrite = await publishGoalEstateStatus({
        root, repoRoot, timestampUtc, status: 'BLOCKED', summary: `GitHub durable goal intake blocked while publishing goal #${record.issueNumber}.`, counts, writeAtomicJsonFn,
      });
      return Object.freeze({ ok: false, reason: write?.reason || 'GITHUB_GOAL_RECORD_WRITE_FAILED', issueNumber: record.issueNumber, ...counts, statusWrite });
    }
    if (existing) refreshed += 1;
    else admitted += 1;
  }
  const counts = { observed: observed.issues.length, admitted, refreshed, preserved };
  const statusWrite = await publishGoalEstateStatus({
    root,
    repoRoot,
    timestampUtc,
    status: 'PASS',
    summary: `GitHub durable goal intake observed ${counts.observed}, admitted ${counts.admitted}, refreshed ${counts.refreshed}, preserved ${counts.preserved}.`,
    counts,
    writeAtomicJsonFn,
  });
  return Object.freeze({
    ok: statusWrite?.ok === true,
    reason: statusWrite?.ok === true ? 'GITHUB_GOAL_ESTATE_REFRESH_PASS' : statusWrite?.reason || 'GITHUB_GOAL_ESTATE_STATUS_WRITE_FAILED',
    ...counts,
    statusWrite,
    mergeAuthority: false,
    sourceMutationAuthority: false,
    deploymentAuthority: false,
    arbitraryShellAllowed: false,
  });
}

export function createMissionWorkerControllerLogProjection(controller, checkedAt) {
  const grant = ownData(controller, 'workerActionGrant');
  return Object.freeze({ schemaVersion: MISSION_WORKER_LOG_PROJECTION_SCHEMA, event: 'controller-cycle', checkedAt: boundedText(checkedAt, 32), status: boundedText(ownData(controller, 'status'), 32), action: boundedText(ownData(controller, 'action'), 48), finalVerdict: boundedText(ownData(controller, 'finalVerdict'), 64), allowWorkerTick: ownData(controller, 'allowWorkerTick') === true, blockers: Object.freeze(boundedTextList(ownData(controller, 'blockers'))), missionId: boundedText(ownData(grant, 'missionId'), 96), actionId: boundedText(ownData(grant, 'actionId'), 96), adapter: boundedText(ownData(grant, 'adapter'), 32) });
}

export function createMissionWorkerTickLogProjection(result, checkedAt) {
  const publication = ownData(result, 'publish');
  return Object.freeze({ schemaVersion: MISSION_WORKER_LOG_PROJECTION_SCHEMA, event: 'worker-tick', checkedAt: boundedText(checkedAt, 32), status: boundedText(ownData(result, 'status'), 32), state: boundedText(ownData(result, 'state'), 32), phase: boundedText(ownData(result, 'phase'), 48), finalVerdict: boundedText(ownData(result, 'finalVerdict'), 64), blocker: boundedText(ownData(result, 'blocker'), 96), publishOk: ownData(publication, 'published') === true });
}

function stableLogSignature(projection) { const { checkedAt: _checkedAt, ...stable } = projection; return JSON.stringify(stable); }
function processResultText(result, key) { const value = ownData(result, key); return typeof value === 'string' ? value : ''; }
export function missionWorkerTickMadeProgress(result) { const processing = ownData(result, 'processed'); return ownData(processing, 'processed') === true; }
function missionWorkerTickHadActivity(result) { const publication = ownData(result, 'publish'); return ownData(publication, 'published') === true || missionWorkerTickMadeProgress(result); }
function controllerRequiresMaterialProgress(controller) { const projection = ownData(controller, 'authoritativeProjection'); const status = boundedText(ownData(projection, 'status'), 32).toUpperCase(); return Boolean(status) && status !== 'HOLD'; }
function invalidRepositoryIdentity(blocker, overrides = {}) { return Object.freeze({ valid: false, canonical: false, branch: '', headSha: '', sourceClean: false, worktreeClean: false, runtimeDirtCount: 0, blocker, ...overrides }); }

function runBoundedGitObservation({ repositoryRoot, spawnSyncFn, args }) {
  let result;
  try { result = spawnSyncFn(BATTLE_BRIDGE_WINDOWS_HOST.git, ['-C', repositoryRoot, ...args], { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true, shell: false, timeout: 10_000, maxBuffer: MAX_GIT_STATUS_BYTES }); } catch { return Object.freeze({ ok: false, stdout: '' }); }
  const status = ownData(result, 'status'); const signal = ownData(result, 'signal'); const error = ownData(result, 'error'); const stdout = processResultText(result, 'stdout');
  const ok = status === 0 && signal === null && error === undefined && Buffer.byteLength(stdout, 'utf8') <= MAX_GIT_STATUS_BYTES;
  return Object.freeze({ ok, stdout: ok ? stdout : '' });
}

function parsePorcelainV2Identity(stdout) {
  let branch = ''; let headSha = '';
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith('# branch.head ')) { if (branch) return null; branch = line.slice('# branch.head '.length).trim(); }
    else if (line.startsWith('# branch.oid ')) { if (headSha) return null; headSha = line.slice('# branch.oid '.length).trim().toLowerCase(); }
  }
  return branch && SHA_40.test(headSha) ? Object.freeze({ branch, headSha }) : null;
}

export function inspectMissionWorkerRepositoryIdentity({ env = process.env, spawnSyncFn = spawnSync } = {}) {
  const repositoryRoot = boundedText(env.STEPHANOS_MISSION_WORKER_REPOSITORY_ROOT, 1024);
  const expectedHeadSha = boundedText(env.STEPHANOS_MISSION_WORKER_HEAD_SHA, 40).toLowerCase();
  if (!path.win32.isAbsolute(repositoryRoot) || !SHA_40.test(expectedHeadSha)) return invalidRepositoryIdentity('MISSION_WORKER_LAUNCH_IDENTITY_INVALID');
  const identityArgs = ['status', '--porcelain=v2', '--branch', '--untracked-files=no'];
  const identityBeforeRead = runBoundedGitObservation({ repositoryRoot, spawnSyncFn, args: identityArgs });
  const dirtRead = runBoundedGitObservation({ repositoryRoot, spawnSyncFn, args: ['status', '--porcelain=v1', '--untracked-files=all'] });
  const identityAfterRead = runBoundedGitObservation({ repositoryRoot, spawnSyncFn, args: identityArgs });
  if (!identityBeforeRead.ok || !dirtRead.ok || !identityAfterRead.ok) return invalidRepositoryIdentity('MISSION_WORKER_REPOSITORY_IDENTITY_READ_FAILED');
  const identityBefore = parsePorcelainV2Identity(identityBeforeRead.stdout); const identityAfter = parsePorcelainV2Identity(identityAfterRead.stdout);
  if (!identityBefore || !identityAfter) return invalidRepositoryIdentity('MISSION_WORKER_REPOSITORY_IDENTITY_AMBIGUOUS');
  if (identityBefore.branch !== identityAfter.branch || identityBefore.headSha !== identityAfter.headSha) return invalidRepositoryIdentity('MISSION_WORKER_REPOSITORY_IDENTITY_CHANGED_DURING_READ');
  const dirtLines = dirtRead.stdout.split(/\r?\n/).filter(Boolean); const dirt = classifyDirt(dirtLines); const sourceClean = dirt.blocksSync === false; const worktreeClean = dirtLines.length === 0; const runtimeDirtCount = Array.isArray(dirt.runtimeOnly) ? dirt.runtimeOnly.length : 0; const { branch, headSha } = identityAfter; const canonical = branch === 'main' && headSha === expectedHeadSha && sourceClean;
  return Object.freeze({ valid: true, canonical, branch, headSha, sourceClean, worktreeClean, runtimeDirtCount, blocker: canonical ? '' : branch !== 'main' ? 'CANONICAL_REPOSITORY_BRANCH_NOT_MAIN' : !sourceClean ? 'MISSION_WORKER_CANONICAL_SOURCE_DIRTY' : 'MISSION_WORKER_CANONICAL_HEAD_CHANGED' });
}

export function createMissionWorkerRepositoryLogProjection(identity, checkedAt, reloadRequired = false) {
  return Object.freeze({ schemaVersion: MISSION_WORKER_LOG_PROJECTION_SCHEMA, event: 'repository-identity', checkedAt: boundedText(checkedAt, 48), valid: ownData(identity, 'valid') === true, canonical: ownData(identity, 'canonical') === true, branch: boundedText(ownData(identity, 'branch'), 120), headSha: boundedText(ownData(identity, 'headSha'), 40).toLowerCase(), sourceClean: ownData(identity, 'sourceClean') === true, worktreeClean: ownData(identity, 'worktreeClean') === true, runtimeDirtCount: Number.isInteger(ownData(identity, 'runtimeDirtCount')) ? Math.max(0, Math.min(ownData(identity, 'runtimeDirtCount'), 10_000)) : 0, reloadRequired, blocker: boundedText(ownData(identity, 'blocker'), 160) });
}

export async function runSupervisedMissionWorker({ argv = process.argv.slice(2), env = process.env, stdout = process.stdout, stderr = process.stderr, bootstrapMailbox = ensureBattleBridgeGitHubCommandMailbox, refreshGoalEstate = refreshDurableGithubGoalEstate, goalEstateRefreshIntervalMs = MISSION_WORKER_GOAL_ESTATE_REFRESH_INTERVAL_MS, runControllerCycle = runDurableFlywheelStartupCycle, loadCapacityRoutingInput = readMissionControllerCapacityRoutingInput, runTick = runMissionWorkerTick, writeHeartbeat = writeMissionWorkerHeartbeat, readActiveClaim = readMissionWorkerActiveClaim, inspectRepositoryIdentity = inspectMissionWorkerRepositoryIdentity, sleep = (delayMs) => new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs)), sleepActiveClaimProbe = (delayMs) => new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs)), activeClaimProbeIntervalMs = MISSION_WORKER_ACTIVE_CLAIM_PROBE_INTERVAL_MS, setIntervalFn = setInterval, clearIntervalFn = clearInterval, now = () => new Date().toISOString() } = {}) {
  const once = argv.includes('--once'); const intervalMs = Number.parseInt(env.STEPHANOS_MISSION_WORKER_INTERVAL_MS || '2000', 10); const heartbeatIntervalMs = Math.max(Number.parseInt(env.STEPHANOS_MISSION_WORKER_HEARTBEAT_INTERVAL_MS || '30000', 10) || 30000, 1000); const claimProbeIntervalMs = Math.max(Number.isFinite(activeClaimProbeIntervalMs) ? activeClaimProbeIntervalMs : MISSION_WORKER_ACTIVE_CLAIM_PROBE_INTERVAL_MS, 1); const goalEstateIntervalMs = Math.max(Number.isFinite(goalEstateRefreshIntervalMs) ? goalEstateRefreshIntervalMs : MISSION_WORKER_GOAL_ESTATE_REFRESH_INTERVAL_MS, 30_000);
  let exitCode = 0; let lastControllerLogSignature = ''; let lastRepositoryLogSignature = ''; let lastTickLogSignature = ''; let lastGoalEstateLogSignature = ''; let repositoryDriftObserved = false; let consecutiveProgressRechecks = 0; let mailboxBootstrapPending = true; let activeActionGrant; let carriedExecutionDefect = ''; let lastGoalEstateRefreshAtMs = Number.NEGATIVE_INFINITY;
  do {
    const checkedAt = now(); let identity;
    try { identity = await inspectRepositoryIdentity({ env }); } catch { identity = Object.freeze({ valid: false, canonical: false, branch: '', headSha: '', sourceClean: false, worktreeClean: false, runtimeDirtCount: 0, blocker: 'MISSION_WORKER_REPOSITORY_IDENTITY_READ_FAILED' }); }
    const identityValid = ownData(identity, 'valid') === true; const identityCanonical = ownData(identity, 'canonical') === true; const observedBranch = boundedText(ownData(identity, 'branch'), 120); const observedHeadSha = boundedText(ownData(identity, 'headSha'), 40).toLowerCase(); const observedSourceClean = ownData(identity, 'sourceClean') === true; const expectedHeadSha = boundedText(env.STEPHANOS_MISSION_WORKER_HEAD_SHA, 40).toLowerCase();
    const recoveredLaunchIdentity = identityValid && observedBranch === 'main' && observedHeadSha === expectedHeadSha && observedSourceClean; const changedCanonicalHead = identityValid && observedBranch === 'main' && SHA_40.test(observedHeadSha) && observedHeadSha !== expectedHeadSha && observedSourceClean; const reloadRequired = changedCanonicalHead || (repositoryDriftObserved && recoveredLaunchIdentity);
    const repositoryLog = createMissionWorkerRepositoryLogProjection(identity, checkedAt, reloadRequired); const repositoryLogSignature = stableLogSignature(repositoryLog); if (once || repositoryLogSignature !== lastRepositoryLogSignature) { stdout.write(`${JSON.stringify(repositoryLog)}\n`); lastRepositoryLogSignature = repositoryLogSignature; }
    if (reloadRequired) { stderr.write(`${JSON.stringify({ schemaVersion: MISSION_WORKER_LOG_PROJECTION_SCHEMA, event: 'worker-reload', checkedAt, finalVerdict: 'MISSION_WORKER_CANONICAL_RELOAD_REQUIRED', exitCode: MISSION_WORKER_CANONICAL_RELOAD_EXIT_CODE })}\n`); return MISSION_WORKER_CANONICAL_RELOAD_EXIT_CODE; }
    if (identityValid && !identityCanonical) repositoryDriftObserved = true;
    if (!identityCanonical) { consecutiveProgressRechecks = 0; if (once) return 0; await sleep(Math.max(Number.isFinite(intervalMs) ? intervalMs : 2000, 250)); continue; }
    let lastTickVerdict = carriedExecutionDefect || 'MISSION_WORKER_TICK_PASS'; let heartbeatWriteFailed = false; let heartbeatWrites = Promise.resolve(); let tickHadActivity = false; let materialProgressRequired = false;
    const queueHeartbeat = (lastTickVerdictValue, timestampUtc = now()) => { const heartbeatActionGrant = activeActionGrant; heartbeatWrites = heartbeatWrites.then(async () => { try { await writeHeartbeat({ env, timestampUtc, lastTickVerdict: lastTickVerdictValue, activeActionGrant: heartbeatActionGrant }); } catch (error) { heartbeatWriteFailed = true; stderr.write(`${JSON.stringify({ checkedAt: timestampUtc, finalVerdict: 'MISSION_WORKER_HEARTBEAT_WRITE_FAILED', error: error.message })}\n`); } }); return heartbeatWrites; };
    const authoritativeHeartbeatVerdict = () => carriedExecutionDefect || 'MISSION_WORKER_TICK_RUNNING';
    await queueHeartbeat(authoritativeHeartbeatVerdict(), checkedAt); const heartbeatTimer = setIntervalFn(() => { void queueHeartbeat(authoritativeHeartbeatVerdict()); }, heartbeatIntervalMs);
    try {
      if (mailboxBootstrapPending) { mailboxBootstrapPending = false; try { const mailboxBootstrap = await bootstrapMailbox({ env }); stdout.write(`${JSON.stringify({ checkedAt: now(), ...mailboxBootstrap })}\n`); } catch (error) { stderr.write(`${JSON.stringify({ checkedAt: now(), finalVerdict: 'MAILBOX_SELF_BOOTSTRAP_FAILED', error: error?.message || String(error), operatorNeeded: true })}\n`); if (once) exitCode = 1; } }
      const checkedAtMs = Date.parse(checkedAt); const refreshDue = once || !Number.isFinite(lastGoalEstateRefreshAtMs) || (Number.isFinite(checkedAtMs) && checkedAtMs - lastGoalEstateRefreshAtMs >= goalEstateIntervalMs);
      if (refreshDue) {
        if (Number.isFinite(checkedAtMs)) lastGoalEstateRefreshAtMs = checkedAtMs;
        let goalEstateRefresh;
        try { goalEstateRefresh = await refreshGoalEstate({ env, nowUtc: checkedAt }); } catch (error) { goalEstateRefresh = Object.freeze({ ok: false, reason: 'GITHUB_GOAL_ESTATE_REFRESH_FAILED', error: boundedText(error?.message || String(error), 160), observed: 0, admitted: 0, refreshed: 0, preserved: 0 }); }
        const goalEstateLog = Object.freeze({ schemaVersion: MISSION_WORKER_LOG_PROJECTION_SCHEMA, event: 'goal-estate-refresh', checkedAt, finalVerdict: goalEstateRefresh?.ok === true ? 'GITHUB_GOAL_ESTATE_REFRESH_PASS' : 'GITHUB_GOAL_ESTATE_REFRESH_BLOCKED', reason: boundedText(goalEstateRefresh?.reason, 96), observed: Number(goalEstateRefresh?.observed || 0), admitted: Number(goalEstateRefresh?.admitted || 0), refreshed: Number(goalEstateRefresh?.refreshed || 0), preserved: Number(goalEstateRefresh?.preserved || 0) });
        const goalEstateLogSignature = stableLogSignature(goalEstateLog); if (once || goalEstateLogSignature !== lastGoalEstateLogSignature) { (goalEstateRefresh?.ok === true ? stdout : stderr).write(`${JSON.stringify(goalEstateLog)}\n`); lastGoalEstateLogSignature = goalEstateLogSignature; }
      }
      const capacityRoutingOptions = { root: env.STEPHANOS_SHARED_AGENT_WORKSPACE, repoRoot: env.STEPHANOS_MISSION_WORKER_REPOSITORY_ROOT, nowUtc: checkedAt };
      const controller = await runControllerCycle({}, { env, ...capacityRoutingOptions, sourceRevision: env.STEPHANOS_MISSION_WORKER_HEAD_SHA }); const controllerLog = createMissionWorkerControllerLogProjection(controller, checkedAt); const controllerLogSignature = stableLogSignature(controllerLog); if (once || controllerLogSignature !== lastControllerLogSignature) { stdout.write(`${JSON.stringify(controllerLog)}\n`); lastControllerLogSignature = controllerLogSignature; }
      if (carriedExecutionDefect && boundedText(ownData(controller, 'status'), 32).toUpperCase() === 'HOLD') { carriedExecutionDefect = ''; lastTickVerdict = 'MISSION_WORKER_TICK_PASS'; }
      materialProgressRequired = controllerRequiresMaterialProgress(controller);
      if (controller?.allowWorkerTick === true) {
        const actionGrant = controller.workerActionGrant; const capacityRoute = boundedText(ownData(actionGrant, 'capacityRoute'), 48); const capacityRouting = capacityRoute ? await loadCapacityRoutingInput(capacityRoutingOptions) : undefined; activeActionGrant = actionGrant; let tickSettled = false; let activeClaimHeartbeatPublished = false;
        const watchActiveClaim = async () => { while (!tickSettled && !activeClaimHeartbeatPublished) { let activeClaim = null; try { activeClaim = await readActiveClaim({ env, actionGrant }); } catch { activeClaim = null; } if (tickSettled) return; if (activeClaim) { activeClaimHeartbeatPublished = true; await queueHeartbeat(authoritativeHeartbeatVerdict()); return; } await sleepActiveClaimProbe(claimProbeIntervalMs); } };
        let result; const tickPromise = runTick({ env, actionGrant, capacityRouting }); const activeClaimWatcher = watchActiveClaim(); try { result = await tickPromise; } finally { tickSettled = true; await activeClaimWatcher; activeActionGrant = undefined; }
        const tickMadeMaterialProgress = missionWorkerTickMadeProgress(result); tickHadActivity = missionWorkerTickHadActivity(result);
        if (tickMadeMaterialProgress) { carriedExecutionDefect = ''; lastTickVerdict = 'MISSION_WORKER_TICK_PASS'; }
        else if (materialProgressRequired) { lastTickVerdict = 'CONTROLLER_EXECUTION_DEFECT_NO_MATERIAL_PROGRESS'; carriedExecutionDefect = lastTickVerdict; stderr.write(`${JSON.stringify({ checkedAt: now(), finalVerdict: lastTickVerdict, missionId: boundedText(ownData(actionGrant, 'missionId'), 96), actionId: boundedText(ownData(actionGrant, 'actionId'), 96) })}\n`); if (once) exitCode = 1; }
        const tickLog = createMissionWorkerTickLogProjection(result, checkedAt); const tickLogSignature = stableLogSignature(tickLog); if (once || tickLogSignature !== lastTickLogSignature) { stdout.write(`${JSON.stringify(tickLog)}\n`); lastTickLogSignature = tickLogSignature; }
      } else if (materialProgressRequired) { lastTickVerdict = 'CONTROLLER_EXECUTION_DEFECT_NO_WORKER_GRANT'; carriedExecutionDefect = lastTickVerdict; stderr.write(`${JSON.stringify({ checkedAt: now(), finalVerdict: lastTickVerdict })}\n`); if (once) exitCode = 1; }
    } catch (error) { activeActionGrant = undefined; lastTickVerdict = 'MISSION_WORKER_TICK_FAILED'; stderr.write(`${JSON.stringify({ checkedAt, finalVerdict: lastTickVerdict, error: error.message })}\n`); if (once) exitCode = 1; } finally { clearIntervalFn(heartbeatTimer); await heartbeatWrites; }
    await queueHeartbeat(lastTickVerdict); if (heartbeatWriteFailed && once) exitCode = 1;
    if (!once) { const steadyDelayMs = Math.max(Number.isFinite(intervalMs) ? intervalMs : 2000, 250); let delayMs = steadyDelayMs; if (tickHadActivity && consecutiveProgressRechecks < MAX_CONSECUTIVE_PROGRESS_RECHECKS) { consecutiveProgressRechecks += 1; delayMs = PROGRESS_RECHECK_INTERVAL_MS; } else { consecutiveProgressRechecks = 0; } await sleep(delayMs); }
  } while (!once);
  return exitCode;
}

export function isDirectCliEntrypoint({ metaUrl = import.meta.url, argv1 = process.argv[1] } = {}) { if (!argv1) return false; return path.resolve(fileURLToPath(metaUrl)) === path.resolve(argv1); }
if (isDirectCliEntrypoint()) process.exitCode = await runSupervisedMissionWorker();
