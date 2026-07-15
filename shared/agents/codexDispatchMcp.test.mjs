import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import {
  createCodexDispatchMcpHandler,
  runStdioMcpServer,
  STEPHANOS_CODEX_DISPATCH_MCP_NAME,
} from '../../scripts/stephanos-codex-dispatch-mcp.mjs';

function fakeIntegration() {
  const calls = [];
  return {
    calls,
    integrationId: 'test-local-codex',
    capabilities: { launchCodexJob: true, returnDispatchReceipt: true, returnProofMetadata: true },
    dispatch(packet) {
      calls.push(packet);
      return {
        receiptId: `receipt-${packet.jobId}`,
        accepted: true,
        started: true,
        proofRefs: [`receipts/${packet.jobId}.json`],
      };
    },
    readStatus(taskId) { return taskId === 'known-task' ? { taskId, status: 'RUNNING' } : null; },
    readResult(taskId) { return taskId === 'known-task' ? { taskId, verdict: 'PASS', status: 'DONE' } : null; },
  };
}

test('MCP server advertises only guarded dispatch and read tools', async () => {
  const handler = createCodexDispatchMcpHandler({ integration: fakeIntegration() });
  const initialized = await handler('initialize', { protocolVersion: '2025-06-18' });
  assert.equal(initialized.serverInfo.name, STEPHANOS_CODEX_DISPATCH_MCP_NAME);
  const listed = await handler('tools/list');
  assert.deepEqual(listed.tools.map((tool) => tool.name), ['dispatch_codex_task', 'get_codex_task_status', 'read_codex_task_result']);
  assert.equal(listed.tools[0].annotations.destructiveHint, true);
  assert.equal(listed.tools[1].annotations.readOnlyHint, true);
});

test('dispatch tool requires explicit operator approval', async () => {
  const integration = fakeIntegration();
  const handler = createCodexDispatchMcpHandler({ integration });
  const result = await handler('tools/call', {
    name: 'dispatch_codex_task',
    arguments: { issueNumber: 1293, task: 'Run the exact Battle Bridge ignition proof and return evidence.' },
  });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.blocker, 'OPERATOR_APPROVAL_REQUIRED');
  assert.equal(integration.calls.length, 0);
});

test('dispatch tool creates canonical approved queue packet and returns a real receipt', async () => {
  const integration = fakeIntegration();
  const handler = createCodexDispatchMcpHandler({ integration, now: () => '2026-07-15T21:00:00.000Z' });
  const result = await handler('tools/call', {
    name: 'dispatch_codex_task',
    arguments: {
      issueNumber: 1293,
      task: 'Run the exact Battle Bridge ignition proof and return evidence.',
      operatorApproval: 'operator-approved',
      branch: 'main',
      requestedProofCommands: ['git rev-parse HEAD'],
    },
  });
  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.ok, true);
  assert.equal(result.structuredContent.decision, 'DISPATCHED');
  assert.equal(integration.calls.length, 1);
  assert.equal(integration.calls[0].issueNumber, 1293);
  assert.equal(integration.calls[0].branch, 'main');
  assert.equal(integration.calls[0].mergeAuthority, false);
  assert.match(integration.calls[0].approvalRequirements.approvalReceipt, /^chatgpt-mcp-/);
});

test('status and result tools return structured truth without claiming missing work', async () => {
  const handler = createCodexDispatchMcpHandler({ integration: fakeIntegration() });
  const status = await handler('tools/call', { name: 'get_codex_task_status', arguments: { taskId: 'known-task' } });
  assert.equal(status.structuredContent.status.status, 'RUNNING');
  const result = await handler('tools/call', { name: 'read_codex_task_result', arguments: { taskId: 'known-task' } });
  assert.equal(result.structuredContent.result.verdict, 'PASS');
  const missing = await handler('tools/call', { name: 'read_codex_task_result', arguments: { taskId: 'missing-task' } });
  assert.equal(missing.isError, true);
  assert.equal(missing.structuredContent.blocker, 'RESULT_NOT_READY');
});

test('stdio transport returns JSON-RPC responses and ignores initialized notification', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let captured = '';
  output.on('data', (chunk) => { captured += chunk.toString(); });
  const server = runStdioMcpServer({ input, output, handler: createCodexDispatchMcpHandler({ integration: fakeIntegration() }) });
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`);
  input.end();
  await server;
  const responses = captured.trim().split(/\r?\n/).map(JSON.parse);
  assert.deepEqual(responses.map((response) => response.id), [1, 2]);
  assert.equal(responses[1].result.tools.length, 3);
});
