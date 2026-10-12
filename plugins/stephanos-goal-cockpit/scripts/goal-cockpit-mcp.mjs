#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const GOAL_COCKPIT_MCP_NAME = 'stephanos-goal-cockpit';
export const GOAL_COCKPIT_MCP_VERSION = '0.1.0';
export const GOAL_COCKPIT_RESOURCE_URI = 'ui://stephanos/goal-cockpit-v1.html';
export const GOAL_COCKPIT_MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app';
export const GOAL_COCKPIT_TOOL_NAMES = Object.freeze({
  CURRENT: 'get_goal_cockpit_current',
  DETAIL: 'get_goal_detail',
  RENDER: 'render_goal_cockpit',
});

const READ_ONLY_ANNOTATIONS = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});

const TOOLS = Object.freeze([
  {
    name: GOAL_COCKPIT_TOOL_NAMES.CURRENT,
    title: 'Read current Goal Cockpit',
    description: 'Return the latest verified Stephanos Goal Cockpit snapshot. Read-only: this tool cannot execute commands, dispatch Codex, approve work, merge, or mutate OpenClaw.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        knownSnapshotId: {
          type: 'string',
          minLength: 1,
          maxLength: 80,
          description: 'Optional snapshot ID already displayed by the component.',
        },
      },
    },
    annotations: READ_ONLY_ANNOTATIONS,
    _meta: {
      ui: { visibility: ['model', 'app'] },
      'openai/widgetAccessible': true,
    },
  },
  {
    name: GOAL_COCKPIT_TOOL_NAMES.DETAIL,
    title: 'Read Goal Cockpit detail',
    description: 'Return verified evidence, owner, blocker, and next safe action for one visible cockpit goal. Read-only.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['goalId'],
      properties: {
        goalId: { type: 'string', minLength: 1, maxLength: 160 },
      },
    },
    annotations: READ_ONLY_ANNOTATIONS,
    _meta: {
      ui: { visibility: ['model', 'app'] },
      'openai/widgetAccessible': true,
    },
  },
  {
    name: GOAL_COCKPIT_TOOL_NAMES.RENDER,
    title: 'Open Stephanos Goal Cockpit',
    description: 'Open the read-only Stephanos Goal Cockpit when the user asks to see goals, current status, blockers, owners, proof, or the programme cockpit.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
    },
    annotations: READ_ONLY_ANNOTATIONS,
    _meta: {
      ui: {
        resourceUri: GOAL_COCKPIT_RESOURCE_URI,
        visibility: ['model', 'app'],
      },
      'openai/outputTemplate': GOAL_COCKPIT_RESOURCE_URI,
      'openai/widgetAccessible': true,
      'openai/toolInvocation/invoking': 'Opening the Goal Cockpit…',
      'openai/toolInvocation/invoked': 'Goal Cockpit ready',
    },
  },
]);

const RESOURCE = Object.freeze({
  uri: GOAL_COCKPIT_RESOURCE_URI,
  name: 'Stephanos Goal Cockpit',
  title: 'Stephanos Goal Cockpit',
  description: 'A responsive, read-only cockpit for verified Stephanos goal state.',
  mimeType: GOAL_COCKPIT_MCP_APP_MIME_TYPE,
});

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

function asToolResult(value, isError = false) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
    isError,
  };
}

function safeArgs(params = {}) {
  return params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
}

function validateKnownSnapshotId(value) {
  if (value === undefined) return '';
  const normalized = text(value);
  if (!normalized || normalized.length > 80) throw new Error('knownSnapshotId must be between 1 and 80 characters.');
  return normalized;
}

function validateGoalId(value) {
  const normalized = text(value);
  if (!normalized || normalized.length > 160) throw new Error('goalId must be between 1 and 160 characters.');
  return normalized;
}

async function readComponentHtml() {
  return readFile(new URL('../assets/goal-cockpit.html', import.meta.url), 'utf8');
}

function resourceContents(html) {
  return [{
    uri: GOAL_COCKPIT_RESOURCE_URI,
    mimeType: GOAL_COCKPIT_MCP_APP_MIME_TYPE,
    text: html,
    _meta: {
      ui: {
        prefersBorder: true,
        csp: {
          connectDomains: [],
          resourceDomains: [],
        },
      },
      'openai/widgetDescription': 'Read-only Stephanos goal cockpit showing current, stale, unknown, and conflicting project evidence.',
      'openai/widgetCSP': {
        connect_domains: [],
        resource_domains: [],
      },
    },
  }];
}

function currentResult(snapshot, knownSnapshotId = '', now = () => new Date().toISOString()) {
  const unchanged = Boolean(knownSnapshotId && snapshot?.snapshotId === knownSnapshotId);
  return {
    unchanged,
    snapshotId: text(snapshot?.snapshotId, 'UNKNOWN'),
    serverTime: now(),
    snapshot: unchanged ? null : snapshot,
  };
}

