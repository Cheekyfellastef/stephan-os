import { createHash } from 'node:crypto';
import { resolveGithubAuth, resolveGithubGhCliAuth } from './githubAuthResolver.js';
import {
  PROTECTED_APPROVAL_MARKER,
  extractJsonObjects,
  projectProtectedApprovalReceiptForWorkspace,
} from '../../shared/agents/operatorMergeApprovalGate.mjs';

export const GITHUB_GOAL_ADMISSION_SCHEMA = 'stephanos.github-goal-admission.v1';
export const GITHUB_GOAL_ADMISSION_MARKER = 'stephanos-goal-admission-v1';
export const GITHUB_GOAL_AUTO_ADMISSION_SCHEMA = 'stephanos.github-goal-auto-admission.v1';
export const GITHUB_GOAL_AUTO_ADMISSION_MARKER = 'stephanos-goal-auto-admission-v1';

const GITHUB_GOAL_ADMISSION_KEYS = new Set([
  'arbitraryShellAllowed', 'deploymentAuthority', 'issueNumber', 'mergeAuthority', 'prerequisites',
  'repository', 'route', 'runtimeMutationAuthority', 'schemaVersion', 'sourceImplementationAllowed', 'state',
]);
const GITHUB_GOAL_AUTO_ADMISSION_KEYS = new Set([
  'arbitraryShellAllowed', 'contentHash', 'creatorLogin', 'deploymentAuthority', 'issueNumber', 'mergeAuthority',
  'repository', 'route', 'runtimeMutationAuthority', 'schemaVersion', 'sourceImplementationAllowed', 'state',
]);
const GITHUB_GOAL_ESTATE_CACHE_TTL_MS = 5 * 60 * 1000;
const GITHUB_GOAL_ESTATE_CACHE_MAX_TTL_MS = 15 * 60 * 1000;
const GITHUB_GOAL_ESTATE_FAILURE_BACKOFF_MS = 30 * 1000;
const GITHUB_GOAL_ESTATE_REQUEST_TIMEOUT_MS = 10 * 1000;
const githubGoalEstateCache = new Map();

function asText(value, fallback = '') { const text = String(value ?? '').trim(); return text || fallback; }
function asList(value) { return Array.isArray(value) ? value.filter(Boolean).map((entry) => String(entry).trim()).filter(Boolean) : []; }
function parseRepoSlug(repoSlug = '') { const match = asText(repoSlug).match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/); return match ? { owner: match[1], repo: match[2] } : { owner: '', repo: '' }; }
function githubHeaders(auth, userAgent) { return { Accept: 'application/vnd.github+json', Authorization: `Bearer ${auth.token}`, 'User-Agent': userAgent }; }
function plainObject(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) return false; const prototype = Object.getPrototypeOf(value); return prototype === Object.prototype || prototype === null; }
function durableGoalTitle(value) {
  const title = asText(value);
  return /^(?:goal|programme|canary goal|automation debt|repair|restore)(?::|\s)\s*/i.test(title)
    && !/\b(?:temp|placeholder|do not use|accidental|discarded)\b/i.test(title);
}
function normalizedGoalTitleKey(value) { return asText(value).toLowerCase().replace(/\s+/g, ' '); }
function goalContentHash(issue = {}) {
  const payload = `${asText(issue?.title)}\n${String(issue?.body ?? '')}`;
  return `sha256:${createHash('sha256').update(payload, 'utf8').digest('hex')}`;
}
function priorityFromLabels(labels = []) {
  const set = new Set(labels);
  if (set.has('priority-critical') || set.has('priority:critical')) return 1000;
  if (set.has('priority-high') || set.has('priority:high')) return 750;
  if (set.has('priority-medium') || set.has('priority:medium')) return 500;
  if (set.has('priority-low') || set.has('priority:low')) return 250;
  return 0;
}
function goalClassFromIssue(issue = {}, labels = []) {
  const title = asText(issue?.title);
  return labels.includes('automation-debt') || /^automation debt:/i.test(title) || /^(?:repair|restore)\b/i.test(title)
    ? 'AUTOMATION_DEBT'
    : 'DURABLE_GOAL';
}

