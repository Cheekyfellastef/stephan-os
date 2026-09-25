import { mkdir, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

import { readExecutionReceiptHistory } from '../../shared/agents/executionReceiptV1.mjs';
import { readMissionRecord } from './missionOrchestratorStore.js';
import {
  acquireMissionWorkerClaimOwnership,
  inspectMissionWorkerClaimOwnership,
  missionWorkerQueueItemSha256,
} from './missionWorkerClaimOwnershipV1.js';
import { resolveMissionWorkerQueueRoot } from './missionOrchestratorWorkerService.js';
import { retireProviderNeutralTerminalMutationCheckpointV1 } from './providerNeutralSourceMutationCheckpointV1.js';
import {
  publishMissionWorkerResultAtomicallyV1,
  quarantineInvalidMissionWorkerResultV1,
} from './missionWorkerResultPublicationV1.js';

export const PROVIDER_NEUTRAL_TERMINAL_ORPHAN_RECONCILIATION_SCHEMA =
  'stephanos.provider-neutral-terminal-orphan-reconciliation.v1';

const ADAPTERS = Object.freeze(['foundry-forge', 'chatgpt-github']);
const SHA40 = /^[0-9a-f]{40}$/i;
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,160}$/i;

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function queuePaths(root, adapter) {
  const adapterRoot = resolve(root, adapter);
  return {
    processing: resolve(adapterRoot, 'processing'),
    completed: resolve(adapterRoot, 'completed'),
    failed: resolve(adapterRoot, 'failed'),
  };
}

function workspaceRoot(options = {}) {
  return options.sharedWorkspaceRoot
    || options.env?.STEPHANOS_SHARED_AGENT_WORKSPACE
    || process.env.STEPHANOS_SHARED_AGENT_WORKSPACE
    || '';
}

function receiptOptions(options = {}) {
  return {
    repoRoot: options.repoRoot
      || options.env?.STEPHANOS_MISSION_WORKER_REPOSITORY_ROOT
      || process.env.STEPHANOS_MISSION_WORKER_REPOSITORY_ROOT,
  };
}

function exactQueueIdentity(item, adapter) {
  const grant = item?.actionGrant;
  const binding = item?.executionBinding;
  const action = item?.payload;
  const actionId = text(item?.actionId).toLowerCase();
  const missionId = text(item?.missionId).toLowerCase();
  const normalizedAdapter = text(adapter).toLowerCase();
  const headSha = text(binding?.headSha || binding?.sourceRevision).toLowerCase();
  const valid = item?.schemaVersion === 'stephanos.mission-worker-queue-item.v1'
    && ADAPTERS.includes(normalizedAdapter)
    && text(item?.adapter).toLowerCase() === normalizedAdapter
    && SAFE_ID.test(actionId)
    && SAFE_ID.test(missionId)
    && grant?.schemaVersion === 'stephanos.mission-worker-action-grant.v1'
    && binding?.schemaVersion === 'stephanos.mission-worker-queue-execution-binding.v1'
    && text(grant.adapter).toLowerCase() === normalizedAdapter
    && text(action?.adapter).toLowerCase() === normalizedAdapter
    && text(grant.actionId).toLowerCase() === actionId
    && text(binding.executionId).toLowerCase() === actionId
    && text(action?.actionId).toLowerCase() === actionId
    && text(grant.missionId).toLowerCase() === missionId
    && text(binding.missionId).toLowerCase() === missionId
    && text(action?.missionId).toLowerCase() === missionId
    && text(binding.grantId) === text(grant.grantId)
    && Number(binding.missionRevision) === Number(grant.missionRevision)
    && text(binding.repository).toLowerCase() === text(grant.repository).toLowerCase()
    && Number(binding.issueNumber) === Number(grant.issueNumber)
    && Number(binding.prNumber) === Number(grant.prNumber)
    && text(binding.branch) === text(grant.branch)
    && headSha === text(grant.headSha || grant.sourceRevision).toLowerCase()
    && SHA40.test(headSha)
    && SAFE_ID.test(text(binding.leaseKey));
  return valid
    ? Object.freeze({
        actionId,
        missionId,
        adapter: normalizedAdapter,
        executionId: text(binding.executionId).toLowerCase(),
        leaseKey: text(binding.leaseKey),
        headSha,
      })
    : null;
}

