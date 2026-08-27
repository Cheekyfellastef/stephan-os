import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import {
  GOAL_COCKPIT_MCP_APP_MIME_TYPE,
  GOAL_COCKPIT_RESOURCE_URI,
  GOAL_COCKPIT_TOOL_NAMES,
  createGoalCockpitMcpHandler,
  runStdioMcpServer,
} from '../../plugins/stephanos-goal-cockpit/scripts/goal-cockpit-mcp.mjs';

const EXPECTED_TOOL_NAMES = [
  'get_goal_cockpit_current',
  'get_goal_detail',
  'render_goal_cockpit',
];

function snapshot() {
  return {
    schemaVersion: 'stephanos.goal-cockpit-chat.v1',
    kind: 'stephanos.goal_cockpit_chat.projection',
    snapshotId: 'snapshot-test',
    generatedAt: '2026-07-30T12:00:00.000Z',
    truth: 'UNKNOWN',
    summary: {
      total: 1,
      current: 0,
      stale: 0,
      unknown: 1,
      conflict: 0,
    },
    priorityAction: 'Run browser proof.',
    goals: [{
      id: '#1700',
      goalId: '#1700',
      title: 'Build the cockpit',
      truth: 'UNKNOWN',
      workState: 'VERIFYING',
      nextAction: 'Run browser proof.',
    }],
    systems: [],
    recentEvents: [],
    guardrails: {
      readOnly: true,
      commandExecutionAllowed: false,
      repoMutationAllowed: false,
      mergeAllowed: false,
    },
    refreshAfterMs: 30_000,
  };
}

function reader() {
  const calls = [];
  return {
    calls,
    projectionReader: async () => {
      calls.push('read');
      return snapshot();
    },
  };
}

function resourceUriOf(tool) {
  return tool?._meta?.ui?.resourceUri;
}

test('goal cockpit MCP advertises only read-only, closed-world tools', async () => {
  const fake = reader();
  const handler = createGoalCockpitMcpHandler({ projectionReader: fake.projectionReader });
  const listed = await handler('tools/list');
  const names = listed.tools.map((tool) => tool.name);

  assert.deepEqual([...names].sort(), [...EXPECTED_TOOL_NAMES].sort());
  assert.deepEqual([...Object.values(GOAL_COCKPIT_TOOL_NAMES)].sort(), [...EXPECTED_TOOL_NAMES].sort());
  assert.doesNotMatch(names.join(' '), /\b(?:write|update|dispatch|approve|merge|delete|execute|run)\b/i);
  for (const tool of listed.tools) {
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.annotations.destructiveHint, false);
    assert.equal(tool.annotations.idempotentHint, true);
    assert.equal(tool.annotations.openWorldHint, false);
  }
});

test('only the render tool carries the MCP App UI resource', async () => {
  const fake = reader();
  const handler = createGoalCockpitMcpHandler({ projectionReader: fake.projectionReader });
  const { tools } = await handler('tools/list');
  const withUi = tools.filter((tool) => resourceUriOf(tool));

  assert.deepEqual(withUi.map((tool) => tool.name), ['render_goal_cockpit']);
  assert.equal(resourceUriOf(withUi[0]), GOAL_COCKPIT_RESOURCE_URI);
  assert.equal(resourceUriOf(tools.find((tool) => tool.name === 'get_goal_cockpit_current')), undefined);
  assert.equal(resourceUriOf(tools.find((tool) => tool.name === 'get_goal_detail')), undefined);
});

