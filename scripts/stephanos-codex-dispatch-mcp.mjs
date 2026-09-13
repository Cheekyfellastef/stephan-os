#!/usr/bin/env node
import readline from 'node:readline';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import {
  createCodexQueueRecord,
  transitionCodexQueueRecord,
} from '../shared/agents/codexDispatchQueue.mjs';
import { dispatchQueuedCodexJob } from '../shared/agents/automatedCodexDispatcher.mjs';
import {
  createLocalCodexExecIntegration,
  readLocalCodexTaskResult,
  readLocalCodexTaskStatus,
} from '../shared/agents/localCodexExecIntegration.mjs';
import {
  runBattleBridgeDiagnostics,
  syncCodexDispatchBridge,
} from '../shared/agents/codexDispatchHostOps.mjs';
import { BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_PROFILE } from '../shared/agents/battleBridgeDirtyDataPreservationV1.mjs';
import { updateStephanosFromChat } from '../shared/agents/stephanosChatUpdate.mjs';
import {
  validateRemoteCodexBattleBridgeAttachment,
  validateRemoteCodexBattleBridgeHandoff,
} from '../shared/agents/remoteCodexBattleBridgeHandoffV1.mjs';
import {
  reproveReadOnlyPullRequestWorktree,
  resolveReadOnlyPullRequestWorktree,
} from '../shared/agents/readOnlyPullRequestWorktreeV1.mjs';
import { resolveBattleBridgeGitExecution } from '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';

export const STEPHANOS_CODEX_DISPATCH_MCP_SCHEMA = 'stephanos.codex-dispatch-mcp.v1';
export const STEPHANOS_CODEX_DISPATCH_MCP_NAME = 'stephanos-codex-dispatch';
export const STEPHANOS_CODEX_DISPATCH_ATTACHMENT_SCHEMA = 'stephanos.codex-dispatch-surface-attachment.v1';

