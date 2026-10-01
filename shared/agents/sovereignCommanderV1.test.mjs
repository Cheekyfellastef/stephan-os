import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  SOVEREIGN_COMMANDER_OPERATION,
  buildSovereignCommanderCommandV1,
  executeSovereignCommanderCommandV1,
} from './sovereignCommanderV1.mjs';
import {
  STEPHANOS_EXECUTION_SURFACE,
  buildStephanosExecutionCommandEnvelopeV1,
  buildStephanosExecutionSurfaceCatalogV1,
} from './stephanosExecutionCommandFabricV1.mjs';

const REPO = 'C:\\Users\\Operator\\Documents\\GitHub\\stephan-os';
const OUTSIDE = 'C:\\Users\\Operator\\Downloads\\proof.txt';

function envelope(operation, overrides = {}) {
  return buildStephanosExecutionCommandEnvelopeV1({
    catalog: buildStephanosExecutionSurfaceCatalogV1({ repositoryRoot: REPO }),
    surface: STEPHANOS_EXECUTION_SURFACE.SOVEREIGN_COMMANDER,
    actionId: 'sovereign-action-1',
    missionId: 'sovereign-mission-1',
    operation,
    targetPaths: overrides.targetPaths || [],
    payload: overrides.payload || {},
  });
}

test('Sovereign Commander config proves local unmetered bounded posture', async () => {
  const result = await executeSovereignCommanderCommandV1(envelope(SOVEREIGN_COMMANDER_OPERATION.GET_CONFIG));
  assert.equal(result.ok, true);
  assert.equal(result.structuredContent.implementation, 'stephanos-local-node');
  assert.equal(result.structuredContent.canEditFiles, true);
  assert.equal(result.structuredContent.canRunFocusedNodeTests, false);
  assert.equal(result.structuredContent.sourceControlledMaintenanceOnly, true);
  assert.equal(result.structuredContent.vendorMeterRequired, false);
  assert.equal(result.structuredContent.externalSaasRelayRequired, false);
  assert.equal(result.structuredContent.arbitraryUnboundedCommandAllowed, false);
  assert.equal(result.structuredContent.mergeAuthority, false);
  assert.match(result.proofHash, /^[a-f0-9]{64}$/);
});

test('Sovereign Commander whole-PC read remains an explicit bounded operation', () => {
  const command = buildSovereignCommanderCommandV1(envelope(
    SOVEREIGN_COMMANDER_OPERATION.READ_FILE,
    { targetPaths: [OUTSIDE], payload: { offset: 3, length: 25 } },
  ));
  assert.equal(command.dispatchAllowed, true);
  assert.equal(command.plan.kind, 'read-file');
  assert.equal(command.plan.offset, 3);
  assert.equal(command.plan.length, 25);
  assert.equal(command.arbitraryUnboundedCommandAllowed, false);
  assert.equal(command.vendorMeterRequired, false);
});

test('caller supplied shell text cannot widen fixed process execution', () => {
  const command = buildSovereignCommanderCommandV1(envelope(
    SOVEREIGN_COMMANDER_OPERATION.START_PROCESS,
    { payload: { processId: 'battle-bridge-status', command: 'Remove-Item C:\\* -Recurse' } },
  ), { repoRoot: REPO });
  assert.equal(command.dispatchAllowed, true);
  assert.equal(command.plan.processId, 'battle-bridge-status');
  assert.doesNotMatch(JSON.stringify(command.plan), /Remove-Item/);

  const blocked = buildSovereignCommanderCommandV1(envelope(
    SOVEREIGN_COMMANDER_OPERATION.START_PROCESS,
    { payload: { processId: 'caller-invented-process', command: 'whoami' } },
  ), { repoRoot: REPO });
  assert.equal(blocked.dispatchAllowed, false);
  assert.ok(blocked.blockers.includes('sovereign-commander-process-not-registered'));
});

