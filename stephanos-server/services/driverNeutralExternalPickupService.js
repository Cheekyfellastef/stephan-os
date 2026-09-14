import { claimNextMissionWorkerItem } from './missionOrchestratorWorkerConsumer.js';
import { createSharedWorkspaceHandoffRecord, writeAtomicJson } from '../../shared/agents/sharedAgentWorkspaceStore.mjs';

export const DRIVER_NEUTRAL_EXTERNAL_PICKUP_SCHEMA = 'stephanos.driver-neutral-external-pickup.v1';
const EXTERNAL_ADAPTERS = Object.freeze(['chatgpt-github', 'foundry-forge']);

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function workspaceRoot(options = {}) {
  return text(options.sharedWorkspaceRoot || options.env?.STEPHANOS_SHARED_AGENT_WORKSPACE || process.env.STEPHANOS_SHARED_AGENT_WORKSPACE);
}

export async function claimDriverNeutralExternalConstruction(options = {}) {
  const claimNext = options.claimNext ?? claimNextMissionWorkerItem;
  const writeHandoff = options.writeHandoff ?? writeAtomicJson;
  let claim = null;
  for (const adapter of EXTERNAL_ADAPTERS) {
    claim = await claimNext(adapter, options);
    if (claim) break;
  }
  if (!claim) {
    return Object.freeze({ schemaVersion: DRIVER_NEUTRAL_EXTERNAL_PICKUP_SCHEMA, ok: true, claimed: false, classification: 'NO_EXTERNAL_CONSTRUCTION_READY', mergeAuthority: false, runtimeMutationAuthority: false });
  }

  const action = claim.item?.payload || claim.item || {};
  const missionId = text(action.missionId || claim.item?.missionId).toLowerCase();
  const actionId = text(action.actionId || claim.item?.actionId).toLowerCase();
  if (!missionId || !actionId || !EXTERNAL_ADAPTERS.includes(claim.adapter)) throw new Error('DRIVER_NEUTRAL_EXTERNAL_PICKUP_IDENTITY_INVALID');

  const root = workspaceRoot(options);
  if (!root) throw new Error('DRIVER_NEUTRAL_EXTERNAL_PICKUP_WORKSPACE_REQUIRED');

  const handoff = createSharedWorkspaceHandoffRecord({
    handoffId: `driver-pickup-${actionId}`.slice(0, 120),
    participantId: 'mission-worker',
    fromParticipantId: 'mission-worker',
    toParticipantId: 'driver-neutral-builder',
    timestampUtc: options.now instanceof Date ? options.now.toISOString() : new Date().toISOString(),
    correlationId: missionId,
    relatedIssue: action.issueNumber ? `#${action.issueNumber}` : '',
    relatedPr: action.prNumber ? `#${action.prNumber}` : '',
    proofRefs: Array.isArray(action.capacityProofRefs) ? action.capacityProofRefs : [],
    summary: `${claim.adapter} construction item claimed through the canonical Mission Worker queue.`,
    body: JSON.stringify({ schemaVersion: DRIVER_NEUTRAL_EXTERNAL_PICKUP_SCHEMA, missionId, actionId, adapter: claim.adapter, repository: text(action.repository), branch: text(action.branch), headSha: text(action.headSha).toLowerCase(), allowedFiles: Array.isArray(action.allowedFiles) ? action.allowedFiles : [], requiredTests: Array.isArray(action.requiredTests) ? action.requiredTests : [], requiredEvidence: Array.isArray(action.requiredEvidence) ? action.requiredEvidence : [], queueProcessingPath: text(claim.processingPath), claimState: 'CLAIMED', oneWriterRequired: true, mergeAuthority: false, runtimeMutationAuthority: false, leaseSeizureAllowed: false }),
  });

  const write = await writeHandoff(root, ['handoffs', 'driver-neutral-pickup', `${actionId}.json`], handoff, { repoRoot: options.repoRoot, nowMs: Date.parse(handoff.timestampUtc) });
  if (write?.ok !== true) throw new Error(`DRIVER_NEUTRAL_EXTERNAL_PICKUP_PUBLICATION_FAILED:${write?.reason || 'unknown'}`);

  return Object.freeze({ schemaVersion: DRIVER_NEUTRAL_EXTERNAL_PICKUP_SCHEMA, ok: true, claimed: true, classification: 'EXTERNAL_CONSTRUCTION_CLAIMED', missionId, actionId, adapter: claim.adapter, handoffPath: write.path || '', mergeAuthority: false, runtimeMutationAuthority: false });
}
