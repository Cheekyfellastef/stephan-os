import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
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
  return {
    root: join(parent, 'workspace'),
    repoRoot: join(parent, 'repo'),
  };
}

function fakeAdapter({ existing = null, createdNumber = 3001 } = {}) {
  let createCalls = 0;
  return {
    repository: FLYWHEEL_CANONICAL_GOAL_REPOSITORY_V1,
    get createCalls() { return createCalls; },
    async findByMarker() {
      return { ok: true, issue: existing };
    },
    async createIssue(issue) {
      createCalls += 1;
      return {
        ok: true,
        issue: {
          number: createdNumber,
          title: issue.title,
          url: `https://github.com/Cheekyfellastef/stephan-os/issues/${createdNumber}`,
          state: 'open',
        },
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

test('authorized unowned gap creates exactly one issue and scheduler-ready goal record', async () => {
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
  assert.equal(result.schedulerGoal.status, 'READY');
  assert.equal(result.schedulerGoal.route, 'CHATGPT_GITHUB');
  assert.equal(result.authority.githubIssueCreationAllowed, true);
  assert.equal(result.authority.sourceMutationAllowed, false);
  assert.equal(result.authority.mergeAllowed, false);

  const persisted = JSON.parse(
    await readFile(join(root, 'goals', 'goal-3001.json'), 'utf8'),
  );
  assert.equal(persisted.issueNumber, 3001);
  assert.equal(persisted.repository, FLYWHEEL_CANONICAL_GOAL_REPOSITORY_V1);
  assert.equal(persisted.status, 'READY');
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
  const spawnSyncFn = (command, args, options) => {
    calls.push({ command, args, options });
    return {
      status: 0,
      stdout: JSON.stringify({ total_count: 0, items: [] }),
      stderr: '',
    };
  };
  const adapter = createFixedFlywheelGitHubIssueAdapterV1({
    spawnSyncFn,
    ghCommand: 'gh',
    cwd: process.cwd(),
  });
  const found = await adapter.findByMarker('stephanos-flywheel-gap:guarded-runtime-inspection');
  assert.equal(found.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'gh');
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].args[0], 'api');
  assert.equal(calls[0].args[1], 'search/issues');
  assert.match(calls[0].args.join(' '), /repo:Cheekyfellastef\/stephan-os/);
});
