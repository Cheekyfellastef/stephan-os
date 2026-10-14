// #3109: four bounded GitHub GETs, on an allowlisted repository, for an
// independently observed owner comment/issue/current-main identity. No writer.
// This does NOT authenticate canonical/Seed/Island ownership or allow pickup.
import { request as httpsRequest } from 'node:https';
import { inspectRescueIslandPilotOwnerIntakeV1 } from './rescueIslandPilotOwnerIntakeV1.mjs';

export const RESCUE_ISLAND_GITHUB_READ_SCHEMA = 'stephanos.rescue-island-github-read.v1';
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
} = {}) {
  if (!safeCommentId(commentId)) return blocker('COMMENT_ID_UNTRUSTED');
  const first = headOf(initialMain), second = headOf(finalMain);
  if (!first || first !== second) return blocker('GITHUB_MAIN_HEAD_CHANGED_OR_UNPROVEN');
  const intake = inspectRescueIslandPilotOwnerIntakeV1({
    issue, comment, commentId, mainHead: first, nowUtc, task, consumedCommentIds,
  });
  if (intake.disposition !== 'STRUCTURALLY_ELIGIBLE_UNAUTHENTICATED')
    return blocker('OWNER_TASK_INTAKE_HELD', { intakeBlockers: intake.blockers });
  return Object.freeze({
    ...blocker('EXTERNAL_OS_AND_OWNERSHIP_PROOF_REQUIRED'),
    verdict: 'GITHUB_FACTS_STRUCTURALLY_VERIFIED',
    sourceHead: first,
    commentId,
    taskId: task.taskId,
    readOnlyRequestCount: 4,
    // Even these identity observations are NOT an authenticated source write
    // capability; only the native reviewed host may trust its own HTTPS call.
    remoteReadAuthenticationFromCallerAllowed: false,
  });
}

// Only a concrete public GitHub REST path below ROOT can be requested.
// Never accept arbitrary URL, host, headers, shell or an injected transport.
async function readGithubJson(path, token) {
  if (typeof path !== 'string' || !path.startsWith(ROOT + '/')
      || path.includes('?') || path.includes('#') || path.includes('..')
      || !/^\/[A-Za-z0-9._/-]+$/.test(path)) throw new Error('ISLAND_GITHUB_PATH_DENIED');
  return new Promise((resolve, reject) => {
    let ended = false, total = 0;
    const fail = (code) => { if (ended) return; ended = true; reject(new Error(code)); };
    const headers = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'stephanos-rescue-island-owner-read-v1',
      'X-GitHub-Api-Version': '2022-11-28',
      'Cache-Control': 'no-cache',
    };
    if (typeof token === 'string' && token.length > 0) {
      if (token.length > 512 || /[\r\n]/.test(token)) return fail('ISLAND_GITHUB_TOKEN_INVALID');
      headers.Authorization = 'Bearer ' + token;
    }
    const req = httpsRequest({
      hostname: 'api.github.com', port: 443, protocol: 'https:',
      method: 'GET', path, headers, timeout: READ_TIMEOUT_MS,
    }, res => {
      if (res.statusCode !== 200) {
        res.resume();
        fail(res.statusCode === 403 || res.statusCode === 429
          ? 'ISLAND_GITHUB_RATE_LIMIT_HOLD'
          : res.statusCode >= 500 ? 'ISLAND_GITHUB_TRANSIENT_READ_UNAVAILABLE'
            : 'ISLAND_GITHUB_READ_DENIED');
        return;
      }
      const chunks = [];
      res.on('data', bytes => {
        if (ended) return;
        total += bytes.length;
        if (total > MAX_BYTES) {
          req.destroy();
          fail('ISLAND_GITHUB_RESPONSE_TOO_LARGE');
        } else chunks.push(bytes);
      });
      res.on('end', () => {
        if (ended) return;
        ended = true;
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(new Error('ISLAND_GITHUB_RESPONSE_INVALID')); }
      });
      res.on('error', () => fail('ISLAND_GITHUB_RESPONSE_ABORTED'));
    });
    req.on('timeout', () => req.destroy(new Error('ISLAND_GITHUB_TIMEOUT')));
    req.on('error', () => fail('ISLAND_GITHUB_NETWORK_UNAVAILABLE'));
    req.end();
  });
}

/**
 * Production-safe to READ, not to EXECUTE: this function performs exact fixed
 * TLS GETs and then *only* structural admission. Every authority remains false.
 * A later independently reviewed local wrapper must prove OS/claims/gaming and
 * rebind this observation before calling #3105's isolated mutation engine.
 */
export async function readRescueIslandPilotGithubFactsV1({
  commentId, task, nowUtc = new Date().toISOString(),
  consumedCommentIds = [], token = process.env.GITHUB_TOKEN || '',
} = {}) {
  if (!safeCommentId(commentId)) return blocker('COMMENT_ID_UNTRUSTED');
  if (typeof nowUtc !== 'string' || !Number.isFinite(Date.parse(nowUtc)))
    return blocker('OBSERVATION_TIME_UNTRUSTED');
  const commentPath = ROOT + '/issues/comments/' + commentId;
  try {
    // Sequential bounded reads hold a single API request at a time. The final
    // read detects any change to main during the owner/task observation.
    const initialMain = await readGithubJson(URLS.main, token);
    const issue = await readGithubJson(URLS.issue, token);
    const comment = await readGithubJson(commentPath, token);
    const finalMain = await readGithubJson(URLS.main, token);
    return inspectRescueIslandGithubReadFactsV1({
      issue, comment, initialMain, finalMain, commentId, task, nowUtc, consumedCommentIds,
    });
  } catch (e) {
    const reason = String(e?.message || '');
    const allowed = new Set([
      'ISLAND_GITHUB_PATH_DENIED','ISLAND_GITHUB_TOKEN_INVALID','ISLAND_GITHUB_RATE_LIMIT_HOLD',
      'ISLAND_GITHUB_TRANSIENT_READ_UNAVAILABLE','ISLAND_GITHUB_READ_DENIED',
      'ISLAND_GITHUB_RESPONSE_TOO_LARGE','ISLAND_GITHUB_RESPONSE_INVALID',
      'ISLAND_GITHUB_RESPONSE_ABORTED','ISLAND_GITHUB_TIMEOUT','ISLAND_GITHUB_NETWORK_UNAVAILABLE',
    ]);
    return blocker(allowed.has(reason) ? reason : 'ISLAND_GITHUB_OBSERVATION_FAILED');
  }
}
