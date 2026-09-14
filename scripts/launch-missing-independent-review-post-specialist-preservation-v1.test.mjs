import assert from 'node:assert/strict';
import test from 'node:test';

import { selectExactPostSpecialistReviewV1 } from './launch-missing-independent-review-v1.mjs';

const REVIEWED_HEAD = 'c'.repeat(40);
const REVIEWED_BASE = '6'.repeat(40);
const CURRENT_HEAD = '4'.repeat(40);
const CURRENT_BASE = '9'.repeat(40);

const preservedReview = {
  id: 5198433717,
  user: { login: 'Cheekyfellastef', id: 267490109 },
  author_association: 'OWNER',
  state: 'COMMENTED',
  commit_id: REVIEWED_HEAD,
  body: [
    'Exact-head Windows authority specialist review for PR #2222 “Repair Mission Worker watchdog restart proof”, bound to head `' + REVIEWED_HEAD + '` and base `' + REVIEWED_BASE + '`.',
    '',
    'Specialist verdict: CLEAN for the Windows authority surface. P0: 0, P1: 0, P2: 0 unresolved. This is review only and grants no merge or runtime authority.',
  ].join('\n'),
};

test('preservation convergence may reuse clean specialist evidence only with explicit exact lineage proof', () => {
  const selected = selectExactPostSpecialistReviewV1([preservedReview], {
    prNumber: 2222,
    sourceHead: CURRENT_HEAD,
    baseSha: CURRENT_BASE,
    preservation: {
      reviewedHead: REVIEWED_HEAD,
      reviewedBase: REVIEWED_BASE,
      currentHead: CURRENT_HEAD,
      currentBase: CURRENT_BASE,
      currentHeadParents: [REVIEWED_HEAD, CURRENT_BASE],
      featureBlobsPreserved: true,
      sourceEstateUnchanged: true,
    },
  });

  assert.equal(selected, preservedReview);
});

test('preservation convergence stays fail closed without exact parent and blob preservation proof', () => {
  const selected = selectExactPostSpecialistReviewV1([preservedReview], {
    prNumber: 2222,
    sourceHead: CURRENT_HEAD,
    baseSha: CURRENT_BASE,
    preservation: {
      reviewedHead: REVIEWED_HEAD,
      reviewedBase: REVIEWED_BASE,
      currentHead: CURRENT_HEAD,
      currentBase: CURRENT_BASE,
      currentHeadParents: [REVIEWED_HEAD, '8'.repeat(40)],
      featureBlobsPreserved: false,
      sourceEstateUnchanged: false,
    },
  });

  assert.equal(selected, null);
});