async function readExactResultEvent(eventPath, actionId) {
  let payload;
  try {
    payload = await readFile(eventPath, 'utf8');
  } catch {
    return null;
  }
  const eventId = `result-${actionId}`.slice(0, 128).toLowerCase();
  const matches = [];
  for (const line of payload.split('\n').filter(Boolean)) {
    let event;
    try { event = JSON.parse(line); }
    catch { return null; }
    if (text(event?.eventId).toLowerCase() === eventId) matches.push(event);
  }
  if (matches.length !== 1 || matches[0]?.eventType !== 'AGENT_RESULT_RECEIVED') return null;
  return matches[0];
}

function eventMatchesTerminal(event, identity, latestReceipt, state) {
  if (!event || text(event.missionId).toLowerCase() !== identity.missionId) return false;
  if (text(state?.dispatch?.adapter).toLowerCase() !== identity.adapter) return false;
  if (latestReceipt.state === 'completed') {
    return event.success === true
      && state?.dispatch?.status === 'complete'
      && text(event.resultId)
      && text(state?.dispatch?.resultId) === text(event.resultId);
  }
  if (latestReceipt.state === 'failed') {
    return event.success !== true
      && state?.dispatch?.status === 'failed'
      && text(state?.currentPhase).toUpperCase() === 'BLOCKED';
  }
  return false;
}

function recoveredQueueResult(identity, event, latestReceipt, state) {
  const success = latestReceipt.state === 'completed';
  return Object.freeze({
    schemaVersion: 'stephanos.mission-worker-consumption-result.v1',
    actionId: identity.actionId,
    missionId: identity.missionId,
    adapter: identity.adapter,
    stateRevision: Number(state?.revision) || 0,
    currentPhase: text(state?.currentPhase),
    execution: Object.freeze({
      success,
      commandOutputHash: text(event?.receipt?.commandOutputHash),
      completedAt: text(latestReceipt.timestampUtc),
    }),
    changedFiles: Object.freeze(Array.isArray(event?.changedFiles) ? [...event.changedFiles] : []),
    evidenceReceiptCount: 0,
    recoveredAfterInterruption: true,
    executionReceiptId: latestReceipt.receiptId,
    finalVerdict: success ? 'MISSION_WORKER_ITEM_COMPLETE' : 'MISSION_WORKER_ITEM_BLOCKED',
  });
}

function sameStringList(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => text(value) === text(right[index]));
}

function existingResultMatches(existing, identity, expected) {
  const existingReceiptId = text(existing?.executionReceiptId);
  const receiptCompatible = !existingReceiptId
    || existingReceiptId === text(expected.executionReceiptId);
  const recoveredFlagCompatible = existing?.recoveredAfterInterruption === undefined
    || typeof existing.recoveredAfterInterruption === 'boolean';
  return existing?.schemaVersion === 'stephanos.mission-worker-consumption-result.v1'
    && text(existing.actionId).toLowerCase() === identity.actionId
    && text(existing.missionId).toLowerCase() === identity.missionId
    && text(existing.adapter).toLowerCase() === identity.adapter
    && Number(existing.stateRevision) === Number(expected.stateRevision)
    && text(existing.currentPhase) === text(expected.currentPhase)
    && existing?.execution?.success === expected?.execution?.success
    && text(existing?.execution?.commandOutputHash) === text(expected?.execution?.commandOutputHash)
    && text(existing?.execution?.completedAt) === text(expected?.execution?.completedAt)
    && sameStringList(existing.changedFiles, expected.changedFiles)
    && Number(existing.evidenceReceiptCount) === Number(expected.evidenceReceiptCount)
    && recoveredFlagCompatible
    && receiptCompatible
    && existing.finalVerdict === expected.finalVerdict;
}

