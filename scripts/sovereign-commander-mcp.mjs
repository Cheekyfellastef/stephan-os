#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

import {
  SOVEREIGN_COMMANDER_OPERATION,
  captureSovereignPrivateSessionArgumentsV1,
  executeSovereignCommanderCommandV1,
} from '../shared/agents/sovereignCommanderV1.mjs';
import { validateSovereignDirectoryTargetV1 } from '../shared/agents/sovereignDirectoryCreateV1.mjs';
import { createSovereignSearchSessionsV1 } from '../shared/agents/sovereignSearchSessionsV1.mjs';
import { createSovereignMcpSessionHistoryV1 } from '../shared/agents/sovereignMcpSessionHistoryV1.mjs';
import { createSovereignMcpSessionConfigV1 } from '../shared/agents/sovereignMcpSessionConfigV1.mjs';
import { runSovereignFileMoveV1 } from '../shared/agents/sovereignFileMoveV1.mjs';
import { createSovereignProcessSessionsV1 } from '../shared/agents/sovereignProcessSessionsV1.mjs';
import { createSovereignFeedbackIntakeV1, SOVEREIGN_FEEDBACK_OPERATION_IDS_V1 } from '../shared/agents/sovereignFeedbackIntakeV1.mjs';
import { runSovereignPdfWriteV1 } from '../shared/agents/sovereignPdfWriteV1.mjs';
import {
  STEPHANOS_EXECUTION_SURFACE,
  buildStephanosExecutionCommandEnvelopeV1,
  buildStephanosExecutionSurfaceCatalogV1,
} from '../shared/agents/stephanosExecutionCommandFabricV1.mjs';

export const SOVEREIGN_COMMANDER_MCP_NAME = 'stephanos-sovereign-commander';
export const SOVEREIGN_COMMANDER_MCP_VERSION = '0.2.0';
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

const SEARCH_SESSION_TOOLS = Object.freeze(['start_search', 'get_more_search_results', 'stop_search', 'list_searches']);
const HISTORY_TOOLS = Object.freeze(['get_usage_stats', 'get_recent_tool_calls', 'get_tool_result', 'list_remote_tool_calls']);
const PROCESS_SESSION_TOOLS = Object.freeze(['start_process', 'cancel_process_session', 'read_process_output', 'list_sessions']);
const PRIVATE_SESSION_TOOLS = Object.freeze([...SEARCH_SESSION_TOOLS, ...HISTORY_TOOLS, ...PROCESS_SESSION_TOOLS,
  'set_config_value', 'move_file', 'submit_feedback', 'write_pdf']);
