import {
  OPERATOR_ENVIRONMENT_APPROVAL_ENVIRONMENT,
  OPERATOR_ENVIRONMENT_APPROVAL_OPERATOR,
  OPERATOR_ENVIRONMENT_APPROVAL_REPOSITORY,
  OPERATOR_ENVIRONMENT_APPROVAL_STATE,
  executeOperatorEnvironmentApprovalV1,
} from './operatorEnvironmentApprovalAdapterV1.mjs';
import { BATTLE_BRIDGE_WINDOWS_HOST } from './battleBridgeWindowsHosts.mjs';

export const OPERATOR_ENVIRONMENT_APPROVAL_WORKFLOW = 'operator-merge-approval-gate.yml';
export const OPERATOR_ENVIRONMENT_APPROVAL_WORKFLOW_PATH = '.github/workflows/operator-merge-approval-gate.yml';
export const OPERATOR_ENVIRONMENT_APPROVAL_MAX_POLLS = 20;
export const OPERATOR_ENVIRONMENT_APPROVAL_POLL_MS = 1000;

const SHA40 = /^[a-f0-9]{40}$/;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/;
const INTEGER = /^[1-9][0-9]*$/;
const ACTIVE_RUN_STATES = new Set(['queued', 'in_progress', 'pending', 'waiting', 'requested']);

function fail(blocker, details = {}) {
  return Object.freeze({ ok: false, blocker, details: Object.freeze(details) });
}

