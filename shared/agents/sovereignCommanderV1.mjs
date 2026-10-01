import { createHash } from 'node:crypto';
import { appendFile, readFile, readdir, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, win32 } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import {
  STEPHANOS_EXECUTION_COMMAND_FABRIC_SCHEMA,
  STEPHANOS_EXECUTION_SURFACE,
} from './stephanosExecutionCommandFabricV1.mjs';

export const SOVEREIGN_COMMANDER_SCHEMA = 'stephanos.sovereign-commander.v1';

export const SOVEREIGN_COMMANDER_OPERATION = Object.freeze({
  GET_CONFIG: 'GET_CONFIG',
  READ_FILE: 'READ_FILE',
  WRITE_FILE: 'WRITE_FILE',
  EDIT_FILE: 'EDIT_FILE',
  LIST_DIRECTORY: 'LIST_DIRECTORY',
  LIST_PROCESSES: 'LIST_PROCESSES',
  RUN_NODE_TEST: 'RUN_NODE_TEST',
  START_PROCESS: 'START_PROCESS',
  MAINTENANCE_ACTION: 'MAINTENANCE_ACTION',
});

const MAX_RESULT_TEXT = 16 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_FIXED_PROCESS_TIMEOUT_MS = 180_000;

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

function isWindowsAbsolutePath(value) {
  return /^[a-z]:[\\/]/i.test(text(value)) || /^\\\\/.test(text(value));
}

function normalizedAbsolutePath(value) {
  const candidate = text(value);
  if (!candidate) return '';
  try {
    if (isWindowsAbsolutePath(candidate)) return win32.resolve(candidate);
    if (!isAbsolute(candidate)) return '';
    return resolve(candidate);
  } catch {
    return '';
  }
}

function pathWithin(root, candidate) {
  const normalizedRoot = normalizedAbsolutePath(root);
  const normalizedCandidate = normalizedAbsolutePath(candidate);
  if (!normalizedRoot || !normalizedCandidate) return false;
  const windows = isWindowsAbsolutePath(normalizedRoot);
  if (windows !== isWindowsAbsolutePath(normalizedCandidate)) return false;
  const relativePath = windows
    ? win32.relative(normalizedRoot, normalizedCandidate)
    : relative(normalizedRoot, normalizedCandidate);
  const relativeIsAbsolute = windows ? win32.isAbsolute(relativePath) : isAbsolute(relativePath);
  return relativePath === '' || (!!relativePath && !relativePath.startsWith('..') && !relativeIsAbsolute);
}

