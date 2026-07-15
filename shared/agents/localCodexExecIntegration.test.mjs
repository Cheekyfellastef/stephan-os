import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import {
  createLocalCodexExecIntegration,
  readLocalCodexTaskResult,
  readLocalCodexTaskStatus,
  resolveLocalCodexDispatchPaths,
} from './localCodexExecIntegration.mjs';
import {
  buildGuardedCodexPrompt,
  classifyCodexExecution,
  classifyPostTaskDirt,
  compareDirtSnapshots,
  parseCodexJsonEvents,
  parseGitStatusPaths,
  resolveCodexExecInvocation,
} from '../../scripts/stephanos-codex-dispatch-worker.mjs';

function tempRoots() {
  const root = mkdtempSync(join(tmpdir(), 'stephanos-codex-dispatch-'));
  const repoRoot = join(root, 'repo');
  const workspaceRoot = join(root, 'workspace');
  mkdirSync(repoRoot, { recursive: true });
  mkdirSync(workspaceRoot, { recursive: true });
  return { root, repoRoot, workspaceRoot };
}

function packet(jobId = 'codex-job-test-123') {
  return {
    jobId,
    issueNumber: 1293,
    branch: 'main',
    prompt: 'Run the bounded real Windows ignition proof and report exact evidence.',
    requestedProofCommands: ['git rev-parse HEAD'],
    approvalRequirements: { approvalReceipt: 'operator-approved' },
    mergeAuthority: false,
  };
}

test('local integration writes a durable task and accepted receipt before launching one detached worker', () => {
  const roots = tempRoots();
  const spawns = [];
  const child = new EventEmitter();
  child.pid = 4242;
  child.unref = () => { child.unrefCalled = true; };
  const integration = createLocalCodexExecIntegration({
    ...roots,
    workerPath: join(roots.repoRoot, 'worker.mjs'),
    now: () => '2026-07-15T20:00:00.000Z',
    idFactory: () => 'receipt-id',
    spawnFn: (...args) => { spawns.push(args); return child; },
  });

  const receipt = integration.dispatch(packet());
  assert.equal(receipt.accepted, true);
  assert.equal(receipt.started, true);
  assert.equal(receipt.workerPid, 4242);
  assert.equal(receipt.mergeAuthority, false);
  assert.equal(child.unrefCalled, true);
  assert.equal(spawns.length, 1);
  assert.equal(spawns[0][0], process.execPath);
  assert.deepEqual(spawns[0][1].slice(1), ['--task', integration.paths.tasksRoot + '/codex-job-test-123/task.json'].map((value) => value.replaceAll('/', process.platform === 'win32' ? '\\' : '/')));

  const status = integration.readStatus('codex-job-test-123');
  assert.equal(status.status, 'DISPATCHED');
  assert.equal(status.taskType, 'battle-bridge-proof');
  assert.equal(status.safety.mergeAllowed, false);
  assert.equal(status.safety.sourceMutationAllowed, false);
  assert.equal(readFileSync(receipt.taskPath, 'utf8').includes('Run the bounded real Windows ignition proof'), true);
});

test('local integration enforces the one-active-job rule', () => {
  const roots = tempRoots();
  const child = { pid: 111, unref() {} };
  const integration = createLocalCodexExecIntegration({ ...roots, spawnFn: () => child });
  integration.dispatch(packet('codex-job-first'));
  assert.throws(() => integration.dispatch(packet('codex-job-second')), /already DISPATCHED/);
});

test('status and result readers are bounded to safe job ids', () => {
  const roots = tempRoots();
  const paths = resolveLocalCodexDispatchPaths({ ...roots, jobId: 'codex-job-readable' });
  mkdirSync(paths.taskRoot, { recursive: true });
  writeFileSync(paths.statusPath, JSON.stringify({ status: 'RUNNING' }));
  writeFileSync(paths.resultPath, JSON.stringify({ verdict: 'PASS' }));
  assert.equal(readLocalCodexTaskStatus('codex-job-readable', roots).status, 'RUNNING');
  assert.equal(readLocalCodexTaskResult('codex-job-readable', roots).verdict, 'PASS');
  assert.throws(() => readLocalCodexTaskStatus('../escape', roots), /Unsafe Codex job id/);
});

test('worker dirt classification permits generated dist but identifies source dirt', () => {
  const output = ' M apps/stephanos/dist/index.html\n?? apps/stephanos/dist/assets/new.js\n M scripts/unsafe.mjs\n';
  assert.deepEqual(parseGitStatusPaths(output), ['apps/stephanos/dist/index.html', 'apps/stephanos/dist/assets/new.js', 'scripts/unsafe.mjs']);
  const classified = classifyPostTaskDirt(output);
  assert.deepEqual(classified.generated, ['apps/stephanos/dist/index.html', 'apps/stephanos/dist/assets/new.js']);
  assert.deepEqual(classified.source, ['scripts/unsafe.mjs']);
  assert.equal(classified.safe, false);
  assert.equal(classifyPostTaskDirt(' M apps/stephanos/dist/index.html\n').safe, true);
});

