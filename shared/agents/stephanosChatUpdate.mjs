import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import {
  DEFAULT_CODEX_DISPATCH_REPO_ROOT,
  runBattleBridgeDiagnostics,
  syncCodexDispatchBridge,
} from './codexDispatchHostOps.mjs';

export const STEPHANOS_CHAT_UPDATE_SCHEMA = 'stephanos.chat-update.v1';

const APPROVED_RUNTIME_PREFIXES = Object.freeze([
  'apps/stephanos/dist/',
  'data/',
  'stephanos-server/data/memory/durable-memory.json',
]);

function bounded(value = '', limit = 8000) {
  const text = String(value || '').trim();
  return text.length > limit ? `${text.slice(0, limit)}\n...[truncated]` : text;
}

function capture(spawnSyncFn, command, args, { cwd, timeout = 900000 } = {}) {
  const result = spawnSyncFn(command, args, {
    cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout,
  });
  return Object.freeze({
    command,
    args: [...args],
    ok: !result?.error && result?.status === 0,
    status: result?.status ?? null,
    signal: result?.signal ?? null,
    stdout: bounded(result?.stdout),
    stderr: bounded(result?.stderr),
    error: result?.error?.message || '',
  });
}

function parsePorcelain(output = '') {
  return String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => ({
      status: line.slice(0, 2),
      path: line.slice(3).trim().split(' -> ').at(-1)?.replace(/^"|"$/g, '').replace(/\\/g, '/') || '',
    }))
    .filter((entry) => entry.path);
}

function stableEntries(entries = []) {
  return entries.map((entry) => `${entry.status} ${entry.path}`).sort((a, b) => a.localeCompare(b));
}

export function classifyUpdateDirt(output = '') {
  const entries = parsePorcelain(output);
  const runtimeEntries = entries.filter((entry) => APPROVED_RUNTIME_PREFIXES.some((prefix) => (
    prefix.endsWith('/') ? entry.path.startsWith(prefix) : entry.path === prefix
  )));
  const sourceEntries = entries.filter((entry) => !runtimeEntries.includes(entry));
  return Object.freeze({
    entries,
    runtimeEntries,
    sourceEntries,
    runtime: runtimeEntries.map((entry) => entry.path),
    source: sourceEntries.map((entry) => entry.path),
  });
}

export function compareUpdateDirt(before = {}, after = {}) {
  const sourceBefore = stableEntries(before.sourceEntries || []);
  const sourceAfter = stableEntries(after.sourceEntries || []);
  const runtimeBefore = stableEntries(before.runtimeEntries || []);
  const runtimeAfter = stableEntries(after.runtimeEntries || []);
  return Object.freeze({
    sourceMutationDetected: JSON.stringify(sourceBefore) !== JSON.stringify(sourceAfter),
    runtimeMutationDetected: JSON.stringify(runtimeBefore) !== JSON.stringify(runtimeAfter),
    sourceDirtBefore: sourceBefore,
    sourceDirtAfter: sourceAfter,
    runtimeDirtBefore: runtimeBefore,
    runtimeDirtAfter: runtimeAfter,
  });
}

function servedUiProof(diagnostics = {}) {
  const ui = Array.isArray(diagnostics.health)
    ? diagnostics.health.find((entry) => String(entry?.url || '').includes('127.0.0.1:4173'))
    : null;
  let payload = null;
  try { payload = ui?.body ? JSON.parse(ui.body) : null; } catch {}
  const sourceHead = String(diagnostics.fullHead || '');
  const servedCommit = String(payload?.gitCommit || '');
  return Object.freeze({
    healthOk: ui?.ok === true,
    httpStatus: ui?.status ?? null,
    sourceHead,
    servedCommit,
    runtimeMarker: String(payload?.runtimeMarker || ''),
    exactHead: Boolean(sourceHead && servedCommit && sourceHead.toLowerCase().startsWith(servedCommit.toLowerCase())),
    intendedMode: payload?.intendedMode || '',
    error: ui?.error || '',
  });
}

