// Original Goal #2315: a bounded, GET-only host-side GitHub evidence reader.
// This is an adapter candidate, not a registered host service, builder, or grant.
// A qualified host supplies its own token and bounded artifact downloader.
import { classifyMailboxFreeGoalDiscoveryV1, decodeMailboxFreeGoalProofArchiveV1 } from './mailboxFreeGoalDiscoveryV1.mjs';

export const MAILBOX_FREE_GOAL_READBACK_SCHEMA = 'stephanos.mailbox-free-goal-readback.v1';
const REPO = 'Cheekyfellastef/stephan-os';
const ROOT = 'https://api.github.com/repos/' + REPO;
const WORKFLOW = 'Stephanos Control Tower - Mailbox-Free Read-Only Pilot';
const WORKFLOW_PATH = '.github/workflows/stephanos-mailbox-free-readonly.yml';
const SHA = /^[0-9a-f]{40}$/;
const MAX_JSON_BYTES = 256 * 1024;
const MAX_ARCHIVE_BYTES = 64 * 1024;
const blocked = blocker => Object.freeze({
  schemaVersion: MAILBOX_FREE_GOAL_READBACK_SCHEMA,
  disposition: 'HELD', blocker,
  independentlyAuthenticatedTransport: false, originalGoalAdmissionGranted: false,
  exclusiveClaimGranted: false, sourceMutationAllowed: false,
  nativePickupProven: false, executionAuthorized: false, protectedMergeAllowed: false,
});
const positive = n => Number.isSafeInteger(n) && n > 0;
const runIdValid = n => positive(n) && /^[1-9][0-9]{0,15}$/.test(String(n));
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const requireApi = (good, code) => { if (!good) throw Object.assign(new Error(code), {code}); };
const exactMain = ref => ref?.ref === 'refs/heads/main' && SHA.test(ref?.object?.sha || '')
  ? ref.object.sha : '';