async function finalizeTerminalQueueItem(processingPath, paths, identity, result) {
  const success = result.execution.success === true;
  const targetRoot = success ? paths.completed : paths.failed;
  await mkdir(targetRoot, { recursive: true });
  const fileName = basename(processingPath);
  const targetPath = resolve(targetRoot, fileName);
  const resultPath = resolve(targetRoot, fileName.replace(/\.json$/, '.result.json'));

  let publication = await publishMissionWorkerResultAtomicallyV1(
    resultPath,
    result,
    {
      acceptExisting: (existing) => existingResultMatches(existing, identity, result),
    },
  );
  let quarantinedResultPath = '';
  if (publication?.ok !== true && publication?.reason === 'MISSION_WORKER_RESULT_EXISTING_INVALID') {
    const quarantine = await quarantineInvalidMissionWorkerResultV1(
      resultPath,
      publication.existingBytes,
    );
    if (quarantine?.ok !== true) {
      return Object.freeze({
        ok: false,
        reason: `TERMINAL_ORPHAN_RESULT_QUARANTINE_FAILED:${quarantine?.reason || 'unknown'}`,
      });
    }
    quarantinedResultPath = quarantine.quarantinePath;
    publication = await publishMissionWorkerResultAtomicallyV1(resultPath, result);
  }
  if (publication?.ok !== true) {
    return Object.freeze({
      ok: false,
      reason: publication?.reason === 'MISSION_WORKER_RESULT_EXISTING_CONFLICT'
        ? 'TERMINAL_ORPHAN_EXISTING_RESULT_CONFLICT'
        : `TERMINAL_ORPHAN_RESULT_PUBLICATION_FAILED:${publication?.reason || 'unknown'}`,
    });
  }

  try {
    await rename(processingPath, targetPath);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const [processingBytes, targetBytes] = await Promise.all([
      readFile(processingPath),
      readFile(targetPath),
    ]);
    if (missionWorkerQueueItemSha256(processingBytes) !== missionWorkerQueueItemSha256(targetBytes)) {
      return Object.freeze({ ok: false, reason: 'TERMINAL_ORPHAN_TARGET_QUEUE_CONFLICT' });
    }
    await unlink(processingPath);
  }

  return Object.freeze({
    ok: true,
    reason: 'TERMINAL_ORPHAN_QUEUE_FINALIZED',
    resultPath,
    targetPath,
    resultPublication: publication,
    quarantinedResultPath,
  });
}

