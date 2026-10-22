import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import {
  executeStephanosNativeAction,
  parseStephanosNativeFocusedTestCommand,
} from './missionOrchestratorStephanosNativeExecutor.js';

const HEAD = 'a'.repeat(40);
const BRANCH = 'openclaw/native-executor-test';
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const SOURCE_PATH = 'shared/agents/native-executor-fixture.mjs';
const TEST_COMMAND = 'node --test shared/agents/native-executor-fixture.test.mjs';
const NOW = new Date('2026-09-18T18:30:00.000Z');
const hash = (value) => createHash('sha256').update(value).digest('hex');

async function fixture({ testStatus = 0 } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-native-executor-'));
  const worktreePath = join(root, 'worktree');
  const workspaceRoot = join(root, 'workspace');
  const sourceFile = join(worktreePath, SOURCE_PATH);
  const before = 'export const value = 1;\n';
  const after = 'export const value = 2;\n';
  await import('node:fs/promises').then(({ mkdir }) => mkdir(join(worktreePath, 'shared', 'agents'), { recursive: true }));
  await writeFile(sourceFile, before, 'utf8');

  const action = {
    schemaVersion: 'stephanos.mission-worker-action.v1',
    actionId: 'critical-2009-r1-native',
    missionId: 'critical-2009-native-executor',
    actionKind: 'agent-handoff',
    adapter: 'stephanos-native',
    capacityRoute: 'STEPHANOS_NATIVE',
    capacityReceiptId: 'native-capacity-receipt-1',
    capacityProofRefs: ['proof/native-capacity.json'],
    owner: 'stephanos-native-battle-bridge',
    activeWriter: 'stephanos-native-battle-bridge',
    operatorIntent: 'Repair one bounded source file.',
    intendedOutcome: 'The fixture exports value 2.',
    repository: REPOSITORY,
    worktreePath,
    branch: BRANCH,
    allowedFiles: [SOURCE_PATH],
    requiredTests: [TEST_COMMAND],
    requiredEvidence: ['focused test output'],
    repairRound: 0,
    executable: true,
  };
  const grant = {
    schemaVersion: 'stephanos.mission-worker-action-grant.v1',
    controllerId: 'durable-flywheel-controller',
    grantId: 'native-grant-1',
    sourceRevision: HEAD,
    boundedActionCount: 1,
    missionId: action.missionId,
    missionRevision: 1,
    currentPhase: 'AGENT_IMPLEMENTATION',
    actionId: action.actionId,
    actionKind: action.actionKind,
    adapter: 'stephanos-native',
    workerId: 'stephanos-native-battle-bridge',
    operation: '',
    capacityRoute: 'STEPHANOS_NATIVE',
    capacityReceiptId: action.capacityReceiptId,
    capacityProofRefs: action.capacityProofRefs,
    repository: REPOSITORY,
    issueNumber: 2009,
    prNumber: null,
    branch: BRANCH,
    headSha: null,
    mergeAuthority: false,
    leaseSeizureAllowed: false,
  };
  const claim = {
    item: {
      actionId: action.actionId,
      missionId: action.missionId,
      createdAt: NOW.toISOString(),
      actionGrant: grant,
      executionBinding: {
        schemaVersion: 'stephanos.mission-worker-queue-execution-binding.v1',
        executionId: action.actionId,
        leaseKey: 'critical-2009-native-executor-r1-lease',
        grantId: grant.grantId,
        missionId: action.missionId,
        missionRevision: 1,
        repository: REPOSITORY,
        issueNumber: 2009,
        prNumber: null,
        branch: BRANCH,
        headSha: '',
        sourceRevision: HEAD,
      },
      payload: action,
    },
  };
  const runCommand = (executable, args) => {
    if (executable === 'git.exe') {
      if (args.includes('--abbrev-ref')) return { status: 0, stdout: `${BRANCH}\n`, stderr: '' };
      if (args.includes('status')) return { status: 0, stdout: '', stderr: '' };
      if (args.includes('diff')) return { status: 0, stdout: `${SOURCE_PATH}\n`, stderr: '' };
      if (args.includes('rev-parse')) return { status: 0, stdout: `${HEAD}\n`, stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    }
    if (executable === process.execPath && args[0] === '--test') {
      return { status: testStatus, stdout: testStatus === 0 ? 'tests passed\n' : '', stderr: testStatus === 0 ? '' : 'tests failed\n' };
    }
    throw new Error(`Unexpected command: ${executable} ${args.join(' ')}`);
  };
  const readVerifiedCandidate = async () => ({
    ok: true,
    reason: 'STEPHANOS_NATIVE_ROUTING_CANDIDATE_VERIFIED',
    candidate: {
      route: 'STEPHANOS_NATIVE',
      adapter: 'stephanos-native',
      workerId: 'stephanos-native-battle-bridge',
      repository: REPOSITORY,
      sourceHead: HEAD,
      taskClass: 'FOCUSED_REPAIR',
      provider: 'ollama-local',
      transport: 'http-loopback-fixed',
      endpoint: 'http://127.0.0.1:11434',
      model: 'qwen:14b',
      capacityReceiptId: action.capacityReceiptId,
      proofRefs: action.capacityProofRefs,
      sourceMutationAllowed: true,
      arbitraryCommandAllowed: false,
      mergeAuthority: false,
      leaseSeizureAllowed: false,
      duplicateDispatchAllowed: false,
    },
  });
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({
      model: 'qwen:14b',
      message: {
        content: JSON.stringify({
          schemaVersion: 'stephanos.native-model-result.v1',
          missionId: action.missionId,
          actionId: action.actionId,
          baseHead: HEAD,
          replacements: [{ path: SOURCE_PATH, beforeSha256: hash(before), content: after }],
          summary: 'bounded fixture repair',
        }),
      },
    }),
  });
  return {
    root,
    worktreePath,
    workspaceRoot,
    sourceFile,
    before,
    after,
    action,
    claim,
    options: {
      testOnly: true,
      now: NOW,
      repoRoot: worktreePath,
      sharedWorkspaceRoot: workspaceRoot,
      runCommand,
      readVerifiedCandidate,
      readSourceMutationLease: async () => ({ ok: true, present: false, reason: 'SOURCE_MUTATION_LEASE_NOT_CLAIMED', record: null, validation: null }),
      fetchImpl,
    },
  };
}

