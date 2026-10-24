import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  SOVEREIGN_COMMANDER_OPERATION,
  buildSovereignCommanderCommandV1,
  executeSovereignCommanderCommandV1 as executeActualCommand,
  validateSovereignWindowsReviewIdentityV1,
} from './sovereignCommanderV1.mjs';
import { collectBattleBridgeObservation } from '../../scripts/battle-bridge-observation.mjs';
import { SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER } from './sovereignMaintenanceAdmissionV1.mjs';
import { startSovereignCommanderContinuousRepairGuardian } from '../../scripts/sovereign-commander-http.mjs';
import {
  STEPHANOS_EXECUTION_SURFACE,
  buildStephanosExecutionCommandEnvelopeV1,
  buildStephanosExecutionSurfaceCatalogV1,
} from './stephanosExecutionCommandFabricV1.mjs';

const REPO = 'C:\\Users\\Operator\\Documents\\GitHub\\stephan-os';
const OUTSIDE = 'C:\\Users\\Operator\\Downloads\\proof.txt';
// Existing executor fixtures model an explicitly idle guardian; held/unknown
// owner admission is exercised through the actual executor in its own suite.
const executeSovereignCommanderCommandV1 = (envelope, options = {}) => executeActualCommand(envelope, {
  withMaintenanceOwner: (_command, run) => run(), ...options,
});

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

test('boot daemon bootstrap remains exact-head, one-time elevated, and bounded', async () => {
  const source = await readFile(
    new URL('../../scripts/windows/install-sovereign-boot-daemon-tasks-elevated.ps1', import.meta.url),
    'utf8',
  );
  assert.match(source, /Start-Process[^\r\n]*-Verb RunAs[^\r\n]*-WindowStyle Hidden/);
  assert.match(source, /SOVEREIGN_BOOT_DAEMON_TASKS_INSTALLED_AND_PROVEN/);
  assert.match(source, /logonType -eq 'S4U'/);
  assert.match(source, /standingElevatedTaskCreated = \$false/);
  assert.match(source, /arbitraryShellAllowed = \$false/);
  assert.match(source, /mergeAuthority = \$false/);
  assert.match(source, /pcRestartAuthority = \$false/);
  assert.doesNotMatch(source, /Invoke-Expression|Restart-Computer|git\s+(?:reset|clean|checkout|switch)/i);
});

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
    routeProof: {
      commandPathProven: true,
      transport: 'authenticated-http-jsonrpc',
      authenticatedMcp: true,
      mcpSessionReady: true,
    },
    spawnSyncFn(executable, args, options) {
      observed.push({ executable, args, options });
      return { status: 0, stdout: '{"ok":true}', stderr: '' };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(observed.length, 1);
  assert.equal(observed[0].options.shell, false);
  assert.equal(observed[0].options.windowsHide, true);
  assert.equal(observed[0].options.env.STEPHANOS_SOVEREIGN_COMMANDER_COMMAND_PATH_PROVEN, '1');
  assert.equal(observed[0].options.env.STEPHANOS_SOVEREIGN_COMMANDER_COMMAND_TRANSPORT, 'authenticated-http-jsonrpc');
  assert.equal(observed[0].options.env.STEPHANOS_SOVEREIGN_COMMANDER_AUTHENTICATED_MCP, '1');
  assert.equal(observed[0].options.env.STEPHANOS_SOVEREIGN_COMMANDER_MCP_SESSION_READY, '1');
  assert.match(result.proofHash, /^[a-f0-9]{64}$/);
});

