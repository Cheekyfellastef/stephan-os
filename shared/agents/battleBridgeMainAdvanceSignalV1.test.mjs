import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  BATTLE_BRIDGE_EXPRESS_SYNC_INTERVAL_MINUTES,
  createBattleBridgeMainAdvanceSignal,
  validateBattleBridgeMainAdvanceSignal,
} from './battleBridgeMainAdvanceSignalV1.mjs';
import { CANONICAL_MAILBOX_ISSUE } from './canonicalMailboxAuthorityV1.mjs';

const HEAD = 'a'.repeat(40);
const MERGED_AT = '2026-08-18T10:45:00Z';

function validSignal(overrides = {}) {
  return createBattleBridgeMainAdvanceSignal({
    prNumber: 1877,
    mainHead: HEAD,
    mergedAtUtc: MERGED_AT,
    workflowRunId: '32000000001',
    ...overrides,
  });
}

test('main advance signal is exact-head, signal-only and grants no mutation authority', () => {
  const signal = validSignal();
  assert.equal(signal.repository, 'Cheekyfellastef/stephan-os');
  assert.equal(signal.issueNumber, CANONICAL_MAILBOX_ISSUE);
  assert.equal(signal.branch, 'main');
  assert.equal(signal.event, 'PULL_REQUEST_MERGED');
  assert.equal(signal.mainHead, HEAD);
  assert.equal(signal.mergedAtUtc, '2026-08-18T10:45:00.000Z');
  assert.equal(signal.syncIntervalMinutes, 1);
  assert.equal(signal.signalOnly, true);
  assert.equal(signal.syncAuthorityGranted, false);
  assert.equal(signal.runtimeMutationAuthorityGranted, false);
  assert.equal(signal.arbitraryShellAllowed, false);
  assert.equal(signal.destructiveGitAllowed, false);
  assert.deepEqual(signal.lifecycle, [
    'MERGED',
    'SIGNAL_SENT',
    'SYNC_OBSERVED',
    'SAFE_FF_APPLIED_OR_BLOCKED',
    'POST_SYNC_REFRESH',
    'EXACT_HEAD_RUNTIME_PROVED',
  ]);
  assert.equal(validateBattleBridgeMainAdvanceSignal({ ...signal }).ok, true);
});

test('signal validation accepts GitHub second-resolution UTC and fails closed on invalid identity or extras', () => {
  assert.equal(validSignal({ mergedAtUtc: '2026-08-18T10:45:00Z' }).mergedAtUtc, '2026-08-18T10:45:00.000Z');
  assert.equal(validSignal({ mergedAtUtc: '2026-08-18T10:45:00.123Z' }).mergedAtUtc, '2026-08-18T10:45:00.123Z');
  assert.throws(() => validSignal({ mergedAtUtc: '2026-08-18 10:45:00Z' }), /MAIN_ADVANCE_MERGED_AT_INVALID/);
  assert.throws(() => validSignal({ repository: 'other/repo' }), /MAIN_ADVANCE_REPOSITORY_INVALID/);
  assert.throws(() => validSignal({ branch: 'feature' }), /MAIN_ADVANCE_BRANCH_INVALID/);
  assert.throws(() => validSignal({ mainHead: 'abc' }), /MAIN_ADVANCE_HEAD_INVALID/);
  const signal = validSignal();
  assert.equal(validateBattleBridgeMainAdvanceSignal({ ...signal, command: 'git reset --hard HEAD' }).ok, false);
  assert.equal(validateBattleBridgeMainAdvanceSignal({ ...signal, syncAuthorityGranted: true }).ok, false);
});

test('GitHub workflow only signals merged PRs into main with a bounded publisher', () => {
  const workflow = readFileSync('.github/workflows/battle-bridge-main-advance-express-sync-v1.yml', 'utf8');
  assert.match(workflow, /pull_request_target:\s*\n\s*types: \[closed\]/);
  assert.match(workflow, /github\.event\.pull_request\.merged == true/);
  assert.match(workflow, /github\.event\.pull_request\.base\.ref == 'main'/);
  assert.match(workflow, /issues: write/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /STEPHANOS_MAIN_ADVANCE_HEAD: \$\{\{ github\.event\.pull_request\.merge_commit_sha \}\}/);
  assert.match(workflow, /node scripts\/publish-battle-bridge-main-advance-signal\.mjs/);
  assert.doesNotMatch(workflow, /^\s*pull_request:/m);
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
  assert.doesNotMatch(workflow, /ref:.*github\.event\.pull_request\.(?:head|merge_commit_sha)/);
  assert.doesNotMatch(workflow, /workflow_dispatch:/);
});

test('main signal uses protected default-branch code and bounded post-merge data only', () => {
  const workflow = readFileSync('.github/workflows/battle-bridge-main-advance-express-sync-v1.yml', 'utf8');
  assert.match(workflow, /^permissions: \{\}$/m);
  assert.match(workflow, /if: \$\{\{ github\.event\.pull_request\.merged == true && github\.event\.pull_request\.base\.ref == 'main' \}\}/);
  assert.equal((workflow.match(/uses: actions\/checkout@v4/g) || []).length, 1);
  assert.equal((workflow.match(/ref: \$\{\{ github\.sha \}\}/g) || []).length, 1);
  assert.match(workflow, /contents: read/);
  assert.doesNotMatch(workflow, /contents: write|pull-requests: write|id-token: write|secrets\./);
  assert.match(workflow, /STEPHANOS_MAIN_ADVANCE_PR: \$\{\{ github\.event\.pull_request\.number \}\}/);
  assert.match(workflow, /STEPHANOS_MAIN_ADVANCE_MERGED_AT: \$\{\{ github\.event\.pull_request\.merged_at \}\}/);
  assert.doesNotMatch(workflow, /run:.*\$\{\{.*pull_request/);
  assert.match(workflow, /timeout-minutes: 5/);
});

test('existing bounded GitHub Sync becomes a one-minute near-real-time fallback without new Git authority', () => {
  const installer = readFileSync('scripts/windows/install-battle-bridge-github-sync.ps1', 'utf8');
  assert.equal(BATTLE_BRIDGE_EXPRESS_SYNC_INTERVAL_MINUTES, 1);
  assert.match(installer, /RepetitionInterval \(New-TimeSpan -Minutes 1\)/);
  assert.match(installer, /intervalMinutes = 1/);
  assert.match(installer, /MultipleInstances IgnoreNew/);
  assert.match(installer, /RunLevel Limited/);
  assert.match(installer, /fast-forwards only the canonical stephan-os main checkout every minute/);
  assert.doesNotMatch(installer, /git reset --hard|git clean|git stash|git rebase|git push/i);
  assert.doesNotMatch(installer, /OpenClaw.*updateAllowed = \$true/i);
});
