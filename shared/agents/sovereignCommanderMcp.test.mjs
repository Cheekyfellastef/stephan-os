import test from 'node:test';
// The existing Sovereign Commander MCP CI job also exercises Starfield's read-only archive contract.
import '../../scripts/starfield-vr-telemetry-archive.test.mjs';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { resolve } from 'node:path';
import { buildSovereignCommanderCommandV1, executeSovereignCommanderCommandV1 } from './sovereignCommanderV1.mjs';
import {
  createSovereignCommanderMcpHandler,
  runSovereignCommanderStdioMcpServer,
  SOVEREIGN_COMMANDER_INSPECTION_ACTIONS,
} from '../../scripts/sovereign-commander-mcp.mjs';

test('core daemon diagnosis is discoverable and executes only the existing fixed Windows probe', async () => {
  const calls = [];
  const handler = createSovereignCommanderMcpHandler({
    repoRoot: 'C:\\repo',
    executor: (envelope, options) => executeSovereignCommanderCommandV1(envelope, {
      ...options,
      spawnSyncFn: (executable, args, settings) => {
        calls.push({ executable, args, settings });
        return { status: 0, stdout: '{"daemonHealthy":false,"readiness":"UNKNOWN"}', stderr: '' };
      },
    }),
  });
  await handler('initialize', { protocolVersion: '2025-11-25' }, { isRequest: true });
  await handler('notifications/initialized', {}, { isNotification: true });
  const listed = await handler('tools/list', {}, { isRequest: true });
  const maintenance = listed.tools.find(({ name }) => name === 'maintenance_action');
  assert.ok(maintenance.inputSchema.properties.actionId.enum.includes('status-stephanos-core-daemon'));
  const result = await handler('tools/call', {
    name: 'inspect_battle_bridge',
    arguments: { actionId: 'status-stephanos-core-daemon' },
  }, { isRequest: true });
  assert.equal(result.isError, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].executable, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.deepEqual(calls[0].args, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', resolve('C:\\repo', 'scripts', 'windows', 'status-stephanos-core-daemon.ps1')]);
  assert.equal(calls[0].settings.shell, false);
  assert.equal(calls[0].settings.windowsHide, true);
  assert.equal(calls[0].settings.timeout, 10_000);
  assert.match(result.structuredContent.proofHash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.parse(result.structuredContent.contentText).daemonHealthy, false);
  assert.equal(result.structuredContent.command.mergeAuthority, false);
  assert.equal(result.structuredContent.command.pcRestartAuthority, false);
});

test('read-only inspection admits every fixed diagnostic and rejects repair/shell input before execution', async () => {
  const observed = [];
  const handler = createSovereignCommanderMcpHandler({
    repoRoot: 'C:\\repo',
    executor: async (envelope) => {
      observed.push(envelope);
      return { ok: true, proofHash: 'd'.repeat(64) };
    },
  });
  await handler('initialize', { protocolVersion: '2025-11-25' }, { isRequest: true });
  await handler('notifications/initialized', {}, { isNotification: true });
  const listed = await handler('tools/list', {}, { isRequest: true });
  const tool = listed.tools.find(({ name }) => name === 'inspect_battle_bridge');
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.equal(tool.annotations.destructiveHint, false);
  assert.deepEqual(tool.inputSchema.properties.actionId.enum, SOVEREIGN_COMMANDER_INSPECTION_ACTIONS);
  assert.equal(SOVEREIGN_COMMANDER_INSPECTION_ACTIONS.includes('gaming-resource-status'), false, 'governor Status may reconcile and mutate runtime');
  for (const actionId of SOVEREIGN_COMMANDER_INSPECTION_ACTIONS) {
    const result = await handler('tools/call', { name: tool.name, arguments: { actionId } }, { isRequest: true });
    assert.equal(result.isError, false);
    assert.equal(observed.at(-1).operation, 'MAINTENANCE_ACTION');
    assert.deepEqual(observed.at(-1).payload, { actionId });
    assert.deepEqual(observed.at(-1).targetPaths, []);
  }
  const before = observed.length;
  for (const args of [
    {}, { actionId: 'repair-control-plane' }, { actionId: 'vr-resource-governor' },
    { actionId: 'gaming-resource-prepare' }, { actionId: 'gaming-resource-force-on' },
    { actionId: 'restart-stephanos-runtime' }, { actionId: 'arbitrary-shell' },
    { actionId: 'cpu-pressure-snapshot', command: 'Stop-Process -Id 123' },
    { actionId: 'battle-bridge-observe', path: 'C:\\secret' },
    { actionId: 'status-stephanos-core-daemon', processId: 'repair-control-plane' },
    Object.create({ actionId: 'cpu-pressure-snapshot' }),
    { get actionId() { throw new Error('accessor must not run'); } },
    { actionId: 'cpu-pressure-snapshot', [Symbol('scope')]: true },
  ]) {
    const result = await handler('tools/call', { name: tool.name, arguments: args }, { isRequest: true });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.blocker, 'SOVEREIGN_INSPECTION_ACTION_INVALID');
  }
  assert.equal(observed.length, before, 'rejected input never reaches the executor');
});

