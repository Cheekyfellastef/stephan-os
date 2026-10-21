import { CANONICAL_MAILBOX_ISSUE } from './canonicalMailboxAuthorityV1.mjs';
import {
  MAILBOX_RECEIPT_INDEX_GITHUB_MARKER,
  MAILBOX_RECEIPT_INDEX_SCHEMA_VERSION,
  buildMailboxReceiptIndexGitHubBody,
  createMailboxReceiptIndexRecord,
  sanitizeMailboxReceiptForIndex,
} from './mailboxReceiptIndex.mjs';

export const MAILBOX_RECEIPT_GITHUB_COMMAND_MARKER = 'stephanos-battle-bridge-command';
export const MAILBOX_RECEIPT_GITHUB_RECEIPT_MARKER = 'stephanos-battle-bridge-command-receipt';
export const MAILBOX_RECEIPT_GITHUB_REPOSITORY = 'Cheekyfellastef/stephan-os';
export const MAILBOX_RECEIPT_GITHUB_ISSUE = CANONICAL_MAILBOX_ISSUE;
export const MAILBOX_RECEIPT_GITHUB_INDEX_AUTHOR = 'github-actions[bot]';
export const MAILBOX_RECEIPT_GITHUB_TRUTH_ISSUE = 1575;
export const MAILBOX_RECEIPT_GITHUB_TRUTH_TITLE = 'Telemetry: Battle Bridge mailbox receipt truth';
export const MAILBOX_RECEIPT_GITHUB_TRUTH_MARKER = 'stephanos-battle-bridge-receipt-index-truth';

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

// The small public truth issue is the only carry-forward input. Never scan
// all 2,500 retired mailbox comments on each successor receipt mirror refresh.
// Preserve bounded terminal provenance, not unfinished retired commands.
export function extractRetiredMailboxTerminalReceiptsFromTruthIssueBody(body) {
  if (typeof body !== 'string' || Buffer.byteLength(body, 'utf8') > 16 * 1024
    || !body.startsWith(`<!-- ${MAILBOX_RECEIPT_GITHUB_TRUTH_MARKER} -->`)) {
    throw new Error('RETIRED_MAILBOX_RECEIPT_TRUTH_UNVERIFIED');
  }
  const match = body.match(/```json\s*([\s\S]*?)```/i);
  const value = match ? parseJson(match[1]) : null;
  if (value?.schemaVersion !== MAILBOX_RECEIPT_INDEX_SCHEMA_VERSION
    || !Array.isArray(value.recentReceipts)
    || value.recentReceipts.length > 20) {
    throw new Error('RETIRED_MAILBOX_RECEIPT_TRUTH_UNVERIFIED');
  }
  return Object.freeze(value.recentReceipts
    .map(sanitizeMailboxReceiptForIndex)
    .filter((receipt) => receipt && ['DONE', 'BLOCKED'].includes(receipt.state)));
}

export function createTrustedMailboxReceiptIndexFromGitHubComments(comments = [], {
  ownerLogin,
  timestampUtc = new Date().toISOString(),
  priorTruthIssueBody,
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
  const previousTerminal = priorTruthIssueBody === undefined ? []
    : extractRetiredMailboxTerminalReceiptsFromTruthIssueBody(priorTruthIssueBody);
  return createMailboxReceiptIndexRecord({
    receipts: [...receipts, ...previousTerminal],
    timestampUtc,
  });
}

export function findTrustedMailboxReceiptIndexComment(comments = []) {
  return comments.find((comment) => comment?.user?.login === MAILBOX_RECEIPT_GITHUB_INDEX_AUTHOR
    && String(comment?.body || '').includes(`<!-- ${MAILBOX_RECEIPT_INDEX_GITHUB_MARKER} -->`)) || null;
}

export function buildTrustedMailboxReceiptIndexGitHubBody(record = {}) {
  return buildMailboxReceiptIndexGitHubBody(record);
}

export function buildTrustedMailboxReceiptTruthIssueBody(record = {}) {
  return buildMailboxReceiptIndexGitHubBody(record).replace(
    `<!-- ${MAILBOX_RECEIPT_INDEX_GITHUB_MARKER} -->`,
    `<!-- ${MAILBOX_RECEIPT_GITHUB_TRUTH_MARKER} -->`,
  );
}