const PRIVATE_READ_ANNOTATIONS = Object.freeze({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
const HISTORY_PAGE_SCHEMA = Object.freeze({ type: 'object', additionalProperties: false,
  properties: { offset: { type: 'integer', minimum: 0, maximum: 256, default: 0 },
    limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 } } });

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
    description: 'Return the local sovereign execution posture, authority boundaries and this private session’s effective typed file limits. Session settings are not persistent.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'set_config_value',
    title: 'Set this session’s file limits',
    description: 'Set fileReadLineLimit (1–1000 returned LF/CRLF-delimited lines per file) or fileWriteLineLimit (1–10000 logical lines per submitted write/append/edit replacement, or null to restore the byte-only default). Requires the current revision from get_config. Affects only this private session and never changes filesystem, shell, authentication or execution authority.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['key', 'value', 'expectedRevision'],
      properties: {
        key: { type: 'string', enum: ['fileReadLineLimit', 'fileWriteLineLimit'] },
        value: { type: ['integer', 'null'], minimum: 1, maximum: 10000 },
        expectedRevision: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'submit_feedback',
    title: 'Submit Sovereign Commander feedback',
    description: 'Save bounded problem reports or improvement suggestions in the existing local Sovereign Shared Workspace. Caller text is unverified advisory feedback, never failure evidence, a build request or approval. Credential/path-shaped text is redacted where recognized; do not include secrets. Private local stdio or authenticated HTTP MCP only.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['category', 'operation', 'message'],
      properties: {
        category: { type: 'string', enum: ['problem', 'improvement', 'other'] },
        operation: { type: 'string', enum: SOVEREIGN_FEEDBACK_OPERATION_IDS_V1 },
        message: { type: 'string', minLength: 1, maxLength: 1024, description: 'At most 1024 UTF-8 bytes; no control characters other than LF.' },
      } },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'write_pdf',
    title: 'Create a bounded text PDF',
    description: 'Create one new PDF at an explicit permitted local Windows path. Up to eight US Letter pages, Courier 10 pt, sixty lines per page, eighty printable ASCII characters per line and 16384 total characters. Existing files are refused. No PDF editing, Unicode, images, HTML, fonts, scripts or caller PDF bytes. A failed or interrupted creation may leave a partial new file; never retry an UNKNOWN result automatically. Private local stdio or authenticated HTTP MCP only.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['path', 'pages'],
      properties: {
        path: { type: 'string', minLength: 1, maxLength: 240 },
        pages: { type: 'array', minItems: 1, maxItems: 8,
          items: { type: 'object', additionalProperties: false, required: ['lines'],
            properties: { lines: { type: 'array', maxItems: 60,
              items: { type: 'string', maxLength: 80, pattern: '^[ -~]*$' } } } } },
      } },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
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
    name: 'move_file',
    title: 'Rename one file within its current folder',
    description: 'Rename one regular local NTFS file within the same physical parent without replacing any destination. Requires exact source, destination and expectedSha256. The hash is a bounded pre/post observation, not atomic content CAS; writable-mapping exclusion is unproven. Cross-directory moves are refused. An uncertain result does not authorize a retry.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['source', 'destination', 'expectedSha256'],
      properties: {
        source: { type: 'string', minLength: 1, maxLength: 1024 },
        destination: { type: 'string', minLength: 1, maxLength: 1024 },
        expectedSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
  },
  {
    name: 'create_directory',
    title: 'Create directory',
    description: 'Create one new folder on a fixed local Windows volume at an explicit absolute path. No recursive creation, links, overwrite or shell. Private local stdio or authenticated HTTP MCP.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['path'],
      properties: { path: { type: 'string', minLength: 1, maxLength: 1024 } },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
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
    name: 'start_search',
    title: 'Start scoped private search',
    description: 'Start a bounded literal filename or text search in one explicit local directory. Keeps a private session for paging and cancellation; excludes links and sensitive file forms. Limits or errors remain incomplete, never a full-disk completeness claim.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['path', 'query'],
      properties: { path: { type: 'string', minLength: 1, maxLength: 1024 },
        query: { type: 'string', minLength: 1, maxLength: 200 },
        mode: { type: 'string', enum: ['file', 'content'], default: 'content' },
        caseSensitive: { type: 'boolean', default: false },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 } } },
    annotations: { ...PRIVATE_READ_ANNOTATIONS, idempotentHint: false },
  },
  {
    name: 'get_more_search_results',
    title: 'Read a private search page',
    description: 'Return a bounded page and actual state for a search created in this MCP session. Does not accept a new path or another session’s search.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['searchId'],
      properties: { searchId: { type: 'string', minLength: 1, maxLength: 128 },
        offset: { type: 'integer', minimum: 0, maximum: 1000, default: 0 },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 } } },
    annotations: PRIVATE_READ_ANNOTATIONS,
  },
  {
    name: 'stop_search',
    title: 'Cancel a private search',
    description: 'Cancel only the named search owned by this MCP session. Does not terminate arbitrary processes or alter files.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['searchId'],
      properties: { searchId: { type: 'string', minLength: 1, maxLength: 128 } } },
    annotations: PRIVATE_READ_ANNOTATIONS,
  },
  {
    name: 'list_searches',
    title: 'List this session’s searches',
    description: 'List bounded search metadata belonging only to the current private MCP session.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    annotations: PRIVATE_READ_ANNOTATIONS,
  },
  {
    name: 'get_usage_stats',
    title: 'Get this session’s Sovereign usage',
    description: 'Return bounded, local counters for recorded Commander executions in this MCP session. These are Sovereign counters, not a remote vendor account, billing or machine-wide usage report.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    annotations: PRIVATE_READ_ANNOTATIONS,
  },
  {
    name: 'get_recent_tool_calls',
    title: 'List this session’s recent commands',
    description: 'Return privacy-safe metadata for retained Commander calls in this MCP session. Arguments, paths and file contents are omitted; eviction and pending outcomes are explicit.',
    inputSchema: HISTORY_PAGE_SCHEMA,
    annotations: PRIVATE_READ_ANNOTATIONS,
  },
  {
    name: 'get_tool_result',
    title: 'Retrieve an original private command result',
    description: 'Retrieve an immutable, bounded result retained for an original call in this MCP session. This reads the receipt without replaying the command; unavailable or oversized results stay unavailable.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['callId'],
      properties: { callId: { type: 'string', minLength: 1, maxLength: 160 } } },
    annotations: PRIVATE_READ_ANNOTATIONS,
  },
  {
    name: 'list_remote_tool_calls',
    title: 'List this private HTTP session’s commands',
    description: 'Return metadata for this session’s retained authenticated HTTP Commander calls. Local stdio calls and other sessions are excluded; this is not a vendor-wide account registry.',
    inputSchema: HISTORY_PAGE_SCHEMA,
    annotations: PRIVATE_READ_ANNOTATIONS,
  },
  {
    name: 'start_process',
    title: 'Start a fixed read-only diagnostic session',
    description: 'Start only status-recovery-mesh or status-worker-watchdog as a bounded private process session. Returns observed direct-child launch state; output can be read separately before exit. No commands, arguments, environment, input, arbitrary PIDs or repair actions are accepted. This does not prove descendant or maintenance custody release.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['profile'],
      properties: { profile: { type: 'string', enum: ['status-recovery-mesh', 'status-worker-watchdog'] } } },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: 'read_process_output',
    title: 'Read this session’s diagnostic output',
    description: 'Read bounded, sequenced stdout/stderr chunks from a process session created by this private MCP handler. Offset is a stable chunk sequence; truncation and direct-child lifecycle remain explicit. Reading never repeats the diagnostic.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['sessionId'],
      properties: { sessionId: { type: 'string', minLength: 1, maxLength: 128 },
        offset: { type: 'integer', minimum: 0, maximum: 256, default: 0 },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 } } },
    annotations: PRIVATE_READ_ANNOTATIONS,
  },
  {
    name: 'cancel_process_session',
    title: 'Cancel an owned diagnostic session',
    description: 'Request cancellation of a diagnostic process session created by this private handler. Accepts only its opaque sessionId, never a PID. A recorded request or kill return does not prove process exit. Read the original session to observe root exit and stdio closure; no descendant exclusion or maintenance-custody release is established.',
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['sessionId'],
      properties: { sessionId: { type: 'string', pattern: '^process-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' } },
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'list_sessions',
    title: 'List this handler’s diagnostic sessions',
    description: 'List only process sessions created by this private MCP handler, with observed direct-child state. This is not a host-wide terminal inventory or evidence that native execution custody is released.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    annotations: PRIVATE_READ_ANNOTATIONS,
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
            'diagnose-ignition',
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
            'observe-open-stephanos-tabs',
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
  if (name === 'start_process') return SOVEREIGN_COMMANDER_OPERATION.START_PROCESS_SESSION;
  if (PRIVATE_SESSION_TOOLS.includes(name)) return name.toUpperCase();
  return Object.freeze({
    get_config: SOVEREIGN_COMMANDER_OPERATION.GET_CONFIG,
    read_file: SOVEREIGN_COMMANDER_OPERATION.READ_FILE,
    read_multiple_files: SOVEREIGN_COMMANDER_OPERATION.READ_MULTIPLE_FILES,
    get_file_info: SOVEREIGN_COMMANDER_OPERATION.GET_FILE_INFO,
    write_file: SOVEREIGN_COMMANDER_OPERATION.WRITE_FILE,
    edit_file: SOVEREIGN_COMMANDER_OPERATION.EDIT_FILE,
    list_directory: SOVEREIGN_COMMANDER_OPERATION.LIST_DIRECTORY,
    create_directory: SOVEREIGN_COMMANDER_OPERATION.CREATE_DIRECTORY,
    search_project: SOVEREIGN_COMMANDER_OPERATION.SEARCH_PROJECT,
    list_processes: SOVEREIGN_COMMANDER_OPERATION.LIST_PROCESSES,
    starfield_vr_telemetry_archive: SOVEREIGN_COMMANDER_OPERATION.MAINTENANCE_ACTION,
    maintenance_action: SOVEREIGN_COMMANDER_OPERATION.MAINTENANCE_ACTION,
    inspect_battle_bridge: SOVEREIGN_COMMANDER_OPERATION.MAINTENANCE_ACTION,
  })[name] || '';
}