test('goal cockpit MCP exposes a versioned MCP App resource with the required MIME type', async () => {
  assert.equal(GOAL_COCKPIT_MCP_APP_MIME_TYPE, 'text/html;profile=mcp-app');
  assert.match(GOAL_COCKPIT_RESOURCE_URI, /^ui:\/\/stephanos\/goal-cockpit-v\d+\.html$/);

  const fake = reader();
  const handler = createGoalCockpitMcpHandler({
    projectionReader: fake.projectionReader,
    componentReader: async () => '<!doctype html><title>Goal Cockpit</title>',
  });
  const listed = await handler('resources/list');
  assert.ok(listed.resources.some((resource) => (
    resource.uri === GOAL_COCKPIT_RESOURCE_URI
    && resource.mimeType === GOAL_COCKPIT_MCP_APP_MIME_TYPE
  )));

  const read = await handler('resources/read', { uri: GOAL_COCKPIT_RESOURCE_URI });
  assert.equal(read.contents.length, 1);
  assert.equal(read.contents[0].uri, GOAL_COCKPIT_RESOURCE_URI);
  assert.equal(read.contents[0].mimeType, GOAL_COCKPIT_MCP_APP_MIME_TYPE);
  assert.match(read.contents[0].text, /Goal Cockpit/);
  assert.deepEqual(read.contents[0]._meta.ui.csp.connectDomains, []);
  assert.deepEqual(read.contents[0]._meta.ui.csp.resourceDomains, []);
});

test('current and render calls return the same structured read-only snapshot envelope', async () => {
  const fake = reader();
  const handler = createGoalCockpitMcpHandler({ projectionReader: fake.projectionReader });

  const current = await handler('tools/call', {
    name: 'get_goal_cockpit_current',
    arguments: {},
  });
  const render = await handler('tools/call', {
    name: 'render_goal_cockpit',
    arguments: {},
  });

  assert.equal(current.isError, false);
  assert.equal(render.isError, false);
  assert.equal(current.structuredContent.unchanged, false);
  assert.equal(render.structuredContent.unchanged, false);
  assert.equal(current.structuredContent.snapshotId, 'snapshot-test');
  assert.equal(render.structuredContent.snapshotId, 'snapshot-test');
  assert.deepEqual(current.structuredContent.snapshot, snapshot());
  assert.deepEqual(render.structuredContent.snapshot, snapshot());
  assert.ok(Number.isFinite(Date.parse(current.structuredContent.serverTime)));
  assert.ok(Number.isFinite(Date.parse(render.structuredContent.serverTime)));
  assert.equal(fake.calls.length, 2);
});

test('current call can suppress an unchanged snapshot by snapshotId', async () => {
  const fake = reader();
  const handler = createGoalCockpitMcpHandler({ projectionReader: fake.projectionReader });
  const unchanged = await handler('tools/call', {
    name: 'get_goal_cockpit_current',
    arguments: { knownSnapshotId: 'snapshot-test' },
  });

  assert.equal(unchanged.isError, false);
  assert.equal(unchanged.structuredContent.unchanged, true);
  assert.equal(unchanged.structuredContent.snapshotId, 'snapshot-test');
  assert.equal(unchanged.structuredContent.snapshot ?? null, null);
});

test('detail lookup is bounded to a goalId and missing goals remain explicit', async () => {
  const fake = reader();
  const handler = createGoalCockpitMcpHandler({ projectionReader: fake.projectionReader });

  const found = await handler('tools/call', {
    name: 'get_goal_detail',
    arguments: { goalId: '#1700' },
  });
  assert.equal(found.isError, false);
  assert.equal(found.structuredContent.goal.goalId, '#1700');

  const missing = await handler('tools/call', {
    name: 'get_goal_detail',
    arguments: { goalId: '#9999' },
  });
  assert.equal(missing.isError, true);
  assert.equal(missing.structuredContent.blocker, 'GOAL_NOT_FOUND');
});

test('stdio transport advertises tools and resources without reacting to notifications', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let captured = '';
  output.on('data', (chunk) => { captured += chunk.toString(); });
  const fake = reader();
  const handler = createGoalCockpitMcpHandler({ projectionReader: fake.projectionReader });
  const server = runStdioMcpServer({ input, output, handler });
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'resources/list', params: {} })}\n`);
  input.end();
  await server;

  const responses = captured.trim().split(/\r?\n/).map(JSON.parse);
  assert.deepEqual(responses.map((response) => response.id), [1, 2]);
  assert.equal(responses[0].result.capabilities.resources.subscribe, false);
  assert.equal(responses[1].result.resources[0].uri, GOAL_COCKPIT_RESOURCE_URI);
});
