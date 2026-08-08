import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import {
  createCodexDispatchAttachmentProof,
  createCodexDispatchMcpHandler,
  runStdioMcpServer,
  STEPHANOS_CODEX_DISPATCH_ATTACHMENT_SCHEMA,
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

function fakeHostOps() {
  const calls = [];
  return {
    calls,
    syncCodexDispatchBridge(args) {
      calls.push({ tool: 'sync', args });
      if (args.operatorApproval !== 'operator-approved') return { ok: false, blocker: 'OPERATOR_APPROVAL_REQUIRED' };
      return { ok: true, status: 'DONE', verdict: 'PASS', beforeHead: 'a', afterHead: 'b', restartRequired: true };
    },
    async updateStephanosFromChat(args) {
      calls.push({ tool: 'update', args });
      if (args.operatorApproval !== 'operator-approved') return { ok: false, blocker: 'OPERATOR_APPROVAL_REQUIRED' };
      return { ok: true, status: 'DONE', verdict: 'PASS', servedUiProof: { exactHead: true }, operatorPowerShellRequired: false };
    },
    async runBattleBridgeDiagnostics() {
      calls.push({ tool: 'diagnostics' });
      return { ok: true, status: 'DONE', verdict: 'PASS', fullHead: 'abc', health: [] };
    },
  };
}

async function initializeCompatibleSession(handler) {
  const initialized = await handler('initialize', {
    protocolVersion: '2025-06-18',
    clientInfo: { name: 'codex-mcp-client', version: '0.142.0-alpha.6' },
  });
  await handler('notifications/initialized');
  return initialized;
}

test('MCP server advertises guarded dispatch, sync, full update, and deterministic diagnostics tools', async () => {
  const attachmentProofs = [];
  const handler = createCodexDispatchMcpHandler({
    integration: fakeIntegration(),
    hostOps: fakeHostOps(),
    now: () => '2026-08-08T12:00:00.000Z',
    attachmentProofPublisher: (proof) => attachmentProofs.push(proof),
    attachmentIdentity: {
      platform: 'win32',
      repositoryRoot: 'C:\\repo',
      sourceHead: 'a'.repeat(40),
      serverSourceSha256: 'b'.repeat(64),
    },
  });
  const initialized = await initializeCompatibleSession(handler);
  assert.equal(initialized.serverInfo.name, STEPHANOS_CODEX_DISPATCH_MCP_NAME);
  assert.equal(initialized.serverInfo.version, '1.2.0');
  const listed = await handler('tools/list');
  assert.deepEqual(listed.tools.map((tool) => tool.name), [
    'dispatch_codex_task',
    'get_codex_task_status',
    'read_codex_task_result',
    'sync_codex_dispatch_bridge',
    'update_stephanos_from_chat',
    'run_battle_bridge_diagnostics',
  ]);
  assert.equal(listed.tools[0].annotations.destructiveHint, true);
  assert.equal(listed.tools[1].annotations.readOnlyHint, true);
  assert.equal(listed.tools[3].annotations.destructiveHint, true);
  assert.equal(listed.tools[4].annotations.destructiveHint, true);
  assert.equal(listed.tools[5].annotations.readOnlyHint, true);
  assert.equal(attachmentProofs.length, 1);
  assert.equal(attachmentProofs[0].schemaVersion, STEPHANOS_CODEX_DISPATCH_ATTACHMENT_SCHEMA);
  assert.equal(attachmentProofs[0].observedAt, '2026-08-08T12:00:00.000Z');
  assert.equal(attachmentProofs[0].clientInfo.name, 'codex-mcp-client');
  assert.equal(attachmentProofs[0].clientSession.supportedClient, true);
  assert.equal(attachmentProofs[0].clientSession.initializeReceived, true);
  assert.equal(attachmentProofs[0].clientSession.initializedNotificationReceived, true);
  assert.equal(attachmentProofs[0].clientSession.ready, true);
  assert.equal(attachmentProofs[0].transport.kind, 'local-stdio');
  assert.equal(attachmentProofs[0].transport.clientIdentityAuthenticated, false);
  assert.equal(attachmentProofs[0].transport.remoteTransportAuthenticated, false);
  assert.equal(attachmentProofs[0].requiredDispatchToolsPresent, true);
  assert.equal(attachmentProofs[0].attached, true);
  assert.equal(attachmentProofs[0].sourceHead, 'a'.repeat(40));
  assert.equal(attachmentProofs[0].serverSourceSha256, 'b'.repeat(64));
  await handler('ping');
  assert.equal(attachmentProofs.length, 2);
});

test('surface attachment proof fails closed away from an exact Windows source head', () => {
  const clientInfo = { name: 'codex-mcp-client', version: '0.142.0-alpha.6' };
  const clientSession = {
    sessionId: '4f7b2458-fba6-4e2b-8b9c-bdbb2134770b',
    protocolVersion: '2025-06-18',
    initializeReceived: true,
    initializedNotificationReceived: true,
    initializedAt: '2026-08-08T12:00:00.000Z',
    readyAt: '2026-08-08T12:00:01.000Z',
  };
  const linux = createCodexDispatchAttachmentProof({
    clientInfo,
    clientSession,
    platform: 'linux',
    repositoryRoot: '/repo',
    sourceHead: 'a'.repeat(40),
    serverSourceSha256: 'b'.repeat(64),
    surfaceReceipt: 'surface-1',
  });
  assert.equal(linux.attached, false);
  assert.equal(linux.can_local_windows_proof, false);

  const unknownHead = createCodexDispatchAttachmentProof({
    clientInfo,
    clientSession,
    platform: 'win32',
    repositoryRoot: 'C:\\repo',
    sourceHead: '',
    serverSourceSha256: 'b'.repeat(64),
    surfaceReceipt: 'surface-2',
  });
  assert.equal(unknownHead.attached, false);
  assert.equal(unknownHead.can_local_windows_proof, false);

  const unknownServer = createCodexDispatchAttachmentProof({
    clientInfo,
    clientSession,
    platform: 'win32',
    repositoryRoot: 'C:\\repo',
    sourceHead: 'a'.repeat(40),
    serverSourceSha256: '',
    surfaceReceipt: 'surface-3',
  });
  assert.equal(unknownServer.attached, false);
});

test('bare or out-of-order MCP callers cannot publish attachment readiness', async () => {
  for (const exercise of [
    async (handler) => handler('tools/list'),
    async (handler) => {
      await handler('notifications/initialized');
      return handler('tools/list');
    },
    async (handler) => {
      await handler('initialize', {
        protocolVersion: '2025-06-18',
        clientInfo: { name: 'codex-mcp-client', version: '0.142.0-alpha.6' },
      });
      return handler('tools/list');
    },
    async (handler) => {
      await handler('initialize', {
        protocolVersion: '2025-06-18',
        clientInfo: { name: 'Unrelated MCP Client', version: '1.2.3' },
      });
      await handler('notifications/initialized');
      return handler('tools/list');
    },
    async (handler) => {
      await handler('initialize', {
        protocolVersion: '2099-01-01',
        clientInfo: { name: 'codex-mcp-client', version: '0.142.0-alpha.6' },
      });
      await handler('notifications/initialized');
      return handler('tools/list');
    },
  ]) {
    const attachmentProofs = [];
    const handler = createCodexDispatchMcpHandler({
      integration: fakeIntegration(),
      hostOps: fakeHostOps(),
      attachmentProofPublisher: (proof) => attachmentProofs.push(proof),
      attachmentIdentity: {
        platform: 'win32',
        repositoryRoot: 'C:\\repo',
        sourceHead: 'a'.repeat(40),
        serverSourceSha256: 'b'.repeat(64),
      },
    });
    await exercise(handler);
    assert.equal(attachmentProofs.length, 0);
  }
});

test('tool calls fail closed until a supported client completes initialization', async () => {
  const integration = fakeIntegration();
  const hostOps = fakeHostOps();
  const handler = createCodexDispatchMcpHandler({ integration, hostOps });
  const blocked = await handler('tools/call', {
    name: 'dispatch_codex_task',
    arguments: {
      issueNumber: 1293,
      task: 'Run the exact Battle Bridge ignition proof and return evidence.',
      operatorApproval: 'operator-approved',
    },
  });
  assert.equal(blocked.isError, true);
  assert.equal(blocked.structuredContent.blocker, 'MCP_CLIENT_SESSION_NOT_READY');
  assert.equal(integration.calls.length, 0);
  assert.equal(hostOps.calls.length, 0);
});

test('dispatch tool requires explicit operator approval', async () => {
  const integration = fakeIntegration();
  const handler = createCodexDispatchMcpHandler({ integration, hostOps: fakeHostOps() });
  await initializeCompatibleSession(handler);
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
  const handler = createCodexDispatchMcpHandler({ integration, hostOps: fakeHostOps(), now: () => '2026-07-15T21:00:00.000Z' });
  await initializeCompatibleSession(handler);
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
  const handler = createCodexDispatchMcpHandler({ integration: fakeIntegration(), hostOps: fakeHostOps() });
  await initializeCompatibleSession(handler);
  const status = await handler('tools/call', { name: 'get_codex_task_status', arguments: { taskId: 'known-task' } });
  assert.equal(status.structuredContent.status.status, 'RUNNING');
  const result = await handler('tools/call', { name: 'read_codex_task_result', arguments: { taskId: 'known-task' } });
  assert.equal(result.structuredContent.result.verdict, 'PASS');
  const missing = await handler('tools/call', { name: 'read_codex_task_result', arguments: { taskId: 'missing-task' } });
  assert.equal(missing.isError, true);
  assert.equal(missing.structuredContent.blocker, 'RESULT_NOT_READY');
});

test('sync tool forwards only an approved main fast-forward request to bounded host operations', async () => {
  const hostOps = fakeHostOps();
  const handler = createCodexDispatchMcpHandler({ integration: fakeIntegration(), hostOps });
  await initializeCompatibleSession(handler);
  const denied = await handler('tools/call', { name: 'sync_codex_dispatch_bridge', arguments: {} });
  assert.equal(denied.isError, true);
  assert.equal(denied.structuredContent.blocker, 'OPERATOR_APPROVAL_REQUIRED');
  const approved = await handler('tools/call', {
    name: 'sync_codex_dispatch_bridge',
    arguments: { operatorApproval: 'operator-approved', expectedBranch: 'main' },
  });
  assert.equal(approved.isError, false);
  assert.equal(approved.structuredContent.verdict, 'PASS');
  assert.deepEqual(hostOps.calls.at(-1), {
    tool: 'sync',
    args: { operatorApproval: 'operator-approved', expectedBranch: 'main' },
  });
});

test('full update tool requires approval and returns exact-head host proof without a Codex child', async () => {
  const hostOps = fakeHostOps();
  const integration = fakeIntegration();
  const handler = createCodexDispatchMcpHandler({ integration, hostOps });
  await initializeCompatibleSession(handler);
  const denied = await handler('tools/call', { name: 'update_stephanos_from_chat', arguments: {} });
  assert.equal(denied.isError, true);
  assert.equal(denied.structuredContent.blocker, 'OPERATOR_APPROVAL_REQUIRED');
  const approved = await handler('tools/call', {
    name: 'update_stephanos_from_chat',
    arguments: { operatorApproval: 'operator-approved', expectedBranch: 'main' },
  });
  assert.equal(approved.isError, false);
  assert.equal(approved.structuredContent.status, 'DONE');
  assert.equal(approved.structuredContent.servedUiProof.exactHead, true);
  assert.equal(approved.structuredContent.operatorPowerShellRequired, false);
  assert.equal(integration.calls.length, 0);
  assert.deepEqual(hostOps.calls.at(-1), {
    tool: 'update',
    args: { operatorApproval: 'operator-approved', expectedBranch: 'main' },
  });
});

test('diagnostics tool returns direct host proof without dispatching a Codex child', async () => {
  const hostOps = fakeHostOps();
  const integration = fakeIntegration();
  const handler = createCodexDispatchMcpHandler({ integration, hostOps });
  await initializeCompatibleSession(handler);
  const result = await handler('tools/call', { name: 'run_battle_bridge_diagnostics', arguments: {} });
  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.status, 'DONE');
  assert.equal(result.structuredContent.fullHead, 'abc');
  assert.equal(integration.calls.length, 0);
});

test('stdio transport returns JSON-RPC responses and ignores initialized notification', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let captured = '';
  output.on('data', (chunk) => { captured += chunk.toString(); });
  const server = runStdioMcpServer({ input, output, handler: createCodexDispatchMcpHandler({ integration: fakeIntegration(), hostOps: fakeHostOps() }) });
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'codex-mcp-client', version: '0.142.0-alpha.6' } } })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`);
  input.end();
  await server;
  const responses = captured.trim().split(/\r?\n/).map(JSON.parse);
  assert.deepEqual(responses.map((response) => response.id), [1, 2]);
  assert.equal(responses[1].result.tools.length, 6);
});