export async function updateStephanosFromChat({
  repoRoot = DEFAULT_CODEX_DISPATCH_REPO_ROOT,
  expectedBranch = 'main',
  operatorApproval = '',
  platform = process.platform,
  spawnSyncFn = spawnSync,
  syncFn = syncCodexDispatchBridge,
  diagnosticsFn = runBattleBridgeDiagnostics,
} = {}) {
  if (operatorApproval !== 'operator-approved') {
    return Object.freeze({
      ok: false,
      schemaVersion: STEPHANOS_CHAT_UPDATE_SCHEMA,
      status: 'BLOCKED',
      verdict: 'FAIL',
      blocker: 'OPERATOR_APPROVAL_REQUIRED',
      nextOperatorAction: 'Ask Stephan to explicitly approve updating the canonical Battle Bridge checkout and refreshing the Stephanos runtime.',
    });
  }

  const sync = await syncFn({ repoRoot, expectedBranch, operatorApproval, platform, spawnSyncFn });
  if (!sync?.ok) {
    return Object.freeze({
      ok: false,
      schemaVersion: STEPHANOS_CHAT_UPDATE_SCHEMA,
      status: sync?.status || 'BLOCKED',
      verdict: 'FAIL',
      blocker: sync?.blocker || 'SOURCE_SYNC_FAILED',
      sync,
      runtimeRefreshAttempted: false,
      operatorPowerShellRequired: false,
      nextOperatorAction: 'Inspect the exact bounded sync blocker. No local work was discarded and no runtime refresh was attempted.',
    });
  }

  const preDiagnostics = await diagnosticsFn({ repoRoot, spawnSyncFn });
  const statusBefore = capture(spawnSyncFn, 'git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: repoRoot, timeout: 120000 });
  const dirtBefore = classifyUpdateDirt(statusBefore.stdout);
  const ignitionScript = join(repoRoot, 'scripts', 'run-battle-bridge-ignition.mjs');
  const ignition = capture(spawnSyncFn, process.execPath, [ignitionScript], { cwd: repoRoot, timeout: 900000 });
  const postDiagnostics = await diagnosticsFn({ repoRoot, spawnSyncFn });
  const statusAfter = capture(spawnSyncFn, 'git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: repoRoot, timeout: 120000 });
  const dirtAfter = classifyUpdateDirt(statusAfter.stdout);
  const dirtDelta = compareUpdateDirt(dirtBefore, dirtAfter);
  const uiProof = servedUiProof(postDiagnostics);
  const sourceHeadUnchangedDuringRefresh = Boolean(
    preDiagnostics?.fullHead
    && postDiagnostics?.fullHead
    && preDiagnostics.fullHead === postDiagnostics.fullHead
  );
  const sourceMatchesSync = Boolean(sync.afterHead && postDiagnostics?.fullHead === sync.afterHead);
  const passed = Boolean(
    ignition.ok
    && postDiagnostics?.ok
    && uiProof.exactHead
    && sourceHeadUnchangedDuringRefresh
    && sourceMatchesSync
    && !dirtDelta.sourceMutationDetected
  );

  return Object.freeze({
    ok: passed,
    schemaVersion: STEPHANOS_CHAT_UPDATE_SCHEMA,
    status: passed ? 'DONE' : (dirtDelta.sourceMutationDetected ? 'BLOCKED' : 'FAILED'),
    verdict: passed ? 'PASS' : 'FAIL',
    repoRoot,
    expectedBranch,
    sync,
    preDiagnostics,
    ignition,
    postDiagnostics,
    servedUiProof: uiProof,
    sourceHeadUnchangedDuringRefresh,
    sourceMatchesSync,
    dirtBefore,
    dirtAfter,
    dirtDelta,
    operatorPowerShellRequired: false,
    visiblePowerShellRequested: false,
    codexChildUsed: false,
    processControlPerformed: true,
    publicExposureChanged: false,
    destructiveSourceCleanupPerformed: false,
    desktopRestartRequired: Boolean(sync.restartRequired),
    blocker: passed
      ? ''
      : (dirtDelta.sourceMutationDetected
        ? 'SOURCE_DIRT_CHANGED_DURING_UPDATE'
        : (!ignition.ok
          ? 'IGNITION_REFRESH_FAILED'
          : (!uiProof.exactHead ? 'SERVED_RUNTIME_NOT_EXACT_HEAD' : 'POST_UPDATE_PROOF_FAILED'))),
    nextOperatorAction: passed
      ? (sync.restartRequired
        ? 'Stephanos source and runtime are exact-head. Restart the desktop app when convenient so changed local MCP code is reloaded.'
        : 'Stephanos source and runtime are exact-head. No PowerShell action is required.')
      : 'Inspect the returned bounded blocker. Do not reset, clean, stash, force-checkout, or discard local work.',
  });
}
