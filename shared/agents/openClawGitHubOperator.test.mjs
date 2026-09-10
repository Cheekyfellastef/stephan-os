import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildOpenClawGitHubOperation } from './openClawGitHubOperator.mjs';
import { PROTECTED_MERGE_REQUIRED_WORKFLOWS } from './protectedMergeCheckClassifierV1.mjs';

const base = {
  missionId: 'github-operator-v1',
  repository: 'Cheekyfellastef/stephan-os',
  repositoryRoot: 'C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os',
  defaultBranch: 'main',
  baseBranch: 'main',
  branch: 'openclaw/github-operator-v1',
  worktreePath: 'C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os-worktrees\\github-operator-v1',
};

function successfulRequiredChecks() {
  return PROTECTED_MERGE_REQUIRED_WORKFLOWS.map((workflow, index) => ({
    name: `required-${index}`,
    workflow,
    state: 'SUCCESS',
  }));
}

test('creates an isolated worktree from origin main without shell interpolation', () => {
  const packet = buildOpenClawGitHubOperation({ ...base, operation: 'create-worktree' });
  assert.equal(packet.finalVerdict, 'READY_TO_EXECUTE');
  assert.deepEqual(packet.command, [
    { executable: 'git.exe', args: ['-C', base.repositoryRoot, 'fetch', 'origin', 'main'] },
    {
      executable: 'git.exe',
      args: ['-C', base.repositoryRoot, 'worktree', 'add', '-b', base.branch, base.worktreePath, 'origin/main'],
    },
  ]);
});

test('blocks direct main mutation and non-openclaw branches', () => {
  for (const branch of ['main', 'feature/manual', '']) {
    const packet = buildOpenClawGitHubOperation({ ...base, operation: 'push', branch });
    assert.equal(packet.finalVerdict, 'BLOCKED');
    assert.deepEqual(packet.command, []);
  }
});

test('commit stages only exact approved files', () => {
  const packet = buildOpenClawGitHubOperation({
    ...base,
    operation: 'commit',
    allowedFiles: ['shared/agents/**'],
    changedFiles: ['shared\\agents\\example.mjs', 'shared/agents/example.test.mjs'],
    commitMessage: 'Add bounded example',
  });
  assert.equal(packet.finalVerdict, 'READY_TO_EXECUTE');
  assert.deepEqual(packet.command[0].args.slice(3), ['--', 'shared/agents/example.mjs', 'shared/agents/example.test.mjs']);
});

test('commit blocks generated runtime secret traversal and out-of-scope files', () => {
  for (const changedFile of [
    'apps/stephanos/dist/index.html',
    'runtime/state.json',
    '.env',
    '../outside.js',
    'shared/agents/unapproved.mjs',
  ]) {
    const packet = buildOpenClawGitHubOperation({
      ...base,
      operation: 'commit',
      allowedFiles: ['shared/agents/example.mjs'],
      changedFiles: [changedFile],
      commitMessage: 'Unsafe commit',
    });
    assert.equal(packet.finalVerdict, 'BLOCKED', changedFile);
    assert.deepEqual(packet.command, []);
  }
});

test('open PR uses an argument array and targets main', () => {
  const packet = buildOpenClawGitHubOperation({
    ...base,
    operation: 'open-pr',
    allowedFiles: ['shared/agents/**'],
    changedFiles: ['shared/agents/example.mjs'],
    actualChangedFiles: ['shared/agents/example.mjs'],
    title: 'Add bounded GitHub operator',
    body: 'Source-only change.',
  });
  assert.equal(packet.finalVerdict, 'READY_TO_EXECUTE');
  assert.deepEqual(packet.command[0].args.slice(0, 8), [
    'pr', 'create', '--repo', base.repository, '--base', 'main', '--head', base.branch,
  ]);
});

test('push and open PR block when the complete branch diff differs from signed scope', () => {
  for (const operation of ['push', 'open-pr']) {
    const packet = buildOpenClawGitHubOperation({
      ...base,
      operation,
      allowedFiles: ['shared/agents/**'],
      changedFiles: ['shared/agents/example.mjs'],
      actualChangedFiles: ['shared/agents/example.mjs', 'tests/unapproved.test.mjs'],
      title: 'Bounded PR',
    });
    assert.equal(packet.finalVerdict, 'BLOCKED');
    assert.match(packet.blockers.join(' '), /do not match/i);
  }
});

test('merge blocks failed checks stale head and missing exact approval', () => {
  const head = 'a'.repeat(40);
  const variants = [
    { checks: successfulRequiredChecks().map((check, index) => (index === 0 ? { ...check, state: 'FAILURE' } : check)), expectedHeadSha: head, actualHeadSha: head, mergeable: true, approvalToken: `APPROVE_OPENCLAW_SQUASH_MERGE:1261:${head}` },
    { checks: successfulRequiredChecks(), expectedHeadSha: '', actualHeadSha: head, mergeable: true, approvalToken: '' },
    { checks: successfulRequiredChecks(), expectedHeadSha: head, actualHeadSha: head, mergeable: false, approvalToken: `APPROVE_OPENCLAW_SQUASH_MERGE:1261:${head}` },
    { checks: successfulRequiredChecks(), expectedHeadSha: head, actualHeadSha: head, mergeable: true, approvalToken: 'APPROVE' },
    { checks: successfulRequiredChecks(), expectedHeadSha: head, actualHeadSha: 'c'.repeat(40), mergeable: true, approvalToken: `APPROVE_OPENCLAW_SQUASH_MERGE:1261:${head}` },
  ];
  for (const variant of variants) {
    const packet = buildOpenClawGitHubOperation({ ...base, operation: 'merge-pr', prNumber: 1261, ...variant });
    assert.equal(packet.finalVerdict, 'BLOCKED');
    assert.deepEqual(packet.command, []);
  }
});

test('merge requires exact PR head approval and only emits squash merge', () => {
  const head = 'b'.repeat(40);
  const packet = buildOpenClawGitHubOperation({
    ...base,
    operation: 'merge-pr',
    prNumber: 1261,
    expectedHeadSha: head,
    actualHeadSha: head,
    mergeable: true,
    checks: [
      ...successfulRequiredChecks(),
      { name: 'exact-head-review', workflow: 'Stephanos Exact-Head Review', state: 'FAILURE' },
    ],
    approvalToken: `APPROVE_OPENCLAW_SQUASH_MERGE:1261:${head}`,
  });
  assert.equal(packet.finalVerdict, 'READY_TO_EXECUTE');
  assert.deepEqual(packet.command, [{
    executable: 'gh.exe',
    args: ['pr', 'merge', '1261', '--repo', base.repository, '--squash', '--match-head-commit', head],
  }]);
});

test('Windows executor preserves canonical workflow identity through final merge preflight', () => {
  const source = readFileSync(new URL('../../scripts/openclaw-github-operator.mjs', import.meta.url), 'utf8');
  assert.match(source, /'--json', 'name,state,workflow'/);
  assert.match(source, /checks: checkPayload,/);
  assert.doesNotMatch(source, /checkPayload\.map\(/);
});
