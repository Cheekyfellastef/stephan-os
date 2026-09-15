import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  CODEX_REVIEW_CAPACITY_STATE,
  CODEX_REVIEW_FAILOVER_ROUTE,
  classifyCodexReviewCapacityFailoverV1,
} from './codexReviewCapacityFailoverV1.mjs';

const QUOTA_BODY = 'You have reached your Codex usage limits for code reviews. You can see your limits in the Codex usage dashboard.\nTo continue using code reviews, you can upgrade your account or add credits to your account and enable them for code reviews in your settings.';
const TRUSTED_CODEX_REVIEWER = Object.freeze({
  login: 'chatgpt-codex-connector[bot]',
  type: 'Bot',
  id: 199175422,
});

function quotaEvent(overrides = {}) {
  return {
    action: 'created',
    issue: {
      number: 1969,
      pull_request: { url: 'https://api.github.com/repos/Cheekyfellastef/stephan-os/pulls/1969' },
    },
    comment: {
      id: 5383393730,
      body: QUOTA_BODY,
      user: TRUSTED_CODEX_REVIEWER,
    },
    ...overrides,
  };
}

test('classifies the real PR 1969 Codex review quota notice as provider capacity unavailable', () => {
  const result = classifyCodexReviewCapacityFailoverV1(quotaEvent());
  assert.equal(result.detected, true);
  assert.equal(result.capacityState, CODEX_REVIEW_CAPACITY_STATE.UNAVAILABLE);
  assert.equal(result.selectedRoute, CODEX_REVIEW_FAILOVER_ROUTE);
  assert.equal(result.routingDisposition, 'CONTINUE_PROVIDER_NEUTRAL_REVIEW');
  assert.equal(result.commentId, 5383393730);
  assert.equal(result.prNumber, 1969);
  assert.equal(result.reviewEvidence, false);
  assert.equal(result.reviewAcceptanceAllowed, false);
  assert.equal(result.duplicateDispatchAllowed, false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.runtimeMutationAuthority, false);
});

test('quota telemetry can never become review evidence even if the body contains a reviewed head', () => {
  const result = classifyCodexReviewCapacityFailoverV1(quotaEvent({
    comment: {
      ...quotaEvent().comment,
      body: `${QUOTA_BODY}\n\nReviewed commit: ${'a'.repeat(40)}`,
    },
  }));
  assert.equal(result.detected, true);
  assert.equal(result.reviewEvidence, false);
  assert.equal(result.reviewAcceptanceAllowed, false);
  assert.equal(result.sameHeadRequired, true);
});

test('forged actor, non-PR issue and ordinary review do not trigger provider failover', () => {
  for (const event of [
    quotaEvent({ comment: { ...quotaEvent().comment, user: { ...TRUSTED_CODEX_REVIEWER, id: 7 } } }),
    quotaEvent({ comment: { ...quotaEvent().comment, user: { ...TRUSTED_CODEX_REVIEWER, login: 'fake-codex[bot]' } } }),
    quotaEvent({ issue: { number: 1969 } }),
    quotaEvent({ comment: { ...quotaEvent().comment, body: `Codex Review: no major issues. Reviewed commit: ${'a'.repeat(40)}` } }),
  ]) {
    const result = classifyCodexReviewCapacityFailoverV1(event);
    assert.equal(result.detected, false);
    assert.equal(result.capacityState, CODEX_REVIEW_CAPACITY_STATE.NO_SIGNAL);
    assert.equal(result.selectedRoute, null);
  }
});

test('exact-head workflow routes PR issue comments through failover classification before the existing coordinator', () => {
  const workflow = fs
    .readFileSync(new URL('../../.github/workflows/exact-head-review-dispatch.yml', import.meta.url), 'utf8')
    .replace(/\r\n?/g, '\n');
  assert.match(workflow, /issue_comment:\n    types:\n      - created/);
  assert.match(workflow, /Classify trusted Codex review-capacity outage/);
  assert.match(workflow, /node shared\/agents\/codexReviewCapacityFailoverV1\.mjs/);
  const classifierIndex = workflow.indexOf('Classify trusted Codex review-capacity outage');
  const plannerIndex = workflow.indexOf('Discover canonical PR targets without mutation');
  assert.ok(classifierIndex > 0 && plannerIndex > classifierIndex);
  assert.match(workflow, /run: node scripts\/exact-head-review-dispatch\.mjs/);
  assert.match(workflow, /Launch one exact missing canonical independent review/);
  assert.doesNotMatch(workflow, /@codex review/);
});
