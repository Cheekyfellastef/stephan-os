#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { writeAtomicJson } from '../shared/agents/sharedAgentWorkspaceStore.mjs';
import {
  BATTLE_BRIDGE_SYNC_AND_REFRESH_RESULT_MARKER,
  resolveCanonicalSyncAndRefreshPaths,
  runBattleBridgeSyncAndRefresh,
} from './battle-bridge-github-sync-and-refresh.mjs';

export const BATTLE_BRIDGE_SYNC_HOUSEKEEPER_BRIDGE_SCHEMA = 'stephanos.battle-bridge-sync-housekeeper-bridge.v1';
export const BATTLE_BRIDGE_SYNC_HOUSEKEEPER_BRIDGE_RESULT_MARKER = 'BATTLE_BRIDGE_SYNC_HOUSEKEEPER_BRIDGE_RESULT=';
export const HOUSEKEEPER_STATUS_MARKER = '[HOUSEKEEP] status=';
const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const DIRTY_CLASSIFICATION = 'BLOCKED_DIRTY_SOURCE';

function text(value) {
  return String(value ?? '').trim();
}

function safeCount(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function safeSha(value) {
  const normalized = text(value).toLowerCase();
  return SHA_PATTERN.test(normalized) ? normalized : '';
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(text(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function parseHousekeeperStatus(stdout = '') {
  const lines = String(stdout ?? '').split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!lines[index].startsWith(HOUSEKEEPER_STATUS_MARKER)) continue;
    return parseJsonObject(lines[index].slice(HOUSEKEEPER_STATUS_MARKER.length));
  }
  return null;
}

export function projectSyncHousekeeperEvidence({
  rawStatus = null,
  sourceHead = '',
  observedAtUtc = new Date().toISOString(),
  execution = null,
} = {}) {
  const head = safeSha(sourceHead);
  if (!rawStatus || !head) {
    return Object.freeze({
      schemaVersion: BATTLE_BRIDGE_SYNC_HOUSEKEEPER_BRIDGE_SCHEMA,
      status: 'UNPROVEN',
      state: 'UNPROVEN',
      observedAtUtc,
      sourceHead: head,
      head,
      freshnessSeconds: 0,
      cleanedCount: 0,
      sourceDirtCount: 0,
      unknownDirtCount: 0,
      errorCount: 1,
      errorCodes: Object.freeze([!head ? 'HOUSEKEEPER_SOURCE_HEAD_UNPROVEN' : 'HOUSEKEEPER_STATUS_UNPROVEN']),
      blocker: !head ? 'HOUSEKEEPER_SOURCE_HEAD_UNPROVEN' : 'HOUSEKEEPER_STATUS_UNPROVEN',
      supervisorInvocation: 'existing-scheduled-github-sync',
      commandAuthority: 'existing-ignition-housekeeper-dry-run',
      classificationOnly: true,
      sourceMutationAllowed: false,
      destructiveCleanupAllowed: false,
      arbitraryShellAllowed: false,
      executionExitCode: execution?.status ?? null,
    });
  }

  const sourceDirtCount = safeCount(rawStatus.ignitionSourceDirtCount);
  const hardBlockCount = safeCount(rawStatus.ignitionHardBlockCount);
  const cleanedCount = safeCount(rawStatus.ignitionAutoCleaned)
    + safeCount(rawStatus.ignitionRuntimeCleaned)
    + safeCount(rawStatus.ignitionOpenClawWorkspaceMoved);
  const ready = rawStatus.ignitionStatus === 'READY'
    && rawStatus.ignitionReadyToEnterCommandDeck === true
    && sourceDirtCount === 0
    && hardBlockCount === 0;
  const errorCodes = [];
  if (sourceDirtCount > 0) errorCodes.push('HOUSEKEEPER_SOURCE_DIRT_PRESENT');
  if (hardBlockCount > 0) errorCodes.push('HOUSEKEEPER_HARD_BLOCK_PRESENT');
  const state = ready ? 'CLEAN' : 'BLOCKED';
  return Object.freeze({
    schemaVersion: BATTLE_BRIDGE_SYNC_HOUSEKEEPER_BRIDGE_SCHEMA,
    status: state,
    state,
    observedAtUtc,
    sourceHead: head,
    head,
    freshnessSeconds: 0,
    cleanedCount,
    sourceDirtCount,
    unknownDirtCount: hardBlockCount,
    errorCount: errorCodes.length,
    errorCodes: Object.freeze(errorCodes),
    blocker: ready ? '' : errorCodes[0] || 'HOUSEKEEPER_BLOCKED',
    supervisorInvocation: 'existing-scheduled-github-sync',
    commandAuthority: 'existing-ignition-housekeeper-dry-run',
    classificationOnly: true,
    sourceMutationAllowed: false,
    destructiveCleanupAllowed: false,
    arbitraryShellAllowed: false,
    executionExitCode: execution?.status ?? null,
  });
}

export function createFixedSyncHousekeeperAdapter({ spawnSyncFn = spawnSync } = {}) {
  return Object.freeze({
    run(paths) {
      const ignitionPath = path.resolve(paths.repoRoot, 'scripts', 'ignite-stephanos-local.mjs');
      const execution = spawnSyncFn(process.execPath, [ignitionPath, '--mode=housekeep-dry-run'], {
        cwd: paths.repoRoot,
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 180_000,
        maxBuffer: 4 * 1024 * 1024,
      });
      return Object.freeze({
        execution: Object.freeze({
          ok: !execution?.error && execution?.status === 0,
          status: execution?.status ?? null,
          errorCode: execution?.error?.code || '',
        }),
        rawStatus: parseHousekeeperStatus(execution?.stdout || ''),
      });
    },
  });
}

export async function persistSyncHousekeeperEvidence({
  paths,
  housekeeper,
  readFileFn = readFile,
  writeAtomicJsonFn = writeAtomicJson,
} = {}) {
  let current;
  try {
    current = JSON.parse(await readFileFn(paths.syncStatusPath, 'utf8'));
  } catch {
    return Object.freeze({ ok: false, blocker: 'SYNC_STATUS_READ_FAILED' });
  }
  if (!current || typeof current !== 'object' || Array.isArray(current)) {
    return Object.freeze({ ok: false, blocker: 'SYNC_STATUS_INVALID' });
  }
  const enriched = Object.freeze({ ...current, housekeeper });
  const write = await writeAtomicJsonFn(
    paths.workspaceRoot,
    ['status', 'battle-bridge-github-sync-current.json'],
    enriched,
    { repoRoot: paths.repoRoot },
  );
  return write?.ok
    ? Object.freeze({ ok: true, blocker: '', path: write.path || paths.syncStatusPath })
    : Object.freeze({ ok: false, blocker: write?.reason || 'SYNC_STATUS_HOUSEKEEPER_WRITE_FAILED' });
}

function isDirtySourceBlock(result = {}) {
  return result?.blocker === DIRTY_CLASSIFICATION || result?.syncClassification === DIRTY_CLASSIFICATION;
}

export async function runBattleBridgeSyncHousekeeperBridge({
  env = process.env,
  paths = resolveCanonicalSyncAndRefreshPaths({ env, home: os.homedir() }),
  expectedPaths = resolveCanonicalSyncAndRefreshPaths({ env, home: os.homedir() }),
  syncRunner = runBattleBridgeSyncAndRefresh,
  housekeeperAdapter = createFixedSyncHousekeeperAdapter(),
  persistHousekeeper = persistSyncHousekeeperEvidence,
  now = () => new Date(),
} = {}) {
  if (path.resolve(paths.repoRoot) !== path.resolve(expectedPaths.repoRoot)
    || path.resolve(paths.workspaceRoot) !== path.resolve(expectedPaths.workspaceRoot)) {
    return Object.freeze({
      schemaVersion: BATTLE_BRIDGE_SYNC_HOUSEKEEPER_BRIDGE_SCHEMA,
      ok: false,
      blocker: 'SYNC_HOUSEKEEPER_NON_CANONICAL_PATH',
      housekeeperAttempted: false,
      finalVerdict: 'SYNC_HOUSEKEEPER_BRIDGE_BLOCKED',
    });
  }

  const sync = await syncRunner({ env, paths, expectedPaths });
  if (!isDirtySourceBlock(sync)) {
    return Object.freeze({
      ...sync,
      schemaVersion: BATTLE_BRIDGE_SYNC_HOUSEKEEPER_BRIDGE_SCHEMA,
      housekeeperAttempted: false,
      wrappedSyncResultMarker: BATTLE_BRIDGE_SYNC_AND_REFRESH_RESULT_MARKER,
    });
  }

  const attempt = housekeeperAdapter.run(paths);
  const sourceHead = safeSha(sync.sourceHead);
  const observedAtUtc = now().toISOString();
  const housekeeper = projectSyncHousekeeperEvidence({
    rawStatus: attempt.rawStatus,
    sourceHead,
    observedAtUtc,
    execution: attempt.execution,
  });
  const persistence = await persistHousekeeper({ paths, housekeeper });
  if (!persistence?.ok) {
    return Object.freeze({
      ...sync,
      schemaVersion: BATTLE_BRIDGE_SYNC_HOUSEKEEPER_BRIDGE_SCHEMA,
      ok: false,
      blocker: persistence?.blocker || 'SYNC_STATUS_HOUSEKEEPER_WRITE_FAILED',
      housekeeperAttempted: true,
      housekeeper,
      housekeeperPersistence: persistence || null,
      finalVerdict: 'SYNC_HOUSEKEEPER_BRIDGE_BLOCKED',
    });
  }

  return Object.freeze({
    ...sync,
    schemaVersion: BATTLE_BRIDGE_SYNC_HOUSEKEEPER_BRIDGE_SCHEMA,
    housekeeperAttempted: true,
    housekeeper,
    housekeeperPersistence: persistence,
    wrappedSyncResultMarker: BATTLE_BRIDGE_SYNC_AND_REFRESH_RESULT_MARKER,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runBattleBridgeSyncHousekeeperBridge();
  process.stdout.write(`${BATTLE_BRIDGE_SYNC_HOUSEKEEPER_BRIDGE_RESULT_MARKER}${JSON.stringify(result)}\n`);
  process.exitCode = result.ok ? 0 : 2;
}
