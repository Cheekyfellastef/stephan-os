// #3109: four bounded GitHub GETs, on an allowlisted repository, for an
// independently observed owner comment/issue/current-main identity. No writer.
// This does NOT authenticate canonical/Seed/Island ownership or allow pickup.
import { readBrokeredGithubJson } from './githubObservationBrokerV1.mjs';
import { BATTLE_BRIDGE_WINDOWS_HOST } from './battleBridgeWindowsHosts.mjs';
import { createBattleBridgeMinimalChildEnvironment } from './battleBridgeExecutionBoundaryV1.mjs';
import { inspectRescueIslandPilotOwnerIntakeV1, inspectRescueIslandSupervisedOwnerIntakeV1 } from './rescueIslandPilotOwnerIntakeV1.mjs';

export const RESCUE_ISLAND_GITHUB_READ_SCHEMA = 'stephanos.rescue-island-github-read.v1';
const SUPERVISED_READ = Symbol('supervised-cooperative-read');
const ROOT = '/repos/Cheekyfellastef/stephan-os';
const ISSUE = 3109;
const MAX_BYTES = 32 * 1024;
const READ_TIMEOUT_MS = 10000;
const SAFE_COMMENT_ID = /^[1-9][0-9]{0,15}$/;
const HEAD = /^[a-f0-9]{40}$/;
const URLS = Object.freeze({
  main: ROOT + '/git/ref/heads/main',
  issue: ROOT + '/issues/' + ISSUE,
});

function blocker(reason, extra = {}) {
  return Object.freeze({
    schemaVersion: RESCUE_ISLAND_GITHUB_READ_SCHEMA,
    verdict: 'HELD',
    blockers: Object.freeze([reason]),
    readOnly: true,
    approvalAuthenticated: false,
    ownershipAuthenticated: false,
    independentClaimsAuthenticated: false,
    gamingBudgetAuthenticated: false,
    liveRunnerRegistered: false,
    physicalPickupAllowed: false,
    sourceMutationAllowed: false,
    canonicalLeaseAccessAllowed: false,
    seedForgeQueueAccessAllowed: false,
    mergeAllowed: false,
    ...extra,
  });
}
function safeCommentId(commentId) {
  return Number.isSafeInteger(commentId) && commentId > 0
    && SAFE_COMMENT_ID.test(String(commentId));
}
function headOf(value) {
  const sha = value?.object?.sha;
  return typeof sha === 'string' && HEAD.test(sha) && value?.ref === 'refs/heads/main' ? sha : '';
}

export function inspectRescueIslandGithubReadFactsV1({
  issue, comment, initialMain, finalMain, commentId, task, nowUtc, consumedCommentIds = [],
  [SUPERVISED_READ]: supervised = false,
} = {}) {
  if (!safeCommentId(commentId)) return blocker('COMMENT_ID_UNTRUSTED');
  const first = headOf(initialMain), second = headOf(finalMain);
  if (!first || first !== second) return blocker('GITHUB_MAIN_HEAD_CHANGED_OR_UNPROVEN');
  const inspect = supervised ? inspectRescueIslandSupervisedOwnerIntakeV1 : inspectRescueIslandPilotOwnerIntakeV1;
  const intake = inspect({
    issue, comment, commentId, mainHead: first, nowUtc, task, consumedCommentIds,
  });
  if (intake.disposition !== 'STRUCTURALLY_ELIGIBLE_UNAUTHENTICATED')
    return blocker('OWNER_TASK_INTAKE_HELD', { intakeBlockers: intake.blockers });
  return Object.freeze({
    ...blocker('EXTERNAL_OS_AND_OWNERSHIP_PROOF_REQUIRED'),
    verdict: 'GITHUB_FACTS_STRUCTURALLY_VERIFIED',
    ...(supervised ? { assuranceProfile: 'SUPERVISED_COOPERATIVE_V1' } : {}),
    blockers: Object.freeze([]),
    nextRequiredProof: 'EXTERNAL_OS_AND_OWNERSHIP_PROOF_REQUIRED',
    sourceHead: first,
    commentId,
    taskId: task.taskId,
    readOnlyRequestCount: 4,
    // Even these identity observations are NOT an authenticated source write
    // capability; only the native reviewed host may trust its own HTTPS call.
    remoteReadAuthenticationFromCallerAllowed: false,
  });
}

