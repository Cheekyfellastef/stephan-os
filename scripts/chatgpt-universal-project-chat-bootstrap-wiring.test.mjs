import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHATGPT_SHARED_WORKSPACE_OWNER,
  CHATGPT_SHARED_WORKSPACE_REQUEST_MARKER,
  runChatGptSharedWorkspaceGitHubRelay,
} from './chatgpt-shared-workspace-github-relay.mjs';

function envelope(request) {
  return `${CHATGPT_SHARED_WORKSPACE_REQUEST_MARKER}\n## Request\n\`\`\`json\n${JSON.stringify({
    schemaVersion: 'chatgpt-participant-bridge.v1',
    state: 'REQUEST_READY',
    request,
  })}\n\`\`\``;
}

function request() {
  return {
    schemaVersion: 'chatgpt-participant-bridge.v1',
    requestId: 'bootstrap-wiring-proof',
    timestampUtc: '2026-09-20T11:00:00.000Z',
    participantId: 'chatgpt-bridge',
    operation: 'READ_CURRENT_STATUS',
    recordKind: 'current-status-projection',
    relatedGoal: '#1418',
    relatedPr: '',
    correlationId: 'goal-1418-bootstrap-proof',
    boundedPayload: {},
    approvalRef: '',
    expiryUtc: '2026-09-20T12:00:00.000Z',
    redactionPolicy: 'sanitize-secrets-and-runtime-paths',
  };
}

function syncRecord(head) {
  return {
    schemaVersion: 'shared-agent-workspace-record.v1',
    kind: 'stephanos.shared_workspace.status',
    statusId: 'battle-bridge-github-sync-current',
    participantId: 'codex',
    timestampUtc: '2026-09-20T10:59:00.000Z',
    classification: 'SYNC_NO_CHANGE',
    status: 'SYNC_NO_CHANGE',
    localHeadBefore: head,
    remoteHeadObserved: head,
    repositoryIdentity: 'Cheekyfellastef/stephan-os',
    branch: 'main',
    remote: 'origin',
    taskName: 'Stephanos Battle Bridge GitHub Sync',
    syncRecordKind: 'battle-bridge-github-sync-receipt',
    proofRefs: ['receipts/battle-bridge-github-sync/current.json'],
    authority: {
      canonicalRepositoryOnly: true,
      fastForwardOnly: true,
      arbitraryShellAllowed: false,
      pushAllowed: false,
      mergeToGitHubAllowed: false,
    },
  };
}

function memoryWorkspace() {
  const records = new Map();
  return {
    receiptExistsFn: async ({ receiptId }) => records.has(`receipts/${receiptId}.json`),
    recordExistsFn: async ({ segments }) => records.has(segments.join('/')),
    writeAtomicJsonFn: async (_root, segments, record) => {
      records.set(segments.join('/'), record);
      return { ok: true, reason: 'ATOMIC_JSON_WRITTEN', bytes: 100 };
    },
  };
}

test('READ_CURRENT_STATUS carries the universal project-chat bootstrap pack from production relay wiring', async () => {
  const main = '8'.repeat(40);
  const workspace = memoryWorkspace();
  let responseBody = '';
  let bootstrapCalls = 0;

  const result = await runChatGptSharedWorkspaceGitHubRelay({
    now: new Date('2026-09-20T11:00:00.000Z'),
    paths: { repoRoot: '/repo', workspaceRoot: '/shared' },
    adapter: {
      readRequest: () => ({
        ok: true,
        body: envelope(request()),
        authorLogin: CHATGPT_SHARED_WORKSPACE_OWNER,
      }),
      writeResponse: (body) => {
        responseBody = body;
        return { ok: true, reason: 'RESPONSE_COMMENT_UPDATED' };
      },
    },
    receiptExistsFn: workspace.receiptExistsFn,
    recordExistsFn: workspace.recordExistsFn,
    writeAtomicJsonFn: workspace.writeAtomicJsonFn,
    projectionBuilder: async () => ({
      aggregationOk: true,
      aggregationReason: 'LATEST_STATUS_AGGREGATED',
      currentGoal: { kind: 'goal', title: 'Operator Attention & Completion Loop V1' },
      currentStatus: { kind: 'status', status: 'RUNNING', summary: 'Bootstrap repair active' },
      latestProof: { kind: 'proof', status: 'PASS', summary: 'Shared truth available' },
      freshnessUtc: '2026-09-20T11:00:00.000Z',
    }),
    headTruthEvidenceLoader: async () => ({ records: { sync: syncRecord(main) } }),
    projectChatBootstrapBuilder: ({ headTruth, workspaceProjection, timestampUtc }) => {
      bootstrapCalls += 1;
      assert.equal(headTruth.githubMainHead, main);
      assert.equal(headTruth.windowsCheckoutHead, main);
      assert.equal(workspaceProjection.aggregationOk, true);
      assert.equal(timestampUtc, '2026-09-20T11:00:00.000Z');
      return Object.freeze({
        schemaVersion: 'stephanos.universal-project-chat-bootstrap.v1',
        ready: true,
        finalVerdict: 'UNIVERSAL_PROJECT_CHAT_BOOTSTRAP_READY',
        sourceHead: main,
        requiredBefore: ['CAPABILITY_DENIAL', 'CREATE_GOAL'],
        runbookOrder: [{ order: 1, path: 'AGENTS.md', purpose: 'doctrine' }],
        operatingRules: { workConservingControllerCycleRequired: true, safeCapacityRefillAfterMaterialActionRequired: true, waitingLaneMayTerminateControllerCycle: false, sharedWorkConservingPolicyOwnerIssue: 1947, elasticWidthPolicyOwnerIssue: 1637 },
        capabilityRegistry: { schemaVersion: 'registry.v1', registryVersion: '1', sourceHead: main, capabilityCount: 1, finalVerdict: 'STEPHANOS_CAPABILITY_REGISTRY_PASS', capabilities: [{ capabilityId: 'multiplexer', discoveryRoute: 'capability-registry:multiplexer', ownerIssue: 1637 }] },
      });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.deliveryStatus, 'WORKSPACE_READ_PASS');
  assert.equal(bootstrapCalls, 1);
  assert.match(responseBody, /"projectChatBootstrap"/);
  assert.match(responseBody, /"UNIVERSAL_PROJECT_CHAT_BOOTSTRAP_READY"/);
  assert.match(responseBody, new RegExp(`"sourceHead": "${main}"`));
  assert.match(responseBody, /"runbookOrder"/);
  assert.match(responseBody, /"AGENTS.md"/);
  assert.match(responseBody, /"capabilityId": "multiplexer"/);
  assert.match(responseBody, /"discoveryRoute": "capability-registry:multiplexer"/);
  assert.match(responseBody, /"workConservingControllerCycleRequired": true/);
  assert.match(responseBody, /"waitingLaneMayTerminateControllerCycle": false/);
});
