#!/usr/bin/env node
// Fixed, read-only coverage intake in the existing Sovereign Reviewer lane.
// Never emits raw source/diff, never enrolls a specialist, and never dispatches.
import { fileURLToPath } from 'node:url';
import { captureHighRiskAdvisorySnapshotV1 } from './sovereign-high-risk-advisory-v1.mjs';
import { assessSovereignReviewCoverageV1 } from '../shared/agents/sovereignReviewCoverageV1.mjs';

const held = reason => Object.freeze({
  schemaVersion:'stephanos.sovereign-review-coverage.v1',
  status:'REVIEW_COVERAGE_HELD', reason,
  meteredReviewReplacementQualified:false,
  protectedMergeAuthority:false, reviewerEnrollmentAuthority:false,
  originalLeaseReleaseAuthority:false,
});

export function runSovereignReviewCoverageV1(env=process.env,{
  snapshot=captureHighRiskAdvisorySnapshotV1,
}={}) {
  try {
    const source=snapshot(env);
    // The source snapshot itself proves clean exact local HEAD, branch, base
    // ancestry and complete changed-path list, but it does NOT qualify a review.
    return assessSovereignReviewCoverageV1(source);
  } catch {
    return held('EXACT_LOCAL_REVIEW_SOURCE_UNVERIFIED');
  }
}