test('inspection preserves existing maintenance-owner holds while admitted observations remain reachable', async () => {
  let ownerCalls = 0, processCalls = 0;
  const held = 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_TIMEOUT_CUSTODY_UNPROVEN';
  const handler = createSovereignCommanderMcpHandler({
    repoRoot: 'C:\\repo',
    withMaintenanceOwner: async command => {
      ownerCalls++;
      assert.equal(command.plan.processId, 'starfield-vr-performance-diagnosis');
      return { ok: false, command, blocker: held, finalVerdict: 'SOVEREIGN_COMMANDER_EXECUTION_BLOCKED' };
    },
    executor: (envelope, options) => executeSovereignCommanderCommandV1(envelope, {
      ...options,
      spawnSyncFn: () => {
        processCalls++;
        return { status: 0, stdout: '{}', stderr: '' };
      },
    }),
  });
  const request = { id: 1, isRequest: true, transportAuthenticated: true };
  await handler('initialize', {}, request);
  await handler('notifications/initialized', {}, { isNotification: true });
  await handler('tools/list', {}, request);
  const invoke = actionId => handler('tools/call', {
    name: 'inspect_battle_bridge', arguments: { actionId },
  }, request);
  const blocked = await invoke('starfield-vr-performance-diagnosis');
  assert.equal(blocked.isError, true);
  assert.equal(blocked.structuredContent.blocker, held);
  assert.equal(ownerCalls, 1);
  assert.equal(processCalls, 0, 'a read-only tool annotation cannot bypass owner admission');
  assert.equal((await invoke('status-stephanos-core-daemon')).isError, false);
  assert.equal(ownerCalls, 1);
  assert.equal(processCalls, 1, 'the canonical observation exemption remains available');
});

test('private Core maintenance keeps exact-head binding and rejects scope/authority extras', async () => {
  const seen = [];
  const handler = createSovereignCommanderMcpHandler({ repoRoot: 'C:\\repo',
    executor: async (envelope, options) => {
      seen.push({ envelope, options });
      return { ok: true, executionCustodyReleased: true, finalVerdict: 'SOURCE_TEST_ONLY' };
    } });
  const request = { id: 5, isRequest: true, isNotification: false, transportAuthenticated: true };
  await handler('initialize', { protocolVersion: '2025-11-25' }, request);
  await handler('notifications/initialized', {}, { isRequest: false, isNotification: true });
  const listed = await handler('tools/list', {}, request);
  assert.equal(listed.tools.find(t => t.name === 'maintenance_action').inputSchema.properties.actionId.enum
    .includes('repair-core-publication-directories'), false, 'unqualified candidate must not be advertised');
  const args = { actionId: 'repair-core-publication-directories', expectedMain: 'a'.repeat(40) };
  assert.equal((await handler('tools/call', { name: 'maintenance_action', arguments: args }, request)).isError, false);
  assert.deepEqual(seen[0].envelope.payload, args);
  assert.equal(seen[0].options.routeProof.authenticatedMcp, true);
  await assert.rejects(handler('tools/call', { name: 'maintenance_action',
    arguments: { ...args, specialistQualified: true } }, request), /CORE_DIRECTORY_FIXED_SCOPE_REQUIRED/);
  assert.equal(seen.length, 1);
});

