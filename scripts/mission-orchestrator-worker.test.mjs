import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  executeCodexAction,
  executeSignedOperation,
  inspectGitHubAction,
  inspectSignedOperation,
  parseBridgeOutput,
  parseCodexJsonLines,
} from './mission-orchestrator-worker.mjs';

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

test('parses Codex JSONL while ignoring diagnostic lines', () => {
  assert.deepEqual(parseCodexJsonLines('{"type":"turn.started"}\ndiagnostic\n{"type":"turn.completed"}\n'), [
    { type: 'turn.started' }, { type: 'turn.completed' },
  ]);
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

test('executes Codex non-interactively and grounds changed files and test evidence', async () => {
  const worktreePath = await mkdtemp(join(tmpdir(), 'mission-codex-worktree-'));
  const claim = { processingPath: join(worktreePath, 'action.json') };
  let invocation;
  const testCommand = 'node --test shared/agents/example.test.mjs';
  const commandEvent = { type: 'item.completed', item: { id: 'cmd-1', type: 'command_execution', command: testCommand, status: 'completed', exit_code: 0 } };
  const result = await executeCodexAction({
    actionKind: 'agent-handoff',
    adapter: 'codex',
    actionId: 'codex-action-1',
    missionId: 'codex-worker-test',
    worktreePath,
    allowedFiles: ['shared/agents/**'],
    requiredTests: [testCommand],
    requiredEvidence: ['focused test output'],
    repairRound: 0,
  }, claim, {
    now: new Date('2026-06-24T23:30:00.000Z'),
    runCommand(executable, args, options) {
      if (executable === 'codex.exe') {
        invocation = { executable, args, options };
        const outputPath = args[args.indexOf('--output-last-message') + 1];
        writeFileSync(outputPath, JSON.stringify({ success: true, summary: 'Implemented.', evidence: [{ requirement: 'focused test output', command: testCommand }] }));
        return { status: 0, stdout: `${JSON.stringify({ type: 'thread.started', thread_id: 'thread-123' })}\n${JSON.stringify(commandEvent)}\n`, stderr: '' };
      }
      if (args.includes('diff')) return { status: 0, stdout: 'shared/agents/example.mjs\n', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    },
  });
  assert.equal(invocation.executable, 'codex.exe');
  assert.ok(invocation.args.includes('workspace-write'));
  assert.ok(invocation.args.includes('--json'));
  assert.equal(invocation.options.cwd, worktreePath);
  assert.equal(result.success, true);
  assert.equal(result.resultId, 'thread-123');
  assert.deepEqual(result.changedFiles, ['shared/agents/example.mjs']);
  assert.equal(result.evidenceReceipts[0].requirement, 'focused test output');
  assert.match(result.evidenceReceipts[0].commandOutputHash, /^[a-f0-9]{64}$/);
  assert.match(result.receipt.commandOutputHash, /^[a-f0-9]{64}$/);
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
    if (args.some((arg) => String(arg).includes('statusCheckRollup'))) {
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

test('read-only GitHub inspection records failed checks as successful inspection evidence', async () => {
  let invocation;
  const result = await inspectGitHubAction({
    actionKind: 'github-inspection',
    operation: 'check-pr',
    repository: 'Cheekyfellastef/stephan-os',
    repositoryRoot: 'C:\\worktree',
    prNumber: 1300,
  }, {}, {
    now: new Date('2026-06-24T23:20:00.000Z'),
    runCommand(executable, args, options) {
      invocation = { executable, args, options };
      return {
        status: 0,
        stdout: JSON.stringify({
          number: 1300,
          headRefOid: 'd'.repeat(40),
          mergeable: 'MERGEABLE',
          state: 'OPEN',
          statusCheckRollup: [{ name: 'Build', conclusion: 'FAILURE', detailsUrl: 'https://example.test/check' }],
        }),
        stderr: '',
      };
    },
  });
  assert.equal(invocation.executable, 'gh.exe');
  assert.deepEqual(invocation.args.slice(0, 4), ['pr', 'view', '1300', '--repo']);
  assert.equal(invocation.options.cwd, 'C:\\worktree');
  assert.equal(result.execution.success, true);
  assert.match(result.execution.commandOutputHash, /^[a-f0-9]{64}$/);
  assert.equal(result.execution.completedAt, '2026-06-24T23:20:00.000Z');
  assert.equal(result.inspection.checks[0].status, 'failure');
  assert.equal(result.inspection.headSha, 'd'.repeat(40));
});

test('normalizes merged PR inspection to the exact merge commit', async () => {
  const merged = await inspectSignedOperation(payload('merge-pr'), {}, {}, {
    runCommand: () => ({ status: 0, stdout: JSON.stringify({ state: 'MERGED', mergeCommit: { oid: 'c'.repeat(40) } }), stderr: '' }),
  });
  assert.equal(merged.prState, 'merged');
  assert.equal(merged.mergeCommitSha, 'c'.repeat(40));
});
