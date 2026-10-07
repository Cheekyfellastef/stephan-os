import test from 'node:test';
import assert from 'node:assert/strict';

import { mergeGithubGoalEstate } from './programmeAuthorityService.js';

const NOW = '2026-10-07T05:10:00.000Z';
const REPOSITORY = 'Cheekyfellastef/stephan-os';

test('live GitHub admission refreshes pathname casing without widening canonical scope', () => {
  const oldResource = 'repo:cheekyfellastef/stephan-os:path:shared/runtime/stephanosmemory.mjs';
  const liveResource = 'repo:cheekyfellastef/stephan-os:path:shared/runtime/stephanosMemory.mjs';
  const existing = {
    schemaVersion: 'shared-agent-workspace-record.v1',
    kind: 'goal',
    goalId: 'goal-1645',
    issueNumber: 1645,
    repository: REPOSITORY,
    title: 'Durable memory goal',
    status: 'READY',
    state: 'READY',
    route: 'OPENCLAW_LOCAL',
    resourceIds: [oldResource],
  };

  const records = mergeGithubGoalEstate([existing], {
    ok: true,
    issues: [{
      issueNumber: 1645,
      repository: REPOSITORY,
      title: existing.title,
      retrievedAt: NOW,
      admission: { resourceIds: [liveResource] },
    }],
  }, NOW);

  assert.deepEqual(records[0].resourceIds, [liveResource]);
  assert.equal(records[0].state, 'READY');
});

test('live GitHub admission cannot replace a materially different non-empty scope', () => {
  const existingResource = 'repo:cheekyfellastef/stephan-os:path:docs/existing.md';
  const liveResource = 'repo:cheekyfellastef/stephan-os:path:shared/runtime/stephanosMemory.mjs';
  const existing = {
    schemaVersion: 'shared-agent-workspace-record.v1',
    kind: 'goal',
    goalId: 'goal-1645',
    issueNumber: 1645,
    repository: REPOSITORY,
    title: 'Durable memory goal',
    status: 'ACTIVE',
    state: 'ACTIVE',
    route: 'OPENCLAW_LOCAL',
    resourceIds: [existingResource],
  };

  const records = mergeGithubGoalEstate([existing], {
    ok: true,
    issues: [{
      issueNumber: 1645,
      repository: REPOSITORY,
      title: existing.title,
      retrievedAt: NOW,
      admission: { resourceIds: [liveResource] },
    }],
  }, NOW);

  assert.deepEqual(records[0].resourceIds, [existingResource]);
  assert.equal(records[0].state, 'ACTIVE');
});