function fixedRegistry(repoRoot) {
  const root = normalizedAbsolutePath(repoRoot);
  if (!root) return frozen({});
  const powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
  const node = process.execPath;
  const psFile = (name) => resolve(root, 'scripts', 'windows', name);
  const nodeFile = (name) => resolve(root, 'scripts', name);
  return frozen({
    'battle-bridge-status': frozen({
      executable: node,
      args: frozen([nodeFile('battle-bridge-status.mjs')]),
      timeoutMs: 10_000,
    }),
    'repair-ui-4173': frozen({
      executable: node,
      args: frozen([nodeFile('battle-bridge-ui-4173-repair.mjs')]),
      timeoutMs: 15_000,
    }),
    'restart-stephanos-runtime': frozen({
      executable: powershell,
      args: frozen(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile('restart-approved-stephanos-runtime.ps1')]),
      timeoutMs: 20_000,
    }),
    'status-recovery-mesh': frozen({
      executable: powershell,
      args: frozen(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile('status-battle-bridge-recovery-mesh.ps1')]),
      timeoutMs: 10_000,
    }),
    'status-worker-watchdog': frozen({
      executable: powershell,
      args: frozen(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile('status-battle-bridge-worker-watchdog.ps1')]),
      timeoutMs: 10_000,
    }),
    'qwen35-canary': frozen({
      executable: node,
      args: frozen([nodeFile('qwen35-canary.mjs')]),
      timeoutMs: 180_000,
    }),
    'vr-resource-governor': frozen({
      executable: powershell,
      args: frozen(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile('run-vr-resource-governor.ps1'), '-Action', 'Reconcile']),
      // Large resident Ollama models can take longer than 15s to relinquish RAM/VRAM.
      timeoutMs: 60_000,
    }),
    'gaming-resource-status': frozen({
      executable: powershell,
      args: frozen(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile('run-vr-resource-governor.ps1'), '-Action', 'Status']),
      timeoutMs: 15_000,
    }),
    'gaming-resource-prepare': frozen({
      executable: powershell,
      args: frozen(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile('run-vr-resource-governor.ps1'), '-Action', 'PrepareGaming']),
      timeoutMs: 60_000,
    }),
    'gaming-resource-auto': frozen({
      executable: powershell,
      args: frozen(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile('run-vr-resource-governor.ps1'), '-Action', 'SetAuto']),
      timeoutMs: 60_000,
    }),
    'gaming-resource-force-on': frozen({
      executable: powershell,
      args: frozen(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile('run-vr-resource-governor.ps1'), '-Action', 'ForceOn']),
      timeoutMs: 60_000,
    }),
    'gaming-resource-force-off': frozen({
      executable: powershell,
      args: frozen(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile('run-vr-resource-governor.ps1'), '-Action', 'ForceOff']),
      timeoutMs: 20_000,
    }),
    'gaming-resource-acceptance': frozen({
      executable: powershell,
      args: frozen(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile('run-gaming-resource-acceptance.ps1')]),
      timeoutMs: 120_000,
    }),
    'vr-virtual-airlink-acceptance': frozen({
      executable: powershell,
      args: frozen(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile('run-vr-virtual-airlink-acceptance.ps1')]),
      timeoutMs: 45_000,
    }),
    'ignite-stephanos': frozen({
      executable: node,
      args: frozen([nodeFile('run-battle-bridge-ignition.mjs')]),
      timeoutMs: 180_000,
    }),
    'repair-battle-bridge': frozen({
      executable: node,
      args: frozen([nodeFile('battle-bridge-repair.mjs')]),
      timeoutMs: 120_000,
    }),
    'repair-control-plane': frozen({
      executable: node,
      args: frozen([nodeFile('sovereign-commander-control-plane-repair.mjs')]),
      timeoutMs: 180_000,
    }),
    'goal-discovery-heartbeat': frozen({
      executable: node,
      args: frozen([nodeFile('battle-bridge-goal-discovery-heartbeat.mjs')]),
      timeoutMs: 60_000,
    }),
    'fleet-goal-supervisor': frozen({
      executable: node,
      args: frozen([nodeFile('sovereign-commander-fleet-goal-supervisor.mjs')]),
      timeoutMs: 60_000,
    }),
    'start-mission-orchestrator-worker': frozen({
      executable: powershell,
      args: frozen(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile('start-mission-orchestrator-worker-task.ps1')]),
      timeoutMs: 30_000,
    }),
    'status-mission-orchestrator-worker': frozen({
      executable: powershell,
      args: frozen(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile('status-mission-orchestrator-worker-autostart.ps1')]),
      timeoutMs: 10_000,
    }),
    'start-stephanos-backend': frozen({
      executable: powershell,
      args: frozen(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile('start-stephanos-backend.ps1')]),
      timeoutMs: 180_000,
    }),
    'status-stephanos-backend': frozen({
      executable: powershell,
      args: frozen(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile('status-stephanos-backend-autostart.ps1')]),
      timeoutMs: 60_000,
    }),
    'status-openclaw-whatsapp': frozen({
      executable: powershell,
      args: frozen(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile('status-openclaw-stephanos-whatsapp-command.ps1')]),
      timeoutMs: 30_000,
    }),
    'repair-openclaw-ignite': frozen({
      executable: powershell,
      args: frozen(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile('repair-openclaw-stephanos-ignite-command.ps1'), '-Relink']),
      timeoutMs: 60_000,
    }),
    'repair-openclaw-standalone': frozen({
      executable: powershell,
      args: frozen(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile('repair-openclaw-agent.ps1'), '-Target', 'Standalone']),
      timeoutMs: 180_000,
    }),
    'repair-openclaw-local': frozen({
      executable: powershell,
      args: frozen(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile('repair-openclaw-agent.ps1'), '-Target', 'Local']),
      timeoutMs: 180_000,
    }),
    'repair-goal-builder-flow': frozen({
      executable: node,
      args: frozen([nodeFile('sovereign-commander-goal-builder-repair.mjs')]),
      timeoutMs: 180_000,
    }),
  });
}

