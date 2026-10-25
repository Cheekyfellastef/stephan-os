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
  selectBattleBridgeGitHubCommandBatch,
  validateBattleBridgeGitHubCommand,
} from './battleBridgeGitHubCommandMailbox.mjs';
import {
  PROTECTED_OPENCLAW_MERGE_MAX_BOOTSTRAP_FINDINGS,
  PROTECTED_OPENCLAW_MERGE_FINDING,
  PROTECTED_OPENCLAW_MERGE_MODE,
  PROTECTED_OPENCLAW_MERGE_OPERATION,
  PROTECTED_OPENCLAW_MERGE_REQUIRED_WORKFLOWS,
  buildProtectedOpenClawMergePlan,
  validateProtectedOpenClawBootstrapFindings,
  validateProtectedOpenClawMergeChecks,
  validateProtectedOpenClawReviewArtifactMetadata,
  validateProtectedOpenClawReviewRunIdentity,
} from './protectedOpenClawMergeMailboxAdapter.mjs';
import {
  APPROVAL_BOUNDARY_PATHS_V2,
  WINDOWS_AUTHORITY_SPECIALIST_BOUNDARY_PATHS_V1,
} from './operatorMergeApprovalBoundaryV2.mjs';

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
  for (const patch of [
    { expectedBase: 'bad' },
    { mergeApprovalToken: 'wrong' },
    { reviewMode: 'clean-independent' },
    { reviewFindingCode: 'different-finding' },
    { executable: 'gh.exe' },
  ]) {
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
  assert.equal(Object.hasOwn(plan.claims, 'expectedBaseSha'), false);
  assert.equal(Object.hasOwn(plan.claims, 'requireExactBaseSha'), false);
  assert.equal(plan.normalized.expectedBase, base);
  assert.match(plan.claims.branch, /^openclaw\//);
});

function reviewPull() {
  return {
    number: command.prNumber,
    head: { ref: 'fix/example', sha: head, repo: { full_name: BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY } },
    base: { ref: 'main', sha: base, repo: { full_name: BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY } },
  };
}

function reviewRun(overrides = {}) {
  const name = `stephanos-independent-review-pr-${command.prNumber}-head-${head}-binding-legacy-pull-request-target`;
  return {
    id: command.reviewRunId,
    run_attempt: command.reviewRunAttempt,
    name,
    display_title: name,
    path: '.github/workflows/independent-merge-security-review.yml',
    event: 'pull_request_target',
    status: 'completed',
    conclusion: 'success',
    head_sha: head,
    head_branch: 'fix/example',
    repository: { full_name: BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY },
    head_repository: { full_name: BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY },
    pull_requests: [{
      number: command.prNumber,
      head: { ref: 'fix/example', sha: head, repo: { url: `https://api.github.com/repos/${BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY}` } },
      base: { ref: 'main', sha: base, repo: { url: `https://api.github.com/repos/${BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY}` } },
    }],
    ...overrides,
  };
}

test('protected merge accepts only the deterministic exact-bound pull-request review run', () => {
  const pull = reviewPull();
  const exact = reviewRun();
  assert.equal(validateProtectedOpenClawReviewRunIdentity(exact, pull, command), true);
  for (const changed of [
    { name: 'Independent Merge Security Review', display_title: 'Independent Merge Security Review' },
    { display_title: 'different' },
    { path: '.github/workflows/other.yml' },
    { event: 'pull_request' },
    { head_sha: '0'.repeat(40) },
    { head_branch: 'other' },
    { repository: { full_name: 'other/repo' } },
    { pull_requests: [] },
  ]) {
    assert.equal(validateProtectedOpenClawReviewRunIdentity({ ...exact, ...changed }, pull, command), false);
  }
});

