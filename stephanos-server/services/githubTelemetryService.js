import { createHash } from 'node:crypto';

import { resolveGithubRepoConfig } from './githubPrEvidenceService.js';
import { resolveGithubAuth, resolveGithubGhCliAuth } from './githubAuthResolver.js';
import { readBrokeredGithubRateLimitHold, recordBrokeredGithubRateLimitHold } from '../../shared/agents/githubObservationBrokerV1.mjs';

export const GITHUB_TELEMETRY_SCHEMA = 'stephanos.github.telemetry.v1';
export const DEFAULT_GITHUB_TELEMETRY_REQUEST_TIMEOUT_MS = 3_000;
export const DEFAULT_GITHUB_TELEMETRY_CACHE_TTL_MS = 60_000;
const MAX_GITHUB_TELEMETRY_CACHE_TTL_MS = 5 * 60 * 1000;
const githubTelemetryCache = new Map();
// Single-flight for concurrent dashboard refreshes sharing one credential.
const githubTelemetryInFlight = new Map();
const GITHUB_TELEMETRY_RATE_LIMIT_DEFAULT_MS = 120_000;
const GITHUB_TELEMETRY_RATE_LIMIT_MIN_MS = 30_000;
const GITHUB_TELEMETRY_RATE_LIMIT_MAX_MS = 65 * 60_000;
const WORKFLOW_STATES = new Set(['running', 'queued', 'failed', 'passed', 'cancelled']);
function text(value, fallback = '') { const normalized = String(value ?? '').trim(); return normalized || fallback; }
function list(value) { return Array.isArray(value) ? value : []; }
function lc(value) { return text(value).toLowerCase(); }
function countBy(items, key) { return items.reduce((acc, item) => ({ ...acc, [item[key]]: (acc[item[key]] || 0) + 1 }), {}); }
function normalizeChecks(checks = []) {
  const states = list(checks).map((check) => lc(check.status || check.conclusion || check.state));
  if (states.some((state) => ['failure', 'failed', 'timed_out', 'action_required'].includes(state))) return 'failed';
  if (states.some((state) => ['queued', 'in_progress', 'pending', 'waiting'].includes(state))) return 'pending';
  if (states.length && states.every((state) => ['success', 'passed', 'skipped', 'neutral'].includes(state))) return 'passed';
  return 'unknown';
}
export function classifyGithubNotification(notification = {}) {
  const reason = lc(notification.reason);
  const title = lc(notification.subject?.title || notification.title);
  const type = lc(notification.subject?.type || notification.type);
  if (/ci|check/.test(title) && /fail|broken|red/.test(title)) return 'CI failure';
  if (/workflow/.test(title) && /fail|cancel|timed out/.test(title)) return 'Workflow failure';
  if (/merged|merge completed|pull request successfully merged/.test(title)) return 'Merge completed';
  if (reason === 'review_requested') return 'Review requested';
  if (reason === 'mention' || reason === 'team_mention') return 'Mention';
  if (/goal|build concierge|mission/.test(title)) return 'Goal related';
  if (type === 'pullrequest' || /\bpr\b|pull request/.test(title)) return 'Actionable PR';
  return notification.unread === true ? 'Actionable PR' : 'Historical/no-action';
}
export function normalizeGithubTelemetry(raw = {}, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const available = raw.available === true;
  const notifications = list(raw.notifications).map((notification, index) => ({
    id: text(notification.id, `notification-${index + 1}`),
    title: text(notification.subject?.title || notification.title, 'unknown'),
    reason: text(notification.reason, 'unknown'),
    unread: notification.unread !== false,
    url: text(notification.url || notification.html_url || notification.subject?.url),
    prNumber: Number(notification.prNumber || notification.subject?.prNumber || 0) || null,
    category: classifyGithubNotification(notification),
    updatedAt: text(notification.updated_at || notification.updatedAt, ''),
  }));
  const pullRequests = list(raw.pullRequests || raw.prs).map((pr) => {
    const checksStatus = text(pr.checksStatus || normalizeChecks(pr.checks), 'unknown');
    const blockers = [...list(pr.blockers)];
    if (checksStatus !== 'passed') blockers.push('checks_not_passed_or_unknown');
    if (!text(pr.headSha || pr.head?.sha)) blockers.push('head_sha_unknown');
    return {
      number: Number(pr.number || pr.prNumber || 0) || null,
      title: text(pr.title, 'unknown'),
      branch: text(pr.branch || pr.headRefName || pr.head?.ref, 'unknown'),
      headSha: text(pr.headSha || pr.head?.sha, ''),
      url: text(pr.url || pr.html_url, ''),
      checks: list(pr.checks),
      checksStatus,
      mergeReadiness: text(pr.mergeReadiness || (checksStatus === 'passed' ? 'awaiting_exact_head_approval' : 'blocked_or_unknown'), 'blocked_or_unknown'),
      approvalStatus: text(pr.approvalStatus, 'unknown'),
      blockers: [...new Set(blockers)],
      supersededStatus: text(pr.supersededStatus, 'unknown'),
    };
  });
  const workflows = list(raw.workflows || raw.workflowRuns).map((run, index) => {
    const statusText = lc(run.status);
    const conclusion = lc(run.conclusion);
    let status = WORKFLOW_STATES.has(statusText) ? statusText : 'queued';
    if (['in_progress', 'requested', 'waiting', 'pending'].includes(statusText)) status = statusText === 'in_progress' ? 'running' : 'queued';
    if (['success', 'passed'].includes(conclusion)) status = 'passed';
    if (['failure', 'failed', 'timed_out', 'action_required'].includes(conclusion)) status = 'failed';
    if (conclusion === 'cancelled') status = 'cancelled';
    return {
      id: text(run.id, `workflow-${index + 1}`),
      name: text(run.name, 'unknown'),
      status,
      prNumber: Number(run.prNumber || run.pull_requests?.[0]?.number || 0) || null,
      headSha: text(run.headSha || run.head_sha, ''),
      goalId: text(run.goalId),
      url: text(run.url || run.html_url),
      updatedAt: text(run.updatedAt || run.updated_at || run.run_started_at),
    };
  });
  const blockers = [];
  if (!available) blockers.push('github_adapter_unavailable');
  return {
    schemaVersion: GITHUB_TELEMETRY_SCHEMA,
    adapterAvailable: available,
    status: available ? 'live' : 'adapter_unavailable',
    source: available ? text(raw.source, 'github-readonly-adapter') : 'adapter-unavailable',
    authAuthority: text(raw.authAuthority, available ? 'unavailable' : 'unavailable'),
    repository: raw.repository || null,
    lastUpdatedAt: text(raw.lastUpdatedAt, now.toISOString()),
    notifications,
    notificationCounts: countBy(notifications, 'category'),
    pullRequests,
    pullRequestCount: pullRequests.length,
    workflows,
    workflowCounts: countBy(workflows, 'status'),
    blockers,
    nextOperatorAction: available ? 'Review actionable GitHub notifications, blocked PRs, and failed workflows before merge decisions.' : 'Configure the read-only GitHub adapter/token; GitHub truth remains unavailable.',
    mutationAllowed: false,
    mergeAllowed: false,
  };
}
function githubRequestTimeoutMs(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_GITHUB_TELEMETRY_REQUEST_TIMEOUT_MS;
}
function githubTelemetryCacheTtlMs(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_GITHUB_TELEMETRY_CACHE_TTL_MS;
  return Math.min(Math.max(Math.floor(parsed), 5_000), MAX_GITHUB_TELEMETRY_CACHE_TTL_MS);
}
function githubCredentialFingerprint(auth = {}) {
  const token = text(auth?.token);
  return token ? createHash('sha256').update(token).digest('hex').slice(0, 24) : 'no-token';
}
function githubTelemetryCacheKey(repoConfig, auth) {
  return `${text(repoConfig?.owner).toLowerCase()}/${text(repoConfig?.repo).toLowerCase()}:${text(auth?.authority, 'unknown')}:${githubCredentialFingerprint(auth)}`;
}

