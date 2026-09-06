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
import {
  buildRemoteCodexDispatchCall,
  createRemoteCodexBattleBridgeHandoff,
  createRemoteCodexOperatorApprovalReceipt,
} from './remoteCodexBattleBridgeHandoffV1.mjs';

const HEAD = 'a'.repeat(40);
const OTHER_HEAD = 'c'.repeat(40);
const BASE_HEAD = 'd'.repeat(40);
const NOW = '2026-08-08T12:00:00.000Z';
const TASK = 'Run the exact Battle Bridge ignition proof and return evidence.';

function exactHeadProof() {
  return {
    repository: 'Cheekyfellastef/stephan-os',
    prNumber: 1706,
    expectedHead: HEAD,
    proofTarget: 'PULL_REQUEST_HEAD',
    pullRequestHead: '',
    mergeCommitHead: '',
    githubMainHead: '',
    mergeCommitIncluded: false,
    proofScenario: 'battle-bridge-ignition-proof',
  };
}

function exactBaseBoundHeadProof() {
  return {
    ...exactHeadProof(),
    proofTarget: 'PULL_REQUEST_HEAD_BASE_BOUND',
    pullRequestHead: HEAD,
    githubMainHead: BASE_HEAD,
    proofScenario: 'battle-bridge-base-bound-specialist-review',
  };
}

function remoteDispatchArgs({ observedAt = NOW, proof = exactHeadProof(), surfaceHead = HEAD } = {}) {
  const receiptResult = createRemoteCodexOperatorApprovalReceipt({
    approvalId: 'approval-battle-bridge-ignition',
    requestId: 'remote-battle-bridge-ignition-1706',
    owningIssue: 1293,
    expectedHead: HEAD,
    task: TASK,
    requestedProofCommands: ['git rev-parse HEAD'],
    exactHeadProof: proof,
    approvedAt: '2026-08-08T11:58:00.000Z',
    expiresAt: '2026-08-08T14:00:00.000Z',
  });
  assert.equal(receiptResult.ok, true);
  const handoffResult = createRemoteCodexBattleBridgeHandoff({
    requestId: 'remote-battle-bridge-ignition-1706',
    owningIssue: 1293,
    task: TASK,
    operatorApproval: 'operator-approved',
    operatorApprovalReceipt: receiptResult.receipt,
    expectedHead: HEAD,
    exactHeadProof: proof,
    requestedProofCommands: ['git rev-parse HEAD'],
    createdAt: '2026-08-08T11:59:00.000Z',
    expiresAt: '2026-08-08T14:00:00.000Z',
  });
  assert.equal(handoffResult.ok, true);
  const call = buildRemoteCodexDispatchCall(handoffResult.handoff, {
    schemaVersion: 'stephanos.codex-dispatch-surface-attachment.v1',
    observedAt,
    surfaceReceipt: 'surface-battle-bridge-ignition',
    surfaceId: 'stephanos-codex-dispatch-local-mcp',
    attached: true,
    platform: 'win32',
    can_local_windows_proof: true,
    repositoryRoot: 'C:\\repo',
    sourceHead: surfaceHead,
    serverSourceSha256: 'b'.repeat(64),
    toolsListed: ['dispatch_codex_task', 'get_codex_task_status', 'read_codex_task_result'],
    requiredDispatchToolsPresent: true,
  }, { now: new Date(NOW) });
  assert.equal(call.ok, true);
  return call.args;
}

function windowsAttachmentOptions(overrides = {}) {
  return {
    now: () => NOW,
    attachmentIdentity: {
      platform: 'win32',
      repositoryRoot: 'C:\\repo',
      serverSourceSha256: 'b'.repeat(64),
    },
    readRepositoryHead: () => HEAD,
    ...overrides,
  };
}

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

function requestMeta(id = 1) {
  return { jsonrpc: '2.0', id, isRequest: true, isNotification: false };
}

function notificationMeta() {
  return { jsonrpc: '2.0', isRequest: false, isNotification: true };
}

async function initializeCompatibleSession(handler) {
  const initialized = await handler('initialize', {
    protocolVersion: '2025-06-18',
    clientInfo: { name: 'codex-mcp-client', version: '0.142.0-alpha.6' },
  }, requestMeta());
  await handler('notifications/initialized', {}, notificationMeta());
  return initialized;
}

