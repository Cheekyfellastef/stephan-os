import test from 'node:test';
import assert from 'node:assert/strict';

import { mergeGithubGoalEstate } from './programmeAuthorityService.js';

const NOW = '2026-09-24T01:20:00.000Z';
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const RESOURCE = 'repo:cheekyfellastef/stephan-os:path:docs/architecture/multiplexer-autonomous-goal-build-v1.md';

test('GitHub goal estate projection preserves authenticated resource scope for elastic admission', () => {
  const records = mergeGithubGoalEstate([], {
    ok: true,
    issues: [{
      issueNumber: 2314,
      repository: REPOSITORY,
      title: 'Canary Goal: Prove multiplexer-backed autonomous goal build V1',
      retrievedAt: NOW,
      htmlUrl: 'https://github.com/Cheekyfellastef/stephan-os/issues/2314',
      admission: { resourceIds: [RESOURCE] },
    }],
  }, NOW);

  assert.equal(records.length, 1);
  assert.equal(records[0].goalId, 'goal-2314');
  assert.equal(records[0].state, 'READY');
  assert.equal(records[0].route, 'OPENCLAW_LOCAL');
  assert.deepEqual(records[0].resourceIds, [RESOURCE]);
  assert.equal(records[0].mergeAuthority, false);
  assert.equal(records[0].runtimeMutationAuthority, false);
});

test('GitHub goal estate projection keeps legacy admitted goals visible but unscoped', () => {
  const records = mergeGithubGoalEstate([], {
    ok: true,
    issues: [{
      issueNumber: 99,
      repository: REPOSITORY,
      title: 'Legacy goal',
      retrievedAt: NOW,
      admission: {},
    }],
  }, NOW);
  assert.deepEqual(records[0].resourceIds, []);
});


test('authenticated GitHub admission enriches an existing unscoped workspace goal without resetting its state', () => {
  const existing = {
    schemaVersion: 'shared-agent-workspace-record.v1',
    kind: 'goal',
    goalId: 'goal-2314',
    participantId: 'goal-intake',
    timestampUtc: '2026-09-24T01:00:00.000Z',
    issueNumber: 2314,
    relatedIssue: '#2314',
    repository: REPOSITORY,
    title: 'Canary Goal: Prove multiplexer-backed autonomous goal build V1',
    status: 'READY',
    state: 'READY',
    prerequisites: [],
    route: 'WAITING_FOR_EXTERNAL_CONDITION',
    resourceIds: [],
    evidenceAt: '2026-09-24T01:00:00.000Z',
    mergeAuthority: false,
    deploymentAuthority: false,
    runtimeMutationAuthority: false,
    arbitraryShellAllowed: false,
  };
  const records = mergeGithubGoalEstate([existing], {
    ok: true,
    issues: [{
      issueNumber: 2314,
      repository: REPOSITORY,
      title: existing.title,
      retrievedAt: NOW,
      htmlUrl: 'https://github.com/Cheekyfellastef/stephan-os/issues/2314',
      admission: { resourceIds: [RESOURCE] },
    }],
  }, NOW);

  assert.equal(records.length, 1);
  assert.equal(records[0].state, 'READY');
  assert.equal(records[0].status, 'READY');
  assert.equal(records[0].route, 'OPENCLAW_LOCAL');
  assert.deepEqual(records[0].resourceIds, [RESOURCE]);
  assert.equal(records[0].githubAdmissionState, 'ADMISSION_PROVEN');
});

test('authenticated GitHub admission does not overwrite an existing non-empty workspace scope', () => {
  const existingResource = 'repo:cheekyfellastef/stephan-os:path:docs/existing.md';
  const existing = {
    schemaVersion: 'shared-agent-workspace-record.v1',
    kind: 'goal',
    goalId: 'goal-2314',
    participantId: 'goal-intake',
    timestampUtc: '2026-09-24T01:00:00.000Z',
    issueNumber: 2314,
    relatedIssue: '#2314',
    repository: REPOSITORY,
    title: 'Existing scoped goal',
    status: 'ACTIVE',
    state: 'ACTIVE',
    route: 'OPENCLAW_LOCAL',
    resourceIds: [existingResource],
    evidenceAt: '2026-09-24T01:00:00.000Z',
  };
  const records = mergeGithubGoalEstate([existing], {
    ok: true,
    issues: [{
      issueNumber: 2314,
      repository: REPOSITORY,
      title: existing.title,
      retrievedAt: NOW,
      admission: { resourceIds: [RESOURCE] },
    }],
  }, NOW);

  assert.equal(records[0].state, 'ACTIVE');
  assert.deepEqual(records[0].resourceIds, [existingResource]);
});
