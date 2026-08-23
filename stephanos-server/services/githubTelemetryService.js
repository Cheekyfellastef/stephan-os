import { providerSecretStore } from './providerSecretStore.js';
import { resolveGithubRepoConfig } from './githubPrEvidenceService.js';
import { resolveGithubAuth, resolveGithubGhCliAuth } from './githubAuthResolver.js';

export const GITHUB_TELEMETRY_SCHEMA = 'stephanos.github.telemetry.v1';
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
    return { id: text(run.id, `workflow-${index + 1}`), name: text(run.name, 'unknown'), status, prNumber: Number(run.prNumber || run.pull_requests?.[0]?.number || 0) || null, goalId: text(run.goalId), url: text(run.url || run.html_url), updatedAt: text(run.updatedAt || run.updated_at || run.run_started_at) };
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
async function githubJson(url, auth, fetchImpl = fetch) {
  const response = await fetchImpl(url, { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${auth.token}`, 'User-Agent': 'stephanos-readonly-github-telemetry' } });
  if (!response.ok) { const error = new Error(`GitHub API request failed (${response.status})`); error.status = response.status; throw error; }
  return response.json();
}
async function readGithubTelemetryWithAuth(repoConfig, auth, options = {}) {
  const { owner, repo } = repoConfig;
  const fetchImpl = options.fetchImpl || fetch;
  const [notifications, prs, workflowRuns] = await Promise.all([
    githubJson('https://api.github.com/notifications?all=false&participating=false', auth, fetchImpl),
    githubJson(`https://api.github.com/repos/${owner}/${repo}/pulls?state=open&per_page=100`, auth, fetchImpl),
    githubJson(`https://api.github.com/repos/${owner}/${repo}/actions/runs?per_page=50`, auth, fetchImpl),
  ]);
  return normalizeGithubTelemetry({ available: true, source: 'github-api', authAuthority: auth.authority, repository: repoConfig, notifications, pullRequests: prs, workflows: workflowRuns.workflow_runs || [] }, options);
}
export async function readGithubTelemetry(options = {}) {
  if (options.adapterData) return normalizeGithubTelemetry(options.adapterData, options);
  const repoConfig = resolveGithubRepoConfig(options.env || process.env);
  const auth = await resolveGithubAuth({ env: options.env || process.env, secretStoreToken: Object.prototype.hasOwnProperty.call(options, 'secretStoreToken') ? options.secretStoreToken : providerSecretStore.getSecret('github'), ghTokenProvider: options.ghTokenProvider, execFile: options.execFile });
  if (!repoConfig || !auth.configured) return normalizeGithubTelemetry({ available: false, authAuthority: auth.authority, repository: repoConfig }, options);
  try {
    return await readGithubTelemetryWithAuth(repoConfig, auth, options);
  } catch (error) {
    if (error?.status === 403 && auth.authority !== 'gh-cli') {
      const ghAuth = await resolveGithubGhCliAuth({ ghTokenProvider: options.ghTokenProvider, execFile: options.execFile });
      if (ghAuth.configured) {
        try { return await readGithubTelemetryWithAuth(repoConfig, ghAuth, options); } catch (retryError) { error = retryError; }
      }
    }
    return { ...normalizeGithubTelemetry({ available: false, authAuthority: auth.authority, repository: repoConfig }, options), status: 'adapter_error', blockers: [`github_adapter_error:${error?.message || 'unknown'}`] };
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
