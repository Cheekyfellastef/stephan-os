#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

import {
  SOVEREIGN_COMMANDER_OPERATION,
  executeSovereignCommanderCommandV1,
} from '../shared/agents/sovereignCommanderV1.mjs';
import {
  STEPHANOS_EXECUTION_SURFACE,
  buildStephanosExecutionCommandEnvelopeV1,
  buildStephanosExecutionSurfaceCatalogV1,
} from '../shared/agents/stephanosExecutionCommandFabricV1.mjs';

export const SOVEREIGN_COMMANDER_MCP_NAME = 'stephanos-sovereign-commander';
export const SOVEREIGN_COMMANDER_MCP_VERSION = '0.1.0';
export const SOVEREIGN_COMMANDER_MCP_PROTOCOL_VERSION = '2025-11-25';
export const SOVEREIGN_COMMANDER_MCP_PROTOCOLS = Object.freeze(new Set([SOVEREIGN_COMMANDER_MCP_PROTOCOL_VERSION, '2025-06-18', '2024-11-05']));

// Transport admission only: each action still executes through the canonical
// fixed registry and returns its existing receipt. Never include repair verbs.
export const SOVEREIGN_COMMANDER_INSPECTION_ACTIONS = Object.freeze([
  'battle-bridge-status', 'battle-bridge-observe', 'visibility-snapshot',
  'cpu-pressure-snapshot', 'controller-lane-status', 'meter-status',
  'status-recovery-mesh', 'status-worker-watchdog', 'status-stephanos-core-daemon',
  'starfield-vr-performance-diagnosis',
]);

