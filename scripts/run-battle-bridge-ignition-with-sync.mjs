#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { runGitPullPreflightWithDeps } from './ignite-stephanos-local.mjs';

export const IGNITION_WITH_SYNC_SCHEMA = 'stephanos.ignition-with-sync.v1';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignitionScript = path.resolve(repoRoot, 'scripts', 'run-battle-bridge-ignition.mjs');

function safeText(value) {
  return String(value ?? '').trim();
}

export function runFreshIgnition({ argv = [], spawnSyncFn = spawnSync } = {}) {
  const result = spawnSyncFn(process.execPath, [ignitionScript, ...argv], {
    cwd: repoRoot,
    env: process.env,
    shell: false,
    windowsHide: true,
    stdio: 'inherit',
  });
  return Object.freeze({
    ok: !result?.error && result?.status === 0,
    status: result?.status ?? null,
    errorCode: result?.error?.code || '',
  });
}

export async function runIgnitionWithSync({
  argv = process.argv.slice(2),
  sourceUpdateFn = runGitPullPreflightWithDeps,
  ignitionFn = runFreshIgnition,
} = {}) {
  let sourceUpdate;
  try {
    sourceUpdate = await sourceUpdateFn({ argvArgs: argv });
  } catch (error) {
    const blocker = safeText(error?.message || 'IGNITION_SOURCE_UPDATE_BLOCKED');
    return Object.freeze({
      schemaVersion: IGNITION_WITH_SYNC_SCHEMA,
      ok: false,
      blocker,
      sourceHead: '',
      ignitionStarted: false,
      finalVerdict: 'IGNITION_SOURCE_UPDATE_BLOCKED',
    });
  }

  const sourceHead = safeText(sourceUpdate?.sourceUpdateProof?.localHeadAfter || sourceUpdate?.afterCommit).toLowerCase();
  const beforeHead = safeText(sourceUpdate?.sourceUpdateProof?.localHeadBefore || sourceUpdate?.beforeCommit).toLowerCase();
  const ignition = await ignitionFn({ argv });
  return Object.freeze({
    schemaVersion: IGNITION_WITH_SYNC_SCHEMA,
    ok: ignition?.ok === true,
    blocker: ignition?.ok === true ? '' : 'IGNITION_AFTER_SOURCE_UPDATE_FAILED',
    sourceHead,
    sourceUpdated: Boolean(sourceHead && beforeHead && sourceHead !== beforeHead),
    ignitionStarted: true,
    ignition,
    finalVerdict: ignition?.ok === true ? 'IGNITION_WITH_SOURCE_UPDATE_PASS' : 'IGNITION_WITH_SOURCE_UPDATE_BLOCKED',
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runIgnitionWithSync();
  if (!result.ok) {
    process.stderr.write(`[IGNITION UPDATE] blocked=${result.blocker}\n`);
  } else {
    process.stdout.write(`[IGNITION UPDATE] ready head=${result.sourceHead} sourceUpdated=${result.sourceUpdated ? 'yes' : 'no'}\n`);
  }
  process.exitCode = result.ok ? 0 : 2;
}
