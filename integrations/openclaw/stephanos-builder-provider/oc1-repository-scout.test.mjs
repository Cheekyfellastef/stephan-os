import assert from 'node:assert/strict';
import test from 'node:test';

import { validateExecutionReceipt } from '../../../shared/agents/executionReceiptV1.mjs';
import { validateSharedWorkspaceRecord } from '../../../shared/agents/sharedAgentWorkspaceStore.mjs';
import {
  OPENCLAW_OC1_COMMAND,
  OPENCLAW_OC1_TASK_CLASS,
  renderOpenClawBuilderHelp,
  resolveOpenClawBuilderCommand,
  runOpenClawOc1RepositoryScout,
} from './lib/oc1-repository-scout.mjs';

const HEAD = '8501a5657abe3fc5e815d9b35d9920003a4a1843';
const NOW = new Date('2026-08-19T15:20:00.000Z');
const USERPROFILE = '/tmp/openclaw-oc1-user';
const REPO_ROOT = '/tmp/openclaw-oc1-user/Documents/GitHub/stephan-os';

function authenticatedContext() {
  return { authenticatedByHost: true, commandName: 'stephanos-builder', command: OPENCLAW_OC1_COMMAND };
}

function fakeFetch() {
  return Promise.resolve({
    ok: true,
    headers: { get: () => 'application/json' },
    json: async () => ({ product: 'OpenClaw', runtimeId: 'openclaw-runtime-oc1-test' }),
  });
}

function createSpawn(statusOutput = '', overrides = {}) {
  const calls = [];
  const fn = (executable, args, options) => {
    calls.push({ executable, args: [...args], options });
    const key = args.join(' ');
    const stdout = overrides[key]
      ?? (key === 'rev-parse --show-toplevel' ? REPO_ROOT
        : key === 'remote get-url origin' ? 'https://github.com/Cheekyfellastef/stephan-os.git'
          : key === 'rev-parse --abbrev-ref HEAD' ? 'main'
            : key === 'rev-parse HEAD' ? HEAD
              : key === 'status --porcelain=v1 --untracked-files=all' ? statusOutput
                : '');
    return { status: 0, stdout: `${stdout}\n`, stderr: '' };
  };
  return { fn, calls };
}

function harness({ statusOutput = '', spawnOverrides = {}, exists = () => true } = {}) {
  const spawn = createSpawn(statusOutput, spawnOverrides);
  const writes = [];
  return {
    spawn,
    writes,
    input: {
      platform: 'win32',
      env: { USERPROFILE },
      authenticatedContext: authenticatedContext(),
      hostPid: 4242,
      spawnSyncFn: spawn.fn,
      readFileFn: async () => JSON.stringify({ scripts: { test: 'node --test', 'stephanos:build': 'vite build' } }),
      existsSyncFn: exists,
      fetchFn: fakeFetch,
      now: NOW,
      randomIdFn: () => '12345678-1234-1234-1234-1234567890ab',
      ensureSharedWorkspaceLayoutFn: async () => ({ ok: true }),
      writeAtomicJsonFn: async (root, segments, record) => {
        writes.push({ root, segments: [...segments], record });
        return { ok: true, path: `${root}/${segments.join('/')}` };
      },
    },
  };
}

test('command surface is closed-world and remains read-only', () => {
  assert.deepEqual(resolveOpenClawBuilderCommand('scout'), { ok: true, command: 'scout', mutationAllowed: false });
  assert.deepEqual(resolveOpenClawBuilderCommand('oc1-scout'), { ok: true, command: 'scout', mutationAllowed: false });
  assert.equal(resolveOpenClawBuilderCommand('exec whoami').ok, false);
  assert.match(renderOpenClawBuilderHelp(), /SOURCE_MUTATION=false/);
  assert.match(renderOpenClawBuilderHelp(), /ARBITRARY_SHELL=false/);
});

test('OC1 requires the authenticated OpenClaw plugin host and Windows boundary', async () => {
  const notWindows = harness();
  assert.equal((await runOpenClawOc1RepositoryScout({ ...notWindows.input, platform: 'linux' })).blocker, 'OPENCLAW_OC1_WINDOWS_REQUIRED');

  const unauthenticated = harness();
  const result = await runOpenClawOc1RepositoryScout({ ...unauthenticated.input, authenticatedContext: null });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'OPENCLAW_OC1_AUTHENTICATED_HOST_REQUIRED');
});

