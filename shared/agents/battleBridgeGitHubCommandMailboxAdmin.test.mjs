import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OPERATOR_MERGE_PROTECTION_BOOTSTRAP_MERGE,
  OPERATOR_MERGE_PROTECTION_ENVIRONMENT,
  OPERATOR_MERGE_PROTECTION_OPERATION,
  OPERATOR_MERGE_PROTECTION_REQUIRED_CHECK,
  activateOperatorMergeProtectionOnBattleBridge,
  buildPreservingMainProtection,
  createFixedGitHubApiRequester,
  snapshotRequiredStatusChecks,
  validateMainProtection,
  validateOperatorMergeEnvironment,
} from './battleBridgeGitHubCommandMailboxAdmin.mjs';

function environment(waitTimer = 0) {
  return {
    name: OPERATOR_MERGE_PROTECTION_ENVIRONMENT,
    wait_timer: waitTimer,
    can_admins_bypass: false,
    protection_rules: [{
      type: 'required_reviewers',
      prevent_self_review: false,
      reviewers: [{ type: 'User', reviewer: { login: 'Cheekyfellastef', id: 267490109 } }],
    }, { type: 'branch_policy' }],
    deployment_branch_policy: { protected_branches: true, custom_branch_policies: false },
  };
}

function protection(overrides = {}) {
  return {
    required_status_checks: {
      strict: true,
      contexts: [OPERATOR_MERGE_PROTECTION_REQUIRED_CHECK],
      checks: [],
    },
    enforce_admins: { enabled: true },
    required_pull_request_reviews: {
      dismiss_stale_reviews: false,
      require_code_owner_reviews: false,
      required_approving_review_count: 0,
      require_last_push_approval: false,
    },
    restrictions: null,
    required_linear_history: { enabled: false },
    allow_force_pushes: { enabled: false },
    allow_deletions: { enabled: false },
    block_creations: { enabled: false },
    required_conversation_resolution: { enabled: false },
    lock_branch: { enabled: false },
    allow_fork_syncing: { enabled: false },
    ...overrides,
  };
}

test('operator environment requires the sole named reviewer, preserved timer and no administrator bypass', () => {
  assert.equal(validateOperatorMergeEnvironment(environment(30), { expectedWaitTimer: 30 }).ok, true);
  assert.equal(validateOperatorMergeEnvironment(environment(0), { expectedWaitTimer: 30 }).blocker, 'ENVIRONMENT_WAIT_TIMER_NOT_PRESERVED');
  assert.equal(validateOperatorMergeEnvironment({ ...environment(), can_admins_bypass: true }).blocker, 'ENVIRONMENT_ADMIN_BYPASS_NOT_DISABLED');
  assert.equal(validateOperatorMergeEnvironment({
    ...environment(),
    protection_rules: [{
      type: 'required_reviewers',
      prevent_self_review: false,
      reviewers: [
        { type: 'User', reviewer: { login: 'Cheekyfellastef' } },
        { type: 'User', reviewer: { login: 'someone-else' } },
      ],
    }],
  }).blocker, 'ENVIRONMENT_REVIEWER_COUNT_INVALID');
});

test('main protection update preserves existing checks and approval count while requiring the protected gate', () => {
  const current = protection({
    required_status_checks: {
      strict: false,
      contexts: ['Build Stephanos UI'],
      checks: [{ context: 'Build Stephanos UI', app_id: 15368 }],
    },
    enforce_admins: { enabled: false },
    required_pull_request_reviews: {
      dismiss_stale_reviews: true,
      require_code_owner_reviews: false,
      required_approving_review_count: 2,
      require_last_push_approval: true,
    },
    allow_force_pushes: { enabled: true },
    allow_deletions: { enabled: true },
  });
  const update = buildPreservingMainProtection(current);
  assert.equal(update.enforce_admins, true);
  assert.equal(update.required_status_checks.strict, true);
  assert.deepEqual(update.required_status_checks.contexts, ['Build Stephanos UI', OPERATOR_MERGE_PROTECTION_REQUIRED_CHECK]);
  assert.equal(update.required_status_checks.checks[0].app_id, 15368);
  assert.equal(update.required_pull_request_reviews.required_approving_review_count, 2);
  assert.equal(update.required_pull_request_reviews.dismiss_stale_reviews, true);
  assert.equal(update.allow_force_pushes, false);
  assert.equal(update.allow_deletions, false);
});

