import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenClawGitHubOperation } from './openClawGitHubOperator.mjs';

const base = {
  missionId: 'github-operator-v1',
  repository: 'Cheekyfellastef/stephan-os',
  repositoryRoot: 'C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os',
  defaultBranch: 'main',
  baseBranch: 'main',
  branch: 'openclaw/github-operator-v1',
};

test('creates a bounded branch command without shell interpolation', () => {
  const packet = buildOpenClawGitHubOperation({ ...base, operation: 'create-branch' });
  assert.equal(packet.finalVerdict, 'READY_TO_EXECUTE');
  assert.deepEqual(packet.command, [{
    executable: 'git.exe',
    args: ['-C', base.repositoryRoot, 'switch', '-c', base.branch, 'main'],
  }]);
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
    allowedFiles: ['shared/agents/example.mjs', 'shared/agents/example.test.mjs'],
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
    title: 'Add bounded GitHub operator',
    body: 'Source-only change.',
  });
  assert.equal(packet.finalVerdict, 'READY_TO_EXECUTE');
  assert.deepEqual(packet.command[0].args.slice(0, 8), [
    'pr', 'create', '--repo', base.repository, '--base', 'main', '--head', base.branch,
  ]);
});

test('merge blocks failed checks stale head and missing exact approval', () => {
  const head = 'a'.repeat(40);
  const variants = [
    { checks: ['failure'], expectedHeadSha: head, mergeable: true, approvalToken: `APPROVE_OPENCLAW_SQUASH_MERGE:1261:${head}` },
    { checks: ['success'], expectedHeadSha: '', mergeable: true, approvalToken: '' },
    { checks: ['success'], expectedHeadSha: head, mergeable: false, approvalToken: `APPROVE_OPENCLAW_SQUASH_MERGE:1261:${head}` },
    { checks: ['success'], expectedHeadSha: head, mergeable: true, approvalToken: 'APPROVE' },
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
    mergeable: true,
    checks: ['success', 'success'],
    approvalToken: `APPROVE_OPENCLAW_SQUASH_MERGE:1261:${head}`,
  });
  assert.equal(packet.finalVerdict, 'READY_TO_EXECUTE');
  assert.deepEqual(packet.command, [{
    executable: 'gh.exe',
    args: ['pr', 'merge', '1261', '--repo', base.repository, '--squash', '--match-head-commit', head],
  }]);
});
