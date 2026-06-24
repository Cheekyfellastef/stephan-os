import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { executeSignedOperation, inspectSignedOperation, parseBridgeOutput } from './mission-orchestrator-worker.mjs';

function payload(operation, fields = {}) {
  return {
    actionId: `action-${operation}`,
    missionId: 'worker-script-test',
    operation,
    authorization: {
      claims: {
        operation,
        repository: 'Cheekyfellastef/stephan-os',
        repositoryRoot: 'C:\\repo',
        worktreePath: 'C:\\worktree',
        branch: 'openclaw/worker-script-test',
        prNumber: 1300,
        ...fields,
      },
    },
  };
}

test('parses bridge key-value output without exposing assumptions about ordering', () => {
  assert.deepEqual(parseBridgeOutput('MISSION=x\nRESULT_PATH=C:\\proof\\x.json\nFINAL_VERDICT=OPENCLAW_GITHUB_OPERATION_PASS\n'), {
    MISSION: 'x', RESULT_PATH: 'C:\\proof\\x.json', FINAL_VERDICT: 'OPENCLAW_GITHUB_OPERATION_PASS',
  });
});

test('executes the bridge through an argument array and hashes its output', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mission-worker-script-'));
  const bridgePath = join(root, 'bridge.ps1');
  await writeFile(bridgePath, '# test bridge\n', 'utf8');
  const claim = { processingPath: join(root, 'action.json') };
  let invocation;
  const result = await executeSignedOperation(payload('create-worktree', { repositoryRoot: root }), claim, {
    bridgePath,
    runCommand(executable, args) {
      invocation = { executable, args };
      return { status: 0, stdout: 'RESULT_PATH=C:\\proof\\result.json\nFINAL_VERDICT=OPENCLAW_GITHUB_OPERATION_PASS\n', stderr: '' };
    },
  });
  assert.equal(invocation.executable, 'powershell.exe');
  assert.ok(invocation.args.includes('-RequestPath'));
  assert.equal(result.success, true);
  assert.match(result.commandOutputHash, /^[a-f0-9]{64}$/);
});

test('inspects worktree and commit truth with shell-free git argument arrays', async () => {
  const calls = [];
  const runCommand = (executable, args) => {
    calls.push({ executable, args });
    if (args.includes('rev-parse')) return { status: 0, stdout: `${'a'.repeat(40)}\n`, stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  };
  const worktree = await inspectSignedOperation(payload('create-worktree'), {}, {}, { runCommand });
  assert.equal(worktree.clean, true);
  const commit = await inspectSignedOperation(payload('commit'), {}, {}, { runCommand });
  assert.equal(commit.commitSha, 'a'.repeat(40));
  assert.equal(commit.clean, true);
  assert.ok(calls.every((call) => Array.isArray(call.args)));
});

test('normalizes PR and check inspection into deterministic identity', async () => {
  const runCommand = (_executable, args) => {
    if (args.includes('statusCheckRollup')) {
      return { status: 0, stdout: JSON.stringify({ number: 1300, headRefOid: 'b'.repeat(40), mergeable: 'MERGEABLE', state: 'OPEN', statusCheckRollup: [{ name: 'Build', conclusion: 'SUCCESS', detailsUrl: 'https://example.test/check' }] }), stderr: '' };
    }
    return { status: 0, stdout: JSON.stringify({ number: 1300, url: 'https://github.com/o/r/pull/1300', headRefOid: 'b'.repeat(40), mergeable: 'MERGEABLE', state: 'OPEN' }), stderr: '' };
  };
  const opened = await inspectSignedOperation(payload('open-pr'), {}, {}, { runCommand });
  assert.equal(opened.prNumber, 1300);
  assert.equal(opened.mergeable, true);
  const checks = await inspectSignedOperation(payload('check-pr'), {}, {}, { runCommand });
  assert.equal(checks.checks[0].status, 'success');
  assert.equal(checks.headSha, 'b'.repeat(40));
});

test('normalizes merged PR inspection to the exact merge commit', async () => {
  const merged = await inspectSignedOperation(payload('merge-pr'), {}, {}, {
    runCommand: () => ({ status: 0, stdout: JSON.stringify({ state: 'MERGED', mergeCommit: { oid: 'c'.repeat(40) } }), stderr: '' }),
  });
  assert.equal(merged.prState, 'merged');
  assert.equal(merged.mergeCommitSha, 'c'.repeat(40));
});
