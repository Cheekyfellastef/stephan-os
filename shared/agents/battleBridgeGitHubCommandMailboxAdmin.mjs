import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateOperatorMergeHeadStatusReadback } from './operatorMergeHeadStatusV1.mjs';

export const OPERATOR_MERGE_PROTECTION_OPERATION = 'ACTIVATE_OPERATOR_MERGE_PROTECTION';
export const OPERATOR_MERGE_PROTECTION_REPOSITORY = 'Cheekyfellastef/stephan-os';
export const OPERATOR_MERGE_PROTECTION_OWNER = 'Cheekyfellastef';
export const OPERATOR_MERGE_PROTECTION_REPO = 'stephan-os';
export const OPERATOR_MERGE_PROTECTION_BRANCH = 'main';
export const OPERATOR_MERGE_PROTECTION_ENVIRONMENT = 'operator-merge-approval';
export const OPERATOR_MERGE_PROTECTION_REVIEWER = 'Cheekyfellastef';
export const OPERATOR_MERGE_PROTECTION_BOOTSTRAP_PR = 1580;
export const OPERATOR_MERGE_PROTECTION_BOOTSTRAP_MERGE = 'e606ff30d3dc2e796357a3240604b412cb672a00';
export const OPERATOR_MERGE_PROTECTION_RECEIPT_ISSUE = 1568;
export const OPERATOR_MERGE_PROTECTION_WORKFLOW = 'operator-merge-approval-gate.yml';
export const OPERATOR_MERGE_PROTECTION_REQUIRED_CHECK = 'operator-approval-gate';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const expectedRepoRoot = resolve(process.env.USERPROFILE || homedir(), 'Documents', 'GitHub', 'stephan-os');
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_ERROR_CHARS = 1200;
const POLL_ATTEMPTS = 24;
const POLL_DELAY_MS = 5000;

function freeze(value) {
  return Object.freeze(value);
}

function fail(blocker, details = {}) {
  return freeze({ ok: false, finalVerdict: 'OPERATOR_MERGE_PROTECTION_BLOCKED', blocker, ...details });
}

function safeText(value, limit = MAX_ERROR_CHARS) {
  return String(value || '')
    .replace(/github_pat_[A-Za-z0-9_]+/g, '[redacted]')
    .replace(/gh[pousr]_[A-Za-z0-9]+/g, '[redacted]')
    .slice(0, limit);
}

function httpStatus(stderr = '') {
  const match = String(stderr).match(/HTTP\s+(\d{3})/i);
  return match ? Number(match[1]) : 0;
}

function parseJson(stdout = '') {
  const text = String(stdout || '');
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
    throw new Error('GITHUB_ADMIN_RESPONSE_TOO_LARGE');
  }
  return text.trim() ? JSON.parse(text) : null;
}

export function createFixedGitHubApiRequester({ spawn = spawnSync } = {}) {
  return async function request({ method = 'GET', path, body } = {}) {
    const normalizedMethod = String(method || 'GET').toUpperCase();
    const normalizedPath = String(path || '');
    if (!/^(GET|POST|PUT|PATCH|DELETE)$/.test(normalizedMethod)) {
      return { ok: false, status: 0, blocker: 'GITHUB_ADMIN_METHOD_NOT_ALLOWED' };
    }
    if (!normalizedPath.startsWith(`repos/${OPERATOR_MERGE_PROTECTION_REPOSITORY}/`)
      && normalizedPath !== `users/${OPERATOR_MERGE_PROTECTION_REVIEWER}`) {
      return { ok: false, status: 0, blocker: 'GITHUB_ADMIN_PATH_NOT_ALLOWED' };
    }
    const args = [
      'api', '--method', normalizedMethod, normalizedPath,
      '--header', 'Accept: application/vnd.github+json',
      '--header', 'X-GitHub-Api-Version: 2022-11-28',
    ];
    const hasBody = body !== undefined;
    if (hasBody) args.push('--input', '-');
    const result = spawn('gh.exe', args, {
      cwd: repoRoot,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      timeout: 120000,
      maxBuffer: MAX_RESPONSE_BYTES,
      input: hasBody ? JSON.stringify(body) : undefined,
    });
    const status = result?.status === 0 ? 200 : httpStatus(result?.stderr);
    if (result?.error || result?.status !== 0) {
      return {
        ok: false,
        status,
        blocker: 'GITHUB_ADMIN_API_REQUEST_FAILED',
        error: safeText(result?.error?.message || result?.stderr),
      };
    }
    try {
      return { ok: true, status, data: parseJson(result?.stdout) };
    } catch (error) {
      return { ok: false, status, blocker: 'GITHUB_ADMIN_RESPONSE_INVALID', error: safeText(error?.message) };
    }
  };
}

