#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BATTLE_BRIDGE_WINDOWS_HOST } from '../shared/agents/battleBridgeWindowsHosts.mjs';
import { buildBattleBridgeTelemetryAutorepairProjection } from '../shared/agents/battleBridgeTelemetryAutorepairV1.mjs';
import {
  MAILBOX_RECEIPT_GITHUB_ISSUE,
  MAILBOX_RECEIPT_GITHUB_REPOSITORY,
  extractTrustedMailboxCommandComment,
  extractTrustedMailboxReceiptComment,
} from '../shared/agents/mailboxReceiptIndexGitHubMirror.mjs';

export const BATTLE_BRIDGE_OUTBOUND_BEACON_SCHEMA = 'stephanos.battle-bridge-outbound-health-beacon.v1';
export const BATTLE_BRIDGE_OUTBOUND_BEACON_MARKER = '<!-- stephanos-battle-bridge-outbound-health-beacon -->';
export const BATTLE_BRIDGE_OUTBOUND_BEACON_ISSUE = 1889;
export const BATTLE_BRIDGE_OUTBOUND_BEACON_REPOSITORY = 'Cheekyfellastef/stephan-os';
export const BATTLE_BRIDGE_OUTBOUND_BEACON_OWNER = 'Cheekyfellastef';
export const MAILBOX_INGRESS_GRACE_MS = 10 * 60 * 1000;
export const MAILBOX_INGRESS_LOOKBACK_MS = 4 * 60 * 60 * 1000;

const SHA = /^[0-9a-f]{40}$/;
const MAX_STATUS_BYTES = 64 * 1024;
const MAX_GITHUB_BYTES = 512 * 1024;
const STATUS_SPECS = Object.freeze([
  Object.freeze({ id: 'githubSync', path: 'status/battle-bridge-github-sync-current.json', staleAfterMs: 180_000 }),
  Object.freeze({ id: 'postSyncRefresh', path: 'status/post-sync-runtime-refresh-current.json', staleAfterMs: 300_000 }),
  Object.freeze({ id: 'ignition', path: 'status/battle-bridge-ignition-supervisor-current.json', staleAfterMs: 300_000 }),
  Object.freeze({ id: 'battleBridge', path: 'status/battle-bridge-current.json', staleAfterMs: 300_000 }),
  Object.freeze({ id: 'recoveryMesh', path: 'status/battle-bridge-recovery-mesh-current.json', staleAfterMs: 180_000 }),
  Object.freeze({ id: 'mailbox', path: 'status/battle-bridge-mailbox-receipt-index.json', staleAfterMs: 420_000 }),
  Object.freeze({ id: 'missionWorker', path: 'status/mission-orchestrator-worker-heartbeat.json', staleAfterMs: 180_000 }),
]);

function text(value, limit = 180) {
  const normalized = String(value ?? '').trim();
  return normalized.length > limit ? normalized.slice(0, limit) : normalized;
}

function safeSha(value) {
  const normalized = text(value, 40).toLowerCase();
  return SHA.test(normalized) ? normalized : '';
}

