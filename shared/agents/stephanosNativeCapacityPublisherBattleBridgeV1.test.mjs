import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STEPHANOS_NATIVE_CAPACITY_PUBLISHER_INSTALL_OPERATION,
  executeStephanosNativeCapacityPublisherInstallOnBattleBridge,
  validateStephanosNativeCapacityPublisherInstallCommandShape,
} from './stephanosNativeCapacityPublisherBattleBridgeV1.mjs';
import {
  BATTLE_BRIDGE_GITHUB_COMMAND_ISSUE,
  BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY,
  classifyBattleBridgeMailboxOperation,
  executeBattleBridgeGitHubCommand,
  validateBattleBridgeGitHubCommand,
} from './battleBridgeGitHubCommandMailbox.mjs';

const HEAD = 'b'.repeat(40);
const NOW = new Date('2026-09-22T17:50:00.000Z');

function command(overrides = {}) {
  return {
    schemaVersion: 'stephanos.battle-bridge-github-command.v1',
    requestId: 'native-publisher-install-v1',
    operation: STEPHANOS_NATIVE_CAPACITY_PUBLISHER_INSTALL_OPERATION,
    repository: BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY,
    issueNumber: BATTLE_BRIDGE_GITHUB_COMMAND_ISSUE,
    branch: 'main',
    operatorApproval: 'operator-approved',
    expectedHead: HEAD,
    expiresAt: '2026-09-22T18:30:00.000Z',
    ...overrides,
  };
}

function installerReceipt() {
  return `${JSON.stringify({
    finalVerdict: 'STEPHANOS_NATIVE_CAPACITY_PUBLISHER_TASK_INSTALLED',
    sourceHead: HEAD,
    startRequested: true,
    taskName: 'Stephanos Native Capacity Publisher',
    arbitraryCommandAllowed: false,
    mergeAuthority: false,
    leaseSeizureAllowed: false,
  })}\n`;
}

test('native publisher mailbox operation is exact-head control work with no caller-shaped fields', () => {
  const shaped = validateStephanosNativeCapacityPublisherInstallCommandShape(command());
  assert.equal(shaped.ok, true);
  assert.equal(shaped.requested, true);
  assert.equal(shaped.expectedHead, HEAD);
  assert.equal(classifyBattleBridgeMailboxOperation(STEPHANOS_NATIVE_CAPACITY_PUBLISHER_INSTALL_OPERATION), 'CONTROL');

  const validated = validateBattleBridgeGitHubCommand(command(), {
    authorLogin: 'Cheekyfellastef',
    now: NOW,
    authoredAt: NOW,
  });
  assert.equal(validated.ok, true);
  assert.equal(validated.command.operation, STEPHANOS_NATIVE_CAPACITY_PUBLISHER_INSTALL_OPERATION);
  assert.equal(validated.command.expectedHead, HEAD);

  const hostile = validateBattleBridgeGitHubCommand(command({ executable: 'powershell.exe' }), {
    authorLogin: 'Cheekyfellastef',
    now: NOW,
    authoredAt: NOW,
  });
  assert.equal(hostile.ok, false);
  assert.equal(hostile.blocker, 'STEPHANOS_NATIVE_PUBLISHER_FIELD_NOT_ALLOWED');
});

