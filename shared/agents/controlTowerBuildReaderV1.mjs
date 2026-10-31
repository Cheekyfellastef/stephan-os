import { createHash } from 'node:crypto';
import { decodeBoundedSingleJsonArchiveV1 } from './mailboxFreeGoalNominationV1.mjs';
import { readMailboxFreeGitHubJsonV1, readMailboxFreeGitHubArchiveV1 } from './mailboxFreeGitHubEvidenceReaderV1.mjs';
import { CONTROL_TOWER_BUILD_KEYS, CONTROL_TOWER_BUILD_FILE, CONTROL_TOWER_BUILD_WORKFLOW,
  CONTROL_TOWER_OBSERVE_OPERATION, validateControlTowerBuildRequestV1 } from './controlTowerBuildRequestV1.mjs';

const authenticated = new WeakSet();
export const isAuthenticatedControlTowerBuildRequestV1 = request => authenticated.has(request);
const held = blocker => Object.freeze({ ok: false, blocker, request: null });
const SHA = /^[a-f0-9]{40}$/;
const positive = n => Number.isSafeInteger(n) && n > 0;
const main = value => value?.ref === 'refs/heads/main' && SHA.test(value?.object?.sha) ? value.object.sha : '';
const workflow = '/actions/workflows/stephanos-control-tower-build.yml';

// There is no caller-selected endpoint, executable, free-form operation or goal grant.
// Only this authenticated acquisition path can mint a live request object.
export async function readControlTowerBuildRequestV1({
  token, now = () => new Date().toISOString(), fetchImpl = globalThis.fetch, isRecorded = () => false,
  observationOnly = false,
} = {}) {
  if (typeof token !== 'string' || !token || token.length > 4096) return held('CONTROL_TOWER_READ_CREDENTIAL_UNAVAILABLE');
  if (typeof observationOnly !== 'boolean') return held('CONTROL_TOWER_REQUEST_OPERATION_FILTER_INVALID');
  try {
    const deadline = AbortSignal.timeout(15000);
    const get = path => readMailboxFreeGitHubJsonV1(fetchImpl, path, token, deadline);
    const first = main(await get('/git/ref/heads/main'));
    if (!first) return held('CONTROL_TOWER_MAIN_UNPROVEN');
    const definition = await get(workflow);
    if (!positive(definition?.id) || definition.path !== CONTROL_TOWER_BUILD_WORKFLOW || definition.state !== 'active')
      return held('CONTROL_TOWER_BUILD_WORKFLOW_UNAVAILABLE');
    // One bounded current-head inventory covers BOTH authenticated manual
    // requests and owner-protected-main pushes. Other event classes cannot
    // qualify as an owner build wake; pagination overflow fails closed.
    const list = await get(workflow + '/runs?per_page=10&head_sha=' + first);
    if (!Array.isArray(list.workflow_runs) || list.workflow_runs.length > 10
      || !Number.isSafeInteger(list.total_count) || list.total_count < list.workflow_runs.length)
      return held('CONTROL_TOWER_RUN_INVENTORY_INVALID');
    if (typeof isRecorded !== 'function') return held('CONTROL_TOWER_REQUEST_HISTORY_INVALID');
    const cutoff = Date.parse(now()) - 600000;
    if (!Number.isFinite(cutoff)) return held('CONTROL_TOWER_BUILD_CLOCK_INVALID');
    if (list.total_count > 10 && list.workflow_runs.length === 10
      && Date.parse(list.workflow_runs[9]?.created_at) >= cutoff)
      return held('CONTROL_TOWER_BUILD_ACTIVE_WINDOW_OVERFLOW');
    const candidates = [...list.workflow_runs].reverse().filter(r =>
      positive(r.id) && r.head_sha === first && Date.parse(r.created_at) >= cutoff && !isRecorded(r.id)
      && ['workflow_dispatch', 'push'].includes(r.event)
      && r.status === 'completed' && r.conclusion === 'success');
    if (!candidates.length) return held('NO_CONTROL_TOWER_BUILD_REQUEST');
    // When the ORIGINAL ledger retains an unresolved build, a new build must
    // not starve a later read-only inspection. Inspect at most the existing
    // ten-run bound under the same deadline. Skip only AFTER full artifact
    // authentication; skipped runs remain unseen, unreserved and unexecuted.
    for (const candidate of candidates) {
      const run = await get('/actions/runs/' + candidate.id);
      if (run.id !== candidate.id || run.workflow_id !== definition.id || run.path !== definition.path
        || run.head_sha !== first || run.status !== 'completed' || run.conclusion !== 'success')
        return held('LATEST_CONTROL_TOWER_BUILD_REQUEST_NOT_READY');
      const jobs = await get('/actions/runs/' + run.id + '/jobs?per_page=100');
      if (jobs.total_count !== 2 || !Array.isArray(jobs.jobs) || jobs.jobs.length !== 2
        || !jobs.jobs.every(j => j.run_id === run.id && j.status === 'completed')
        || jobs.jobs.filter(j => j.name === 'request-build' && j.conclusion === 'success').length !== 1
        || jobs.jobs.filter(j => j.name === 'contract-test' && j.conclusion === 'skipped').length !== 1)
        return held('CONTROL_TOWER_BUILD_JOB_ESTATE_INVALID');
      const estate = await get('/actions/runs/' + run.id + '/artifacts?per_page=100');
      const artifact = estate.artifacts?.[0];
      if (estate.total_count !== 1 || !Array.isArray(estate.artifacts) || estate.artifacts.length !== 1
        || !positive(artifact?.id) || artifact.name !== 'stephanos-control-tower-build-' + run.id
        || artifact.expired !== false || !Number.isSafeInteger(artifact.size_in_bytes)
        || artifact.size_in_bytes < 22 || artifact.size_in_bytes > 65536
        || artifact.workflow_run?.id !== run.id || artifact.workflow_run?.repository_id !== 1179385578
        || artifact.workflow_run?.head_repository_id !== 1179385578
        || artifact.workflow_run?.head_sha !== first || artifact.workflow_run?.head_branch !== 'main')
        return held('CONTROL_TOWER_BUILD_ARTIFACT_INVALID');
      const archive = await readMailboxFreeGitHubArchiveV1(fetchImpl, artifact.id, token, deadline);
      const digest = createHash('sha256').update(archive).digest('hex');
      if (archive.length !== artifact.size_in_bytes || artifact.digest !== 'sha256:' + digest)
        return held('CONTROL_TOWER_BUILD_ARTIFACT_DIGEST_INVALID');
      const request = decodeBoundedSingleJsonArchiveV1(archive, CONTROL_TOWER_BUILD_FILE, CONTROL_TOWER_BUILD_KEYS);
      const last = main(await get('/git/ref/heads/main'));
      if (last !== first) return held('CONTROL_TOWER_MAIN_MOVED');
      const validation = validateControlTowerBuildRequestV1(request, run, last, now());
      if (!validation.ok) return held(validation.blocker);
      if (observationOnly && request.operation !== CONTROL_TOWER_OBSERVE_OPERATION) continue;
      const bound = Object.freeze({ ...request, artifactId: artifact.id, artifactSha256: digest,
        proofRef: 'https://github.com/Cheekyfellastef/stephan-os/actions/runs/' + run.id });
      authenticated.add(bound);
      return Object.freeze({ ok: true, blocker: '', request: bound });
    }
    return held('NO_CONTROL_TOWER_BUILD_REQUEST');
  } catch { return held('CONTROL_TOWER_AUTHENTICATED_BUILD_READ_FAILED'); }
}
