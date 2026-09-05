import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeGithubTelemetry } from '../stephanos-server/services/githubTelemetryService.js';

test('GitHub telemetry preserves exact workflow head SHA for PR-bound dashboard proof', () => {
  const head = 'a'.repeat(40);
  const telemetry = normalizeGithubTelemetry({
    available: true,
    pullRequests: [{
      number: 1627,
      title: 'Goal Dashboard V2',
      head: { ref: 'feat/goal-dashboard-truth-wow-v2', sha: head },
    }],
    workflows: [{
      id: 31798402339,
      name: 'Build Stephanos UI',
      status: 'completed',
      conclusion: 'success',
      head_sha: head,
      pull_requests: [{ number: 1627 }],
      updated_at: '2026-08-14T11:59:21Z',
    }],
  }, { now: new Date('2026-08-14T12:00:00Z') });

  assert.equal(telemetry.pullRequests[0].headSha, head);
  assert.equal(telemetry.workflows[0].prNumber, 1627);
  assert.equal(telemetry.workflows[0].headSha, head);
  assert.equal(telemetry.workflows[0].status, 'passed');
});