function sourceImplementationAdmission(issueNumber, repository) {
  return Object.freeze({
    schemaVersion: GITHUB_GOAL_ADMISSION_SCHEMA,
    issueNumber,
    repository,
    state: 'READY',
    route: 'OPENCLAW_LOCAL',
    prerequisites: Object.freeze([]),
    sourceImplementationAllowed: true,
    mergeAuthority: false,
    deploymentAuthority: false,
    runtimeMutationAuthority: false,
    arbitraryShellAllowed: false,
  });
}

function parseGoalAdmissionBody(body, issueNumber, repository) {
  const pattern = new RegExp('```' + GITHUB_GOAL_ADMISSION_MARKER + '\\s*([\\s\\S]*?)```', 'g');
  const matches = [...String(body ?? '').matchAll(pattern)];
  if (matches.length !== 1) return null;
  let payload;
  try { payload = JSON.parse(matches[0][1]); } catch { return null; }
  if (!plainObject(payload) || Object.keys(payload).some((key) => !GITHUB_GOAL_ADMISSION_KEYS.has(key))) return null;
  if (payload.schemaVersion !== GITHUB_GOAL_ADMISSION_SCHEMA) return null;
  if (Number(payload.issueNumber) !== issueNumber) return null;
  if (asText(payload.repository).toLowerCase() !== repository.toLowerCase()) return null;
  if (asText(payload.state).toUpperCase() !== 'READY') return null;
  if (asText(payload.route).toUpperCase() !== 'OPENCLAW_LOCAL') return null;
  if (!Array.isArray(payload.prerequisites) || payload.prerequisites.length !== 0) return null;
  if (payload.sourceImplementationAllowed !== true || payload.mergeAuthority !== false || payload.deploymentAuthority !== false || payload.runtimeMutationAuthority !== false || payload.arbitraryShellAllowed !== false) return null;
  return sourceImplementationAdmission(issueNumber, repository);
}

function normalizeGoalDiscovery(issue, repository, retrievedAt) {
  const issueNumber = Number(issue?.number);
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1 || issue?.pull_request || asText(issue?.state).toLowerCase() !== 'open') return null;
  const labels = (Array.isArray(issue?.labels) ? issue.labels : []).map((label) => asText(typeof label === 'string' ? label : label?.name).toLowerCase()).filter(Boolean);
  if (!labels.includes('goal')) return null;
  const title = asText(issue?.title); if (!title) return null;
  const goalClass = goalClassFromIssue(issue, labels);
  return Object.freeze({
    issueNumber,
    title,
    state: 'open',
    labels: Object.freeze([...new Set(labels)].sort()),
    htmlUrl: asText(issue?.html_url),
    createdAt: asText(issue?.created_at),
    updatedAt: asText(issue?.updated_at),
    repository,
    retrievedAt,
    creatorLogin: asText(issue?.user?.login),
    authorAssociation: asText(issue?.author_association).toUpperCase(),
    goalClass,
    automationDebtWeight: goalClass === 'AUTOMATION_DEBT' ? 60 : 0,
    priority: priorityFromLabels(labels),
    recurrenceCount: 0,
    operatorToilWeight: 0,
    blastRadiusWeight: 0,
    effortWeight: 0,
    admissionState: 'DISCOVERED_CANDIDATE',
    schedulerEligible: false,
    sourceMutationAuthority: false,
    mergeAuthority: false,
    deploymentAuthority: false,
    runtimeMutationAuthority: false,
    arbitraryShellAllowed: false,
  });
}

function trustedOwnerGoalLabelAdmission(issue, events, owner, issueNumber, repository) {
  if (asText(issue?.user?.login).toLowerCase() !== asText(owner).toLowerCase()) return null;
  if (asText(issue?.author_association).toUpperCase() !== 'OWNER') return null;
  const goalEvents = (Array.isArray(events) ? events : []).filter((event) => asText(event?.event).toLowerCase() === 'labeled' && asText(event?.label?.name).toLowerCase() === 'goal');
  if (goalEvents.length === 0) return null;
  const latest = goalEvents[goalEvents.length - 1];
  if (asText(latest?.actor?.login).toLowerCase() !== asText(owner).toLowerCase()) return null;
  return sourceImplementationAdmission(issueNumber, repository);
}

