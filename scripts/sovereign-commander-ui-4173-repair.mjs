#!/usr/bin/env node
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  collectCanonicalIgnitionSourceTruth,
  defaultBattleBridgeSharedWorkspace,
  evaluateCanonicalIgnitionSourceTruth,
} from './battle-bridge-ignition-supervisor.mjs';
import { refreshBattleBridgeSharedWorkspacePublisher } from './battle-bridge-shared-workspace-publisher.mjs';
import { collectUi4173ServedExactHeadProof, runUi4173Repair } from './battle-bridge-ui-4173-repair.mjs';

export const SOVEREIGN_COMMANDER_UI_4173_REPAIR_SCHEMA = 'stephanos.sovereign-commander-ui-4173-repair.v1';
export const SOVEREIGN_COMMANDER_UI_4173_REPAIR_MARKER = 'SOVEREIGN_COMMANDER_UI_4173_REPAIR_RESULT=';

const DEFAULT_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SERVED_HEAD_PROBE_TIMEOUT_MS = 5_000;

function boundedServedHeadFetch(url) {
  // Keep the abort signal active through the response body read performed by
  // collectUi4173ServedExactHeadProof, not only until fetch resolves headers.
  return fetch(url, { signal: AbortSignal.timeout(SERVED_HEAD_PROBE_TIMEOUT_MS), cache: 'no-store' });
}

function text(value) {
  return String(value ?? '').trim();
}

function parseRepairOutput(raw) {
  try { return JSON.parse(String(raw || '').trim()); } catch { return null; }
}

export async function runSovereignCommanderUi4173Repair({
  repoRoot = DEFAULT_REPO_ROOT,
  sharedWorkspace = defaultBattleBridgeSharedWorkspace(),
  platform = process.platform,
  environment = process.env,
  sourceTruthFn = collectCanonicalIgnitionSourceTruth,
  evaluateSourceTruthFn = evaluateCanonicalIgnitionSourceTruth,
  publisherFn = refreshBattleBridgeSharedWorkspacePublisher,
  servedRuntimeProofFn = collectUi4173ServedExactHeadProof,
  servedProbeFetchFn = boundedServedHeadFetch,
  repairFn = runUi4173Repair,
} = {}) {
  const canonicalRepoRoot = resolve(repoRoot);
  const workspaceRoot = resolve(sharedWorkspace);
  const sourceTruth = sourceTruthFn({ cwd: canonicalRepoRoot, platform, environment });
  const sourceVerdict = evaluateSourceTruthFn(sourceTruth);
  if (!sourceVerdict?.ok) {
    return Object.freeze({
      schemaVersion: SOVEREIGN_COMMANDER_UI_4173_REPAIR_SCHEMA,
      ok: false,
      blocker: text(sourceVerdict?.blocker?.code || sourceVerdict?.blocker?.id || 'CANONICAL_SOURCE_TRUTH_UNPROVEN'),
      sourceVerdict,
      finalVerdict: 'SOVEREIGN_COMMANDER_UI_4173_REPAIR_BLOCKED',
    });
  }

  const expectedHead = text(sourceVerdict?.sourceTruth?.head || sourceTruth?.head).toLowerCase();
  const before = await publisherFn({
    repoRoot: canonicalRepoRoot,
    sharedWorkspace: workspaceRoot,
  });
  if (!before?.ok) {
    return Object.freeze({
      schemaVersion: SOVEREIGN_COMMANDER_UI_4173_REPAIR_SCHEMA,
      ok: false,
      blocker: 'BATTLE_BRIDGE_SHARED_WORKSPACE_REFRESH_FAILED',
      expectedHead,
      publisherBefore: before || null,
      finalVerdict: 'SOVEREIGN_COMMANDER_UI_4173_REPAIR_BLOCKED',
    });
  }

  // Publisher READY is a service-level observation, not proof that the
  // generated dist on 4173 matches the exact protected main source head.
  // A stale dist can still return HTTP 200 and make Flywheel open an old UI.
  const proveServedHead = async () => {
    try {
      return await servedRuntimeProofFn({ expectedHead, fetchFn: servedProbeFetchFn });
    } catch (error) {
      return { ready: false, blocker: text(error?.code || 'SERVED_HEAD_PROBE_FAILED') };
    }
  };
  const servedBefore = await proveServedHead();
  if (before.status === 'READY' && servedBefore?.ready === true) {
    return Object.freeze({
      schemaVersion: SOVEREIGN_COMMANDER_UI_4173_REPAIR_SCHEMA,
      ok: true,
      expectedHead,
      workspaceRoot,
      alreadyReady: true,
      publisherBefore: before,
      servedHeadBefore: servedBefore,
      finalVerdict: 'SOVEREIGN_COMMANDER_UI_4173_REPAIR_GREEN',
    });
  }

  let repairOutput = '';
  const repairExitCode = await repairFn({
    sharedWorkspace: workspaceRoot,
    dryRun: false,
    expectedHead,
    platform,
    environment,
    stdout: { write: (chunk) => { repairOutput += String(chunk); } },
  });
  const repair = parseRepairOutput(repairOutput);
  const after = await publisherFn({
    repoRoot: canonicalRepoRoot,
    sharedWorkspace: workspaceRoot,
  });
  const servedAfter = await proveServedHead();

  // A peer may have repaired a transiently stale listener between the two
  // probes. Only admit the canonical narrow already-ready result if BOTH final
  // proofs agree; do not suppress any other safety blocker or error.
  const raceConverged = repairExitCode === 2
    && repair?.action === 'blocked'
    && Array.isArray(repair?.blockers)
    && repair.blockers.length === 1
    && repair.blockers[0]?.id === 'stephanos-ui-already-ready';
  const repairSucceeded = repairExitCode === 0 && repair?.ready === true;
  const ok = (repairSucceeded || raceConverged)
    && after?.ok === true
    && after?.status === 'READY'
    && servedAfter?.ready === true;

  return Object.freeze({
    schemaVersion: SOVEREIGN_COMMANDER_UI_4173_REPAIR_SCHEMA,
    ok,
    blocker: ok ? '' : text(repair?.blockers?.[0]?.id || (servedAfter?.ready !== true ? 'STEPHANOS_UI_4173_SERVED_HEAD_UNPROVEN' : '') || repair?.action || 'STEPHANOS_UI_4173_REPAIR_UNPROVEN'),
    expectedHead,
    workspaceRoot,
    alreadyReady: ok && raceConverged,
    repairExitCode,
    repair,
    raceConverged: ok && raceConverged,
    publisherBefore: before,
    publisherAfter: after,
    servedHeadBefore: servedBefore,
    servedHeadAfter: servedAfter,
    finalVerdict: ok
      ? 'SOVEREIGN_COMMANDER_UI_4173_REPAIR_GREEN'
      : 'SOVEREIGN_COMMANDER_UI_4173_REPAIR_BLOCKED',
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await runSovereignCommanderUi4173Repair();
  process.stdout.write(SOVEREIGN_COMMANDER_UI_4173_REPAIR_MARKER + JSON.stringify(result) + '\n');
  process.exitCode = result.ok ? 0 : 1;
}
