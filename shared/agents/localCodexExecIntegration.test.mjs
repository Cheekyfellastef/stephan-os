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
  classifyPostTaskDirt,
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

test('worker dirt classification permits generated dist but blocks source changes', () => {
  const output = ' M apps/stephanos/dist/index.html\n?? apps/stephanos/dist/assets/new.js\n M scripts/unsafe.mjs\n';
  assert.deepEqual(parseGitStatusPaths(output), ['apps/stephanos/dist/index.html', 'apps/stephanos/dist/assets/new.js', 'scripts/unsafe.mjs']);
  const classified = classifyPostTaskDirt(output);
  assert.deepEqual(classified.generated, ['apps/stephanos/dist/index.html', 'apps/stephanos/dist/assets/new.js']);
  assert.deepEqual(classified.source, ['scripts/unsafe.mjs']);
  assert.equal(classified.safe, false);
  assert.equal(classifyPostTaskDirt(' M apps/stephanos/dist/index.html\n').safe, true);
});

test('worker invocation uses stdin prompt, JSON events, ephemeral mode, and workspace-write without merge authority', () => {
  const windows = resolveCodexExecInvocation({ platform: 'win32', env: { STEPHANOS_CODEX_COMMAND: 'codex.cmd' }, lastMessagePath: 'C:\\proof\\last.txt' });
  assert.equal(windows.command, 'cmd.exe');
  assert.deepEqual(windows.args.slice(0, 4), ['/d', '/s', '/c', 'codex.cmd']);
  assert.equal(windows.args.includes('--json'), true);
  assert.equal(windows.args.includes('--ephemeral'), true);
  assert.equal(windows.args.includes('workspace-write'), true);
  assert.equal(windows.args.at(-1), '-');

  const promptText = buildGuardedCodexPrompt({
    prompt: 'Prove ignition.',
    repoRoot: 'C:\\repo',
    requestedProofCommands: ['git rev-parse HEAD'],
  });
  assert.match(promptText, /Do not push, merge, delete branches/);
  assert.match(promptText, /Do not modify source files/);
  assert.match(promptText, /git rev-parse HEAD/);
});
