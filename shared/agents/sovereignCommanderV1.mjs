import { createHash } from 'node:crypto';
import { appendFile, readFile, readdir, stat, writeFile } from 'node:fs/promises';
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
  SEARCH_PROJECT: 'SEARCH_PROJECT',
  LIST_PROCESSES: 'LIST_PROCESSES',
  RUN_NODE_TEST: 'RUN_NODE_TEST',
  START_PROCESS: 'START_PROCESS',
  MAINTENANCE_ACTION: 'MAINTENANCE_ACTION',
});

const MAX_RESULT_TEXT = 16 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_FIXED_PROCESS_TIMEOUT_MS = 180_000;
const SEARCH_SKIPPED_DIRECTORIES = Object.freeze(new Set([
  '.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.cache',
]));
const SEARCH_SENSITIVE_BASENAME = /^(?:\.env(?:\..+)?|id_rsa|id_ed25519|credentials\.json|secrets?\.(?:json|ya?ml))$/i;
const SEARCH_SENSITIVE_EXTENSION = /\.(?:key|pem|pfx|p12)$/i;

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
    'battle-bridge-observe': frozen({
      executable: node,
      args: frozen([nodeFile('battle-bridge-observation.mjs')]),
      timeoutMs: 10_000,
    }),
    'repair-ui-4173': frozen({
      executable: node,
      args: frozen([nodeFile('sovereign-commander-ui-4173-repair.mjs')]),
      timeoutMs: 180_000,
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
    'status-stephanos-core-daemon': frozen({
      executable: powershell,
      args: frozen(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile('status-stephanos-core-daemon.ps1')]),
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
    'starfield-vr-performance-diagnosis': frozen({
      executable: powershell,
      args: frozen(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile('read-starfield-vr-performance-diagnosis.ps1')]),
      timeoutMs: 20_000,
    }),
    'report-starfield-vr-telemetry': frozen({
      executable: node,
      args: frozen([nodeFile('report-starfield-vr-telemetry.mjs')]),
      timeoutMs: 30_000,
    }),
    'starfield-vr-telemetry-refresh': frozen({
      executable: node,
      args: frozen([nodeFile('report-starfield-vr-telemetry.mjs')]),
      timeoutMs: 30_000,
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
    'repair-openclaw-stack': frozen({
      executable: powershell,
      args: frozen(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile('repair-openclaw-full-stack.ps1')]),
      timeoutMs: 120_000,
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
    'prove-vr-atlas-runtime': frozen({
      executable: node,
      args: frozen([nodeFile('sovereign-commander-ui-runtime-proof.mjs'), '--profile', 'vr-atlas-status-pills']),
      timeoutMs: 60_000,
    }),
    'reconcile-remote-commander-parity': frozen({
      executable: node,
      args: frozen([nodeFile('sovereign-commander-capability-parity-reconcile.mjs')]),
      timeoutMs: 30_000,
    }),
    'preservation-converge-pr-branch': frozen({
      executable: node,
      args: frozen([nodeFile('sovereign-commander-preservation-converge.mjs')]),
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
  } else if (operation === SOVEREIGN_COMMANDER_OPERATION.SEARCH_PROJECT) {
    const root = normalizedAbsolutePath(options.repoRoot);
    const query = typeof payload.query === 'string' ? payload.query.trim() : '';
    if (!root) blockers.push('trusted-repository-root-required');
    if (!query || query.length > 200) blockers.push('sovereign-commander-search-query-invalid');
    if (root && query && query.length <= 200) plan = frozen({
      kind: 'search-project',
      root,
      query,
      caseSensitive: payload.caseSensitive === true,
      maxResults: safeInteger(payload.maxResults, 50, 1, 100),
      maxFileBytes: 1024 * 1024,
    });
  } else if (operation === SOVEREIGN_COMMANDER_OPERATION.LIST_PROCESSES) {
    plan = frozen({ kind: 'list-processes' });
  } else if (operation === SOVEREIGN_COMMANDER_OPERATION.START_PROCESS
    || operation === SOVEREIGN_COMMANDER_OPERATION.MAINTENANCE_ACTION) {
    const processId = text(payload.processId || payload.actionId).toLowerCase();
    const fixed = registry[processId];
    if (!text(options.repoRoot)) blockers.push('trusted-repository-root-required');
    if (!fixed) blockers.push('sovereign-commander-process-not-registered');
    else {
      let args = [...fixed.args];
      if (processId === 'preservation-converge-pr-branch') {
        const targetPrNumber = Number(payload.targetPrNumber);
        const targetBranch = text(payload.targetBranch);
        const targetHead = text(payload.targetHead).toLowerCase();
        const expectedMain = text(payload.expectedMain).toLowerCase();
        const branchSafe = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,159}$/.test(targetBranch)
          && !targetBranch.includes('..')
          && !targetBranch.includes('//')
          && !targetBranch.endsWith('/')
          && !targetBranch.startsWith('refs/')
          && !['main', 'master'].includes(targetBranch.toLowerCase());
        if (!Number.isSafeInteger(targetPrNumber) || targetPrNumber < 1 || targetPrNumber > 999999999) {
          blockers.push('sovereign-preservation-convergence-pr-invalid');
        }
        if (!branchSafe) blockers.push('sovereign-preservation-convergence-branch-invalid');
        if (!/^[0-9a-f]{40}$/.test(targetHead)) blockers.push('sovereign-preservation-convergence-head-invalid');
        if (!/^[0-9a-f]{40}$/.test(expectedMain)) blockers.push('sovereign-preservation-convergence-main-invalid');
        if (targetHead && expectedMain && targetHead === expectedMain) blockers.push('sovereign-preservation-convergence-head-equals-main');
        if (blockers.length === 0) {
          args = [
            ...args,
            '--pr', String(targetPrNumber),
            '--branch', targetBranch,
            '--expected-head', targetHead,
            '--expected-main', expectedMain,
          ];
        }
      }
      if (blockers.length === 0) plan = frozen({ kind: 'fixed-process', processId, ...fixed, args: frozen(args) });
    }
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

function relativeProjectPath(root, candidate) {
  const windows = isWindowsAbsolutePath(root);
  return (windows ? win32.relative(root, candidate) : relative(root, candidate)).replaceAll('\\', '/');
}

function projectSearchFileAllowed(name) {
  const basename = text(name);
  return Boolean(basename)
    && !SEARCH_SENSITIVE_BASENAME.test(basename)
    && !SEARCH_SENSITIVE_EXTENSION.test(basename);
}

async function searchProjectTree(root, query, caseSensitive, maxResults, maxFileBytes) {
  const results = [];
  const needle = caseSensitive ? query : query.toLowerCase();

  async function walk(current) {
    if (results.length >= maxResults) return;
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (results.length >= maxResults) break;
      if (entry.isDirectory()) {
        if (!SEARCH_SKIPPED_DIRECTORIES.has(entry.name)) await walk(resolve(current, entry.name));
        continue;
      }
      if (!entry.isFile() || !projectSearchFileAllowed(entry.name)) continue;
      const absolute = resolve(current, entry.name);
      let info;
      try { info = await stat(absolute); } catch { continue; }
      if (!info.isFile() || info.size > maxFileBytes) continue;
      let raw;
      try { raw = await readFile(absolute, 'utf8'); } catch { continue; }
      if (raw.includes('\u0000')) continue;
      const lines = raw.split(/\r?\n/);
      for (let lineIndex = 0; lineIndex < lines.length && results.length < maxResults; lineIndex += 1) {
        const haystack = caseSensitive ? lines[lineIndex] : lines[lineIndex].toLowerCase();
        const column = haystack.indexOf(needle);
        if (column < 0) continue;
        results.push(frozen({
          path: absolute,
          relativePath: relativeProjectPath(root, absolute),
          line: lineIndex + 1,
          column: column + 1,
          preview: lines[lineIndex].slice(0, 240),
        }));
      }
    }
  }

  await walk(root);
  return results;
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
    cwd: normalizedAbsolutePath(options.repoRoot) || undefined,
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
        canSearchProject: true,
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
    } else if (command.plan.kind === 'search-project') {
      const results = await searchProjectTree(
        command.plan.root,
        command.plan.query,
        command.plan.caseSensitive,
        command.plan.maxResults,
        command.plan.maxFileBytes,
      );
      structuredContent = frozen({
        root: command.plan.root,
        query: command.plan.query,
        caseSensitive: command.plan.caseSensitive,
        resultCount: results.length,
        maxResults: command.plan.maxResults,
        results: frozen(results),
        truncated: results.length >= command.plan.maxResults,
      });
      contentText = results
        .map((entry) => `${entry.relativePath}:${entry.line}:${entry.column}\t${entry.preview}`)
        .join('\n')
        .slice(0, MAX_RESULT_TEXT);
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
