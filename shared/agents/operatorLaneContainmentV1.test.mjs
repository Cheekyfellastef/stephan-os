import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';

import {
  OPERATOR_LANE_CONTAINMENT_SCHEMA,
  evaluateOperatorLaneContainmentV1,
  validateOperatorLaneContainmentCommandV1,
} from './operatorLaneContainmentV1.mjs';

const REPO = 'Cheekyfellastef/stephan-os';
const BRANCH = 'fix/example-lane';
const HEAD = 'a'.repeat(40);

function body(payload) {
  const fence = String.fromCharCode(96).repeat(3);
  return fence + 'stephanos-operator-lane-containment-v1\n'
    + JSON.stringify(payload) + '\n' + fence;
}

function command(patch = {}) {
  return {
    schemaVersion: OPERATOR_LANE_CONTAINMENT_SCHEMA,
    commandId: 'containment-example-0001',
    action: 'STOP',
    repository: REPO,
    prNumber: 2000,
    branch: BRANCH,
    frozenHead: HEAD,
    resourceIds: ['repo:cheekyfellastef/stephan-os:branch:fix/example-lane'],
    reason: 'Operator requested lane-scoped containment.',
    createdAtUtc: '2026-09-24T15:00:00.000Z',
    ...patch,
  };
}

function ownerComment(payload, patch = {}) {
  return {
    id: patch.id ?? 100,
    user: { login: patch.login ?? 'Cheekyfellastef' },
    authorAssociation: patch.authorAssociation ?? 'OWNER',
    createdAt: patch.createdAt ?? '2026-09-24T15:00:01.000Z',
    body: patch.body ?? body(payload),
  };
}

function evaluate(comments) {
  return evaluateOperatorLaneContainmentV1({
    comments,
    repository: REPO,
    prNumber: 2000,
    branch: BRANCH,
    trustedOperatorLogin: 'Cheekyfellastef',
  });
}

test('trusted owner STOP creates durable lane-scoped containment', () => {
  const result = evaluate([ownerComment(command())]);
  assert.equal(result.active, true);
  assert.equal(result.action, 'STOP');
  assert.equal(result.frozenHead, HEAD);
  assert.equal(result.sourceMutationAllowed, false);
  assert.equal(result.reconciliationAllowed, false);
  assert.equal(result.reviewDispatchAllowed, false);
  assert.equal(result.providerDispatchAllowed, false);
  assert.equal(result.eventContinuationAllowed, false);
  assert.equal(result.unrelatedWorkAllowed, true);
});

test('STOP remains active when the observed PR head later moves', () => {
  const result = evaluate([ownerComment(command())]);
  assert.equal(result.active, true);
  assert.equal(result.frozenHead, HEAD);
  assert.equal(result.finalVerdict, 'OPERATOR_LANE_CONTAINED');
});

test('later trusted RESUME clears containment without granting authority', () => {
  const stop = ownerComment(command(), { id: 100, createdAt: '2026-09-24T15:00:01.000Z' });
  const resume = ownerComment(command({
    commandId: 'containment-example-0002',
    action: 'RESUME',
    frozenHead: '',
    reason: 'Operator explicitly resumed the lane.',
    createdAtUtc: '2026-09-24T15:10:00.000Z',
  }), { id: 101, createdAt: '2026-09-24T15:10:01.000Z' });
  const result = evaluate([stop, resume]);
  assert.equal(result.active, false);
  assert.equal(result.action, 'RESUME');
  assert.equal(result.sourceMutationAllowed, false);
  assert.equal(result.mergeAllowed, false);
});

test('GitHub comment ordering wins over caller-controlled command timestamp ordering', () => {
  const stop = ownerComment(command({
    createdAtUtc: '2026-09-24T15:04:00.000Z',
  }), { id: 100, createdAt: '2026-09-24T15:00:01.000Z' });
  const resume = ownerComment(command({
    commandId: 'containment-example-0002',
    action: 'RESUME',
    frozenHead: '',
    reason: 'Operator explicitly resumed the lane.',
    createdAtUtc: '2026-09-24T15:01:00.000Z',
  }), { id: 101, createdAt: '2026-09-24T15:10:01.000Z' });
  const result = evaluate([stop, resume]);
  assert.equal(result.active, false);
  assert.equal(result.action, 'RESUME');
});

test('untrusted actor cannot stop or resume an operator lane', () => {
  const result = evaluate([ownerComment(command(), { login: 'someone-else', authorAssociation: 'MEMBER' })]);
  assert.equal(result.active, false);
  assert.equal(result.action, '');
});

test('trusted malformed containment evidence fails the affected lane closed', () => {
  const fence = String.fromCharCode(96).repeat(3);
  const malformed = ownerComment(command(), {
    body: fence + 'stephanos-operator-lane-containment-v1\n{not-json}\n' + fence,
  });
  const result = evaluate([malformed]);
  assert.equal(result.active, true);
  assert.equal(result.action, 'SAFE_HOLD');
  assert.equal(result.finalVerdict, 'OPERATOR_LANE_CONTAINMENT_EVIDENCE_INVALID_SAFE_HOLD');
});

test('target mismatch is ignored rather than freezing an unrelated lane', () => {
  const result = evaluate([ownerComment(command({ prNumber: 1999 }))]);
  assert.equal(result.active, false);
});

test('STOP requires exact frozen head and bounded resources', () => {
  const noHead = validateOperatorLaneContainmentCommandV1(command({ frozenHead: '' }), {
    repository: REPO,
    prNumber: 2000,
    branch: BRANCH,
  });
  assert.equal(noHead.valid, false);
  assert.equal(noHead.blocker, 'CONTAINMENT_FROZEN_HEAD_REQUIRED');

  const noResources = validateOperatorLaneContainmentCommandV1(command({ resourceIds: [] }), {
    repository: REPO,
    prNumber: 2000,
    branch: BRANCH,
  });
  assert.equal(noResources.valid, false);
  assert.equal(noResources.blocker, 'CONTAINMENT_RESOURCE_SCOPE_REQUIRED');
});

test('integration surfaces consume the canonical containment contract', async () => {
  const files = {
    review: await fs.readFile(new URL('./exactHeadReviewDispatchCoordinator.mjs', import.meta.url), 'utf8'),
    capacity: await fs.readFile(new URL('./missionControllerCapacityRouterV1.mjs', import.meta.url), 'utf8'),
    evidence: await fs.readFile(new URL('../../stephanos-server/services/githubPrEvidenceService.js', import.meta.url), 'utf8'),
    admission: await fs.readFile(new URL('../../stephanos-server/services/elasticGoalMissionAdmissionService.js', import.meta.url), 'utf8'),
  };
  assert.match(files.review, /operatorContainment/);
  assert.match(files.capacity, /operatorContainment/);
  assert.match(files.evidence, /operatorLaneContainment/);
  assert.match(files.admission, /operatorLaneContainment/);
});