test('successful OC1 scout uses only fixed read operations and emits canonical execution plus Shared Workspace evidence', async () => {
  const current = harness();
  const result = await runOpenClawOc1RepositoryScout(current.input);

  assert.equal(result.ok, true);
  assert.equal(result.taskClass, OPENCLAW_OC1_TASK_CLASS);
  assert.equal(result.sourceHead, HEAD);
  assert.equal(result.mutationPerformed, false);
  assert.equal(result.arbitraryShellAllowed, false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.finalVerdict, 'OPENCLAW_OC1_REPOSITORY_SCOUT_COMPLETED');

  assert.equal(current.spawn.calls.length, 5);
  for (const call of current.spawn.calls) {
    assert.equal(call.executable, 'C:\\Program Files\\Git\\cmd\\git.exe');
    assert.equal(call.options.shell, false);
    assert.equal(call.options.windowsHide, true);
  }
  assert.deepEqual(current.spawn.calls.map((call) => call.args), [
    ['rev-parse', '--show-toplevel'],
    ['remote', 'get-url', 'origin'],
    ['rev-parse', '--abbrev-ref', 'HEAD'],
    ['rev-parse', 'HEAD'],
    ['status', '--porcelain=v1', '--untracked-files=all'],
  ]);

  assert.equal(current.writes.length, 2);
  const proofWrite = current.writes[0];
  const receiptWrite = current.writes[1];
  assert.deepEqual(proofWrite.segments.slice(0, 2), ['proofs', 'openclaw-oc1']);
  assert.equal(validateSharedWorkspaceRecord(proofWrite.record, { nowMs: NOW.getTime() }).valid, true);
  const proofBody = JSON.parse(proofWrite.record.body);
  assert.equal(proofBody.provider, 'openclaw-standalone');
  assert.equal(proofBody.taskClass, OPENCLAW_OC1_TASK_CLASS);
  assert.equal(proofBody.sourceMutationAllowed, false);
  assert.deepEqual(proofBody.packageScripts, ['stephanos:build', 'test']);

  assert.deepEqual(receiptWrite.segments.slice(0, 1), ['receipts']);
  assert.equal(validateSharedWorkspaceRecord(receiptWrite.record, { nowMs: NOW.getTime() }).valid, true);
  assert.equal(validateExecutionReceipt(receiptWrite.record.executionReceipt, {
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 1725,
    expectedHead: HEAD,
    executionId: result.executionId,
  }).valid, true);
  assert.equal(receiptWrite.record.executionReceipt.workerType, 'openclaw');
  assert.equal(receiptWrite.record.executionReceipt.state, 'completed');
  assert.equal(receiptWrite.record.executionReceipt.operatorActionRequired, false);
});

test('source dirt is reported but cannot produce a completed OC1 qualification execution receipt', async () => {
  const current = harness({ statusOutput: ' M shared/agents/openClawLocalAdapter.mjs' });
  const result = await runOpenClawOc1RepositoryScout(current.input);
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'OPENCLAW_OC1_DIRTY_SOURCE_BLOCKS_QUALIFICATION');
  assert.equal(result.mutationPerformed, false);
  assert.equal(current.writes.length, 1);
  assert.deepEqual(current.writes[0].segments.slice(0, 2), ['proofs', 'openclaw-oc1']);
});

test('runtime-only dirt does not masquerade as source dirt and path details stay out of proof', async () => {
  const current = harness({ statusOutput: ' M apps/stephanos/dist/assets/runtime.js' });
  const result = await runOpenClawOc1RepositoryScout(current.input);
  assert.equal(result.ok, true);
  const proofBody = JSON.parse(current.writes[0].record.body);
  assert.equal(proofBody.dirt.runtimeOnlyCount, 1);
  assert.equal('runtimeOnly' in proofBody.dirt, false);
  assert.doesNotMatch(current.writes[0].record.body, /apps\/stephanos\/dist/);
});

test('foreign origin, non-main branch and missing canonical checkout fail closed before qualification', async () => {
  const foreign = harness({ spawnOverrides: { 'remote get-url origin': 'https://example.invalid/stephan-os.git' } });
  assert.equal((await runOpenClawOc1RepositoryScout(foreign.input)).blocker, 'OPENCLAW_OC1_ORIGIN_MISMATCH');

  const branch = harness({ spawnOverrides: { 'rev-parse --abbrev-ref HEAD': 'feature/not-main' } });
  assert.equal((await runOpenClawOc1RepositoryScout(branch.input)).blocker, 'OPENCLAW_OC1_NON_MAIN_BRANCH');

  const missing = harness({ exists: (candidate) => candidate !== REPO_ROOT });
  assert.equal((await runOpenClawOc1RepositoryScout(missing.input)).blocker, 'OPENCLAW_OC1_CANONICAL_REPOSITORY_MISSING');
});

test('unsafe or sensitive changed paths are never emitted into bounded proof', async () => {
  const current = harness({ statusOutput: '?? credentials/private-key.txt' });
  const result = await runOpenClawOc1RepositoryScout(current.input);
  assert.equal(result.ok, false);
  const proof = current.writes[0].record;
  assert.doesNotMatch(proof.body, /private-key/i);
  const body = JSON.parse(proof.body);
  assert.equal(body.dirt.untrackedSourceCount, 1);
  assert.deepEqual(body.dirt.untrackedSource, []);
});
