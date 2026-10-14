// #1574. Read-only, authenticated GitHub evidence acquisition for ChatGPT-first goals.
// Source adapter only: no queue, runtime worker, scheduler, or claim authority.
import { createHash } from 'node:crypto';
import { planChatgptGithubGoalCandidatesV1 } from './chatgptGithubGoalPickerV1.mjs';

export const CHATGPT_GITHUB_DISCOVERY_SCHEMA = 'stephanos.chatgpt-github-authenticated-discovery.v1';
const REPO = 'Cheekyfellastef/stephan-os';
const ENDPOINT = 'https://api.github.com/graphql';
const SHA = /^[a-f0-9]{40}$/;
const MAX_PAGES = 6;
const PER_PAGE = 40;
const MAX_OPEN_PRS = MAX_PAGES * PER_PAGE;
const SAFE_CURSOR = /^[A-Za-z0-9_\/+\-=]{1,256}$/;
const GRAPHQL = `query($owner:String!,$repo:String!,$issue:Int!,$cursor:String){
 repository(owner:$owner,name:$repo){
  defaultBranchRef{name target{... on Commit{oid}}}
  issue(number:$issue){number title state}
  pullRequests(first:40,states:OPEN,after:$cursor,orderBy:{field:CREATED_AT,direction:ASC}){
   totalCount pageInfo{hasNextPage endCursor}
   nodes{number baseRefName headRefName headRefOid files(first:100){totalCount pageInfo{hasNextPage} nodes{path}}}
  }
 }
}`;
const blocked = (code, data = {}) => Object.freeze({
  schemaVersion: CHATGPT_GITHUB_DISCOVERY_SCHEMA, repository: REPO,
  disposition: 'HELD', blocker: code, ...data,
  authenticatedGoalAndPrEvidence: false,
  crossSystemOwnershipAuthenticated: false,
  sourceMutationAllowed: false, mergeAllowed: false, unattendedRefillAllowed: false,
});
const plain = obj => obj !== null && typeof obj === 'object' && !Array.isArray(obj);
const safePath = value => typeof value === 'string' && value.length >= 2 && value.length <= 240
  && /^[A-Za-z0-9_.\/-]+$/.test(value) && !value.startsWith('/') && !value.includes('//')
  && value.split('/').every(part => part && !['.', '..', '.git', 'dist', 'node_modules'].includes(part.toLowerCase()));
const safePr = value => Number.isSafeInteger(value?.number) && value.number > 0
  && typeof value.baseRefName === 'string' && value.baseRefName.length > 0
  && typeof value.headRefName === 'string' && value.headRefName.length > 0 && value.headRefName.length <= 240
  && typeof value.headRefOid === 'string' && SHA.test(value.headRefOid)
  && plain(value.files) && value.files.pageInfo?.hasNextPage === false
  && Number.isSafeInteger(value.files.totalCount) && value.files.totalCount >= 1
  && value.files.totalCount <= 100
  && Array.isArray(value.files.nodes) && value.files.nodes.length === value.files.totalCount
  && value.files.nodes.every(node => safePath(node?.path));

/**
 * Caller MUST use the GitHub token of an already trusted host, not a task
 * supplied token. Fixed read-only GraphQL query, no mutation endpoint.
 * Injected fetchers in tests demonstrate logic, not authentication provenance.
 * This never grants write, lease, or merge authority.
 */
