import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  FLYWHEEL_CANONICAL_GOAL_ADMISSION_POLICY_V1,
  FLYWHEEL_CANONICAL_GOAL_REPOSITORY_V1,
  admitFlywheelCanonicalGoalV1,
  buildFlywheelCanonicalGoalIssueV1,
  createFixedFlywheelGitHubIssueAdapterV1,
  validateFlywheelCanonicalGoalAdmissionPolicyV1,
} from './flywheelCanonicalGoalAdmissionService.js';

const NOW = '2026-10-03T18:40:00.000Z';

async function fixture() {
  const parent = await mkdtemp(join(tmpdir(), 'flywheel-canonical-goal-'));
  const root = join(parent, 'workspace');
  const repoRoot = join(parent, 'repo');
  await Promise.all([
    mkdir(root, { recursive: true }),
    mkdir(repoRoot, { recursive: true }),
  ]);
  return { root, repoRoot };
}

function fakeAdapter({ existing = null, ownerCandidates = [], createdNumber = 3001 } = {}) {
  let createCalls = 0;
  let currentExisting = existing;
  return {
    repository: FLYWHEEL_CANONICAL_GOAL_REPOSITORY_V1,
    get createCalls() { return createCalls; },
    async findByMarker() {
      return { ok: true, issue: currentExisting };
    },
    async findOwnerCandidates() {
      return { ok: true, candidates: ownerCandidates };
    },
    async createIssue(issue) {
      createCalls += 1;
      currentExisting = {
        number: createdNumber,
        title: issue.title,
        url: `https://github.com/Cheekyfellastef/stephan-os/issues/${createdNumber}`,
        state: 'open',
      };
      return {
        ok: true,
        issue: currentExisting,
      };
    },
  };
}

test('source-controlled policy grants only bounded child-goal issue admission', () => {
  const result = validateFlywheelCanonicalGoalAdmissionPolicyV1(
    FLYWHEEL_CANONICAL_GOAL_ADMISSION_POLICY_V1,
  );
  assert.equal(result.valid, true);
  assert.equal(FLYWHEEL_CANONICAL_GOAL_ADMISSION_POLICY_V1.authorityClass, 'NEW_GOAL_SCOPE_AUTHORIZED');
  assert.equal(FLYWHEEL_CANONICAL_GOAL_ADMISSION_POLICY_V1.sourceMutationAllowed, false);
  assert.equal(FLYWHEEL_CANONICAL_GOAL_ADMISSION_POLICY_V1.mergeAllowed, false);
  assert.equal(FLYWHEEL_CANONICAL_GOAL_ADMISSION_POLICY_V1.deploymentAllowed, false);
  assert.equal(FLYWHEEL_CANONICAL_GOAL_ADMISSION_POLICY_V1.arbitraryShellAllowed, false);
});

test('canonical admission is inert without production controller authority', async () => {
  const adapter = fakeAdapter();
  const result = await admitFlywheelCanonicalGoalV1({
    canonicalGoalAdmissionAuthorized: false,
    eventId: 'gap-1',
    capabilityId: 'guarded-runtime-inspection',
    githubAdapter: adapter,
  });
  assert.equal(result.ok, false);
  assert.equal(result.authorized, false);
  assert.equal(result.reason, 'FLYWHEEL_CANONICAL_GOAL_PRODUCTION_AUTHORITY_REQUIRED');
  assert.equal(adapter.createCalls, 0);
});


test('plausible existing capability owner vetoes new issue creation', async () => {
  const { root, repoRoot } = await fixture();
  const adapter = fakeAdapter({
    ownerCandidates: [{
      number: 1444,
      title: 'Existing guarded runtime inspection goal',
      url: 'https://github.com/Cheekyfellastef/stephan-os/issues/1444',
    }],
  });
  const result = await admitFlywheelCanonicalGoalV1({
    canonicalGoalAdmissionAuthorized: true,
    root,
    repoRoot,
    eventId: 'gap-owner-search',
    capabilityId: 'guarded-runtime-inspection',
    githubAdapter: adapter,
  });

  assert.equal(result.ok, false);
  assert.equal(result.authorized, true);
  assert.equal(result.reason, 'FLYWHEEL_CANONICAL_GOAL_OWNER_CANDIDATES_REQUIRE_RESOLUTION');
  assert.equal(result.ownerCandidates[0].number, 1444);
  assert.equal(adapter.createCalls, 0);
});

