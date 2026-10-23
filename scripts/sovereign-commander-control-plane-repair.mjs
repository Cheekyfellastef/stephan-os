#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER, sovereignMaintenanceCustodyUnprovenV1 } from '../shared/agents/sovereignMaintenanceAdmissionV1.mjs';
import { reconcileBattleBridgeControlPlane } from '../shared/agents/battleBridgeControlPlaneSelfRepairV1.mjs';

export const SOVEREIGN_COMMANDER_CONTROL_PLANE_REPAIR_SCHEMA = 'stephanos.sovereign-commander-control-plane-repair.v1';
const GIT = 'C:\\Program Files\\Git\\cmd\\git.exe';
const SHA40 = /^[0-9a-f]{40}$/;

function text(value) {
  return String(value ?? '').trim();
}

function fixedGit(spawnSyncFn, repoRoot, args) {
  const result = spawnSyncFn(GIT, ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 256 * 1024,
  });
  return Object.freeze({
    ok: !result?.error && Number(result?.status) === 0,
    stdout: text(result?.stdout),
    status: Number.isInteger(result?.status) ? result.status : null,
  });
}

export function runSovereignCommanderControlPlaneRepair({
  repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  platform = process.platform,
  spawnSyncFn = spawnSync,
  reconciler = reconcileBattleBridgeControlPlane,
} = {}) {
  const branch = fixedGit(spawnSyncFn, repoRoot, ['branch', '--show-current']);
  const head = fixedGit(spawnSyncFn, repoRoot, ['rev-parse', 'HEAD']);
  const observedHead = head.stdout.toLowerCase();

  if (!branch.ok || !head.ok || branch.stdout !== 'main' || !SHA40.test(observedHead)) {
    return Object.freeze({
      schemaVersion: SOVEREIGN_COMMANDER_CONTROL_PLANE_REPAIR_SCHEMA,
      ok: false,
      blocker: 'SOVEREIGN_COMMANDER_CANONICAL_MAIN_REQUIRED',
      sourceHead: observedHead,
      sourceMutationAllowed: false,
      gitMutationAllowed: false,
      arbitraryShellAllowed: false,
      pcRestartAllowed: false,
      finalVerdict: 'SOVEREIGN_COMMANDER_CONTROL_PLANE_REPAIR_BLOCKED',
    });
  }

  // The lower reconciler compacts installer failures and may continue other
  // tasks. Retain raw terminal custody before that projection loses it, and
  // never launch another fixed child after an unknown descendant outcome.
  const executionEvidence = [];
  let custodyHeld = false;
  const guardedSpawn = (...args) => {
    if (custodyHeld || executionEvidence.length >= 128) {
      custodyHeld = true;
      return { status: null, stdout: '', stderr: '',
        error: { code: SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER } };
    }
    let result;
    try { result = spawnSyncFn(...args); }
    catch {
      custodyHeld = true;
      executionEvidence.push(Object.freeze({ status: null, signal: '',
        errorCode: SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER }));
      return { status: null, stdout: '', stderr: '',
        error: { code: SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER } };
    }
    const evidence = Object.freeze({
      status: Number.isInteger(result?.status) ? result.status : null,
      signal: text(result?.signal),
      errorCode: text(result?.error?.code).slice(0, 160),
    });
    executionEvidence.push(evidence);
    custodyHeld ||= Boolean(result?.error) || sovereignMaintenanceCustodyUnprovenV1(evidence);
    return result;
  };
  let repair;
  try {
    repair = reconciler({
      repoRoot,
      expectedHead: observedHead,
      platform,
      spawnSyncFn: guardedSpawn,
    });
  } catch {
    custodyHeld = true;
    repair = Object.freeze({ ok: false, blocker: SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER });
  }

  const authoritySafe = repair?.sourceMutationAllowed === false
    && repair?.gitMutationAllowed === false
    && repair?.arbitraryShellAllowed === false
    && repair?.pcRestartAllowed === false;
  const ok = !custodyHeld && repair?.ok === true
    && repair?.sourceHead === observedHead
    && authoritySafe;

  return Object.freeze({
    schemaVersion: SOVEREIGN_COMMANDER_CONTROL_PLANE_REPAIR_SCHEMA,
    ok,
    blocker: custodyHeld ? SOVEREIGN_MAINTENANCE_CUSTODY_BLOCKER
      : ok ? '' : text(repair?.blocker || 'CONTROL_PLANE_REPAIR_UNPROVEN'),
    sourceHead: observedHead,
    repair,
    executionEvidence: Object.freeze(executionEvidence),
    sourceMutationAllowed: false,
    gitMutationAllowed: false,
    arbitraryShellAllowed: false,
    pcRestartAllowed: false,
    finalVerdict: ok
      ? 'SOVEREIGN_COMMANDER_CONTROL_PLANE_REPAIR_GREEN'
      : 'SOVEREIGN_COMMANDER_CONTROL_PLANE_REPAIR_BLOCKED',
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = runSovereignCommanderControlPlaneRepair();
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exitCode = result.ok ? 0 : 1;
}