const TOOLS = Object.freeze([
  {
    name: 'inspect_battle_bridge',
    title: 'Inspect Battle Bridge without a remote-control meter',
    description: 'Read-only fixed Windows diagnostics: sampled CPU/process attribution, RAM/GPU/VRAM, Stephanos service and daemon health, controller lanes, and VR performance. Returns existing Sovereign receipts; no caller-selected PowerShell or repairs.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['actionId'],
      properties: { actionId: { type: 'string', enum: SOVEREIGN_COMMANDER_INSPECTION_ACTIONS } },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'get_config',
    title: 'Get Sovereign Commander configuration',
    description: 'Return the local sovereign execution posture and authority boundaries.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'read_file',
    title: 'Read file',
    description: 'Read a bounded line range from one absolute file path on the Battle Bridge.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['path'],
      properties: {
        path: { type: 'string', minLength: 1 },
        offset: { type: 'integer', minimum: 0 },
        length: { type: 'integer', minimum: 1, maximum: 1000 },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'read_multiple_files',
    title: 'Read multiple files',
    description: 'Read bounded line ranges from up to eight absolute paths on the private Battle Bridge MCP route.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['paths'],
      properties: {
        paths: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string', minLength: 1 } },
        offset: { type: 'integer', minimum: 0 },
        length: { type: 'integer', minimum: 1, maximum: 200 },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'get_file_info',
    title: 'Get file metadata',
    description: 'Read bounded file type, byte size and modification time without reading its contents.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['path'],
      properties: { path: { type: 'string', minLength: 1 } },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'write_file',
    title: 'Write file',
    description: 'Rewrite or append bounded UTF-8 content to one absolute path. No delete or arbitrary shell is exposed.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['path', 'content'],
      properties: {
        path: { type: 'string', minLength: 1 },
        content: { type: 'string' },
        mode: { type: 'string', enum: ['rewrite', 'append'], default: 'rewrite' },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'edit_file',
    title: 'Edit file',
    description: 'Replace one exact unique string in one absolute file path.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['path', 'oldString', 'newString'],
      properties: {
        path: { type: 'string', minLength: 1 },
        oldString: { type: 'string', minLength: 1 },
        newString: { type: 'string' },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'list_directory',
    title: 'List directory',
    description: 'List a bounded directory tree from one absolute path.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['path'],
      properties: {
        path: { type: 'string', minLength: 1 },
        depth: { type: 'integer', minimum: 1, maximum: 5 },
        maxEntries: { type: 'integer', minimum: 1, maximum: 2000 },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'search_project',
    title: 'Search Stephanos project',
    description: 'Search the canonical Stephanos repository with a bounded literal query. No arbitrary path or shell is accepted.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 200 },
        caseSensitive: { type: 'boolean', default: false },
        maxResults: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'list_processes',
    title: 'List processes',
    description: 'List a bounded snapshot of Battle Bridge processes using the fixed local process probe.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'starfield_vr_telemetry_archive',
    title: 'Read Starfield VR playtest archive',
    description: 'Read a bounded page of historical and current Starfield VR flight-recorder sessions; no raw CSV, host paths or game mutation. Read-only on each call, so newly recorded playtests appear automatically.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        offset: { type: 'integer', minimum: 0, maximum: 1000000, default: 0 },
        limit: { type: 'integer', minimum: 1, maximum: 12, default: 12 },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'maintenance_action',
    title: 'Run fixed Stephanos maintenance action',
    description: 'Run one source-controlled maintenance action from the Sovereign Commander fixed registry.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['actionId'],
      properties: {
        actionId: {
          type: 'string',
          enum: [
            'battle-bridge-status',
            'battle-bridge-observe',
            'meter-status',
            'controller-lane-status',
            'rescue-island-readonly-boundary',
            'visibility-snapshot',
            'cpu-pressure-snapshot',
            'publish-controller-activity',
            'repair-ui-4173',
            'restart-stephanos-runtime',
            'status-recovery-mesh',
            'status-worker-watchdog',
            'status-stephanos-core-daemon',
            'sovereign-windows-reviewer-calibration',
            'qwen35-canary',
            'vr-resource-governor',
            'gaming-resource-status',
            'gaming-resource-prepare',
            'starfield-vr-resource-preflight',
            'gaming-resource-cancel-prepare',
            'gaming-resource-auto',
            'gaming-resource-force-on',
            'gaming-resource-force-off',
            'gaming-resource-acceptance',
            'vr-virtual-airlink-acceptance',
            'starfield-vr-performance-diagnosis',
            'starfield-vr-telemetry-archive',
            'report-starfield-vr-telemetry',
            'starfield-vr-telemetry-refresh',
            'ignite-stephanos',
            'repair-battle-bridge',
            'repair-control-plane',
            'goal-discovery-heartbeat',
            'fleet-goal-supervisor',
            'start-mission-orchestrator-worker',
            'status-mission-orchestrator-worker',
            'start-stephanos-backend',
            'status-stephanos-backend',
            'status-openclaw-whatsapp',
            'repair-openclaw-ignite',
            'repair-openclaw-stack',
            'repair-openclaw-standalone',
            'repair-openclaw-local',
            'repair-goal-builder-flow',
            'repair-stephanos',
            'prove-vr-atlas-runtime',
            'prove-flywheel-runtime',
            'prove-stephanos-ai-commander',
            'reconcile-remote-commander-parity',
            'sync-vr-reference-sources',
            'preservation-converge-pr-branch',
          ],
        },
        targetPrNumber: { type: 'integer', minimum: 1, maximum: 999999999 },
        targetBranch: { type: 'string', minLength: 1, maxLength: 160 },
        targetHead: { type: 'string', pattern: '^[0-9a-fA-F]{40}$' },
        expectedMain: { type: 'string', pattern: '^[0-9a-fA-F]{40}$' },
        controllerActivityPayloadBase64: { type: 'string', minLength: 1, maxLength: 48000, pattern: '^[A-Za-z0-9_-]+$' },
        reviewIdentity: {
          type: 'object', additionalProperties: false,
          required: ['schemaVersion','repository','issueNumber','prNumber','branch',
            'sourceHead','baseSha','implementerProvider','implementerSessionId',
            'reviewerSessionId','implementerPrincipal','reviewerPrincipal'],
          properties: {
            schemaVersion: { const: 'stephanos.sovereign-review-exact-request.v1' },
            repository: { const: 'Cheekyfellastef/stephan-os' },
            issueNumber: { type: 'integer', minimum: 1 },
            prNumber: { type: 'integer', minimum: 1 },
            branch: { type: 'string', minLength: 1, maxLength: 160 },
            sourceHead: { type: 'string', pattern: '^[0-9a-f]{40}$' },
            baseSha: { type: 'string', pattern: '^[0-9a-f]{40}$' },
            implementerProvider: { type: 'string', minLength: 1, maxLength: 80 },
            implementerSessionId: { type: 'string', minLength: 1, maxLength: 80 },
            reviewerSessionId: { type: 'string', minLength: 1, maxLength: 80 },
            implementerPrincipal: { type: 'string', minLength: 1, maxLength: 80 },
            reviewerPrincipal: { type: 'string', minLength: 1, maxLength: 80 },
          },
        },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
]);

function text(value) {
  return String(value ?? '').trim();
}

function asTextResult(value, isError = false) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
    isError,
  };
}

function defaultRepoRoot(env = process.env) {
  const configured = text(env.STEPHANOS_REPO_ROOT || env.STEPHANOS_MISSION_WORKER_REPOSITORY_ROOT);
  if (configured) return resolve(configured);
  return resolve(homedir(), 'Documents', 'GitHub', 'stephan-os');
}

function operationForTool(name) {
  return Object.freeze({
    get_config: SOVEREIGN_COMMANDER_OPERATION.GET_CONFIG,
    read_file: SOVEREIGN_COMMANDER_OPERATION.READ_FILE,
    read_multiple_files: SOVEREIGN_COMMANDER_OPERATION.READ_MULTIPLE_FILES,
    get_file_info: SOVEREIGN_COMMANDER_OPERATION.GET_FILE_INFO,
    write_file: SOVEREIGN_COMMANDER_OPERATION.WRITE_FILE,
    edit_file: SOVEREIGN_COMMANDER_OPERATION.EDIT_FILE,
    list_directory: SOVEREIGN_COMMANDER_OPERATION.LIST_DIRECTORY,
    search_project: SOVEREIGN_COMMANDER_OPERATION.SEARCH_PROJECT,
    list_processes: SOVEREIGN_COMMANDER_OPERATION.LIST_PROCESSES,
    starfield_vr_telemetry_archive: SOVEREIGN_COMMANDER_OPERATION.MAINTENANCE_ACTION,
    maintenance_action: SOVEREIGN_COMMANDER_OPERATION.MAINTENANCE_ACTION,
    inspect_battle_bridge: SOVEREIGN_COMMANDER_OPERATION.MAINTENANCE_ACTION,
  })[name] || '';
}

function targetPathsForTool(name, args = {}) {
  if (name === 'read_multiple_files') return Array.isArray(args.paths) ? args.paths : [];
  if (['read_file', 'get_file_info', 'write_file', 'edit_file', 'list_directory'].includes(name)) return [text(args.path)].filter(Boolean);
  return [];
}

function payloadForTool(name, args = {}) {
  if (name === 'inspect_battle_bridge') return { actionId: args.actionId };
  if (name === 'read_file' || name === 'read_multiple_files') return { offset: args.offset, length: args.length };
  if (name === 'write_file') return { content: args.content, mode: args.mode };
  if (name === 'edit_file') return { oldString: args.oldString, newString: args.newString };
  if (name === 'list_directory') return { depth: args.depth, maxEntries: args.maxEntries };
  if (name === 'search_project') return { query: args.query, caseSensitive: args.caseSensitive, maxResults: args.maxResults };
  if (name === 'starfield_vr_telemetry_archive') {
    return { actionId: 'starfield-vr-telemetry-archive', offset: args.offset, limit: args.limit };
  }
  if (name === 'maintenance_action') {
    if (args.actionId === 'repair-core-publication-directories') {
      if (Object.keys(args).some(key => !['actionId','expectedMain'].includes(key)))
        throw new Error('CORE_DIRECTORY_FIXED_SCOPE_REQUIRED');
      return { actionId: args.actionId, expectedMain: args.expectedMain };
    }
    if (args.actionId === 'sovereign-windows-reviewer-calibration') {
      return { actionId: args.actionId, reviewIdentity: args.reviewIdentity };
    }
    if (args.actionId === 'publish-controller-activity') {
      return {
        actionId: args.actionId,
        controllerActivityPayloadBase64: args.controllerActivityPayloadBase64,
      };
    }
    if (args.actionId === 'preservation-converge-pr-branch') {
      return {
        actionId: args.actionId,
        targetPrNumber: args.targetPrNumber,
        targetBranch: args.targetBranch,
        targetHead: args.targetHead,
        expectedMain: args.expectedMain,
      };
    }
    return { actionId: args.actionId };
  }
  return {};
}

// Admission belongs to the existing server, not to an individual HTTP session.
// Session-local maps below still own cancellation; matching JSON-RPC IDs in a
// different authenticated session cannot cancel or replace the original.
const activeCoreRequests = new Map();

function explicitCoreCustodyReleased(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return false;
  let witnesses = 0;
  for (const container of [result, result.structuredContent]) {
    if (container && Object.hasOwn(container, 'executionCustodyReleased')) {
      if (typeof container !== 'object' || Array.isArray(container)
        || container.executionCustodyReleased !== true) return false;
      witnesses++;
    }
  }
  return witnesses > 0;
}

export function createSovereignCommanderMcpHandler({
  repoRoot = defaultRepoRoot(),
  executor = executeSovereignCommanderCommandV1,
  withMaintenanceOwner,
  now = () => new Date().toISOString(),
} = {}) {
  let session = null;
  let toolsListed = false;
  // Ephemeral cancellation for this session's existing requests; no durable
  // queue, lease, retry or second executor is introduced.
  const coreRequests = new Map();

  return async function handle(method, params = {}, message = {}) {
    const request = message.isRequest === true && message.isNotification !== true;
    const notification = message.isNotification === true && message.isRequest !== true;

    if (method === 'initialize') {
      if (!request) throw new Error('MCP_INITIALIZE_REQUEST_REQUIRED');
      if (session) throw new Error('MCP_SESSION_ALREADY_INITIALIZED');
      const requestedProtocolVersion = text(params.protocolVersion);
      const protocolVersion = SOVEREIGN_COMMANDER_MCP_PROTOCOLS.has(requestedProtocolVersion)
        ? requestedProtocolVersion
        : SOVEREIGN_COMMANDER_MCP_PROTOCOL_VERSION;
      session = {
        sessionId: randomUUID(),
        protocolVersion,
        clientName: text(params.clientInfo?.name).slice(0, 80),
        initializedAt: now(),
        ready: false,
      };
      return {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SOVEREIGN_COMMANDER_MCP_NAME, version: SOVEREIGN_COMMANDER_MCP_VERSION },
        instructions: 'Sovereign local Battle Bridge control. No vendor meter, no arbitrary shell, no merge or PC restart authority.',
      };
    }

    if (method === 'notifications/initialized') {
      if (!notification) throw new Error('MCP_INITIALIZED_NOTIFICATION_REQUIRED');
      if (!session) throw new Error('MCP_INITIALIZE_REQUIRED');
      session = { ...session, ready: true, readyAt: now() };
      return undefined;
    }

    if (method === 'notifications/cancelled') {
      if (notification && session?.ready && message.transportAuthenticated === true)
        coreRequests.get(params.requestId)?.abort();
      return undefined;
    }
    if (method.startsWith('notifications/')) return undefined;
    if (!session?.ready) throw new Error('MCP_SESSION_NOT_READY');

    if (method === 'ping') return {};
    if (method === 'tools/list') {
      toolsListed = true;
      return { tools: TOOLS };
    }

    if (method === 'tools/call') {
      if (!toolsListed) return asTextResult({ ok: false, blocker: 'MCP_TOOLS_LIST_REQUIRED' }, true);
      const name = text(params.name);
      const operation = operationForTool(name);
      if (!operation) return asTextResult({ ok: false, blocker: 'UNKNOWN_TOOL', tool: name }, true);
      let args = params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments)
        ? params.arguments
        : {};
      if (name === 'inspect_battle_bridge') {
        // Capture exactly one data property. Schema hints alone cannot reject
        // extras or prevent inherited/accessor values changing between reads.
        const descriptor = Object.getOwnPropertyDescriptor(args, 'actionId');
        if (Object.getPrototypeOf(args) !== Object.prototype
          || Reflect.ownKeys(args).length !== 1
          || !descriptor || !Object.hasOwn(descriptor, 'value')
          || !SOVEREIGN_COMMANDER_INSPECTION_ACTIONS.includes(descriptor.value)) {
          return asTextResult({ ok: false, blocker: 'SOVEREIGN_INSPECTION_ACTION_INVALID' }, true);
        }
        args = Object.freeze({ actionId: descriptor.value });
      }
      const targetPaths = targetPathsForTool(name, args);
      const catalog = buildStephanosExecutionSurfaceCatalogV1({ repositoryRoot: repoRoot });
      const envelope = buildStephanosExecutionCommandEnvelopeV1({
        catalog,
        surface: STEPHANOS_EXECUTION_SURFACE.SOVEREIGN_COMMANDER,
        actionId: `mcp-${session.sessionId}-${randomUUID()}`,
        missionId: `mcp-session-${session.sessionId}`,
        relatedIssue: '#2519',
        operation,
        targetPaths,
        payload: payloadForTool(name, args),
      });
      const routeProof = Object.freeze({
        commandPathProven: true,
        mcpSessionReady: session?.ready === true,
        transport: text(message.transportKind) || 'mcp-session',
        authenticatedMcp: message.transportAuthenticated === true,
      });
      const isCoreRepair = name === 'maintenance_action' && args.actionId === 'repair-core-publication-directories';
      if (!isCoreRepair) {
        const result = await executor(envelope, { repoRoot, routeProof, withMaintenanceOwner });
        return asTextResult(result, result?.ok !== true);
      }
      if (!request || !(typeof message.id === 'string' || Number.isSafeInteger(message.id))
        || activeCoreRequests.size !== 0)
        return asTextResult({ ok: false, blocker: 'CORE_DIRECTORY_ORIGINAL_REQUEST_REQUIRED_OR_BUSY' }, true);
      const controller = new AbortController();
      const admission = Symbol('original-core-request');
      let retainCustody = true;
      const cancel = () => controller.abort();
      coreRequests.set(message.id, controller);
      activeCoreRequests.set(admission, controller);
      message.signal?.addEventListener('abort', cancel, { once: true });
      if (message.signal?.aborted) cancel();
      try {
        const result = await executor(envelope, { repoRoot, routeProof, withMaintenanceOwner, signal: controller.signal });
        retainCustody = !explicitCoreCustodyReleased(result);
        return asTextResult(result, result?.ok !== true);
      } finally {
        message.signal?.removeEventListener('abort', cancel);
        coreRequests.delete(message.id);
        // A timeout, missing OS witness or thrown executor does not release
        // the server lane. No payload or subsequent session may clear it.
        if (!retainCustody) activeCoreRequests.delete(admission);
      }
    }

    throw new Error(`Unsupported MCP method: ${method}`);
  };
}

function jsonRpcError(id, error) {
  return { jsonrpc: '2.0', id, error: { code: -32603, message: error?.message || String(error) } };
}

export async function runSovereignCommanderStdioMcpServer({
  input = process.stdin,
  output = process.stdout,
  handler = createSovereignCommanderMcpHandler(),
} = {}) {
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let request;
    try { request = JSON.parse(line); }
    catch {
      output.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`);
      continue;
    }

    const object = Boolean(request) && typeof request === 'object' && !Array.isArray(request);
    const hasId = object && Object.prototype.hasOwnProperty.call(request, 'id');
    const validId = hasId && (typeof request.id === 'string' || Number.isSafeInteger(request.id));
    const isRequest = validId;
    const isNotification = object && !hasId;
    if (!object || request.jsonrpc !== '2.0' || typeof request.method !== 'string' || (!isRequest && !isNotification)) {
      if (!isNotification) {
        output.write(`${JSON.stringify({ jsonrpc: '2.0', id: validId ? request.id : null, error: { code: -32600, message: 'Invalid Request' } })}\n`);
      }
      continue;
    }

    try {
      const result = await handler(request.method, request.params || {}, {
        id: request.id,
        isRequest,
        isNotification,
        transportKind: 'local-stdio-mcp',
        transportAuthenticated: false,
      });
      if (!isNotification && result !== undefined) {
        output.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`);
      }
    } catch (error) {
      if (!isNotification) output.write(`${JSON.stringify(jsonRpcError(request.id, error))}\n`);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runSovereignCommanderStdioMcpServer();
}