test('fixed process execution uses the registered executable and emits proof', async () => {
  const observed = [];
  const result = await executeSovereignCommanderCommandV1(envelope(
    SOVEREIGN_COMMANDER_OPERATION.MAINTENANCE_ACTION,
    { payload: { actionId: 'battle-bridge-status' } },
  ), {
    repoRoot: REPO,
    spawnSyncFn(executable, args, options) {
      observed.push({ executable, args, options });
      return { status: 0, stdout: '{"ok":true}', stderr: '' };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(observed.length, 1);
  assert.equal(observed[0].options.shell, false);
  assert.equal(observed[0].options.windowsHide, true);
  assert.match(result.proofHash, /^[a-f0-9]{64}$/);
});

test('read and directory operations execute without an external Commander package', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sovereign-commander-'));
  try {
    const child = join(root, 'child');
    await mkdir(child);
    const file = join(root, 'alpha.txt');
    await writeFile(file, 'zero\none\ntwo\nthree\n', 'utf8');

    const readEnvelope = buildStephanosExecutionCommandEnvelopeV1({
      catalog: buildStephanosExecutionSurfaceCatalogV1({ repositoryRoot: root }),
      surface: STEPHANOS_EXECUTION_SURFACE.SOVEREIGN_COMMANDER,
      actionId: 'read-local',
      missionId: 'local-mission',
      operation: SOVEREIGN_COMMANDER_OPERATION.READ_FILE,
      targetPaths: [file],
      payload: { offset: 1, length: 2 },
    });
    const read = await executeSovereignCommanderCommandV1(readEnvelope);
    assert.equal(read.ok, true);
    assert.equal(read.contentText, 'one\ntwo');

    const listEnvelope = buildStephanosExecutionCommandEnvelopeV1({
      catalog: buildStephanosExecutionSurfaceCatalogV1({ repositoryRoot: root }),
      surface: STEPHANOS_EXECUTION_SURFACE.SOVEREIGN_COMMANDER,
      actionId: 'list-local',
      missionId: 'local-mission',
      operation: SOVEREIGN_COMMANDER_OPERATION.LIST_DIRECTORY,
      targetPaths: [root],
      payload: { depth: 2 },
    });
    const list = await executeSovereignCommanderCommandV1(listEnvelope);
    assert.equal(list.ok, true);
    assert.ok(list.structuredContent.entries.some((entry) => entry.path.endsWith('alpha.txt')));
    assert.ok(list.structuredContent.entries.some((entry) => entry.path.endsWith('child')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('bounded write and exact edit work without arbitrary shell', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sovereign-commander-edit-'));
  try {
    const file = join(root, 'beta.txt');
    const writeEnvelope = buildStephanosExecutionCommandEnvelopeV1({
      catalog: buildStephanosExecutionSurfaceCatalogV1({ repositoryRoot: root }),
      surface: STEPHANOS_EXECUTION_SURFACE.SOVEREIGN_COMMANDER,
      actionId: 'write-local',
      missionId: 'local-mission',
      operation: SOVEREIGN_COMMANDER_OPERATION.WRITE_FILE,
      targetPaths: [file],
      payload: { content: 'alpha beta gamma', mode: 'rewrite' },
    });
    const written = await executeSovereignCommanderCommandV1(writeEnvelope);
    assert.equal(written.ok, true);

    const editEnvelope = buildStephanosExecutionCommandEnvelopeV1({
      catalog: buildStephanosExecutionSurfaceCatalogV1({ repositoryRoot: root }),
      surface: STEPHANOS_EXECUTION_SURFACE.SOVEREIGN_COMMANDER,
      actionId: 'edit-local',
      missionId: 'local-mission',
      operation: SOVEREIGN_COMMANDER_OPERATION.EDIT_FILE,
      targetPaths: [file],
      payload: { oldString: 'beta', newString: 'delta' },
    });
    const edited = await executeSovereignCommanderCommandV1(editEnvelope);
    assert.equal(edited.ok, true);

    const readEnvelope = buildStephanosExecutionCommandEnvelopeV1({
      catalog: buildStephanosExecutionSurfaceCatalogV1({ repositoryRoot: root }),
      surface: STEPHANOS_EXECUTION_SURFACE.SOVEREIGN_COMMANDER,
      actionId: 'read-edited',
      missionId: 'local-mission',
      operation: SOVEREIGN_COMMANDER_OPERATION.READ_FILE,
      targetPaths: [file],
    });
    const read = await executeSovereignCommanderCommandV1(readEnvelope);
    assert.equal(read.contentText, 'alpha delta gamma');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('caller-selected node tests are disabled because writable test files are executable code', () => {
  const blocked = buildSovereignCommanderCommandV1(envelope(
    SOVEREIGN_COMMANDER_OPERATION.RUN_NODE_TEST,
    { targetPaths: [REPO + '\\fixture.test.mjs'] },
  ), { repoRoot: REPO });
  assert.equal(blocked.dispatchAllowed, false);
  assert.ok(blocked.blockers.includes('sovereign-commander-node-test-disabled-use-source-controlled-maintenance-action'));
});

test('qwen3.5 canary is a fixed source-controlled maintenance action with a bounded long timeout', async () => {
  const observed = [];
  const result = await executeSovereignCommanderCommandV1(envelope(
    SOVEREIGN_COMMANDER_OPERATION.MAINTENANCE_ACTION,
    { payload: { actionId: 'qwen35-canary' } },
  ), {
    repoRoot: REPO,
    spawnSyncFn(executable, args, options) {
      observed.push({ executable, args, options });
      return { status: 0, stdout: '{"ok":true,"finalVerdict":"QWEN35_CANARY_GREEN"}', stderr: '' };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(observed.length, 1);
  assert.match(observed[0].args[0], /qwen35-canary\.mjs$/i);
  assert.equal(observed[0].options.shell, false);
  assert.equal(observed[0].options.windowsHide, true);
  assert.equal(observed[0].options.timeout, 180000);
});


test('capability pack 2 maps high-value Battle Bridge actions to fixed source-controlled executables', async () => {
  const cases = [
    ['ignite-stephanos', /run-battle-bridge-ignition\.mjs$/i, 180000],
    ['repair-battle-bridge', /battle-bridge-repair\.mjs$/i, 120000],
    ['repair-control-plane', /sovereign-commander-control-plane-repair\.mjs$/i, 180000],
    ['goal-discovery-heartbeat', /battle-bridge-goal-discovery-heartbeat\.mjs$/i, 60000],
    ['fleet-goal-supervisor', /sovereign-commander-fleet-goal-supervisor\.mjs$/i, 60000],
    ['start-mission-orchestrator-worker', /start-mission-orchestrator-worker-task\.ps1$/i, 30000],
    ['status-mission-orchestrator-worker', /status-mission-orchestrator-worker-autostart\.ps1$/i, 10000],
    ['start-stephanos-backend', /start-stephanos-backend\.ps1$/i, 180000],
    ['status-stephanos-backend', /status-stephanos-backend-autostart\.ps1$/i, 60000],
    ['status-openclaw-whatsapp', /status-openclaw-stephanos-whatsapp-command\.ps1$/i, 30000],
    ['repair-openclaw-ignite', /repair-openclaw-stephanos-ignite-command\.ps1$/i, 60000],
    ['repair-openclaw-stack', /repair-openclaw-full-stack\.ps1$/i, 120000],
  ];

  for (const [actionId, expectedPath, timeout] of cases) {
    const observed = [];
    const result = await executeSovereignCommanderCommandV1(envelope(
      SOVEREIGN_COMMANDER_OPERATION.MAINTENANCE_ACTION,
      { payload: { actionId } },
    ), {
      repoRoot: REPO,
      spawnSyncFn(executable, args, options) {
        observed.push({ executable, args, options });
        return { status: 0, stdout: '{"ok":true}', stderr: '' };
      },
    });
    assert.equal(result.ok, true, actionId);
    assert.equal(observed.length, 1, actionId);
    assert.match(observed[0].args.find((arg) => /\.(?:mjs|ps1)$/i.test(arg)) || '', expectedPath, actionId);
    assert.equal(observed[0].options.shell, false, actionId);
    assert.equal(observed[0].options.windowsHide, true, actionId);
    assert.equal(observed[0].options.timeout, timeout, actionId);
  }
});

test('authority widening is rejected before execution', () => {
  const widened = {
    ...envelope(SOVEREIGN_COMMANDER_OPERATION.GET_CONFIG),
    arbitraryUnboundedCommandAllowed: true,
  };
  const command = buildSovereignCommanderCommandV1(widened);
  assert.equal(command.dispatchAllowed, false);
  assert.ok(command.blockers.includes('command-envelope-authority-widened'));
});
