import { providerSecretStore } from './providerSecretStore.js';
import { resolveGithubRepoConfig } from './githubPrEvidenceService.js';
import { resolveGithubAuth, resolveGithubGhCliAuth } from './githubAuthResolver.js';
import { REQUIRED_EXACT_HEAD_WORKFLOWS } from '../../shared/agents/operatorMergeApprovalGate.mjs';

export const GITHUB_TELEMETRY_SCHEMA = 'stephanos.github.telemetry.v1';
const WORKFLOW_STATES = new Set(['running', 'queued', 'failed', 'passed', 'cancelled']);
const DURABLE_ISSUE_REFERENCE_PATTERN = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+(?:([a-z0-9_.-]+\/[a-z0-9_.-]+))?#(\d{1,10})\b/gi;
const GITHUB_PAGE_SIZE = 100;
const MAX_GITHUB_PAGES = 100;
function text(value, fallback = '') { const normalized = String(value ?? '').trim(); return normalized || fallback; }
function list(value) { return Array.isArray(value) ? value : []; }
function lc(value) { return text(value).toLowerCase(); }
function countBy(items, key) { return items.reduce((acc, item) => ({ ...acc, [item[key]]: (acc[item[key]] || 0) + 1 }), {}); }
function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}
function repositorySlug(repository) {
  if (typeof repository === 'string') return lc(repository).replace(/^github\.com\//, '');
  const fullName = text(repository?.full_name || repository?.fullName);
  if (fullName) return lc(fullName);
  const owner = text(repository?.owner?.login || repository?.owner);
  const repo = text(repository?.repo || repository?.name);
  return owner && repo ? lc(`${owner}/${repo}`) : '';
}
function repositoryDefaultBranch(repository) {
  return text(repository?.defaultBranch || repository?.default_branch);
}
function pullRequestBaseBranch(pr = {}) {
  return text(pr.baseBranch || pr.baseRefName || pr.base?.ref);
}
function durableIssueReferences(pr = {}, repository = null) {
  const localRepository = repositorySlug(repository);
  const references = [
    ...list(pr.relatedIssues),
    ...list(pr.closingIssues),
    ...list(pr.closingIssueReferences),
  ].filter((reference) => {
    const referencedRepository = repositorySlug(reference?.repository || reference?.repositoryUrl || reference?.repo);
    return !referencedRepository || (localRepository && referencedRepository === localRepository);
  }).map((reference) => positiveInteger(reference?.number ?? reference)).filter(Boolean);
  const defaultBranch = repositoryDefaultBranch(repository);
  if (defaultBranch && pullRequestBaseBranch(pr) === defaultBranch) {
    for (const match of String(pr.body || '').matchAll(DURABLE_ISSUE_REFERENCE_PATTERN)) {
      const referencedRepository = lc(match[1]);
      if (referencedRepository && (!localRepository || referencedRepository !== localRepository)) continue;
      const number = Number(match[2]);
      if (Number.isSafeInteger(number) && number > 0) references.push(number);
    }
  }
  return [...new Set(references)];
}
function normalizeLabels(labels = []) {
  return list(labels).map((label) => text(typeof label === 'string' ? label : label?.name)).filter(Boolean);
}
function normalizeAssignees(assignees = []) {
  return list(assignees).map((assignee) => text(typeof assignee === 'string' ? assignee : assignee?.login)).filter(Boolean);
}
function checkHeadSha(check = {}) {
  return text(check.headSha || check.head_sha || check.commit?.sha);
}
function exactHeadWorkflowChecks(workflows = [], prNumber, headSha) {
  return list(workflows).filter((run) => run.prNumber === prNumber && checkHeadSha(run) === headSha);
}
function checkObservedAt(check = {}) {
  const parsed = Date.parse(check.updatedAt || check.updated_at || check.completedAt || check.completed_at || '');
  return Number.isFinite(parsed) ? parsed : null;
}
function canonicalCheckOutcome(check = {}) {
  const status = lc(check.rawStatus ?? check.status);
  const conclusion = lc(check.rawConclusion ?? check.conclusion);
  if (['failure', 'failed', 'timed_out', 'action_required', 'cancelled'].includes(conclusion)
    || ['failure', 'failed', 'timed_out', 'action_required', 'cancelled'].includes(status)) return 'failed';
  if (['queued', 'running', 'in_progress', 'pending', 'waiting', 'requested'].includes(status)) return 'pending';
  if (status === 'completed' && conclusion === 'success') return 'passed';
  return 'unknown';
}
function selectLatestRequiredChecks(checks = [], headSha = '') {
  const latestByName = new Map();
  const conflicts = new Set();
  for (const check of list(checks).filter((candidate) => checkHeadSha(candidate) === headSha)) {
    const name = text(check.name);
    if (!REQUIRED_EXACT_HEAD_WORKFLOWS.includes(name)) continue;
    const previous = latestByName.get(name);
    if (!previous) {
      latestByName.set(name, check);
      continue;
    }
    const currentAt = checkObservedAt(check);
    const previousAt = checkObservedAt(previous);
    if (currentAt !== null && previousAt !== null && currentAt !== previousAt) {
      if (currentAt > previousAt) {
        latestByName.set(name, check);
        conflicts.delete(name);
      }
      continue;
    }
    if (canonicalCheckOutcome(previous) !== canonicalCheckOutcome(check)) {
      conflicts.add(name);
      continue;
    }
    if (currentAt !== null && previousAt === null) {
      latestByName.set(name, check);
    }
  }
  return { latestByName, conflicts: [...conflicts] };
}
function evaluateRequiredExactHeadChecks(checks = [], headSha = '') {
  if (!headSha) {
    return { checks: [], status: 'unknown', missing: [...REQUIRED_EXACT_HEAD_WORKFLOWS], conflicts: [] };
  }
  const { latestByName, conflicts } = selectLatestRequiredChecks(checks, headSha);
  const exactChecks = REQUIRED_EXACT_HEAD_WORKFLOWS.map((name) => latestByName.get(name)).filter(Boolean);
  const missing = REQUIRED_EXACT_HEAD_WORKFLOWS.filter((name) => !latestByName.has(name));
  const outcomes = exactChecks.map(canonicalCheckOutcome);
  const failed = outcomes.includes('failed');
  const pending = outcomes.includes('pending');
  const allSuccessful = exactChecks.length > 0 && outcomes.every((outcome) => outcome === 'passed');
  const status = conflicts.length ? 'unknown' : (failed ? 'failed' : (missing.length ? 'unknown' : (pending ? 'pending' : (allSuccessful ? 'passed' : 'unknown'))));
  return { checks: exactChecks, status, missing, conflicts };
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
  const issueInventoryObserved = Array.isArray(raw.issues);
  const issueInventoryComplete = issueInventoryObserved && raw.issueInventoryComplete === true;
  const pullRequestInventoryObserved = Array.isArray(raw.pullRequests || raw.prs);
  const pullRequestInventoryComplete = pullRequestInventoryObserved && raw.pullRequestInventoryComplete === true;
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
  const workflows = list(raw.workflows || raw.workflowRuns).map((run, index) => {
    const statusText = lc(run.status);
    const conclusion = lc(run.conclusion);
    let status = WORKFLOW_STATES.has(statusText) ? statusText : 'queued';
    if (['in_progress', 'requested', 'waiting', 'pending'].includes(statusText)) status = statusText === 'in_progress' ? 'running' : 'queued';
    if (['success', 'passed'].includes(conclusion)) status = 'passed';
    if (['failure', 'failed', 'timed_out', 'action_required'].includes(conclusion)) status = 'failed';
    if (conclusion === 'cancelled') status = 'cancelled';
    if (['neutral', 'skipped'].includes(conclusion)) status = 'unknown';
    return { id: text(run.id, `workflow-${index + 1}`), name: text(run.name, 'unknown'), status, rawStatus: statusText, conclusion, headSha: checkHeadSha(run), prNumber: Number(run.prNumber || run.pull_requests?.[0]?.number || 0) || null, goalId: text(run.goalId), url: text(run.url || run.html_url), updatedAt: text(run.updatedAt || run.updated_at || run.completed_at || run.run_started_at) };
  });
  const pullRequests = list(raw.pullRequests || raw.prs).map((pr) => {
    const number = Number(pr.number || pr.prNumber || 0) || null;
    const headSha = text(pr.headSha || pr.head?.sha, '');
    const providedChecks = list(pr.checks).map((check) => ({
      ...check,
      name: text(check.name),
      headSha: checkHeadSha(check),
      updatedAt: text(check.updatedAt || check.updated_at || check.completed_at),
    }));
    const workflowChecks = exactHeadWorkflowChecks(workflows, number, headSha);
    const checkEvaluation = evaluateRequiredExactHeadChecks([...providedChecks, ...workflowChecks], headSha);
    const checksStatus = checkEvaluation.status;
    const blockers = [...list(pr.blockers)];
    if (checksStatus !== 'passed') blockers.push('checks_not_passed_or_unknown');
    if (!headSha) blockers.push('head_sha_unknown');
    if (checkEvaluation.missing.length) blockers.push(`required_exact_head_checks_missing:${checkEvaluation.missing.join(',')}`);
    if (checkEvaluation.conflicts.length) blockers.push(`required_exact_head_checks_conflict:${checkEvaluation.conflicts.join(',')}`);
    const branch = text(pr.branch || pr.headRefName || pr.head?.ref, 'unknown');
    return {
      number,
      title: text(pr.title, 'unknown'),
      branch,
      headSha,
      url: text(pr.html_url || pr.url, ''),
      draft: pr.draft === true,
      mergeable: typeof pr.mergeable === 'boolean' ? pr.mergeable : null,
      updatedAt: text(pr.updatedAt || pr.updated_at),
      relatedIssues: durableIssueReferences(pr, raw.repository),
      checks: checkEvaluation.checks,
      checksStatus,
      requiredChecks: [...REQUIRED_EXACT_HEAD_WORKFLOWS],
      missingRequiredChecks: checkEvaluation.missing,
      conflictingRequiredChecks: checkEvaluation.conflicts,
      mergeReadiness: checksStatus === 'passed' ? text(pr.mergeReadiness, 'awaiting_exact_head_approval') : 'blocked_or_unknown',
      approvalStatus: text(pr.approvalStatus, 'unknown'),
      blockers: [...new Set(blockers)],
      supersededStatus: text(pr.supersededStatus, 'unknown'),
    };
  });
  const issues = list(raw.issues)
    .filter((issue) => !issue?.pull_request)
    .map((issue) => ({
      number: Number(issue.number || issue.issueNumber || 0) || null,
      title: text(issue.title, 'Untitled goal'),
      state: lc(issue.state || 'open'),
      url: text(issue.html_url || issue.url, ''),
      labels: normalizeLabels(issue.labels),
      assignees: normalizeAssignees(issue.assignees),
      milestone: text(issue.milestone?.title || issue.milestone),
      createdAt: text(issue.createdAt || issue.created_at),
      updatedAt: text(issue.updatedAt || issue.updated_at),
    }))
    .filter((issue) => issue.number !== null);
  const blockers = [];
  if (!available) blockers.push('github_adapter_unavailable');
  if (available && !issueInventoryComplete) blockers.push('github_issue_inventory_incomplete');
  if (available && !pullRequestInventoryComplete) blockers.push('github_pull_request_inventory_incomplete');
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
    issues,
    issueCount: issues.length,
    issueInventoryObserved,
    issueInventoryComplete,
    pullRequestInventoryObserved,
    pullRequestInventoryComplete,
    workflows,
    workflowCounts: countBy(workflows, 'status'),
    blockers,
    nextOperatorAction: available && issueInventoryComplete && pullRequestInventoryComplete
      ? 'Review actionable GitHub notifications, blocked PRs, and failed workflows before merge decisions.'
      : (available ? 'Restore complete GitHub issue and pull-request inventories before treating the dashboard as current truth.' : 'Configure the read-only GitHub adapter/token; GitHub truth remains unavailable.'),
    mutationAllowed: false,
    mergeAllowed: false,
  };
}
async function githubJson(url, auth, fetchImpl = fetch) {
  const response = await fetchImpl(url, { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${auth.token}`, 'User-Agent': 'stephanos-readonly-github-telemetry' } });
  if (!response.ok) { const error = new Error(`GitHub API request failed (${response.status})`); error.status = response.status; throw error; }
  return response.json();
}
async function githubPaginatedArray(url, auth, fetchImpl = fetch) {
  const items = [];
  for (let page = 1; page <= MAX_GITHUB_PAGES; page += 1) {
    const requestUrl = new URL(url);
    requestUrl.searchParams.set('per_page', String(GITHUB_PAGE_SIZE));
    requestUrl.searchParams.set('page', String(page));
    const payload = await githubJson(requestUrl.href, auth, fetchImpl);
    if (!Array.isArray(payload)) throw new Error('GitHub paginated inventory response was not an array');
    items.push(...payload);
    if (payload.length < GITHUB_PAGE_SIZE) return items;
  }
  throw new Error(`GitHub paginated inventory exceeded ${MAX_GITHUB_PAGES} pages`);
}
async function readGithubTelemetryWithAuth(repoConfig, auth, options = {}) {
  const { owner, repo } = repoConfig;
  const fetchImpl = options.fetchImpl || fetch;
  const [notifications, prs, issues, workflowRuns, repositoryMetadata] = await Promise.all([
    githubJson('https://api.github.com/notifications?all=false&participating=false', auth, fetchImpl),
    githubPaginatedArray(`https://api.github.com/repos/${owner}/${repo}/pulls?state=open`, auth, fetchImpl),
    githubPaginatedArray(`https://api.github.com/repos/${owner}/${repo}/issues?state=open&sort=updated&direction=desc`, auth, fetchImpl),
    githubJson(`https://api.github.com/repos/${owner}/${repo}/actions/runs?per_page=50`, auth, fetchImpl),
    githubJson(`https://api.github.com/repos/${owner}/${repo}`, auth, fetchImpl),
  ]);
  return normalizeGithubTelemetry({ available: true, source: 'github-api', authAuthority: auth.authority, repository: { ...repoConfig, defaultBranch: text(repositoryMetadata.default_branch) }, notifications, pullRequests: prs, pullRequestInventoryComplete: true, issues, issueInventoryComplete: true, workflows: workflowRuns.workflow_runs || [] }, options);
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
    const prHint = positiveInteger(goal.prNumber)
      || positiveInteger(String(goal.lastKnownPR || '').match(/^(?:PR\s*)?#?(\d+)$/i)?.[1]);
    const issueNumber = positiveInteger(goal.issueNumber)
      || positiveInteger(String(goal.relatedGoal || goal.issue || '').match(/^#?(\d+)$/)?.[1]);
    const pr = list(githubTelemetry.pullRequests).find((candidate) => candidate.number === prHint || (issueNumber && list(candidate.relatedIssues).includes(issueNumber)));
    const workflows = pr ? list(githubTelemetry.workflows).filter((run) => run.prNumber === pr.number && run.headSha === pr.headSha) : [];
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