function runFixed(executable, args, { spawn = spawnSync } = {}) {
  const result = spawn(executable, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 120000,
    maxBuffer: 256 * 1024,
  });
  return {
    ok: !result?.error && result?.status === 0,
    stdout: String(result?.stdout || '').trim(),
    error: safeText(result?.error?.message || result?.stderr),
  };
}

export function readOperatorMergeProtectionSourceIdentity(command = {}, { spawn = spawnSync, platform = process.platform } = {}) {
  if (platform !== 'win32') return fail('WINDOWS_REQUIRED');
  if (repoRoot.toLowerCase() !== expectedRepoRoot.toLowerCase()) {
    return fail('CANONICAL_CHECKOUT_REQUIRED', { repoRoot, expectedRepoRoot });
  }
  const head = runFixed('git.exe', ['rev-parse', 'HEAD'], { spawn });
  const branch = runFixed('git.exe', ['branch', '--show-current'], { spawn });
  const sourceHead = head.stdout.toLowerCase();
  if (!head.ok || !branch.ok || !SHA_PATTERN.test(sourceHead)) return fail('SOURCE_IDENTITY_READ_FAILED');
  if (branch.stdout !== OPERATOR_MERGE_PROTECTION_BRANCH) {
    return fail('SOURCE_BRANCH_NOT_MAIN', { sourceHead, branch: branch.stdout });
  }
  const expectedHead = String(command.expectedHead || '').toLowerCase();
  if (!SHA_PATTERN.test(expectedHead)) return fail('EXPECTED_HEAD_REQUIRED');
  if (sourceHead !== expectedHead) return fail('EXPECTED_HEAD_MISMATCH', { sourceHead, expectedHead });
  return freeze({ ok: true, sourceHead, branch: branch.stdout, expectedHeadMatch: true });
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function actorNames(items, key) {
  return list(items).map((item) => String(item?.[key] || '')).filter(Boolean);
}

function requiredReviewersRule(environment = {}) {
  return list(environment?.protection_rules).filter((rule) => rule?.type === 'required_reviewers');
}

function normalizedWaitTimer(value) {
  const numeric = Number(value ?? 0);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : null;
}

function environmentWaitTimer(environment = {}) {
  const rules = list(environment?.protection_rules).filter((rule) => rule?.type === 'wait_timer');
  if (rules.length > 1) return null;
  return rules.length === 1 ? normalizedWaitTimer(rules[0]?.wait_timer) : 0;
}

export function validateOperatorMergeEnvironment(environment = {}, { expectedWaitTimer = 0 } = {}) {
  if (environment?.name !== OPERATOR_MERGE_PROTECTION_ENVIRONMENT) return fail('ENVIRONMENT_NAME_MISMATCH');
  if (environment?.can_admins_bypass !== false) return fail('ENVIRONMENT_ADMIN_BYPASS_NOT_DISABLED');
  const observedWaitTimer = environmentWaitTimer(environment);
  const requiredWaitTimer = normalizedWaitTimer(expectedWaitTimer);
  if (observedWaitTimer === null || requiredWaitTimer === null || observedWaitTimer !== requiredWaitTimer) {
    return fail('ENVIRONMENT_WAIT_TIMER_NOT_PRESERVED', { expectedWaitTimer: requiredWaitTimer, observedWaitTimer });
  }
  const rules = requiredReviewersRule(environment);
  if (rules.length !== 1) return fail('ENVIRONMENT_REQUIRED_REVIEWER_RULE_COUNT_INVALID', { count: rules.length });
  const rule = rules[0];
  if (rule?.prevent_self_review !== false) return fail('ENVIRONMENT_PREVENT_SELF_REVIEW_INVALID');
  const reviewers = list(rule?.reviewers);
  if (reviewers.length !== 1) return fail('ENVIRONMENT_REVIEWER_COUNT_INVALID', { count: reviewers.length });
  const reviewer = reviewers[0];
  if (reviewer?.type !== 'User' || reviewer?.reviewer?.login !== OPERATOR_MERGE_PROTECTION_REVIEWER) {
    return fail('ENVIRONMENT_REVIEWER_INVALID');
  }
  const policy = environment?.deployment_branch_policy;
  if (policy?.protected_branches !== true || policy?.custom_branch_policies !== false) {
    return fail('ENVIRONMENT_BRANCH_POLICY_INVALID');
  }
  return freeze({
    ok: true,
    finalVerdict: 'OPERATOR_MERGE_ENVIRONMENT_VALID',
    name: environment.name,
    reviewer: reviewer.reviewer.login,
    reviewerType: reviewer.type,
    waitTimer: observedWaitTimer,
    waitTimerPreserved: true,
    preventSelfReview: false,
    canAdminsBypass: false,
    protectedBranches: true,
    customBranchPolicies: false,
  });
}

function uniqueStrings(values) {
  return [...new Set(values.map(String).filter(Boolean))];
}

function requiredStatusCheckContexts(protection = {}) {
  const current = protection?.required_status_checks;
  return uniqueStrings([
    ...list(current?.contexts),
    ...list(current?.checks).map((check) => check?.context),
  ]);
}

function appBoundRequiredStatusChecks(protection = {}) {
  return list(protection?.required_status_checks?.checks)
    .map((check) => ({
      context: String(check?.context || ''),
      app_id: Number.isInteger(check?.app_id) ? check.app_id : null,
    }))
    .filter((check) => check.context && Number.isInteger(check.app_id));
}

export function snapshotRequiredStatusChecks(protection = {}) {
  return freeze({
    contexts: freeze(requiredStatusCheckContexts(protection)),
    checks: freeze(appBoundRequiredStatusChecks(protection).map((check) => freeze(check))),
  });
}

function statusChecks(existing = {}) {
  const current = existing?.required_status_checks;
  const contexts = uniqueStrings([
    ...list(current?.contexts),
    ...list(current?.checks).map((check) => check?.context),
    OPERATOR_MERGE_PROTECTION_REQUIRED_CHECK,
  ]);
  const checks = list(current?.checks)
    .map((check) => ({
      context: String(check?.context || ''),
      ...(Number.isInteger(check?.app_id) ? { app_id: check.app_id } : {}),
    }))
    .filter((check) => check.context);
  return {
    strict: true,
    contexts,
    ...(checks.length ? { checks } : {}),
  };
}

function reviewRestrictions(current = {}) {
  const result = {};
  if (current?.dismissal_restrictions) {
    const restrictions = {
      users: actorNames(current.dismissal_restrictions.users, 'login'),
      teams: actorNames(current.dismissal_restrictions.teams, 'slug'),
      apps: actorNames(current.dismissal_restrictions.apps, 'slug'),
    };
    if (restrictions.users.length || restrictions.teams.length || restrictions.apps.length) {
      result.dismissal_restrictions = restrictions;
    }
  }
  if (current?.bypass_pull_request_allowances) {
    const bypass = {
      users: actorNames(current.bypass_pull_request_allowances.users, 'login'),
      teams: actorNames(current.bypass_pull_request_allowances.teams, 'slug'),
      apps: actorNames(current.bypass_pull_request_allowances.apps, 'slug'),
    };
    if (bypass.users.length || bypass.teams.length || bypass.apps.length) {
      result.bypass_pull_request_allowances = bypass;
    }
  }
  return result;
}

function pullRequestProtection(existing = {}) {
  const current = existing?.required_pull_request_reviews;
  return {
    ...reviewRestrictions(current),
    dismiss_stale_reviews: current?.dismiss_stale_reviews === true,
    require_code_owner_reviews: current?.require_code_owner_reviews === true,
    required_approving_review_count: Number.isInteger(current?.required_approving_review_count)
      ? current.required_approving_review_count
      : 0,
    require_last_push_approval: current?.require_last_push_approval === true,
  };
}

function pushRestrictions(existing = {}) {
  const current = existing?.restrictions;
  if (!current) return null;
  return {
    users: actorNames(current.users, 'login'),
    teams: actorNames(current.teams, 'slug'),
    apps: actorNames(current.apps, 'slug'),
  };
}

export function buildPreservingMainProtection(existing = {}) {
  return freeze({
    required_status_checks: statusChecks(existing),
    enforce_admins: true,
    required_pull_request_reviews: pullRequestProtection(existing),
    restrictions: pushRestrictions(existing),
    required_linear_history: existing?.required_linear_history?.enabled === true,
    allow_force_pushes: false,
    allow_deletions: false,
    block_creations: existing?.block_creations?.enabled === true,
    required_conversation_resolution: existing?.required_conversation_resolution?.enabled === true,
    lock_branch: existing?.lock_branch?.enabled === true,
    allow_fork_syncing: existing?.allow_fork_syncing?.enabled === true,
  });
}

export function validateMainProtection(protection = {}, {
  previousApprovalCount = 0,
  previousStatusChecks = freeze({ contexts: freeze([]), checks: freeze([]) }),
} = {}) {
  if (protection?.enforce_admins?.enabled !== true) return fail('MAIN_ADMIN_ENFORCEMENT_NOT_ENABLED');
  if (!protection?.required_pull_request_reviews) return fail('MAIN_PULL_REQUEST_REQUIREMENT_MISSING');
  const currentContexts = requiredStatusCheckContexts(protection);
  if (protection?.required_status_checks?.strict !== true
    || !currentContexts.includes(OPERATOR_MERGE_PROTECTION_REQUIRED_CHECK)) {
    return fail('MAIN_REQUIRED_OPERATOR_GATE_CHECK_MISSING');
  }
  for (const context of uniqueStrings(list(previousStatusChecks?.contexts))) {
    if (!currentContexts.includes(context)) {
      return fail('MAIN_EXISTING_REQUIRED_CHECK_CONTEXT_DROPPED', { context });
    }
  }
  const currentAppChecks = appBoundRequiredStatusChecks(protection);
  for (const previousCheck of list(previousStatusChecks?.checks)) {
    const context = String(previousCheck?.context || '');
    const appId = Number(previousCheck?.app_id);
    if (!context || !Number.isInteger(appId)) continue;
    const preserved = currentAppChecks.some((check) => check.context === context && check.app_id === appId);
    if (!preserved) {
      return fail('MAIN_EXISTING_REQUIRED_CHECK_APP_BINDING_DROPPED', { context, appId });
    }
  }
  if (protection?.allow_force_pushes?.enabled === true) return fail('MAIN_FORCE_PUSHES_ALLOWED');
  if (protection?.allow_deletions?.enabled === true) return fail('MAIN_DELETION_ALLOWED');
  const approvalCount = Number(protection.required_pull_request_reviews.required_approving_review_count || 0);
  if (previousApprovalCount === 0 && approvalCount !== 0) {
    return fail('MAIN_SECOND_HUMAN_APPROVAL_GATE_ADDED', { approvalCount });
  }
  if (previousApprovalCount > 0 && approvalCount < previousApprovalCount) {
    return fail('MAIN_EXISTING_APPROVAL_REQUIREMENT_WEAKENED', { previousApprovalCount, approvalCount });
  }
  return freeze({
    ok: true,
    finalVerdict: 'MAIN_PROTECTION_VALID',
    enforceAdmins: true,
    pullRequestRequired: true,
    requiredStatusCheck: OPERATOR_MERGE_PROTECTION_REQUIRED_CHECK,
    strictStatusChecks: true,
    preservedRequiredContextCount: uniqueStrings(list(previousStatusChecks?.contexts)).length,
    preservedAppBoundCheckCount: list(previousStatusChecks?.checks).length,
    approvingReviewCount: approvalCount,
    forcePushesAllowed: false,
    deletionsAllowed: false,
  });
}

function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

function canarySuffix(requestId) {
  return String(requestId || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(-48) || 'bounded-canary';
}

function environmentBody(userId, preservedWaitTimer) {
  return {
    wait_timer: preservedWaitTimer,
    prevent_self_review: false,
    can_admins_bypass: false,
    reviewers: [{ type: 'User', id: userId }],
    deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
  };
}

async function requestOrFail(request, specification, blocker) {
  const response = await request(specification);
  if (!response?.ok) return fail(blocker, { status: Number(response?.status || 0), error: safeText(response?.error) });
  return response;
}

async function pause(ms) {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function activationReceipt({ source, environment, mainProtection, canary, timestampUtc }) {
  return freeze({
    schema: 'stephanos.operator-merge-protection-activation.v1',
    repository: OPERATOR_MERGE_PROTECTION_REPOSITORY,
    bootstrapPr: OPERATOR_MERGE_PROTECTION_BOOTSTRAP_PR,
    bootstrapMergeCommit: OPERATOR_MERGE_PROTECTION_BOOTSTRAP_MERGE,
    sourceHead: source.sourceHead,
    environment,
    mainProtection,
    canary,
    CANARY_NO_APPROVAL_MERGE_BLOCKED: true,
    CONTROLLER_SAFE_TO_REENABLE: true,
    timestampUtc,
    arbitraryShellAllowed: false,
    arbitraryBrowserAutomationAllowed: false,
    credentialsMayBeReadOrExported: false,
    destructiveGitAllowed: false,
  });
}

export async function activateOperatorMergeProtectionOnBattleBridge(command = {}, {
  request = createFixedGitHubApiRequester(),
  readSourceIdentity = readOperatorMergeProtectionSourceIdentity,
  sleep = pause,
  now = () => new Date(),
  pollAttempts = POLL_ATTEMPTS,
  pollDelayMs = POLL_DELAY_MS,
} = {}) {
  const source = await readSourceIdentity(command);
  if (!source?.ok) return source;

  const bootstrapPrResponse = await requestOrFail(request, {
    path: `repos/${OPERATOR_MERGE_PROTECTION_REPOSITORY}/pulls/${OPERATOR_MERGE_PROTECTION_BOOTSTRAP_PR}`,
  }, 'BOOTSTRAP_PR_READ_FAILED');
  if (!bootstrapPrResponse.ok) return bootstrapPrResponse;
  const bootstrapPr = bootstrapPrResponse.data || {};
  if (!bootstrapPr.merged_at || String(bootstrapPr.merge_commit_sha || '').toLowerCase() !== OPERATOR_MERGE_PROTECTION_BOOTSTRAP_MERGE) {
    return fail('BOOTSTRAP_PR_MERGE_IDENTITY_MISMATCH');
  }

  const userResponse = await requestOrFail(request, {
    path: `users/${OPERATOR_MERGE_PROTECTION_REVIEWER}`,
  }, 'OPERATOR_REVIEWER_LOOKUP_FAILED');
  if (!userResponse.ok) return userResponse;
  const userId = Number(userResponse.data?.id || 0);
  if (!Number.isInteger(userId) || userId <= 0 || userResponse.data?.login !== OPERATOR_MERGE_PROTECTION_REVIEWER) {
    return fail('OPERATOR_REVIEWER_IDENTITY_INVALID');
  }

  const environmentPath = `repos/${OPERATOR_MERGE_PROTECTION_REPOSITORY}/environments/${encodeURIComponent(OPERATOR_MERGE_PROTECTION_ENVIRONMENT)}`;
  const environmentBeforeResponse = await request({ path: environmentPath });
  if (!environmentBeforeResponse?.ok && Number(environmentBeforeResponse?.status || 0) !== 404) {
    return fail('ENVIRONMENT_READ_FAILED', { status: Number(environmentBeforeResponse?.status || 0) });
  }
  const preservedWaitTimer = environmentBeforeResponse?.ok ? environmentWaitTimer(environmentBeforeResponse.data) : 0;
  if (preservedWaitTimer === null) return fail('ENVIRONMENT_WAIT_TIMER_INVALID');
  const environmentUpdate = await requestOrFail(request, {
    method: 'PUT', path: environmentPath, body: environmentBody(userId, preservedWaitTimer),
  }, 'ENVIRONMENT_UPDATE_FAILED');
  if (!environmentUpdate.ok) return environmentUpdate;
  const environmentRead = await requestOrFail(request, { path: environmentPath }, 'ENVIRONMENT_READBACK_FAILED');
  if (!environmentRead.ok) return environmentRead;
  const environment = validateOperatorMergeEnvironment(environmentRead.data, { expectedWaitTimer: preservedWaitTimer });
  if (!environment.ok) return environment;

  const protectionPath = `repos/${OPERATOR_MERGE_PROTECTION_REPOSITORY}/branches/${OPERATOR_MERGE_PROTECTION_BRANCH}/protection`;
  const protectionBeforeResponse = await request({ path: protectionPath });
  if (!protectionBeforeResponse?.ok && Number(protectionBeforeResponse?.status || 0) !== 404) {
    return fail('MAIN_PROTECTION_READ_FAILED', { status: protectionBeforeResponse?.status || 0 });
  }
  const protectionBefore = protectionBeforeResponse?.ok ? protectionBeforeResponse.data : {};
  const previousApprovalCount = Number(protectionBefore?.required_pull_request_reviews?.required_approving_review_count || 0);
  const previousStatusChecks = snapshotRequiredStatusChecks(protectionBefore);
  const protectionUpdate = await requestOrFail(request, {
    method: 'PUT', path: protectionPath, body: buildPreservingMainProtection(protectionBefore),
  }, 'MAIN_PROTECTION_UPDATE_FAILED');
  if (!protectionUpdate.ok) return protectionUpdate;
  const protectionRead = await requestOrFail(request, { path: protectionPath }, 'MAIN_PROTECTION_READBACK_FAILED');
  if (!protectionRead.ok) return protectionRead;
  const mainProtection = validateMainProtection(protectionRead.data, { previousApprovalCount, previousStatusChecks });
  if (!mainProtection.ok) return mainProtection;

  const suffix = canarySuffix(command.requestId);
  const canaryBranch = `canary/operator-merge-no-approval-${suffix}`;
  const canaryPath = `docs/canaries/operator-merge-no-approval-${suffix}.md`;
  let canaryBranchCreated = false;
  let canaryPrNumber = 0;
  let canaryHead = '';
  let workflowRunId = 0;
  let waitingJobId = 0;
  let cleanupBlocker = '';
  let canaryProof = null;

  try {
    const mainRef = await requestOrFail(request, {
      path: `repos/${OPERATOR_MERGE_PROTECTION_REPOSITORY}/git/ref/heads/${OPERATOR_MERGE_PROTECTION_BRANCH}`,
    }, 'CANARY_MAIN_REF_READ_FAILED');
    if (!mainRef.ok) return mainRef;
    const baseSha = String(mainRef.data?.object?.sha || '').toLowerCase();
    if (!SHA_PATTERN.test(baseSha)) return fail('CANARY_BASE_SHA_INVALID');

    const branchCreate = await requestOrFail(request, {
      method: 'POST',
      path: `repos/${OPERATOR_MERGE_PROTECTION_REPOSITORY}/git/refs`,
      body: { ref: `refs/heads/${canaryBranch}`, sha: baseSha },
    }, 'CANARY_BRANCH_CREATE_FAILED');
    if (!branchCreate.ok) return branchCreate;
    canaryBranchCreated = true;

    const canaryContent = [
      '# Operator merge no-approval canary',
      '',
      `Request: ${command.requestId}`,
      'Purpose: prove the protected environment blocks without operator approval.',
      'This draft pull request must never be merged.',
      '',
    ].join('\n');
    const fileCreate = await requestOrFail(request, {
      method: 'PUT',
      path: `repos/${OPERATOR_MERGE_PROTECTION_REPOSITORY}/contents/${encodePath(canaryPath)}`,
      body: {
        message: `test: no-approval operator merge canary ${command.requestId}`,
        content: Buffer.from(canaryContent, 'utf8').toString('base64'),
        branch: canaryBranch,
      },
    }, 'CANARY_FILE_CREATE_FAILED');
    if (!fileCreate.ok) return fileCreate;
    canaryHead = String(fileCreate.data?.commit?.sha || '').toLowerCase();
    if (!SHA_PATTERN.test(canaryHead)) return fail('CANARY_HEAD_SHA_INVALID');

    const prCreate = await requestOrFail(request, {
      method: 'POST',
      path: `repos/${OPERATOR_MERGE_PROTECTION_REPOSITORY}/pulls`,
      body: {
        title: `[CANARY — DO NOT MERGE] Operator approval hold ${command.requestId}`,
        body: 'Harmless draft canary. It must remain blocked without environment approval and will be closed automatically.',
        head: canaryBranch,
        base: OPERATOR_MERGE_PROTECTION_BRANCH,
        draft: true,
      },
    }, 'CANARY_PR_CREATE_FAILED');
    if (!prCreate.ok) return prCreate;
    canaryPrNumber = Number(prCreate.data?.number || 0);
    if (!Number.isInteger(canaryPrNumber) || canaryPrNumber <= 0) return fail('CANARY_PR_NUMBER_INVALID');

    for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
      const runs = await requestOrFail(request, {
        path: `repos/${OPERATOR_MERGE_PROTECTION_REPOSITORY}/actions/workflows/${OPERATOR_MERGE_PROTECTION_WORKFLOW}/runs?event=pull_request_target&per_page=100`,
      }, 'CANARY_WORKFLOW_RUNS_READ_FAILED');
      if (!runs.ok) return runs;
      const run = list(runs.data?.workflow_runs).find((candidate) => (
        list(candidate?.pull_requests).some((pr) => Number(pr?.number) === canaryPrNumber)
      ));
      if (run) {
        workflowRunId = Number(run.id || 0);
        const jobs = await requestOrFail(request, {
          path: `repos/${OPERATOR_MERGE_PROTECTION_REPOSITORY}/actions/runs/${workflowRunId}/jobs?filter=latest&per_page=100`,
        }, 'CANARY_WORKFLOW_JOBS_READ_FAILED');
        if (!jobs.ok) return jobs;
        const gateJob = list(jobs.data?.jobs).find((job) => job?.name === OPERATOR_MERGE_PROTECTION_REQUIRED_CHECK);
        if (gateJob?.status === 'waiting') {
          const expectedRunUrl = `https://github.com/${OPERATOR_MERGE_PROTECTION_REPOSITORY}/actions/runs/${workflowRunId}`;
          const statuses = await request({
            path: `repos/${OPERATOR_MERGE_PROTECTION_REPOSITORY}/commits/${canaryHead}/statuses?per_page=100`,
          });
          const headStatus = statuses?.ok
            ? validateOperatorMergeHeadStatusReadback(statuses.data, {
              expectedState: 'pending',
              expectedSha: canaryHead,
              expectedRunUrl,
            })
            : null;
          if (headStatus?.ok) {
            waitingJobId = Number(gateJob.id || 0);
            canaryProof = freeze({
              prNumber: canaryPrNumber,
              branch: canaryBranch,
              baseSha,
              headSha: canaryHead,
              workflowRunId,
              waitingJobId,
              waitingJobName: gateJob.name,
              waitingJobStatus: gateJob.status,
              requiredStatusCheck: OPERATOR_MERGE_PROTECTION_REQUIRED_CHECK,
              headStatus: freeze({
                context: headStatus.context,
                state: headStatus.state,
                sha: headStatus.sha,
                targetUrl: headStatus.targetUrl,
              }),
              draft: true,
              merged: false,
            });
            break;
          }
        }
        if (gateJob && ['in_progress', 'completed'].includes(gateJob.status)) {
          return fail('CANARY_NOT_HELD_FOR_OPERATOR_APPROVAL', {
            canaryPrNumber, workflowRunId, jobStatus: gateJob.status, conclusion: gateJob.conclusion || '',
          });
        }
      }
      if (attempt < pollAttempts - 1) await sleep(pollDelayMs);
    }
    if (!canaryProof) return fail('CANARY_EXACT_HEAD_PENDING_STATUS_NOT_OBSERVED', { canaryPrNumber, workflowRunId, canaryHead });
  } finally {
    if (canaryPrNumber > 0) {
      const close = await request({
        method: 'PATCH',
        path: `repos/${OPERATOR_MERGE_PROTECTION_REPOSITORY}/pulls/${canaryPrNumber}`,
        body: { state: 'closed' },
      });
      if (!close?.ok) cleanupBlocker = 'CANARY_PR_CLOSE_FAILED';
    }
    if (canaryBranchCreated) {
      const remove = await request({
        method: 'DELETE',
        path: `repos/${OPERATOR_MERGE_PROTECTION_REPOSITORY}/git/refs/heads/${canaryBranch}`,
      });
      if (!remove?.ok && !cleanupBlocker) cleanupBlocker = 'CANARY_BRANCH_DELETE_FAILED';
    }
  }

  if (cleanupBlocker) return fail(cleanupBlocker, { canaryPrNumber, canaryBranch });
  const receipt = activationReceipt({
    source,
    environment,
    mainProtection,
    canary: canaryProof,
    timestampUtc: now().toISOString(),
  });
  const receiptPost = await requestOrFail(request, {
    method: 'POST',
    path: `repos/${OPERATOR_MERGE_PROTECTION_REPOSITORY}/issues/${OPERATOR_MERGE_PROTECTION_RECEIPT_ISSUE}/comments`,
    body: {
      body: [
        '<!-- stephanos-operator-merge-protection-activation -->',
        '```json',
        JSON.stringify(receipt, null, 2),
        '```',
      ].join('\n'),
    },
  }, 'ACTIVATION_RECEIPT_POST_FAILED');
  if (!receiptPost.ok) return receiptPost;

  return freeze({
    ok: true,
    finalVerdict: 'OPERATOR_MERGE_PROTECTION_ACTIVATED',
    ...receipt,
    receiptCommentId: Number(receiptPost.data?.id || 0),
  });
}