test('Core cancellation stays on the original session/request and never dispatches a retry', async () => {
  let signal, dispatched = 0, started;
  const ready = new Promise(resolve => { started = resolve; });
  const handler = createSovereignCommanderMcpHandler({ repoRoot: 'C:\\repo',
    executor: async (_envelope, options) => {
      dispatched++; signal = options.signal; started();
      await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
      return { ok: false, executionCustodyReleased: true, blocker: 'ORIGINAL_REQUEST_CANCELLED' };
    } });
  const request = { id: 10, isRequest: true, isNotification: false, transportAuthenticated: true };
  await handler('initialize', { protocolVersion: '2025-11-25' }, request);
  await handler('notifications/initialized', {}, { isRequest: false, isNotification: true });
  await handler('tools/list', {}, request);
  const params = { name: 'maintenance_action', arguments: {
    actionId: 'repair-core-publication-directories', expectedMain: 'a'.repeat(40) } };
  const pending = handler('tools/call', params, request);
  await ready;
  const busy = await handler('tools/call', params, { ...request, id: 11 });
  assert.equal(busy.isError, true); assert.equal(dispatched, 1);
  const note = { isRequest: false, isNotification: true, transportAuthenticated: true };
  await handler('notifications/cancelled', { requestId: 11 }, note);
  await handler('notifications/cancelled', { requestId: 10 }, { ...note, transportAuthenticated: false });
  assert.equal(signal.aborted, false);
  await handler('notifications/cancelled', { requestId: 10 }, note);
  assert.equal((await pending).isError, true); assert.equal(signal.aborted, true);
  assert.equal(dispatched, 1);
});

test('Core admission is shared across sessions while cancellation stays with the original session', async () => {
  let release, signal, calls = 0;
  const params = { name: 'maintenance_action', arguments: {
    actionId: 'repair-core-publication-directories', expectedMain: 'a'.repeat(40) } };
  const request = { id: 10, isRequest: true, isNotification: false, transportAuthenticated: true };
  const make = async () => {
    const handler = createSovereignCommanderMcpHandler({ repoRoot: 'C:\\repo', executor: async (_e, o) => {
      calls++; signal = o.signal;
      await new Promise(resolve => { release = resolve; });
      return { ok: true, executionCustodyReleased: true };
    } });
    await handler('initialize', {}, request);
    await handler('notifications/initialized', {}, { isNotification: true, isRequest: false });
    await handler('tools/list', {}, request);
    return handler;
  };
  const a = await make(), b = await make();
  const pending = a('tools/call', params, request);
  assert.equal((await b('tools/call', params, request)).isError, true);
  assert.equal(calls, 1);
  await b('notifications/cancelled', { requestId: 10 }, { ...request, isRequest: false, isNotification: true });
  assert.equal(signal.aborted, false);
  await a('notifications/cancelled', { requestId: 10 }, { ...request, isRequest: false, isNotification: true });
  assert.equal(signal.aborted, true);
  release(); await pending;
  const next = b('tools/call', params, request);
  assert.equal(calls, 2); release(); await next;
});

