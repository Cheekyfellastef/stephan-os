import { spawnSync } from 'node:child_process';

import {
  OPERATOR_ENVIRONMENT_APPROVAL_ENVIRONMENT,
  OPERATOR_ENVIRONMENT_APPROVAL_OPERATOR,
  OPERATOR_ENVIRONMENT_APPROVAL_REPOSITORY,
  OPERATOR_ENVIRONMENT_APPROVAL_STATE,
  executeOperatorEnvironmentApprovalV1,
} from './operatorEnvironmentApprovalAdapterV1.mjs';

export const OPERATOR_ENVIRONMENT_APPROVAL_BATTLE_BRIDGE_OPERATION = 'APPROVE_PROTECTED_MERGE_ENVIRONMENT';

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const BRANCH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/;
const PR_NUMBER_PATTERN = /^[1-9][0-9]{0,9}$/;
const WORKFLOW_RUN_ID_PATTERN = /^[1-9][0-9]{0,19}$/;
const COMMAND_ALLOWED_FIELDS = new Set([
  'schemaVersion',
  'requestId',
  'operation',
  'repository',
  'issueNumber',
  'branch',
  'operatorApproval',
  'expectedHead',
  'prNumber',
  'expectedPullRequestBranch',
  'expectedPullRequestHead',
  'workflowRunId',
  'expiresAt',
]);
const SPECIAL_FIELDS = Object.freeze([
  'prNumber',
  'expectedPullRequestBranch',
  'expectedPullRequestHead',
  'workflowRunId',
]);
const GH_TIMEOUT_MS = 30_000;
const FIXED_GH_EXECUTABLE = 'gh.exe';

function fail(blocker, details = {}) {
  return Object.freeze({ ok: false, verdict: 'BLOCKED', blocker, ...details });
}

function text(value) {
  return String(value ?? '').trim();
}

function positiveInteger(value, pattern) {
  const raw = text(value);
  if (!pattern.test(raw)) return 0;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

export function operatorEnvironmentApprovalBattleBridgeFields() {
  return SPECIAL_FIELDS;
}

export function validateOperatorEnvironmentApprovalBattleBridgeCommandShape(command = {}) {
  if (text(command?.operation) !== OPERATOR_ENVIRONMENT_APPROVAL_BATTLE_BRIDGE_OPERATION) {
    return Object.freeze({ ok: true, requested: false });
  }

  const unexpectedField = Object.keys(command).find((field) => !COMMAND_ALLOWED_FIELDS.has(field));
  if (unexpectedField) {
    return fail('OPERATOR_ENVIRONMENT_APPROVAL_FIELD_NOT_ALLOWED', {
      requested: true,
      field: unexpectedField,
    });
  }

  const expectedHead = text(command?.expectedHead).toLowerCase();
  if (!SHA_PATTERN.test(expectedHead)) {
    return fail('OPERATOR_ENVIRONMENT_APPROVAL_EXPECTED_MAIN_HEAD_REQUIRED', { requested: true });
  }

  const prNumber = positiveInteger(command?.prNumber, PR_NUMBER_PATTERN);
  if (!prNumber) {
    return fail('OPERATOR_ENVIRONMENT_APPROVAL_PR_NUMBER_INVALID', { requested: true });
  }

  const expectedPullRequestBranch = text(command?.expectedPullRequestBranch);
  if (!BRANCH_PATTERN.test(expectedPullRequestBranch) || expectedPullRequestBranch.includes('..')) {
    return fail('OPERATOR_ENVIRONMENT_APPROVAL_PR_BRANCH_INVALID', { requested: true });
  }

  const expectedPullRequestHead = text(command?.expectedPullRequestHead).toLowerCase();
  if (!SHA_PATTERN.test(expectedPullRequestHead)) {
    return fail('OPERATOR_ENVIRONMENT_APPROVAL_PR_HEAD_REQUIRED', { requested: true });
  }

  const workflowRunId = positiveInteger(command?.workflowRunId, WORKFLOW_RUN_ID_PATTERN);
  if (!workflowRunId) {
    return fail('OPERATOR_ENVIRONMENT_APPROVAL_WORKFLOW_RUN_ID_INVALID', { requested: true });
  }

  return Object.freeze({
    ok: true,
    requested: true,
    expectedHead,
    command: Object.freeze({
      ...command,
      expectedHead,
      prNumber,
      expectedPullRequestBranch,
      expectedPullRequestHead,
      workflowRunId,
    }),
  });
}

export function isTerminalizableOperatorEnvironmentApprovalBlocker(value) {
  return new Set([
    'OPERATOR_ENVIRONMENT_APPROVAL_FIELD_NOT_ALLOWED',
    'OPERATOR_ENVIRONMENT_APPROVAL_EXPECTED_MAIN_HEAD_REQUIRED',
    'OPERATOR_ENVIRONMENT_APPROVAL_PR_NUMBER_INVALID',
    'OPERATOR_ENVIRONMENT_APPROVAL_PR_BRANCH_INVALID',
    'OPERATOR_ENVIRONMENT_APPROVAL_PR_HEAD_REQUIRED',
    'OPERATOR_ENVIRONMENT_APPROVAL_WORKFLOW_RUN_ID_INVALID',
  ]).has(text(value));
}

function runGh(spawnSyncFn, args, { input = undefined } = {}) {
  const result = spawnSyncFn(FIXED_GH_EXECUTABLE, args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: GH_TIMEOUT_MS,
    ...(input === undefined ? {} : { input }),
  });
  if (result?.error || Number(result?.status) !== 0) {
    return Object.freeze({ ok: false, stdout: '' });
  }
  return Object.freeze({ ok: true, stdout: String(result?.stdout || '') });
}