test('workflow-dispatch review identity is exact target-name bound while GitHub executes trusted main', () => {
  const pull = reviewPull();
  const binding = 'a'.repeat(64);
  const name = `stephanos-independent-review-pr-${command.prNumber}-head-${head}-binding-${binding}`;
  const exact = reviewRun({
    name,
    display_title: name,
    event: 'workflow_dispatch',
    head_sha: base,
    head_branch: 'main',
    pull_requests: [],
  });
  assert.equal(validateProtectedOpenClawReviewRunIdentity(exact, pull, command), true);
  for (const changed of [
    { name: name.replace(String(command.prNumber), '9999'), display_title: name.replace(String(command.prNumber), '9999') },
    { name: name.replace(head, '0'.repeat(40)), display_title: name.replace(head, '0'.repeat(40)) },
    { name: name.slice(0, -1) + 'z', display_title: name.slice(0, -1) + 'z' },
    { head_sha: head },
    { head_branch: 'fix/example' },
    { pull_requests: reviewRun().pull_requests },
  ]) {
    assert.equal(validateProtectedOpenClawReviewRunIdentity({ ...exact, ...changed }, pull, command), false);
  }
});

test('artifact metadata follows the validated GitHub execution ref without weakening target binding', () => {
  const archive = (run, headSha, headBranch) => ({
    id: command.reviewArtifactId,
    name: `stephanos-independent-review-${command.reviewRunId}-attempt-${command.reviewRunAttempt}`,
    expired: false,
    digest: command.reviewArtifactDigest,
    workflow_run: { id: command.reviewRunId, head_sha: headSha, head_branch: headBranch },
  });
  const pullRun = reviewRun();
  assert.equal(validateProtectedOpenClawReviewArtifactMetadata(
    archive(pullRun, head, 'fix/example'), command, pullRun,
  ), true);
  const dispatchRun = reviewRun({ event: 'workflow_dispatch', head_sha: base, head_branch: 'main' });
  assert.equal(validateProtectedOpenClawReviewArtifactMetadata(
    archive(dispatchRun, base, 'main'), command, dispatchRun,
  ), true);
  assert.equal(validateProtectedOpenClawReviewArtifactMetadata(
    archive(dispatchRun, head, 'main'), command, dispatchRun,
  ), false);
  assert.equal(validateProtectedOpenClawReviewArtifactMetadata(
    archive(dispatchRun, base, 'fix/example'), command, dispatchRun,
  ), false);
});

test('bootstrap adapter accepts one or more unique self-change findings only', () => {
  const finding = (path, overrides = {}) => ({
    severity: 'P0',
    code: PROTECTED_OPENCLAW_MERGE_FINDING,
    summary: 'Qualified operator bootstrap required.',
    path,
    ...overrides,
  });
  assert.equal(validateProtectedOpenClawBootstrapFindings([
    finding('.github/workflows/operator-merge-approval-gate.yml'),
  ]), true);
  assert.equal(validateProtectedOpenClawBootstrapFindings([
    finding('.github/workflows/operator-merge-approval-gate.yml'),
    finding('scripts/operator-protected-personal-repository-merge.mjs'),
    finding('shared/agents/operatorPersonalRepositoryMergeV1.mjs'),
  ]), true);
  for (const findings of [
    [],
    [finding('.github/workflows/operator-merge-approval-gate.yml'), finding('.github/workflows/operator-merge-approval-gate.yml')],
    [finding('.github/workflows/operator-merge-approval-gate.yml', { severity: 'P1' })],
    [finding('.github/workflows/operator-merge-approval-gate.yml', { code: 'write-workflow-does-not-use-trusted-source' })],
    [finding('')],
    [finding('untrusted/path.mjs')],
    [...APPROVAL_BOUNDARY_PATHS_V2, ...WINDOWS_AUTHORITY_SPECIALIST_BOUNDARY_PATHS_V1]
      .slice(0, PROTECTED_OPENCLAW_MERGE_MAX_BOOTSTRAP_FINDINGS + 1)
      .map((path) => finding(path)),
  ]) {
    assert.equal(validateProtectedOpenClawBootstrapFindings(findings), false);
  }
});

