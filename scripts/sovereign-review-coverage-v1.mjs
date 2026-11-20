#!/usr/bin/env node
// Independently protected installed-parent entry. Candidate engines are never
// imported from mutable paths before the exact-commit loader authenticates them.
import { fileURLToPath } from 'node:url';
import { runFixedSovereignReviewEntryV1 } from './sovereign-high-risk-advisory-launcher-v1.mjs';
export function runSovereignReviewCoverageV1(env=process.env) {
  return runFixedSovereignReviewEntryV1('coverage', {env});
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const result=process.argv.length===3 && process.argv[2]==='--once'
    ? runSovereignReviewCoverageV1() : {status:'REVIEW_COVERAGE_HELD',reason:'FIXED_ONCE_ONLY',mergeAuthority:false};
  process.stdout.write('SOVEREIGN_REVIEW_COVERAGE_RESULT='+JSON.stringify(result)+'\n');
  if(result.status==='REVIEW_COVERAGE_HELD')process.exitCode=2;
}
