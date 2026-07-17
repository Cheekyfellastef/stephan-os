import {
  MAILBOX_RECEIPT_INDEX_GITHUB_MARKER,
  buildMailboxReceiptIndexGitHubBody,
  createMailboxReceiptIndexRecord,
  sanitizeMailboxReceiptForIndex,
} from './mailboxReceiptIndex.mjs';

export const MAILBOX_RECEIPT_GITHUB_COMMAND_MARKER = 'stephanos-battle-bridge-command';
export const MAILBOX_RECEIPT_GITHUB_RECEIPT_MARKER = 'stephanos-battle-bridge-command-receipt';
export const MAILBOX_RECEIPT_GITHUB_REPOSITORY = 'Cheekyfellastef/stephan-os';
export const MAILBOX_RECEIPT_GITHUB_ISSUE = 1507;
export const MAILBOX_RECEIPT_GITHUB_INDEX_AUTHOR = 'github-actions[bot]';

const COMMAND_SCHEMA = 'stephanos.battle-bridge-github-command.v1';
const RECEIPT_SCHEMA = 'stephanos.battle-bridge-github-command-receipt.v1';
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,120}$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/i;

function parseJson(text) {
  try { return JSON.parse(String(text || '').trim()); } catch { return null; }
}

function validIdentity(record, schemaVersion) {
  return record?.schemaVersion === schemaVersion
    && record?.repository === MAILBOX_RECEIPT_GITHUB_REPOSITORY
    && Number(record?.issueNumber) === MAILBOX_RECEIPT_GITHUB_ISSUE
    && record?.branch === 'main'
    && REQUEST_ID_PATTERN.test(String(record?.requestId || ''));
}

export function extractTrustedMailboxCommandComment(comment = {}, ownerLogin = '') {
  if (!ownerLogin || comment?.user?.login !== ownerLogin) return null;
  const body = String(comment?.body || '');
  const match = body.match(/```stephanos-battle-bridge-command\s*([\s\S]*?)```/i);
  if (!match) return null;
  const command = parseJson(match[1]);
  if (!validIdentity(command, COMMAND_SCHEMA)) return null;
  const expectedHead = String(command.expectedHead || '').trim().toLowerCase();
  return Object.freeze({
    requestId: String(command.requestId),
    expectedHead: SHA_PATTERN.test(expectedHead) ? expectedHead : '',
  });
}

export function extractTrustedMailboxReceiptComment(comment = {}, ownerLogin = '') {
  if (!ownerLogin || comment?.user?.login !== ownerLogin) return null;
  const body = String(comment?.body || '');
  if (!body.includes(`<!-- ${MAILBOX_RECEIPT_GITHUB_RECEIPT_MARKER} -->`)) return null;
  const match = body.match(/```json\s*([\s\S]*?)```/i);
  if (!match) return null;
  const receipt = parseJson(match[1]);
  if (!validIdentity(receipt, RECEIPT_SCHEMA)) return null;
  return sanitizeMailboxReceiptForIndex(receipt) ? receipt : null;
}

export function createTrustedMailboxReceiptIndexFromGitHubComments(comments = [], {
  ownerLogin,
  timestampUtc = new Date().toISOString(),
} = {}) {
  const commandsByRequestId = new Map();
  for (const comment of comments) {
    const command = extractTrustedMailboxCommandComment(comment, ownerLogin);
    if (command) commandsByRequestId.set(command.requestId, command);
  }
  const receipts = [];
  for (const comment of comments) {
    const receipt = extractTrustedMailboxReceiptComment(comment, ownerLogin);
    if (!receipt) continue;
    const command = commandsByRequestId.get(String(receipt.requestId));
    receipts.push({
      ...receipt,
      expectedHead: String(receipt.expectedHead || command?.expectedHead || ''),
    });
  }
  return createMailboxReceiptIndexRecord({ receipts, timestampUtc });
}

export function findTrustedMailboxReceiptIndexComment(comments = []) {
  return comments.find((comment) => comment?.user?.login === MAILBOX_RECEIPT_GITHUB_INDEX_AUTHOR
    && String(comment?.body || '').includes(`<!-- ${MAILBOX_RECEIPT_INDEX_GITHUB_MARKER} -->`)) || null;
}

export function buildTrustedMailboxReceiptIndexGitHubBody(record = {}) {
  return buildMailboxReceiptIndexGitHubBody(record);
}
