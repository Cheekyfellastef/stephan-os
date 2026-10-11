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
import { runUi4173Repair } from './battle-bridge-ui-4173-repair.mjs';

export const SOVEREIGN_COMMANDER_UI_4173_REPAIR_SCHEMA = 'stephanos.sovereign-commander-ui-4173-repair.v1';
export const SOVEREIGN_COMMANDER_UI_4173_REPAIR_MARKER = 'SOVEREIGN_COMMANDER_UI_4173_REPAIR_RESULT=';

const DEFAULT_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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

  if (before.status === 'READY') {
    return Object.freeze({
      schemaVersion: SOVEREIGN_COMMANDER_UI_4173_REPAIR_SCHEMA,
      ok: true,
      expectedHead,
      workspaceRoot,
      alreadyReady: true,
      publisherBefore: before,
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

  const ok = repairExitCode === 0
    && repair?.ready === true
    && after?.ok === true
    && after?.status === 'READY';

  return Object.freeze({
    schemaVersion: SOVEREIGN_COMMANDER_UI_4173_REPAIR_SCHEMA,
    ok,
    blocker: ok ? '' : text(repair?.blockers?.[0]?.id || repair?.action || 'STEPHANOS_UI_4173_REPAIR_UNPROVEN'),
    expectedHead,
    workspaceRoot,
    alreadyReady: false,
    repairExitCode,
    repair,
    publisherBefore: before,
    publisherAfter: after,
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
