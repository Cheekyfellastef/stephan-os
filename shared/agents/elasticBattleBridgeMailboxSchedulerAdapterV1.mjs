import { selectBattleBridgeGitHubCommandBatch } from './battleBridgeGitHubCommandMailbox.mjs';
import { deriveMailboxCapacityEvidenceFromScheduler } from './elasticBattleBridgeMailboxSchedulerEvidenceV1.mjs';
import { deriveElasticMailboxResourceEvidence } from './elasticBattleBridgeMailboxResourceEvidenceV1.mjs';

function intersects(resources = [], occupied = new Set()) {
  return resources.some((resource) => occupied.has(resource));
}

export function selectElasticBattleBridgeMailboxBatchFromScheduler(comments = [], {
  schedulerCapacity = null,
  schedulerSnapshot = null,
  currentHead = '',
  now = new Date(),
  staleAfterMs = 5 * 60 * 1000,
  consumedRequestIds = new Set(),
  ...legacyOptions
} = {}) {
  const observedAtUtc = schedulerSnapshot?.observedAtUtc || '';
  const schedulerHead = schedulerSnapshot?.sourceHead || '';
  const capacity = deriveMailboxCapacityEvidenceFromScheduler({
    schedulerCapacity,
    schedulerHead,
    currentHead,
    observedAtUtc,
    now,
    staleAfterMs,
  });
  const resources = deriveElasticMailboxResourceEvidence({
    schedulerSnapshot,
    currentHead,
    now,
    staleAfterMs,
  });

  if (!resources.ok) {
    return selectBattleBridgeGitHubCommandBatch(comments, {
      ...legacyOptions,
      maxBatch: 1,
      now,
      consumedRequestIds,
    });
  }

  const occupied = new Set(resources.activeResourceIds);
  const metadata = Object.create(null);
  for (const [requestId, claim] of Object.entries(resources.commandMetadata)) {
    metadata[requestId] = Object.freeze({
      ...claim,
      blocked: claim.blocked === true || intersects(claim.resources, occupied),
    });
  }

  const capacityEvidence = capacity.ok
    ? capacity
    : Object.freeze({
      ok: false,
      exactSourceBound: false,
      provenWidth: 1,
      observedAtUtc,
    });

  return selectBattleBridgeGitHubCommandBatch(comments, {
    ...legacyOptions,
    now,
    consumedRequestIds,
    elasticCapacityEvidence: capacityEvidence,
    elasticCapacityStaleAfterMs: staleAfterMs,
    elasticCommandMetadata: Object.freeze(metadata),
  });
}
