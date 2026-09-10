import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PROTECTED_READY_CLIENT_FAULT,
  PROTECTED_READY_EXECUTION_ROUTE,
  classifyProtectedReadyClientFault,
  planProtectedReadyExecutionRoute,
} from './protectedReadyExecutionRouteV1.mjs';

const identity = Object.freeze({
  repository: 'Cheekyfellastef/stephan-os',
  prNumber: 2091,
  branch: 'agent/source-artifact-escrow-failover-v1',
  head: '0'.repeat(40),
  headTree: '1'.repeat(40),
  base: '2'.repeat(40),
  readyTransitionAuthorized: true,
  exactHeadReviewClean: true,
  unresolvedReviewThreads: 0,
  protectedMailboxAvailable: true,
});

const connectorSchemaFailure = Object.freeze({
  path: ['mutation', 'markPullRequestReadyForReview', 'pullRequest', 'headRepository', 'fullDatabaseId'],
  extensions: { code: 'undefinedField', typeName: 'Repository', fieldName: 'fullDatabaseId' },
  message: "Field 'fullDatabaseId' doesn't exist on type 'Repository'",
});

test('classifies the recurring connected-client fullDatabaseId GraphQL schema failure', () => {
  assert.equal(
    classifyProtectedReadyClientFault(connectorSchemaFailure),
    PROTECTED_READY_CLIENT_FAULT.FULL_DATABASE_ID_SCHEMA,
  );
});

test('authorized ready transition routes through the canonical protected mailbox instead of retrying the broken client mutation', () => {
  const result = planProtectedReadyExecutionRoute({
    ...identity,
    clientMutationFailure: connectorSchemaFailure,
  });

  assert.equal(result.route, PROTECTED_READY_EXECUTION_ROUTE.PROTECTED_MAILBOX);
  assert.equal(result.operation, 'MARK_PROTECTED_PR_READY');
  assert.equal(result.mode, 'user-owned-pr-ready');
  assert.equal(result.issueNumber, 1507);
  assert.equal(result.clientMutationFault, PROTECTED_READY_CLIENT_FAULT.FULL_DATABASE_ID_SCHEMA);
  assert.equal(result.clientMutationSuppressed, true);
  assert.equal(result.retryClientMutation, false);
  assert.equal(result.usesCanonicalProtectedMailbox, true);
  assert.equal(result.requiresCurrentMainReread, true);
  assert.equal(result.requiresExactPrReread, true);
  assert.equal(result.requiresPostMutationIdentityReread, true);
  assert.equal(result.arbitraryGraphqlAllowed, false);
  assert.equal(result.callerSuppliedGraphqlAllowed, false);
  assert.equal(result.mergeAuthority, false);
});

test('canonical protected mailbox remains preferred even when the client mutation has not failed yet', () => {
  const result = planProtectedReadyExecutionRoute(identity);
  assert.equal(result.route, PROTECTED_READY_EXECUTION_ROUTE.PROTECTED_MAILBOX);
  assert.equal(result.clientMutationFault, PROTECTED_READY_CLIENT_FAULT.NONE);
  assert.equal(result.clientMutationSuppressed, true);
  assert.equal(result.retryClientMutation, false);
});

test('missing operator authority fails closed before any ready mutation route is exposed', () => {
  const result = planProtectedReadyExecutionRoute({
    ...identity,
    readyTransitionAuthorized: false,
    clientMutationFailure: connectorSchemaFailure,
  });
  assert.equal(result.route, PROTECTED_READY_EXECUTION_ROUTE.HOLD);
  assert.equal(result.blocker, 'PROTECTED_READY_OPERATOR_AUTHORIZATION_REQUIRED');
  assert.equal(result.retryClientMutation, false);
});

test('review uncertainty or unresolved threads fail closed', () => {
  const dirtyReview = planProtectedReadyExecutionRoute({ ...identity, exactHeadReviewClean: false });
  assert.equal(dirtyReview.route, PROTECTED_READY_EXECUTION_ROUTE.HOLD);
  assert.equal(dirtyReview.blocker, 'PROTECTED_READY_REVIEW_NOT_CLEAN');

  const unresolved = planProtectedReadyExecutionRoute({ ...identity, unresolvedReviewThreads: 1 });
  assert.equal(unresolved.route, PROTECTED_READY_EXECUTION_ROUTE.HOLD);
  assert.equal(unresolved.blocker, 'PROTECTED_READY_REVIEW_NOT_CLEAN');

  const unknownThreads = { ...identity };
  delete unknownThreads.unresolvedReviewThreads;
  const unknown = planProtectedReadyExecutionRoute(unknownThreads);
  assert.equal(unknown.route, PROTECTED_READY_EXECUTION_ROUTE.HOLD);
  assert.equal(unknown.blocker, 'PROTECTED_READY_REVIEW_NOT_CLEAN');
});

test('mailbox outage does not fall back to the raw client GraphQL mutation', () => {
  const result = planProtectedReadyExecutionRoute({
    ...identity,
    protectedMailboxAvailable: false,
    clientMutationFailure: connectorSchemaFailure,
  });
  assert.equal(result.route, PROTECTED_READY_EXECUTION_ROUTE.HOLD);
  assert.equal(result.blocker, 'PROTECTED_READY_MAILBOX_UNAVAILABLE');
  assert.equal(result.clientMutationSuppressed, true);
  assert.equal(result.retryClientMutation, false);
});

test('already-ready exact PR is idempotent and requires no mutation', () => {
  const result = planProtectedReadyExecutionRoute({
    ...identity,
    alreadyReady: true,
    readyTransitionAuthorized: false,
    protectedMailboxAvailable: false,
  });
  assert.equal(result.route, PROTECTED_READY_EXECUTION_ROUTE.ALREADY_READY);
  assert.equal(result.mutationRequired, false);
  assert.equal(result.retryClientMutation, false);
});

test('identity drift or malformed identity fails closed', () => {
  for (const invalid of [
    { ...identity, repository: 'other/repo' },
    { ...identity, prNumber: 0 },
    { ...identity, branch: '../unsafe' },
    { ...identity, head: 'bad' },
    { ...identity, headTree: 'bad' },
    { ...identity, base: 'bad' },
  ]) {
    const result = planProtectedReadyExecutionRoute(invalid);
    assert.equal(result.route, PROTECTED_READY_EXECUTION_ROUTE.HOLD);
    assert.equal(result.retryClientMutation, false);
  }
});
