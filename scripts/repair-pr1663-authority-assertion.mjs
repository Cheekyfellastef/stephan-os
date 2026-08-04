#!/usr/bin/env node

import fs from 'node:fs';

const path = 'shared/agents/exactHeadReviewDispatchCoordinator.test.mjs';
const source = fs.readFileSync(path, 'utf8');

const before = `  assert.match(runner, /bounded GitHub token actor must match trusted coordinator/);
  assert.match(runner, /trustedCoordinatorLogin:\\s*coordinatorLogin/);
  assert.match(runner, /parseOptionalManualPrNumber\\(process\\.env\\.STEPHANOS_EXACT_HEAD_REVIEW_PR\\)/);
  assert.match(runner, /const numbers = \\(await listOpenPullRequests/);
  assert.match(runner, /REQUESTED_PR_NOT_CANONICAL/);
  assert.match(runner, /GitHub pagination exceeded.*refusing partial evidence/);
  assert.match(workflow, /STEPHANOS_REVIEW_COORDINATOR_LOGIN:\\s*\\$\\{\\{ github\\.repository_owner \\}\\}/);
  assert.match(workflow, /STEPHANOS_REVIEW_DISPATCH_TOKEN:\\s*\\$\\{\\{ secrets\\.STEPHANOS_REVIEW_DISPATCH_TOKEN \\}\\}/);
  assert.doesNotMatch(workflow, /\\|\\|\\s*github\\.token/);`;

const after = `  assert.match(runner, /bounded GitHub token actor is not authorised/);
  assert.match(runner, /selectReviewCoordinatorCredential\\(process\\.env\\)/);
  assert.match(runner, /const laneAuthorityLogin = trustedLaneAuthorityLogin\\(owner\\)/);
  assert.match(runner, /trustedCoordinatorLogin:\\s*MACHINE_COORDINATOR_SENTINEL_LOGIN/);
  assert.match(runner, /parseOptionalManualPrNumber\\(process\\.env\\.STEPHANOS_EXACT_HEAD_REVIEW_PR\\)/);
  assert.match(runner, /const numbers = \\(await listOpenPullRequests/);
  assert.match(runner, /REQUESTED_PR_NOT_CANONICAL/);
  assert.match(runner, /GitHub pagination exceeded.*refusing partial evidence/);
  assert.match(workflow, /GITHUB_TOKEN:\\s*\\$\\{\\{ github\\.token \\}\\}/);
  assert.match(workflow, /STEPHANOS_REVIEW_LANE_AUTHORITY_LOGIN:\\s*\\$\\{\\{ github\\.repository_owner \\}\\}/);
  assert.match(workflow, /STEPHANOS_REVIEW_DISPATCH_TOKEN:\\s*\\$\\{\\{ secrets\\.STEPHANOS_REVIEW_DISPATCH_TOKEN \\}\\}/);
  assert.doesNotMatch(workflow, /STEPHANOS_REVIEW_DISPATCH_TOKEN:[^\\n]*\\|\\|/);`;

const occurrences = source.split(before).length - 1;
if (occurrences !== 1) {
  throw new Error(`expected exactly one stale authority assertion block, found ${occurrences}`);
}

const repaired = source.replace(before, after);
fs.writeFileSync(path, repaired, 'utf8');
console.log('PR1663_AUTHORITY_ASSERTION_REPAIRED=true');