test('MCP server advertises guarded dispatch, sync, full update, and deterministic diagnostics tools', async () => {
  const attachmentProofs = [];
  const observedHeads = [HEAD, OTHER_HEAD];
  const handler = createCodexDispatchMcpHandler({
    integration: fakeIntegration(),
    hostOps: fakeHostOps(),
    now: () => NOW,
    attachmentProofPublisher: (proof) => attachmentProofs.push(proof),
    attachmentIdentity: {
      platform: 'win32',
      repositoryRoot: 'C:\\repo',
      serverSourceSha256: 'b'.repeat(64),
    },
    readRepositoryHead: () => observedHeads.shift() || OTHER_HEAD,
  });
  const initialized = await initializeCompatibleSession(handler);
  assert.equal(initialized.serverInfo.name, STEPHANOS_CODEX_DISPATCH_MCP_NAME);
  assert.equal(initialized.serverInfo.version, '1.3.0');
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
  assert.equal(attachmentProofs[0].sourceHead, HEAD);
  assert.equal(attachmentProofs[0].serverSourceSha256, 'b'.repeat(64));
  await handler('ping');
  assert.equal(attachmentProofs.length, 2);
  assert.equal(attachmentProofs[1].sourceHead, OTHER_HEAD);
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
      await assert.rejects(
        handler('notifications/initialized', {}, notificationMeta()),
        /MCP_INITIALIZE_REQUIRED/,
      );
      return handler('tools/list');
    },
    async (handler) => {
      await handler('initialize', {
        protocolVersion: '2025-06-18',
        clientInfo: { name: 'codex-mcp-client', version: '0.142.0-alpha.6' },
      }, requestMeta());
      return handler('tools/list');
    },
    async (handler) => {
      await assert.rejects(
        handler('initialize', {
          protocolVersion: '2025-06-18',
          clientInfo: { name: 'Unrelated MCP Client', version: '1.2.3' },
        }, requestMeta()),
        /MCP_CLIENT_NOT_SUPPORTED/,
      );
      return handler('tools/list');
    },
    async (handler) => {
      await assert.rejects(
        handler('initialize', {
          protocolVersion: '2099-01-01',
          clientInfo: { name: 'codex-mcp-client', version: '0.142.0-alpha.6' },
        }, requestMeta()),
        /MCP_PROTOCOL_NOT_SUPPORTED/,
      );
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

test('lifecycle messages require exact request and notification forms and cannot be replayed', async () => {
  const handler = createCodexDispatchMcpHandler({ integration: fakeIntegration(), hostOps: fakeHostOps() });
  const params = {
    protocolVersion: '2025-06-18',
    clientInfo: { name: 'codex-mcp-client', version: '0.142.0-alpha.6' },
  };
  await assert.rejects(handler('initialize', params, notificationMeta()), /MCP_INITIALIZE_REQUEST_REQUIRED/);
  await handler('initialize', params, requestMeta());
  await assert.rejects(handler('initialize', params, requestMeta(2)), /MCP_SESSION_ALREADY_INITIALIZED/);
  await assert.rejects(
    handler('notifications/initialized', {}, requestMeta(3)),
    /MCP_INITIALIZED_NOTIFICATION_REQUIRED/,
  );
  await handler('notifications/initialized', {}, notificationMeta());
  await assert.rejects(
    handler('notifications/initialized', {}, notificationMeta()),
    /MCP_SESSION_ALREADY_READY/,
  );
});

test('lifecycle requests require string or safe-integer JSON-RPC ids before mutating session state', async () => {
  const params = {
    protocolVersion: '2025-06-18',
    clientInfo: { name: 'codex-mcp-client', version: '0.142.0-alpha.6' },
  };
  for (const invalidId of [true, [], {}, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const handler = createCodexDispatchMcpHandler({ integration: fakeIntegration(), hostOps: fakeHostOps() });
    await assert.rejects(
      handler('initialize', params, requestMeta(invalidId)),
      /MCP_INITIALIZE_REQUEST_REQUIRED/,
      JSON.stringify(invalidId),
    );
    await handler('initialize', params, requestMeta('valid-after-rejection'));
    await handler('notifications/initialized', {}, notificationMeta());
    const listed = await handler('tools/list');
    assert.equal(listed.tools.length, 6);
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
  const args = remoteDispatchArgs();
  const handler = createCodexDispatchMcpHandler({ integration, hostOps: fakeHostOps(), ...windowsAttachmentOptions() });
  await initializeCompatibleSession(handler);
  const result = await handler('tools/call', {
    name: 'dispatch_codex_task',
    arguments: args,
  });
  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.ok, true);
  assert.equal(result.structuredContent.decision, 'DISPATCHED');
  assert.equal(integration.calls.length, 1);
  assert.equal(integration.calls[0].issueNumber, 1293);
  assert.equal(integration.calls[0].branch, 'main');
  assert.equal(integration.calls[0].mergeAuthority, false);
  assert.equal(integration.calls[0].approvalRequirements.approvalReceipt, args.operatorApprovalReceipt.bindingSha256);
  assert.deepEqual(integration.calls[0].exactHeadProof, args.exactHeadProof);
});

test('dispatch rejects missing, forged, or mismatched authority without reaching the queue', async () => {
  const cases = [
    (args) => { delete args.operatorApprovalReceipt; },
    (args) => { args.task = `${args.task} tampered`; },
    (args) => { args.authorityEnvelope.operatorApproval = 'denied'; },
    (args) => { args.authorityEnvelope.operatorApprovalReceipt.bindingSha256 = 'f'.repeat(64); },
    (args) => { args.exactHeadProof.proofScenario = 'tampered-proof'; },
    (args) => { args.authorityEnvelope.extraAuthority = true; },
  ];
  for (const tamper of cases) {
    const integration = fakeIntegration();
    const args = structuredClone(remoteDispatchArgs());
    tamper(args);
    const handler = createCodexDispatchMcpHandler({ integration, hostOps: fakeHostOps(), ...windowsAttachmentOptions() });
    await initializeCompatibleSession(handler);
    const result = await handler('tools/call', { name: 'dispatch_codex_task', arguments: args });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.ok, false);
    assert.equal(integration.calls.length, 0);
  }
});

test('dispatch rejects stale or mismatched transported attachments', async () => {
  for (const tamper of [
    (args) => { args.surfaceAttachment.observedAt = '2026-08-08T11:40:00.000Z'; },
    (args) => { args.surfaceAttachment.sourceHead = ''; },
    (args) => { args.surfaceAttachment.requiredDispatchToolsPresent = false; },
    (args) => { args.surfaceAttachment.repositoryRoot = 'C:\\other-repo'; },
  ]) {
    const integration = fakeIntegration();
    const args = structuredClone(remoteDispatchArgs());
    tamper(args);
    const handler = createCodexDispatchMcpHandler({ integration, hostOps: fakeHostOps(), ...windowsAttachmentOptions() });
    await initializeCompatibleSession(handler);
    const result = await handler('tools/call', { name: 'dispatch_codex_task', arguments: args });
    assert.equal(result.isError, true);
    assert.equal(integration.calls.length, 0);
  }
});

test('PR-head dispatch uses one server-resolved clean linked worktree while the control plane remains on main', async () => {
  const targetRoot = 'C:\\approved-review-worktree';
  const integration = fakeIntegration();
  const args = structuredClone(remoteDispatchArgs({
    proof: exactBaseBoundHeadProof(),
    surfaceHead: BASE_HEAD,
  }));
  let resolveCalls = 0;
  let reproofCalls = 0;
  let factoryCalls = 0;
  const handler = createCodexDispatchMcpHandler({
    integration: fakeIntegration(),
    hostOps: fakeHostOps(),
    ...windowsAttachmentOptions({
      readRepositoryHead: (root) => root === targetRoot ? HEAD : BASE_HEAD,
    }),
    resolveReadOnlyReviewWorktree(input) {
      resolveCalls += 1;
      assert.equal(input.canonicalRepositoryRoot, 'C:\\repo');
      assert.equal(input.expectedHead, HEAD);
      assert.equal(input.proofTarget, 'PULL_REQUEST_HEAD_BASE_BOUND');
      return {
        ok: true,
        worktree: {
          schemaVersion: 'stephanos.read-only-pull-request-worktree.v1',
          repositoryRoot: targetRoot,
          sourceHead: HEAD,
          commonDirectory: 'C:\\repo\\.git',
          cleanTrackedAndUntracked: true,
          ignoredFilesAbsent: true,
          sourceMutationAllowed: false,
        },
      };
    },
    reproveReadOnlyReviewWorktree(receipt) {
      reproofCalls += 1;
      assert.equal(receipt.repositoryRoot, targetRoot);
      return { ok: true, worktree: receipt };
    },
    integrationForRepositoryRoot({ repoRoot }) {
      factoryCalls += 1;
      assert.equal(repoRoot, targetRoot);
      return integration;
    },
  });
  await initializeCompatibleSession(handler);
  const result = await handler('tools/call', { name: 'dispatch_codex_task', arguments: args });
  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.ok, true);
  assert.equal(result.structuredContent.executionProof.mode, 'registered-read-only-pr-worktree');
  assert.equal(result.structuredContent.executionProof.controlHead, BASE_HEAD);
  assert.equal(result.structuredContent.executionProof.sourceHead, HEAD);
  assert.equal(result.structuredContent.executionProof.sourceMutationAllowed, false);
  assert.equal(resolveCalls, 1);
  assert.equal(reproofCalls, 1);
  assert.equal(factoryCalls, 1);
  assert.equal(integration.calls.length, 1);
});

test('PR-head dispatch fails before queue creation when no exact clean worktree is proven', async () => {
  const integration = fakeIntegration();
  const args = structuredClone(remoteDispatchArgs({
    proof: exactBaseBoundHeadProof(),
    surfaceHead: BASE_HEAD,
  }));
  const handler = createCodexDispatchMcpHandler({
    integration,
    hostOps: fakeHostOps(),
    ...windowsAttachmentOptions({ readRepositoryHead: () => BASE_HEAD }),
    resolveReadOnlyReviewWorktree: () => ({
      ok: false,
      verdict: 'BLOCKED',
      blocker: 'READ_ONLY_PR_WORKTREE_EXACT_CLEAN_CANDIDATE_NOT_FOUND',
    }),
  });
  await initializeCompatibleSession(handler);
  const result = await handler('tools/call', { name: 'dispatch_codex_task', arguments: args });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.blocker, 'READ_ONLY_PR_WORKTREE_EXACT_CLEAN_CANDIDATE_NOT_FOUND');
  assert.equal(integration.calls.length, 0);
});