function readText(spawnSyncFn, endpoint, jq) {
  const result = runGh(spawnSyncFn, ['api', endpoint, '--jq', jq]);
  return result.ok ? text(result.stdout) : '';
}

function readJson(spawnSyncFn, endpoint) {
  const result = runGh(spawnSyncFn, ['api', endpoint]);
  if (!result.ok) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

function postAdapterRequest(spawnSyncFn, request) {
  const path = text(request?.path).replace(/^\//, '');
  const expectedPrefix = `repos/${OPERATOR_ENVIRONMENT_APPROVAL_REPOSITORY}/actions/runs/`;
  if (!path.startsWith(expectedPrefix) || !path.endsWith('/pending_deployments')) {
    return Object.freeze({ status: 0 });
  }
  if (text(request?.method).toUpperCase() !== 'POST') {
    return Object.freeze({ status: 0 });
  }

  const result = runGh(
    spawnSyncFn,
    ['api', path, '--method', 'POST', '--include', '--input', '-'],
    { input: JSON.stringify(request.body) },
  );
  if (!result.ok) return Object.freeze({ status: 0 });

  const match = result.stdout.match(/HTTP\/(?:1\.1|2(?:\.0)?)\s+(\d{3})/i);
  return Object.freeze({ status: match ? Number(match[1]) : 0 });
}

export async function executeOperatorEnvironmentApprovalOnBattleBridge(command = {}, options = {}) {
  const shape = validateOperatorEnvironmentApprovalBattleBridgeCommandShape(command);
  if (!shape.ok || !shape.requested) return shape;

  const spawnSyncFn = typeof options?.spawnSyncFn === 'function' ? options.spawnSyncFn : spawnSync;
  const normalized = shape.command;
  const repository = OPERATOR_ENVIRONMENT_APPROVAL_REPOSITORY;

  const authenticatedActor = readText(spawnSyncFn, 'user', '.login');
  if (!authenticatedActor) return fail('OPERATOR_ENVIRONMENT_APPROVAL_GITHUB_IDENTITY_UNAVAILABLE');

  const currentMainSha = readText(
    spawnSyncFn,
    `repos/${repository}/git/ref/heads/main`,
    '.object.sha',
  ).toLowerCase();
  if (!SHA_PATTERN.test(currentMainSha)) {
    return fail('OPERATOR_ENVIRONMENT_APPROVAL_MAIN_IDENTITY_UNAVAILABLE');
  }

  const pullRequest = readJson(spawnSyncFn, `repos/${repository}/pulls/${normalized.prNumber}`);
  if (!pullRequest) return fail('OPERATOR_ENVIRONMENT_APPROVAL_PR_IDENTITY_UNAVAILABLE');

  const workflowRun = readJson(spawnSyncFn, `repos/${repository}/actions/runs/${normalized.workflowRunId}`);
  if (!workflowRun) return fail('OPERATOR_ENVIRONMENT_APPROVAL_WORKFLOW_IDENTITY_UNAVAILABLE');

  const pendingDeployments = readJson(
    spawnSyncFn,
    `repos/${repository}/actions/runs/${normalized.workflowRunId}/pending_deployments`,
  );
  if (!Array.isArray(pendingDeployments)) {
    return fail('OPERATOR_ENVIRONMENT_APPROVAL_PENDING_DEPLOYMENTS_UNAVAILABLE');
  }

  const result = await executeOperatorEnvironmentApprovalV1({
    authorization: {
      repository,
      prNumber: normalized.prNumber,
      branch: normalized.expectedPullRequestBranch,
      headSha: normalized.expectedPullRequestHead,
      baseSha: normalized.expectedHead,
      workflowRunId: normalized.workflowRunId,
      environmentName: OPERATOR_ENVIRONMENT_APPROVAL_ENVIRONMENT,
      operator: OPERATOR_ENVIRONMENT_APPROVAL_OPERATOR,
      decision: OPERATOR_ENVIRONMENT_APPROVAL_STATE,
    },
    observed: {
      authenticatedActor,
      currentMainSha,
      pullRequest: {
        number: pullRequest.number,
        state: pullRequest.state,
        merged: pullRequest.merged,
        branch: pullRequest?.head?.ref,
        headSha: pullRequest?.head?.sha,
        baseRef: pullRequest?.base?.ref,
        baseSha: pullRequest?.base?.sha,
      },
      workflowRun: {
        id: workflowRun.id,
        status: workflowRun.status,
        conclusion: workflowRun.conclusion,
        event: workflowRun.event,
        headSha: workflowRun.head_sha,
        displayTitle: workflowRun.display_title,
      },
      pendingDeployments,
    },
    request: async (request) => postAdapterRequest(spawnSyncFn, request),
  });

  if (result?.finalVerdict !== 'OPERATOR_ENVIRONMENT_APPROVAL_ACCEPTED') {
    return fail(
      result?.blockers?.[0] || 'OPERATOR_ENVIRONMENT_APPROVAL_EXECUTION_FAILED',
      {
        operation: OPERATOR_ENVIRONMENT_APPROVAL_BATTLE_BRIDGE_OPERATION,
        requestId: text(normalized.requestId),
        responseStatus: Number(result?.responseStatus || 0),
      },
    );
  }

  return Object.freeze({
    ok: true,
    verdict: 'COMMAND_EXECUTION_COMPLETE',
    operation: OPERATOR_ENVIRONMENT_APPROVAL_BATTLE_BRIDGE_OPERATION,
    requestId: text(normalized.requestId),
    responseStatus: 204,
    receiptBinding: result.receiptBinding,
    arbitraryGitHubMutationAllowed: false,
    mergeAuthority: false,
  });
}