test('wrapper delegates only the fixed native publisher install operation', async () => {
  let calls = 0;
  const result = await executeBattleBridgeGitHubCommand(command(), {
    executeStephanosNativeCapacityPublisherInstallOnBattleBridgeFn: async (selected) => {
      calls += 1;
      assert.equal(selected.operation, STEPHANOS_NATIVE_CAPACITY_PUBLISHER_INSTALL_OPERATION);
      assert.equal(selected.expectedHead, HEAD);
      return { ok: true, verdict: 'COMMAND_EXECUTION_COMPLETE', sourceHead: HEAD };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.ok, true);
});

test('Battle Bridge executor proves exact main then invokes only the fixed installer with StartNow', async () => {
  const invocations = [];
  const spawnSyncFn = (executable, args) => {
    invocations.push({ executable, args: [...args] });
    if (args.includes('branch')) return { status: 0, stdout: 'main\n', stderr: '' };
    if (args.includes('rev-parse')) return { status: 0, stdout: `${HEAD}\n`, stderr: '' };
    if (args.includes('status')) return { status: 0, stdout: '', stderr: '' };
    return { status: 0, stdout: installerReceipt(), stderr: '' };
  };

  const result = await executeStephanosNativeCapacityPublisherInstallOnBattleBridge(command(), {
    env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    spawnSyncFn,
  });
  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'STEPHANOS_NATIVE_CAPACITY_PUBLISHER_TASK_INSTALLED_AND_STARTED');
  assert.equal(result.expectedHeadMatch, true);
  assert.equal(result.dirtSummary.blocksSync, false);
  assert.equal(invocations.length, 4);
  const statusProbe = invocations[2];
  assert.ok(statusProbe.args.includes('--untracked-files=all'));
  const installer = invocations[3];
  assert.equal(installer.executable, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.ok(installer.args.includes('-StartNow'));
  assert.ok(installer.args.some((value) => String(value).endsWith('install-stephanos-native-capacity-publisher.ps1')));
});

test('runtime-owned tracked and untracked dirt does not block native publisher activation', async () => {
  const invocations = [];
  const spawnSyncFn = (executable, args) => {
    invocations.push({ executable, args: [...args] });
    if (args.includes('branch')) return { status: 0, stdout: 'main\n', stderr: '' };
    if (args.includes('rev-parse')) return { status: 0, stdout: `${HEAD}\n`, stderr: '' };
    if (args.includes('status')) {
      return {
        status: 0,
        stdout: ' M stephanos-server/data/memory/durable-memory.json\n?? logs/native-capacity-runtime.json\n',
        stderr: '',
      };
    }
    return { status: 0, stdout: installerReceipt(), stderr: '' };
  };

  const result = await executeStephanosNativeCapacityPublisherInstallOnBattleBridge(command(), {
    env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    spawnSyncFn,
  });
  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'STEPHANOS_NATIVE_CAPACITY_PUBLISHER_TASK_INSTALLED_AND_STARTED');
  assert.deepEqual(result.dirtSummary, {
    trackedSourceCount: 0,
    untrackedSourceCount: 0,
    runtimeOnlyCount: 2,
    generatedSourceCount: 0,
    unknownCount: 0,
    blocksSync: false,
  });
  assert.equal(invocations.length, 4);
});

test('real tracked or untracked source dirt still fails closed before native publisher installation', async () => {
  const invocations = [];
  const spawnSyncFn = (executable, args) => {
    invocations.push({ executable, args: [...args] });
    if (args.includes('branch')) return { status: 0, stdout: 'main\n', stderr: '' };
    if (args.includes('rev-parse')) return { status: 0, stdout: `${HEAD}\n`, stderr: '' };
    if (args.includes('status')) {
      return {
        status: 0,
        stdout: ' M shared/agents/missionWorker.mjs\n?? shared/agents/untracked-native-source.mjs\n',
        stderr: '',
      };
    }
    throw new Error('installer must not be invoked with blocking source dirt');
  };

  const result = await executeStephanosNativeCapacityPublisherInstallOnBattleBridge(command(), {
    env: { USERPROFILE: 'C:\\Users\\Stephan Callear' },
    spawnSyncFn,
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'STEPHANOS_NATIVE_PUBLISHER_SOURCE_DIRT_BLOCKED');
  assert.deepEqual(result.dirtSummary, {
    trackedSourceCount: 1,
    untrackedSourceCount: 1,
    runtimeOnlyCount: 0,
    generatedSourceCount: 0,
    unknownCount: 0,
    blocksSync: true,
  });
  assert.equal(invocations.length, 3);
});