function validateEnvelope(envelope = {}) {
  const blockers = [];
  if (envelope.schemaVersion !== STEPHANOS_EXECUTION_COMMAND_FABRIC_SCHEMA) blockers.push('command-envelope-schema-invalid');
  if (envelope.surface !== STEPHANOS_EXECUTION_SURFACE.SOVEREIGN_COMMANDER) blockers.push('sovereign-commander-surface-not-selected');
  if (envelope.dispatchAllowed !== true) blockers.push('command-envelope-dispatch-not-allowed');
  if (envelope.mergeAuthority !== false
    || envelope.leaseSeizureAllowed !== false
    || envelope.pcRestartAuthority !== false
    || envelope.arbitraryUnboundedCommandAllowed !== false) {
    blockers.push('command-envelope-authority-widened');
  }
  return blockers;
}

export function buildSovereignCommanderCommandV1(envelope = {}, options = {}) {
  const blockers = validateEnvelope(envelope);
  const operation = text(envelope.operation).toUpperCase();
  const targetPaths = Array.isArray(envelope.targetPaths) ? envelope.targetPaths.map(text).filter(Boolean) : [];
  const payload = envelope.payload && typeof envelope.payload === 'object' ? envelope.payload : {};
  const registry = fixedRegistry(options.repoRoot);
  let plan = null;

  if (operation === SOVEREIGN_COMMANDER_OPERATION.GET_CONFIG) {
    plan = frozen({ kind: 'config' });
  } else if (operation === SOVEREIGN_COMMANDER_OPERATION.READ_FILE) {
    const path = targetPaths.length === 1 ? normalizedAbsolutePath(targetPaths[0]) : '';
    if (!path) blockers.push('sovereign-commander-read-requires-one-absolute-target');
    else plan = frozen({
      kind: 'read-file',
      path,
      offset: safeInteger(payload.offset, 0, 0, 100_000_000),
      length: safeInteger(payload.length, 200, 1, 1000),
    });
  } else if (operation === SOVEREIGN_COMMANDER_OPERATION.WRITE_FILE) {
    const path = targetPaths.length === 1 ? normalizedAbsolutePath(targetPaths[0]) : '';
    const content = typeof payload.content === 'string' ? payload.content : null;
    const mode = text(payload.mode, 'rewrite').toLowerCase();
    if (!path) blockers.push('sovereign-commander-write-requires-one-absolute-target');
    if (content === null || Buffer.byteLength(content, 'utf8') > 1024 * 1024) blockers.push('sovereign-commander-write-content-invalid');
    if (!['rewrite', 'append'].includes(mode)) blockers.push('sovereign-commander-write-mode-invalid');
    if (path && content !== null && ['rewrite', 'append'].includes(mode)) plan = frozen({
      kind: 'write-file',
      path,
      content,
      mode,
    });
  } else if (operation === SOVEREIGN_COMMANDER_OPERATION.EDIT_FILE) {
    const path = targetPaths.length === 1 ? normalizedAbsolutePath(targetPaths[0]) : '';
    const oldString = typeof payload.oldString === 'string' ? payload.oldString : null;
    const newString = typeof payload.newString === 'string' ? payload.newString : null;
    if (!path) blockers.push('sovereign-commander-edit-requires-one-absolute-target');
    if (!oldString || newString === null || Buffer.byteLength(newString, 'utf8') > 1024 * 1024) blockers.push('sovereign-commander-edit-payload-invalid');
    if (path && oldString && newString !== null) plan = frozen({
      kind: 'edit-file',
      path,
      oldString,
      newString,
    });
  } else if (operation === SOVEREIGN_COMMANDER_OPERATION.RUN_NODE_TEST) {
    blockers.push('sovereign-commander-node-test-disabled-use-source-controlled-maintenance-action');
  } else if (operation === SOVEREIGN_COMMANDER_OPERATION.LIST_DIRECTORY) {
    const path = targetPaths.length === 1 ? normalizedAbsolutePath(targetPaths[0]) : '';
    if (!path) blockers.push('sovereign-commander-list-requires-one-absolute-target');
    else plan = frozen({
      kind: 'list-directory',
      path,
      depth: safeInteger(payload.depth, 2, 1, 5),
      maxEntries: safeInteger(payload.maxEntries, 500, 1, 2000),
    });
  } else if (operation === SOVEREIGN_COMMANDER_OPERATION.LIST_PROCESSES) {
    plan = frozen({ kind: 'list-processes' });
  } else if (operation === SOVEREIGN_COMMANDER_OPERATION.START_PROCESS
    || operation === SOVEREIGN_COMMANDER_OPERATION.MAINTENANCE_ACTION) {
    const processId = text(payload.processId || payload.actionId).toLowerCase();
    const fixed = registry[processId];
    if (!text(options.repoRoot)) blockers.push('trusted-repository-root-required');
    if (!fixed) blockers.push('sovereign-commander-process-not-registered');
    else plan = frozen({ kind: 'fixed-process', processId, ...fixed });
  } else {
    blockers.push('sovereign-commander-operation-not-registered');
  }

  return frozen({
    schemaVersion: SOVEREIGN_COMMANDER_SCHEMA,
    commandId: text(envelope.commandId),
    missionId: text(envelope.missionId),
    operation,
    plan,
    dispatchAllowed: blockers.length === 0,
    blockers: frozen([...new Set(blockers)]),
    receiptRequired: true,
    mergeAuthority: false,
    leaseSeizureAllowed: false,
    pcRestartAuthority: false,
    arbitraryUnboundedCommandAllowed: false,
    vendorMeterRequired: false,
    externalSaasRelayRequired: false,
    finalVerdict: blockers.length === 0
      ? 'SOVEREIGN_COMMANDER_COMMAND_READY'
      : 'SOVEREIGN_COMMANDER_COMMAND_BLOCKED',
  });
}

