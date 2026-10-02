#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  buildSovereignCommanderCapabilityParityLedger,
} from '../shared/agents/sovereignCommanderCapabilityParityV1.mjs';
import {
  createSharedWorkspaceStatusRecord,
  writeAtomicJson,
} from '../shared/agents/sharedAgentWorkspaceStore.mjs';
import {
  resolveCriticalBacklogRuntimePaths,
} from '../stephanos-server/services/criticalBacklogConveyorServiceCore.js';
import {
  readMissionWorkerQueue,
} from '../stephanos-server/services/missionOrchestratorWorkerService.js';

export const SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATUS_ID =
  'sovereign-commander-capability-parity-current';
export const SOVEREIGN_COMMANDER_CAPABILITY_PARITY_RESULT_MARKER =
  'SOVEREIGN_COMMANDER_CAPABILITY_PARITY_RESULT=';

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function boundary() {
  return Object.freeze({
    mergeAuthority: false,
    runtimeMutationAuthority: false,
    arbitraryShellAllowed: false,
    pcRestartAuthority: false,
    destructiveGitAllowed: false,
    duplicateSchedulerAllowed: false,
    duplicateGoalCreationAllowed: false,
    operatorFallbackAllowed: false,
    meterDependencyAccepted: false,
  });
}

export async function reconcileSovereignCommanderCapabilityParity({
  env = process.env,
  paths = resolveCriticalBacklogRuntimePaths({ env }),
  readQueue = readMissionWorkerQueue,
  readPrior = readJsonIfPresent,
  writeStatus = writeAtomicJson,
  now = new Date(),
} = {}) {
  const timestampUtc = now instanceof Date ? now.toISOString() : new Date().toISOString();
  try {
    const queue = await readQueue({ env });
    const priorPath = join(
      paths.workspaceRoot,
      'status',
      `${SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATUS_ID}.json`,
    );
    const priorRecord = await readPrior(priorPath);
    const priorLedger = priorRecord?.capabilityParity || priorRecord;
    const ledger = buildSovereignCommanderCapabilityParityLedger(queue, {
      priorLedger,
      nowUtc: timestampUtc,
    });
    const statusRecord = Object.freeze({
      ...createSharedWorkspaceStatusRecord({
        statusId: SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATUS_ID,
        participantId: 'sovereign-commander',
        timestampUtc,
        relatedIssue: '#2573',
        status: ledger.finalVerdict,
        summary: ledger.buildableGapCount > 0
          ? `Sovereign Commander retains ${ledger.buildableGapCount} buildable Remote Commander parity gap(s) under #2573.`
          : 'Sovereign Commander Remote Commander capability parity is green.',
        proofRefs: [],
      }),
      capabilityParity: ledger,
      canonicalOwnerGoal: ledger.canonicalOwnerGoal,
      standingGoalMustRemainOpen: true,
      ...boundary(),
    });
    const publication = await writeStatus(
      paths.workspaceRoot,
      ['status', `${SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATUS_ID}.json`],
      statusRecord,
      { repoRoot: paths.repoRoot, nowMs: Date.parse(timestampUtc) },
    );
    if (publication?.ok !== true) {
      return Object.freeze({
        ok: false,
        blocker: `SOVEREIGN_COMMANDER_CAPABILITY_PARITY_PUBLICATION_FAILED:${String(publication?.reason || 'unknown')}`,
        ledger,
        publication,
        ...boundary(),
        finalVerdict: 'SOVEREIGN_COMMANDER_CAPABILITY_PARITY_RECONCILE_BLOCKED',
      });
    }
    return Object.freeze({
      ok: true,
      ledger,
      publication,
      canonicalOwnerGoal: ledger.canonicalOwnerGoal,
      retainedCapabilityCount: ledger.retainedCapabilityCount,
      parityPresentCount: ledger.parityPresentCount,
      buildableGapCount: ledger.buildableGapCount,
      boundaryHoldCount: ledger.boundaryHoldCount,
      ...boundary(),
      finalVerdict: ledger.finalVerdict,
    });
  } catch (error) {
    return Object.freeze({
      ok: false,
      blocker: String(error?.message || 'SOVEREIGN_COMMANDER_CAPABILITY_PARITY_RECONCILE_FAILED'),
      canonicalOwnerGoal: '#2573',
      ...boundary(),
      finalVerdict: 'SOVEREIGN_COMMANDER_CAPABILITY_PARITY_RECONCILE_BLOCKED',
    });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await reconcileSovereignCommanderCapabilityParity();
  process.stdout.write(
    `${SOVEREIGN_COMMANDER_CAPABILITY_PARITY_RESULT_MARKER}${JSON.stringify(result)}\n`,
  );
  process.exitCode = result.ok ? 0 : 2;
}
