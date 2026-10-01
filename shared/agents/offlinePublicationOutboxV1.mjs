import { createHash } from 'node:crypto';

import {
  SOURCE_ARTIFACT_ESCROW_V1_SCHEMA,
  validateSourceArtifactEscrowV1,
} from './sourceArtifactEscrowContinuityV1.mjs';

export const OFFLINE_PUBLICATION_OUTBOX_V1_SCHEMA = 'stephanos.offline-publication-outbox.v1';
export const OFFLINE_PUBLICATION_OUTBOX_STATE = 'PENDING_PUBLICATION';

function text(value) {
  return String(value ?? '').trim();
}

function digest(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

export function buildOfflinePublicationOutboxRecordV1(escrow = {}, options = {}) {
  const nowUtc = text(options.nowUtc || new Date().toISOString());
  const validation = validateSourceArtifactEscrowV1(escrow, nowUtc);
  if (!validation.valid || escrow.schemaVersion !== SOURCE_ARTIFACT_ESCROW_V1_SCHEMA) {
    return Object.freeze({ ok: false, reason: 'OFFLINE_PUBLICATION_ESCROW_INVALID' });
  }

  const outboxId = 'offline-publication-' + digest(
    escrow.completeArtifactSha256 + '\n' + escrow.missionId + '\n' + escrow.actionId,
  ).slice(0, 24);
  const record = Object.freeze({
    schemaVersion: OFFLINE_PUBLICATION_OUTBOX_V1_SCHEMA,
    outboxId,
    state: OFFLINE_PUBLICATION_OUTBOX_STATE,
    repository: escrow.repository,
    missionId: escrow.missionId,
    actionId: escrow.actionId,
    canonicalIssue: escrow.canonicalIssue || null,
    canonicalPr: escrow.canonicalPr ?? null,
    canonicalBranch: escrow.canonicalBranch,
    exactParentHead: escrow.exactParentHead,
    exactParentTree: escrow.exactParentTree,
    exactResultTree: escrow.exactResultTree,
    completeArtifactSha256: escrow.completeArtifactSha256,
    artifactRef: escrow.artifactRef,
    executorIdentity: escrow.executorIdentity,
    changedFiles: escrow.changedFiles,
    testsRun: escrow.testsRun,
    testVerdicts: escrow.testVerdicts,
    diffCheckVerdict: escrow.diffCheckVerdict,
    queuedAtUtc: nowUtc,
    publicationPaused: true,
    preserveVerifiedArtifact: true,
    rebuildRequired: false,
    duplicateBranchAllowed: false,
    duplicatePullRequestAllowed: false,
    pushAuthority: false,
    mergeAuthority: false,
    deploymentAuthority: false,
    exactNextAction: 'When a governed publication route is healthy, publish this preserved exact artifact through Source Publication Continuity without rebuilding it.',
    finalVerdict: 'OFFLINE_PUBLICATION_ARTIFACT_QUEUED',
  });

  return Object.freeze({ ok: true, reason: 'OFFLINE_PUBLICATION_ARTIFACT_QUEUED', record });
}