function targetPathsForTool(name, args = {}) {
  if (name === 'write_pdf') return [args.path];
  if (name === 'move_file') return [args.source, args.destination];
  if (name === 'start_search') return [args.path];
  if (name === 'create_directory') return [args.path];
  if (name === 'read_multiple_files') return Array.isArray(args.paths) ? args.paths : [];
  if (['read_file', 'get_file_info', 'write_file', 'edit_file', 'list_directory', 'create_directory'].includes(name)) return [text(args.path)].filter(Boolean);
  return [];
}

function payloadForTool(name, args = {}) {
  if (PRIVATE_SESSION_TOOLS.includes(name)) return args;
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
  searchSessionsFactory = createSovereignSearchSessionsV1,
  sessionHistoryFactory = createSovereignMcpSessionHistoryV1,
  sessionConfigFactory = createSovereignMcpSessionConfigV1,
  processSessionsFactory = createSovereignProcessSessionsV1,
  feedbackIntakeFactory = createSovereignFeedbackIntakeV1,
  pdfWriteExecutor = runSovereignPdfWriteV1,
  fileMoveExecutor = runSovereignFileMoveV1,
} = {}) {
  let session = null;
  let toolsListed = false;
  let closed = false;
  const searchSessions = searchSessionsFactory();
  const sessionHistory = sessionHistoryFactory();
  const sessionConfig = sessionConfigFactory();
  const processSessions = processSessionsFactory();
  const feedbackIntake = feedbackIntakeFactory({ repoRoot, now });
  const pdfWrites = Object.freeze({ execute: (operation, args) => {
    if (operation !== 'WRITE_PDF') return { ok: false, mutationState: 'NOT_STARTED',
      blocker: 'SOVEREIGN_PDF_OPERATION_INVALID', retryAllowed: false };
    return pdfWriteExecutor(args);
  } });
  // Only this fixed private operation reaches the native adapter. Closing an
  // MCP session does not cancel a possible mutation or release native admission.
  const fileMoves = Object.freeze({ execute: (operation, args) => {
    if (operation !== 'MOVE_FILE') return { ok: false, mutationState: 'NOT_STARTED',
      blocker: 'SOVEREIGN_MOVE_OPERATION_INVALID', retryAllowed: false };
    return fileMoveExecutor(args);
  } });
  // Ephemeral cancellation for this session's existing requests; no durable
  // queue, lease, retry or second executor is introduced.
  const coreRequests = new Map();

  async function invokeExecutor(envelope, options, tool, message) {
    const privateRequest = message.isRequest === true && message.isNotification !== true
      && (message.transportKind === 'local-stdio-mcp'
        || (message.transportKind === 'authenticated-http-jsonrpc' && message.transportAuthenticated === true));
    let recorded = null;
    // Advisory history must never hide the original execution receipt or turn a
    // successful custody release into a failed action because a cache failed.
    try {
      if (privateRequest && !HISTORY_TOOLS.includes(tool)) recorded = sessionHistory.begin({
        callId: envelope.commandId, tool, transportKind: message.transportKind, privateResultAllowed: true });
    } catch {}
    const recordResponse = (value, flags) => {
      try { if (recorded?.recorded) sessionHistory.finish(envelope.commandId, value, flags); } catch {}
    };
    try {
      const result = await executor(envelope, { ...options, searchSessions, sessionHistory, sessionConfig,
        fileMoves, processSessions, feedbackIntake, pdfWrites });
      recordResponse(result);
      return result;
    } catch (error) {
      recordResponse(null, { threw: true });
      throw error;
    }
  }

  async function handle(method, params = {}, message = {}) {
    if (closed) throw new Error('MCP_SESSION_CLOSED');
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
      if (PRIVATE_SESSION_TOOLS.includes(name)) {
        const privateRequest = request && (message.transportKind === 'local-stdio-mcp'
          || (message.transportKind === 'authenticated-http-jsonrpc' && message.transportAuthenticated === true));
        if (!privateRequest) return asTextResult({ ok: false, blocker: 'SOVEREIGN_PRIVATE_SESSION_REQUIRED' }, true);
        const captured = captureSovereignPrivateSessionArgumentsV1(operation,
          params.arguments === undefined ? {} : params.arguments);
        if (!captured) return asTextResult({ ok: false, blocker: 'SOVEREIGN_PRIVATE_SESSION_ARGUMENTS_INVALID' }, true);
        args = captured;
      }
      if (name === 'create_directory') {
        const raw = params.arguments;
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)
          || Object.getPrototypeOf(raw) !== Object.prototype
          || Reflect.ownKeys(raw).length !== 1 || !Object.hasOwn(raw, 'path')
          || !Object.hasOwn(Object.getOwnPropertyDescriptor(raw, 'path'), 'value')
          || typeof raw.path !== 'string') {
          return asTextResult({ ok: false, blocker: 'SOVEREIGN_DIRECTORY_FIXED_SCOPE_REQUIRED' }, true);
        }
        if (!validateSovereignDirectoryTargetV1(raw.path))
          return asTextResult({ ok: false, blocker: 'SOVEREIGN_DIRECTORY_TARGET_INVALID' }, true);
      }
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
        relatedIssue: PRIVATE_SESSION_TOOLS.includes(name) ? '#2573' : '#2519',
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
        const result = await invokeExecutor(envelope, { repoRoot, routeProof, withMaintenanceOwner }, name, message);
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
        const result = await invokeExecutor(envelope, { repoRoot, routeProof, withMaintenanceOwner, signal: controller.signal }, name, message);
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
  }
  // Transport lifecycle only. Closing a session cancels its read-only searches
  // and forgets private history. Process disposal does not invent child exit,
  // release uncertain process admission or canonical maintenance custody.
  handle.close = async () => {
    if (closed) return;
    closed = true;
    try { sessionConfig.dispose(); }
    finally {
      try { await feedbackIntake.dispose(); }
      finally {
        try { sessionHistory.dispose(); }
        finally { try { await searchSessions.dispose(); } finally { await processSessions.dispose(); } }
      }
    }
  };
  return handle;
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
  try { for await (const line of lines) {
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
  } } finally { await handler.close?.(); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await runSovereignCommanderStdioMcpServer();
}
