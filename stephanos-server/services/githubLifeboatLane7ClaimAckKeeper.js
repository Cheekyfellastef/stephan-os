import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { resolveMissionWorkerQueueRoot } from './missionOrchestratorWorkerService.js';
import {
  GITHUB_LIFEBOAT_LANE7_OUTBOX_COMMENT_ID,
  GITHUB_LIFEBOAT_LANE7_OUTBOX_MARKER,
  GITHUB_LIFEBOAT_LANE7_OUTBOX_SCHEMA,
  GITHUB_LIFEBOAT_LANE7_REPOSITORY,
} from './githubLifeboatLane7Service.js';

export const GITHUB_LIFEBOAT_LANE7_CLAIM_ACK_KEEPER_SCHEMA = 'stephanos.github-lifeboat-lane7-claim-ack-keeper.v1';

const SHA40 = /^[0-9a-f]{40}$/i;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,160}$/;
const SAFE_PATH = /^(?!\/)(?![A-Za-z]:\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._@+ -]+(?:\/[A-Za-z0-9._@+ -]+)*$/;
const MAX_FILES = 12;
const MAX_TESTS = 12;

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function safePath(value) {
  const candidate = text(value).replace(/\\/g, '/').replace(/^\.\/+/, '');
  return SAFE_PATH.test(candidate)
    && !/(^|\/)(?:\.git|node_modules|runtime|runtime-data|data|tmp)(?:\/|$)|(^|\/)\.env(?:\.|$)|\.(?:pem|pfx|key)$/i.test(candidate)
    ? candidate
    : '';
}

function authorityBoundary() {
  return Object.freeze({
    mergeAuthority: false,
    deploymentAuthority: false,
    runtimeMutationAuthority: false,
    leaseSeizureAllowed: false,
    arbitraryCommandAllowed: false,
  });
}

function renderOutbox(payload) {
  return `${GITHUB_LIFEBOAT_LANE7_OUTBOX_MARKER}\n## Lane 7 GitHub Lifeboat Outbox\n\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\`\n\nFixed read-only projection of one already-accepted canonical \`chatgpt-github\` Mission Worker claim. The Mission Worker queue remains authoritative. This acknowledgement grants no merge, deployment, runtime, lease-seizure or arbitrary-command authority.`;
}