function successfulRequiredChecks() {
  return PROTECTED_OPENCLAW_MERGE_REQUIRED_WORKFLOWS.map((workflow) => ({
    name: workflow === 'Build Stephanos UI' ? 'build' : 'proof',
    workflow,
    state: 'SUCCESS',
    ...(workflow === 'Build Stephanos UI' ? { event: 'pull_request' } : {}),
  }));
}

test('protected merge requires every canonical workflow while allowing exact neutral coordinator skips and unrelated review escalation', () => {
  const checks = [
    ...successfulRequiredChecks(),
    { name: 'worker-watchdog-proof', workflow: 'Battle Bridge Worker Watchdog Proof', state: 'SUCCESS' },
    { name: 'exact-head-review', workflow: 'Stephanos Exact-Head Review', state: 'FAILURE' },
    { name: 'coordinate', workflow: 'Exact-Head Review Dispatch', state: 'SKIPPED' },
    { name: 'retry', workflow: 'Exact-Head Review Dispatch', state: 'SKIPPED' },
  ];
  assert.equal(validateProtectedOpenClawMergeChecks(checks), true);
});

test('protected merge rejects missing or non-successful required workflows without letting duplicate success conceal failure', () => {
  const required = successfulRequiredChecks();
  const withoutBuild = required.filter((check) => check.workflow !== 'Build Stephanos UI');
  assert.equal(validateProtectedOpenClawMergeChecks(withoutBuild), false);

  for (const state of ['PENDING', 'FAILURE', 'CANCELLED', 'SKIPPED']) {
    assert.equal(validateProtectedOpenClawMergeChecks([
      ...required.filter((check) => check.workflow !== 'Build Stephanos UI'),
      { name: 'build', workflow: 'Build Stephanos UI', state },
    ]), false);
  }

  assert.equal(validateProtectedOpenClawMergeChecks([
    ...required,
    { ...required[0] },
  ]), true);
  assert.equal(validateProtectedOpenClawMergeChecks([
    ...required,
    { ...required[0], state: 'FAILURE' },
  ]), false);
});

test('protected merge ignores non-required workflow conclusions but rejects malformed or unexpected required skips', () => {
  const required = successfulRequiredChecks();
  assert.equal(validateProtectedOpenClawMergeChecks([
    ...required,
    { name: 'coordinate', workflow: 'Spoofed Review Dispatch', state: 'SKIPPED' },
    { name: 'external-review', workflow: 'Provider Review', state: 'PENDING' },
  ]), true);
  assert.equal(validateProtectedOpenClawMergeChecks([
    ...required,
    { name: 'unrelated', workflow: 'Exact-Head Review Dispatch', state: 'SKIPPED' },
  ]), false);
  assert.equal(validateProtectedOpenClawMergeChecks([
    ...required,
    { name: '', workflow: 'Exact-Head Review Dispatch', state: 'SUCCESS' },
  ]), false);
});

test('protected merge check inspection requests exact name, state and workflow identities', () => {
  const source = readFileSync(new URL('./protectedOpenClawMergeMailboxAdapter.mjs', import.meta.url), 'utf8');
  assert.match(source, /'--json', 'name,state,workflow,event'/);
  assert.doesNotMatch(source, /'--json', 'state'/);
});

