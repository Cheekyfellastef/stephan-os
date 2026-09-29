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

test('authority widening is rejected before execution', () => {
  const widened = {
    ...envelope(SOVEREIGN_COMMANDER_OPERATION.GET_CONFIG),
    arbitraryUnboundedCommandAllowed: true,
  };
  const command = buildSovereignCommanderCommandV1(widened);
  assert.equal(command.dispatchAllowed, false);
  assert.ok(command.blockers.includes('command-envelope-authority-widened'));
});
