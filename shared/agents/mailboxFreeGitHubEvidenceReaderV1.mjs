// Original Goal #2315 Stage 3: read-only GitHub evidence acquisition for the
// ALREADY installed mailbox-free Control Tower. No second task producer or owner.
// This classifies an existing goal, never schedules/builds/claims/merges one.
import { decodeMailboxFreeGoalProofArchiveV1, classifyMailboxFreeGoalDiscoveryV1 } from './mailboxFreeGoalDiscoveryV1.mjs';

export const MAILBOX_FREE_GITHUB_READER_SCHEMA = 'stephanos.mailbox-free-github-reader.v1';
const REPO = 'Cheekyfellastef/stephan-os';
const REPO_ID = 1179385578;
const OWNER = 'Cheekyfellastef';
const OWNER_ID = 267490109;
const WORKFLOW_ID = 398609082;
const BASE = 'https://api.github.com/repos/' + REPO;
const MAX_JSON = 256 * 1024;
const MAX_ZIP = 64 * 1024;
const SHA = /^[a-f0-9]{40}$/;
const positive = n => Number.isSafeInteger(n) && n > 0 && n <= 9999999999999999;
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const denied = blocker => Object.freeze({
  schemaVersion: MAILBOX_FREE_GITHUB_READER_SCHEMA,
  disposition: 'HELD',
  blocker,
  independentlyAuthenticatedTransport: false,
  originalGoalAdmissionGranted: false,
  exclusiveClaimGranted: false,
  executionAuthorized: false,
  nativePickupProven: false,
  sourceMutationAllowed: false,
  protectedMergeAllowed: false,
});
const fixed = (runId, sub) => BASE + '/actions/runs/' + runId + '/' + sub;
const headers = token => ({
  Authorization: 'Bearer ' + token,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'stephanos-mailbox-free-readonly-evidence-v1',
});

async function limitedBody(response, maximum) {
  const length = response?.headers?.get?.('content-length');
  if (length && (!/^[0-9]{1,10}$/.test(length) || Number(length) > maximum)) throw Error('TOO_LARGE');
  if (!response?.body || typeof response.body.getReader !== 'function') throw Error('BODY_MISSING');
  const reader = response.body.getReader();
  const chunks = [];
  let count = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw Error('INVALID_BODY_CHUNK');
      count += value.byteLength;
      if (count > maximum) throw Error('TOO_LARGE');
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, count);
  } finally {
    await reader.cancel().catch(() => {});
  }
}

// Fetch only fixed GitHub REST endpoints under the canonical repository.
// Never forward the bearer token to a redirected or task-selected URL.
async function jsonGET(fetchImpl, path, token) {
  const url = path === '/git/ref/heads/main' ? BASE + path
    : /^\/actions\/runs\/[1-9][0-9]*$/.test(path)
      || /^\/actions\/runs\/[1-9][0-9]*\/(?:jobs|artifacts)\?per_page=100$/.test(path)
      || /^\/issues\/[1-9][0-9]{0,6}$/.test(path)
      ? BASE + path : null;
  if (!url) throw Error('NONCANONICAL_GET');
  const response = await fetchImpl(url, {
    method: 'GET',
    redirect: 'error',
    headers: headers(token),
    signal: AbortSignal.timeout(10000),
  });
  if (!response?.ok || response.status !== 200) throw Error('GITHUB_GET_FAILED');
  const bytes = await limitedBody(response, MAX_JSON);
  const data = JSON.parse(bytes.toString('utf8'));
  if (!object(data)) throw Error('GITHUB_JSON_INVALID');
  return data;
}
function readMainSha(value) {
  return value?.ref === 'refs/heads/main' && SHA.test(value?.object?.sha)
    ? value.object.sha : '';
}
function exactRun(run, runId, main) {
  return object(run) && run.id === runId
    && run.repository?.full_name === REPO && run.repository?.id === REPO_ID
    && run.actor?.login === OWNER && run.actor?.id === OWNER_ID
    && run.triggering_actor?.login === OWNER
    && run.workflow_id === WORKFLOW_ID
    && run.path === '.github/workflows/stephanos-mailbox-free-readonly.yml'
    && run.head_branch === 'main' && run.head_sha === main
    && run.event === 'workflow_dispatch' && run.run_attempt === 1
    && run.status === 'completed' && run.conclusion === 'success';
}
function redirectAllowed(text) {
  try {
    const u = new URL(text);
    const h = u.hostname.toLowerCase();
    return u.protocol === 'https:' && u.port === '' && !u.username && !u.password
      && (h.endsWith('.actions.githubusercontent.com')
        || h.endsWith('.blob.core.windows.net'));
  } catch { return false; }
}
async function zipGET(fetchImpl, artifactId, token) {
  const response = await fetchImpl(BASE + '/actions/artifacts/' + artifactId + '/zip', {
    method: 'GET',
    redirect: 'manual',
    headers: headers(token),
    signal: AbortSignal.timeout(10000),
  });
  if (response?.status !== 302) throw Error('ARTIFACT_SIGNED_LINK_REQUIRED');
  const location = response.headers?.get?.('location') || '';
  if (!redirectAllowed(location)) throw Error('ARTIFACT_REDIRECT_UNTRUSTED');
  // The signed ZIP destination is supplied by the authenticated GitHub API,
  // never the task. No Authorization header or arbitrary redirects on this GET.
  const zipResponse = await fetchImpl(location, {
    method: 'GET',
    redirect: 'error',
    headers: { 'User-Agent': 'stephanos-mailbox-free-artifact-v1' },
    signal: AbortSignal.timeout(10000),
  });
  if (!zipResponse?.ok || zipResponse.status !== 200) throw Error('ARTIFACT_DOWNLOAD_FAILED');
  return limitedBody(zipResponse, MAX_ZIP);
}