test('dispatch revalidates approval expiry at the MCP boundary', async () => {
  const integration = fakeIntegration();
  const handler = createCodexDispatchMcpHandler({
    integration,
    hostOps: fakeHostOps(),
    ...windowsAttachmentOptions({ now: () => '2026-08-08T14:01:00.000Z' }),
  });
  await initializeCompatibleSession(handler);
  const result = await handler('tools/call', { name: 'dispatch_codex_task', arguments: remoteDispatchArgs() });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.blocker, 'REMOTE_CODEX_HANDOFF_EXPIRED');
  assert.equal(integration.calls.length, 0);
});

test('dispatch fails closed if local HEAD advances after attachment and before queue creation', async () => {
  const integration = fakeIntegration();
  const heads = [HEAD, OTHER_HEAD];
  const handler = createCodexDispatchMcpHandler({
    integration,
    hostOps: fakeHostOps(),
    ...windowsAttachmentOptions({ readRepositoryHead: () => heads.shift() || OTHER_HEAD }),
  });
  await initializeCompatibleSession(handler);
  const result = await handler('tools/call', { name: 'dispatch_codex_task', arguments: remoteDispatchArgs() });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.blocker, 'BATTLE_BRIDGE_EXECUTION_HEAD_CHANGED');
  assert.equal(integration.calls.length, 0);
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

test('sync tool exposes only the fixed Battle Bridge runtime-data preservation profile and requires separate approval', async () => {
  const hostOps = fakeHostOps();
  const handler = createCodexDispatchMcpHandler({ integration: fakeIntegration(), hostOps });
  await initializeCompatibleSession(handler);
  const listed = await handler('tools/list');
  const syncTool = listed.tools.find((tool) => tool.name === 'sync_codex_dispatch_bridge');
  assert.deepEqual(syncTool.inputSchema.properties.preservationProfile.enum, ['battle-bridge-runtime-data-v1']);
  assert.equal(syncTool.inputSchema.properties.repoRoot, undefined);
  assert.equal(syncTool.inputSchema.properties.paths, undefined);

  const denied = await handler('tools/call', {
    name: 'sync_codex_dispatch_bridge',
    arguments: {
      operatorApproval: 'operator-approved',
      expectedBranch: 'main',
      preservationProfile: 'battle-bridge-runtime-data-v1',
    },
  });
  assert.equal(denied.isError, true);
  assert.equal(denied.structuredContent.blocker, 'PRESERVATION_APPROVAL_REQUIRED');

  const approved = await handler('tools/call', {
    name: 'sync_codex_dispatch_bridge',
    arguments: {
      operatorApproval: 'operator-approved',
      expectedBranch: 'main',
      preservationProfile: 'battle-bridge-runtime-data-v1',
      preservationApproval: 'operator-approved',
    },
  });
  assert.equal(approved.isError, false);
  assert.deepEqual(hostOps.calls.at(-1), {
    tool: 'sync',
    args: {
      operatorApproval: 'operator-approved',
      expectedBranch: 'main',
      preservationProfile: 'battle-bridge-runtime-data-v1',
      preservationApproval: 'operator-approved',
    },
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

test('stdio transport rejects lifecycle messages with request and notification identities reversed', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const attachmentProofs = [];
  let captured = '';
  output.on('data', (chunk) => { captured += chunk.toString(); });
  const handler = createCodexDispatchMcpHandler({
    integration: fakeIntegration(),
    hostOps: fakeHostOps(),
    attachmentProofPublisher: (proof) => attachmentProofs.push(proof),
    ...windowsAttachmentOptions(),
  });
  const server = runStdioMcpServer({ input, output, handler });
  const params = { protocolVersion: '2025-06-18', clientInfo: { name: 'codex-mcp-client', version: '0.142.0-alpha.6' } };
  input.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'initialize', params })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'notifications/initialized', params: {} })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/list', params: {} })}\n`);
  input.end();
  await server;
  const responses = captured.trim().split(/\r?\n/).map(JSON.parse);
  assert.deepEqual(responses.map((response) => response.id), [1, 2, 3, 4]);
  assert.equal(responses[1].error.message, 'MCP_INITIALIZED_NOTIFICATION_REQUIRED');
  assert.equal(attachmentProofs.length, 1);
  assert.equal(attachmentProofs[0].clientSession.ready, true);
});

