import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveMissionWorkerGrantIdentity,
} from './durableFlywheelControllerVNext.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';

function fallback(overrides = {}) {
  return {
    laneId: 'goal-1497-pr-1617',
    repository: REPOSITORY,
    issueNumber: 1497,
    prNumber: 1617,
    branch: 'feat/durable-flywheel-controller-vnext',
    headSha: 'a'.repeat(40),
    ...overrides,
  };
}

test('critical pre-PR mission grant identity is bound to the mission rather than a stale programme lane', () => {
  const identity = resolveMissionWorkerGrantIdentity({
    missionId: 'critical-1291-worker-watchdog-repair',
    repository: REPOSITORY,
    git: {
      branch: 'openclaw/critical-1291-worker-watchdog-repair',
    },
  }, fallback());

  assert.deepEqual(identity, {
    laneId: 'critical-1291-worker-watchdog-repair',
    repository: REPOSITORY,
    issueNumber: 1291,
    prNumber: null,
    branch: 'openclaw/critical-1291-worker-watchdog-repair',
    headSha: '',
  });
});

test('goal PR mission derives exact issue, PR, branch and head identity from the mission state', () => {
  const identity = resolveMissionWorkerGrantIdentity({
    missionId: 'goal-1622-pr-1999-autonomy-acceptance',
    repository: REPOSITORY,
    git: {
      branch: 'codex/five-builder-flywheel-repair',
    },
    pullRequest: {
      number: 1999,
      headSha: 'b'.repeat(40),
    },
  }, fallback());

  assert.deepEqual(identity, {
    laneId: 'goal-1622-pr-1999-autonomy-acceptance',
    repository: REPOSITORY,
    issueNumber: 1622,
    prNumber: 1999,
    branch: 'codex/five-builder-flywheel-repair',
    headSha: 'b'.repeat(40),
  });
});

test('conflicting explicit issue identity fails closed instead of laundering a mismatched worker grant', () => {
  const identity = resolveMissionWorkerGrantIdentity({
    missionId: 'critical-1291-worker-watchdog-repair',
    issueNumber: 654,
    repository: REPOSITORY,
    git: {
      branch: 'openclaw/critical-1291-worker-watchdog-repair',
    },
  }, fallback());

  assert.equal(identity, null);
});

test('mission-bound identity does not inherit a foreign PR, branch or head from the programme lane', () => {
  const identity = resolveMissionWorkerGrantIdentity({
    missionId: 'critical-654-elastic-goal-build',
    repository: REPOSITORY,
    git: {
      branch: 'openclaw/critical-654-source-governed',
    },
  }, fallback({
    prNumber: 2100,
    branch: 'review/non-codex-mission-worker-cleanup-specialist-v1',
    headSha: 'c'.repeat(40),
  }));

  assert.equal(identity.issueNumber, 654);
  assert.equal(identity.prNumber, null);
  assert.equal(identity.branch, 'openclaw/critical-654-source-governed');
  assert.equal(identity.headSha, '');
});
