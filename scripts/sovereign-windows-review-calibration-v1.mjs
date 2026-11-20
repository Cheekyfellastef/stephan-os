#!/usr/bin/env node
// Independently protected installed-parent entry. Candidate engines are never
// imported from mutable paths before the exact-commit loader authenticates them.
import { fileURLToPath } from 'node:url';
import { runFixedSovereignReviewEntryV1 } from './sovereign-high-risk-advisory-launcher-v1.mjs';
export function runWindowsCalibrationCandidateV1(env=process.env) {
  return runFixedSovereignReviewEntryV1('windows-calibration', {env});
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const remote=process.argv.length===3 && process.argv[2]==='--commander-once';
  const result=remote ? runFixedSovereignReviewEntryV1('windows-calibration-remote')
    : process.argv.length===3 && process.argv[2]==='--once'
      ? runWindowsCalibrationCandidateV1() : {status:'WINDOWS_CALIBRATION_HELD',reason:'FIXED_ONCE_ONLY',mergeAuthority:false};
  process.stdout.write((remote?'SOVEREIGN_WINDOWS_CALIBRATION_REMOTE_RESULT=':'SOVEREIGN_WINDOWS_CALIBRATION_RESULT=')+JSON.stringify(result)+'\n');
  if(result.status==='WINDOWS_CALIBRATION_HELD')process.exitCode=2;
}