test('native focused tests reject shell and accept direct node test only', () => {
  assert.equal(parseStephanosNativeFocusedTestCommand(TEST_COMMAND).ok, true);
  for (const command of [
    'cmd.exe /c node --test shared/agents/native-executor-fixture.test.mjs',
    'node --test shared/agents/a.test.mjs && del important.txt',
    'powershell -Command node --test shared/agents/a.test.mjs',
  ]) assert.equal(parseStephanosNativeFocusedTestCommand(command).ok, false);
});

test('native executor performs one exact verified source repair and focused test', async () => {
  const value = await fixture();
  const result = await executeStephanosNativeAction(value.action, value.claim, value.options);
  assert.equal(result.success, true);
  assert.equal(result.stage, 'TESTED');
  assert.equal(result.testsPassed, true);
  assert.deepEqual(result.changedFiles, [SOURCE_PATH]);
  assert.equal(result.nativeStagingReceipt.promotionEligible, true);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.leaseSeizureAllowed, false);
  assert.equal(await readFile(value.sourceFile, 'utf8'), value.after);
  assert.equal(result.sourceTestReceipts[0].testCommand, TEST_COMMAND);
});

test('native executor rolls the source file back when the focused test fails', async () => {
  const value = await fixture({ testStatus: 1 });
  await assert.rejects(
    () => executeStephanosNativeAction(value.action, value.claim, value.options),
    /STEPHANOS_NATIVE_FOCUSED_TEST_FAILED/,
  );
  assert.equal(await readFile(value.sourceFile, 'utf8'), value.before);
});
