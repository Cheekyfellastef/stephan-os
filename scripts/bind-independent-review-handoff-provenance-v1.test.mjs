import assert from 'node:assert/strict';
import test from 'node:test';

import {
  selectExactReviewDispatchCommentV1,
} from './bind-independent-review-handoff-provenance-v1.mjs';

const HEAD = 'a'.repeat(40);
const OTHER_HEAD = 'b'.repeat(40);
const marker = (head) => `<!-- stephanos:exact-head-review-dispatch:v1 head=${head} -->`;

function handoff({ id = 101, head = HEAD, login = 'github-actions[bot]', actorId = 41898282, title = true } = {}) {
  return {
    id,
    user: { login, id: actorId },
    body: `${marker(head)}\n${title ? '## Provider-neutral exact-head review handoff' : '## Something else'}\n`,
  };
}

test('selects exactly one trusted existing exact-head handoff', () => {
  const selected = selectExactReviewDispatchCommentV1([
    handoff({ id: 99, head: OTHER_HEAD }),
    handoff({ id: 101 }),
  ], { sourceHead: HEAD });

  assert.equal(selected.id, 101);
});

test('rejects missing, duplicate, wrong-actor and malformed handoffs', () => {
  assert.throws(
    () => selectExactReviewDispatchCommentV1([], { sourceHead: HEAD }),
    /count must be one, observed 0/,
  );
  assert.throws(
    () => selectExactReviewDispatchCommentV1([handoff({ id: 101 }), handoff({ id: 102 })], { sourceHead: HEAD }),
    /count must be one, observed 2/,
  );
  assert.throws(
    () => selectExactReviewDispatchCommentV1([handoff({ login: 'Cheekyfellastef' })], { sourceHead: HEAD }),
    /count must be one, observed 0/,
  );
  assert.throws(
    () => selectExactReviewDispatchCommentV1([handoff({ actorId: 1 })], { sourceHead: HEAD }),
    /count must be one, observed 0/,
  );
  assert.throws(
    () => selectExactReviewDispatchCommentV1([handoff({ title: false })], { sourceHead: HEAD }),
    /count must be one, observed 0/,
  );
  assert.throws(
    () => selectExactReviewDispatchCommentV1([handoff()], { sourceHead: 'not-a-sha' }),
    /source head is required/,
  );
});