test('fixed process failure preserves a safe structured blocker from source-controlled output', async () => {
  const result = await executeSovereignCommanderCommandV1(envelope(
    SOVEREIGN_COMMANDER_OPERATION.MAINTENANCE_ACTION,
    { payload: { actionId: 'repair-control-plane' } },
  ), {
    repoRoot: REPO,
    spawnSyncFn() {
      return {
        status: 1,
        stdout: 'SOVEREIGN_COMMANDER_GOAL_BUILDER_REPAIR_RESULT=' + JSON.stringify({
          ok: false,
          blocker: 'CONTROL_PLANE_FIXED_INSTALLER_FAILED',
          finalVerdict: 'SOVEREIGN_GOAL_BUILDER_FLOW_REPAIR_BLOCKED',
        }) + '\n',
        stderr: '',
      };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'CONTROL_PLANE_FIXED_INSTALLER_FAILED');
  assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_EXECUTION_FAILED');
});

test('fixed process failure rejects unsafe structured blocker text and keeps bounded fallback', async () => {
  const result = await executeSovereignCommanderCommandV1(envelope(
    SOVEREIGN_COMMANDER_OPERATION.MAINTENANCE_ACTION,
    { payload: { actionId: 'repair-control-plane' } },
  ), {
    repoRoot: REPO,
    spawnSyncFn() {
      return {
        status: 1,
        stdout: JSON.stringify({ ok: false, blocker: 'token=secret-value' }),
        stderr: '',
      };
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'fixed-process-exit-1');
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

test('project search is bounded to the trusted repository and skips sensitive files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sovereign-commander-search-'));
  try {
    const nested = join(root, 'shared');
    await mkdir(nested);
    await writeFile(join(root, 'alpha.mjs'), 'const needle = "SOVEREIGN_SEARCH_NEEDLE";\n', 'utf8');
    await writeFile(join(nested, 'beta.md'), 'before SOVEREIGN_SEARCH_NEEDLE after\n', 'utf8');
    await writeFile(join(root, '.env'), 'SOVEREIGN_SEARCH_NEEDLE=secret\n', 'utf8');

    const searchEnvelope = buildStephanosExecutionCommandEnvelopeV1({
      catalog: buildStephanosExecutionSurfaceCatalogV1({ repositoryRoot: root }),
      surface: STEPHANOS_EXECUTION_SURFACE.SOVEREIGN_COMMANDER,
      actionId: 'search-local',
      missionId: 'local-mission',
      operation: SOVEREIGN_COMMANDER_OPERATION.SEARCH_PROJECT,
      payload: { query: 'SOVEREIGN_SEARCH_NEEDLE', maxResults: 10 },
    });
    const result = await executeSovereignCommanderCommandV1(searchEnvelope, { repoRoot: root });
    assert.equal(result.ok, true);
    assert.equal(result.structuredContent.resultCount, 2);
    assert.deepEqual(
      result.structuredContent.results.map((entry) => entry.relativePath).sort(),
      ['alpha.mjs', 'shared/beta.md'],
    );
    assert.equal(result.structuredContent.results.some((entry) => entry.relativePath === '.env'), false);
    assert.equal(result.command.arbitraryUnboundedCommandAllowed, false);
    assert.equal(result.vendorMeterRequired, false);
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


test('controller activity publication is fixed, canonical and payload-bound', () => {
  const activity = {
    schemaVersion: 'stephanos.sovereign-controller-activity-publish.v1',
    controllerId: '6ac3999164b88191a1c866c70ab51bd7',
    runId: 'controller-run-1',
    observedEnabled: true,
    executionState: 'IDLE',
  };
  const encoded = Buffer.from(JSON.stringify(activity), 'utf8').toString('base64url');
  const command = buildSovereignCommanderCommandV1(envelope(
    SOVEREIGN_COMMANDER_OPERATION.MAINTENANCE_ACTION,
    { payload: { actionId: 'publish-controller-activity', controllerActivityPayloadBase64: encoded } },
  ), { repoRoot: REPO });
  assert.equal(command.dispatchAllowed, true);
  assert.equal(command.plan.processId, 'publish-controller-activity');
  assert.match(command.plan.args[0], /sovereign-controller-activity-publish\.mjs$/i);
  assert.deepEqual(command.plan.args.slice(-2), ['--payload-base64', encoded]);
  assert.equal(command.arbitraryUnboundedCommandAllowed, false);
  assert.equal(command.mergeAuthority, false);

  const bad = Buffer.from(JSON.stringify({ ...activity, controllerId: 'not-canonical' }), 'utf8').toString('base64url');
  const blocked = buildSovereignCommanderCommandV1(envelope(
    SOVEREIGN_COMMANDER_OPERATION.MAINTENANCE_ACTION,
    { payload: { actionId: 'publish-controller-activity', controllerActivityPayloadBase64: bad } },
  ), { repoRoot: REPO });
  assert.equal(blocked.dispatchAllowed, false);
  assert.ok(blocked.blockers.includes('sovereign-controller-activity-controller-invalid'));

  const retired = Buffer.from(JSON.stringify({ ...activity, controllerId: '6a9bb24c04748191ada675a686f3b3fa' }), 'utf8').toString('base64url');
  const retiredBlocked = buildSovereignCommanderCommandV1(envelope(
    SOVEREIGN_COMMANDER_OPERATION.MAINTENANCE_ACTION,
    { payload: { actionId: 'publish-controller-activity', controllerActivityPayloadBase64: retired } },
  ), { repoRoot: REPO });
  assert.equal(retiredBlocked.dispatchAllowed, false);
  assert.ok(retiredBlocked.blockers.includes('sovereign-controller-activity-controller-invalid'));
});

test('capability pack 2 maps high-value Battle Bridge actions to fixed source-controlled executables', async () => {
  const cases = [
    ['battle-bridge-observe', /battle-bridge-observation\.mjs$/i, 10000],
    ['meter-status', /sovereign-meter-status\.mjs$/i, 10000],
    ['controller-lane-status', /sovereign-controller-lane-status\.mjs$/i, 20000],
    ['visibility-snapshot', /sovereign-commander-visibility-snapshot\.mjs$/i, 30000],
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
    ['repair-openclaw-stack', /repair-openclaw-full-stack\.ps1$/i, 195000],
    ['repair-openclaw-standalone', /repair-openclaw-agent\.ps1$/i, 180000, 'Standalone'],
    ['repair-openclaw-local', /repair-openclaw-agent\.ps1$/i, 180000, 'Local'],
    ['repair-goal-builder-flow', /sovereign-commander-goal-builder-repair\.mjs$/i, 145000],
    ['repair-stephanos', /sovereign-commander-stephanos-repair\.mjs$/i, 220000],
    ['prove-vr-atlas-runtime', /sovereign-commander-ui-runtime-proof\.mjs$/i, 60000],
    ['prove-flywheel-runtime', /sovereign-commander-flywheel-runtime-proof\.mjs$/i, 60000],
    ['reconcile-remote-commander-parity', /sovereign-commander-capability-parity-reconcile\.mjs$/i, 30000],
    ['sync-vr-reference-sources', /sync-vr-reference-sources\.ps1$/i, 180000],
  ];

  for (const [actionId, expectedPath, timeout, expectedArg = ''] of cases) {
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
    if (expectedArg) assert.ok(observed[0].args.includes(expectedArg), actionId);
    if (actionId === 'controller-lane-status') assert.deepEqual(observed[0].args.slice(1), ['--snapshot-only']);
    assert.equal(observed[0].options.shell, false, actionId);
    assert.equal(observed[0].options.windowsHide, true, actionId);
    assert.equal(observed[0].options.timeout, timeout, actionId);
    assert.equal(observed[0].options.cwd, REPO, actionId);
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


test('Battle Bridge observer module loads and returns bounded memory facts', async () => {
  const result = await collectBattleBridgeObservation({
    fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ models: [] }) }),
    spawnSyncFn: () => ({ status: 1, stdout: '', stderr: '' }),
    now: () => new Date('2026-10-02T11:20:00.000Z'),
    memory: () => ({ totalBytes: 64 * 1024 ** 3, freeBytes: 16 * 1024 ** 3 }),
    uptimeFn: () => 3600,
  });
  assert.equal(result.ok, true);
  assert.equal(result.memory.totalBytes, 64 * 1024 ** 3);
  assert.equal(result.memory.usedBytes, 48 * 1024 ** 3);
  assert.equal(result.readOnly, true);
  assert.equal(result.arbitraryShellAllowed, false);
  assert.equal(result.secretMaterialIncluded, false);
  assert.equal(result.finalVerdict, 'BATTLE_BRIDGE_OBSERVATION_READY');
});


test('OpenClaw stack repair has bounded headroom below the remote transport deadline', () => {
  const command = buildSovereignCommanderCommandV1(envelope(
    SOVEREIGN_COMMANDER_OPERATION.MAINTENANCE_ACTION,
    { payload: { actionId: 'repair-openclaw-stack' } },
  ), { repoRoot: REPO });
  assert.equal(command.dispatchAllowed, true);
  assert.equal(command.plan.processId, 'repair-openclaw-stack');
  assert.equal(command.plan.timeoutMs, 195_000);
  assert.ok(command.plan.timeoutMs < 210_000);
});

test('Sovereign private batch reads bound eight absolute paths and total content budget', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sovereign-batch-read-'));
  try {
    const first = join(root, 'one.txt');
    const second = join(root, 'two.txt');
    await writeFile(first, 'alpha\nbeta\ngamma\n', 'utf8');
    await writeFile(second, 'delta\nepsilon\n', 'utf8');
    const make = (targets) => buildStephanosExecutionCommandEnvelopeV1({
      catalog: buildStephanosExecutionSurfaceCatalogV1({ repositoryRoot: root }),
      surface: STEPHANOS_EXECUTION_SURFACE.SOVEREIGN_COMMANDER,
      actionId: 'private-batch-read',
      missionId: 'private-inspection',
      operation: SOVEREIGN_COMMANDER_OPERATION.READ_MULTIPLE_FILES,
      targetPaths: targets,
      payload: { offset: 1, length: 2 },
    });
    const result = await executeSovereignCommanderCommandV1(make([first, second]));
    assert.equal(result.ok, true);
    assert.deepEqual(result.structuredContent.files.map((file) => file.content), [
      'beta\ngamma', 'epsilon\n',
    ]);
    assert.equal(result.structuredContent.totalFiles, 2);
    assert.equal(result.vendorMeterRequired, false);
    assert.equal(result.command.arbitraryUnboundedCommandAllowed, false);
    const tooMany = await executeSovereignCommanderCommandV1(make(Array(9).fill(first)));
    assert.equal(tooMany.ok, false);
    assert.match(tooMany.blocker, /multiple-read-requires-1-to-8-absolute-targets/);
    const relative = await executeSovereignCommanderCommandV1(make(['relative.txt']));
    assert.equal(relative.ok, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Sovereign file metadata inspection does not return file contents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sovereign-file-info-'));
  try {
    const file = join(root, 'alpha.txt');
    const secretSentinel = 'NEVER_RETURN_CONTENT_OF_FILE_IN_METADATA';
    await writeFile(file, secretSentinel, 'utf8');
    const env = buildStephanosExecutionCommandEnvelopeV1({
      catalog: buildStephanosExecutionSurfaceCatalogV1({ repositoryRoot: root }),
      surface: STEPHANOS_EXECUTION_SURFACE.SOVEREIGN_COMMANDER,
      actionId: 'file-info',
      missionId: 'private-inspection',
      operation: SOVEREIGN_COMMANDER_OPERATION.GET_FILE_INFO,
      targetPaths: [file],
      payload: {},
    });
    const result = await executeSovereignCommanderCommandV1(env);
    assert.equal(result.ok, true);
    assert.equal(result.structuredContent.type, 'FILE');
    assert.equal(result.structuredContent.bytes, Buffer.byteLength(secretSentinel));
    assert.ok(result.structuredContent.modifiedAtUtc.endsWith('Z'));
    assert.equal(JSON.stringify(result).includes(secretSentinel), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test('Rescue Island one-shot probe is only a fixed read-only action with no caller arguments', () => {
  const command = buildSovereignCommanderCommandV1(envelope(
    SOVEREIGN_COMMANDER_OPERATION.MAINTENANCE_ACTION,
    { payload: { actionId: 'rescue-island-readonly-boundary',
      command: 'Remove-Item C:\\\\* -Recurse',
      customTargetPath: 'C:\\\\untrusted' } },
  ), { repoRoot: REPO });
  assert.equal(command.dispatchAllowed, true);
  assert.equal(command.plan.processId, 'rescue-island-readonly-boundary');
  assert.equal(command.plan.kind, 'fixed-process');
  assert.equal(command.plan.args.length, 1);
  assert.match(command.plan.args[0], /rescue-island-boundary-probe\.mjs$/);
  assert.doesNotMatch(JSON.stringify(command.plan), /Remove-Item|untrusted/);
  assert.equal(command.mergeAuthority, false);
  assert.equal(command.arbitraryUnboundedCommandAllowed, false);
});

test('registered Rescue Island source-only probe exercises a real physical path census', async () => {
  const { inspectRescueIslandLocalBoundaryV1 } = await import(
    '../../scripts/rescue-island-boundary-probe.mjs'
  );
  const parent = await mkdtemp(join(tmpdir(), 'island-boundary-live-test-'));
  try {
    const root = join(parent, 'canonical');
    await mkdir(join(root, '.git'), { recursive: true });
    await mkdir(join(root, 'docs', 'architecture'), { recursive: true });
    await mkdir(join(root, 'shared', 'agents'), { recursive: true });
    for (const target of ['rescueIslandFirstCommitV1.mjs', 'rescueIslandPreflightV1.test.mjs']) {
      await writeFile(join(root, 'shared', 'agents', target), '// fixture\\n');
    }
    const safe = await inspectRescueIslandLocalBoundaryV1(root);
    assert.equal(safe.ok, true);
    assert.equal(safe.observedPathCount, 3);
    assert.equal(safe.sourceMutationAllowed, false);
    assert.equal(safe.independentOwnershipAuthenticated, false);
    assert.equal(safe.originalSourceLeaseReleaseAllowed, false);
    await rm(join(root, '.git'), { recursive: true });
    const held = await inspectRescueIslandLocalBoundaryV1(root);
    assert.equal(held.ok, false);
    assert.equal(held.workerStartAllowed, false);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test('Windows calibration requires exact bounded identity and authenticated route before any process', async t => {
  for (const [key, value] of Object.entries({ NODE_OPTIONS: '--import=attacker.mjs', NODE_PATH: 'attacker' })) {
    const before = process.env[key];
    process.env[key] = value;
    t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before; });
  }
  const identity = {
    schemaVersion: 'stephanos.sovereign-review-exact-request.v1',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 1574, prNumber: 3090, branch: 'main',
    sourceHead: 'a'.repeat(40), baseSha: 'b'.repeat(40),
    implementerProvider: 'github-builder',
    implementerSessionId: 'builder-3090', reviewerSessionId: 'reviewer-3090',
    implementerPrincipal: 'builder-principal', reviewerPrincipal: 'reviewer-principal',
  };
  const build = (reviewIdentity) => buildSovereignCommanderCommandV1(envelope(
    SOVEREIGN_COMMANDER_OPERATION.MAINTENANCE_ACTION,
    { payload: { actionId: 'sovereign-windows-reviewer-calibration', reviewIdentity } },
  ), { repoRoot: REPO });
  assert.equal(build().dispatchAllowed, false, 'daemon ambient env is never sufficient');
  assert.equal(build({ ...identity, baseSha: 'x'.repeat(40) }).dispatchAllowed, false);
  assert.equal(build({ ...identity, extra: 'powershell' }).dispatchAllowed, false);
  assert.equal(build({ ...identity, reviewerPrincipal: identity.implementerPrincipal }).dispatchAllowed, false);
  const valid = build(identity);
  assert.equal(valid.dispatchAllowed, true);
  assert.equal(valid.plan.processId, 'sovereign-windows-reviewer-calibration');
  assert.deepEqual(valid.plan.reviewIdentity, identity);
  assert.equal(validateSovereignWindowsReviewIdentityV1(identity).sourceHead, identity.sourceHead);
  let calls = 0;
  const run = async routeProof => executeSovereignCommanderCommandV1(envelope(
    SOVEREIGN_COMMANDER_OPERATION.MAINTENANCE_ACTION,
    { payload: { actionId: 'sovereign-windows-reviewer-calibration', reviewIdentity: identity } },
  ), { repoRoot: REPO, routeProof, spawnSyncFn(_exe, _args, options) {
    calls++;
    assert.equal(options.shell, false);
    assert.equal(_args[0], '--experimental-loader');
    assert.match(_args[1], /^data:text\/javascript;base64,/);
    assert.match(_args[2], /sovereign-windows-review-calibration-v1\.mjs$/);
    assert.equal(_args[3], '--commander-once');
    assert.equal(_args.length, 4);
    assert.equal(options.env.NODE_OPTIONS, undefined);
    assert.equal(options.env.NODE_PATH, undefined);
    assert.equal(options.env.STEPHANOS_REVIEW_EXACT_HEAD, identity.sourceHead);
    assert.equal(options.env.STEPHANOS_REVIEW_EXACT_BASE, identity.baseSha);
    assert.equal(options.env.STEPHANOS_REVIEW_PR, '3090');
    assert.equal(options.env.STEPHANOS_REVIEW_REVIEWER_PRINCIPAL, identity.reviewerPrincipal);
    assert.equal(options.env.STEPHANOS_REVIEW_IMPLEMENTER_PRINCIPAL, identity.implementerPrincipal);
    return { status: 0, stdout: '{"candidate":true}', stderr: '' };
  } });
  const denied = await run({ commandPathProven: true, authenticatedMcp: false, mcpSessionReady: true });
  assert.equal(denied.ok, false);
  assert.equal(calls, 0, 'unqualified transport must not launch Ollama calibration');
  const passed = await run({ commandPathProven: true, authenticatedMcp: true,
    mcpSessionReady: true, transport: 'authenticated-http-jsonrpc' });
  assert.equal(passed.ok, true);
  assert.equal(calls, 1);
  assert.equal(passed.command.mergeAuthority, false);
  assert.equal(passed.command.arbitraryUnboundedCommandAllowed, false);
});


test('native reviewer setup exception retains only fixed typed preexecution denial', async () => {
  const identity = {
    schemaVersion:'stephanos.sovereign-review-exact-request.v1',
    repository:'Cheekyfellastef/stephan-os',
    issueNumber:1574,prNumber:3199,branch:'main',
    sourceHead:'a'.repeat(40),baseSha:'b'.repeat(40),
    implementerProvider:'github-builder',
    implementerSessionId:'builder-3199',reviewerSessionId:'reviewer-3199',
    implementerPrincipal:'builder-principal',reviewerPrincipal:'reviewer-principal',
  };
  let called=0;
  const result=await executeSovereignCommanderCommandV1(envelope(
    SOVEREIGN_COMMANDER_OPERATION.MAINTENANCE_ACTION,
    {payload:{actionId:'sovereign-windows-reviewer-calibration',reviewIdentity:identity}},
  ),{repoRoot:REPO,routeProof:{commandPathProven:true,authenticatedMcp:true,mcpSessionReady:true},
    spawnSyncFn(){called++;throw Error('PRIVATE_REVIEWER_EXECUTION_PATH_AND_SECRET');}});
  assert.equal(called,1);
  assert.equal(result.ok,false);
  assert.equal(result.finalVerdict,'SOVEREIGN_COMMANDER_EXECUTION_FAILED');
  assert.equal(result.command.plan.processId,'sovereign-windows-reviewer-calibration');
  assert.equal(result.blocker,'SOVEREIGN_WINDOWS_REVIEW_PREEXECUTION_UNAVAILABLE');
  assert.deepEqual(result.structuredContent,{ok:false,status:null,stdout:'',stderr:'',
    errorCode:'SOVEREIGN_WINDOWS_REVIEW_PREEXECUTION_UNAVAILABLE'});
  assert.equal(result.contentText,'');
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE_REVIEWER_EXECUTION_PATH_AND_SECRET/);
  assert.equal(result.command.mergeAuthority,false);
});

test('async reviewer spawn failures retain fixed private denial through both owner aliases', async () => {
  const identity = {
    schemaVersion: 'stephanos.sovereign-review-exact-request.v1',
    repository: 'Cheekyfellastef/stephan-os', issueNumber: 1574, prNumber: 3189,
    branch: 'main', sourceHead: 'a'.repeat(40), baseSha: 'b'.repeat(40),
    implementerProvider: 'github-builder', implementerSessionId: 'builder-3189',
    reviewerSessionId: 'reviewer-3189', implementerPrincipal: 'builder-principal',
    reviewerPrincipal: 'reviewer-principal',
  };
  for (const operation of [SOVEREIGN_COMMANDER_OPERATION.MAINTENANCE_ACTION,
    SOVEREIGN_COMMANDER_OPERATION.START_PROCESS]) {
    for (const mode of ['throw', 'error-event']) {
      let calls = 0;
      const result = await executeActualCommand(envelope(operation, { payload: {
        [operation === SOVEREIGN_COMMANDER_OPERATION.START_PROCESS ? 'processId' : 'actionId']:
          'sovereign-windows-reviewer-calibration', reviewIdentity: identity,
      } }), {
        repoRoot: REPO,
        routeProof: { commandPathProven: true, authenticatedMcp: true, mcpSessionReady: true },
        withMaintenanceOwner: (_command, execute) => execute(),
        spawnFn() {
          calls++;
          const error = Object.assign(new Error('PRIVATE_SPAWN_MESSAGE'), { code: 'PRIVATE_SPAWN_CODE' });
          if (mode === 'throw') throw error;
          const child = new EventEmitter();
          child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => false;
          queueMicrotask(() => {
            child.stdout.emit('data', 'PRIVATE_SPAWN_STDOUT');
            child.stderr.emit('data', 'PRIVATE_SPAWN_STDERR');
            child.emit('error', error);
            child.emit('close', 0, null);
          });
          return child;
        },
      });
      assert.equal(calls, 1, operation + ':' + mode);
      assert.equal(result.ok, false);
      assert.equal(result.finalVerdict, 'SOVEREIGN_COMMANDER_EXECUTION_FAILED');
      assert.equal(result.blocker, 'SOVEREIGN_WINDOWS_REVIEW_PREEXECUTION_UNAVAILABLE');
      assert.equal(result.structuredContent.status, null);
      assert.equal(result.structuredContent.errorCode, result.blocker);
      assert.equal(result.structuredContent.stdout, '');
      assert.equal(result.structuredContent.stderr, '');
      assert.equal(result.contentText, '');
      assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SPAWN_/);
      assert.equal(result.command.mergeAuthority, false);
      assert.equal(result.command.leaseSeizureAllowed, false);
    }
  }
});

test('Windows calibration preserves authenticated exact-source launch in both async owner aliases', async t => {
  const hostileEnvironment = {
    NODE_OPTIONS: '--import=attacker.mjs', NODE_PATH: 'attacker',
    STEPHANOS_REVIEW_EXACT_HEAD: 'c'.repeat(40),
    STEPHANOS_REVIEW_SESSION: 'ambient-unrelated-review',
  };
  for (const [key, value] of Object.entries(hostileEnvironment)) {
    const before = process.env[key];
    process.env[key] = value;
    t.after(() => { if (before === undefined) delete process.env[key]; else process.env[key] = before; });
  }
  const identity = {
    schemaVersion: 'stephanos.sovereign-review-exact-request.v1',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 1574, prNumber: 3090, branch: 'main',
    sourceHead: 'a'.repeat(40), baseSha: 'b'.repeat(40),
    implementerProvider: 'github-builder',
    implementerSessionId: 'builder-3090', reviewerSessionId: 'reviewer-3090',
    implementerPrincipal: 'builder-principal', reviewerPrincipal: 'reviewer-principal',
  };
  for (const operation of [SOVEREIGN_COMMANDER_OPERATION.MAINTENANCE_ACTION,
    SOVEREIGN_COMMANDER_OPERATION.START_PROCESS]) {
    let calls = 0;
    const run = (routeProof, reviewIdentity = identity) => executeActualCommand(envelope(operation, {
      payload: {
        [operation === SOVEREIGN_COMMANDER_OPERATION.START_PROCESS ? 'processId' : 'actionId']:
          'sovereign-windows-reviewer-calibration',
        reviewIdentity,
      },
    }), {
      repoRoot: REPO, routeProof,
      // A source fixture for the already-admitted owner; no synchronous
      // primitive is supplied, so this exercises the production async path.
      withMaintenanceOwner: (_command, execute) => execute(),
      spawnFn(_executable, args, options) {
        calls++;
        assert.equal(options.shell, false);
        assert.equal(args[0], '--experimental-loader');
        assert.match(args[1], /^data:text\/javascript;base64,/);
        assert.match(args[2], /sovereign-windows-review-calibration-v1\.mjs$/);
        assert.equal(args[3], '--commander-once');
        assert.equal(args.length, 4);
        const loader = Buffer.from(args[1].slice('data:text/javascript;base64,'.length), 'base64').toString();
        assert.ok(loader.includes(identity.sourceHead));
        assert.equal(options.env.NODE_OPTIONS, undefined);
        assert.equal(options.env.NODE_PATH, undefined);
        assert.equal(options.env.STEPHANOS_REVIEW_EXACT_HEAD, identity.sourceHead);
        assert.equal(options.env.STEPHANOS_REVIEW_EXACT_BASE, identity.baseSha);
        assert.equal(options.env.STEPHANOS_REVIEW_SESSION, identity.reviewerSessionId);
        assert.equal(options.env.STEPHANOS_REVIEW_REVIEWER_PRINCIPAL, identity.reviewerPrincipal);
        assert.equal(options.env.STEPHANOS_REVIEW_IMPLEMENTER_PRINCIPAL, identity.implementerPrincipal);
        const child = new EventEmitter();
        child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => false;
        queueMicrotask(() => { child.stdout.emit('data', '{"candidate":true}'); child.emit('close', 0, null); });
        return child;
      },
    });
    for (const route of [undefined, {},
      { commandPathProven: false, authenticatedMcp: true, mcpSessionReady: true },
      { commandPathProven: true, authenticatedMcp: false, mcpSessionReady: true },
      { commandPathProven: true, authenticatedMcp: true, mcpSessionReady: false }]) {
      const denied = await run(route);
      assert.equal(denied.ok, false);
      assert.equal(denied.blocker, 'SOVEREIGN_WINDOWS_REVIEW_IDENTITY_OR_TRANSPORT_UNPROVEN');
      assert.equal(calls, 0, operation + ' must refuse before spawning');
    }
    const admittedRoute = { commandPathProven: true, authenticatedMcp: true,
      mcpSessionReady: true, transport: 'authenticated-http-jsonrpc' };
    assert.equal((await run(admittedRoute, { ...identity, reviewerPrincipal: identity.implementerPrincipal })).ok, false);
    assert.equal(calls, 0, 'ambient review metadata cannot supply a missing independent identity');
    const result = await run(admittedRoute);
    assert.equal(result.ok, true);
    assert.equal(calls, 1);
    assert.equal(result.command.mergeAuthority, false);
    assert.equal(result.command.leaseSeizureAllowed, false);
  }
});


test('real maintenance owner keeps typed reviewer pre-spawn HOLD without losing guardian availability', async () => {
  const identity = {
    schemaVersion: 'stephanos.sovereign-review-exact-request.v1',
    repository: 'Cheekyfellastef/stephan-os', issueNumber: 1574, prNumber: 3189,
    branch: 'main', sourceHead: 'a'.repeat(40), baseSha: 'b'.repeat(40),
    implementerProvider: 'github-builder', implementerSessionId: 'builder-3189',
    reviewerSessionId: 'reviewer-3189', implementerPrincipal: 'builder-principal',
    reviewerPrincipal: 'reviewer-principal',
  };
  const routeProof = { commandPathProven: true, authenticatedMcp: true, mcpSessionReady: true };
  const operations = [SOVEREIGN_COMMANDER_OPERATION.MAINTENANCE_ACTION,
    SOVEREIGN_COMMANDER_OPERATION.START_PROCESS];
  for (const mode of ['throw', 'pre-spawn-error', 'post-spawn-error', 'null-close', 'signal-close']) {
    const guardian = startSovereignCommanderContinuousRepairGuardian({
      enabled: true, startDelayMs: 60_000, intervalMs: 60_000,
      setTimeoutImpl: () => ({ unref() {} }), clearTimeoutImpl: () => {},
    });
    let launches = 0;
    try {
      const attempt = operation => executeActualCommand(envelope(operation, { payload: {
        [operation === SOVEREIGN_COMMANDER_OPERATION.START_PROCESS ? 'processId' : 'actionId']:
          'sovereign-windows-reviewer-calibration', reviewIdentity: identity,
      } }), {
        repoRoot: REPO, routeProof,
        withMaintenanceOwner: (command, execute) => guardian.withMaintenanceOwner(command, execute),
        setTimeoutFn: () => ({ unref() {} }), clearTimeoutFn: () => {},
        spawnFn() {
          launches++;
          if (mode === 'throw') throw Error('PRIVATE_PRESPAWN_DATA');
          const child = new EventEmitter();
          child.stdout = new EventEmitter();
          child.stderr = new EventEmitter();
          child.kill = () => false;
          queueMicrotask(() => {
            if (mode !== 'pre-spawn-error') child.emit('spawn');
            child.stdout.emit('data', 'PRIVATE_REVIEW_OUTPUT');
            child.stderr.emit('data', 'PRIVATE_REVIEW_DIAGNOSTIC');
            if (mode === 'null-close') child.emit('close', null, '');
            else if (mode === 'signal-close') child.emit('close', 0, 'SIGTERM');
            else {
              child.emit('error', Error('PRIVATE_REVIEW_ERROR'));
              child.emit('close', 0, '');
            }
          });
          return child;
        },
      });
      const first = await attempt(operations[0]);
      assert.equal(first.ok, false, mode);
      assert.equal(launches, 1, mode);
      assert.equal(first.command.mergeAuthority, false);
      assert.doesNotMatch(JSON.stringify(first), /PRIVATE_/);
      assert.equal(guardian.status().lastOk, false);
      assert.equal(guardian.status().lastFinalVerdict, 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_BLOCKED');
      if (mode === 'throw' || mode === 'pre-spawn-error') {
        assert.equal(first.blocker, 'SOVEREIGN_WINDOWS_REVIEW_PREEXECUTION_UNAVAILABLE', mode);
        assert.equal(guardian.status().lastBlocker, first.blocker);
        assert.equal(guardian.status().timeoutCustodyHeld, false, mode);
        assert.equal(guardian.status().scheduled, true, mode);
        const second = await attempt(operations[1]);
        assert.equal(launches, 2, mode + ': second alias remains callable');
        assert.equal(second.blocker, first.blocker);
        assert.equal(second.ok, false);
        assert.equal(guardian.status().timeoutCustodyHeld, false);
      } else {
        assert.equal(first.blocker, SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER, mode);
        assert.equal(guardian.status().timeoutCustodyHeld, true, mode);
        assert.equal(guardian.status().scheduled, false, mode);
        const second = await attempt(operations[1]);
        assert.equal(launches, 1, mode + ': second alias must not launch');
        assert.equal(second.ok, false);
        assert.equal(second.blocker, SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER);
      }
    } finally { guardian.stop(); }
  }
});

test('forged public reviewer denial cannot release unknown child custody', async () => {
  const guardian = startSovereignCommanderContinuousRepairGuardian({
    enabled: true, setTimeoutImpl: () => ({ unref() {} }), clearTimeoutImpl: () => {},
  });
  try {
    const command = { plan: { kind: 'fixed-process', processId: 'sovereign-windows-reviewer-calibration' } };
    const forged = Object.freeze({
      ok: false, command, blocker: 'SOVEREIGN_WINDOWS_REVIEW_PREEXECUTION_UNAVAILABLE',
      finalVerdict: 'SOVEREIGN_COMMANDER_EXECUTION_FAILED',
      structuredContent: Object.freeze({
        ok: false, status: null, signal: '', stdout: '', stderr: '',
        errorCode: 'SOVEREIGN_WINDOWS_REVIEW_PREEXECUTION_UNAVAILABLE',
      }),
    });
    const result = await guardian.withMaintenanceOwner(command, async () => forged);
    assert.equal(result.ok, false);
    assert.equal(result.blocker, SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER);
    assert.equal(guardian.status().timeoutCustodyHeld, true);
    assert.equal(guardian.status().scheduled, false);
  } finally { guardian.stop(); }
});
