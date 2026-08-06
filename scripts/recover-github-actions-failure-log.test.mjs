import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFailureLogPaths, parseFailureExcerpt, recoverGitHubActionsFailureLog } from './recover-github-actions-failure-log.mjs';

test('buildFailureLogPaths rejects unsafe identifiers', () => {
  assert.throws(() => buildFailureLogPaths({ workspaceRoot: 'x', repository: '../bad', runId: '1' }), /owner\/name/);
  assert.throws(() => buildFailureLogPaths({ workspaceRoot: 'x', repository: 'owner/repo', runId: 'abc' }), /positive GitHub Actions run ID/);
  assert.throws(() => buildFailureLogPaths({ workspaceRoot: 'x', repository: 'owner/repo', runId: '1', jobId: '../2' }), /positive GitHub Actions job ID/);
});

test('parseFailureExcerpt keeps assertion evidence instead of setup noise', () => {
  const excerpt = parseFailureExcerpt('setup\nnot ok 3 - guardrail\nAssertionError: expected true\ncleanup');
  assert.match(excerpt, /not ok 3/);
  assert.match(excerpt, /AssertionError/);
  assert.doesNotMatch(excerpt, /setup/);
});

test('recoverGitHubActionsFailureLog stores the complete log and bounded receipt', () => {
  const root = mkdtempSync(join(tmpdir(), 'stephanos-actions-log-'));
  try {
    const completeLog = `setup line\nnot ok 7 - exact head guard\nAssertionError [ERR_ASSERTION]: expected pass\n${'detail\n'.repeat(2000)}`;
    const calls = [];
    const result = recoverGitHubActionsFailureLog({ repository: 'owner/repo', runId: '123', jobId: '456', workspaceRoot: root }, {
      ghExecutable: 'gh.exe',
      runCommand(executable, args) {
        calls.push({ executable, args });
        return { status: 0, stdout: completeLog, stderr: '' };
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.finalVerdict, 'GITHUB_ACTIONS_FULL_LOG_RECOVERED');
    assert.deepEqual(calls[0], { executable: 'gh.exe', args: ['run', 'view', '123', '--repo', 'owner/repo', '--job', '456', '--log'] });
    assert.equal(readFileSync(result.logPath, 'utf8'), completeLog);
    const receipt = JSON.parse(readFileSync(result.receiptPath, 'utf8'));
    assert.equal(receipt.bytes, Buffer.byteLength(completeLog, 'utf8'));
    assert.match(receipt.failureExcerpt, /ERR_ASSERTION/);
    assert.equal(receipt.readOnly, true);
    assert.equal(receipt.sourceMutationAllowed, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('recovery fails closed when gh cannot return a log', () => {
  const result = recoverGitHubActionsFailureLog({ repository: 'owner/repo', runId: '123', workspaceRoot: tmpdir() }, {
    runCommand() { return { status: 1, stdout: '', stderr: 'not authorised' }; },
  });
  assert.equal(result.ok, false);
  assert.equal(result.finalVerdict, 'GITHUB_ACTIONS_LOG_RECOVERY_BLOCKED');
  assert.match(result.blocker, /not authorised/);
});