export async function readChatgptGithubGoalEstateV1({
  issueNumber, token, fetchImpl = fetch, nowUtc = new Date().toISOString(),
} = {}) {
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1)
    return blocked('GOAL_ISSUE_NUMBER_INVALID');
  if (typeof token !== 'string' || !token.trim())
    return blocked('GITHUB_CREDENTIAL_UNAVAILABLE');
  if (typeof fetchImpl !== 'function' || !Number.isFinite(Date.parse(nowUtc)))
    return blocked('GITHUB_OBSERVER_INVALID');
  let cursor = null;
  let mainHead = '';
  let issueTitle = '';
  let total = -1;
  const seenCursors = new Set();
  const claims = [];
  const seenPrs = new Set();
  for (let page = 0; page < MAX_PAGES; page++) {
    let response;
    try {
      response = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'User-Agent': 'stephanos-chatgpt-github-goal-discovery-v1' },
        body: JSON.stringify({ query: GRAPHQL, variables: { owner: 'Cheekyfellastef', repo: 'stephan-os', issue: issueNumber, cursor } }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (_) { return blocked('GITHUB_AUTHENTICATED_READ_FAILED'); }
    if (!response?.ok) return blocked(response?.status === 403 ? 'GITHUB_READ_QUOTA_OR_PERMISSION_HOLD' : 'GITHUB_AUTHENTICATED_READ_FAILED');
    let result;
    try { result = await response.json(); } catch (_) { return blocked('GITHUB_RESPONSE_UNPARSEABLE'); }
    if (!plain(result) || (Array.isArray(result.errors) && result.errors.length > 0) || !plain(result.data?.repository))
      return blocked('GITHUB_GRAPHQL_INCOMPLETE_OR_ERROR');
    const data = result.data.repository;
    const observedMain = data.defaultBranchRef?.name === 'main' ? data.defaultBranchRef.target?.oid : '';
    if (typeof observedMain !== 'string' || !SHA.test(observedMain) || (mainHead && observedMain !== mainHead))
      return blocked('GITHUB_MAIN_MOVED_OR_UNPROVEN');
    mainHead = observedMain;
    if (data.issue?.number !== issueNumber || data.issue?.state !== 'OPEN'
      || typeof data.issue?.title !== 'string' || !data.issue.title.trim() || data.issue.title.length > 200)
      return blocked('GITHUB_GOAL_NOT_OPEN_OR_UNPROVEN');
    if (issueTitle && issueTitle !== data.issue.title) return blocked('GITHUB_ISSUE_CHANGED_DURING_SCAN');
    issueTitle = data.issue.title;
    const prs = data.pullRequests;
    if (!plain(prs) || !Number.isSafeInteger(prs.totalCount) || prs.totalCount < 0 || prs.totalCount > MAX_OPEN_PRS
      || !Array.isArray(prs.nodes) || prs.nodes.length > PER_PAGE || !plain(prs.pageInfo)
      || typeof prs.pageInfo.hasNextPage !== 'boolean')
      return blocked('GITHUB_PR_INVENTORY_UNBOUNDED_OR_INCOMPLETE');
    if (total >= 0 && total !== prs.totalCount) return blocked('GITHUB_PR_ESTATE_CHANGED_DURING_SCAN');
    total = prs.totalCount;
    for (const pr of prs.nodes) {
      if (!safePr(pr) || seenPrs.has(pr.number)) return blocked('GITHUB_PR_SCOPE_UNPROVEN');
      seenPrs.add(pr.number);
      const branchMatch = /^chatgpt\/goal-[0-9]+-([a-z0-9][a-z0-9-]{2,63})$/.exec(pr.headRefName);
      claims.push(Object.freeze({ prNumber: pr.number, taskId: branchMatch?.[1] || null,
        headSha: pr.headRefOid,
        evidenceRef: `github:graphql:pr-${pr.number}:head-${pr.headRefOid}`,
        paths: Object.freeze(pr.files.nodes.map(file => file.path)),
      }));
    }
    if (!prs.pageInfo.hasNextPage) {
      if (claims.length !== total)
        return blocked('GITHUB_PR_COUNT_MISMATCH');
      // Bind every PR number, exact observed head and its full path inventory
      // into this GitHub-only observation. Any PR update invalidates the digest.
      // A new trusted read is still mandatory before source reservation.
      const snapshotSha256 = createHash('sha256').update(JSON.stringify({
        mainHead, issueNumber, issueTitle, claims,
      }), 'utf8').digest('hex');
      return Object.freeze({
        schemaVersion: CHATGPT_GITHUB_DISCOVERY_SCHEMA,
        repository: REPO,
        disposition: 'GITHUB_SOURCE_ESTATE_READ_ONLY',
        mainHead, issueNumber, issueTitle, issueState: 'open',
        readAtUtc: nowUtc, pagesFetched: page + 1, openPrCount: total,
        snapshotSha256,
        openPrEvidence: Object.freeze({mainHead, observedAtUtc: nowUtc,
          evidenceRef: `github:graphql:issue-${issueNumber}:main-${mainHead}:snapshot-sha256-${snapshotSha256}`,
          claims: Object.freeze(claims)}),
        authenticatedGoalAndPrEvidence: true,
        crossSystemOwnershipAuthenticated: false,
        sourceMutationAllowed: false, mergeAllowed: false, unattendedRefillAllowed: false,
      });
    }
    const next = prs.pageInfo.endCursor;
    if (typeof next !== 'string' || !SAFE_CURSOR.test(next) || seenCursors.has(next))
      return blocked('GITHUB_PR_CURSOR_INVALID_OR_REPEATED');
    seenCursors.add(next);
    cursor = next;
  }
  return blocked('GITHUB_PR_ESTATE_PAGINATION_INCOMPLETE');
}

/** Actual GitHub issue and open-PR evidence are passed into the existing
 * fail-closed planner. Four physical custody observations are not available
 * here. No missing local claims are interpreted as free ownership.
 */
export async function planChatgptGithubAuthenticatedDiscoveryV1({
  issueNumber, tasks = [], token, fetchImpl = fetch, nowUtc = new Date().toISOString(),
} = {}) {
  const evidence = await readChatgptGithubGoalEstateV1({ issueNumber, token, fetchImpl, nowUtc });
  if (evidence.disposition === 'HELD') return evidence;
  if (!Array.isArray(tasks) || tasks.length > 25)
    return blocked('TASK_CANDIDATE_SET_INVALID');
  const candidates = tasks.map(task => ({
    issueNumber, issueTitle: evidence.issueTitle, issueState: evidence.issueState,
    taskId: task?.taskId, taskClass: task?.taskClass, riskTier: task?.riskTier,
    paths: task?.paths, sourceHead: evidence.mainHead,
    // Requires an independently authenticated runtime/local observer.
    ownershipEvidence: undefined,
    openPrEvidence: evidence.openPrEvidence,
  }));
  const plan = planChatgptGithubGoalCandidatesV1({mainHead: evidence.mainHead, nowUtc, candidates});
  return Object.freeze({ ...evidence, plan,
    disposition: 'GITHUB_VERIFIED_LOCAL_OWNERSHIP_PENDING',
    sourceMutationAllowed: false, mergeAllowed: false, unattendedRefillAllowed: false,
  });
}
