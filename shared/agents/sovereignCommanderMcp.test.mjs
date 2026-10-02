import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
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
  assert.ok(maintenance.inputSchema.properties.actionId.enum.includes('goal-discovery-heartbeat'));
  assert.ok(maintenance.inputSchema.properties.actionId.enum.includes('fleet-goal-supervisor'));
  assert.ok(maintenance.inputSchema.properties.actionId.enum.includes('start-mission-orchestrator-worker'));
  assert.ok(maintenance.inputSchema.properties.actionId.enum.includes('status-openclaw-whatsapp'));
  assert.ok(maintenance.inputSchema.properties.actionId.enum.includes('repair-openclaw-ignite'));
  assert.ok(maintenance.inputSchema.properties.actionId.enum.includes('reconcile-remote-commander-parity'));
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


test('Sovereign Commander MCP exposes learning intake and turns unknown tools into Flywheel gap events', async () => {
  const failures = [];
  const explicit = [];
  const handler = createSovereignCommanderMcpHandler({
    repoRoot: 'C:\\repo',
    executor: async () => ({ ok: true, finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED' }),
    failureReporter: async (input) => {
      failures.push(input);
      return { ok: true, captured: true, eventId: 'sovereign-gap-test' };
    },
    gapReporter: async (input) => {
      explicit.push(input);
      return {
        ok: true,
        captured: true,
        eventId: 'sovereign-gap-explicit',
        candidate: { problemClass: 'PRODUCT_SURFACE_DISCOVERY_AND_MUTATION' },
        finalVerdict: 'SOVEREIGN_COMMANDER_CAPABILITY_GAP_CAPTURED',
      };
    },
    now: () => '2026-10-02T23:30:00.000Z',
  });

  await handler('initialize', {
    protocolVersion: '2025-11-25',
    clientInfo: { name: 'learning-test-client' },
  }, { id: 1, isRequest: true, isNotification: false });
  await handler('notifications/initialized', {}, { isRequest: false, isNotification: true });
  const listed = await handler('tools/list', {}, { id: 2, isRequest: true, isNotification: false });
  assert.ok(listed.tools.some((tool) => tool.name === 'report_capability_gap'));

  const reported = await handler('tools/call', {
    name: 'report_capability_gap',
    arguments: {
      task: 'Add a landing page tile and workspace',
      failureClass: 'CANNOT_DISCOVER_SURFACE',
      scope: 'STEPHANOS_PROJECT',
      evidenceRefs: ['pr:#2645'],
    },
  }, { id: 3, isRequest: true, isNotification: false });
  assert.equal(reported.isError, false);
  assert.equal(explicit.length, 1);
  assert.equal(explicit[0].originatingAgent, 'learning-test-client');

  const unknown = await handler('tools/call', {
    name: 'add_landing_page_tile',
    arguments: {},
  }, { id: 4, isRequest: true, isNotification: false });
  assert.equal(unknown.isError, true);
  assert.equal(unknown.structuredContent.blocker, 'UNKNOWN_TOOL');
  assert.equal(unknown.structuredContent.learningIntake.captured, true);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].result.blocker, 'UNKNOWN_TOOL');
  assert.match(failures[0].task, /add_landing_page_tile/);
});