// The existing shared GitHub Observation Broker owns repository-wide cooldown,
// publication-safe caching, single-reader locks and bounded CLI wall-clock
// deadlines. Only four fixed endpoints and projections are admitted here.
const BROKER_TIMEOUT_MS = 10_000;
const BROKER_READS = Object.freeze([
  Object.freeze({ id: 'main-open', endpoint: ROOT.slice(1) + '/git/ref/heads/main',
    jq: '{ref,object:{sha:.object.sha}}' }),
  Object.freeze({ id: 'issue', endpoint: ROOT.slice(1) + '/issues/' + ISSUE,
    jq: '{number,title,state,url,pull_request}' }),
  Object.freeze({ id: 'comment', endpoint: null,
    jq: '{id,url,issue_url,user:{login:.user.login,type:.user.type,id:.user.id},author_association,created_at,updated_at,body}' }),
  Object.freeze({ id: 'main-close', endpoint: ROOT.slice(1) + '/git/ref/heads/main',
    jq: '{ref,object:{sha:.object.sha}}' }),
]);

function trustedSharedGithubObservation(spec, commentId, nowMs) {
  const endpoint = spec.id === 'comment'
    ? ROOT.slice(1) + '/issues/comments/' + commentId : spec.endpoint;
  const observed = readBrokeredGithubJson({
    key: 'rescue-island:3109:' + commentId + ':' + spec.id,
    endpoint,
    args: ['--jq', spec.jq],
    ttlMs: 1000,
    maxStaleMs: 1000,
    timeoutMs: BROKER_TIMEOUT_MS,
    nowMs,
    ghCommand: process.platform === 'win32' ? BATTLE_BRIDGE_WINDOWS_HOST.githubCli : '/usr/bin/gh',
    childEnv: createBattleBridgeMinimalChildEnvironment(process.env),
  });
  // Never use stale/error-cache observations for approval-bearing evidence.
  // The common broker persists cooldown; a future controller invocation must
  // respect it rather than independently hammering GitHub.
  if (observed?.reason === 'GITHUB_RATE_LIMIT_BACKOFF' || observed?.rateLimitHold)
    return { ok: false, blocker: 'ISLAND_GITHUB_SHARED_RATE_LIMIT_HOLD' };
  if (observed?.ok !== true || observed.source !== 'UPSTREAM_REFRESH'
      || observed.ageMs !== 0)
    return { ok: false, blocker: observed?.ok
      ? 'ISLAND_GITHUB_FRESH_OBSERVATION_REQUIRED'
      : 'ISLAND_GITHUB_SHARED_OBSERVATION_UNAVAILABLE' };
  const payload = observed.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_BYTES)
    return { ok: false, blocker: 'ISLAND_GITHUB_RESPONSE_INVALID_OR_OVERSIZE' };
  return { ok: true, payload };
}

/**
 * Production-safe to READ, not to EXECUTE. This uses the existing trusted
 * shared Github broker and its 10-second wall-clock child timeout. No direct
 * HTTPS/socket retry loop, no fresh read while the broker is holding 403/429,
 * no stale cache promoted into owner approval, and no arbitrary endpoint.
 * A separate reviewed OS host still has to prove claims, worktrees and gaming.
 */
export async function readRescueIslandPilotGithubFactsV1({
  commentId, task, nowUtc = new Date().toISOString(),
  consumedCommentIds = [], [SUPERVISED_READ]: supervised = false,
} = {}) {
  if (!safeCommentId(commentId)) return blocker('COMMENT_ID_UNTRUSTED');
  const statedMs = typeof nowUtc === 'string' ? Date.parse(nowUtc) : NaN;
  const liveNowMs = Date.now();
  // Never allow an externally supplied clock to bypass shared cooldown.
  if (!Number.isFinite(statedMs) || Math.abs(statedMs - liveNowMs) > 5_000)
    return blocker('OBSERVATION_TIME_NOT_LIVE');
  const payloads = [];
  for (const spec of BROKER_READS) {
    const result = trustedSharedGithubObservation(spec, commentId, liveNowMs);
    if (!result.ok) return blocker(result.blocker);
    payloads.push(result.payload);
  }
  return inspectRescueIslandGithubReadFactsV1({
    initialMain: payloads[0], issue: payloads[1],
    comment: payloads[2], finalMain: payloads[3],
    commentId, task, nowUtc: supervised ? new Date().toISOString() : nowUtc, consumedCommentIds,
    [SUPERVISED_READ]: supervised,
  });
}

// Fixed alternate parser, same four authenticated broker reads and cooldown.
// The result is still read-only evidence; it is not an Island host grant.
export async function readRescueIslandSupervisedPilotGithubFactsV1(input = {}) {
  return readRescueIslandPilotGithubFactsV1({ ...input, [SUPERVISED_READ]: true });
}
