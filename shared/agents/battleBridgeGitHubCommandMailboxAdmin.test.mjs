import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OPERATOR_MERGE_PROTECTION_BOOTSTRAP_MERGE,
  OPERATOR_MERGE_PROTECTION_ENVIRONMENT,
  OPERATOR_MERGE_PROTECTION_OPERATION,
  activateOperatorMergeProtectionOnBattleBridge,
  buildPreservingMainProtection,
  createFixedGitHubApiRequester,
  validateMainProtection,
  validateOperatorMergeEnvironment,
} from './battleBridgeGitHubCommandMailboxAdmin.mjs';

function environment() {
  return {
    name: OPERATOR_MERGE_PROTECTION_ENVIRONMENT,
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
    required_status_checks: null,
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

test('operator environment requires the sole named reviewer and no administrator bypass', () => {
  assert.equal(validateOperatorMergeEnvironment(environment()).ok, true);
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

test('main protection update preserves existing checks and approval count while strengthening bypass controls', () => {
  const current = protection({
    required_status_checks: {
      strict: true,
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
  assert.deepEqual(update.required_status_checks.contexts, ['Build Stephanos UI']);
  assert.equal(update.required_status_checks.checks[0].app_id, 15368);
  assert.equal(update.required_pull_request_reviews.required_approving_review_count, 2);
  assert.equal(update.required_pull_request_reviews.dismiss_stale_reviews, true);
  assert.equal(update.allow_force_pushes, false);
  assert.equal(update.allow_deletions, false);
});

test('new main protection requires pull requests without adding a second approval gate', () => {
  const update = buildPreservingMainProtection({});
  assert.equal(update.required_pull_request_reviews.required_approving_review_count, 0);
  assert.equal(update.enforce_admins, true);
  assert.equal(update.allow_force_pushes, false);
  assert.equal(update.allow_deletions, false);
  assert.equal(validateMainProtection(protection(), { previousApprovalCount: 0 }).ok, true);
  assert.equal(validateMainProtection(protection({
    required_pull_request_reviews: { required_approving_review_count: 1 },
  }), { previousApprovalCount: 0 }).blocker, 'MAIN_SECOND_HUMAN_APPROVAL_GATE_ADDED');
});

test('fixed GitHub API requester rejects every unrelated path without invoking gh', async () => {
  let calls = 0;
  const request = createFixedGitHubApiRequester({ spawn: () => { calls += 1; return { status: 0, stdout: '{}' }; } });
  const response = await request({ path: 'repos/someone/else/settings' });
  assert.equal(response.blocker, 'GITHUB_ADMIN_PATH_NOT_ALLOWED');
  assert.equal(calls, 0);
});

test('bounded activation configures protection, proves a waiting draft canary, cleans it up and posts #1568 receipt', async () => {
  const calls = [];
  const expectedHead = 'a'.repeat(40);
  const baseSha = 'b'.repeat(40);
  const canaryHead = 'c'.repeat(40);
  const request = async ({ method = 'GET', path, body } = {}) => {
    calls.push({ method, path, body });
    if (path.endsWith('/pulls/1580')) return { ok: true, data: { merged_at: '2026-07-22T10:11:19Z', merge_commit_sha: OPERATOR_MERGE_PROTECTION_BOOTSTRAP_MERGE } };
    if (path === 'users/Cheekyfellastef') return { ok: true, data: { id: 267490109, login: 'Cheekyfellastef' } };
    if (path.includes('/environments/operator-merge-approval') && method === 'PUT') return { ok: true, data: environment() };
    if (path.includes('/environments/operator-merge-approval')) return { ok: true, data: environment() };
    if (path.endsWith('/branches/main/protection') && method === 'GET' && calls.filter((call) => call.path.endsWith('/branches/main/protection') && call.method === 'GET').length === 1) {
      return { ok: false, status: 404 };
    }
    if (path.endsWith('/branches/main/protection') && method === 'PUT') return { ok: true, data: protection() };
    if (path.endsWith('/branches/main/protection')) return { ok: true, data: protection() };
    if (path.endsWith('/git/ref/heads/main')) return { ok: true, data: { object: { sha: baseSha } } };
    if (path.endsWith('/git/refs') && method === 'POST') return { ok: true, data: {} };
    if (path.includes('/contents/docs/canaries/') && method === 'PUT') return { ok: true, data: { commit: { sha: canaryHead } } };
    if (path.endsWith('/pulls') && method === 'POST') return { ok: true, data: { number: 1601 } };
    if (path.includes('/actions/workflows/operator-merge-approval-gate.yml/runs')) {
      return { ok: true, data: { workflow_runs: [{ id: 9001, pull_requests: [{ number: 1601 }] }] } };
    }
    if (path.endsWith('/actions/runs/9001/jobs?filter=latest&per_page=100')) {
      return { ok: true, data: { jobs: [{ id: 9101, name: 'operator-approval-gate', status: 'waiting', conclusion: null }] } };
    }
    if (path.endsWith('/pulls/1601') && method === 'PATCH') return { ok: true, data: { state: 'closed' } };
    if (path.includes('/git/refs/heads/canary/') && method === 'DELETE') return { ok: true, data: null };
    if (path.endsWith('/issues/1568/comments') && method === 'POST') return { ok: true, data: { id: 5001 } };
    throw new Error(`Unexpected request ${method} ${path}`);
  };

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
  assert.equal(result.CANARY_NO_APPROVAL_MERGE_BLOCKED, true);
  assert.equal(result.CONTROLLER_SAFE_TO_REENABLE, true);
  assert.equal(result.canary.prNumber, 1601);
  assert.equal(result.canary.waitingJobStatus, 'waiting');
  assert.ok(calls.some((call) => call.method === 'PUT' && call.body?.can_admins_bypass === false));
  assert.ok(calls.some((call) => call.method === 'PATCH' && call.path.endsWith('/pulls/1601')));
  assert.ok(calls.some((call) => call.method === 'DELETE' && call.path.includes('/git/refs/heads/canary/')));
  assert.ok(calls.some((call) => call.method === 'POST' && call.path.endsWith('/issues/1568/comments')));
});