test('stdio transport rejects malformed JSON-RPC request ids before lifecycle handling', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const attachmentProofs = [];
  let captured = '';
  output.on('data', (chunk) => { captured += chunk.toString(); });
  const handler = createCodexDispatchMcpHandler({
    integration: fakeIntegration(),
    hostOps: fakeHostOps(),
    attachmentProofPublisher: (proof) => attachmentProofs.push(proof),
    ...windowsAttachmentOptions(),
  });
  const server = runStdioMcpServer({ input, output, handler });
  const params = { protocolVersion: '2025-06-18', clientInfo: { name: 'codex-mcp-client', version: '0.142.0-alpha.6' } };
  for (const id of [true, [], {}, 1.5]) {
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id, method: 'initialize', params })}\n`);
  }
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 'valid', method: 'initialize', params })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`);
  input.end();
  await server;
  const responses = captured.trim().split(/\r?\n/).map(JSON.parse);
  assert.deepEqual(responses.slice(0, 4).map(({ id, error }) => [id, error.message]), [
    [null, 'Invalid Request'],
    [null, 'Invalid Request'],
    [null, 'Invalid Request'],
    [null, 'Invalid Request'],
  ]);
  assert.deepEqual(responses.slice(4).map((response) => response.id), ['valid', 2]);
  assert.equal(attachmentProofs.length, 1);
  assert.equal(attachmentProofs[0].clientSession.ready, true);
});
