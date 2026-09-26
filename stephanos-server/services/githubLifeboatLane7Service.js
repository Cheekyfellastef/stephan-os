import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

import {
  appendExecutionReceipt,
  createExecutionReceipt,
  readExecutionReceiptHistory,
} from '../../shared/agents/executionReceiptV1.mjs';
import { gateSourceWorkerCompletionV1 } from '../../shared/agents/sourceArtifactEscrowCompletionGateV1.mjs';
import { MISSION_CONTROLLER_ROUTE } from '../../shared/agents/missionControllerCapacityRouterV1.mjs';
import {
  createSharedWorkspaceProofRecord,
  validateSharedWorkspaceRecord,
  writeAtomicJson,
} from '../../shared/agents/sharedAgentWorkspaceStore.mjs';
import { publishGitHubContinuityCapacityPublicationV1 } from '../../shared/agents/githubContinuityCapacityPublicationV1.mjs';
import { resolveCriticalBacklogRuntimePaths } from './criticalBacklogConveyorServiceCore.js';
import { claimNextMissionWorkerItem } from './missionOrchestratorWorkerConsumer.js';
import {
  collectAgentWorkerResult,
  readMissionWorkerQueue,
  resolveMissionWorkerQueueRoot,
} from './missionOrchestratorWorkerService.js';

export const GITHUB_LIFEBOAT_LANE7_SCHEMA = 'stephanos.github-lifeboat-lane7.v1';
export const GITHUB_LIFEBOAT_LANE7_INBOX_SCHEMA = 'stephanos.github-lifeboat-lane7-inbox.v1';
export const GITHUB_LIFEBOAT_LANE7_OUTBOX_SCHEMA = 'stephanos.github-lifeboat-lane7-outbox.v1';
export const GITHUB_LIFEBOAT_LANE7_WORKER_ID = 'stephanos-github-lifeboat-external';
export const GITHUB_LIFEBOAT_LANE7_REPOSITORY = 'Cheekyfellastef/stephan-os';
export const GITHUB_LIFEBOAT_LANE7_ISSUE = 1506;
export const GITHUB_LIFEBOAT_LANE7_INBOX_COMMENT_ID = 5728606988;
export const GITHUB_LIFEBOAT_LANE7_OUTBOX_COMMENT_ID = 5728608410;
export const GITHUB_LIFEBOAT_LANE7_INBOX_MARKER = '<!-- stephanos-github-lifeboat-lane7-inbox-v1 -->';
export const GITHUB_LIFEBOAT_LANE7_OUTBOX_MARKER = '<!-- stephanos-github-lifeboat-lane7-outbox-v1 -->';
export const GITHUB_LIFEBOAT_LANE7_TASK_CLASSES = Object.freeze(['FOCUSED_REPAIR']);

const OWNER = 'Cheekyfellastef';
const SHA40 = /^[0-9a-f]{40}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,160}$/;
const SAFE_PATH = /^(?!\/)(?![A-Za-z]:\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._@+ -]+(?:\/[A-Za-z0-9._@+ -]+)*$/;
const MAX_WINDOW_MS = 5 * 60 * 1000;
const RECEIPT_WINDOW_MS = 4 * 60 * 1000;
const MAX_FOCUSED_SCOPES = 12;
const MAX_TESTS = 12;

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function pathForbidden(path) {
  return /(^|\/)(?:\.git|node_modules|runtime|runtime-data|data|tmp)(?:\/|$)|(^|\/)\.env(?:\.|$)|\.(?:pem|pfx|key)$/i.test(path);
}

function safePath(value) {
  const path = text(value).replace(/\\/g, '/').replace(/^\.\/+/, '');
  return SAFE_PATH.test(path) && !pathForbidden(path) ? path : '';
}

function safeScope(value) {
  const raw = text(value).replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (raw.endsWith('/**')) {
    const base = safePath(raw.slice(0, -3));
    return base ? `${base}/**` : '';
  }
  if (raw.endsWith('/')) {
    const base = safePath(raw.slice(0, -1));
    return base ? `${base}/` : '';
  }
  return safePath(raw);
}

function pathAllowed(path, allowedScopes = []) {
  return allowedScopes.some((allowed) => {
    const scope = safeScope(allowed);
    if (!scope) return false;
    if (scope.endsWith('/**')) return path === scope.slice(0, -3) || path.startsWith(scope.slice(0, -2));
    if (scope.endsWith('/')) return path.startsWith(scope);
    return path === scope;
  });
}

function iso(value) {
  const raw = text(value);
  const ms = Date.parse(raw);
  return Number.isFinite(ms) && new Date(ms).toISOString() === raw ? { raw, ms } : null;
}