test('protected merge executor lets parseable gh checks exit 1 reach the canonical classifier', () => {
  const source = readFileSync(new URL('./protectedOpenClawMergeMailboxAdapter.mjs', import.meta.url), 'utf8');
  assert.match(source, /const checksResult = runCommand\(BATTLE_BRIDGE_WINDOWS_HOST\.githubCli/);
  assert.match(source, /!\[0, 1\]\.includes\(checksStatus\)/);
  assert.match(source, /validateProtectedOpenClawMergeChecks\(checks\)/);
  assert.doesNotMatch(source, /const checks = parseJson\(runOk\(runCommand, BATTLE_BRIDGE_WINDOWS_HOST\.githubCli/);
});

test('feature branches emit only the pull-request build checks consumed by protected merge', () => {
  const source = readFileSync(new URL('../../.github/workflows/build-stephanos-ui.yml', import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n');
  assert.match(source, /^  push:\n    branches:\n      - main\n    paths:\s*$/m);
  assert.match(source, /^  pull_request:\s*$/m);
});

test('protected merge mailbox compares reviewed PR expectedBase to main, never PR source head', () => {
  const authoredAt = new Date('2026-08-05T16:29:00.000Z').toISOString();
  const payload = {
    ...command,
    requestId: 'protected-bootstrap-source-base-admission',
    expectedHead: head,
    expectedBase: base,
  };
  const entry = {
    id: 12345,
    created_at: authoredAt,
    user: { login: 'Cheekyfellastef' },
    body: '```stephanos-battle-bridge-command\n' + JSON.stringify(payload) + '\n```',
  };
  const options = { now: new Date('2026-08-05T16:30:00.000Z') };

  const admitted = selectBattleBridgeGitHubCommandBatch([entry], {
    ...options, currentHead: base,
  });
  assert.equal(admitted.ok, true);
  assert.equal(admitted.commands.length, 1);
  assert.equal(admitted.commands[0].command.operation, PROTECTED_OPENCLAW_MERGE_OPERATION);
  assert.equal(admitted.commands[0].command.expectedHead, head);
  assert.equal(admitted.commands[0].command.expectedBase, base);
  assert.equal(admitted.terminalRejections.length, 0);

  const staleBase = selectBattleBridgeGitHubCommandBatch([entry], {
    ...options, currentHead: 'f'.repeat(40),
  });
  assert.equal(staleBase.verdict, 'NO_COMMAND_READY');
  assert.equal(staleBase.terminalRejections.length, 1);
  assert.equal(staleBase.terminalRejections[0].blocker, 'COMMAND_EXPECTED_HEAD_SUPERSEDED');
  assert.equal(staleBase.rejected[0].expectedHead, head);
  assert.equal(staleBase.rejected[0].expectedMainHead, base);
  assert.equal(staleBase.rejected[0].githubMainHead, 'f'.repeat(40));

  const normal = { ...payload, operation: 'REPAIR_BATTLE_BRIDGE_CONTROL_PLANE' };
  const normalEntry = { ...entry, body: '```stephanos-battle-bridge-command\n' + JSON.stringify(normal) + '\n```' };
  const strict = selectBattleBridgeGitHubCommandBatch([normalEntry], {
    ...options, currentHead: base,
  });
  assert.equal(strict.verdict, 'NO_COMMAND_READY');
  assert.equal(strict.terminalRejections[0].blocker, 'PROTECTED_MERGE_FIELD_NOT_ALLOWED');
  const ordinary = {
    schemaVersion: payload.schemaVersion,
    requestId: 'strict-control-head-not-pr',
    operation: 'REPAIR_BATTLE_BRIDGE_CONTROL_PLANE',
    repository: payload.repository,
    issueNumber: payload.issueNumber,
    branch: payload.branch,
    operatorApproval: payload.operatorApproval,
    expectedHead: head,
    expiresAt: payload.expiresAt,
  };
  const ordinaryEntry = {
    ...entry,
    body: '```stephanos-battle-bridge-command\n' + JSON.stringify(ordinary) + '\n```',
  };
  const strictOrdinary = selectBattleBridgeGitHubCommandBatch([ordinaryEntry], {
    ...options, currentHead: base,
  });
  assert.equal(strictOrdinary.verdict, 'NO_COMMAND_READY');
  assert.equal(strictOrdinary.terminalRejections[0].blocker, 'COMMAND_EXPECTED_HEAD_SUPERSEDED');
  assert.equal(strictOrdinary.rejected[0].expectedMainHead, head);
});
