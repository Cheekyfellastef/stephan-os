#!/usr/bin/env node
import readline from 'node:readline';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
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

export const STEPHANOS_CODEX_DISPATCH_MCP_SCHEMA = 'stephanos.codex-dispatch-mcp.v1';
export const STEPHANOS_CODEX_DISPATCH_MCP_NAME = 'stephanos-codex-dispatch';

const TOOLS = Object.freeze([
  {
    name: 'dispatch_codex_task',
    title: 'Dispatch guarded Battle Bridge Codex task',
    description: 'Dispatch one operator-approved proof or diagnostics task to the local Battle Bridge Codex worker. This tool cannot merge, push, reset branches, delete branches, or authorize source changes.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['issueNumber', 'task', 'operatorApproval'],
      properties: {
        issueNumber: { type: 'integer', minimum: 1, description: 'Owning GitHub issue or goal number.' },
        task: { type: 'string', minLength: 20, maxLength: 4000, description: 'Exact bounded Battle Bridge proof or diagnostics task.' },
        operatorApproval: { type: 'string', enum: ['operator-approved'], description: 'Must only be supplied after the user explicitly requests dispatch.' },
        branch: { type: 'string', default: 'main', maxLength: 160 },
        requestedProofCommands: {
          type: 'array',
          maxItems: 20,
          items: { type: 'string', maxLength: 300 },
        },
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
]);

function asTextResult(value, isError = false) {
  const text = JSON.stringify(value, null, 2);
  return { content: [{ type: 'text', text }], structuredContent: value, isError };
}

function approvedQueueRecord(args, now) {
  const created = createCodexQueueRecord({
    issueNumber: args.issueNumber,
    branch: args.branch || 'main',
    prompt: args.task,
    requestedProofCommands: args.requestedProofCommands || [],
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
    approvalReceipt: `chatgpt-mcp-${randomUUID()}`,
  });
  if (!ready.valid) throw new Error(`Unable to record operator approval: ${ready.error || ready.errors?.join(', ')}`);
  return ready.record;
}

export function createCodexDispatchMcpHandler({
  integration = createLocalCodexExecIntegration(),
  now = () => new Date().toISOString(),
} = {}) {
  return async function handle(method, params = {}) {
    if (method === 'initialize') {
      return {
        protocolVersion: params.protocolVersion || '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: STEPHANOS_CODEX_DISPATCH_MCP_NAME, version: '1.0.0' },
        instructions: 'Use dispatch_codex_task only after explicit operator approval and only for live Battle Bridge proof/diagnostics that genuinely require Codex. Prefer ChatGPT plus GitHub for source work.',
      };
    }
    if (method === 'ping') return {};
    if (method === 'tools/list') return { tools: TOOLS };
    if (method === 'tools/call') {
      const name = String(params.name || '');
      const args = params.arguments || {};
      if (name === 'dispatch_codex_task') {
        if (args.operatorApproval !== 'operator-approved') {
          return asTextResult({ ok: false, blocker: 'OPERATOR_APPROVAL_REQUIRED', nextOperatorAction: 'Ask the operator to explicitly approve this exact dispatch.' }, true);
        }
        const timestamp = now();
        const queueRecord = approvedQueueRecord(args, timestamp);
        const dispatched = dispatchQueuedCodexJob({ queueRecord, integration, now: timestamp });
        return asTextResult({
          ok: dispatched.finalVerdict === 'CODEX_JOB_DISPATCHED',
          schemaVersion: STEPHANOS_CODEX_DISPATCH_MCP_SCHEMA,
          taskId: dispatched.record?.jobId || queueRecord.jobId,
          dispatcherState: dispatched.dispatcherState,
          decision: dispatched.decision,
          receipt: dispatched.dispatchReceipt || null,
          proofMetadata: dispatched.proofMetadata || null,
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
      return asTextResult({ ok: false, blocker: 'UNKNOWN_TOOL', tool: name }, true);
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
    const isNotification = request.id === undefined || request.id === null;
    try {
      const result = await handler(request.method, request.params || {});
      if (!isNotification && result !== undefined) output.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`);
    } catch (error) {
      if (!isNotification) output.write(`${JSON.stringify(jsonRpcError(request.id, error))}\n`);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runStdioMcpServer();
}