test('missing/null/contradictory custody evidence cannot free admission in another session',async()=>{
  const cases=[{ok:false,workspaceMutationState:'UNPROVEN_RETAIN_ORIGINAL_REQUEST'},
    {ok:false,structuredContent:{workspaceMutationState:'UNPROVEN_RETAIN_ORIGINAL_REQUEST'}},
    {ok:false,executionCustodyReleased:null},
    {ok:false,executionCustodyReleased:'true',structuredContent:{executionCustodyReleased:true}},
    {ok:false,executionCustodyReleased:null,structuredContent:{executionCustodyReleased:true}},
    Object.create({executionCustodyReleased:true}),
    {ok:true,executionCustodyReleased:true,structuredContent:{executionCustodyReleased:false}},
    {ok:true,executionCustodyReleased:false,structuredContent:{executionCustodyReleased:true}}];
  for(let i=0;i<cases.length;i++){
    // Independent module instances model independent server processes, never
    // a production/test-only clear operation on an uncertain original lane.
    const {createSovereignCommanderMcpHandler:factory}=await import(
      '../../scripts/sovereign-commander-mcp.mjs?custody-missing-'+i);
    let calls=0;
    const make=async()=>{
      const handler=factory({repoRoot:'C:\\repo',executor:async()=>{calls++;return cases[i]}});
      const request={id:1,isRequest:true,isNotification:false,transportAuthenticated:true};
      await handler('initialize',{},request);
      await handler('notifications/initialized',{}, {isRequest:false,isNotification:true});
      await handler('tools/list',{},request);return {handler,request};
    };
    const a=await make(),b=await make();const params={name:'maintenance_action',arguments:{
      actionId:'repair-core-publication-directories',expectedMain:'a'.repeat(40)}};
    await a.handler('tools/call',params,a.request);
    assert.equal((await b.handler('tools/call',params,b.request)).isError,true);
    assert.equal(calls,1,'no second executor without positive, uncontradicted custody evidence');
  }
});

test('real unenrolled command rejection proves no execution and does not poison the Core lane',async()=>{
  const {createSovereignCommanderMcpHandler:factory}=await import(
    '../../scripts/sovereign-commander-mcp.mjs?custody-prelaunch-denial');
  const handler=factory({repoRoot:'C:\\repo'});
  const request={id:1,isRequest:true,isNotification:false,transportAuthenticated:true};
  await handler('initialize',{},request);
  await handler('notifications/initialized',{}, {isRequest:false,isNotification:true});
  await handler('tools/list',{},request);
  for(let id=2;id<4;id++){
    const r=await handler('tools/call',{name:'maintenance_action',arguments:{
      actionId:'repair-core-publication-directories',expectedMain:'invalid'}},{...request,id});
    assert.equal(r.structuredContent.executionCustodyReleased,true);
    assert.equal(r.structuredContent.blocker,'sovereign-commander-process-not-registered');
  }
});