function positiveInteger(value) {
  const raw = String(value ?? '').trim();
  if (!INTEGER.test(raw)) return 0;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function parseJson(output, blocker) {
  try { return JSON.parse(String(output || '')); }
  catch { throw new Error(blocker); }
}

function runOk(runCommand, executable, args, options, blocker) {
  const result = runCommand(executable, args, options);
  if (result?.error || result?.status !== 0) {
    throw new Error(`${blocker}:${result?.error?.message || result?.stderr || result?.status || 'unknown'}`);
  }
  return result;
}

function runJson(runCommand, repositoryRoot, endpoint, blocker) {
  return parseJson(runOk(
    runCommand,
    BATTLE_BRIDGE_WINDOWS_HOST.githubCli,
    ['api', endpoint],
    { cwd: repositoryRoot },
    blocker,
  ).stdout, `${blocker}_JSON_INVALID`);
}

function latestMatchingRun(payload, { headSha, baseSha }) {
  const runs = Array.isArray(payload?.workflow_runs) ? payload.workflow_runs : [];
  return runs.find((run) => (
    run?.path === OPERATOR_ENVIRONMENT_APPROVAL_WORKFLOW_PATH
    && run?.event === 'workflow_dispatch'
    && String(run?.head_sha || '').toLowerCase() === baseSha
    && String(run?.display_title || '') === `Protected operator merge ${headSha}`
  )) || null;
}

function normalizedPull(pull) {
  return Object.freeze({
    number: Number(pull?.number || 0),
    state: String(pull?.state || ''),
    merged: pull?.merged === true,
    branch: String(pull?.head?.ref || ''),
    headSha: String(pull?.head?.sha || '').toLowerCase(),
    baseRef: String(pull?.base?.ref || ''),
    baseSha: String(pull?.base?.sha || '').toLowerCase(),
  });
}

function normalizedRun(run) {
  return Object.freeze({
    id: Number(run?.id || 0),
    status: String(run?.status || '').toLowerCase(),
    conclusion: run?.conclusion ?? null,
    event: String(run?.event || ''),
    headSha: String(run?.head_sha || '').toLowerCase(),
    displayTitle: String(run?.display_title || ''),
  });
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function approveProtectedOperatorEnvironmentOnBattleBridgeV1(input = {}, options = {}) {
  const repositoryRoot = String(input.repositoryRoot || '').trim();
  const prNumber = positiveInteger(input.prNumber);
  const branch = String(input.branch || '').trim();
  const headSha = String(input.headSha || '').trim().toLowerCase();
  const baseSha = String(input.baseSha || '').trim().toLowerCase();
  const runCommand = options.runCommand;
  const sleep = options.sleep || defaultSleep;
  const maxPolls = Math.max(1, Math.min(
    OPERATOR_ENVIRONMENT_APPROVAL_MAX_POLLS,
    positiveInteger(options.maxPolls) || OPERATOR_ENVIRONMENT_APPROVAL_MAX_POLLS,
  ));
  const pollMs = Number.isFinite(Number(options.pollMs))
    ? Math.max(0, Math.min(5000, Number(options.pollMs)))
    : OPERATOR_ENVIRONMENT_APPROVAL_POLL_MS;

  if (!repositoryRoot) return fail('OPERATOR_ENVIRONMENT_APPROVAL_REPOSITORY_ROOT_REQUIRED');
  if (!prNumber) return fail('OPERATOR_ENVIRONMENT_APPROVAL_PR_NUMBER_INVALID');
  if (!BRANCH.test(branch) || branch.includes('..')) return fail('OPERATOR_ENVIRONMENT_APPROVAL_BRANCH_INVALID');
  if (!SHA40.test(headSha)) return fail('OPERATOR_ENVIRONMENT_APPROVAL_HEAD_INVALID');
  if (!SHA40.test(baseSha)) return fail('OPERATOR_ENVIRONMENT_APPROVAL_BASE_INVALID');
  if (typeof runCommand !== 'function') return fail('OPERATOR_ENVIRONMENT_APPROVAL_RUNNER_REQUIRED');
  if (typeof sleep !== 'function') return fail('OPERATOR_ENVIRONMENT_APPROVAL_SLEEP_INVALID');

  try {
    let workflowRun = null;
    for (let attempt = 0; attempt < maxPolls; attempt += 1) {
      const runs = runJson(
        runCommand,
        repositoryRoot,
        `repos/${OPERATOR_ENVIRONMENT_APPROVAL_REPOSITORY}/actions/workflows/${OPERATOR_ENVIRONMENT_APPROVAL_WORKFLOW}/runs?event=workflow_dispatch&per_page=20`,
        'OPERATOR_ENVIRONMENT_APPROVAL_RUN_LOOKUP_FAILED',
      );
      workflowRun = latestMatchingRun(runs, { headSha, baseSha });
      const status = String(workflowRun?.status || '').toLowerCase();
      if (status === 'waiting') break;
      if (workflowRun && !ACTIVE_RUN_STATES.has(status)) {
        return fail('OPERATOR_ENVIRONMENT_APPROVAL_NO_ACTIVE_RUN', {
          workflowRunId: Number(workflowRun?.id || 0),
          workflowRunStatus: status,
          workflowRunConclusion: String(workflowRun?.conclusion || ''),
        });
      }
      if (attempt + 1 < maxPolls) await sleep(pollMs);
    }

    if (!workflowRun) return fail('OPERATOR_ENVIRONMENT_APPROVAL_NO_ACTIVE_RUN');
    if (String(workflowRun.status || '').toLowerCase() !== 'waiting') {
      return fail('OPERATOR_ENVIRONMENT_APPROVAL_RUN_NOT_WAITING', {
        workflowRunId: Number(workflowRun?.id || 0),
        workflowRunStatus: String(workflowRun?.status || ''),
      });
    }

    const workflowRunId = positiveInteger(workflowRun.id);
    if (!workflowRunId) return fail('OPERATOR_ENVIRONMENT_APPROVAL_RUN_ID_INVALID');

    const actor = runJson(
      runCommand,
      repositoryRoot,
      'user',
      'OPERATOR_ENVIRONMENT_APPROVAL_ACTOR_LOOKUP_FAILED',
    );
    const pull = runJson(
      runCommand,
      repositoryRoot,
      `repos/${OPERATOR_ENVIRONMENT_APPROVAL_REPOSITORY}/pulls/${prNumber}`,
      'OPERATOR_ENVIRONMENT_APPROVAL_PR_LOOKUP_FAILED',
    );
    const main = runJson(
      runCommand,
      repositoryRoot,
      `repos/${OPERATOR_ENVIRONMENT_APPROVAL_REPOSITORY}/branches/main`,
      'OPERATOR_ENVIRONMENT_APPROVAL_MAIN_LOOKUP_FAILED',
    );
    const freshRun = runJson(
      runCommand,
      repositoryRoot,
      `repos/${OPERATOR_ENVIRONMENT_APPROVAL_REPOSITORY}/actions/runs/${workflowRunId}`,
      'OPERATOR_ENVIRONMENT_APPROVAL_RUN_REFRESH_FAILED',
    );
    const pendingDeployments = runJson(
      runCommand,
      repositoryRoot,
      `repos/${OPERATOR_ENVIRONMENT_APPROVAL_REPOSITORY}/actions/runs/${workflowRunId}/pending_deployments`,
      'OPERATOR_ENVIRONMENT_APPROVAL_PENDING_LOOKUP_FAILED',
    );

    const approval = await executeOperatorEnvironmentApprovalV1({
      authorization: {
        repository: OPERATOR_ENVIRONMENT_APPROVAL_REPOSITORY,
        prNumber,
        branch,
        headSha,
        baseSha,
        workflowRunId,
        environmentName: OPERATOR_ENVIRONMENT_APPROVAL_ENVIRONMENT,
        operator: OPERATOR_ENVIRONMENT_APPROVAL_OPERATOR,
        decision: OPERATOR_ENVIRONMENT_APPROVAL_STATE,
      },
      observed: {
        authenticatedActor: String(actor?.login || ''),
        currentMainSha: String(main?.commit?.sha || '').toLowerCase(),
        pullRequest: normalizedPull(pull),
        workflowRun: normalizedRun(freshRun),
        pendingDeployments,
      },
      request: async (request) => {
        const environmentIds = Array.isArray(request?.body?.environment_ids)
          ? request.body.environment_ids
          : [];
        if (request?.method !== 'POST'
          || environmentIds.length !== 1
          || !positiveInteger(environmentIds[0])
          || request?.body?.state !== OPERATOR_ENVIRONMENT_APPROVAL_STATE) {
          throw new Error('OPERATOR_ENVIRONMENT_APPROVAL_REQUEST_NOT_BOUNDED');
        }
        const endpoint = String(request.path || '').replace(/^\/+/, '');
        runOk(runCommand, BATTLE_BRIDGE_WINDOWS_HOST.githubCli, [
          'api', endpoint,
          '--method', 'POST',
          '-H', 'Accept: application/vnd.github+json',
          '-H', 'X-GitHub-Api-Version: 2022-11-28',
          '-F', `environment_ids[]=${environmentIds[0]}`,
          '-f', `state=${request.body.state}`,
          '-f', `comment=${String(request.body.comment || '')}`,
        ], { cwd: repositoryRoot }, 'OPERATOR_ENVIRONMENT_APPROVAL_POST_FAILED');
        return Object.freeze({ status: 204 });
      },
    });

    if (!approval.valid || approval.finalVerdict !== 'OPERATOR_ENVIRONMENT_APPROVAL_ACCEPTED') {
      return fail('OPERATOR_ENVIRONMENT_APPROVAL_BLOCKED', {
        workflowRunId,
        blockers: Array.isArray(approval.blockers) ? approval.blockers : [],
        finalVerdict: String(approval.finalVerdict || ''),
      });
    }

    return Object.freeze({
      ok: true,
      finalVerdict: 'PROTECTED_OPERATOR_ENVIRONMENT_APPROVED',
      repository: OPERATOR_ENVIRONMENT_APPROVAL_REPOSITORY,
      prNumber,
      branch,
      expectedHead: headSha,
      expectedBase: baseSha,
      workflowRunId,
      environmentId: Number(approval.receiptBinding?.environmentId || 0),
      authenticatedActor: String(approval.receiptBinding?.authenticatedActor || ''),
      environmentName: OPERATOR_ENVIRONMENT_APPROVAL_ENVIRONMENT,
      responseStatus: Number(approval.responseStatus || 0),
      mutationAuthorityConsumed: true,
      mergeAuthorityGranted: false,
      directMergePerformed: false,
      directMainWriteAllowed: false,
      adminBypassAllowed: false,
      arbitraryGitHubRequestAllowed: false,
    });
  } catch (error) {
    return fail('OPERATOR_ENVIRONMENT_APPROVAL_EXECUTION_FAILED', {
      error: error?.message || String(error),
    });
  }
}