test('authorized unowned gap creates one issue but keeps the scheduler goal non-runnable until dispatch admission', async () => {
  const { root, repoRoot } = await fixture();
  const adapter = fakeAdapter({ createdNumber: 3001 });
  const result = await admitFlywheelCanonicalGoalV1({
    canonicalGoalAdmissionAuthorized: true,
    root,
    repoRoot,
    nowUtc: NOW,
    nowMs: Date.parse(NOW),
    eventId: 'gap-1',
    capabilityId: 'guarded-runtime-inspection',
    evidenceRefs: ['events/gap-1.json'],
    githubAdapter: adapter,
  });

  assert.equal(result.ok, true);
  assert.equal(result.created, true);
  assert.equal(result.issue.number, 3001);
  assert.equal(adapter.createCalls, 1);
  assert.equal(result.schedulerGoal.issueNumber, 3001);
  assert.equal(result.schedulerGoal.status, 'BLOCKED');
  assert.equal(result.schedulerGoal.route, 'BLOCKED_UNSAFE_OR_UNKNOWN');
  assert.equal(result.schedulerGoal.dispatchAdmissionRequired, true);
  assert.equal(result.schedulerGoal.dispatchAllowed, false);
  assert.equal(result.schedulerGoal.dispatchAdmissionState, 'PENDING_CANONICAL_DISPATCH_ADMISSION');
  assert.equal(result.finalVerdict, 'FLYWHEEL_CANONICAL_GOAL_ISSUE_ADMITTED_DISPATCH_HELD');
  assert.equal(result.authority.githubIssueCreationAllowed, true);
  assert.equal(result.authority.sourceMutationAllowed, false);
  assert.equal(result.authority.mergeAllowed, false);

  const persisted = JSON.parse(
    await readFile(join(root, 'goals', 'goal-3001.json'), 'utf8'),
  );
  assert.equal(persisted.issueNumber, 3001);
  assert.equal(persisted.repository, FLYWHEEL_CANONICAL_GOAL_REPOSITORY_V1);
  assert.equal(persisted.status, 'BLOCKED');
  assert.equal(persisted.route, 'BLOCKED_UNSAFE_OR_UNKNOWN');
  assert.equal(persisted.dispatchAllowed, false);
});

test('existing marker dedupes issue creation and reuses the same canonical goal', async () => {
  const { root, repoRoot } = await fixture();
  const issueShape = buildFlywheelCanonicalGoalIssueV1({
    eventId: 'gap-2',
    capabilityId: 'shared-workspace-proof-routing',
  });
  const adapter = fakeAdapter({
    existing: {
      number: 3002,
      title: issueShape.title,
      url: 'https://github.com/Cheekyfellastef/stephan-os/issues/3002',
      state: 'open',
    },
  });

  const result = await admitFlywheelCanonicalGoalV1({
    canonicalGoalAdmissionAuthorized: true,
    root,
    repoRoot,
    nowUtc: NOW,
    nowMs: Date.parse(NOW),
    eventId: 'gap-2',
    capabilityId: 'shared-workspace-proof-routing',
    githubAdapter: adapter,
  });

  assert.equal(result.ok, true);
  assert.equal(result.created, false);
  assert.equal(result.deduped, true);
  assert.equal(result.issue.number, 3002);
  assert.equal(adapter.createCalls, 0);
});

test('fixed GitHub adapter uses shell-free fixed-repository calls', async () => {
  const calls = [];
  const execFileFn = (command, args, options, callback) => {
    calls.push({ command, args, options });
    queueMicrotask(() => callback(null, JSON.stringify({ total_count: 0, items: [] }), ''));
  };
  const adapter = createFixedFlywheelGitHubIssueAdapterV1({
    execFileFn,
    ghCommand: 'gh',
    cwd: process.cwd(),
  });
  const found = await adapter.findByMarker('stephanos-flywheel-gap:guarded-runtime-inspection');
  assert.equal(found.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'gh');
  assert.notEqual(calls[0].options.shell, true);
  assert.equal(calls[0].args[0], 'api');
  assert.equal(calls[0].args[1], 'search/issues');
  assert.match(calls[0].args.join(' '), /repo:Cheekyfellastef\/stephan-os/);
  assert.match(calls[0].args.join(' '), /is:open/);
});

test('closed marker issues are not reused as the current canonical gap owner', async () => {
  const calls = [];
  const marker = 'stephanos-flywheel-gap:guarded-runtime-inspection';
  const execFileFn = (command, args, options, callback) => {
    calls.push({ command, args, options });
    queueMicrotask(() => callback(null, JSON.stringify({
      total_count: 1,
      items: [{
        number: 2999,
        title: 'Closed prior gap',
        body: `<!-- ${marker} -->`,
        html_url: 'https://github.com/Cheekyfellastef/stephan-os/issues/2999',
        state: 'closed',
      }],
    }), ''));
  };
  const adapter = createFixedFlywheelGitHubIssueAdapterV1({ execFileFn, ghCommand: 'gh' });
  const result = await adapter.findByMarker(marker);
  assert.equal(result.ok, true);
  assert.equal(result.issue, null);
  assert.match(calls[0].args.join(' '), /is:open/);
});