test('Sovereign Commander MCP requires initialize, initialized, and tools/list before calls', async () => {
  const observed = [];
  const handler = createSovereignCommanderMcpHandler({
    repoRoot: 'C:\\repo',
    executor: async (envelope) => {
      observed.push(envelope);
      return { ok: true, proofHash: 'a'.repeat(64), finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED' };
    },
    now: () => '2026-09-29T21:00:00.000Z',
  });

  const init = await handler('initialize', {
    protocolVersion: '2025-06-18',
    clientInfo: { name: 'test-client', version: '1.0.0' },
  }, { id: 1, isRequest: true, isNotification: false });
  assert.equal(init.serverInfo.name, 'stephanos-sovereign-commander');

  await handler('notifications/initialized', {}, { isRequest: false, isNotification: true });
  const beforeList = await handler('tools/call', { name: 'get_config', arguments: {} }, { id: 2, isRequest: true, isNotification: false });
  assert.equal(beforeList.isError, true);
  assert.equal(observed.length, 0);

  const listed = await handler('tools/list', {}, { id: 3, isRequest: true, isNotification: false });
  assert.ok(listed.tools.some((tool) => tool.name === 'read_file'));
  assert.ok(listed.tools.some((tool) => tool.name === 'write_file'));
  assert.ok(listed.tools.some((tool) => tool.name === 'search_project'));
  assert.equal(listed.tools.some((tool) => tool.name === 'run_node_test'), false);

  const call = await handler('tools/call', {
    name: 'read_file',
    arguments: { path: 'C:\\Users\\Operator\\Downloads\\proof.txt', offset: 2, length: 10 },
  }, { id: 4, isRequest: true, isNotification: false });
  assert.equal(call.isError, false);
  assert.equal(observed.length, 1);
  assert.equal(observed[0].surface, 'SOVEREIGN_COMMANDER');
  assert.equal(observed[0].operation, 'READ_FILE');
  assert.deepEqual(observed[0].targetPaths, ['C:\\Users\\Operator\\Downloads\\proof.txt']);
  assert.equal(observed[0].mergeAuthority, false);
  assert.equal(observed[0].arbitraryUnboundedCommandAllowed, false);
});

test('authenticated MCP tool call forwards authoritative route proof to execution', async () => {
  let routeProof = null;
  const handler = createSovereignCommanderMcpHandler({
    repoRoot: 'C:\\repo',
    executor: async (_envelope, options) => {
      routeProof = options.routeProof;
      return { ok: true, proofHash: 'c'.repeat(64), finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED' };
    },
  });

  await handler('initialize', {
    protocolVersion: '2025-11-25',
    clientInfo: { name: 'authenticated-client', version: '1.0.0' },
  }, {
    id: 1,
    isRequest: true,
    isNotification: false,
    transportKind: 'authenticated-http-jsonrpc',
    transportAuthenticated: true,
  });
  await handler('notifications/initialized', {}, {
    isRequest: false,
    isNotification: true,
    transportKind: 'authenticated-http-jsonrpc',
    transportAuthenticated: true,
  });
  await handler('tools/list', {}, {
    id: 2,
    isRequest: true,
    isNotification: false,
    transportKind: 'authenticated-http-jsonrpc',
    transportAuthenticated: true,
  });
  const call = await handler('tools/call', {
    name: 'maintenance_action',
    arguments: { actionId: 'battle-bridge-observe' },
  }, {
    id: 3,
    isRequest: true,
    isNotification: false,
    transportKind: 'authenticated-http-jsonrpc',
    transportAuthenticated: true,
  });

  assert.equal(call.isError, false);
  assert.deepEqual(routeProof, {
    commandPathProven: true,
    mcpSessionReady: true,
    transport: 'authenticated-http-jsonrpc',
    authenticatedMcp: true,
  });
});

test('Sovereign Commander MCP maps project search without caller-selected paths or shell', async () => {
  const observed = [];
  const handler = createSovereignCommanderMcpHandler({
    repoRoot: 'C:\\repo',
    executor: async (envelope) => {
      observed.push(envelope);
      return { ok: true, proofHash: 'b'.repeat(64), finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED' };
    },
  });
  await handler('initialize', { protocolVersion: '2025-11-25', clientInfo: { name: 'search-client' } }, { id: 1, isRequest: true, isNotification: false });
  await handler('notifications/initialized', {}, { isRequest: false, isNotification: true });
  await handler('tools/list', {}, { id: 2, isRequest: true, isNotification: false });
  const result = await handler('tools/call', {
    name: 'search_project',
    arguments: { query: 'Sovereign Commander', maxResults: 12, path: 'C:\\outside' },
  }, { id: 3, isRequest: true, isNotification: false });
  assert.equal(result.isError, false);
  assert.equal(observed.length, 1);
  assert.equal(observed[0].operation, 'SEARCH_PROJECT');
  assert.deepEqual(observed[0].targetPaths, []);
  assert.deepEqual(observed[0].payload, {
    query: 'Sovereign Commander',
    caseSensitive: undefined,
    maxResults: 12,
  });
  assert.equal(JSON.stringify(observed[0]).includes('C:\\outside'), false);
});

test('Sovereign Commander MCP negotiates the current SDK protocol and falls back to its newest supported version', async () => {
  const handler = createSovereignCommanderMcpHandler({ repoRoot: 'C:\\repo' });
  const current = await handler('initialize', {
    protocolVersion: '2025-11-25',
    clientInfo: { name: 'current-sdk-client' },
  }, { id: 1, isRequest: true, isNotification: false });
  assert.equal(current.protocolVersion, '2025-11-25');

  const fallbackHandler = createSovereignCommanderMcpHandler({ repoRoot: 'C:\\repo' });
  const fallback = await fallbackHandler('initialize', {
    protocolVersion: '2099-01-01',
    clientInfo: { name: 'future-client' },
  }, { id: 2, isRequest: true, isNotification: false });
  assert.equal(fallback.protocolVersion, '2025-11-25');
});

test('Sovereign Commander MCP exposes fixed maintenance action rather than arbitrary shell', async () => {
  const observed = [];
  const handler = createSovereignCommanderMcpHandler({
    repoRoot: 'C:\\repo',
    executor: async (envelope) => {
      observed.push(envelope);
      return { ok: true, finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED' };
    },
  });
  await handler('initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 'test-client' } }, { id: 1, isRequest: true, isNotification: false });
  await handler('notifications/initialized', {}, { isRequest: false, isNotification: true });
  await handler('tools/list', {}, { id: 2, isRequest: true, isNotification: false });
  await handler('tools/call', {
    name: 'maintenance_action',
    arguments: { actionId: 'battle-bridge-status', command: 'Remove-Item C:\\* -Recurse' },
  }, { id: 3, isRequest: true, isNotification: false });

  assert.equal(observed.length, 1);
  assert.deepEqual(observed[0].payload, { actionId: 'battle-bridge-status' });
  assert.doesNotMatch(JSON.stringify(observed[0]), /Remove-Item/);

  await handler('tools/call', {
    name: 'maintenance_action',
    arguments: { actionId: 'qwen35-canary' },
  }, { id: 4, isRequest: true, isNotification: false });
  assert.equal(observed[1].payload.actionId, 'qwen35-canary');

  const listed = await handler('tools/list', {}, { id: 5, isRequest: true, isNotification: false });
  const maintenance = listed.tools.find((tool) => tool.name === 'maintenance_action');
  assert.ok(maintenance.inputSchema.properties.actionId.enum.includes('ignite-stephanos'));
  assert.ok(maintenance.inputSchema.properties.actionId.enum.includes('repair-battle-bridge'));
  assert.ok(maintenance.inputSchema.properties.actionId.enum.includes('repair-control-plane'));
  assert.ok(maintenance.inputSchema.properties.actionId.enum.includes('repair-stephanos'));
  assert.ok(maintenance.inputSchema.properties.actionId.enum.includes('visibility-snapshot'));
  assert.ok(maintenance.inputSchema.properties.actionId.enum.includes('diagnose-ignition'));
  assert.ok(maintenance.inputSchema.properties.actionId.enum.includes('goal-discovery-heartbeat'));
  assert.ok(maintenance.inputSchema.properties.actionId.enum.includes('fleet-goal-supervisor'));
  assert.ok(maintenance.inputSchema.properties.actionId.enum.includes('start-mission-orchestrator-worker'));
  assert.ok(maintenance.inputSchema.properties.actionId.enum.includes('status-openclaw-whatsapp'));
  assert.ok(maintenance.inputSchema.properties.actionId.enum.includes('repair-openclaw-ignite'));
  assert.ok(maintenance.inputSchema.properties.actionId.enum.includes('reconcile-remote-commander-parity'));
  assert.ok(maintenance.inputSchema.properties.actionId.enum.includes('rescue-island-readonly-boundary'));
  const island = await handler('tools/call', {
    name: 'maintenance_action',
    arguments: {
      actionId: 'rescue-island-readonly-boundary',
      command: 'UNTRUSTED_ARBITRARY_COMMAND',
      path: 'C:\\outside',
      leaseReleaseAllowed: true,
    },
  }, { id: 6, isRequest: true, isNotification: false });
  assert.equal(island.isError, false);
  assert.equal(observed.length, 3);
  assert.deepEqual(observed[2].payload, { actionId: 'rescue-island-readonly-boundary' });
  assert.deepEqual(observed[2].targetPaths, []);
  assert.equal(JSON.stringify(observed[2]).includes('UNTRUSTED_ARBITRARY_COMMAND'), false);
  const physical = buildSovereignCommanderCommandV1(observed[2], { repoRoot: 'C:\\repo' });
  assert.equal(physical.dispatchAllowed, true);
  assert.equal(physical.plan.kind, 'fixed-process');
  assert.equal(physical.plan.processId, 'rescue-island-readonly-boundary');
  assert.equal(physical.plan.args.length, 1);
  assert.equal(physical.mergeAuthority, false);
  assert.equal(physical.leaseSeizureAllowed, false);
});

test('stdio transport returns JSON-RPC responses and ignores initialized notification', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let captured = '';
  output.on('data', (chunk) => { captured += chunk.toString(); });

  const handler = createSovereignCommanderMcpHandler({
    repoRoot: 'C:\\repo',
    executor: async () => ({ ok: true, finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED' }),
  });
  const server = runSovereignCommanderStdioMcpServer({ input, output, handler });

  input.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'test-client' } } }) + '\n');
  input.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');
  input.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
  input.end();
  await server;

  const lines = captured.trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].id, 1);
  assert.equal(lines[1].id, 2);
  assert.ok(lines[1].result.tools.some((tool) => tool.name === 'get_config'));
});