async function listDirectoryTree(root, depth, maxEntries) {
  const results = [];
  async function walk(current, remaining) {
    if (results.length >= maxEntries) return;
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (results.length >= maxEntries) break;
      const absolute = resolve(current, entry.name);
      results.push({
        path: absolute,
        type: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other',
      });
      if (entry.isDirectory() && remaining > 1) await walk(absolute, remaining - 1);
    }
  }
  await walk(root, depth);
  return results;
}

function runFixedProcess(plan, options = {}) {
  const runner = options.spawnSyncFn || spawnSync;
  const result = runner(plan.executable, [...plan.args], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: Math.min(safeInteger(plan.timeoutMs, DEFAULT_TIMEOUT_MS, 1000, MAX_FIXED_PROCESS_TIMEOUT_MS), MAX_FIXED_PROCESS_TIMEOUT_MS),
    maxBuffer: MAX_RESULT_TEXT * 4,
  });
  const stdout = String(result?.stdout || '').slice(0, MAX_RESULT_TEXT);
  const stderr = String(result?.stderr || '').slice(0, MAX_RESULT_TEXT);
  return frozen({
    ok: !result?.error && Number(result?.status) === 0,
    status: Number.isInteger(result?.status) ? result.status : null,
    signal: text(result?.signal),
    stdout,
    stderr,
    errorCode: text(result?.error?.code || result?.error?.message).slice(0, 160),
  });
}

