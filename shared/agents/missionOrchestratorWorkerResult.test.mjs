import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMissionEventFromWorkerResult } from './missionOrchestratorWorkerResult.mjs';

const hash = 'a'.repeat(64);
function action(operation) {
  return { actionKind: 'signed-openclaw-operation', actionId: `mission-r1-${operation}`, operation, receiptRequirement: `signed ${operation}` };
}
function execution(success = true) {
  return { success, commandOutputHash: hash, completedAt: '2026-06-24T22:45:00.000Z' };
}

test('maps worktree, commit, push, PR, checks, and merge receipts to canonical events', () => {
  assert.equal(buildMissionEventFromWorkerResult(action('create-worktree'), execution(), { worktreePath: 'C:\\worktree', clean: true }).eventType, 'WORKTREE_READY');
  const commit = buildMissionEventFromWorkerResult(action('commit'), execution(), { commitSha: 'b'.repeat(40), clean: true });
  assert.equal(commit.operation, 'commit');
  assert.equal(commit.commitSha, 'b'.repeat(40));
  assert.equal(buildMissionEventFromWorkerResult(action('push'), execution()).operation, 'push');
  const opened = buildMissionEventFromWorkerResult(action('open-pr'), execution(), { prNumber: 1300, prUrl: 'https://github.com/o/r/pull/1300', headSha: 'c'.repeat(40), mergeable: true });
  assert.equal(opened.eventType, 'PULL_REQUEST_OPENED');
  const checks = buildMissionEventFromWorkerResult(action('check-pr'), execution(), { prNumber: 1300, headSha: 'c'.repeat(40), prState: 'open', mergeable: true, checks: [{ name: 'Build', state: 'success' }] });
  assert.equal(checks.eventType, 'PULL_REQUEST_CHECKS_UPDATED');
  assert.equal(checks.checks[0].status, 'success');
  const merged = buildMissionEventFromWorkerResult(action('merge-pr'), execution(), { prState: 'merged', mergeCommitSha: 'd'.repeat(40) });
  assert.equal(merged.eventType, 'PULL_REQUEST_MERGED');
});

test('failed signed execution produces a bounded mission blocker event', () => {
  const event = buildMissionEventFromWorkerResult(action('push'), { ...execution(false), error: 'network unavailable' });
  assert.equal(event.eventType, 'MISSION_BLOCKED');
  assert.match(event.reason, /network unavailable/);
});

test('rejects ungrounded success receipts and incomplete operation identity', () => {
  assert.throws(() => buildMissionEventFromWorkerResult(action('push'), { success: true, commandOutputHash: 'short' }), /output hash/);
  assert.throws(() => buildMissionEventFromWorkerResult(action('commit'), execution(), { commitSha: 'short', clean: true }), /commit SHA/);
  assert.throws(() => buildMissionEventFromWorkerResult(action('check-pr'), execution(), { prNumber: 1, headSha: 'e'.repeat(40), checks: [] }), /incomplete/);
  assert.throws(() => buildMissionEventFromWorkerResult(action('merge-pr'), execution(), { prState: 'open', mergeCommitSha: 'f'.repeat(40) }), /merged state/);
});