test('private MCP exposes bounded metadata and batch-reading parity without shell', async () => {
  const observed = [];
  const handler = createSovereignCommanderMcpHandler({
    repoRoot: 'C:\\repo',
    executor: async (envelope) => {
      observed.push(envelope);
      return { ok: true, proofHash: 'f'.repeat(64), finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED' };
    },
  });
  await handler('initialize', { protocolVersion: '2025-11-25' }, { id: 1, isRequest: true, isNotification: false });
  await handler('notifications/initialized', {}, { isRequest: false, isNotification: true });
  const listed = await handler('tools/list', {}, { id: 2, isRequest: true, isNotification: false });
  for (const name of ['get_file_info', 'read_multiple_files']) {
    const tool = listed.tools.find((item) => item.name === name);
    assert.ok(tool, name);
    assert.equal(tool.annotations.readOnlyHint, true);
  }
  const readTool = listed.tools.find((item) => item.name === 'read_multiple_files');
  assert.equal(readTool.inputSchema.properties.paths.maxItems, 8);
  const paths = ['C:\\repo\\one.txt', 'C:\\repo\\two.txt'];
  const read = await handler('tools/call', {
    name: 'read_multiple_files',
    arguments: { paths, offset: 1, length: 2, command: 'do-not-forward' },
  }, { id: 3, isRequest: true, isNotification: false });
  assert.equal(read.isError, false);
  assert.equal(observed[0].operation, 'READ_MULTIPLE_FILES');
  assert.deepEqual(observed[0].targetPaths, paths);
  assert.deepEqual(observed[0].payload, { offset: 1, length: 2 });
  const info = await handler('tools/call', {
    name: 'get_file_info',
    arguments: { path: paths[0] },
  }, { id: 4, isRequest: true, isNotification: false });
  assert.equal(info.isError, false);
  assert.equal(observed[1].operation, 'GET_FILE_INFO');
  assert.deepEqual(observed[1].targetPaths, [paths[0]]);
  assert.equal(JSON.stringify(observed).includes('do-not-forward'), false);
});

test('unproven terminal custody retains the server lane across a new session', async () => {
  let finish, calls = 0;
  const params = { name: 'maintenance_action', arguments: {
    actionId: 'repair-core-publication-directories', expectedMain: 'a'.repeat(40) } };
  const request = { id: 91, isRequest: true, isNotification: false, transportAuthenticated: true };
  const make = async () => {
    const handler = createSovereignCommanderMcpHandler({ repoRoot: 'C:\\repo', executor: async () => {
      calls++;
      await new Promise(resolve => { finish = resolve; });
      return { ok: false, structuredContent: { executionCustodyReleased: false } };
    } });
    await handler('initialize', {}, request);
    await handler('notifications/initialized', {}, { isRequest: false, isNotification: true });
    await handler('tools/list', {}, request);
    return handler;
  };
  const a = await make();
  const pending = a('tools/call', params, request);
  const b = await make();
  assert.equal((await b('tools/call', params, request)).isError, true);
  finish(); assert.equal((await pending).isError, true);
  assert.equal((await b('tools/call', params, request)).isError, true);
  assert.equal(calls, 1);
  assert.ok((await b('tools/list', {}, request)).tools.length > 0);
  // Deliberately no test-only clear: an unproven witness cannot free this lane.
});