test('new main protection requires pull requests and the protected gate without adding a second approval gate', () => {
  const update = buildPreservingMainProtection({});
  assert.equal(update.required_status_checks.strict, true);
  assert.deepEqual(update.required_status_checks.contexts, [OPERATOR_MERGE_PROTECTION_REQUIRED_CHECK]);
  assert.equal(update.required_pull_request_reviews.required_approving_review_count, 0);
  assert.equal(update.enforce_admins, true);
  assert.equal(update.allow_force_pushes, false);
  assert.equal(update.allow_deletions, false);
  assert.equal(validateMainProtection(protection(), { previousApprovalCount: 0 }).ok, true);
  assert.equal(validateMainProtection(protection({ required_status_checks: null }), { previousApprovalCount: 0 }).blocker, 'MAIN_REQUIRED_OPERATOR_GATE_CHECK_MISSING');
  assert.equal(validateMainProtection(protection({
    required_pull_request_reviews: { required_approving_review_count: 1 },
  }), { previousApprovalCount: 0 }).blocker, 'MAIN_SECOND_HUMAN_APPROVAL_GATE_ADDED');
});

test('main protection readback preserves every previous required context and app binding', () => {
  const previous = protection({
    required_status_checks: {
      strict: false,
      contexts: ['Build Stephanos UI'],
      checks: [{ context: 'Independent Security Review', app_id: 15368 }],
    },
  });
  const previousStatusChecks = snapshotRequiredStatusChecks(previous);
  const validReadback = protection({
    required_status_checks: {
      strict: true,
      contexts: ['Build Stephanos UI', OPERATOR_MERGE_PROTECTION_REQUIRED_CHECK],
      checks: [{ context: 'Independent Security Review', app_id: 15368 }],
    },
  });
  assert.equal(validateMainProtection(validReadback, { previousStatusChecks }).ok, true);
  assert.equal(validateMainProtection(protection({
    required_status_checks: {
      strict: true,
      contexts: [OPERATOR_MERGE_PROTECTION_REQUIRED_CHECK],
      checks: [{ context: 'Independent Security Review', app_id: 15368 }],
    },
  }), { previousStatusChecks }).blocker, 'MAIN_EXISTING_REQUIRED_CHECK_CONTEXT_DROPPED');
  assert.equal(validateMainProtection(protection({
    required_status_checks: {
      strict: true,
      contexts: ['Build Stephanos UI', 'Independent Security Review', OPERATOR_MERGE_PROTECTION_REQUIRED_CHECK],
      checks: [],
    },
  }), { previousStatusChecks }).blocker, 'MAIN_EXISTING_REQUIRED_CHECK_APP_BINDING_DROPPED');
  assert.equal(validateMainProtection(protection({
    required_status_checks: {
      strict: true,
      contexts: ['Build Stephanos UI', 'Independent Security Review', OPERATOR_MERGE_PROTECTION_REQUIRED_CHECK],
      checks: [{ context: 'Independent Security Review', app_id: 99999 }],
    },
  }), { previousStatusChecks }).blocker, 'MAIN_EXISTING_REQUIRED_CHECK_APP_BINDING_DROPPED');
});

