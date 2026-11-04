#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  buildSovereignCommanderCapabilityParityLedger,
} from '../shared/agents/sovereignCommanderCapabilityParityV1.mjs';
import {
  compileSovereignCommanderCapabilityPlanV1,
} from '../shared/agents/sovereignCommanderCapabilityCompilerV1.mjs';
import { extractSovereignNativeCapabilityGapsV1, SOVEREIGN_NATIVE_GAP_INTAKE_SCHEMA } from '../shared/agents/sovereignCommanderNativeGapIntakeV1.mjs';
import { readSharedWorkspaceRecordDirectory } from '../shared/agents/shared-workspace-dashboard-feed.mjs';
import {
  promoteSharedWorkspaceLearningCandidatesV1,
} from '../shared/agents/flywheelLearningFabricV1.mjs';
import {
  createSharedWorkspaceEventRecord,
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
  readNativeEvents = readSharedWorkspaceRecordDirectory,
  readPrior = readJsonIfPresent,
  writeStatus = writeAtomicJson,
  writeEvent = writeAtomicJson,
  promoteLearning = promoteSharedWorkspaceLearningCandidatesV1,
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
    // Use the same validated event reader as the existing Flywheel. Malformed
    // or inaccessible histories cannot silently become new skill proposals.
    // Native intake is advisory only: a bad event store never blocks the
    // existing canonical Remote Commander parity reconciliation.
    let nativeEvents = { records: [], errors: [] };
    try {
      nativeEvents = await readNativeEvents(paths.workspaceRoot, 'events', {
        repoRoot: paths.repoRoot,
        nowMs: Date.parse(timestampUtc),
      });
    } catch {
      nativeEvents = { records: [], errors: ['NATIVE_EVENT_STORE_READ_FAILED'] };
    }
    const nativeIntakeBlocked = !Array.isArray(nativeEvents?.records)
      || (Array.isArray(nativeEvents?.errors) && nativeEvents.errors.length > 0);
    const trustedPriorNativeIntake = priorRecord?.schemaVersion === 'shared-agent-workspace-record.v1'
      && priorRecord?.kind === 'stephanos.shared_workspace.status'
      && priorRecord?.statusId === SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATUS_ID
      && priorRecord?.participantId === 'sovereign-commander'
      && priorRecord?.relatedIssue === '#2573'
      && priorRecord?.nativeGapIntake?.schemaVersion === SOVEREIGN_NATIVE_GAP_INTAKE_SCHEMA
      ? (priorRecord.nativeGapIntake.retainedGaps ?? priorRecord.nativeGapIntake.gaps) : [];
    const nativeGapIntake = extractSovereignNativeCapabilityGapsV1(
      nativeIntakeBlocked ? [] : nativeEvents.records,
      { nowUtc: timestampUtc, priorGaps: trustedPriorNativeIntake },
    );
    // Any already-persisted overflow means we cannot prove the complete
    // outstanding inventory from an aging seven-day event window. Do not
    // clear the fault simply because this cycle read fewer new events.
    const priorRetentionIncomplete = priorRecord?.nativeGapIntake?.retentionTruncated === true;
    const nativeGapInventoryIncomplete = nativeIntakeBlocked
      || nativeGapIntake.retentionTruncated || priorRetentionIncomplete;
    const capabilityCompiler = compileSovereignCommanderCapabilityPlanV1(ledger, {
      nativeGaps: nativeGapIntake.gaps,
    });
    const flywheelEventPublications = [];
    for (const candidate of capabilityCompiler.learningCandidates) {
      const eventId = `sovereign-capability-${String(candidate.recordKey || 'parity').slice(0, 48)}-proven`.slice(0, 80);
      const eventRecord = Object.freeze({
        ...createSharedWorkspaceEventRecord({
          eventId,
          participantId: 'sovereign-commander',
          timestampUtc,
          eventKind: 'sovereign-capability-parity-proven',
          summary: `Sovereign Commander proved and retained ${candidate.recordKey} parity.`,
          learningCandidate: candidate,
        }),
        canonicalOwnerGoal: '#2573',
        capabilityCompilerSchema: capabilityCompiler.schemaVersion,
        meterDependencyAccepted: false,
        mergeAuthority: false,
        arbitraryShellAllowed: false,
      });
      const publication = await writeEvent(
        paths.workspaceRoot,
        ['events', `${eventId}.json`],
        eventRecord,
        { repoRoot: paths.repoRoot, nowMs: Date.parse(timestampUtc) },
      );
      flywheelEventPublications.push(publication);
    }
    let flywheelLearning = null;
    if (flywheelEventPublications.some((publication) => publication?.ok === true)) {
      try {
        flywheelLearning = await promoteLearning({
          root: paths.workspaceRoot,
          repoRoot: paths.repoRoot,
          nowMs: Date.parse(timestampUtc),
          maxPromotions: 8,
        });
      } catch (error) {
        flywheelLearning = Object.freeze({
          ok: false,
          reason: String(error?.message || 'SOVEREIGN_CAPABILITY_FLYWHEEL_PROMOTION_FAILED'),
          finalVerdict: 'FLYWHEEL_LEARNING_PROMOTION_DEGRADED',
        });
      }
    }
    const combinedVerdict = nativeGapInventoryIncomplete
      ? 'SOVEREIGN_COMMANDER_NATIVE_GAP_INTAKE_DEGRADED'
      : nativeGapIntake.candidateCount > 0
        ? 'SOVEREIGN_COMMANDER_NATIVE_CAPABILITY_GAPS_TRACKED'
        : ledger.finalVerdict;
    const statusRecord = Object.freeze({
      ...createSharedWorkspaceStatusRecord({
        statusId: SOVEREIGN_COMMANDER_CAPABILITY_PARITY_STATUS_ID,
        participantId: 'sovereign-commander',
        timestampUtc,
        relatedIssue: '#2573',
        status: combinedVerdict,
        summary: ledger.buildableGapCount > 0
          ? `Sovereign Commander retains ${ledger.buildableGapCount} buildable Remote Commander parity gap(s) under #2573.`
          : nativeGapIntake.candidateCount > 0
            ? `Sovereign Commander has ${nativeGapIntake.candidateCount} native skill proposals; Remote Commander parity remains green.`
            : 'Sovereign Commander Remote Commander capability parity is green.',
        proofRefs: [],
      }),
      capabilityParity: ledger,
      capabilityCompiler,
      nativeGapIntake: Object.freeze({ ...nativeGapIntake,
        retentionTruncated: nativeGapInventoryIncomplete && (nativeGapIntake.retentionTruncated || priorRetentionIncomplete),
        sourceHealth: nativeGapInventoryIncomplete ? 'DEGRADED' : 'VALIDATED',
        sourceErrorCount: nativeGapInventoryIncomplete ? Math.max(1, nativeEvents.errors?.length || 0) : 0,
      }),
      flywheelLearning,
      flywheelEventPublicationCount: flywheelEventPublications.filter((item) => item?.ok === true).length,
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
      newlyProvenParityCount: ledger.newlyProvenParityCount,
      buildableGapCount: ledger.buildableGapCount,
      capabilityCompiler,
      nativeGapIntake,
      nativeGapSourceHealth: nativeGapInventoryIncomplete ? 'DEGRADED' : 'VALIDATED',
      flywheelLearning,
      flywheelEventPublications: Object.freeze(flywheelEventPublications),
      boundaryHoldCount: ledger.boundaryHoldCount,
      ...boundary(),
      finalVerdict: combinedVerdict,
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
