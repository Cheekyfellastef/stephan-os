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

const TOOLS = Object.freeze([
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
    name: 'list_processes',
    title: 'List processes',
    description: 'List a bounded snapshot of Battle Bridge processes using the fixed local process probe.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
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
            'repair-ui-4173',
            'restart-stephanos-runtime',
            'status-recovery-mesh',
            'status-worker-watchdog',
            'qwen35-canary',
            'vr-resource-governor',
            'gaming-resource-status',
            'gaming-resource-prepare',
            'gaming-resource-auto',
            'gaming-resource-force-on',
            'gaming-resource-force-off',
            'gaming-resource-acceptance',
            'vr-virtual-airlink-acceptance',
            'starfield-vr-performance-diagnosis',
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
            'repair-openclaw-standalone',
            'repair-openclaw-local',
            'repair-goal-builder-flow',
            'reconcile-remote-commander-parity',
          ],
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
    write_file: SOVEREIGN_COMMANDER_OPERATION.WRITE_FILE,
    edit_file: SOVEREIGN_COMMANDER_OPERATION.EDIT_FILE,
    list_directory: SOVEREIGN_COMMANDER_OPERATION.LIST_DIRECTORY,
    list_processes: SOVEREIGN_COMMANDER_OPERATION.LIST_PROCESSES,
    maintenance_action: SOVEREIGN_COMMANDER_OPERATION.MAINTENANCE_ACTION,
  })[name] || '';
}

function targetPathsForTool(name, args = {}) {
  if (['read_file', 'write_file', 'edit_file', 'list_directory'].includes(name)) return [text(args.path)].filter(Boolean);
  return [];
}

function payloadForTool(name, args = {}) {
  if (name === 'read_file') return { offset: args.offset, length: args.length };
  if (name === 'write_file') return { content: args.content, mode: args.mode };
  if (name === 'edit_file') return { oldString: args.oldString, newString: args.newString };
  if (name === 'list_directory') return { depth: args.depth, maxEntries: args.maxEntries };
  if (name === 'maintenance_action') return { actionId: args.actionId };
  return {};
}

export function createSovereignCommanderMcpHandler({
  repoRoot = defaultRepoRoot(),
  executor = executeSovereignCommanderCommandV1,
  now = () => new Date().toISOString(),
} = {}) {
  let session = null;
  let toolsListed = false;

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
      const args = params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments)
        ? params.arguments
        : {};
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
      const result = await executor(envelope, { repoRoot });
      return asTextResult(result, result?.ok !== true);
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