function capture(command, args, options = {}) {
  const run = options.spawnSyncFn || spawnSync;
  const result = run(command, args, {
    encoding: 'utf8', shell: false, windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return Object.freeze({
    ok: !result?.error && result?.status === 0,
    status: result?.status ?? null,
    stdout: String(result?.stdout ?? ''),
    stderr: text(result?.stderr || result?.stdout || result?.error?.message),
  });
}

function parseJsonBlock(body, marker) {
  const raw = String(body ?? '');
  if (!raw.startsWith(marker) || Buffer.byteLength(raw, 'utf8') > 64 * 1024) return null;
  const blocks = [...raw.matchAll(/```json\s*([\s\S]*?)\s*```/gi)];
  if (blocks.length !== 1) return null;
  try { return JSON.parse(blocks[0][1]); } catch { return null; }
}

function defaultReadSourceHead(repoRoot, options = {}) {
  const result = capture(options.gitCommand || 'git.exe', ['-C', repoRoot, 'rev-parse', 'HEAD'], options);
  const head = text(result.stdout).toLowerCase();
  return result.ok && SHA40.test(head) ? head : '';
}

export function createFixedGitHubLifeboatLane7Adapter(options = {}) {
  const gh = options.ghCommand || process.env.STEPHANOS_GH_COMMAND || 'gh';
  const endpoint = (commentId) => `repos/${GITHUB_LIFEBOAT_LANE7_REPOSITORY}/issues/comments/${commentId}`;
  const api = (args) => capture(gh, ['api', ...args], options);
  const json = (result) => {
    if (!result.ok) return null;
    try { return JSON.parse(result.stdout); } catch { return null; }
  };
  return Object.freeze({
    readComment(commentId) {
      const payload = json(api([endpoint(commentId)]));
      return payload ? Object.freeze({ ok: true, body: String(payload.body || ''), authorLogin: text(payload.user?.login), updatedAt: text(payload.updated_at) })
        : Object.freeze({ ok: false, reason: 'LANE7_COMMENT_READ_FAILED' });
    },
    writeComment(commentId, body) {
      const result = api(['--method', 'PATCH', endpoint(commentId), '-f', `body=${body}`]);
      return Object.freeze({ ok: result.ok, reason: result.ok ? 'LANE7_COMMENT_UPDATED' : 'LANE7_COMMENT_WRITE_FAILED' });
    },
    readGitCommit(commitSha) {
      const payload = json(api([`repos/${GITHUB_LIFEBOAT_LANE7_REPOSITORY}/git/commits/${commitSha}`]));
      return payload ? Object.freeze({ ok: true, sha: text(payload.sha).toLowerCase(), treeSha: text(payload.tree?.sha).toLowerCase(), parents: Object.freeze((payload.parents || []).map((p) => text(p?.sha).toLowerCase())) })
        : Object.freeze({ ok: false, reason: 'LANE7_COMMIT_READ_FAILED' });
    },
    readBranchHead(branch) {
      const ref = branch.split('/').map(encodeURIComponent).join('/');
      const payload = json(api([`repos/${GITHUB_LIFEBOAT_LANE7_REPOSITORY}/git/ref/heads/${ref}`]));
      return payload ? Object.freeze({ ok: true, sha: text(payload.object?.sha).toLowerCase() })
        : Object.freeze({ ok: false, reason: 'LANE7_BRANCH_READ_FAILED' });
    },
    readFileAt(path, ref) {
      const encoded = path.split('/').map(encodeURIComponent).join('/');
      const payload = json(api([`repos/${GITHUB_LIFEBOAT_LANE7_REPOSITORY}/contents/${encoded}?ref=${encodeURIComponent(ref)}`]));
      if (!payload || Array.isArray(payload) || text(payload.encoding).toLowerCase() !== 'base64') return Object.freeze({ ok: false, reason: 'LANE7_FILE_READ_FAILED' });
      let bytes;
      try { bytes = Buffer.from(String(payload.content || '').replace(/\s+/g, ''), 'base64'); } catch { return Object.freeze({ ok: false, reason: 'LANE7_FILE_DECODE_FAILED' }); }
      return Object.freeze({ ok: true, blobSha: text(payload.sha).toLowerCase(), sha256: createHash('sha256').update(bytes).digest('hex') });
    },
    readCommitChangedFiles(parentHead, resultCommit) {
      const payload = json(api([`repos/${GITHUB_LIFEBOAT_LANE7_REPOSITORY}/compare/${parentHead}...${resultCommit}`]));
      if (!payload || text(payload.status).toLowerCase() !== 'ahead' || Number(payload.ahead_by) !== 1 || Number(payload.total_commits) !== 1 || !Array.isArray(payload.files)) {
        return Object.freeze({ ok: false, reason: 'LANE7_COMMIT_DIFF_READ_FAILED' });
      }
      const files = payload.files.map((file) => safePath(file?.filename)).filter(Boolean).sort();
      if (files.length !== payload.files.length || new Set(files).size !== files.length) return Object.freeze({ ok: false, reason: 'LANE7_COMMIT_DIFF_INVALID' });
      return Object.freeze({ ok: true, files: Object.freeze(files) });
    },
  });
}

function renderOutbox(payload) {
  return `${GITHUB_LIFEBOAT_LANE7_OUTBOX_MARKER}\n## Lane 7 GitHub Lifeboat Outbox\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n\nFixed read-only projection of at most one canonical \`chatgpt-github\` Mission Worker handoff. The Mission Worker queue and Shared Workspace remain authoritative. This comment grants no source, merge, deployment, runtime, lease-seizure or arbitrary-command authority.`;
}

function validateInbox(observed, sourceHead, nowMs) {
  if (!observed?.ok || observed.authorLogin !== OWNER) return Object.freeze({ ok: false, state: 'BLOCKED', reason: 'LANE7_INBOX_AUTHENTICATION_FAILED' });
  const envelope = parseJsonBlock(observed.body, GITHUB_LIFEBOAT_LANE7_INBOX_MARKER);
  if (!envelope || envelope.schemaVersion !== GITHUB_LIFEBOAT_LANE7_INBOX_SCHEMA) return Object.freeze({ ok: false, state: 'BLOCKED', reason: 'LANE7_INBOX_SCHEMA_INVALID' });
  if (envelope.state === 'IDLE') return Object.freeze({ ok: true, state: 'IDLE', envelope });
  if (!['READY', 'CLAIMED', 'COMPLETED'].includes(envelope.state)) return Object.freeze({ ok: false, state: 'BLOCKED', reason: 'LANE7_INBOX_STATE_INVALID' });
  if (envelope.workerId !== GITHUB_LIFEBOAT_LANE7_WORKER_ID || text(envelope.sourceHead).toLowerCase() !== sourceHead) return Object.freeze({ ok: false, state: 'BLOCKED', reason: 'LANE7_INBOX_IDENTITY_MISMATCH' });
  const observedAt = iso(envelope.observedAtUtc);
  const expiresAt = iso(envelope.expiresAtUtc);
  if (!observedAt || !expiresAt || observedAt.ms > nowMs + 60_000 || expiresAt.ms <= nowMs || expiresAt.ms <= observedAt.ms || expiresAt.ms - observedAt.ms > MAX_WINDOW_MS) {
    return Object.freeze({ ok: false, state: 'BLOCKED', reason: 'LANE7_INBOX_FRESHNESS_INVALID' });
  }
  const latency = Number(envelope.p95StartLatencySeconds);
  if (!Number.isFinite(latency) || latency < 0 || latency > 600) return Object.freeze({ ok: false, state: 'BLOCKED', reason: 'LANE7_INBOX_LATENCY_INVALID' });
  if (envelope.state === 'CLAIMED' && (!envelope.claim || !SAFE_ID.test(text(envelope.claim.actionId)) || !SAFE_ID.test(text(envelope.claim.missionId)))) {
    return Object.freeze({ ok: false, state: 'BLOCKED', reason: 'LANE7_CLAIM_INVALID' });
  }
  if (envelope.state === 'COMPLETED' && (!envelope.completion || !SAFE_ID.test(text(envelope.completion.actionId)) || !SAFE_ID.test(text(envelope.completion.missionId)))) {
    return Object.freeze({ ok: false, state: 'BLOCKED', reason: 'LANE7_COMPLETION_INVALID' });
  }
  return Object.freeze({ ok: true, state: envelope.state, envelope, observedAtUtc: observedAt.raw, expiresAtUtc: expiresAt.raw, latency });
}

function authorityBoundary() {
  return Object.freeze({ mergeAuthority: false, deploymentAuthority: false, runtimeMutationAuthority: false, leaseSeizureAllowed: false, arbitraryCommandAllowed: false });
}

function unavailable(reason, extra = {}) {
  return Object.freeze({ ok: false, available: false, workerId: GITHUB_LIFEBOAT_LANE7_WORKER_ID, reason, ...authorityBoundary(), ...extra });
}

async function publishLane7Capacity({ inbox, sourceHead, queue, paths, now, options }) {
  if (!inbox.ok || inbox.state === 'IDLE') return unavailable(inbox.reason || 'LANE7_EXTERNAL_WORKER_IDLE', { sourceHead });
  const proofRef = `proof/github-lifeboat-lane7-capacity-${sourceHead}.json`;
  const proofFile = proofRef.replace(/^proof\//, '');
  const proof = Object.freeze({
    ...createSharedWorkspaceProofRecord({
      proofId: `github-lifeboat-lane7-${sourceHead}`,
      participantId: GITHUB_LIFEBOAT_LANE7_WORKER_ID,
      timestampUtc: inbox.observedAtUtc,
      correlationId: `lane7-${sourceHead.slice(0, 16)}`,
      relatedIssue: '#1506',
      status: 'PASS',
      summary: `Lane 7 external ChatGPT/GitHub worker refreshed the fixed authenticated inbox on exact source ${sourceHead}.`,
      refs: [proofRef], proofRefs: [proofRef],
    }),
    schema: GITHUB_LIFEBOAT_LANE7_SCHEMA,
    sourceHead,
    workerId: GITHUB_LIFEBOAT_LANE7_WORKER_ID,
    inboxCommentId: GITHUB_LIFEBOAT_LANE7_INBOX_COMMENT_ID,
    observedAtUtc: inbox.observedAtUtc,
    expiresAtUtc: inbox.expiresAtUtc,
    sourceConstructionAllowed: true,
    focusedTestsAllowed: true,
    ...authorityBoundary(),
    finalVerdict: 'GITHUB_LIFEBOAT_LANE7_EXTERNAL_CAPACITY_PROVEN',
  });
  const writeProof = options.writeProof || (async (record) => writeAtomicJson(paths.workspaceRoot, ['proof', proofFile], record, { repoRoot: paths.repoRoot, nowMs: now.getTime() }));
  const proofWrite = await writeProof(proof);
  if (proofWrite?.ok !== true) return unavailable(`LANE7_PROOF_PUBLICATION_FAILED:${text(proofWrite?.reason, 'unknown')}`, { sourceHead });
  const queueDepth = queue.filter((entry) => text(entry.adapter).toLowerCase() === 'chatgpt-github').length;
  const observation = Object.freeze({
    receiptId: `github-lifeboat-lane7-${sha256(`${sourceHead}\n${inbox.observedAtUtc}\n${inbox.expiresAtUtc}`).slice(0, 24)}`,
    route: MISSION_CONTROLLER_ROUTE.CHATGPT_GITHUB,
    repository: GITHUB_LIFEBOAT_LANE7_REPOSITORY,
    workerId: GITHUB_LIFEBOAT_LANE7_WORKER_ID,
    supportedTaskClasses: GITHUB_LIFEBOAT_LANE7_TASK_CLASSES,
    observedAtUtc: inbox.observedAtUtc,
    expiresAtUtc: new Date(Math.min(Date.parse(inbox.expiresAtUtc), now.getTime() + RECEIPT_WINDOW_MS)).toISOString(),
    queueDepth,
    p95StartLatencySeconds: inbox.latency,
    authorityReceiptIds: Object.freeze([]),
    proofRefs: Object.freeze([proofRef]),
  });
  const publish = options.publishCapacity || ((record) => publishGitHubContinuityCapacityPublicationV1(paths.workspaceRoot, record, { repoRoot: paths.repoRoot, nowUtc: now.toISOString() }));
  const publication = await publish(observation);
  const published = publication?.finalVerdict === 'GITHUB_CONTINUITY_CAPACITY_PUBLISHED' || publication?.publication?.ok === true;
  return published ? Object.freeze({ ok: true, available: true, sourceHead, queueDepth, observation, publication, proofWrite, ...authorityBoundary(), finalVerdict: 'GITHUB_LIFEBOAT_LANE7_CAPACITY_PUBLISHED' })
    : unavailable(`LANE7_CAPACITY_PUBLICATION_FAILED:${text(publication?.blocker || publication?.publication?.reason, 'unknown')}`, { sourceHead, proofWrite });
}

async function readPersistedHandoff(entry, paths, nowMs, options) {
  const actionId = text(entry?.item?.actionId || entry?.item?.payload?.actionId).toLowerCase();
  if (!actionId) return null;
  if (typeof options.readWorkspaceHandoff === 'function') return options.readWorkspaceHandoff(actionId, entry);
  try {
    const handoff = JSON.parse(await readFile(resolve(paths.workspaceRoot, 'outbox', `${actionId}.json`), 'utf8'));
    const validation = validateSharedWorkspaceRecord(handoff, { nowMs });
    return validation.valid && !validation.stale && text(handoff.toParticipantId).toLowerCase() === 'chatgpt' && text(handoff.correlationId).toLowerCase() === text(entry.item?.missionId).toLowerCase() ? handoff : null;
  } catch { return null; }
}

function projectedHandoff(entry, handoff, sourceHead) {
  const item = entry.item || {};
  const action = item.payload || {};
  const grant = item.actionGrant || {};
  const allowedFiles = (Array.isArray(action.allowedFiles) ? action.allowedFiles : []).map(safeScope).filter(Boolean);
  const requiredTests = Array.isArray(action.requiredTests) ? action.requiredTests.map(text).filter(Boolean) : [];
  const missionId = text(item.missionId).toLowerCase();
  const actionId = text(item.actionId).toLowerCase();
  const repository = text(grant.repository || action.repository);
  const headSha = text(grant.headSha || grant.sourceRevision).toLowerCase();
  const sourceRevision = text(grant.sourceRevision || sourceHead).toLowerCase();
  const identityValid = item.schemaVersion === 'stephanos.mission-worker-queue-item.v1'
    && text(item.adapter).toLowerCase() === 'chatgpt-github'
    && text(action.adapter).toLowerCase() === 'chatgpt-github'
    && SAFE_ID.test(missionId) && SAFE_ID.test(actionId)
    && text(action.missionId).toLowerCase() === missionId && text(action.actionId).toLowerCase() === actionId
    && repository === GITHUB_LIFEBOAT_LANE7_REPOSITORY && headSha === sourceHead && sourceRevision === sourceHead;
  if (!identityValid || !allowedFiles.length || allowedFiles.length > MAX_FOCUSED_SCOPES || requiredTests.length > MAX_TESTS) {
    return Object.freeze({ held: true, reason: identityValid ? 'LANE7_FOCUSED_REPAIR_SCOPE_TOO_WIDE' : 'LANE7_HANDOFF_IDENTITY_INVALID' });
  }
  return Object.freeze({
    held: false,
    missionId, actionId, repository,
    issueNumber: Number(grant.issueNumber) || null,
    prNumber: Number(grant.prNumber) || null,
    branch: text(grant.branch || action.branch),
    headSha, sourceRevision,
    allowedFiles: Object.freeze(allowedFiles),
    requiredTests: Object.freeze(requiredTests),
    requiredEvidence: Object.freeze((Array.isArray(action.requiredEvidence) ? action.requiredEvidence : []).map(text).filter(Boolean).slice(0, 16)),
    capacityReceiptId: text(action.capacityReceiptId),
    capacityProofRefs: Object.freeze((Array.isArray(action.capacityProofRefs) ? action.capacityProofRefs : []).map(text).filter(Boolean).slice(0, 16)),
    createdAtUtc: text(item.createdAt),
    escrowDigestAlgorithm: 'sha256-json-v1',
    escrowArtifactKind: 'EXACT_COMMIT',
    authoritativeHandoffId: text(handoff?.handoffId || item.actionId),
    authority: authorityBoundary(),
  });
}

async function publishOutbox({ queue, sourceHead, paths, now, adapter, options }) {
  const pending = queue.filter((entry) => text(entry.adapter).toLowerCase() === 'chatgpt-github' && entry?.item).sort((a, b) => text(a.item.createdAt).localeCompare(text(b.item.createdAt)));
  let payload = Object.freeze({ schemaVersion: GITHUB_LIFEBOAT_LANE7_OUTBOX_SCHEMA, state: 'IDLE', sourceHead, handoff: null });
  if (pending.length) {
    const entry = pending[0];
    const handoff = await readPersistedHandoff(entry, paths, now.getTime(), options);
    if (handoff) {
      const projected = projectedHandoff(entry, handoff, sourceHead);
      payload = projected.held
        ? Object.freeze({ schemaVersion: GITHUB_LIFEBOAT_LANE7_OUTBOX_SCHEMA, state: 'HELD', sourceHead, blocker: projected.reason, handoff: null })
        : Object.freeze({ schemaVersion: GITHUB_LIFEBOAT_LANE7_OUTBOX_SCHEMA, state: 'HANDOFF_READY', sourceHead, handoff: projected });
    }
  }
  const write = options.writeOutbox || ((body) => adapter.writeComment(GITHUB_LIFEBOAT_LANE7_OUTBOX_COMMENT_ID, body));
  const result = await write(renderOutbox(payload));
  return Object.freeze({ ok: result?.ok === true, payload, publication: result, finalVerdict: result?.ok === true ? 'GITHUB_LIFEBOAT_LANE7_OUTBOX_PUBLISHED' : 'GITHUB_LIFEBOAT_LANE7_OUTBOX_BLOCKED' });
}

function receiptOptions(paths, options) {
  return { repoRoot: paths.repoRoot, ...(options.executionReceiptOptions || {}) };
}

async function latestReceipt(claim, paths, options) {
  const binding = claim?.item?.executionBinding;
  if (!binding?.executionId || !binding?.leaseKey || !binding?.headSha) return null;
  const read = options.readExecutionReceiptHistory || readExecutionReceiptHistory;
  const history = await read(paths.workspaceRoot, { executionId: binding.executionId, leaseKey: binding.leaseKey, expectedHead: binding.headSha }, receiptOptions(paths, options));
  if (history?.ok !== true) throw new Error(`LANE7_EXECUTION_RECEIPT_HISTORY_BLOCKED:${text(history?.reason, 'unknown')}`);
  return history.latestReceipt || null;
}

async function appendReceipt(previous, state, phase, paths, now, options, additions = {}) {
  if (!previous) return null;
  const create = options.createExecutionReceipt || createExecutionReceipt;
  const append = options.appendExecutionReceipt || appendExecutionReceipt;
  const previousMs = Date.parse(previous.timestampUtc || '');
  const timestampUtc = new Date(Math.max(now.getTime(), Number.isFinite(previousMs) ? previousMs + 1 : now.getTime())).toISOString();
  const receipt = create({
    repository: previous.repository, issueNumber: previous.issueNumber, prNumber: previous.prNumber, branch: previous.branch,
    sourceHead: previous.sourceHead, workerId: previous.workerId, workerType: previous.workerType, executionId: previous.executionId,
    leaseKey: previous.leaseKey, state, phase, sequence: previous.sequence + 1, predecessorReceiptId: previous.receiptId,
    timestampUtc, blocker: additions.blocker || '', operatorActionRequired: false,
    proofRefs: additions.proofRefs || previous.proofRefs,
    expectedNextAction: additions.expectedNextAction || '',
  });
  const stored = await append(paths.workspaceRoot, receipt, receiptOptions(paths, options));
  if (stored?.ok !== true) throw new Error(`LANE7_EXECUTION_RECEIPT_APPEND_FAILED:${text(stored?.reason, 'unknown')}`);
  return receipt;
}

async function validatedClaimTarget(inbox, queue, sourceHead, paths, now, options) {
  if (inbox.state !== 'CLAIMED') return null;
  const requested = inbox.envelope.claim;
  const matches = queue.filter((entry) => text(entry.adapter).toLowerCase() === 'chatgpt-github'
    && text(entry?.item?.actionId).toLowerCase() === text(requested.actionId).toLowerCase()
    && text(entry?.item?.missionId).toLowerCase() === text(requested.missionId).toLowerCase());
  if (matches.length !== 1) return Object.freeze({ ok: false, reason: 'LANE7_CLAIM_NOT_EXACTLY_ONE_PENDING_HANDOFF' });
  const entry = matches[0];
  const handoff = await readPersistedHandoff(entry, paths, now.getTime(), options);
  if (!handoff) return Object.freeze({ ok: false, reason: 'LANE7_CLAIM_AUTHORITATIVE_HANDOFF_UNPROVEN' });
  const projected = projectedHandoff(entry, handoff, sourceHead);
  if (projected.held) return Object.freeze({ ok: false, reason: projected.reason });
  if (projected.actionId !== text(requested.actionId).toLowerCase() || projected.missionId !== text(requested.missionId).toLowerCase()) {
    return Object.freeze({ ok: false, reason: 'LANE7_CLAIM_PROJECTED_HANDOFF_MISMATCH' });
  }
  return Object.freeze({ ok: true, entry, projected });
}

async function beginClaim(inbox, queue, sourceHead, paths, now, options) {
  if (inbox.state !== 'CLAIMED') return null;
  const target = await validatedClaimTarget(inbox, queue, sourceHead, paths, now, options);
  if (!target?.ok) return target;
  const claimRequest = inbox.envelope.claim;
  const queueRoot = options.queueRoot || resolveMissionWorkerQueueRoot(options.env || process.env);
  const claimFn = options.claimNext || claimNextMissionWorkerItem;
  const claim = await claimFn('chatgpt-github', { queueRoot, actionGrant: { adapter: 'chatgpt-github', missionId: claimRequest.missionId, actionId: claimRequest.actionId } });
  if (!claim) return Object.freeze({ ok: false, reason: 'LANE7_CLAIM_NOT_PENDING', actionId: claimRequest.actionId });
  try {
    let receipt = await latestReceipt(claim, paths, options);
    if (receipt && receipt.state !== 'queued') throw new Error(`LANE7_CLAIM_RECEIPT_STATE_INVALID:${receipt.state}`);
    if (receipt) {
      receipt = await appendReceipt(receipt, 'accepted', 'external-github-lifeboat-claim-accepted', paths, now, options, { expectedNextAction: 'External GitHub worker may begin the exact bounded source handoff.' });
      receipt = await appendReceipt(receipt, 'started', 'external-github-lifeboat-started', paths, now, options, { expectedNextAction: 'External GitHub worker must preserve source in an externally readable exact commit.' });
      receipt = await appendReceipt(receipt, 'progress', 'external-github-lifeboat-building', paths, now, options, { expectedNextAction: 'Return escrow-bound tested completion through the fixed Lane 7 inbox.' });
    }
    return Object.freeze({ ok: true, actionId: claimRequest.actionId, missionId: claimRequest.missionId, processingPath: claim.processingPath, executionReceipt: receipt, finalVerdict: 'GITHUB_LIFEBOAT_LANE7_CLAIMED' });
  } catch (error) {
    await rename(claim.processingPath, resolve(claim.paths.pending, basename(claim.processingPath))).catch(() => {});
    throw error;
  }
}

async function loadProcessingClaim(actionId, options = {}) {
  if (typeof options.loadProcessingClaim === 'function') return options.loadProcessingClaim(actionId);
  const root = options.queueRoot || resolveMissionWorkerQueueRoot(options.env || process.env);
  if (!root) return null;
  const paths = { pending: resolve(root, 'chatgpt-github', 'pending'), processing: resolve(root, 'chatgpt-github', 'processing'), completed: resolve(root, 'chatgpt-github', 'completed'), failed: resolve(root, 'chatgpt-github', 'failed') };
  const processingPath = resolve(paths.processing, `${actionId}.json`);
  try { return { adapter: 'chatgpt-github', item: JSON.parse(await readFile(processingPath, 'utf8')), processingPath, paths }; } catch { return null; }
}

function escrowDigest(escrow) {
  const files = (Array.isArray(escrow?.changedFiles) ? escrow.changedFiles : []).map((file) => ({ path: text(file.path), beforeBlobSha: text(file.beforeBlobSha).toLowerCase(), afterBlobSha: text(file.afterBlobSha).toLowerCase(), sha256: text(file.sha256).toLowerCase() })).sort((a, b) => a.path.localeCompare(b.path));
  return sha256(JSON.stringify({ commitSha: text(escrow?.localCommitSha).toLowerCase(), resultTree: text(escrow?.exactResultTree).toLowerCase(), changedFiles: files }));
}

async function verifyPublishedEscrow(escrow, claim, adapter, options) {
  if (typeof options.verifyPublishedEscrow === 'function') return options.verifyPublishedEscrow(escrow, claim);
  if (escrow?.artifactKind !== 'EXACT_COMMIT' || escrow?.executorIdentity !== 'chatgpt-github') return Object.freeze({ ok: false, reason: 'LANE7_ESCROW_KIND_OR_EXECUTOR_INVALID' });
  const action = claim.item.payload || {};
  const grant = claim.item.actionGrant || {};
  const branch = text(grant.branch || action.branch);
  const parentHead = text(grant.headSha || grant.sourceRevision).toLowerCase();
  const resultCommit = text(escrow.localCommitSha).toLowerCase();
  if (!branch || !SHA40.test(parentHead) || !SHA40.test(resultCommit)) return Object.freeze({ ok: false, reason: 'LANE7_ESCROW_BRANCH_IDENTITY_INVALID' });
  if (text(escrow.canonicalBranch) !== branch || text(escrow.exactParentHead).toLowerCase() !== parentHead) return Object.freeze({ ok: false, reason: 'LANE7_ESCROW_PARENT_MISMATCH' });
  if (text(escrow.artifactRef) !== `https://github.com/${GITHUB_LIFEBOAT_LANE7_REPOSITORY}/commit/${resultCommit}`) return Object.freeze({ ok: false, reason: 'LANE7_ESCROW_ARTIFACT_REF_INVALID' });
  if (text(escrow.completeArtifactSha256).toLowerCase() !== escrowDigest(escrow)) return Object.freeze({ ok: false, reason: 'LANE7_ESCROW_DIGEST_INVALID' });
  const [commit, parent, branchHead, diff] = await Promise.all([
    adapter.readGitCommit(resultCommit), adapter.readGitCommit(parentHead), adapter.readBranchHead(branch), adapter.readCommitChangedFiles(parentHead, resultCommit),
  ]);
  if (!commit.ok || !parent.ok || !branchHead.ok || !diff.ok || branchHead.sha !== resultCommit || commit.parents[0] !== parentHead || commit.treeSha !== text(escrow.exactResultTree).toLowerCase() || parent.treeSha !== text(escrow.exactParentTree).toLowerCase()) {
    return Object.freeze({ ok: false, reason: 'LANE7_ESCROW_GITHUB_IDENTITY_UNPROVEN' });
  }
  const files = Array.isArray(escrow.changedFiles) ? escrow.changedFiles : [];
  if (!files.length || files.length > MAX_FOCUSED_SCOPES) return Object.freeze({ ok: false, reason: 'LANE7_ESCROW_CHANGED_FILES_INVALID' });
  const escrowPaths = files.map((file) => safePath(file.path)).filter(Boolean).sort();
  if (escrowPaths.length !== files.length || JSON.stringify(escrowPaths) !== JSON.stringify([...diff.files].sort())) {
    return Object.freeze({ ok: false, reason: 'LANE7_ESCROW_COMPLETE_DIFF_MISMATCH' });
  }
  for (const file of files) {
    const path = safePath(file.path);
    if (!path || !pathAllowed(path, action.allowedFiles || [])) return Object.freeze({ ok: false, reason: `LANE7_ESCROW_SCOPE_VIOLATION:${path || 'invalid'}` });
    const [before, after] = await Promise.all([adapter.readFileAt(path, parentHead), adapter.readFileAt(path, resultCommit)]);
    if (!before.ok || !after.ok || before.blobSha !== text(file.beforeBlobSha).toLowerCase() || after.blobSha !== text(file.afterBlobSha).toLowerCase() || after.sha256 !== text(file.sha256).toLowerCase()) return Object.freeze({ ok: false, reason: `LANE7_ESCROW_FILE_IDENTITY_UNPROVEN:${path}` });
  }
  return Object.freeze({ ok: true, branch, parentHead, resultCommit, changedFiles: Object.freeze(escrowPaths) });
}

function validResultReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object' || receipt.verified !== true || !text(receipt.requirement) || !text(receipt.source) || !text(receipt.evidenceType)) return false;
  return SHA256.test(text(receipt.sha256)) || SHA256.test(text(receipt.commandOutputHash)) || Number(receipt.exitCode) === 0;
}

async function finishProcessingClaim(claim, result, success) {
  await mkdir(success ? claim.paths.completed : claim.paths.failed, { recursive: true });
  const target = success ? claim.paths.completed : claim.paths.failed;
  const fileName = basename(claim.processingPath);
  const resultPath = resolve(target, fileName.replace(/\.json$/, '.result.json'));
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  await rename(claim.processingPath, resolve(target, fileName));
  return resultPath;
}

async function applyCompletion(inbox, paths, now, adapter, options) {
  if (inbox.state !== 'COMPLETED') return null;
  const completion = inbox.envelope.completion;
  const actionId = text(completion.actionId).toLowerCase();
  const missionId = text(completion.missionId).toLowerCase();
  const claim = await loadProcessingClaim(actionId, options);
  if (!claim || text(claim.item?.missionId).toLowerCase() !== missionId) return Object.freeze({ ok: false, reason: 'LANE7_COMPLETION_NO_MATCHING_PROCESSING_CLAIM', actionId, missionId });
  const action = claim.item.payload || {};
  const grant = claim.item.actionGrant || {};
  if (text(action.actionId).toLowerCase() !== actionId || text(action.missionId).toLowerCase() !== missionId || text(action.adapter).toLowerCase() !== 'chatgpt-github') return Object.freeze({ ok: false, reason: 'LANE7_COMPLETION_ACTION_IDENTITY_MISMATCH' });
  const success = completion.success === true;
  const changedFiles = (Array.isArray(completion.changedFiles) ? completion.changedFiles : []).map(safePath).filter(Boolean);
  if (success && (!changedFiles.length || !validResultReceipt(completion.receipt) || !Array.isArray(completion.evidenceReceipts) || completion.evidenceReceipts.length === 0)) return Object.freeze({ ok: false, reason: 'LANE7_COMPLETION_EVIDENCE_INVALID' });
  let escrowVerification = null;
  if (success) {
    escrowVerification = await verifyPublishedEscrow(completion.sourceArtifactEscrow, claim, adapter, options);
    if (!escrowVerification.ok) return Object.freeze({ ok: false, reason: escrowVerification.reason });
    const escrow = completion.sourceArtifactEscrow;
    const escrowPaths = escrow.changedFiles.map((file) => safePath(file.path)).sort();
    if (JSON.stringify([...changedFiles].sort()) !== JSON.stringify(escrowPaths)) return Object.freeze({ ok: false, reason: 'LANE7_COMPLETION_ESCROW_FILE_SET_MISMATCH' });
    const canonicalIssue = Number(grant.issueNumber) > 0 ? Number(grant.issueNumber) : null;
    const canonicalPr = Number(grant.prNumber) > 0 ? Number(grant.prNumber) : null;
    const gate = gateSourceWorkerCompletionV1({
      stage: 'TESTED', sourceChanged: true, testsPassed: true, terminalRequested: true,
      escrow, nowUtc: text(completion.completedAtUtc, now.toISOString()),
      expectedIdentity: {
        missionId, actionId, repository: GITHUB_LIFEBOAT_LANE7_REPOSITORY, canonicalIssue, canonicalPr,
        canonicalBranch: text(grant.branch || action.branch), exactParentHead: text(grant.headSha || grant.sourceRevision).toLowerCase(),
        exactParentTree: text(escrow.exactParentTree).toLowerCase(), exactResultTree: text(escrow.exactResultTree).toLowerCase(),
        executorIdentity: 'chatgpt-github', changedFiles: escrow.changedFiles,
      },
    });
    if (!gate.terminalReceiptAllowed) return Object.freeze({ ok: false, reason: gate.finalVerdict, gate });
  }
  const collect = options.collectResult || collectAgentWorkerResult;
  const applied = await collect({
    missionId, actionId, adapter: 'chatgpt-github', success,
    resultId: success ? text(completion.resultId, actionId) : '', changedFiles: success ? changedFiles : [],
    receipt: completion.receipt, evidenceReceipts: success ? completion.evidenceReceipts : [],
    error: success ? '' : text(completion.error, 'Lane 7 external build failed.'),
  }, { ...options, queueRoot: options.queueRoot, env: options.env });
  let terminalReceipt = await latestReceipt(claim, paths, options);
  if (terminalReceipt && terminalReceipt.state === 'progress') {
    terminalReceipt = await appendReceipt(terminalReceipt, success ? 'completed' : 'failed', success ? 'external-github-lifeboat-result-validated' : 'external-github-lifeboat-result-blocked', paths, now, options, {
      blocker: success ? '' : text(completion.error, 'LANE7_EXTERNAL_BUILD_FAILED'),
      proofRefs: success ? (completion.evidenceReceipts || []).flatMap((r) => r?.receiptPath ? [r.receiptPath] : []).filter(Boolean) : terminalReceipt.proofRefs,
      expectedNextAction: success ? 'Release/refill may consume this terminal receipt after exact-head review handoff.' : 'Surface blocker and preserve authority closure.',
    });
  }
  const result = Object.freeze({ schemaVersion: GITHUB_LIFEBOAT_LANE7_SCHEMA, actionId, missionId, success, changedFiles, stateRevision: applied?.state?.revision ?? null, currentPhase: applied?.state?.currentPhase || '', escrowVerification, finalVerdict: success ? 'GITHUB_LIFEBOAT_LANE7_SOURCE_CHANGED_AND_TESTED' : 'GITHUB_LIFEBOAT_LANE7_BUILD_BLOCKED' });
  const resultPath = await finishProcessingClaim(claim, result, success);
  return Object.freeze({ ok: true, result, resultPath, terminalReceipt, ...authorityBoundary() });
}

export async function refreshGitHubLifeboatLane7Capacity(options = {}) {
  const env = options.env || process.env;
  const resolvedPaths = options.paths || resolveCriticalBacklogRuntimePaths({ env });
  const repositoryRoot = text(options.repositoryRoot);
  const paths = repositoryRoot
    ? Object.freeze({ ...resolvedPaths, repoRoot: resolve(repositoryRoot) })
    : resolvedPaths;
  const now = options.now instanceof Date ? options.now : new Date();
  const readSourceHead = options.readSourceHead || ((root) => defaultReadSourceHead(root, options));
  const sourceHead = text(await readSourceHead(paths.repoRoot)).toLowerCase();
  if (!SHA40.test(sourceHead)) return unavailable('LANE7_SOURCE_HEAD_UNPROVEN');

  const expectedSourceHead = text(options.expectedSourceHead).toLowerCase();
  if (expectedSourceHead && (!SHA40.test(expectedSourceHead) || expectedSourceHead !== sourceHead)) {
    return unavailable('LANE7_SOURCE_HEAD_MISMATCH', { sourceHead, expectedSourceHead });
  }

  const adapter = options.adapter || createFixedGitHubLifeboatLane7Adapter(options);
  const observed = await adapter.readComment(GITHUB_LIFEBOAT_LANE7_INBOX_COMMENT_ID);
  const inbox = validateInbox(observed, sourceHead, now.getTime());
  const readQueue = options.readQueue || readMissionWorkerQueue;
  const queue = await readQueue({ env, queueRoot: options.queueRoot });
  const capacity = await publishLane7Capacity({ inbox, sourceHead, queue, paths, now, options });

  return Object.freeze({
    schemaVersion: GITHUB_LIFEBOAT_LANE7_SCHEMA,
    ok: capacity?.ok === true,
    available: capacity?.available === true,
    sourceHead,
    inbox,
    capacity,
    ...authorityBoundary(),
    finalVerdict: capacity?.available === true
      ? 'GITHUB_LIFEBOAT_LANE7_CAPACITY_REFRESHED'
      : 'GITHUB_LIFEBOAT_LANE7_IDLE_OR_UNAVAILABLE',
  });
}

export async function runGitHubLifeboatLane7(options = {}) {
  const env = options.env || process.env;
  const paths = options.paths || resolveCriticalBacklogRuntimePaths({ env });
  const now = options.now instanceof Date ? options.now : new Date();
  const readSourceHead = options.readSourceHead || ((root) => defaultReadSourceHead(root, options));
  const sourceHead = text(await readSourceHead(paths.repoRoot)).toLowerCase();
  if (!SHA40.test(sourceHead)) return unavailable('LANE7_SOURCE_HEAD_UNPROVEN');
  const adapter = options.adapter || createFixedGitHubLifeboatLane7Adapter(options);
  const observed = await adapter.readComment(GITHUB_LIFEBOAT_LANE7_INBOX_COMMENT_ID);
  const inbox = validateInbox(observed, sourceHead, now.getTime());
  const readQueue = options.readQueue || readMissionWorkerQueue;
  const queue = await readQueue({ env, queueRoot: options.queueRoot });
  const capacity = await publishLane7Capacity({ inbox, sourceHead, queue, paths, now, options });
  let claim = null;
  let completion = null;
  try {
    claim = await beginClaim(inbox, queue, sourceHead, paths, now, options);
    completion = await applyCompletion(inbox, paths, now, adapter, options);
  } catch (error) {
    return Object.freeze({ schemaVersion: GITHUB_LIFEBOAT_LANE7_SCHEMA, ok: false, sourceHead, inbox, capacity, claim, completion, blocker: text(error?.message, 'LANE7_EXECUTION_FAILED'), ...authorityBoundary(), finalVerdict: 'GITHUB_LIFEBOAT_LANE7_BLOCKED' });
  }
  const refreshedQueue = await readQueue({ env, queueRoot: options.queueRoot });
  const outbox = await publishOutbox({ queue: refreshedQueue, sourceHead, paths, now, adapter, options });
  return Object.freeze({
    schemaVersion: GITHUB_LIFEBOAT_LANE7_SCHEMA,
    ok: inbox.ok && outbox.ok,
    sourceHead, inbox, capacity, claim, completion, outbox,
    ...authorityBoundary(),
    finalVerdict: completion?.ok && completion?.result?.success
      ? 'GITHUB_LIFEBOAT_LANE7_SOURCE_CHANGED_AND_TESTED'
      : claim?.ok
        ? 'GITHUB_LIFEBOAT_LANE7_EXTERNAL_BUILD_CLAIMED'
        : capacity.available
          ? 'GITHUB_LIFEBOAT_LANE7_READY'
          : 'GITHUB_LIFEBOAT_LANE7_IDLE_OR_UNAVAILABLE',
  });
}