function timestamp(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
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

function nestedHead(record = {}) {
  return record.backendIdentity?.sourceHead
    || record.sourceTruth?.head
    || record.sourceTruthVerdict?.sourceHead
    || record.servedRuntimeProof?.sourceHead
    || '';
}

function recordHead(record = {}) {
  return safeSha(
    record.localHeadAfter
    || record.localHead
    || record.sourceHead
    || record.headSha
    || record.afterHead
    || record.currentHead
    || record.expectedHead
    || record.remoteHeadObserved
    || nestedHead(record),
  );
}

function recordObservedAt(record = {}) {
  return timestamp(
    record.timestampUtc
    || record.observedAtUtc
    || record.heartbeatAt
    || record.completedAt
    || record.updatedAtUtc
    || record.generatedAt
    || record.generatedAtUtc
    || record.publishedAtUtc,
  );
}

function recordRawState(record = {}) {
  return text(
    record.status
    || record.classification
    || record.finalVerdict
    || record.state
    || record.phase
    || record.tickVerdict
    || record.readiness
    || record.trafficLight
    || 'UNKNOWN',
    120,
  ).toUpperCase();
}

function serviceFacts(record = {}) {
  const facts = record.observedServiceFacts || record.services || {};
  if (!facts || typeof facts !== 'object' || Array.isArray(facts)) return Object.freeze({});
  const allowed = {};
  for (const [id, value] of Object.entries(facts)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    allowed[id] = Object.freeze({
      ready: value.ready === true,
      state: text(value.state || '', 40),
    });
  }
  return Object.freeze(allowed);
}

export function projectBeaconStatus(record, spec, nowMs = Date.now()) {
  if (!record) {
    return Object.freeze({ id: spec.id, state: 'UNPROVEN', rawState: 'UNPROVEN', observedAtUtc: '', ageMs: null, head: '', blocker: 'STATUS_MISSING', serviceFacts: Object.freeze({}) });
  }
  const observedAtUtc = recordObservedAt(record);
  const observedMs = Date.parse(observedAtUtc);
  const ageMs = Number.isFinite(observedMs) ? Math.max(0, nowMs - observedMs) : null;
  const stale = ageMs === null || ageMs > spec.staleAfterMs;
  const rawState = recordRawState(record);
  const blocker = text(record.blocker || record.exactNextAction || record.blockerId || '', 180);
  return Object.freeze({
    id: spec.id,
    state: stale ? 'STALE' : (rawState || 'UNKNOWN'),
    rawState,
    observedAtUtc,
    ageMs,
    head: recordHead(record),
    blocker,
    serviceFacts: serviceFacts(record),
  });
}

function commandExpiryUtc(comment = {}) {
  const body = String(comment?.body || '');
  const match = body.match(/```stephanos-battle-bridge-command\s*([\s\S]*?)```/i);
  if (!match) return '';
  try {
    const command = JSON.parse(match[1]);
    return timestamp(command?.expiresAt);
  } catch {
    return '';
  }
}

export function projectMailboxIngressLiveness(comments = [], {
  sourceHead,
  ownerLogin = BATTLE_BRIDGE_OUTBOUND_BEACON_OWNER,
  now = new Date(),
  graceMs = MAILBOX_INGRESS_GRACE_MS,
} = {}) {
  const head = safeSha(sourceHead);
  if (!head || !Array.isArray(comments)) {
    return Object.freeze({ state: 'UNPROVEN', blocker: 'MAILBOX_INGRESS_OBSERVATION_INVALID', pendingRequestCount: 0 });
  }
  const nowMs = now.getTime();
  const receiptKeys = new Set();
  for (const comment of comments) {
    const receipt = extractTrustedMailboxReceiptComment(comment, ownerLogin);
    const receiptHead = safeSha(receipt?.expectedHead);
    if (receiptHead === head && ['ACCEPTED', 'DONE', 'BLOCKED'].includes(String(receipt?.state || '').toUpperCase())) {
      receiptKeys.add(`${String(receipt.requestId)}:${receiptHead}`);
    }
  }
  const matureCommands = [];
  let validExactHeadCommandCount = 0;
  for (const comment of comments) {
    const command = extractTrustedMailboxCommandComment(comment, ownerLogin);
    if (!command || command.expectedHead !== head) continue;
    const createdAtUtc = timestamp(comment?.created_at || comment?.createdAt);
    const expiresAtUtc = commandExpiryUtc(comment);
    const createdAtMs = Date.parse(createdAtUtc);
    const expiresAtMs = Date.parse(expiresAtUtc);
    if (!Number.isFinite(createdAtMs) || !Number.isFinite(expiresAtMs) || expiresAtMs <= createdAtMs) continue;
    validExactHeadCommandCount += 1;
    const ageMs = Math.max(0, nowMs - createdAtMs);
    if (ageMs > graceMs) {
      matureCommands.push({
        requestId: command.requestId,
        createdAtMs,
        commentId: Number(comment?.id || 0),
        hasReceipt: receiptKeys.has(`${command.requestId}:${head}`),
      });
    }
  }
  matureCommands.sort((left, right) => left.createdAtMs - right.createdAtMs || left.commentId - right.commentId);
  let lastReceiptIndex = -1;
  for (let index = 0; index < matureCommands.length; index += 1) {
    if (matureCommands[index].hasReceipt) lastReceiptIndex = index;
  }
  const pending = matureCommands.slice(lastReceiptIndex + 1).filter((command) => !command.hasReceipt);
  if (pending.length > 0) {
    return Object.freeze({
      state: 'BLOCKED_COMMAND_INGRESS_UNOBSERVED',
      blocker: 'PENDING_EXACT_HEAD_COMMAND_NOT_ACCEPTED',
      pendingRequestCount: pending.length,
    });
  }
  if (validExactHeadCommandCount === 0) {
    return Object.freeze({
      state: 'UNPROVEN',
      blocker: 'MAILBOX_INGRESS_NO_RECENT_EXACT_HEAD_PROOF',
      pendingRequestCount: 0,
    });
  }
  return Object.freeze({ state: 'OBSERVED', blocker: '', pendingRequestCount: 0 });
}

function combineMailboxStatus(localStatus, ingressObservation) {
  if (!ingressObservation || ingressObservation.state === 'OBSERVED') return Object.freeze({
    ...localStatus,
    ingressState: ingressObservation?.state || 'UNKNOWN',
    ingressBlocker: ingressObservation?.blocker || '',
  });
  if (localStatus.state === 'STALE' || localStatus.state === 'UNPROVEN' || localStatus.state.includes('BLOCK')) return Object.freeze({
    ...localStatus,
    ingressState: ingressObservation.state,
    ingressBlocker: ingressObservation.blocker,
  });
  return Object.freeze({
    ...localStatus,
    state: ingressObservation.state,
    blocker: ingressObservation.blocker,
    ingressState: ingressObservation.state,
    ingressBlocker: ingressObservation.blocker,
  });
}

export function buildBattleBridgeOutboundBeacon({ sourceHead, statusRecords = {}, mailboxIngressObservation = null, now = new Date() } = {}) {
  const head = safeSha(sourceHead);
  if (!head) throw new Error('OUTBOUND_BEACON_SOURCE_HEAD_INVALID');
  const observedAtUtc = now.toISOString();
  const nowMs = now.getTime();
  const surfaces = STATUS_SPECS.map((spec) => {
    const projected = projectBeaconStatus(statusRecords[spec.id] || null, spec, nowMs);
    return spec.id === 'mailbox' ? combineMailboxStatus(projected, mailboxIngressObservation) : projected;
  });
  const telemetry = buildBattleBridgeTelemetryAutorepairProjection({ sourceHead: head, surfaces });
  const blockers = telemetry.repairCandidates
    .map((candidate) => `${candidate.surfaceId}:${candidate.blocker || candidate.gapClass}`)
    .slice(0, 12);
  return Object.freeze({
    schemaVersion: BATTLE_BRIDGE_OUTBOUND_BEACON_SCHEMA,
    repository: BATTLE_BRIDGE_OUTBOUND_BEACON_REPOSITORY,
    issueNumber: BATTLE_BRIDGE_OUTBOUND_BEACON_ISSUE,
    observedAtUtc,
    sourceHead: head,
    branch: 'main',
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
    readOnly: true,
    sourceMutationAllowed: false,
    taskMutationAllowed: false,
    processRestartAllowed: false,
    arbitraryShellAllowed: false,
    destructiveGitAllowed: false,
    liveOpenClawUpdateAllowed: false,
    pcRestartAllowed: false,
    secretValuesPublished: false,
    finalVerdict: 'BATTLE_BRIDGE_OUTBOUND_HEALTH_BEACON_PUBLISHED',
  });
}

export function buildBattleBridgeOutboundBeaconBody(record) {
  return `${BATTLE_BRIDGE_OUTBOUND_BEACON_MARKER}\n\n\`\`\`json\n${JSON.stringify(record, null, 2)}\n\`\`\``;
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

function exactLocalHead(repoRoot) {
  const branch = runFixed(BATTLE_BRIDGE_WINDOWS_HOST.git, ['-C', repoRoot, 'branch', '--show-current'], { cwd: repoRoot });
  if (!branch.ok || branch.stdout.trim() !== 'main') throw new Error('OUTBOUND_BEACON_BRANCH_NOT_MAIN');
  const head = runFixed(BATTLE_BRIDGE_WINDOWS_HOST.git, ['-C', repoRoot, 'rev-parse', 'HEAD'], { cwd: repoRoot });
  const sourceHead = safeSha(head.stdout);
  if (!head.ok || !sourceHead) throw new Error('OUTBOUND_BEACON_HEAD_UNPROVEN');
  return sourceHead;
}

function existingBeaconCommentId(repoRoot) {
  const response = runFixed(BATTLE_BRIDGE_WINDOWS_HOST.githubCli, [
    'api',
    `repos/${BATTLE_BRIDGE_OUTBOUND_BEACON_REPOSITORY}/issues/${BATTLE_BRIDGE_OUTBOUND_BEACON_ISSUE}/comments?per_page=100`,
    '--paginate',
    '--slurp',
  ], { cwd: repoRoot, timeout: 120_000 });
  if (!response.ok) throw new Error('OUTBOUND_BEACON_GITHUB_READ_FAILED');
  let pages;
  try { pages = JSON.parse(response.stdout); } catch { throw new Error('OUTBOUND_BEACON_GITHUB_JSON_INVALID'); }
  const comments = Array.isArray(pages) ? pages.flat().filter((value) => value && typeof value === 'object') : [];
  const matches = comments.filter((comment) => String(comment.body || '').includes(BATTLE_BRIDGE_OUTBOUND_BEACON_MARKER));
  const id = Number(matches.at(-1)?.id || 0);
  return Number.isSafeInteger(id) && id > 0 ? id : 0;
}

function recentMailboxComments(repoRoot, observedAt) {
  const since = new Date(observedAt.getTime() - MAILBOX_INGRESS_LOOKBACK_MS).toISOString();
  const response = runFixed(BATTLE_BRIDGE_WINDOWS_HOST.githubCli, [
    'api',
    `repos/${MAILBOX_RECEIPT_GITHUB_REPOSITORY}/issues/${MAILBOX_RECEIPT_GITHUB_ISSUE}/comments?per_page=100&since=${encodeURIComponent(since)}`,
    '--paginate',
    '--slurp',
  ], { cwd: repoRoot, timeout: 120_000 });
  if (!response.ok) throw new Error('OUTBOUND_BEACON_MAILBOX_INGRESS_READ_FAILED');
  let pages;
  try { pages = JSON.parse(response.stdout); } catch { throw new Error('OUTBOUND_BEACON_MAILBOX_INGRESS_JSON_INVALID'); }
  return Array.isArray(pages) ? pages.flat().filter((value) => value && typeof value === 'object') : [];
}

function publishBeacon(repoRoot, body) {
  const existingId = existingBeaconCommentId(repoRoot);
  const args = existingId
    ? ['api', '-X', 'PATCH', `repos/${BATTLE_BRIDGE_OUTBOUND_BEACON_REPOSITORY}/issues/comments/${existingId}`, '-f', `body=${body}`]
    : ['api', '-X', 'POST', `repos/${BATTLE_BRIDGE_OUTBOUND_BEACON_REPOSITORY}/issues/${BATTLE_BRIDGE_OUTBOUND_BEACON_ISSUE}/comments`, '-f', `body=${body}`];
  const result = runFixed(BATTLE_BRIDGE_WINDOWS_HOST.githubCli, args, { cwd: repoRoot, timeout: 120_000 });
  if (!result.ok) throw new Error('OUTBOUND_BEACON_GITHUB_PUBLISH_FAILED');
  return existingId ? 'UPDATED' : 'CREATED';
}

export function runBattleBridgeOutboundHealthBeacon({
  platform = process.platform,
  env = process.env,
  now = () => new Date(),
  publish = publishBeacon,
} = {}) {
  if (platform !== 'win32') throw new Error('WINDOWS_REQUIRED');
  const repoRoot = resolve(env.USERPROFILE || homedir(), 'Documents', 'GitHub', 'stephan-os');
  const expectedRepoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
  if (repoRoot.toLowerCase() !== expectedRepoRoot.toLowerCase()) throw new Error('OUTBOUND_BEACON_CANONICAL_CHECKOUT_REQUIRED');
  const workspaceRoot = resolve(env.STEPHANOS_SHARED_AGENT_WORKSPACE || join(env.USERPROFILE || homedir(), 'Documents', 'Stephanos-openclaw-workspace'));
  const sourceHead = exactLocalHead(repoRoot);
  const observedAt = now();
  const statusRecords = Object.fromEntries(STATUS_SPECS.map((spec) => [spec.id, readJsonBounded(join(workspaceRoot, ...spec.path.split('/')))]));
  let mailboxIngressObservation;
  try {
    mailboxIngressObservation = projectMailboxIngressLiveness(recentMailboxComments(repoRoot, observedAt), {
      sourceHead,
      now: observedAt,
    });
  } catch {
    mailboxIngressObservation = Object.freeze({
      state: 'UNPROVEN',
      blocker: 'MAILBOX_INGRESS_OBSERVATION_UNAVAILABLE',
      pendingRequestCount: 0,
    });
  }
  const record = buildBattleBridgeOutboundBeacon({ sourceHead, statusRecords, mailboxIngressObservation, now: observedAt });
  const publication = publish(repoRoot, buildBattleBridgeOutboundBeaconBody(record));
  return Object.freeze({ ok: true, publication, sourceHead, issueNumber: BATTLE_BRIDGE_OUTBOUND_BEACON_ISSUE, record });
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
