import test from 'node:test';
// The existing Sovereign Commander MCP CI job also exercises Starfield's read-only archive contract.
import '../../scripts/starfield-vr-telemetry-archive.test.mjs';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { buildSovereignCommanderCommandV1 } from './sovereignCommanderV1.mjs';
import { evaluateSkillForgeBrowserObservation } from '../../scripts/sovereign-commander-skill-forge-runtime-proof.mjs';
import {
  createSovereignCommanderMcpHandler,
  runSovereignCommanderStdioMcpServer,
} from '../../scripts/sovereign-commander-mcp.mjs';

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
  assert.ok(maintenance.inputSchema.properties.actionId.enum.includes('goal-discovery-heartbeat'));
  assert.ok(maintenance.inputSchema.properties.actionId.enum.includes('fleet-goal-supervisor'));
  assert.ok(maintenance.inputSchema.properties.actionId.enum.includes('start-mission-orchestrator-worker'));
  assert.ok(maintenance.inputSchema.properties.actionId.enum.includes('status-openclaw-whatsapp'));
  assert.ok(maintenance.inputSchema.properties.actionId.enum.includes('repair-openclaw-ignite'));
  assert.ok(maintenance.inputSchema.properties.actionId.enum.includes('reconcile-remote-commander-parity'));
  assert.ok(maintenance.inputSchema.properties.actionId.enum.includes('prove-skill-forge-runtime'));
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
  await handler('tools/call', {
    name: 'maintenance_action',
    arguments: {
      actionId: 'prove-skill-forge-runtime',
      url: 'https://untrusted.example',
      command: 'UNTRUSTED_ARBITRARY_COMMAND',
      path: 'C:\\untrusted',
      releaseLease: true,
    },
  }, { id: 7, isRequest: true, isNotification: false });
  const skillForge = observed.at(-1);
  assert.deepEqual(skillForge.payload, { actionId: 'prove-skill-forge-runtime' });
  assert.deepEqual(skillForge.targetPaths, []);
  assert.doesNotMatch(JSON.stringify(skillForge), /untrusted|releaseLease|UNTRUSTED/);
  const skillForgePhysical = buildSovereignCommanderCommandV1(skillForge, { repoRoot: 'C:\\repo' });
  assert.equal(skillForgePhysical.dispatchAllowed, true);
  assert.equal(skillForgePhysical.plan.kind, 'fixed-process');
  assert.equal(skillForgePhysical.plan.processId, 'prove-skill-forge-runtime');
  assert.equal(skillForgePhysical.mergeAuthority, false);
  assert.equal(skillForgePhysical.leaseSeizureAllowed, false);
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

test('fixed Skill Forge browser receipt fails closed on stale head, asset, route and hydration', () => {
  const head = 'a'.repeat(40);
  const ready = {
    exactHeadProofOk: true, sourceHead: head, servedBuildHead: head,
    servedAssetFingerprint: 'b'.repeat(64), expectedAssetFingerprint: 'b'.repeat(64),
    currentSourceFingerprint: 'c'.repeat(64), servedSourceFingerprint: 'c'.repeat(64),
    forgeHttpStatus: 200, commandHttpStatus: 200,
    forgeUrl: 'http://127.0.0.1:4173/apps/stephanos/dist/index.html?surface=skill-forge',
    commandUrl: 'http://127.0.0.1:4173/apps/stephanos/dist/index.html',
    forgeTitleVisible: true, forgeConstructionLineVisible: true,
    forgeLearningViewVisible: true, forgeTransferGateVisible: true,
    commandObservatoryVisible: true, commandNavigationVisible: true,
    forgeFeedTruth: 'REPORTED', backendState: 'ready', backendHttpStatus: 200,
    consoleErrorCount: 0, pageErrorCount: 0,
  };
  assert.equal(evaluateSkillForgeBrowserObservation(ready).accepted, true);
  for (const [key, bad] of [
    ['exactHeadProofOk', false],
    ['servedBuildHead', 'c'.repeat(40)],
    ['servedAssetFingerprint', ''],
    ['expectedAssetFingerprint', 'd'.repeat(64)],
    ['servedSourceFingerprint', 'e'.repeat(64)],
    ['forgeHttpStatus', 404],
    ['forgeUrl', 'http://example.org'],
    ['forgeConstructionLineVisible', false],
    ['forgeLearningViewVisible', false],
    ['forgeTransferGateVisible', false],
    ['commandObservatoryVisible', false],
    ['backendState', 'stale'],
    ['forgeFeedTruth', 'STALE'],
    ['consoleErrorCount', 1],
    ['pageErrorCount', 1],
  ]) {
    const verdict = evaluateSkillForgeBrowserObservation({ ...ready, [key]: bad });
    assert.equal(verdict.accepted, false, key);
    assert.ok(verdict.blockers.length > 0, key);
  }
});