function capture(command, args, options = {}) {
  const run = options.spawnSyncFn || spawnSync;
  const result = run(command, args, {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return Object.freeze({
    ok: !result?.error && result?.status === 0,
    status: result?.status ?? null,
    stderr: text(result?.stderr || result?.stdout || result?.error?.message),
  });
}

function defaultWriteOutbox(body, options = {}) {
  const gh = options.ghCommand || process.env.STEPHANOS_GH_COMMAND || 'gh';
  const endpoint = `repos/${GITHUB_LIFEBOAT_LANE7_REPOSITORY}/issues/comments/${GITHUB_LIFEBOAT_LANE7_OUTBOX_COMMENT_ID}`;
  const result = capture(gh, ['api', '--method', 'PATCH', endpoint, '-f', `body=${body}`], options);
  return Object.freeze({
    ok: result.ok,
    reason: result.ok ? 'LANE7_CLAIM_ACK_OUTBOX_UPDATED' : 'LANE7_CLAIM_ACK_OUTBOX_WRITE_FAILED',
  });
}

function validateProcessingItem(item, sourceHead) {
  const action = item?.payload || {};
  const grant = item?.actionGrant || {};
  const missionId = text(item?.missionId).toLowerCase();
  const actionId = text(item?.actionId).toLowerCase();
  const allowedFiles = (Array.isArray(action.allowedFiles) ? action.allowedFiles : []).map(safePath).filter(Boolean);
  const requiredTests = (Array.isArray(action.requiredTests) ? action.requiredTests : []).map(text).filter(Boolean);
  const grantHead = text(grant.headSha || grant.sourceRevision).toLowerCase();
  const sourceRevision = text(grant.sourceRevision || sourceHead).toLowerCase();

  if (item?.schemaVersion !== 'stephanos.mission-worker-queue-item.v1') return { ok: false, reason: 'LANE7_CLAIM_ACK_QUEUE_SCHEMA_INVALID' };
  if (text(item?.adapter).toLowerCase() !== 'chatgpt-github' || text(action.adapter).toLowerCase() !== 'chatgpt-github') return { ok: false, reason: 'LANE7_CLAIM_ACK_ADAPTER_INVALID' };
  if (!SAFE_ID.test(missionId) || !SAFE_ID.test(actionId) || text(action.missionId).toLowerCase() !== missionId || text(action.actionId).toLowerCase() !== actionId) return { ok: false, reason: 'LANE7_CLAIM_ACK_IDENTITY_INVALID' };
  if (!SHA40.test(sourceHead) || !SHA40.test(grantHead) || !SHA40.test(sourceRevision)) return { ok: false, reason: 'LANE7_CLAIM_ACK_HEAD_INVALID' };
  if (!allowedFiles.length || allowedFiles.length > MAX_FILES || requiredTests.length > MAX_TESTS) return { ok: false, reason: 'LANE7_CLAIM_ACK_SCOPE_INVALID' };

  return {
    ok: true,
    handoff: Object.freeze({
      missionId,
      actionId,
      repository: text(grant.repository || action.repository, GITHUB_LIFEBOAT_LANE7_REPOSITORY),
      issueNumber: Number(grant.issueNumber) || null,
      prNumber: Number(grant.prNumber) || null,
      branch: text(grant.branch || action.branch),
      headSha: grantHead,
      sourceRevision,
      allowedFiles: Object.freeze(allowedFiles),
      requiredTests: Object.freeze(requiredTests),
      requiredEvidence: Object.freeze((Array.isArray(action.requiredEvidence) ? action.requiredEvidence : []).map(text).filter(Boolean).slice(0, 16)),
      capacityReceiptId: text(action.capacityReceiptId),
      capacityProofRefs: Object.freeze((Array.isArray(action.capacityProofRefs) ? action.capacityProofRefs : []).map(text).filter(Boolean).slice(0, 16)),
      accepted: true,
      authoritativeQueueState: 'processing',
      authority: authorityBoundary(),
    }),
  };
}

export async function refreshGitHubLifeboatLane7ClaimAck(options = {}) {
  const sourceHead = text(options.sourceHead).toLowerCase();
  if (!SHA40.test(sourceHead)) {
    return Object.freeze({
      schemaVersion: GITHUB_LIFEBOAT_LANE7_CLAIM_ACK_KEEPER_SCHEMA,
      ok: false,
      published: false,
      reason: 'LANE7_CLAIM_ACK_SOURCE_HEAD_UNPROVEN',
      ...authorityBoundary(),
    });
  }

  const queueRoot = options.queueRoot || resolveMissionWorkerQueueRoot(options.env || process.env);
  if (!queueRoot) {
    return Object.freeze({
      schemaVersion: GITHUB_LIFEBOAT_LANE7_CLAIM_ACK_KEEPER_SCHEMA,
      ok: false,
      published: false,
      reason: 'LANE7_CLAIM_ACK_QUEUE_ROOT_UNAVAILABLE',
      ...authorityBoundary(),
    });
  }

  const processingRoot = resolve(queueRoot, 'chatgpt-github', 'processing');
  let entries = [];
  try {
    entries = (await readdir(processingRoot, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  if (entries.length === 0) {
    return Object.freeze({
      schemaVersion: GITHUB_LIFEBOAT_LANE7_CLAIM_ACK_KEEPER_SCHEMA,
      ok: true,
      published: false,
      state: 'NO_ACTIVE_CLAIM',
      ...authorityBoundary(),
      finalVerdict: 'GITHUB_LIFEBOAT_LANE7_NO_ACTIVE_CLAIM',
    });
  }
  if (entries.length !== 1) {
    return Object.freeze({
      schemaVersion: GITHUB_LIFEBOAT_LANE7_CLAIM_ACK_KEEPER_SCHEMA,
      ok: false,
      published: false,
      state: 'SAFE_HOLD',
      reason: 'LANE7_CLAIM_ACK_MULTIPLE_PROCESSING_ITEMS',
      processingCount: entries.length,
      ...authorityBoundary(),
      finalVerdict: 'GITHUB_LIFEBOAT_LANE7_CLAIM_ACK_SAFE_HOLD',
    });
  }

  let item;
  try {
    item = JSON.parse(await readFile(resolve(processingRoot, entries[0]), 'utf8'));
  } catch {
    return Object.freeze({
      schemaVersion: GITHUB_LIFEBOAT_LANE7_CLAIM_ACK_KEEPER_SCHEMA,
      ok: false,
      published: false,
      state: 'SAFE_HOLD',
      reason: 'LANE7_CLAIM_ACK_PROCESSING_ITEM_INVALID',
      ...authorityBoundary(),
      finalVerdict: 'GITHUB_LIFEBOAT_LANE7_CLAIM_ACK_SAFE_HOLD',
    });
  }

  const validated = validateProcessingItem(item, sourceHead);
  if (!validated.ok) {
    return Object.freeze({
      schemaVersion: GITHUB_LIFEBOAT_LANE7_CLAIM_ACK_KEEPER_SCHEMA,
      ok: false,
      published: false,
      state: 'SAFE_HOLD',
      reason: validated.reason,
      ...authorityBoundary(),
      finalVerdict: 'GITHUB_LIFEBOAT_LANE7_CLAIM_ACK_SAFE_HOLD',
    });
  }

  const payload = Object.freeze({
    schemaVersion: GITHUB_LIFEBOAT_LANE7_OUTBOX_SCHEMA,
    state: 'CLAIM_ACCEPTED',
    sourceHead,
    handoff: validated.handoff,
  });
  const writeOutbox = options.writeOutbox || ((body) => defaultWriteOutbox(body, options));
  const publication = await writeOutbox(renderOutbox(payload));
  return Object.freeze({
    schemaVersion: GITHUB_LIFEBOAT_LANE7_CLAIM_ACK_KEEPER_SCHEMA,
    ok: publication?.ok === true,
    published: publication?.ok === true,
    state: publication?.ok === true ? 'CLAIM_ACCEPTED' : 'SAFE_HOLD',
    sourceHead,
    actionId: validated.handoff.actionId,
    missionId: validated.handoff.missionId,
    payload,
    publication,
    ...authorityBoundary(),
    finalVerdict: publication?.ok === true
      ? 'GITHUB_LIFEBOAT_LANE7_CLAIM_ACK_PUBLISHED'
      : 'GITHUB_LIFEBOAT_LANE7_CLAIM_ACK_PUBLICATION_FAILED',
  });
}
