import { resolveGithubAuth, resolveGithubGhCliAuth } from './githubAuthResolver.js';

function asText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function asList(value) {
  return Array.isArray(value) ? value.filter(Boolean).map((entry) => String(entry).trim()).filter(Boolean) : [];
}

function parseRepoSlug(repoSlug = '') {
  const match = asText(repoSlug, '').match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!match) return { owner: '', repo: '' };
  return { owner: match[1], repo: match[2] };
}

export function resolveGithubRepoConfig(env = process.env) {
  const repoSlug = asText(env.GITHUB_REPOSITORY || env.GITHUB_REPO || env.STEPHANOS_GITHUB_REPOSITORY, '');
  const fromSlug = parseRepoSlug(repoSlug);
  const owner = asText(env.GITHUB_REPO_OWNER || env.REPO_OWNER, fromSlug.owner);
  const repo = asText(env.GITHUB_REPO_NAME || env.REPO_NAME, fromSlug.repo);
  if (!owner || !repo) return null;
  return { owner, repo };
}

function normalizeChecksState(conclusions = []) {
  const lowered = conclusions.map((value) => asText(value, '').toLowerCase());
  if (lowered.some((state) => ['failure', 'failed', 'timed_out', 'cancelled', 'action_required'].includes(state))) return 'failed';
  if (lowered.some((state) => ['queued', 'in_progress', 'pending', 'waiting'].includes(state))) return 'pending';
  if (lowered.length > 0 && lowered.every((state) => ['success', 'skipped', 'neutral'].includes(state))) return 'passed';
  return 'unknown';
}

export async function resolveGithubTokenConfig(options = {}) {
  return resolveGithubAuth(options);
}

export async function fetchGithubPrEvidence({ owner, repo, prNumber, token, auth, ghTokenProvider, fetchImpl = fetch }) {
  let activeAuth = auth || { token, authority: 'unknown', configured: Boolean(token) };
  const request = async (candidateAuth) => {
    const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${candidateAuth.token}`, 'User-Agent': 'stephanos-readonly-pr-evidence' };
    return fetchImpl(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, { headers });
  };
  let prRes = await request(activeAuth);
  if (prRes.status === 403 && activeAuth.authority !== 'gh-cli') {
    const ghAuth = await resolveGithubGhCliAuth({ ghTokenProvider });
    if (ghAuth.configured) { activeAuth = ghAuth; prRes = await request(activeAuth); }
  }
  if (!prRes.ok) return { status: 'error', source: 'github-api', owner, repo, prNumber, authAuthority: activeAuth.authority, recommendedNextAction: `GitHub API request failed (${prRes.status}).` };
  const pr = await prRes.json();
  const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${activeAuth.token}`, 'User-Agent': 'stephanos-readonly-pr-evidence' };
  const filesRes = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100`, { headers });
  const files = filesRes.ok ? await filesRes.json() : [];
  const checksRes = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/commits/${pr.head?.sha}/check-runs`, { headers });
  const checksPayload = checksRes.ok ? await checksRes.json() : { check_runs: [] };
  const checkRuns = asList(checksPayload?.check_runs?.map((run) => run?.conclusion || run?.status));
  const failingChecks = asList(checksPayload?.check_runs?.filter((run) => ['failure', 'failed', 'timed_out', 'cancelled', 'action_required'].includes(asText(run?.conclusion || run?.status, '').toLowerCase())).map((run) => run?.name));
  const checksStatus = normalizeChecksState(checkRuns);
  const changedFiles = asList(files.map((file) => file?.filename));
  const missingProof = [];
  if (checksStatus !== 'passed') missingProof.push('checks');
  const mergeReadiness = pr.merged ? 'already-merged' : (checksStatus === 'failed' ? 'needs-amendment' : (checksStatus === 'passed' ? 'merge-candidate' : 'needs-proof'));
  return {
    status: 'fetched', source: 'github-api', authAuthority: activeAuth.authority, owner, repo, repository: `${owner}/${repo}`, prNumber: Number(pr.number || prNumber),
    prUrl: asText(pr.html_url, ''), prTitle: asText(pr.title, ''), prState: asText(pr.state, 'unknown'), merged: pr.merged === true,
    headSha: asText(pr.head?.sha, ''), headBranch: asText(pr.head?.ref, ''), baseBranch: asText(pr.base?.ref, ''), baseSha: asText(pr.base?.sha, ''),
    mergedAt: asText(pr.merged_at, ''), closedAt: asText(pr.closed_at, ''), mergeCommitSha: asText(pr.merge_commit_sha, ''),
    changedFiles, changedFileCount: changedFiles.length, checksStatus, failingChecks,
    buildStatus: checksStatus === 'passed' ? 'passed' : 'unknown', verifyStatus: checksStatus === 'passed' ? 'passed' : 'unknown', browserProofStatus: 'unknown',
    codexTaskPresent: 'unknown', codexTaskRefs: [], retrievedAt: new Date().toISOString(), evidenceWarnings: [], missingProof,
    mergeReadiness, recommendedNextAction: mergeReadiness === 'merge-candidate' ? 'Operator approval required before merge.' : 'Collect remaining PR proof before merge decision.',
  };
}