test('fixed GitHub API requester rejects every unrelated path without invoking gh', async () => {
  let calls = 0;
  const request = createFixedGitHubApiRequester({ spawn: () => { calls += 1; return { status: 0, stdout: '{}' }; } });
  const response = await request({ path: 'repos/someone/else/settings' });
  assert.equal(response.blocker, 'GITHUB_ADMIN_PATH_NOT_ALLOWED');
  assert.equal(calls, 0);
});

function activationRequest({
  failMainRef = false,
  failBranchCreate = false,
  waitTimer = 30,
  headStatus = 'valid',
} = {}) {
  const calls = [];
  const baseSha = 'b'.repeat(40);
  const canaryHead = 'c'.repeat(40);
  const request = async ({ method = 'GET', path, body } = {}) => {
    calls.push({ method, path, body });
    if (path.endsWith('/pulls/1580')) return { ok: true, data: { merged_at: '2026-07-22T10:11:19Z', merge_commit_sha: OPERATOR_MERGE_PROTECTION_BOOTSTRAP_MERGE } };
    if (path === 'users/Cheekyfellastef') return { ok: true, data: { id: 267490109, login: 'Cheekyfellastef' } };
    if (path.includes('/environments/operator-merge-approval') && method === 'PUT') return { ok: true, data: environment(body?.wait_timer) };
    if (path.includes('/environments/operator-merge-approval')) return { ok: true, data: environment(waitTimer) };
    if (path.endsWith('/branches/main/protection') && method === 'GET' && calls.filter((call) => call.path.endsWith('/branches/main/protection') && call.method === 'GET').length === 1) return { ok: false, status: 404 };
    if (path.endsWith('/branches/main/protection') && method === 'PUT') return { ok: true, data: protection() };
    if (path.endsWith('/branches/main/protection')) return { ok: true, data: protection() };
    if (path.endsWith('/git/ref/heads/main')) return failMainRef ? { ok: false, status: 500, error: 'main ref unavailable' } : { ok: true, data: { object: { sha: baseSha } } };
    if (path.endsWith('/git/refs') && method === 'POST') return failBranchCreate ? { ok: false, status: 422, error: 'branch exists' } : { ok: true, data: {} };
    if (path.includes('/contents/docs/canaries/') && method === 'PUT') return { ok: true, data: { commit: { sha: canaryHead } } };
    if (path.endsWith('/pulls') && method === 'POST') return { ok: true, data: { number: 1601 } };
    if (path.includes('/actions/workflows/operator-merge-approval-gate.yml/runs')) return { ok: true, data: { workflow_runs: [{ id: 9001, pull_requests: [{ number: 1601 }] }] } };
    if (path.endsWith('/actions/runs/9001/jobs?filter=latest&per_page=100')) return { ok: true, data: { jobs: [{ id: 9101, name: 'operator-approval-gate', status: 'waiting', conclusion: null }] } };
    if (path.endsWith(`/commits/${canaryHead}/statuses?per_page=100`)) {
      if (headStatus === 'missing') return { ok: true, data: [] };
      return { ok: true, data: [{
        context: OPERATOR_MERGE_PROTECTION_REQUIRED_CHECK,
        state: 'pending',
        sha: headStatus === 'wrong-sha' ? baseSha : canaryHead,
        target_url: headStatus === 'wrong-run'
          ? 'https://github.com/Cheekyfellastef/stephan-os/actions/runs/9999'
          : 'https://github.com/Cheekyfellastef/stephan-os/actions/runs/9001',
      }] };
    }
    if (path.endsWith('/pulls/1601') && method === 'PATCH') return { ok: true, data: { state: 'closed' } };
    if (path.includes('/git/refs/heads/canary/') && method === 'DELETE') return { ok: true, data: null };
    if (path.endsWith('/issues/1568/comments') && method === 'POST') return { ok: true, data: { id: 5001 } };
    throw new Error(`Unexpected request ${method} ${path}`);
  };
  return { calls, request, canaryHead };
}