// Observational dashboards never turn a rate-limited GitHub read into proof of
// live PR/check state. The broker already shares this unavailable HOLD with
// independent Battle Bridge PR evidence and gh-cli observer processes.
function heldGithubTelemetry(repoConfig, authority, options, hold) {
  return {
    ...normalizeGithubTelemetry({
      available: false, authAuthority: authority, repository: repoConfig,
    }, options),
    status: 'adapter_error',
    blockers: ['github_rate_limit_backoff'],
    rateLimitHold: {
      reasonCode: 'GITHUB_RATE_LIMIT_BACKOFF',
      retryAfterUtc: hold.retryAfterUtc,
    },
  };
}
async function githubJson(url, auth, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = githubRequestTimeoutMs(options.requestTimeoutMs);
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller?.abort();
      const error = new Error(`GitHub telemetry request timed out after ${timeoutMs}ms`);
      error.code = 'github-telemetry-timeout';
      reject(error);
    }, timeoutMs);
  });
  try {
    const response = await Promise.race([
      Promise.resolve().then(() => fetchImpl(url, {
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${auth.token}`, 'User-Agent': 'stephanos-readonly-github-telemetry' },
        ...(controller ? { signal: controller.signal } : {}),
      })),
      timeout,
    ]);
    if (!response.ok) {
      const error = new Error(`GitHub API request failed (${response.status})`);
      error.status = response.status;
      if ([403, 429].includes(response.status)) {
        const remaining = String(response.headers?.get?.('x-ratelimit-remaining') ?? '');
        let message = '';
        try {
          message = String((await Promise.race([
            Promise.resolve().then(() => response.json()),
            timeout,
          ]))?.message ?? '');
        } catch {}
        // A plain permissions 403 is not a rate-limit event: preserve the
        // existing alternate-auth retry only for that distinct case.
        if (response.status === 429 || remaining === '0'
            || /(?:api|secondary) rate limit exceeded|rate limit exceeded|exceeded (?:a |the )?secondary rate limit|too many requests/i.test(message)) {
          const retrySeconds = Number(response.headers?.get?.('retry-after'));
          const resetSeconds = Number(response.headers?.get?.('x-ratelimit-reset'));
          const requestedMs = Number.isFinite(retrySeconds) && retrySeconds > 0
            ? retrySeconds * 1000
            : Number.isFinite(resetSeconds) && resetSeconds > 0
              ? resetSeconds * 1000 - Date.now() + 5_000
              : GITHUB_TELEMETRY_RATE_LIMIT_DEFAULT_MS;
          error.githubRateLimited = true;
          error.retryAfterMs = Math.min(GITHUB_TELEMETRY_RATE_LIMIT_MAX_MS,
            Math.max(GITHUB_TELEMETRY_RATE_LIMIT_MIN_MS, requestedMs));
        }
      }
      throw error;
    }
    return await Promise.race([
      Promise.resolve().then(() => response.json()),
      timeout,
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}
async function readGithubTelemetryWithAuth(repoConfig, auth, options = {}) {
  const { owner, repo } = repoConfig;
  const requestOptions = {
    fetchImpl: options.fetchImpl || fetch,
    requestTimeoutMs: options.requestTimeoutMs,
  };
  // Serial, deliberately: one exhausted endpoint must not dispatch two more
  // doomed requests before the shared rate-limit HOLD can be recorded.
  const prs = await githubJson(`https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=100`, auth, requestOptions);
  const workflowRuns = await githubJson(`https://api.github.com/repos/${owner}/${repo}/actions/runs?per_page=50`, auth, requestOptions);
  const notifications = await githubJson('https://api.github.com/notifications?all=false&participating=false', auth, requestOptions);
  return normalizeGithubTelemetry({ available: true, source: 'github-api', authAuthority: auth.authority, repository: repoConfig, notifications, pullRequests: prs, workflows: workflowRuns.workflow_runs || [] }, options);
}
export async function readGithubTelemetry(options = {}) {
  if (options.adapterData) return normalizeGithubTelemetry(options.adapterData, options);
  const repoConfig = resolveGithubRepoConfig(options.env || process.env);
  const authOptions = {};
  if (Object.prototype.hasOwnProperty.call(options, 'env')) authOptions.env = options.env;
  if (Object.prototype.hasOwnProperty.call(options, 'secretStoreToken')) authOptions.secretStoreToken = options.secretStoreToken;
  if (typeof options.ghTokenProvider === 'function') authOptions.ghTokenProvider = options.ghTokenProvider;
  if (typeof options.execFile === 'function') authOptions.execFile = options.execFile;
  const auth = await resolveGithubAuth(authOptions);
  if (!repoConfig || !auth.configured) return normalizeGithubTelemetry({ available: false, authAuthority: auth.authority, repository: repoConfig }, options);

  // Injected tests cannot read or mutate the operator's Shared Workspace.
  const useSharedHold = options.fetchImpl === undefined || options.fetchImpl === fetch || Boolean(options.workspaceRoot);
  const repository = `${repoConfig.owner}/${repoConfig.repo}`;
  const sharedHold = useSharedHold
    ? readBrokeredGithubRateLimitHold({ repository, workspaceRoot: options.workspaceRoot })
    : null;
  if (sharedHold) return heldGithubTelemetry(repoConfig, auth.authority, options, sharedHold);

  const cacheEnabled = options.cacheEnabled === undefined ? options.fetchImpl === undefined : options.cacheEnabled === true;
  const nowMs = options.now instanceof Date ? options.now.getTime() : Date.now();
  const cacheTtlMs = githubTelemetryCacheTtlMs(options.cacheTtlMs);
  const cacheKey = githubTelemetryCacheKey(repoConfig, auth);
  if (cacheEnabled) {
    const cached = githubTelemetryCache.get(cacheKey);
    if (cached && nowMs - cached.cachedAtMs >= 0 && nowMs - cached.cachedAtMs < cacheTtlMs) return cached.telemetry;
  }

  // The cache only contains completed observations. Deduplicate refreshes
  // currently in progress as well, or concurrent UI clients would each launch
  // their own entire GitHub request sequence.
  if (cacheEnabled && githubTelemetryInFlight.has(cacheKey)) {
    return githubTelemetryInFlight.get(cacheKey);
  }
  const flight = (async () => {
  try {
    const telemetry = await readGithubTelemetryWithAuth(repoConfig, auth, options);
    if (cacheEnabled) githubTelemetryCache.set(cacheKey, { cachedAtMs: nowMs, telemetry });
    return telemetry;
  } catch (error) {
    if (error?.status === 403 && !error.githubRateLimited && auth.authority !== 'gh-cli') {
      const ghAuth = await resolveGithubGhCliAuth(authOptions);
      if (ghAuth.configured) {
        try {
          const telemetry = await readGithubTelemetryWithAuth(repoConfig, ghAuth, options);
          if (cacheEnabled) {
            const cached = { cachedAtMs: nowMs, telemetry };
            githubTelemetryCache.set(githubTelemetryCacheKey(repoConfig, ghAuth), cached);
            githubTelemetryCache.set(cacheKey, cached);
          }
          return telemetry;
        } catch (retryError) {
          error = retryError;
        }
      }
    }
    if (error?.githubRateLimited) {
      const recorded = useSharedHold ? recordBrokeredGithubRateLimitHold({
        repository, workspaceRoot: options.workspaceRoot, retryAfterMs: error.retryAfterMs,
      }) : null;
      const retryAfterUtc = recorded?.retryAfterUtc
        || new Date(Date.now() + error.retryAfterMs).toISOString();
      return heldGithubTelemetry(repoConfig, auth.authority, options, { retryAfterUtc });
    }
    return { ...normalizeGithubTelemetry({ available: false, authAuthority: auth.authority, repository: repoConfig }, options), status: 'adapter_error', blockers: [`github_adapter_error:${error?.message || 'unknown'}`] };
  }
  })();
  if (cacheEnabled) githubTelemetryInFlight.set(cacheKey, flight);
  try {
    return await flight;
  } finally {
    if (githubTelemetryInFlight.get(cacheKey) === flight) githubTelemetryInFlight.delete(cacheKey);
  }
}
export function buildExecutionChains({ goals = [], githubTelemetry = {} } = {}) {
  return list(goals).map((goal) => {
    const prHint = Number(String(goal.lastKnownPR || goal.prNumber || goal.title || '').match(/#?(\d+)/)?.[1] || 0) || null;
    const pr = list(githubTelemetry.pullRequests).find((candidate) => candidate.number === prHint || (candidate.title && goal.title && candidate.title.toLowerCase().includes(String(goal.title).toLowerCase().slice(0, 24))));
    const workflows = pr ? list(githubTelemetry.workflows).filter((run) => run.prNumber === pr.number) : [];
    return { goalId: goal.candidateId || goal.id || goal.title, title: goal.title || 'unknown', pr: pr || null, workflows, browserProof: 'unknown', approval: pr?.approvalStatus || 'unknown', merge: pr?.mergeReadiness || 'unknown', postMergeSync: 'unknown' };
  });
}
export function answerLiveTelemetryQuestion(question = '', projection = {}) {
  const q = lc(question);
  const gh = projection.githubTelemetry || {};
  if (/notification/.test(q)) return `GitHub notifications from githubTelemetry.notificationCounts: ${JSON.stringify(gh.notificationCounts || {})}. Status: ${gh.status || 'unknown'}.`;
  if (/workflow.*fail|failed workflow|which workflows failed/.test(q)) return `Failed workflows from githubTelemetry.workflows: ${list(gh.workflows).filter((w) => w.status === 'failed').map((w) => `${w.name}#${w.id}`).join(', ') || 'none reported'}.`;
  if (/safest.*merge|merge/.test(q)) return `Safest PR to merge is unknown unless pullRequests show checksStatus=passed and approvalStatus approved. Candidates: ${list(gh.pullRequests).filter((pr) => pr.checksStatus === 'passed' && pr.approvalStatus === 'approved').map((pr) => `#${pr.number} ${pr.headSha}`).join(', ') || 'none'}.`;
  if (/active.*goal/.test(q)) return `Active goals from activeProofLane: ${list(projection.activeProofLane).map((goal) => goal.candidateId || goal.title).join(', ') || 'none'}.`;
  if (/waiting|build concierge/.test(q)) return `Build Concierge is waiting for: ${projection.executionEngine?.nextOperatorAction || projection.nextOperatorAction || 'unknown'}.`;
  return `Next operator action from live projection: ${projection.nextOperatorAction || gh.nextOperatorAction || 'unknown'}.`;
}
