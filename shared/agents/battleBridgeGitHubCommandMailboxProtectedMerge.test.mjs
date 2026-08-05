import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BATTLE_BRIDGE_GITHUB_COMMAND_AUTHOR,
  BATTLE_BRIDGE_GITHUB_COMMAND_ISSUE,
  BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY,
  BATTLE_BRIDGE_GITHUB_COMMAND_SCHEMA,
  executeBattleBridgeGitHubCommand,
  validateBattleBridgeGitHubCommand,
} from './battleBridgeGitHubCommandMailbox.mjs';
import {
  PROTECTED_OPENCLAW_MERGE_FINDING,
  PROTECTED_OPENCLAW_MERGE_MODE,
  PROTECTED_OPENCLAW_MERGE_OPERATION,
  buildProtectedOpenClawMergePlan,
} from './protectedOpenClawMergeMailboxAdapter.mjs';
import { buildOpenClawGitHubOperation } from './openClawGitHubOperator.mjs';

const head = '850cf7ae18cba03f96b9b5efa119f1572a014257';
const base = 'c82bfdd1639558ecb24f75d5a845f6ce39ba9af0';
const command = Object.freeze({
  schemaVersion: BATTLE_BRIDGE_GITHUB_COMMAND_SCHEMA,
  requestId: 'req-protected-merge-1663-test',
  operation: PROTECTED_OPENCLAW_MERGE_OPERATION,
  repository: BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY,
  issueNumber: BATTLE_BRIDGE_GITHUB_COMMAND_ISSUE,
  branch: 'main', operatorApproval: 'operator-approved',
  expectedHead: head, expectedBase: base, prNumber: 1663,
  reviewRunId: 30987972306, reviewRunAttempt: 1, reviewJobId: 92247064712,
  reviewArtifactId: 8922881096,
  reviewArtifactDigest: 'sha256:cf13d4c64f1a459ef585fa1810b0a484d25161920fbe0e478689c6ee5fc95496',
  reviewPayloadSha256: 'c8411faf015e479239cdc9a8c7266919e7f9ab376a6eb7f06f9aefb60916d69d',
  reviewMode: PROTECTED_OPENCLAW_MERGE_MODE,
  reviewFindingCode: PROTECTED_OPENCLAW_MERGE_FINDING,
  mergeMethod: 'squash',
  mergeApprovalToken: 'APPROVE_OPENCLAW_SQUASH_MERGE:1663:' + head,
  expiresAt: '2026-08-05T18:00:00.000Z',
});

test('mailbox accepts only exact bounded protected merge evidence', () => {
  const accepted = validateBattleBridgeGitHubCommand(command, {
    authorLogin: BATTLE_BRIDGE_GITHUB_COMMAND_AUTHOR,
    now: new Date('2026-08-05T16:30:00.000Z'),
  });
  assert.equal(accepted.ok, true);
  for (const patch of [{ expectedBase: 'bad' }, { mergeApprovalToken: 'wrong' }, { executable: 'gh.exe' }]) {
    const rejected = validateBattleBridgeGitHubCommand({ ...command, ...patch }, {
      authorLogin: BATTLE_BRIDGE_GITHUB_COMMAND_AUTHOR,
      now: new Date('2026-08-05T16:30:00.000Z'),
    });
    assert.equal(rejected.ok, false);
  }
});

test('mailbox routes the operation to one named handler', async () => {
  let observed = null;
  const result = await executeBattleBridgeGitHubCommand(command, {
    executeProtectedOpenClawMerge: async (value) => { observed = value; return { ok: true }; },
  });
  assert.equal(result.ok, true);
  assert.equal(observed.expectedBase, base);
});

test('execution plan binds exact head, base and fixed signed OpenClaw identity', () => {
  const root = mkdtempSync(join(tmpdir(), 'protected-merge-plan-'));
  const plan = buildProtectedOpenClawMergePlan(command, {
    now: new Date('2026-08-05T16:30:00.000Z'), userProfile: root,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.claims.expectedHeadSha, head);
  assert.equal(plan.claims.expectedBaseSha, base);
  assert.equal(plan.claims.requireExactBaseSha, true);
  assert.match(plan.claims.branch, /^openclaw\//);
});

test('OpenClaw operation fails closed on exact-base movement', () => {
  const common = {
    operation: 'merge-pr', repository: BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY,
    repositoryRoot: 'C:/repo', missionId: 'protected-merge-test', baseBranch: 'main', defaultBranch: 'main',
    branch: 'openclaw/protected-merge-pr-1663', prNumber: 1663,
    expectedHeadSha: head, actualHeadSha: head, requireExactBaseSha: true,
    expectedBaseSha: base, mergeable: true, checks: ['success'],
    approvalToken: 'APPROVE_OPENCLAW_SQUASH_MERGE:1663:' + head,
  };
  assert.equal(buildOpenClawGitHubOperation({ ...common, actualBaseSha: base }).finalVerdict, 'READY_TO_EXECUTE');
  const stale = buildOpenClawGitHubOperation({ ...common, actualBaseSha: '1'.repeat(40) });
  assert.equal(stale.finalVerdict, 'BLOCKED');
  assert.ok(stale.blockers.includes('Pull request base SHA changed or could not be verified.'));
});

test('authorization issuer defers only live exact-base observation to the executor', () => {
  const source = readFileSync(new URL('../../scripts/stephanos-issue-openclaw-github-authorization.mjs', import.meta.url), 'utf8');
  assert.match(source, /Pull request base SHA changed or could not be verified\./);
  assert.doesNotMatch(source, /Exact lowercase pull request base SHA is required\.[\s\S]*\.includes\(blocker\)/);
});
