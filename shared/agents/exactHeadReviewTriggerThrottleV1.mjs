// Read-only review-planner admission. This does not approve a review,
// mutate a PR, or change an existing GitHub Actions workflow.
import { EXACT_HEAD_DISCOVERY_WINDOW_MS } from './exactHeadReviewDiscoveryWindowV1.mjs';

export const EXACT_HEAD_REVIEW_THROTTLE_SCHEMA = 'stephanos.exact-head-review-trigger-throttle.v1';
export const TRUSTED_INDEPENDENT_SECURITY_WORKFLOW_ID = 318073448;

const held = (reason) => Object.freeze({
  schemaVersion: EXACT_HEAD_REVIEW_THROTTLE_SCHEMA,
  allowDiscovery: false,
  reason,
  reviewAuthority: false,
  mergeAuthority: false,
  apiCallsAllowed: false,
});
const permit = (reason) => Object.freeze({
  schemaVersion: EXACT_HEAD_REVIEW_THROTTLE_SCHEMA,
  allowDiscovery: true,
  reason,
  reviewAuthority: false,
  mergeAuthority: false,
  apiCallsAllowed: true,
});

export function admitExactHeadReviewTriggerV1({
  eventName,
  event = {},
  nowMs = Date.now(),
  planOnly = false,
  manuallyRequestedPr = false,
} = {}) {
  if (!planOnly) return permit('PR_SCOPED_COORDINATOR_PATH_NOT_THROTTLED');
  if (manuallyRequestedPr) return permit('EXPLICIT_EXACT_PR_REQUEST');
  if (eventName === 'schedule') {
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) {
      return held('REVIEW_DISCOVERY_CLOCK_UNVERIFIED');
    }
    // The existing workflow fires every five minutes. Do not start the
    // expensive GitHub PR-estate scan outside one five-minute window per
    // quarter-hour. An occasional delayed run may be held until the next
    // window; this never converts a held review into an approval.
    const elapsed = nowMs % EXACT_HEAD_DISCOVERY_WINDOW_MS;
    if (elapsed >= 5 * 60_000) return held('REVIEW_DISCOVERY_SCHEDULE_COOLDOWN');
    return permit('BOUNDED_15_MINUTE_SCHEDULED_RESCUE');
  }
  if (eventName === 'workflow_run') {
    const run = event?.workflow_run;
    if (!run || typeof run !== 'object'
      || run.id == null
      || !Number.isSafeInteger(Number(run.id))
      || Number(run.id) <= 0
      || Number(run.workflow_id) !== TRUSTED_INDEPENDENT_SECURITY_WORKFLOW_ID
      || run.name !== 'Independent Merge Security Review'
      || run.conclusion !== 'success'
      || run.status !== 'completed') {
      return held('NON_QUALIFIED_WORKFLOW_COMPLETION');
    }
    // The existing coordinator separately verifies the exact independent
    // artifact and its immutable run ID. This is only a load-admission hint.
    return permit('QUALIFIED_INDEPENDENT_REVIEW_EVENT');
  }
  return permit('DIRECT_EVENT_PRESERVED');
}