export function createGoalCockpitMcpHandler({
  projectionReader,
  now = () => new Date().toISOString(),
  componentReader = readComponentHtml,
} = {}) {
  if (typeof projectionReader !== 'function') {
    throw new TypeError('createGoalCockpitMcpHandler requires a projectionReader function.');
  }

  return async function handle(method, params = {}) {
    if (method === 'initialize') {
      return {
        protocolVersion: params.protocolVersion || '2025-06-18',
        capabilities: {
          tools: { listChanged: false },
          resources: { subscribe: false, listChanged: false },
        },
        serverInfo: {
          name: GOAL_COCKPIT_MCP_NAME,
          version: GOAL_COCKPIT_MCP_VERSION,
        },
        instructions: 'Use render_goal_cockpit to open the read-only cockpit, get_goal_cockpit_current to refresh verified state, and get_goal_detail for one visible goal. No tool in this server may mutate Stephanos.',
      };
    }
    if (method === 'ping') return {};
    if (method === 'tools/list') return { tools: TOOLS };
    if (method === 'resources/list') return { resources: [RESOURCE] };
    if (method === 'resources/read') {
      if (params.uri !== GOAL_COCKPIT_RESOURCE_URI) {
        throw new Error(`Unknown resource URI: ${text(params.uri, 'missing')}`);
      }
      return { contents: resourceContents(await componentReader()) };
    }
    if (method === 'tools/call') {
      const name = text(params.name);
      const args = safeArgs(params);
      if (name === GOAL_COCKPIT_TOOL_NAMES.CURRENT) {
        const knownSnapshotId = validateKnownSnapshotId(args.knownSnapshotId);
        const snapshot = await projectionReader();
        return asToolResult(currentResult(snapshot, knownSnapshotId, now));
      }
      if (name === GOAL_COCKPIT_TOOL_NAMES.RENDER) {
        const snapshot = await projectionReader();
        return asToolResult(currentResult(snapshot, '', now));
      }
      if (name === GOAL_COCKPIT_TOOL_NAMES.DETAIL) {
        const goalId = validateGoalId(args.goalId);
        const snapshot = await projectionReader();
        const goal = Array.isArray(snapshot?.goals)
          ? snapshot.goals.find((candidate) => candidate.id === goalId)
          : null;
        if (!goal) {
          return asToolResult({
            ok: false,
            blocker: 'GOAL_NOT_FOUND',
            goalId,
            snapshotId: text(snapshot?.snapshotId, 'UNKNOWN'),
          }, true);
        }
        return asToolResult({
          ok: true,
          snapshotId: text(snapshot?.snapshotId, 'UNKNOWN'),
          goal,
          guardrails: snapshot.guardrails,
        });
      }
      return asToolResult({ ok: false, blocker: 'UNKNOWN_TOOL', tool: name }, true);
    }
    if (method.startsWith('notifications/')) return undefined;
    throw new Error(`Unsupported MCP method: ${method}`);
  };
}

function parseCliArgs(argv = process.argv.slice(2)) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--repo-root') parsed.repoRoot = argv[index += 1];
    else if (token === '--workspace-root') parsed.workspaceRoot = argv[index += 1];
  }
  return parsed;
}

function inferredRepositoryRoot() {
  const scriptDirectory = dirname(fileURLToPath(import.meta.url));
  return resolve(scriptDirectory, '..', '..', '..');
}

export function createRepositoryProjectionReader({
  repoRoot = process.env.STEPHANOS_REPO_ROOT || inferredRepositoryRoot(),
  workspaceRoot = process.env.STEPHANOS_SHARED_WORKSPACE || '',
} = {}) {
  const resolvedRepoRoot = resolve(repoRoot);
  const serviceUrl = pathToFileURL(join(
    resolvedRepoRoot,
    'stephanos-server',
    'services',
    'goalCockpitChatService.js',
  )).href;
  let servicePromise;
  return async function readProjection() {
    servicePromise ||= import(serviceUrl);
    const service = await servicePromise;
    return service.readGoalCockpitChatProjection({
      liveGoalReaderOptions: {
        updateStatusOptions: {
          repoRoot: resolvedRepoRoot,
          workspaceRoot,
        },
        buildConciergeGoalOptions: {
          repoRoot: resolvedRepoRoot,
          workspaceRoot,
        },
        goalIngestionOptions: {
          repoRoot: resolvedRepoRoot,
          workspaceRoot,
        },
      },
      sharedWorkspaceReaderOptions: {
        repoRoot: resolvedRepoRoot,
        root: workspaceRoot || undefined,
      },
    });
  };
}

function jsonRpcError(id, error) {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code: -32603,
      message: error?.message || String(error),
    },
  };
}

export async function runStdioMcpServer({
  input = process.stdin,
  output = process.stdout,
  handler,
} = {}) {
  if (typeof handler !== 'function') throw new TypeError('runStdioMcpServer requires a handler.');
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      output.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      })}\n`);
      continue;
    }
    const isNotification = request.id === undefined || request.id === null;
    try {
      const result = await handler(request.method, request.params || {});
      if (!isNotification && result !== undefined) {
        output.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`);
      }
    } catch (error) {
      if (!isNotification) output.write(`${JSON.stringify(jsonRpcError(request.id, error))}\n`);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cli = parseCliArgs();
  const projectionReader = createRepositoryProjectionReader(cli);
  await runStdioMcpServer({
    handler: createGoalCockpitMcpHandler({ projectionReader }),
  });
}
