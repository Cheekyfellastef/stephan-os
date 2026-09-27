import { createHash } from 'node:crypto';
import { access, readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import process from 'node:process';
import {
  STEPHANOS_EXECUTION_COMMAND_FABRIC_SCHEMA,
  STEPHANOS_EXECUTION_SURFACE,
} from './stephanosExecutionCommandFabricV1.mjs';

export const DESKTOP_COMMANDER_MCP_ADAPTER_SCHEMA = 'stephanos.desktop-commander-mcp-adapter.v1';

export const DESKTOP_COMMANDER_OPERATION = Object.freeze({
  GET_CONFIG: 'GET_CONFIG',
  READ_FILE: 'READ_FILE',
  LIST_DIRECTORY: 'LIST_DIRECTORY',
  MAINTENANCE_ACTION: 'MAINTENANCE_ACTION',
});

const DESKTOP_COMMANDER_REQUIRED_VERSION = '0.2.51';
const MAX_RESULT_TEXT = 16 * 1024;

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function frozen(value) {
  return Object.freeze(value);
}

function safeInteger(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
async function candidateFromPackageRoot(packageRoot, source) {
  const indexPath = resolve(packageRoot, 'dist', 'index.js');
  const packagePath = resolve(packageRoot, 'package.json');
  try {
    await access(indexPath);
    const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
    if (pkg?.name !== '@wonderwhy-er/desktop-commander') return null;
    return frozen({
      command: process.execPath,
      args: frozen([indexPath, '--no-onboarding']),
      packageRoot,
      version: text(pkg.version),
      source,
    });
  } catch {
    return null;
  }
}

export async function discoverDesktopCommanderServerV1(options = {}) {
  if (text(options.command)) {
    return frozen({
      command: text(options.command),
      args: frozen(Array.isArray(options.args) ? options.args.map(String) : []),
      packageRoot: '',
      version: text(options.version, 'operator-configured'),
      source: 'explicit',
    });
  }
  const env = options.env || process.env;
  const roots = [];
  if (text(env.APPDATA)) {
    roots.push({
      path: resolve(env.APPDATA, 'npm', 'node_modules', '@wonderwhy-er', 'desktop-commander'),
      source: 'global-npm',
    });
  }
  if (text(env.LOCALAPPDATA)) {
    const npxRoot = resolve(env.LOCALAPPDATA, 'npm-cache', '_npx');
    try {
      const entries = await readdir(npxRoot, { withFileTypes: true });
      const candidates = [];
      for (const entry of entries.filter((item) => item.isDirectory())) {
        const packageRoot = resolve(npxRoot, entry.name, 'node_modules', '@wonderwhy-er', 'desktop-commander');
        try {
          const info = await stat(packageRoot);
          candidates.push({ path: packageRoot, source: 'npx-cache', mtimeMs: info.mtimeMs });
        } catch { /* Not a Desktop Commander cache entry. */ }
      }
      candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
      roots.push(...candidates);
    } catch { /* npx cache is optional. */ }
  }
  for (const root of roots) {
    const candidate = await candidateFromPackageRoot(root.path, root.source);
    if (candidate) return candidate;
  }
  return null;
}
function maintenanceRegistry(repoRoot) {
  const root = resolve(repoRoot);
  const ps = (file) => 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + resolve(root, 'scripts', 'windows', file) + '"';
  const node = (file) => 'node "' + resolve(root, 'scripts', file) + '"';
  return frozen({
    'battle-bridge-status': frozen({
      toolName: 'start_process',
      arguments: frozen({ command: node('battle-bridge-status.mjs'), timeout_ms: 10000 }),
    }),
    'repair-ui-4173': frozen({
      toolName: 'start_process',
      arguments: frozen({ command: node('battle-bridge-ui-4173-repair.mjs'), timeout_ms: 15000 }),
    }),
    'restart-stephanos-runtime': frozen({
      toolName: 'start_process',
      arguments: frozen({ command: ps('restart-approved-stephanos-runtime.ps1'), timeout_ms: 15000 }),
    }),
    'status-recovery-mesh': frozen({
      toolName: 'start_process',
      arguments: frozen({ command: ps('status-battle-bridge-recovery-mesh.ps1'), timeout_ms: 10000 }),
    }),
    'status-worker-watchdog': frozen({
      toolName: 'start_process',
      arguments: frozen({ command: ps('status-battle-bridge-worker-watchdog.ps1'), timeout_ms: 10000 }),
    }),
  });
}

export function buildDesktopCommanderToolCallV1(envelope = {}, options = {}) {
  const blockers = [];
  if (envelope.schemaVersion !== STEPHANOS_EXECUTION_COMMAND_FABRIC_SCHEMA) blockers.push('command-envelope-schema-invalid');
  if (envelope.surface !== STEPHANOS_EXECUTION_SURFACE.DESKTOP_COMMANDER) blockers.push('desktop-commander-surface-not-selected');
  if (envelope.dispatchAllowed !== true) blockers.push('command-envelope-dispatch-not-allowed');
  if (envelope.mergeAuthority !== false || envelope.pcRestartAuthority !== false || envelope.arbitraryUnboundedCommandAllowed !== false) {
    blockers.push('command-envelope-authority-widened');
  }
  const operation = text(envelope.operation).toUpperCase();
  const targetPaths = Array.isArray(envelope.targetPaths) ? envelope.targetPaths.map(text).filter(Boolean) : [];
  const payload = envelope.payload && typeof envelope.payload === 'object' ? envelope.payload : {};
  let call = null;
  if (operation === DESKTOP_COMMANDER_OPERATION.GET_CONFIG) {
    call = { toolName: 'get_config', arguments: {} };
  } else if (operation === DESKTOP_COMMANDER_OPERATION.READ_FILE) {
    if (targetPaths.length !== 1) blockers.push('desktop-commander-read-requires-one-target');
    else call = {
      toolName: 'read_file',
      arguments: {
        path: targetPaths[0],
        offset: safeInteger(payload.offset, 0, 0, 100000000),
        length: safeInteger(payload.length, 200, 1, 1000),
      },
    };
  } else if (operation === DESKTOP_COMMANDER_OPERATION.LIST_DIRECTORY) {
    if (targetPaths.length !== 1) blockers.push('desktop-commander-list-requires-one-target');
    else call = {
      toolName: 'list_directory',
      arguments: {
        path: targetPaths[0],
        depth: safeInteger(payload.depth, 2, 1, 5),
      },
    };
  } else if (operation === DESKTOP_COMMANDER_OPERATION.MAINTENANCE_ACTION) {
    const repoRoot = text(options.repoRoot);
    const actionId = text(payload.actionId).toLowerCase();
    if (!repoRoot) blockers.push('trusted-repository-root-required');
    else {
      const fixed = maintenanceRegistry(repoRoot)[actionId];
      if (!fixed) blockers.push('desktop-commander-maintenance-action-not-registered');
      else call = fixed;
    }
  } else {
    blockers.push('desktop-commander-operation-not-registered');
  }

  return frozen({
    schemaVersion: DESKTOP_COMMANDER_MCP_ADAPTER_SCHEMA,
    commandId: text(envelope.commandId),
    missionId: text(envelope.missionId),
    operation,
    toolName: call?.toolName || '',
    arguments: call ? frozen({ ...call.arguments }) : frozen({}),
    dispatchAllowed: blockers.length === 0,
    blockers: frozen([...new Set(blockers)]),
    receiptRequired: true,
    mergeAuthority: false,
    pcRestartAuthority: false,
    arbitraryUnboundedCommandAllowed: false,
    finalVerdict: blockers.length === 0
      ? 'DESKTOP_COMMANDER_MCP_TOOL_CALL_READY'
      : 'DESKTOP_COMMANDER_MCP_TOOL_CALL_BLOCKED',
  });
}
function toolResultText(result = {}) {
  const values = Array.isArray(result.content)
    ? result.content.filter((item) => item?.type === 'text').map((item) => text(item.text)).filter(Boolean)
    : [];
  return values.join('\n').slice(0, MAX_RESULT_TEXT);
}

export async function executeDesktopCommanderMcpCommandV1(envelope = {}, options = {}) {
  const call = buildDesktopCommanderToolCallV1(envelope, options);
  if (!call.dispatchAllowed) {
    return frozen({
      ok: false,
      schemaVersion: DESKTOP_COMMANDER_MCP_ADAPTER_SCHEMA,
      call,
      blocker: call.blockers[0] || 'desktop-commander-command-blocked',
      finalVerdict: 'DESKTOP_COMMANDER_MCP_EXECUTION_BLOCKED',
    });
  }

  let client = options.client || null;
  let transport = null;
  let discovered = null;
  try {
    if (!client) {
      discovered = await discoverDesktopCommanderServerV1(options);
      if (!discovered) {
        return frozen({
          ok: false,
          schemaVersion: DESKTOP_COMMANDER_MCP_ADAPTER_SCHEMA,
          call,
          blocker: 'desktop-commander-server-not-discovered',
          finalVerdict: 'DESKTOP_COMMANDER_MCP_EXECUTION_BLOCKED',
        });
      }
      if (discovered.version !== DESKTOP_COMMANDER_REQUIRED_VERSION && options.allowVersionDrift !== true) {
        return frozen({
          ok: false,
          schemaVersion: DESKTOP_COMMANDER_MCP_ADAPTER_SCHEMA,
          call,
          blocker: 'desktop-commander-version-not-qualified',
          observedVersion: discovered.version,
          expectedVersion: DESKTOP_COMMANDER_REQUIRED_VERSION,
          finalVerdict: 'DESKTOP_COMMANDER_MCP_EXECUTION_BLOCKED',
        });
      }
      const [{ Client }, { StdioClientTransport }] = await Promise.all([
        import('@modelcontextprotocol/sdk/client'),
        import('@modelcontextprotocol/sdk/client/stdio.js'),
      ]);
      transport = new StdioClientTransport({
        command: discovered.command,
        args: [...discovered.args],
        stderr: 'pipe',
      });
      client = new Client(
        { name: 'stephanos-execution-command-fabric', version: '1.0.0' },
        { capabilities: {} },
      );
      await client.connect(transport);
    }

    const listed = await client.listTools();
    const available = new Set((listed.tools || []).map((tool) => text(tool.name)));
    if (!available.has(call.toolName)) {
      return frozen({
        ok: false,
        schemaVersion: DESKTOP_COMMANDER_MCP_ADAPTER_SCHEMA,
        call,
        blocker: 'desktop-commander-required-tool-missing',
        finalVerdict: 'DESKTOP_COMMANDER_MCP_EXECUTION_BLOCKED',
      });
    }
    const result = await client.callTool({ name: call.toolName, arguments: call.arguments });
    const contentText = toolResultText(result);
    const proofHash = hash({
      commandId: call.commandId,
      operation: call.operation,
      toolName: call.toolName,
      arguments: call.arguments,
      isError: result?.isError === true,
      contentText,
      structuredContent: result?.structuredContent || null,
    });
    return frozen({
      ok: result?.isError !== true,
      schemaVersion: DESKTOP_COMMANDER_MCP_ADAPTER_SCHEMA,
      call,
      server: discovered ? frozen({ version: discovered.version, source: discovered.source }) : frozen({ version: 'injected', source: 'test' }),
      contentText,
      structuredContent: result?.structuredContent || null,
      proofHash,
      receiptRequired: true,
      finalVerdict: result?.isError === true
        ? 'DESKTOP_COMMANDER_MCP_TOOL_FAILED'
        : 'DESKTOP_COMMANDER_MCP_TOOL_COMPLETED',
    });
  } catch (error) {
    return frozen({
      ok: false,
      schemaVersion: DESKTOP_COMMANDER_MCP_ADAPTER_SCHEMA,
      call,
      blocker: text(error?.message, 'desktop-commander-mcp-execution-error'),
      finalVerdict: 'DESKTOP_COMMANDER_MCP_EXECUTION_FAILED',
    });
  } finally {
    if (!options.client && client) await client.close().catch(() => {});
  }
}
