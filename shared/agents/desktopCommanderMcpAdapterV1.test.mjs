import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DESKTOP_COMMANDER_OPERATION,
  buildDesktopCommanderToolCallV1,
  executeDesktopCommanderMcpCommandV1,
} from './desktopCommanderMcpAdapterV1.mjs';
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
    surface: STEPHANOS_EXECUTION_SURFACE.DESKTOP_COMMANDER,
    actionId: 'commander-action-1',
    missionId: 'commander-mission-1',
    operation,
    targetPaths: overrides.targetPaths || [],
    payload: overrides.payload || {},
  });
}

test('Commander whole-PC file reads remain explicit bounded MCP calls', () => {
  const call = buildDesktopCommanderToolCallV1(envelope(
    DESKTOP_COMMANDER_OPERATION.READ_FILE,
    { targetPaths: [OUTSIDE], payload: { offset: 3, length: 25 } },
  ));
  assert.equal(call.dispatchAllowed, true);
  assert.equal(call.toolName, 'read_file');
  assert.deepEqual(call.arguments, { path: OUTSIDE, offset: 3, length: 25 });
  assert.equal(call.arbitraryUnboundedCommandAllowed, false);
});
test('Commander file writes and exact edits are explicit guarded MCP calls', () => {
  const write = buildDesktopCommanderToolCallV1(envelope(
    DESKTOP_COMMANDER_OPERATION.WRITE_FILE,
    { targetPaths: [OUTSIDE], payload: { content: 'bounded-content', mode: 'rewrite' } },
  ));
  assert.equal(write.dispatchAllowed, true);
  assert.equal(write.toolName, 'write_file');
  assert.deepEqual(write.arguments, { path: OUTSIDE, content: 'bounded-content', mode: 'rewrite' });

  const edit = buildDesktopCommanderToolCallV1(envelope(
    DESKTOP_COMMANDER_OPERATION.EDIT_FILE,
    { targetPaths: [OUTSIDE], payload: { oldString: 'before', newString: 'after' } },
  ));
  assert.equal(edit.dispatchAllowed, true);
  assert.equal(edit.toolName, 'edit_block');
  assert.deepEqual(edit.arguments, {
    path: OUTSIDE,
    old_string: 'before',
    new_string: 'after',
    expected_replacements: 1,
  });
  assert.equal(edit.mergeAuthority, false);
  assert.equal(edit.arbitraryUnboundedCommandAllowed, false);
});

test('Commander maintenance actions come only from the fixed registry', () => {
  const call = buildDesktopCommanderToolCallV1(envelope(
    DESKTOP_COMMANDER_OPERATION.MAINTENANCE_ACTION,
    { payload: { actionId: 'restart-stephanos-runtime', command: 'Remove-Item C:\\* -Recurse' } },
  ), { repoRoot: REPO });
  assert.equal(call.dispatchAllowed, true);
  assert.equal(call.toolName, 'start_process');
  assert.match(call.arguments.command, /restart-approved-stephanos-runtime\.ps1/);
  assert.doesNotMatch(call.arguments.command, /Remove-Item/);

  const blocked = buildDesktopCommanderToolCallV1(envelope(
    DESKTOP_COMMANDER_OPERATION.MAINTENANCE_ACTION,
    { payload: { actionId: 'caller-invented-action' } },
  ), { repoRoot: REPO });
  assert.equal(blocked.dispatchAllowed, false);
  assert.ok(blocked.blockers.includes('desktop-commander-maintenance-action-not-registered'));
});

test('unregistered Commander operations fail closed', () => {
  const call = buildDesktopCommanderToolCallV1(envelope('RAW_POWERSHELL', {
    payload: { command: 'whoami' },
  }));
  assert.equal(call.dispatchAllowed, false);
  assert.ok(call.blockers.includes('desktop-commander-operation-not-registered'));
});
test('MCP execution requires advertised tool capability and produces a proof hash', async () => {
  const observed = [];
  const client = {
    async listTools() {
      return { tools: [{ name: 'get_config' }] };
    },
    async callTool(input) {
      observed.push(input);
      return { content: [{ type: 'text', text: 'config-ok' }], structuredContent: { ok: true } };
    },
  };
  const result = await executeDesktopCommanderMcpCommandV1(
    envelope(DESKTOP_COMMANDER_OPERATION.GET_CONFIG),
    { client },
  );
  assert.equal(result.ok, true);
  assert.equal(result.finalVerdict, 'DESKTOP_COMMANDER_MCP_TOOL_COMPLETED');
  assert.match(result.proofHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(observed, [{ name: 'get_config', arguments: {} }]);
});

test('MCP execution blocks when the required Commander tool is absent', async () => {
  const result = await executeDesktopCommanderMcpCommandV1(
    envelope(DESKTOP_COMMANDER_OPERATION.READ_FILE, { targetPaths: [OUTSIDE] }),
    { client: { async listTools() { return { tools: [] }; } } },
  );
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'desktop-commander-required-tool-missing');
});
