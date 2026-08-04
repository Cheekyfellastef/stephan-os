import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REVIEW_COORDINATOR_CREDENTIAL_SOURCE,
  selectReviewCoordinatorCredential,
} from './exactHeadReviewCoordinatorAuthority.mjs';

test('trusted GitHub Actions token cannot be masked by an optional owner secret', () => {
  const credential = selectReviewCoordinatorCredential({
    GITHUB_ACTIONS: 'true',
    GITHUB_TOKEN: 'repository-token',
    STEPHANOS_REVIEW_DISPATCH_TOKEN: 'configured-but-unusable-owner-secret',
    GH_TOKEN: 'fallback-gh-token',
  });

  assert.deepEqual(credential, {
    token: 'repository-token',
    source: REVIEW_COORDINATOR_CREDENTIAL_SOURCE.GITHUB_ACTIONS,
  });
});

test('owner secret remains preferred outside the trusted GitHub Actions boundary', () => {
  const credential = selectReviewCoordinatorCredential({
    GITHUB_ACTIONS: 'false',
    GITHUB_TOKEN: 'repository-token',
    STEPHANOS_REVIEW_DISPATCH_TOKEN: 'owner-secret',
  });

  assert.deepEqual(credential, {
    token: 'owner-secret',
    source: REVIEW_COORDINATOR_CREDENTIAL_SOURCE.OWNER_SECRET,
  });
});

test('repository token remains the fallback when no owner secret exists', () => {
  const credential = selectReviewCoordinatorCredential({
    GITHUB_TOKEN: 'repository-token',
  });

  assert.deepEqual(credential, {
    token: 'repository-token',
    source: REVIEW_COORDINATOR_CREDENTIAL_SOURCE.GITHUB_ACTIONS,
  });
});

test('missing coordinator credentials fail closed', () => {
  const credential = selectReviewCoordinatorCredential({});

  assert.deepEqual(credential, {
    token: '',
    source: REVIEW_COORDINATOR_CREDENTIAL_SOURCE.NONE,
  });
});