function trustedOwnerAdmission(comments, owner, issueNumber, repository) {
  const candidates = [];
  for (const comment of Array.isArray(comments) ? comments : []) {
    if (asText(comment?.user?.login).toLowerCase() !== asText(owner).toLowerCase()) continue;
    if (asText(comment?.author_association).toUpperCase() !== 'OWNER') continue;
    const admission = parseGoalAdmissionBody(comment?.body, issueNumber, repository); if (admission) candidates.push(admission);
  }
  return candidates.length === 1 ? candidates[0] : null;
}

function trustedWorkflowAutoAdmission(comments, issue, owner, issueNumber, repository) {
  if (asText(issue?.user?.login).toLowerCase() !== asText(owner).toLowerCase()) return null;
  if (asText(issue?.author_association).toUpperCase() !== 'OWNER') return null;
  if (!durableGoalTitle(issue?.title)) return null;
  const expectedHash = goalContentHash(issue);
  const candidates = [];
  const pattern = new RegExp('```' + GITHUB_GOAL_AUTO_ADMISSION_MARKER + '\\s*([\\s\\S]*?)```', 'g');
  for (const comment of Array.isArray(comments) ? comments : []) {
    if (asText(comment?.user?.login).toLowerCase() !== 'github-actions[bot]') continue;
    const matches = [...String(comment?.body ?? '').matchAll(pattern)];
    if (matches.length !== 1) continue;
    let payload;
    try { payload = JSON.parse(matches[0][1]); } catch { continue; }
    if (!plainObject(payload) || Object.keys(payload).some((key) => !GITHUB_GOAL_AUTO_ADMISSION_KEYS.has(key))) continue;
    if (payload.schemaVersion !== GITHUB_GOAL_AUTO_ADMISSION_SCHEMA) continue;
    if (Number(payload.issueNumber) !== issueNumber) continue;
    if (asText(payload.repository).toLowerCase() !== repository.toLowerCase()) continue;
    if (asText(payload.creatorLogin).toLowerCase() !== asText(owner).toLowerCase()) continue;
    if (asText(payload.contentHash).toLowerCase() !== expectedHash.toLowerCase()) continue;
    if (asText(payload.state).toUpperCase() !== 'READY' || asText(payload.route).toUpperCase() !== 'OPENCLAW_LOCAL') continue;
    if (payload.sourceImplementationAllowed !== true || payload.mergeAuthority !== false || payload.deploymentAuthority !== false || payload.runtimeMutationAuthority !== false || payload.arbitraryShellAllowed !== false) continue;
    candidates.push(sourceImplementationAdmission(issueNumber, repository));
  }
  return candidates.length > 0 ? candidates[0] : null;
}

function normalizeGoalIssue(issue, repository, retrievedAt, comments, owner, events = []) {
  const discovery = normalizeGoalDiscovery(issue, repository, retrievedAt); if (!discovery) return null;
  const ownerLabelAdmission = trustedOwnerGoalLabelAdmission(issue, events, owner, discovery.issueNumber, repository);
  const ownerCommentAdmission = trustedOwnerAdmission(comments, owner, discovery.issueNumber, repository);
  const workflowAutoAdmission = trustedWorkflowAutoAdmission(comments, issue, owner, discovery.issueNumber, repository);
  const admission = ownerLabelAdmission || ownerCommentAdmission || workflowAutoAdmission;
  if (!admission) return null;
  const admissionProofSource = ownerLabelAdmission
    ? 'OWNER_AUTHENTICATED_GOAL_LABEL_EVENT'
    : ownerCommentAdmission
      ? 'OWNER_AUTHENTICATED_COMMENT'
      : 'GITHUB_ACTIONS_OWNER_GOAL_AUTO_ADMISSION';
  return Object.freeze({
    ...discovery,
    admission,
    admissionState: 'ADMISSION_PROVEN',
    admissionProofSource,
    schedulerEligible: true,
  });
}