test('bounded activation preserves the timer, proves exact-head pending status, cleans up and posts #1568 receipt', async () => {
  const expectedHead = 'a'.repeat(40);
  const { calls, request, canaryHead } = activationRequest();
  const result = await activateOperatorMergeProtectionOnBattleBridge({
    requestId: 'operator-protection-activation-0001',
    operation: OPERATOR_MERGE_PROTECTION_OPERATION,
    expectedHead,
  }, {
    request,
    readSourceIdentity: async () => ({ ok: true, sourceHead: expectedHead, branch: 'main', expectedHeadMatch: true }),
    sleep: async () => {},
    now: () => new Date('2026-07-22T12:00:00.000Z'),
    pollAttempts: 1,
  });

  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'OPERATOR_MERGE_PROTECTION_ACTIVATED');
  assert.equal(result.environment.waitTimer, 30);
  assert.equal(result.environment.waitTimerPreserved, true);
  assert.equal(result.CANARY_NO_APPROVAL_MERGE_BLOCKED, true);
  assert.equal(result.CONTROLLER_SAFE_TO_REENABLE, true);
  assert.equal(result.canary.prNumber, 1601);
  assert.equal(result.canary.waitingJobStatus, 'waiting');
  assert.equal(result.canary.headStatus.state, 'pending');
  assert.equal(result.canary.headStatus.sha, canaryHead);
  assert.ok(calls.some((call) => call.method === 'PUT' && call.body?.wait_timer === 30));
  assert.ok(calls.some((call) => call.method === 'PUT' && call.body?.can_admins_bypass === false));
  assert.ok(calls.some((call) => call.method === 'PUT' && call.body?.required_status_checks?.contexts?.includes(OPERATOR_MERGE_PROTECTION_REQUIRED_CHECK)));
  assert.ok(calls.some((call) => call.method === 'PATCH' && call.path.endsWith('/pulls/1601')));
  assert.ok(calls.some((call) => call.method === 'DELETE' && call.path.includes('/git/refs/heads/canary/')));
  assert.ok(calls.some((call) => call.method === 'POST' && call.path.endsWith('/issues/1568/comments')));
});

test('canary fails closed without exact-head pending status bound to the same run', async () => {
  const expectedHead = 'a'.repeat(40);
  for (const headStatus of ['missing', 'wrong-sha', 'wrong-run']) {
    const { calls, request } = activationRequest({ headStatus });
    const result = await activateOperatorMergeProtectionOnBattleBridge({
      requestId: `operator-protection-status-${headStatus}`,
      operation: OPERATOR_MERGE_PROTECTION_OPERATION,
      expectedHead,
    }, {
      request,
      readSourceIdentity: async () => ({ ok: true, sourceHead: expectedHead, branch: 'main', expectedHeadMatch: true }),
      sleep: async () => {},
      pollAttempts: 1,
    });
    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'CANARY_EXACT_HEAD_PENDING_STATUS_NOT_OBSERVED');
    assert.equal(calls.some((call) => call.method === 'POST' && call.path.endsWith('/issues/1568/comments')), false);
  }
});

test('cleanup never deletes a canary branch that this activation did not create', async () => {
  const expectedHead = 'a'.repeat(40);
  for (const options of [{ failMainRef: true }, { failBranchCreate: true }]) {
    const { calls, request } = activationRequest(options);
    const result = await activateOperatorMergeProtectionOnBattleBridge({
      requestId: `operator-protection-cleanup-${options.failMainRef ? 'main-ref' : 'branch-create'}`,
      operation: OPERATOR_MERGE_PROTECTION_OPERATION,
      expectedHead,
    }, {
      request,
      readSourceIdentity: async () => ({ ok: true, sourceHead: expectedHead, branch: 'main', expectedHeadMatch: true }),
      sleep: async () => {},
      pollAttempts: 1,
    });
    assert.equal(result.ok, false);
    assert.equal(calls.some((call) => call.method === 'DELETE' && call.path.includes('/git/refs/heads/canary/')), false);
  }
});