/**
 * Run only from an ALREADY trusted host with a trusted, read-scoped GitHub
 * credential. Injected fetch in tests is not authentication evidence.
 * Recheck current protected main before/after all awaited IO. This function
 * NEVER makes a write request or converts discovery to execution authority.
 */
export async function readMailboxFreeGoalEvidenceFromGitHubV1({
  runId, token, fetchImpl = fetch, nowUtc = new Date().toISOString(),
} = {}) {
  if (!positive(runId)) return denied('RUN_ID_INVALID');
  if (typeof token !== 'string' || !token || token.length > 4096)
    return denied('TRUSTED_READ_CREDENTIAL_UNAVAILABLE');
  if (typeof fetchImpl !== 'function' || !Number.isFinite(Date.parse(nowUtc)))
    return denied('READER_ENVIRONMENT_INVALID');
  try {
    const first = readMainSha(await jsonGET(fetchImpl, '/git/ref/heads/main', token));
    if (!first) return denied('PROTECTED_MAIN_READBACK_INVALID');
    const run = await jsonGET(fetchImpl, '/actions/runs/' + runId, token);
    if (!exactRun(run, runId, first)) return denied('RUN_NOT_CURRENT_OWNER_MAIN');
    const jobs = await jsonGET(fetchImpl, '/actions/runs/' + runId + '/jobs?per_page=100', token);
    if (jobs.total_count !== 2 || !Array.isArray(jobs.jobs) || jobs.jobs.length !== 2)
      return denied('TERMINAL_JOB_ESTATE_INCOMPLETE');
    const list = await jsonGET(fetchImpl, '/actions/runs/' + runId + '/artifacts?per_page=100', token);
    if (list.total_count !== 1 || !Array.isArray(list.artifacts) || list.artifacts.length !== 1)
      return denied('ARTIFACT_ESTATE_INCOMPLETE');
    const artifact = list.artifacts[0];
    if (!positive(artifact?.id) || artifact.name !== 'stephanos-mailbox-free-readonly-' + runId
      || artifact.expired !== false || artifact.size_in_bytes > MAX_ZIP
      || artifact.workflow_run?.head_sha !== first
      || artifact.workflow_run?.id !== runId
      || artifact.workflow_run?.repository_id !== REPO_ID
      || artifact.workflow_run?.head_repository_id !== REPO_ID)
      return denied('ARTIFACT_IDENTITY_UNPROVEN');
    const archive = await zipGET(fetchImpl, artifact.id, token);
    const preview = decodeMailboxFreeGoalProofArchiveV1(archive);
    if (!preview || !positive(preview.goalNumber) || preview.goalNumber > 9999999)
      return denied('GOAL_PROOF_UNREADABLE');
    const goal = await jsonGET(fetchImpl, '/issues/' + preview.goalNumber, token);
    const last = readMainSha(await jsonGET(fetchImpl, '/git/ref/heads/main', token));
    if (last !== first) return denied('PROTECTED_MAIN_MOVED_DURING_READBACK');
    const classified = classifyMailboxFreeGoalDiscoveryV1({
      run, jobs, artifact, archive, mainHead: last, goal, nowUtc,
    });
    if (classified.disposition !== 'DISCOVERY_CANDIDATE_ONLY') return denied(classified.blocker || 'NOT_DISCOVERY');
    return Object.freeze({
      ...classified,
      schemaVersion: MAILBOX_FREE_GITHUB_READER_SCHEMA,
      provenance: 'FIXED_GITHUB_GET_AND_BOUNDED_ARTIFACT_ONLY',
      // A trusted bearer and GitHub REST read are not a native signed owner
      // claim. Even this successful end-to-end read never has mutation rights.
      independentlyAuthenticatedTransport: false,
      originalGoalAdmissionGranted: false, exclusiveClaimGranted: false,
      sourceMutationAllowed: false, nativePickupProven: false,
      executionAuthorized: false, protectedMergeAllowed: false,
    });
  } catch {
    return denied('AUTHENTICATED_READ_OR_ARTIFACT_FAILED');
  }
}