export function resolveGithubRepoConfig(env = process.env) {
  const repoSlug = asText(env.GITHUB_REPOSITORY || env.GITHUB_REPO || env.STEPHANOS_GITHUB_REPOSITORY); const fromSlug = parseRepoSlug(repoSlug);
  const owner = asText(env.GITHUB_REPO_OWNER || env.REPO_OWNER, fromSlug.owner); const repo = asText(env.GITHUB_REPO_NAME || env.REPO_NAME, fromSlug.repo); return owner && repo ? { owner, repo } : null;
}
function normalizeChecksState(conclusions = []) { const lowered = conclusions.map((value) => asText(value).toLowerCase()); if (lowered.some((state) => ['failure','failed','timed_out','cancelled','action_required'].includes(state))) return 'failed'; if (lowered.some((state) => ['queued','in_progress','pending','waiting'].includes(state))) return 'pending'; if (lowered.length > 0 && lowered.every((state) => ['success','skipped','neutral'].includes(state))) return 'passed'; return 'unknown'; }
export async function resolveGithubTokenConfig(options = {}) { return resolveGithubAuth(options); }

export async function fetchGithubGoalIssues({ owner, repo, token, auth, ghTokenProvider, fetchImpl = fetch, maxPages = 10, maxCommentPages = 10, maxEventPages = 10, cacheEnabled, cacheTtlMs = GITHUB_GOAL_ESTATE_CACHE_TTL_MS, failureBackoffMs = GITHUB_GOAL_ESTATE_FAILURE_BACKOFF_MS, requestTimeoutMs = GITHUB_GOAL_ESTATE_REQUEST_TIMEOUT_MS, nowMs = Date.now } = {}) {
  const repository = `${asText(owner)}/${asText(repo)}`;
  if (!parseRepoSlug(repository).owner) return Object.freeze({ status: 'error', source: 'github-api', repository, issues: Object.freeze([]), discoveredIssues: Object.freeze([]), recommendedNextAction: 'GitHub goal-estate repository identity is invalid.' });

  const rawNowMs = Number(typeof nowMs === 'function' ? nowMs() : nowMs); const observedNowMs = Number.isFinite(rawNowMs) ? rawNowMs : Date.now();
  const boundedCacheTtlMs = Math.min(Math.max(Number(cacheTtlMs) || GITHUB_GOAL_ESTATE_CACHE_TTL_MS, 15_000), GITHUB_GOAL_ESTATE_CACHE_MAX_TTL_MS);
  const boundedFailureBackoffMs = Math.min(Math.max(Number(failureBackoffMs) || GITHUB_GOAL_ESTATE_FAILURE_BACKOFF_MS, 5_000), 5 * 60 * 1000);
  const boundedRequestTimeoutMs = Math.min(Math.max(Number(requestTimeoutMs) || GITHUB_GOAL_ESTATE_REQUEST_TIMEOUT_MS, 1_000), 30_000);
  const shouldUseCache = cacheEnabled === undefined ? fetchImpl === fetch : cacheEnabled === true; const cacheKey = repository.toLowerCase();
  if (shouldUseCache) {
    const cached = githubGoalEstateCache.get(cacheKey); const cacheAgeMs = cached ? observedNowMs - cached.cachedAtMs : Number.POSITIVE_INFINITY;
    const ttl = cached?.failure ? boundedFailureBackoffMs : boundedCacheTtlMs;
    if (cached && cacheAgeMs >= 0 && cacheAgeMs < ttl) return cached.result;
  }
  const cacheFailure = (result) => { if (shouldUseCache) githubGoalEstateCache.set(cacheKey, { cachedAtMs: observedNowMs, result, failure: true }); return result; };

  let activeAuth = auth || { token, authority: 'unknown', configured: Boolean(token) };
  if (!activeAuth?.configured || !asText(activeAuth?.token)) return cacheFailure(Object.freeze({ status: 'error', source: 'github-api', repository, authAuthority: asText(activeAuth?.authority, 'unknown'), issues: Object.freeze([]), discoveredIssues: Object.freeze([]), recommendedNextAction: 'GitHub read authority is unavailable.' }));

  const observationController = new AbortController();
  const observationTimer = setTimeout(() => observationController.abort(), boundedRequestTimeoutMs);
  observationTimer.unref?.();
  const finishFailure = (result) => { clearTimeout(observationTimer); return cacheFailure(result); };

  const requestWithFallback = async (url, userAgent) => {
    const request = (candidateAuth) => fetchImpl(url, { headers: githubHeaders(candidateAuth, userAgent), signal: observationController.signal });
    let response;
    try { response = await request(activeAuth); } catch (error) { return { ok: false, status: error?.name === 'AbortError' ? 408 : 0 }; }
    if ([401, 403].includes(response.status) && activeAuth.authority !== 'gh-cli' && !observationController.signal.aborted) {
      const ghAuth = await resolveGithubGhCliAuth({ ghTokenProvider });
      if (ghAuth.configured) { activeAuth = ghAuth; try { response = await request(activeAuth); } catch (error) { return { ok: false, status: error?.name === 'AbortError' ? 408 : 0 }; } }
    }
    return response;
  };

  const pageLimit = Math.min(Math.max(Number(maxPages) || 1, 1), 10); const commentPageLimit = Math.min(Math.max(Number(maxCommentPages) || 1, 1), 10); const eventPageLimit = Math.min(Math.max(Number(maxEventPages) || 1, 1), 10); const retrievedAt = new Date(observedNowMs).toISOString(); const issues = []; const discoveredIssues = []; let admissionReadFailureCount = 0;
  for (let page = 1; page <= pageLimit; page += 1) {
    const response = await requestWithFallback(`https://api.github.com/repos/${owner}/${repo}/issues?state=open&labels=goal&per_page=100&page=${page}`, 'stephanos-readonly-goal-estate');
    if (!response.ok) return finishFailure(Object.freeze({ status: 'error', source: 'github-api', repository, authAuthority: activeAuth.authority, issues: Object.freeze([]), discoveredIssues: Object.freeze([]), retrievedAt, recommendedNextAction: `GitHub goal-estate request failed (${response.status}).` }));
    let payload;
    try { payload = await response.json(); } catch (error) { return finishFailure(Object.freeze({ status: 'error', source: 'github-api', repository, authAuthority: activeAuth.authority, issues: Object.freeze([]), discoveredIssues: Object.freeze([]), retrievedAt, recommendedNextAction: `GitHub goal-estate response failed (${error?.name === 'AbortError' ? 408 : 0}).` })); }
    if (!Array.isArray(payload)) return finishFailure(Object.freeze({ status: 'error', source: 'github-api', repository, authAuthority: activeAuth.authority, issues: Object.freeze([]), discoveredIssues: Object.freeze([]), retrievedAt, recommendedNextAction: 'GitHub goal-estate response was not an issue list.' }));
    for (const issue of payload) {
      const discovery = normalizeGoalDiscovery(issue, repository, retrievedAt); if (!discovery) continue; discoveredIssues.push(discovery);
      const ownerAuthored = asText(issue?.user?.login).toLowerCase() === asText(owner).toLowerCase() && asText(issue?.author_association).toUpperCase() === 'OWNER';
      if (ownerAuthored) {
        const events = []; let eventsReadable = true; let eventsComplete = false;
        for (let eventPage = 1; eventPage <= eventPageLimit; eventPage += 1) {
          const eventsResponse = await requestWithFallback(`https://api.github.com/repos/${owner}/${repo}/issues/${discovery.issueNumber}/events?per_page=100&page=${eventPage}`, 'stephanos-readonly-goal-label-authority');
          if (!eventsResponse.ok) { eventsReadable = false; break; }
          let eventsPage;
          try { eventsPage = await eventsResponse.json(); } catch { eventsReadable = false; break; }
          if (!Array.isArray(eventsPage)) { eventsReadable = false; break; }
          events.push(...eventsPage); if (eventsPage.length < 100) { eventsComplete = true; break; }
        }
        if (eventsReadable && eventsComplete) {
          const directlyAdmitted = normalizeGoalIssue(issue, repository, retrievedAt, [], owner, events);
          if (directlyAdmitted?.admissionProofSource === 'OWNER_AUTHENTICATED_GOAL_LABEL_EVENT') { issues.push(directlyAdmitted); continue; }
        } else {
          admissionReadFailureCount += 1;
          if (observationController.signal.aborted) return finishFailure(Object.freeze({ status: 'error', source: 'github-api', repository, authAuthority: activeAuth.authority, issues: Object.freeze([]), discoveredIssues: Object.freeze(discoveredIssues), retrievedAt, recommendedNextAction: 'GitHub goal-estate observation exceeded its bounded deadline (408).' }));
        }
      }
      const comments = []; let commentsReadable = true; let commentsComplete = false;
      for (let commentPage = 1; commentPage <= commentPageLimit; commentPage += 1) {
        const commentsResponse = await requestWithFallback(`https://api.github.com/repos/${owner}/${repo}/issues/${discovery.issueNumber}/comments?per_page=100&page=${commentPage}`, 'stephanos-readonly-goal-admission');
        if (!commentsResponse.ok) { commentsReadable = false; break; }
        let commentsPage;
        try { commentsPage = await commentsResponse.json(); } catch { commentsReadable = false; break; }
        if (!Array.isArray(commentsPage)) { commentsReadable = false; break; }
        comments.push(...commentsPage); if (commentsPage.length < 100) { commentsComplete = true; break; }
      }
      if (!commentsReadable || !commentsComplete) { admissionReadFailureCount += 1; if (observationController.signal.aborted) return finishFailure(Object.freeze({ status: 'error', source: 'github-api', repository, authAuthority: activeAuth.authority, issues: Object.freeze([]), discoveredIssues: Object.freeze(discoveredIssues), retrievedAt, recommendedNextAction: 'GitHub goal-estate observation exceeded its bounded deadline.' })); continue; }
      const normalized = normalizeGoalIssue(issue, repository, retrievedAt, comments, owner); if (normalized) issues.push(normalized);
    }
    if (payload.length < 100) break;
  }
  const uniqueByIssue = [...new Map(issues.map((issue) => [issue.issueNumber, issue])).values()].sort((a,b) => a.issueNumber-b.issueNumber);
  const duplicateSuppressed = [];
  const deduped = uniqueByIssue;
  const dedupedDiscoveries = [...new Map(discoveredIssues.map((issue) => [issue.issueNumber, issue])).values()].sort((a,b) => a.issueNumber-b.issueNumber);
  const result = Object.freeze({
    status: 'fetched',
    source: 'github-api',
    repository,
    authAuthority: activeAuth.authority,
    issues: Object.freeze(deduped),
    discoveredIssues: Object.freeze(dedupedDiscoveries),
    duplicateSuppressed: Object.freeze(duplicateSuppressed),
    retrievedAt,
    readOnly: true,
    admissionContractRequired: true,
    ownerAuthoredGoalsAutoAdmitted: false,
    trustedWorkflowAutoAdmissionEnabled: true,
    admissionProofSources: Object.freeze(['OWNER_AUTHENTICATED_GOAL_LABEL_EVENT', 'OWNER_AUTHENTICATED_COMMENT', 'GITHUB_ACTIONS_OWNER_GOAL_AUTO_ADMISSION']),
    admissionReadFailureCount,
    admissionSchemaVersion: GITHUB_GOAL_ADMISSION_SCHEMA,
    autoAdmissionSchemaVersion: GITHUB_GOAL_AUTO_ADMISSION_SCHEMA,
    mergeAuthority: false,
    runtimeMutationAuthority: false,
    arbitraryShellAllowed: false,
  });
  clearTimeout(observationTimer);
  if (shouldUseCache) githubGoalEstateCache.set(cacheKey, { cachedAtMs: observedNowMs, result, failure: false }); return result;
}