test('concurrent production admission serializes one marker into one canonical issue', async () => {
  const { root, repoRoot } = await fixture();
  const adapter = fakeAdapter({ createdNumber: 3004 });
  const input = {
    canonicalGoalAdmissionAuthorized: true,
    root,
    repoRoot,
    nowUtc: NOW,
    nowMs: Date.parse(NOW),
    eventId: 'gap-concurrent',
    capabilityId: 'guarded-runtime-inspection',
    githubAdapter: adapter,
  };

  const [left, right] = await Promise.all([
    admitFlywheelCanonicalGoalV1(input),
    admitFlywheelCanonicalGoalV1(input),
  ]);

  assert.equal(adapter.createCalls, 1);
  assert.deepEqual([left.issue.number, right.issue.number], [3004, 3004]);
  assert.equal([left.created, right.created].filter(Boolean).length, 1);
  assert.equal([left.deduped, right.deduped].filter(Boolean).length, 1);
});


test('issue creation quota hold still performs canonical lookup and never creates a new issue', async () => {
  const { root, repoRoot } = await fixture();
  const adapter = fakeAdapter({ createdNumber: 3005 });
  const result = await admitFlywheelCanonicalGoalV1({
    canonicalGoalAdmissionAuthorized: true,
    allowIssueCreation: false,
    root,
    repoRoot,
    nowUtc: NOW,
    nowMs: Date.parse(NOW),
    eventId: 'gap-quota-held',
    capabilityId: 'quota-held-capability',
    githubAdapter: adapter,
  });

  assert.equal(result.ok, false);
  assert.equal(result.retryableHold, true);
  assert.equal(result.issueCreationHeld, true);
  assert.equal(result.reason, 'FLYWHEEL_CANONICAL_GOAL_PER_CYCLE_LIMIT');
  assert.equal(adapter.createCalls, 0);
});

test('created issue identity survives a thrown scheduler publication failure', async () => {
  const { root, repoRoot } = await fixture();
  const adapter = fakeAdapter({ createdNumber: 3006 });
  const result = await admitFlywheelCanonicalGoalV1({
    canonicalGoalAdmissionAuthorized: true,
    root,
    repoRoot,
    nowUtc: NOW,
    nowMs: Date.parse(NOW),
    eventId: 'gap-scheduler-throw',
    capabilityId: 'scheduler-throw-capability',
    githubAdapter: adapter,
    writeAtomicJsonFn: async () => {
      throw new Error('simulated scheduler publication failure');
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.retryableHold, true);
  assert.equal(result.created, true);
  assert.equal(result.issue.number, 3006);
  assert.equal(result.reason, 'FLYWHEEL_CANONICAL_SCHEDULER_GOAL_WRITE_FAILED');
});

test('lock release failure preserves an already-created issue receipt and holds fallback', async () => {
  const { root, repoRoot } = await fixture();
  const adapter = fakeAdapter({ createdNumber: 3007 });
  const result = await admitFlywheelCanonicalGoalV1({
    canonicalGoalAdmissionAuthorized: true,
    root,
    repoRoot,
    nowUtc: NOW,
    nowMs: Date.parse(NOW),
    eventId: 'gap-release-failure',
    capabilityId: 'release-failure-capability',
    githubAdapter: adapter,
    acquireOperationLock: async () => ({
      ok: true,
      release: async () => false,
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.retryableHold, true);
  assert.equal(result.created, true);
  assert.equal(result.issue.number, 3007);
  assert.equal(result.reason, 'FLYWHEEL_CANONICAL_GOAL_ADMISSION_LOCK_RELEASE_FAILED');
});


test('fixed GitHub adapter yields the controller event loop while bounded GitHub I/O is pending', async () => {
  let timerFired = false;
  const execFileFn = (_command, _args, _options, callback) => {
    setTimeout(() => callback(null, JSON.stringify({ total_count: 0, items: [] }), ''), 10);
  };
  const adapter = createFixedFlywheelGitHubIssueAdapterV1({ execFileFn, ghCommand: 'gh' });
  const pending = adapter.findByMarker('stephanos-flywheel-gap:guarded-runtime-inspection');
  setTimeout(() => { timerFired = true; }, 0);
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(timerFired, true);
});

test('canonical issue carries bounded Flywheel diagnosis and keeps authority language explicit', () => {
  const issue = buildFlywheelCanonicalGoalIssueV1({
    eventId: 'brain-gap',
    capabilityId: 'guarded-brain-repair',
    upliftPlan: { dimensionsNeedingUplift: ['reasoning-quality', 'recovery'] },
    brainDiagnosis: {
      attempted: true,
      ok: true,
      provider: 'ollama',
      model: 'qwen3.5:27b',
      reason: 'FLYWHEEL_BRAIN_DIAGNOSIS_READY',
      outputText: 'Root cause hypothesis: the repair path is missing a guarded capability adapter.',
    },
  });

  assert.match(issue.body, /Bounded Flywheel diagnosis/);
  assert.match(issue.body, /ollama\/qwen3\.5:27b/);
  assert.match(issue.body, /Root cause hypothesis/);
  assert.match(issue.body, /reasoning-quality/);
  assert.match(issue.body, /grants no source, runtime, dispatch, merge, deploy, spend, credential, or approval authority/);
});

