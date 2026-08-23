import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REMOTE_CODEX_GITHUB_MIRROR_COMMENT_ID,
  REMOTE_CODEX_GITHUB_MIRROR_MARKER,
  createFixedGitHubMirrorAdapter,
  publishRemoteCodexGitHubMirror,
  validateRemoteCodexGitHubMirrorBody,
} from './remote-codex-github-mirror-publisher.mjs';

const slice = {
  schemaVersion: 'stephanos.remote-codex-task-visibility.v1',
  kind: 'stephanos.remote_codex.task_visibility',
  state: 'RUNNING_CURRENT',
  jobId: 'codex-job-1506-visibility',
  taskId: 'codex-job-1506-visibility',
  codexThreadId: 'thread-1506-visible',
  heartbeatUtc: '2026-07-16T16:00:00.000Z',
  heartbeatFresh: true,
  resultAvailable: false,
  resultVerdict: 'NOT_READY',
  sourceHead: 'a'.repeat(40),
  blocker: '',
  nextAction: 'Continue monitoring the current Remote Codex task.',
  proofRefs: ['proof/remote-codex-current.json'],
};

test('fixed adapter updates exactly one canonical comment with no shell execution', async () => {
  const calls = [];
  const adapter = createFixedGitHubMirrorAdapter({
    ghCommand: 'gh-test',
    spawnSyncFn(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0, stdout: '{}', stderr: '' };
    },
  });
  const result = await publishRemoteCodexGitHubMirror(slice, { adapter });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'gh-test');
  assert.deepEqual(calls[0].args.slice(0, 4), [
    'api',
    '--method',
    'PATCH',
    `repos/Cheekyfellastef/stephan-os/issues/comments/${REMOTE_CODEX_GITHUB_MIRROR_COMMENT_ID}`,
  ]);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.windowsHide, true);
  assert.match(calls[0].args.at(-1), new RegExp(`body=${REMOTE_CODEX_GITHUB_MIRROR_MARKER}`));
});

test('mirror validator rejects local paths and secret-shaped text', () => {
  for (const unsafe of [
    `${REMOTE_CODEX_GITHUB_MIRROR_MARKER}\nC:\\Users\\Stephan\\secret.txt`,
    `${REMOTE_CODEX_GITHUB_MIRROR_MARKER}\ntoken=abc`,
    `${REMOTE_CODEX_GITHUB_MIRROR_MARKER}\n/home/stephan/result.json`,
  ]) {
    const validation = validateRemoteCodexGitHubMirrorBody(unsafe);
    assert.equal(validation.valid, false);
    assert.match(validation.errors.join(','), /unsafe-mirror-text/);
  }
});

test('missing gh CLI returns a deterministic blocker without exposing environment data', async () => {
  const adapter = createFixedGitHubMirrorAdapter({
    spawnSyncFn: () => ({ status: null, stdout: '', stderr: '', error: Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }) }),
  });
  const result = await publishRemoteCodexGitHubMirror(slice, { adapter });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'GH_CLI_NOT_INSTALLED');
  assert.doesNotMatch(JSON.stringify(result), /token|password|C:\\Users/i);
});
