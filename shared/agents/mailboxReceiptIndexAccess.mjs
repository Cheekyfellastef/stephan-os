import { readMailboxReceiptIndex } from './mailboxReceiptIndex.mjs';

export const MAILBOX_RECEIPT_INDEX_ACCESS_SCHEMA_VERSION = 'stephanos.mailbox-receipt-index-access.v1';
export const MAILBOX_RECEIPT_INDEX_ACCESS_POLICY = Object.freeze({
  authenticationRequired: true,
  participantIdRequired: true,
  fixedSharedWorkspaceRecord: 'status/battle-bridge-mailbox-receipt-index.json',
  arbitraryFilesystemAccess: false,
  arbitraryPathInputAllowed: false,
  commandExecutionAccess: false,
  sourceMutationAccess: false,
  mergeAuthority: false,
});

const SAFE_PARTICIPANT_ID = /^[a-z0-9][a-z0-9._-]{1,80}$/i;

export async function readMailboxReceiptIndexForParticipant({
  participantId,
  authenticated = false,
  root,
  repoRoot,
} = {}) {
  const normalizedParticipantId = String(participantId || '').trim();
  if (authenticated !== true) {
    return Object.freeze({
      ok: false,
      blocker: 'MAILBOX_RECEIPT_INDEX_AUTHENTICATION_REQUIRED',
      finalVerdict: 'MAILBOX_RECEIPT_INDEX_ACCESS_BLOCKED',
      accessPolicy: MAILBOX_RECEIPT_INDEX_ACCESS_POLICY,
    });
  }
  if (!SAFE_PARTICIPANT_ID.test(normalizedParticipantId)) {
    return Object.freeze({
      ok: false,
      blocker: 'MAILBOX_RECEIPT_INDEX_PARTICIPANT_ID_INVALID',
      finalVerdict: 'MAILBOX_RECEIPT_INDEX_ACCESS_BLOCKED',
      accessPolicy: MAILBOX_RECEIPT_INDEX_ACCESS_POLICY,
    });
  }
  const read = await readMailboxReceiptIndex({ root, repoRoot });
  if (!read.ok) {
    return Object.freeze({
      ...read,
      requestedByParticipantId: normalizedParticipantId,
      accessPolicy: MAILBOX_RECEIPT_INDEX_ACCESS_POLICY,
    });
  }
  return Object.freeze({
    schemaVersion: MAILBOX_RECEIPT_INDEX_ACCESS_SCHEMA_VERSION,
    ok: true,
    blocker: '',
    finalVerdict: 'MAILBOX_RECEIPT_INDEX_ACCESS_READY',
    requestedByParticipantId: normalizedParticipantId,
    projection: read.projection,
    accessPolicy: MAILBOX_RECEIPT_INDEX_ACCESS_POLICY,
  });
}
