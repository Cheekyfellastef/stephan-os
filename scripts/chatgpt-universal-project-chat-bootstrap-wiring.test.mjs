import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHATGPT_SHARED_WORKSPACE_OWNER,
  CHATGPT_SHARED_WORKSPACE_REQUEST_MARKER,
  runChatGptSharedWorkspaceGitHubRelay,
} from './chatgpt-shared-workspace-github-relay.mjs';
import { buildUniversalProjectChatBootstrapV1 } from '../shared/agents/universalProjectChatBootstrapV1.mjs';

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
      });
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.deliveryStatus, 'WORKSPACE_READ_PASS');
  assert.equal(bootstrapCalls, 1);
  assert.match(responseBody, /"projectChatBootstrap"/);
  assert.match(responseBody, /"UNIVERSAL_PROJECT_CHAT_BOOTSTRAP_READY"/);
  assert.match(responseBody, new RegExp(`"sourceHead": "${main}"`));
});

test('bootstrap is ready only when canonical main, Windows checkout and Shared Workspace truth agree', () => {
  const main = 'a'.repeat(40);
  const bootstrap = buildUniversalProjectChatBootstrapV1({
    headTruth: {
      githubMainHead: main,
      windowsCheckoutHead: main,
      sourceHeadsAgree: true,
    },
    workspaceProjection: {
      aggregationOk: true,
      aggregationReason: 'LATEST_STATUS_AGGREGATED',
      currentGoal: { kind: 'goal', title: 'Goal #1418' },
      currentStatus: { kind: 'status', status: 'RUNNING' },
      latestProof: { kind: 'proof', status: 'PASS' },
    },
    timestampUtc: '2026-09-20T11:00:00.000Z',
  });

  assert.equal(bootstrap.ready, true);
  assert.equal(bootstrap.finalVerdict, 'UNIVERSAL_PROJECT_CHAT_BOOTSTRAP_READY');
  assert.equal(bootstrap.sourceHead, main);
  assert.equal(bootstrap.capabilityRegistry.finalVerdict, 'STEPHANOS_CAPABILITY_REGISTRY_PASS');
  assert.equal(bootstrap.operatingRules.chatLocalMemoryIsSystemOfRecord, false);
  assert.equal(bootstrap.operatingRules.createDuplicateLaneBeforeDiscoveryAllowed, false);
  assert.equal(bootstrap.operatingRules.alternateQualifiedRouteMustBeTriedBeforeGlobalBlocker, true);
  assert.equal(bootstrap.requiredBefore.includes('CAPABILITY_DENIAL'), true);
  assert.equal(bootstrap.requiredBefore.includes('CREATE_PULL_REQUEST'), true);
  assert.equal(bootstrap.runbookOrder[1].path, 'shared/agents/universalProjectChatBootstrapV1.RUNBOOK.md');
});

test('bootstrap fails closed instead of letting a new chat operate from stale or broken shared truth', () => {
  const bootstrap = buildUniversalProjectChatBootstrapV1({
    headTruth: {
      githubMainHead: 'b'.repeat(40),
      windowsCheckoutHead: 'c'.repeat(40),
      sourceHeadsAgree: false,
    },
    workspaceProjection: {
      aggregationOk: false,
      aggregationReason: 'SHARED_WORKSPACE_AGGREGATION_FAILED',
    },
    timestampUtc: '2026-09-20T11:00:00.000Z',
  });

  assert.equal(bootstrap.ready, false);
  assert.equal(bootstrap.finalVerdict, 'UNIVERSAL_PROJECT_CHAT_BOOTSTRAP_BLOCKED');
  assert.deepEqual(bootstrap.blockers, [
    'CANONICAL_SOURCE_HEADS_NOT_CONVERGED',
    'SHARED_WORKSPACE_AGGREGATION_BLOCKED',
  ]);
  assert.equal(bootstrap.operatingRules.denyCapabilityBeforeDiscoveryAllowed, false);
  assert.equal(bootstrap.operatingRules.operatorApprovalMayBeInferred, false);
});