function listProcesses(options = {}) {
  if (typeof options.listProcessesFn === 'function') return options.listProcessesFn();
  if (process.platform !== 'win32' && options.allowNonWindowsForTest !== true) {
    return frozen({ ok: false, status: null, stdout: '', stderr: 'WINDOWS_REQUIRED', errorCode: 'WINDOWS_REQUIRED' });
  }
  const runner = options.spawnSyncFn || spawnSync;
  const powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
  const script = [
    "$ErrorActionPreference='Stop'",
    'Get-Process | Sort-Object ProcessName,Id | Select-Object -First 500 Id,ProcessName,CPU,WorkingSet64 | ConvertTo-Json -Compress',
  ].join('; ');
  const result = runner(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 10_000,
    maxBuffer: MAX_RESULT_TEXT * 4,
  });
  return frozen({
    ok: !result?.error && Number(result?.status) === 0,
    status: Number.isInteger(result?.status) ? result.status : null,
    stdout: String(result?.stdout || '').slice(0, MAX_RESULT_TEXT),
    stderr: String(result?.stderr || '').slice(0, MAX_RESULT_TEXT),
    errorCode: text(result?.error?.code || result?.error?.message).slice(0, 160),
  });
}

export async function executeSovereignCommanderCommandV1(envelope = {}, options = {}) {
  const command = buildSovereignCommanderCommandV1(envelope, options);
  if (!command.dispatchAllowed) {
    return frozen({
      ok: false,
      schemaVersion: SOVEREIGN_COMMANDER_SCHEMA,
      command,
      blocker: command.blockers[0] || 'sovereign-commander-command-blocked',
      finalVerdict: 'SOVEREIGN_COMMANDER_EXECUTION_BLOCKED',
    });
  }

  try {
    let contentText = '';
    let structuredContent = null;

    if (command.plan.kind === 'config') {
      structuredContent = frozen({
        schemaVersion: SOVEREIGN_COMMANDER_SCHEMA,
        implementation: 'stephanos-local-node',
        wholePcCapable: true,
        canEditFiles: true,
        canRunFocusedNodeTests: false,
        sourceControlledMaintenanceOnly: true,
        vendorMeterRequired: false,
        externalSaasRelayRequired: false,
        arbitraryUnboundedCommandAllowed: false,
        mergeAuthority: false,
        pcRestartAuthority: false,
      });
      contentText = JSON.stringify(structuredContent);
    } else if (command.plan.kind === 'read-file') {
      const raw = await readFile(command.plan.path, 'utf8');
      const lines = raw.split(/\r?\n/);
      const selected = lines.slice(command.plan.offset, command.plan.offset + command.plan.length);
      contentText = selected.join('\n').slice(0, MAX_RESULT_TEXT);
      structuredContent = frozen({
        path: command.plan.path,
        offset: command.plan.offset,
        length: selected.length,
        totalLines: lines.length,
      });
    } else if (command.plan.kind === 'write-file') {
      if (command.plan.mode === 'append') await appendFile(command.plan.path, command.plan.content, 'utf8');
      else await writeFile(command.plan.path, command.plan.content, 'utf8');
      structuredContent = frozen({
        path: command.plan.path,
        bytesWritten: Buffer.byteLength(command.plan.content, 'utf8'),
        mode: command.plan.mode,
      });
      contentText = JSON.stringify(structuredContent);
    } else if (command.plan.kind === 'edit-file') {
      const raw = await readFile(command.plan.path, 'utf8');
      const first = raw.indexOf(command.plan.oldString);
      const second = first < 0 ? -1 : raw.indexOf(command.plan.oldString, first + command.plan.oldString.length);
      if (first < 0 || second >= 0) {
        return frozen({
          ok: false,
          schemaVersion: SOVEREIGN_COMMANDER_SCHEMA,
          command,
          blocker: first < 0 ? 'sovereign-commander-edit-old-string-not-found' : 'sovereign-commander-edit-old-string-not-unique',
          finalVerdict: 'SOVEREIGN_COMMANDER_EXECUTION_BLOCKED',
        });
      }
      const updated = raw.slice(0, first) + command.plan.newString + raw.slice(first + command.plan.oldString.length);
      await writeFile(command.plan.path, updated, 'utf8');
      structuredContent = frozen({
        path: command.plan.path,
        replacements: 1,
        bytesWritten: Buffer.byteLength(updated, 'utf8'),
      });
      contentText = JSON.stringify(structuredContent);
    } else if (command.plan.kind === 'node-test') {
      const result = runFixedProcess(command.plan, options);
      contentText = [result.stdout, result.stderr].filter(Boolean).join('\n').slice(0, MAX_RESULT_TEXT);
      structuredContent = result;
      if (!result.ok) {
        return frozen({
          ok: false,
          schemaVersion: SOVEREIGN_COMMANDER_SCHEMA,
          command,
          contentText,
          structuredContent,
          blocker: result.errorCode || `focused-node-test-exit-${String(result.status)}`,
          finalVerdict: 'SOVEREIGN_COMMANDER_EXECUTION_FAILED',
        });
      }
    } else if (command.plan.kind === 'list-directory') {
      const entries = await listDirectoryTree(command.plan.path, command.plan.depth, command.plan.maxEntries);
      structuredContent = frozen({
        path: command.plan.path,
        depth: command.plan.depth,
        entries: frozen(entries),
        truncated: entries.length >= command.plan.maxEntries,
      });
      contentText = entries.map((entry) => `${entry.type}\t${entry.path}`).join('\n').slice(0, MAX_RESULT_TEXT);
    } else if (command.plan.kind === 'list-processes') {
      const result = await listProcesses(options);
      contentText = [result.stdout, result.stderr].filter(Boolean).join('\n').slice(0, MAX_RESULT_TEXT);
      structuredContent = result;
      if (!result.ok) {
        return frozen({
          ok: false,
          schemaVersion: SOVEREIGN_COMMANDER_SCHEMA,
          command,
          contentText,
          structuredContent,
          blocker: result.errorCode || 'sovereign-commander-process-list-failed',
          finalVerdict: 'SOVEREIGN_COMMANDER_EXECUTION_FAILED',
        });
      }
    } else if (command.plan.kind === 'fixed-process') {
      const result = runFixedProcess(command.plan, options);
      contentText = [result.stdout, result.stderr].filter(Boolean).join('\n').slice(0, MAX_RESULT_TEXT);
      structuredContent = result;
      if (!result.ok) {
        return frozen({
          ok: false,
          schemaVersion: SOVEREIGN_COMMANDER_SCHEMA,
          command,
          contentText,
          structuredContent,
          blocker: result.errorCode || `fixed-process-exit-${String(result.status)}`,
          finalVerdict: 'SOVEREIGN_COMMANDER_EXECUTION_FAILED',
        });
      }
    }

    const proofHash = hash({
      commandId: command.commandId,
      missionId: command.missionId,
      operation: command.operation,
      plan: command.plan,
      contentText,
      structuredContent,
    });

    return frozen({
      ok: true,
      schemaVersion: SOVEREIGN_COMMANDER_SCHEMA,
      command,
      contentText,
      structuredContent,
      proofHash,
      receiptRequired: true,
      vendorMeterRequired: false,
      externalSaasRelayRequired: false,
      finalVerdict: 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED',
    });
  } catch (error) {
    return frozen({
      ok: false,
      schemaVersion: SOVEREIGN_COMMANDER_SCHEMA,
      command,
      blocker: text(error?.code || error?.message, 'sovereign-commander-execution-error').slice(0, 160),
      finalVerdict: 'SOVEREIGN_COMMANDER_EXECUTION_FAILED',
    });
  }
}