export async function reconcileNextProviderNeutralTerminalOrphan(options = {}) {
  const queueRoot = options.queueRoot || resolveMissionWorkerQueueRoot(options.env || process.env);
  const sharedRoot = workspaceRoot(options);
  if (!queueRoot || !sharedRoot) {
    return Object.freeze({
      schemaVersion: PROVIDER_NEUTRAL_TERMINAL_ORPHAN_RECONCILIATION_SCHEMA,
      reconciled: false,
      reason: 'TERMINAL_ORPHAN_RUNTIME_ROOTS_REQUIRED',
    });
  }

  const adapters = Array.isArray(options.adapters)
    ? options.adapters.map((item) => text(item).toLowerCase()).filter((item) => ADAPTERS.includes(item))
    : [...ADAPTERS];
  const inspectOwnership = options.inspectClaimOwnership || inspectMissionWorkerClaimOwnership;
  const readReceiptHistory = options.readExecutionReceiptHistory || readExecutionReceiptHistory;
  const readMission = options.readMissionRecord || readMissionRecord;
  let hold = null;

  for (const adapter of adapters) {
    const paths = queuePaths(queueRoot, adapter);
    let entries = [];
    try {
      entries = (await readdir(paths.processing, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .sort((left, right) => left.name.localeCompare(right.name));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }

    for (const entry of entries) {
      const processingPath = resolve(paths.processing, entry.name);
      let bytes;
      let item;
      try {
        bytes = await readFile(processingPath);
        item = JSON.parse(bytes.toString('utf8'));
      } catch {
        hold ??= Object.freeze({ adapter, processingPath, reason: 'TERMINAL_ORPHAN_QUEUE_ITEM_INVALID' });
        continue;
      }
      const identity = exactQueueIdentity(item, adapter);
      if (!identity) {
        hold ??= Object.freeze({ adapter, processingPath, reason: 'TERMINAL_ORPHAN_QUEUE_IDENTITY_INVALID' });
        continue;
      }
      const digest = missionWorkerQueueItemSha256(bytes);
      const ownership = await inspectOwnership({
        queueRoot,
        adapter,
        actionId: identity.actionId,
        queueItemSha256: digest,
      }, options.claimOwnershipOptions || options);
      if (ownership?.state === 'alive' || ownership?.state === 'unknown') continue;
      if (!['dead', 'reused', 'missing'].includes(ownership?.state)) {
        hold ??= Object.freeze({
          adapter,
          actionId: identity.actionId,
          processingPath,
          reason: ownership?.reason || 'TERMINAL_ORPHAN_OWNER_UNPROVEN',
        });
        continue;
      }

      const history = await readReceiptHistory(sharedRoot, {
        executionId: identity.executionId,
        leaseKey: identity.leaseKey,
        expectedHead: identity.headSha,
      }, receiptOptions(options));
      const latest = history?.latestReceipt;
      if (history?.ok !== true || !latest || !['completed', 'failed'].includes(latest.state)) continue;

      let mission;
      try {
        mission = await readMission(identity.missionId, options);
      } catch {
        hold ??= Object.freeze({
          adapter,
          actionId: identity.actionId,
          processingPath,
          reason: 'TERMINAL_ORPHAN_MISSION_STATE_UNAVAILABLE',
        });
        continue;
      }
      const eventId = `result-${identity.actionId}`.slice(0, 128).toLowerCase();
      const processedIds = Array.isArray(mission?.state?.storeMetadata?.processedEventIds)
        ? mission.state.storeMetadata.processedEventIds.map((value) => text(value).toLowerCase())
        : [];
      if (!processedIds.includes(eventId)) {
        hold ??= Object.freeze({
          adapter,
          actionId: identity.actionId,
          processingPath,
          reason: 'TERMINAL_ORPHAN_RESULT_EVENT_NOT_COMMITTED',
        });
        continue;
      }
      const event = await readExactResultEvent(mission.eventPath, identity.actionId);
      if (!event || !eventMatchesTerminal(event, identity, latest, mission.state)) {
        hold ??= Object.freeze({
          adapter,
          actionId: identity.actionId,
          processingPath,
          reason: 'TERMINAL_ORPHAN_RESULT_LINEAGE_INVALID',
        });
        continue;
      }

      const acquireOwnership = options.acquireClaimOwnership || acquireMissionWorkerClaimOwnership;
      const claimOwnership = await acquireOwnership({
        queueRoot,
        adapter,
        actionId: identity.actionId,
        queueItemSha256: digest,
        acquiredAtUtc: options.now instanceof Date ? options.now.toISOString() : '',
      }, options.claimOwnershipOptions || options);
      if (claimOwnership?.acquired !== true) {
        hold ??= Object.freeze({
          adapter,
          actionId: identity.actionId,
          processingPath,
          reason: claimOwnership?.reason || 'TERMINAL_ORPHAN_CLAIM_OWNERSHIP_NOT_ACQUIRED',
        });
        continue;
      }

      try {
        let currentBytes;
        try {
          currentBytes = await readFile(processingPath);
        } catch {
          hold ??= Object.freeze({
            adapter,
            actionId: identity.actionId,
            processingPath,
            reason: 'TERMINAL_ORPHAN_QUEUE_ITEM_DISAPPEARED_AFTER_OWNERSHIP',
          });
          continue;
        }
        if (missionWorkerQueueItemSha256(currentBytes) !== digest) {
          hold ??= Object.freeze({
            adapter,
            actionId: identity.actionId,
            processingPath,
            reason: 'TERMINAL_ORPHAN_QUEUE_IDENTITY_CHANGED_AFTER_OWNERSHIP',
          });
          continue;
        }

        const result = recoveredQueueResult(identity, event, latest, mission.state);
        let terminalCheckpointCleanup = null;
        if (latest.state === 'completed') {
          const retireTerminalCheckpoint = options.retireTerminalMutationCheckpoint
            || retireProviderNeutralTerminalMutationCheckpointV1;
          terminalCheckpointCleanup = await retireTerminalCheckpoint({
            missionId: identity.missionId,
            actionId: identity.actionId,
            expectedPatchSha256: text(event?.receipt?.commandOutputHash).toLowerCase(),
          }, options);
        }
        const finalized = await finalizeTerminalQueueItem(processingPath, paths, identity, result);
        if (!finalized.ok) {
          hold ??= Object.freeze({
            adapter,
            actionId: identity.actionId,
            processingPath,
            reason: finalized.reason,
          });
          continue;
        }
        return Object.freeze({
          schemaVersion: PROVIDER_NEUTRAL_TERMINAL_ORPHAN_RECONCILIATION_SCHEMA,
          reconciled: true,
          adapter,
          missionId: identity.missionId,
          actionId: identity.actionId,
          receiptId: latest.receiptId,
          receiptState: latest.state,
          ownershipState: ownership?.state || '',
          result,
          resultPath: finalized.resultPath,
          targetPath: finalized.targetPath,
          resultPublication: finalized.resultPublication,
          quarantinedResultPath: finalized.quarantinedResultPath,
          terminalCheckpointCleanup,
          providerReexecutionAllowed: false,
          finalVerdict: 'PROVIDER_NEUTRAL_TERMINAL_ORPHAN_RECONCILED',
        });
      } finally {
        if (claimOwnership?.release) await claimOwnership.release();
      }
    }
  }

  return Object.freeze({
    schemaVersion: PROVIDER_NEUTRAL_TERMINAL_ORPHAN_RECONCILIATION_SCHEMA,
    reconciled: false,
    reason: hold?.reason || 'TERMINAL_ORPHAN_NONE',
    hold,
    providerReexecutionAllowed: false,
  });
}