test('unchanged pre-existing source dirt is reported but not falsely attributed to the dispatched task', () => {
  const before = classifyPostTaskDirt(' M scripts/pre-existing.mjs\n M apps/stephanos/dist/index.html\n');
  const after = classifyPostTaskDirt(' M scripts/pre-existing.mjs\n M apps/stephanos/dist/index.html\n');
  const delta = compareDirtSnapshots(before, after);
  assert.equal(delta.preExistingSourceDirt, true);
  assert.equal(delta.sourceMutationDetected, false);
  assert.equal(delta.generatedRuntimeMutationDetected, false);
  assert.equal(delta.sourceDirtUnchanged, true);
  assert.deepEqual(delta.newSourcePaths, []);
  assert.deepEqual(delta.removedSourcePaths, []);
});

test('new or removed source dirt is classified as a task-time mutation', () => {
  const before = classifyPostTaskDirt(' M scripts/pre-existing.mjs\n');
  const after = classifyPostTaskDirt(' M scripts/pre-existing.mjs\n?? scripts/new-file.mjs\n');
  const delta = compareDirtSnapshots(before, after);
  assert.equal(delta.sourceMutationDetected, true);
  assert.deepEqual(delta.newSourcePaths, ['scripts/new-file.mjs']);
});

test('worker invocation is explicit non-interactive read-only automation and disables nested dispatch MCP', () => {
  const windows = resolveCodexExecInvocation({ platform: 'win32', env: { STEPHANOS_CODEX_COMMAND: 'codex.cmd' }, lastMessagePath: 'C:\\proof\\last.txt' });
  assert.equal(windows.command, 'cmd.exe');
  assert.deepEqual(windows.args.slice(0, 4), ['/d', '/s', '/c', 'codex.cmd']);
  assert.deepEqual(windows.codexArgs.slice(0, 3), ['--ask-for-approval', 'never', 'exec']);
  assert.equal(windows.args.includes('--json'), true);
  assert.equal(windows.args.includes('--ephemeral'), true);
  assert.equal(windows.args.includes('--ignore-user-config'), true);
  assert.equal(windows.args.includes('read-only'), true);
  assert.equal(windows.args.includes('workspace-write'), false);
  assert.equal(windows.args.includes('mcp_servers.stephanos-codex-dispatch.enabled=false'), true);
  assert.equal(windows.args.at(-1), '-');

  const promptText = buildGuardedCodexPrompt({
    prompt: 'Prove ignition.',
    repoRoot: 'C:\\repo',
    requestedProofCommands: ['git rev-parse HEAD'],
  });
  assert.match(promptText, /Do not push, merge, delete branches/);
  assert.match(promptText, /Do not modify source files/);
  assert.match(promptText, /Do not call MCP tools/);
  assert.match(promptText, /read-only and non-interactive/);
  assert.match(promptText, /git rev-parse HEAD/);
});

test('JSON event parsing and completed-turn classification prove a successful Codex run', () => {
  const parsed = parseCodexJsonEvents([
    '{"type":"thread.started","thread_id":"thread-1"}',
    '{"type":"turn.started"}',
    '{"type":"item.completed","item":{"type":"agent_message","text":"PASS"}}',
    '{"type":"turn.completed"}',
  ].join('\n'));
  assert.equal(parsed.invalidLines.length, 0);
  const execution = classifyCodexExecution({ exit: { code: 0, error: '' }, events: parsed.events, lastMessage: 'PASS' });
  assert.equal(execution.passed, true);
  assert.equal(execution.turnCompleted, true);
  assert.equal(execution.reason, '');
});

test('exit zero with user-cancelled MCP text cannot be misreported as success', () => {
  const parsed = parseCodexJsonEvents('{"type":"turn.started"}\n');
  const execution = classifyCodexExecution({ exit: { code: 0, error: '' }, events: parsed.events, lastMessage: 'user cancelled MCP tool call' });
  assert.equal(execution.passed, false);
  assert.equal(execution.cancelled, true);
  assert.equal(execution.reason, 'CODEX_EXEC_CANCELLED');
});

test('turn.failed and error JSON events remain failures even when the process exits zero', () => {
  for (const type of ['turn.failed', 'error']) {
    const execution = classifyCodexExecution({
      exit: { code: 0, error: '' },
      events: [{ type }],
      lastMessage: '',
    });
    assert.equal(execution.passed, false);
    assert.equal(execution.failureEventType, type);
    assert.match(execution.reason, /^CODEX_EVENT_/);
  }
});

test('missing turn.completed is a deterministic failure rather than an assumed pass', () => {
  const execution = classifyCodexExecution({
    exit: { code: 0, error: '' },
    events: [{ type: 'thread.started' }, { type: 'turn.started' }],
    lastMessage: 'Partial output',
  });
  assert.equal(execution.passed, false);
  assert.equal(execution.reason, 'CODEX_TURN_COMPLETION_MISSING');
});