const SUPPORTED_CODEX_CLIENT_NAMES = Object.freeze(new Set(['codex-mcp-client']));
const SUPPORTED_MCP_PROTOCOL_VERSIONS = Object.freeze(new Set([
  '2024-11-05',
  '2025-03-26',
  '2025-06-18',
]));
const CLIENT_VERSION = /^[0-9A-Za-z][0-9A-Za-z._+-]{0,39}$/;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TOOLS = Object.freeze([
  {
    name: 'dispatch_codex_task',
    title: 'Dispatch guarded Battle Bridge Codex task',
    description: 'Dispatch one operator-approved proof or diagnostics task to the local Battle Bridge Codex worker. This tool cannot merge, push, reset branches, delete branches, or authorize source changes.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: [
        'requestId', 'issueNumber', 'task', 'operatorApproval', 'operatorApprovalReceipt',
        'repository', 'expectedHead', 'exactHeadProof', 'branch', 'requestedProofCommands',
        'authorityEnvelope', 'surfaceAttachment',
      ],
      properties: {
        requestId: { type: 'string', minLength: 8, maxLength: 121 },
        issueNumber: { type: 'integer', minimum: 1, description: 'Owning GitHub issue or goal number.' },
        task: { type: 'string', minLength: 20, maxLength: 4000, description: 'Exact bounded Battle Bridge proof or diagnostics task.' },
        operatorApproval: { type: 'string', enum: ['operator-approved'], description: 'Must only be supplied after the user explicitly requests dispatch.' },
        operatorApprovalReceipt: { type: 'object' },
        repository: { type: 'string', enum: ['Cheekyfellastef/stephan-os'] },
        expectedHead: { type: 'string', pattern: '^[0-9a-f]{40}$' },
        exactHeadProof: { type: 'object' },
        branch: { type: 'string', enum: ['main'] },
        requestedProofCommands: {
          type: 'array',
          maxItems: 20,
          items: { type: 'string', maxLength: 300 },
        },
        authorityEnvelope: { type: 'object' },
        surfaceAttachment: { type: 'object' },
      },
    },
    annotations: {
      title: 'Dispatch guarded Codex task',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'get_codex_task_status',
    title: 'Get Codex task status',
    description: 'Read the current status of a previously dispatched Battle Bridge Codex task.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['taskId'],
      properties: { taskId: { type: 'string', minLength: 1, maxLength: 121 } },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'read_codex_task_result',
    title: 'Read Codex task result',
    description: 'Read the final structured proof result for a completed Battle Bridge Codex task.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['taskId'],
      properties: { taskId: { type: 'string', minLength: 1, maxLength: 121 } },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'sync_codex_dispatch_bridge',
    title: 'Sync and test the Codex dispatch bridge',
    description: 'Operator-approved, fast-forward-only sync of canonical main followed by dispatch bridge regression tests. An optional separately approved fixed preservation profile may move only its exact untracked runtime-data estate into the canonical external workspace after non-divergence proof. No caller-selected paths are accepted. It never resets, cleans, stashes, force-checks out, or discards local work.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['operatorApproval'],
      properties: {
        operatorApproval: { type: 'string', enum: ['operator-approved'] },
        expectedBranch: { type: 'string', enum: ['main'], default: 'main' },
        preservationProfile: { type: 'string', enum: [BATTLE_BRIDGE_RUNTIME_DATA_PRESERVATION_PROFILE] },
        preservationApproval: { type: 'string', enum: ['operator-approved'] },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'update_stephanos_from_chat',
    title: 'Update Stephanos source and exact-head runtime',
    description: 'Operator-approved full Stephanos update from chat: fast-forward canonical main, run bridge tests, invoke the existing guarded ignition entry, and prove the served UI plus backend and OpenClaw health. No manual PowerShell is required.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['operatorApproval'],
      properties: {
        operatorApproval: { type: 'string', enum: ['operator-approved'] },
        expectedBranch: { type: 'string', enum: ['main'], default: 'main' },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'run_battle_bridge_diagnostics',
    title: 'Run direct Battle Bridge diagnostics',
    description: 'Run deterministic read-only Git and localhost health diagnostics directly in the trusted MCP host, without a Codex child, PowerShell, service control, source mutation, or shell-policy dependency.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
]);

function boundedText(value, maxLength = 160) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function normalizeClientInfo(clientInfo = {}) {
  const name = boundedText(clientInfo?.name, 80);
  const version = boundedText(clientInfo?.version, 40);
  return Object.freeze({
    name,
    version,
    supported: SUPPORTED_CODEX_CLIENT_NAMES.has(name.toLowerCase()) && CLIENT_VERSION.test(version),
  });
}

function normalizeClientSession(clientSession = {}, clientInfo = {}) {
  const normalizedClient = normalizeClientInfo(clientInfo);
  const session = Object.freeze({
    sessionId: boundedText(clientSession?.sessionId, 36),
    protocolVersion: boundedText(clientSession?.protocolVersion, 24),
    initializeReceived: clientSession?.initializeReceived === true,
    initializedNotificationReceived: clientSession?.initializedNotificationReceived === true,
    initializedAt: boundedText(clientSession?.initializedAt, 40),
    readyAt: boundedText(clientSession?.readyAt, 40),
    supportedClient: normalizedClient.supported,
  });
  const initializedAt = Date.parse(session.initializedAt);
  const readyAt = Date.parse(session.readyAt);
  const ready = SESSION_ID.test(session.sessionId)
    && SUPPORTED_MCP_PROTOCOL_VERSIONS.has(session.protocolVersion)
    && session.initializeReceived
    && session.initializedNotificationReceived
    && session.supportedClient
    && Number.isFinite(initializedAt)
    && Number.isFinite(readyAt)
    && readyAt >= initializedAt;
  return Object.freeze({ ...session, ready });
}

function readSourceHead(repoRoot) {
  if (!repoRoot) return '';
  const gitExecution = resolveBattleBridgeGitExecution({ platform: process.platform, environment: process.env });
  try {
    return boundedText(execFileSync(gitExecution.executable, [...gitExecution.fixedConfigArgs, '-C', repoRoot, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      env: gitExecution.environment,
      windowsHide: true,
      timeout: 15_000,
    }), 40).toLowerCase();
  } catch {
    return '';
  }
}

function currentServerSourceSha256() {
  try {
    return createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex');
  } catch {
    return '';
  }
}

export function createCodexDispatchAttachmentProof({
  clientInfo = {},
  clientSession = {},
  now = new Date().toISOString(),
  platform = process.platform,
  repositoryRoot = process.env.STEPHANOS_REPO_ROOT || '',
  sourceHead = readSourceHead(repositoryRoot),
  serverSourceSha256 = currentServerSourceSha256(),
  surfaceReceipt = `codex-dispatch-surface-${randomUUID()}`,
} = {}) {
  const toolNames = TOOLS.map((tool) => tool.name);
  const windows = platform === 'win32';
  const exactSourceHead = /^[0-9a-f]{40}$/.test(sourceHead) ? sourceHead : '';
  const exactServerSourceSha256 = /^[0-9a-f]{64}$/.test(serverSourceSha256) ? serverSourceSha256 : '';
  const normalizedClient = normalizeClientInfo(clientInfo);
  const normalizedSession = normalizeClientSession(clientSession, normalizedClient);
  const attached = windows && Boolean(exactSourceHead) && Boolean(exactServerSourceSha256) && normalizedSession.ready;
  return Object.freeze({
    schemaVersion: STEPHANOS_CODEX_DISPATCH_ATTACHMENT_SCHEMA,
    observedAt: now,
    surfaceReceipt,
    surfaceId: 'stephanos-codex-dispatch-local-mcp',
    attached,
    platform,
    can_local_windows_proof: attached,
    repositoryRoot: repositoryRoot ? resolve(repositoryRoot) : '',
    sourceHead: exactSourceHead,
    serverSourceSha256: exactServerSourceSha256,
    clientInfo: Object.freeze({ name: normalizedClient.name, version: normalizedClient.version }),
    clientSession: normalizedSession,
    transport: Object.freeze({
      kind: 'local-stdio',
      clientIdentityAuthenticated: false,
      remoteTransportAuthenticated: false,
    }),
    toolsListed: Object.freeze(toolNames),
    requiredDispatchToolsPresent: ['dispatch_codex_task', 'get_codex_task_status', 'read_codex_task_result']
      .every((name) => toolNames.includes(name)),
  });
}

export function publishCodexDispatchAttachmentProof(proof, {
  sharedWorkspace = process.env.STEPHANOS_SHARED_WORKSPACE || '',
} = {}) {
  if (!sharedWorkspace || proof?.platform !== 'win32' || proof?.attached !== true) return null;
  const proofPath = join(sharedWorkspace, 'codex-dispatch', 'surface-attachment-latest.json');
  const tempPath = `${proofPath}.${process.pid}.${randomUUID()}.tmp`;
  mkdirSync(dirname(proofPath), { recursive: true });
  writeFileSync(tempPath, `${JSON.stringify(proof, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  renameSync(tempPath, proofPath);
  return proofPath;
}

function asTextResult(value, isError = false) {
  const text = JSON.stringify(value, null, 2);
  return { content: [{ type: 'text', text }], structuredContent: value, isError };
}

const REMOTE_DISPATCH_ARGUMENT_FIELDS = Object.freeze([
  'requestId', 'issueNumber', 'task', 'operatorApproval', 'operatorApprovalReceipt', 'repository',
  'expectedHead', 'exactHeadProof', 'branch', 'requestedProofCommands', 'authorityEnvelope',
  'surfaceAttachment',
]);

function validateRemoteDispatchArguments(args, timestamp) {
  if (!args || typeof args !== 'object' || Array.isArray(args)
      || !isDeepStrictEqual(Object.keys(args).sort(), [...REMOTE_DISPATCH_ARGUMENT_FIELDS].sort())) {
    return { ok: false, blocker: 'REMOTE_CODEX_DISPATCH_ARGUMENT_SHAPE_INVALID' };
  }
  const handoff = args.authorityEnvelope;
  const validation = validateRemoteCodexBattleBridgeHandoff(handoff, { now: new Date(timestamp) });
  if (!validation.ok) return validation;
  const comparisons = [
    ['requestId', args.requestId, handoff.requestId],
    ['issueNumber', args.issueNumber, handoff.owningIssue],
    ['task', args.task, handoff.task],
    ['operatorApproval', args.operatorApproval, handoff.operatorApproval],
    ['operatorApprovalReceipt', args.operatorApprovalReceipt, handoff.operatorApprovalReceipt],
    ['repository', args.repository, handoff.repository],
    ['expectedHead', args.expectedHead, handoff.expectedHead],
    ['exactHeadProof', args.exactHeadProof, handoff.exactHeadProof],
    ['branch', args.branch, 'main'],
    ['requestedProofCommands', args.requestedProofCommands, handoff.requestedProofCommands],
  ];
  const mismatch = comparisons.find(([, actual, expected]) => !isDeepStrictEqual(actual, expected));
  if (mismatch) return { ok: false, blocker: 'REMOTE_CODEX_DISPATCH_ARGUMENT_MISMATCH', field: mismatch[0] };
  return { ok: true, handoff };
}

function approvedQueueRecord(args, now) {
  const created = createCodexQueueRecord({
    issueNumber: args.issueNumber,
    branch: args.branch || 'main',
    prompt: args.task,
    requestedProofCommands: args.requestedProofCommands,
    exactHeadProof: args.exactHeadProof,
    createdAt: now,
    approvalRequirements: {
      requiresOperatorApprovalBeforeDispatch: true,
      requiresExactHeadApproval: true,
      requiresOperatorApprovalBeforeMerge: true,
    },
  });
  const waiting = transitionCodexQueueRecord(created, 'WAITING_OPERATOR_APPROVAL', {
    timestamp: now,
    reason: 'ChatGPT MCP dispatch requested explicit operator confirmation.',
  });
  if (!waiting.valid) throw new Error(`Unable to enter operator approval state: ${waiting.error || waiting.errors?.join(', ')}`);
  const ready = transitionCodexQueueRecord(waiting.record, 'READY_FOR_MANUAL_DISPATCH', {
    timestamp: now,
    reason: 'Operator approved guarded Battle Bridge Codex dispatch.',
    approvalReceipt: args.operatorApprovalReceipt.bindingSha256,
  });
  if (!ready.valid) throw new Error(`Unable to record operator approval: ${ready.error || ready.errors?.join(', ')}`);
  return ready.record;
}

export function createCodexDispatchMcpHandler({
  integration = createLocalCodexExecIntegration(),
  integrationForRepositoryRoot = ({ repoRoot }) => createLocalCodexExecIntegration({ repoRoot }),
  hostOps = { syncCodexDispatchBridge, updateStephanosFromChat, runBattleBridgeDiagnostics },
  now = () => new Date().toISOString(),
  attachmentProofPublisher = publishCodexDispatchAttachmentProof,
  attachmentIdentity = {},
  readRepositoryHead = readSourceHead,
  resolveReadOnlyReviewWorktree = resolveReadOnlyPullRequestWorktree,
  reproveReadOnlyReviewWorktree = reproveReadOnlyPullRequestWorktree,
} = {}) {
  let clientInfo = {};
  let clientSession = null;
  let toolsListed = false;
  const repositoryRoot = attachmentIdentity.repositoryRoot || process.env.STEPHANOS_REPO_ROOT || '';
  const processAttachmentIdentity = Object.freeze({
    platform: attachmentIdentity.platform || process.platform,
    repositoryRoot,
    serverSourceSha256: attachmentIdentity.serverSourceSha256 || currentServerSourceSha256(),
  });
  const publishAttachmentHeartbeat = () => attachmentProofPublisher(createCodexDispatchAttachmentProof({
    clientInfo,
    clientSession,
    now: now(),
    sourceHead: readRepositoryHead(repositoryRoot),
    ...processAttachmentIdentity,
  }));
  const clientSessionReady = () => normalizeClientSession(clientSession, clientInfo).ready;
  return async function handle(method, params = {}, message = {}) {
    const messageIsRequest = message.isRequest === true
      && message.isNotification !== true
      && (typeof message.id === 'string' || Number.isSafeInteger(message.id));
    const messageIsNotification = message.isNotification === true
      && message.isRequest !== true
      && message.id === undefined;
    if (method === 'initialize') {
      if (!messageIsRequest) throw new Error('MCP_INITIALIZE_REQUEST_REQUIRED');
      if (clientSession !== null) throw new Error('MCP_SESSION_ALREADY_INITIALIZED');
      const requestedClientInfo = params.clientInfo && typeof params.clientInfo === 'object' ? params.clientInfo : {};
      const normalizedClient = normalizeClientInfo(requestedClientInfo);
      const requestedProtocolVersion = boundedText(params.protocolVersion, 24);
      if (!normalizedClient.supported) throw new Error('MCP_CLIENT_NOT_SUPPORTED');
      if (!SUPPORTED_MCP_PROTOCOL_VERSIONS.has(requestedProtocolVersion)) throw new Error('MCP_PROTOCOL_NOT_SUPPORTED');
      clientInfo = requestedClientInfo;
      const initializedAt = now();
      clientSession = {
        sessionId: randomUUID(),
        protocolVersion: requestedProtocolVersion,
        initializeReceived: true,
        initializedNotificationReceived: false,
        initializedAt,
        readyAt: '',
      };
      toolsListed = false;
      return {
        protocolVersion: requestedProtocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: STEPHANOS_CODEX_DISPATCH_MCP_NAME, version: '1.3.0' },
        instructions: 'Prefer direct GitHub work for source changes. Use update_stephanos_from_chat for an approved complete Battle Bridge update, sync_codex_dispatch_bridge for source-only bridge updates, run_battle_bridge_diagnostics for deterministic local proof, and dispatch_codex_task only when a real Codex child is genuinely required.',
      };
    }
    if (method === 'ping') {
      if (toolsListed && clientSessionReady()) publishAttachmentHeartbeat();
      return {};
    }
    if (method === 'tools/list') {
      toolsListed = clientSessionReady();
      if (toolsListed) publishAttachmentHeartbeat();
      return { tools: TOOLS };
    }
    if (method === 'tools/call') {
      if (!clientSessionReady()) {
        return asTextResult({ ok: false, blocker: 'MCP_CLIENT_SESSION_NOT_READY' }, true);
      }
      if (toolsListed) publishAttachmentHeartbeat();
      const name = String(params.name || '');
      const args = params.arguments || {};
      if (name === 'dispatch_codex_task') {
        if (args.operatorApproval !== 'operator-approved') {
          return asTextResult({ ok: false, blocker: 'OPERATOR_APPROVAL_REQUIRED', nextOperatorAction: 'Ask the operator to explicitly approve this exact dispatch.' }, true);
        }
        const timestamp = now();
        const argumentValidation = validateRemoteDispatchArguments(args, timestamp);
        if (!argumentValidation.ok) return asTextResult(argumentValidation, true);
        const transportedAttachmentValidation = validateRemoteCodexBattleBridgeAttachment(
          argumentValidation.handoff,
          args.surfaceAttachment,
          { now: new Date(timestamp) },
        );
        if (!transportedAttachmentValidation.ok) return asTextResult(transportedAttachmentValidation, true);
        const transportedRepositoryRoot = args.surfaceAttachment?.repositoryRoot
          ? resolve(String(args.surfaceAttachment.repositoryRoot))
          : '';
        const canonicalRepositoryRoot = repositoryRoot ? resolve(repositoryRoot) : '';
        if (!transportedRepositoryRoot || transportedRepositoryRoot !== canonicalRepositoryRoot) {
          return asTextResult({ ok: false, blocker: 'BATTLE_BRIDGE_ATTACHMENT_REPOSITORY_ROOT_MISMATCH' }, true);
        }
        const controlHead = readRepositoryHead(repositoryRoot);
        if (!/^[0-9a-f]{40}$/.test(controlHead)) {
          return asTextResult({
            ok: false,
            blocker: 'BATTLE_BRIDGE_CONTROL_HEAD_INVALID',
            expectedHead: argumentValidation.handoff.expectedHead,
            observedHead: controlHead,
          }, true);
        }
        const liveAttachment = createCodexDispatchAttachmentProof({
          clientInfo,
          clientSession,
          now: timestamp,
          sourceHead: controlHead,
          ...processAttachmentIdentity,
        });
        const liveAttachmentValidation = validateRemoteCodexBattleBridgeAttachment(
          argumentValidation.handoff,
          liveAttachment,
          { now: new Date(timestamp) },
        );
        if (!liveAttachmentValidation.ok) return asTextResult(liveAttachmentValidation, true);

        let executionRepositoryRoot = repositoryRoot;
        let executionIntegration = integration;
        let executionMode = 'canonical-attached-head';
        let linkedWorktreeReceipt = null;
        if (controlHead !== argumentValidation.handoff.expectedHead) {
          if (argumentValidation.handoff.exactHeadProof.proofTarget !== 'PULL_REQUEST_HEAD_BASE_BOUND') {
            return asTextResult({
              ok: false,
              blocker: 'BATTLE_BRIDGE_PR_WORKTREE_BASE_BOUND_PROOF_REQUIRED',
              expectedHead: argumentValidation.handoff.expectedHead,
              observedHead: controlHead,
            }, true);
          }
          const resolvedWorktree = resolveReadOnlyReviewWorktree({
            canonicalRepositoryRoot: repositoryRoot,
            expectedHead: argumentValidation.handoff.expectedHead,
            proofTarget: argumentValidation.handoff.exactHeadProof.proofTarget,
          });
          if (!resolvedWorktree?.ok) return asTextResult(resolvedWorktree, true);
          linkedWorktreeReceipt = resolvedWorktree.worktree;
          executionRepositoryRoot = linkedWorktreeReceipt.repositoryRoot;
          try {
            executionIntegration = integrationForRepositoryRoot({ repoRoot: executionRepositoryRoot });
          } catch {
            return asTextResult({ ok: false, blocker: 'READ_ONLY_PR_WORKTREE_INTEGRATION_UNAVAILABLE' }, true);
          }
          executionMode = 'registered-read-only-pr-worktree';
        }

        if (linkedWorktreeReceipt) {
          const reproof = reproveReadOnlyReviewWorktree(linkedWorktreeReceipt, {
            canonicalRepositoryRoot: repositoryRoot,
          });
          if (!reproof?.ok) return asTextResult(reproof, true);
        }
        const executionHead = readRepositoryHead(executionRepositoryRoot);
        if (executionHead !== argumentValidation.handoff.expectedHead) {
          return asTextResult({
            ok: false,
            blocker: 'BATTLE_BRIDGE_EXECUTION_HEAD_CHANGED',
            expectedHead: argumentValidation.handoff.expectedHead,
            observedHead: executionHead,
          }, true);
        }
        const queueRecord = approvedQueueRecord(args, timestamp);
        const dispatched = dispatchQueuedCodexJob({
          queueRecord,
          integration: executionIntegration,
          now: timestamp,
          readOnlyPullRequestWorktree: linkedWorktreeReceipt,
        });
        return asTextResult({
          ok: dispatched.finalVerdict === 'CODEX_JOB_DISPATCHED',
          schemaVersion: STEPHANOS_CODEX_DISPATCH_MCP_SCHEMA,
          taskId: dispatched.record?.jobId || queueRecord.jobId,
          dispatcherState: dispatched.dispatcherState,
          decision: dispatched.decision,
          receipt: dispatched.dispatchReceipt || null,
          proofMetadata: dispatched.proofMetadata || null,
          executionProof: {
            mode: executionMode,
            controlHead,
            sourceHead: executionHead,
            repositoryRoot: executionRepositoryRoot,
            sourceMutationAllowed: false,
          },
          nextOperatorAction: 'Use get_codex_task_status until the task reaches DONE, FAILED, or BLOCKED, then call read_codex_task_result.',
        }, dispatched.finalVerdict !== 'CODEX_JOB_DISPATCHED');
      }
      if (name === 'get_codex_task_status') {
        const status = integration.readStatus?.(args.taskId) || readLocalCodexTaskStatus(args.taskId);
        return asTextResult(status ? { ok: true, taskId: args.taskId, status } : { ok: false, taskId: args.taskId, blocker: 'TASK_NOT_FOUND' }, !status);
      }
      if (name === 'read_codex_task_result') {
        const result = integration.readResult?.(args.taskId) || readLocalCodexTaskResult(args.taskId);
        return asTextResult(result ? { ok: true, taskId: args.taskId, result } : { ok: false, taskId: args.taskId, blocker: 'RESULT_NOT_READY' }, !result);
      }
      if (name === 'sync_codex_dispatch_bridge') {
        if (args.preservationProfile && args.preservationApproval !== 'operator-approved') {
          return asTextResult({ ok: false, blocker: 'PRESERVATION_APPROVAL_REQUIRED' }, true);
        }
        if (args.preservationApproval && !args.preservationProfile) {
          return asTextResult({ ok: false, blocker: 'PRESERVATION_PROFILE_REQUIRED' }, true);
        }
        const result = await hostOps.syncCodexDispatchBridge({
          operatorApproval: args.operatorApproval,
          expectedBranch: args.expectedBranch || 'main',
          ...(args.preservationProfile ? {
            preservationProfile: args.preservationProfile,
            preservationApproval: args.preservationApproval,
          } : {}),
        });
        return asTextResult(result, !result.ok);
      }
      if (name === 'update_stephanos_from_chat') {
        const result = await hostOps.updateStephanosFromChat({
          operatorApproval: args.operatorApproval,
          expectedBranch: args.expectedBranch || 'main',
        });
        return asTextResult(result, !result.ok);
      }
      if (name === 'run_battle_bridge_diagnostics') {
        const result = await hostOps.runBattleBridgeDiagnostics();
        return asTextResult(result, !result.ok);
      }
      return asTextResult({ ok: false, blocker: 'UNKNOWN_TOOL', tool: name }, true);
    }
    if (method === 'notifications/initialized') {
      if (!messageIsNotification) throw new Error('MCP_INITIALIZED_NOTIFICATION_REQUIRED');
      if (clientSession?.initializeReceived !== true) throw new Error('MCP_INITIALIZE_REQUIRED');
      if (clientSession.initializedNotificationReceived === true) throw new Error('MCP_SESSION_ALREADY_READY');
      clientSession = {
        ...clientSession,
        initializedNotificationReceived: true,
        readyAt: now(),
      };
      return undefined;
    }
    if (method.startsWith('notifications/')) return undefined;
    throw new Error(`Unsupported MCP method: ${method}`);
  };
}

function jsonRpcError(id, error) {
  return { jsonrpc: '2.0', id, error: { code: -32603, message: error?.message || String(error) } };
}

export async function runStdioMcpServer({ input = process.stdin, output = process.stdout, handler = createCodexDispatchMcpHandler() } = {}) {
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let request;
    try { request = JSON.parse(line); }
    catch {
      output.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`);
      continue;
    }
    const structurallyObject = Boolean(request) && typeof request === 'object' && !Array.isArray(request);
    const hasId = structurallyObject && Object.prototype.hasOwnProperty.call(request, 'id');
    const validRequestId = hasId
      && (typeof request.id === 'string' || Number.isSafeInteger(request.id));
    const isRequest = validRequestId;
    const isNotification = structurallyObject && !hasId;
    if (!structurallyObject
        || request.jsonrpc !== '2.0' || typeof request.method !== 'string'
        || (!isRequest && !isNotification)) {
      if (!isNotification) {
        output.write(`${JSON.stringify({ jsonrpc: '2.0', id: validRequestId ? request.id : null, error: { code: -32600, message: 'Invalid Request' } })}\n`);
      }
      continue;
    }
    try {
      const result = await handler(request.method, request.params || {}, {
        jsonrpc: request.jsonrpc,
        id: request.id,
        isRequest,
        isNotification,
      });
      if (!isNotification && result !== undefined) output.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`);
    } catch (error) {
      if (!isNotification) output.write(`${JSON.stringify(jsonRpcError(request.id, error))}\n`);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runStdioMcpServer();
}