/** One immutable trusted-host call; no task-selectable URL, POST or retry. */
export function createMailboxFreeGoalReadbackV1({
  token, fetchImpl = fetch, downloadArtifact, now = () => new Date().toISOString(),
} = {}) {
  if (typeof token !== 'string' || token.trim().length < 1 || token.length > 4096
    || typeof fetchImpl !== 'function' || typeof now !== 'function') {
    return async () => blocked('TRUSTED_GITHUB_READER_NOT_CONFIGURED');
  }
  if (typeof downloadArtifact !== 'function') {
    return async () => blocked('TRUSTED_ARTIFACT_DOWNLOADER_NOT_CONFIGURED');
  }
  const auth = 'Bearer ' + token;
  async function readJson(path) {
    const response = await fetchImpl(ROOT + path, {
      method: 'GET', redirect: 'error',
      headers: {
        Accept: 'application/vnd.github+json', Authorization: auth,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'stephanos-mailbox-free-goal-readback-v1',
      },
      signal: AbortSignal.timeout(10000),
    });
    requireApi(response?.ok === true && response.redirected !== true
      && typeof response.body?.getReader === 'function', 'GITHUB_FIXED_GET_UNAVAILABLE');
    const reader = response.body.getReader(), parts = [];
    let bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        requireApi(chunk.value instanceof Uint8Array, 'GITHUB_RESPONSE_MALFORMED');
        bytes += chunk.value.byteLength;
        requireApi(bytes > 0 && bytes <= MAX_JSON_BYTES, 'GITHUB_RESPONSE_UNBOUNDED');
        parts.push(Buffer.from(chunk.value));
      }
    } finally {
      reader.releaseLock();
    }
    requireApi(bytes > 0, 'GITHUB_RESPONSE_EMPTY');
    const value = JSON.parse(Buffer.concat(parts, bytes).toString('utf8'));
    requireApi(plain(value), 'GITHUB_RESPONSE_MALFORMED');
    return value;
  }
  return async function readExistingGoalObservation({ runId, expectedGoalNumber } = {}) {
    if (!runIdValid(runId) || !positive(expectedGoalNumber)
      || expectedGoalNumber > 9999999) return blocked('BOUNDED_GOAL_OR_RUN_REQUIRED');
    try {
      // A complete original read spans exactly two current-main observations.
      const before = exactMain(await readJson('/git/ref/heads/main'));
      requireApi(!!before, 'CURRENT_PROTECTED_MAIN_UNPROVEN');
      const run = await readJson('/actions/runs/' + runId);
      // Check the original workflow and authenticated actor before any archive
      // download, but independently recheck these in the Stage 2 classifier.
      requireApi(run.id === runId && run.workflow_id === 398609082
        && run.name === WORKFLOW && run.path === WORKFLOW_PATH
        && run.event === 'workflow_dispatch' && run.run_attempt === 1
        && run.status === 'completed' && run.conclusion === 'success'
        && run.head_branch === 'main' && run.head_sha === before
        && run.actor?.login === 'Cheekyfellastef' && run.actor?.id === 267490109
        && run.repository?.full_name === REPO && run.repository?.id === 1179385578,
      'ORIGINAL_OPERATOR_RUN_NOT_CURRENT');
      const jobs = await readJson('/actions/runs/' + runId + '/jobs?per_page=100');
      requireApi(jobs.total_count === 2 && Array.isArray(jobs.jobs)
        && jobs.jobs.length === 2, 'BOUNDED_RUN_JOBS_UNPROVEN');
      const inventory = await readJson('/actions/runs/' + runId + '/artifacts?per_page=100');
      requireApi(inventory.total_count === 1 && Array.isArray(inventory.artifacts)
        && inventory.artifacts.length === 1, 'BOUNDED_ARTIFACT_INVENTORY_UNPROVEN');
      const artifact = inventory.artifacts[0];
      requireApi(positive(artifact?.id)
        && artifact.name === 'stephanos-mailbox-free-readonly-' + runId
        && artifact.workflow_run?.id === runId
        && artifact.workflow_run?.head_sha === before
        && artifact.expired === false
        && Number.isSafeInteger(artifact.size_in_bytes)
        && artifact.size_in_bytes >= 22 && artifact.size_in_bytes <= MAX_ARCHIVE_BYTES
        && /^sha256:[a-f0-9]{64}$/.test(artifact.digest || ''),
      'BOUNDED_ARTIFACT_IDENTITY_UNPROVEN');
      // Host-owned downloader MUST independently authenticate GitHub's one
      // specified artifact endpoint and safely handle its bounded ZIP redirect.
      // No bearer token, untrusted URL, code or task authority is passed to it.
      const archive = await downloadArtifact(Object.freeze({
        repository: REPO, artifactId: artifact.id, maxBytes: MAX_ARCHIVE_BYTES,
      }));
      requireApi(Buffer.isBuffer(archive) && archive.length === artifact.size_in_bytes,
        'TRUSTED_ARTIFACT_BYTES_UNAVAILABLE');
      const proof = decodeMailboxFreeGoalProofArchiveV1(archive);
      requireApi(proof?.goalNumber === expectedGoalNumber
        && proof?.runId === runId, 'EXPECTED_ORIGINAL_GOAL_MISMATCH');
      const goal = await readJson('/issues/' + expectedGoalNumber);
      const after = exactMain(await readJson('/git/ref/heads/main'));
      requireApi(before === after, 'MAIN_MOVED_DURING_READBACK');
      const result = classifyMailboxFreeGoalDiscoveryV1({
        run, jobs, artifact, archive, mainHead: after, goal, nowUtc: now(),
      });
      // The source adapter is NOT installed/attested as a trusted host reader.
      // Even a valid prior run cannot make its reader/worker authenticated.
      return result;
    } catch (error) {
      const known = new Set([
        'GITHUB_FIXED_GET_UNAVAILABLE', 'GITHUB_RESPONSE_MALFORMED',
        'GITHUB_RESPONSE_UNBOUNDED', 'GITHUB_RESPONSE_EMPTY',
        'CURRENT_PROTECTED_MAIN_UNPROVEN', 'ORIGINAL_OPERATOR_RUN_NOT_CURRENT',
        'BOUNDED_RUN_JOBS_UNPROVEN', 'BOUNDED_ARTIFACT_INVENTORY_UNPROVEN',
        'BOUNDED_ARTIFACT_IDENTITY_UNPROVEN', 'TRUSTED_ARTIFACT_BYTES_UNAVAILABLE',
        'EXPECTED_ORIGINAL_GOAL_MISMATCH', 'MAIN_MOVED_DURING_READBACK',
      ]);
      return blocked(known.has(error?.code) ? error.code : 'GITHUB_READBACK_OUTCOME_UNKNOWN');
    }
  };
}