export async function fetchGithubPrEvidence({ owner, repo, prNumber, token, auth, ghTokenProvider, fetchImpl = fetch }) {
  let activeAuth = auth || { token, authority: 'unknown', configured: Boolean(token) };
  const request = async (candidateAuth) => fetchImpl(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, { headers: githubHeaders(candidateAuth, 'stephanos-readonly-pr-evidence') });
  let prRes = await request(activeAuth);
  if (prRes.status === 403 && activeAuth.authority !== 'gh-cli') { const ghAuth = await resolveGithubGhCliAuth({ ghTokenProvider }); if (ghAuth.configured) { activeAuth = ghAuth; prRes = await request(activeAuth); } }
  if (!prRes.ok) return { status: 'error', source: 'github-api', owner, repo, prNumber, authAuthority: activeAuth.authority, recommendedNextAction: `GitHub API request failed (${prRes.status}).` };
  const pr = await prRes.json(); const headers = githubHeaders(activeAuth, 'stephanos-readonly-pr-evidence');
  const filesRes = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100`, { headers }); const files = filesRes.ok ? await filesRes.json() : [];
  const checksRes = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/commits/${pr.head?.sha}/check-runs`, { headers }); const checksPayload = checksRes.ok ? await checksRes.json() : { check_runs: [] };
  const commentsRes = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100`, { headers }); const commentsPayload = commentsRes.ok ? await commentsRes.json() : [];
  const retrievedAt = new Date().toISOString(); const trustedOperatorApprovalReceipts = [];
  for (const comment of Array.isArray(commentsPayload) ? commentsPayload : []) { if (asText(comment?.user?.login).toLowerCase() !== 'github-actions[bot]') continue; if (!asText(comment?.body).includes(PROTECTED_APPROVAL_MARKER)) continue; for (const candidate of extractJsonObjects(comment.body)) { const projection = projectProtectedApprovalReceiptForWorkspace(candidate, { nowUtc: retrievedAt }); if (projection.valid) trustedOperatorApprovalReceipts.push(projection.receipt); } }
  const checkRuns = asList(checksPayload?.check_runs?.map((run) => run?.conclusion || run?.status));
  const failingChecks = asList(checksPayload?.check_runs?.filter((run) => ['failure','failed','timed_out','cancelled','action_required'].includes(asText(run?.conclusion || run?.status).toLowerCase())).map((run) => run?.name));
  const checksStatus = normalizeChecksState(checkRuns); const changedFiles = asList(files.map((file) => file?.filename)); const baseRepository = `${owner}/${repo}`; const headRepository = asText(pr.head?.repo?.full_name); const missingProof = []; if (checksStatus !== 'passed') missingProof.push('checks');
  const mergeReadiness = pr.merged ? 'already-merged' : checksStatus === 'failed' ? 'needs-amendment' : checksStatus === 'passed' ? 'merge-candidate' : 'needs-proof';
  return { status: 'fetched', source: 'github-api', authAuthority: activeAuth.authority, owner, repo, repository: headRepository, baseRepository, headRepository, headRepositoryMatchesBase: headRepository.toLowerCase() === baseRepository.toLowerCase(), prNumber: Number(pr.number || prNumber), prUrl: asText(pr.html_url), prTitle: asText(pr.title), prState: asText(pr.state, 'unknown'), merged: pr.merged === true, headSha: asText(pr.head?.sha), headBranch: asText(pr.head?.ref), baseBranch: asText(pr.base?.ref), baseSha: asText(pr.base?.sha), mergedAt: asText(pr.merged_at), closedAt: asText(pr.closed_at), mergeCommitSha: asText(pr.merge_commit_sha), changedFiles, changedFileCount: changedFiles.length, checksStatus, failingChecks, buildStatus: checksStatus === 'passed' ? 'passed' : 'unknown', verifyStatus: checksStatus === 'passed' ? 'passed' : 'unknown', browserProofStatus: 'unknown', codexTaskPresent: 'unknown', codexTaskRefs: [], retrievedAt, evidenceWarnings: [], missingProof, trustedOperatorApprovalReceipts, mergeReadiness, recommendedNextAction: mergeReadiness === 'merge-candidate' ? 'Operator approval required before merge.' : 'Collect remaining PR proof before merge decision.' };
}
