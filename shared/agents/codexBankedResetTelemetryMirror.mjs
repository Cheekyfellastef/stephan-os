export const CODEX_BANKED_RESET_TELEMETRY_SCHEMA_VERSION = 'stephanos.codex-banked-reset-telemetry.v1';
export const CODEX_BANKED_RESET_TELEMETRY_MARKER = 'stephanos-codex-banked-reset-telemetry';
export const CODEX_BANKED_RESET_TELEMETRY_ISSUE = 1570;
export const CODEX_BANKED_RESET_MAILBOX_ISSUE = 1507;
export const CODEX_BANKED_RESET_REPOSITORY = 'Cheekyfellastef/stephan-os';
export const CODEX_BANKED_RESET_STATUS_OPERATION = 'READ_CODEX_BANKED_RESET_STATUS';
export const CODEX_BANKED_RESET_OPERATION = 'REDEEM_BANKED_CODEX_RATE_LIMIT_RESET';

const RECEIPT_MARKER = 'stephanos-battle-bridge-command-receipt';
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,120}$/;
const RESET_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,120}$/;
const SAFE_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/:\-]{0,239}$/;
const SECRET_PATTERN = /secret|token|session|password|credential|private[_-]?key|api[_-]?key|cookie|\.env\b|BEGIN (RSA |OPENSSH |EC |DSA )?PRIVATE KEY/i;
const ALLOWED_OPERATIONS = new Set([CODEX_BANKED_RESET_STATUS_OPERATION, CODEX_BANKED_RESET_OPERATION]);

function safeText(value, limit = 300) {
  const text = String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text || SECRET_PATTERN.test(text)) return '';
  return text.slice(0, limit);
}

function safeTimestamp(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
}

function safeCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function safeTextList(value, { limit = 12, itemLimit = 220 } = {}) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => safeText(item, itemLimit)).filter(Boolean))].slice(0, limit)
    : [];
}

function safeProofRefs(value) {
  return Array.isArray(value)
    ? [...new Set(value.map(String).filter((ref) => SAFE_REF_PATTERN.test(ref) && !ref.includes('..') && !SECRET_PATTERN.test(ref)))].slice(0, 20)
    : [];
}

function parseReceiptBody(body = '') {
  const text = String(body || '');
  if (!text.includes(`<!-- ${RECEIPT_MARKER} -->`)) return null;
  const match = text.match(/```json\s*([\s\S]*?)```/i);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}

function receiptTime(receipt = {}) {
  return Date.parse(receipt.completedAt || receipt.heartbeatAt || receipt.acceptedAt || '') || 0;
}

export function extractTrustedCodexResetReceipt(comment = {}, { ownerLogin = '' } = {}) {
  if (!ownerLogin || comment?.user?.login !== ownerLogin) return null;
  const receipt = parseReceiptBody(comment?.body);
  if (!receipt
    || receipt.schemaVersion !== 'stephanos.battle-bridge-github-command-receipt.v1'
    || receipt.repository !== CODEX_BANKED_RESET_REPOSITORY
    || Number(receipt.issueNumber) !== CODEX_BANKED_RESET_MAILBOX_ISSUE
    || receipt.branch !== 'main'
    || !REQUEST_ID_PATTERN.test(String(receipt.requestId || ''))
    || !ALLOWED_OPERATIONS.has(String(receipt.operation || ''))) return null;
  return receipt;
}

function operationResult(receipt = {}) {
  return receipt?.result?.result && typeof receipt.result.result === 'object' ? receipt.result.result : {};
}

export function projectCodexResetStatusReceipt(receipt = {}) {
  const result = operationResult(receipt);
  const pressAttempted = result.pressAttempted === true;
  const pressCount = safeCount(result.pressCount);
  return Object.freeze({
    requestId: safeText(receipt.requestId, 120),
    state: safeText(receipt.state, 40).toUpperCase(),
    acceptedAt: safeTimestamp(receipt.acceptedAt),
    completedAt: safeTimestamp(receipt.completedAt),
    observedAtUtc: safeTimestamp(result.observedAtUtc),
    matchedWindow: safeText(result.matchedWindow, 160),
    matchedProfileControl: safeText(result.matchedProfileControl, 120),
    matchedUsageControl: safeText(result.matchedUsageControl, 160),
    matchedUsageLabel: safeText(result.matchedUsageLabel, 160),
    usageControlResolution: safeText(result.usageControlResolution, 80),
    navigationAttempted: result.navigationAttempted === true,
    profileMenuOpened: result.profileMenuOpened === true,
    usagePanelOpened: result.usagePanelOpened === true,
    profileCandidates: safeTextList(result.profileCandidates, { limit: 10, itemLimit: 120 }),
    usageCandidates: safeTextList(result.usageCandidates, { limit: 10, itemLimit: 120 }),
    usageLabelCandidates: safeTextList(result.usageLabelCandidates, { limit: 10, itemLimit: 120 }),
    meterSummary: safeText(result.meterSummary, 300),
    expiryTexts: safeTextList(result.expiryTexts),
    resetButtons: safeTextList(result.resetButtons, { itemLimit: 120 }),
    activeCodexTask: result.activeCodexTask === true,
    desktopInteractive: result.desktopInteractive === true,
    appWindowFound: result.appWindowFound === true,
    usageSurfaceMatched: result.usageSurfaceMatched === true,
    readOnly: true,
    pressAttempted,
    pressCount,
    blocker: safeText(receipt.blocker || result.blocker, 160).toUpperCase(),
    finalVerdict: safeText(result.finalVerdict || receipt.finalVerdict || receipt?.result?.verdict, 160).toUpperCase(),
    proofRefs: safeProofRefs([...(receipt.proofRefs || []), ...(result.proofRefs || [])]),
  });
}

export function projectCodexResetExecutionReceipt(receipt = {}) {
  const result = operationResult(receipt);
  const pressAttempted = result.pressAttempted === true;
  const pressCount = safeCount(result.pressCount);
  const meterRestored = result.meterRestored === true;
  const resetControlDisappeared = result.resetControlDisappeared === true;
  const meterBefore = safeText(result.meterBefore, 200);
  const meterAfter = safeText(result.meterAfter, 200);
  const confirmationEvidencePresent = result.confirmationEvidencePresent === true
    || (Boolean(meterBefore) && (Boolean(meterAfter) || resetControlDisappeared));
  const confirmed = result.ok === true
    && result.finalVerdict === 'CODEX_BANKED_RESET_CONFIRMED'
    && pressAttempted
    && pressCount === 1
    && meterRestored
    && confirmationEvidencePresent;
  const status = confirmed
    ? 'CONFIRMED'
    : (pressAttempted || pressCount > 0 ? 'ATTEMPTED_NOT_CONFIRMED' : 'NOT_ATTEMPTED');
  return Object.freeze({
    status,
    requestId: safeText(receipt.requestId, 120),
    resetId: RESET_ID_PATTERN.test(String(receipt.resetId || result.resetId || '')) ? String(receipt.resetId || result.resetId) : '',
    resetExpiresAtUtc: safeTimestamp(receipt.resetExpiresAtUtc || result.resetExpiresAtUtc),
    latestSafeExecutionUtc: safeTimestamp(receipt.latestSafeExecutionUtc),
    state: safeText(receipt.state, 40).toUpperCase(),
    acceptedAt: safeTimestamp(receipt.acceptedAt),
    completedAt: safeTimestamp(receipt.completedAt || result.completedAtUtc),
    observedAtUtc: safeTimestamp(result.observedAtUtc),
    matchedWindow: safeText(result.matchedWindow, 160),
    matchedProfileControl: safeText(result.matchedProfileControl, 120),
    matchedUsageControl: safeText(result.matchedUsageControl, 160),
    matchedUsageLabel: safeText(result.matchedUsageLabel, 160),
    usageControlResolution: safeText(result.usageControlResolution, 80),
    navigationAttempted: result.navigationAttempted === true,
    profileMenuOpened: result.profileMenuOpened === true,
    usagePanelOpened: result.usagePanelOpened === true,
    matchedButton: safeText(result.matchedButton, 120),
    matchedExpiryText: safeText(result.matchedExpiryText, 160),
    meterBefore,
    meterAfter,
    pressAttempted,
    pressCount,
    meterRestored,
    resetControlDisappeared,
    confirmationEvidencePresent,
    desktopInteractive: result.desktopInteractive === true,
    appWindowFound: result.appWindowFound === true,
    usageSurfaceMatched: result.usageSurfaceMatched === true,
    fixedUiActionOnly: receipt.fixedUiActionOnly === true || result.fixedUiActionOnly === true,
    singlePressOnly: receipt.singlePressOnly === true || result.singlePressOnly === true,
    repeatedPressAllowed: false,
    blocker: safeText(receipt.blocker || result.blocker, 160).toUpperCase(),
    finalVerdict: safeText(result.finalVerdict || receipt.finalVerdict || receipt?.result?.verdict, 160).toUpperCase(),
    proofRefs: safeProofRefs([...(receipt.proofRefs || []), ...(result.proofRefs || [])]),
  });
}

export function createCodexBankedResetTelemetryRecord(comments = [], {
  ownerLogin = '',
  timestampUtc = new Date().toISOString(),
} = {}) {
  const receipts = comments
    .map((comment) => extractTrustedCodexResetReceipt(comment, { ownerLogin }))
    .filter(Boolean)
    .sort((a, b) => receiptTime(b) - receiptTime(a));
  const statusReceipt = receipts.find((receipt) => receipt.operation === CODEX_BANKED_RESET_STATUS_OPERATION) || null;
  const executionReceipt = receipts.find((receipt) => receipt.operation === CODEX_BANKED_RESET_OPERATION) || null;
  const latestStatus = statusReceipt ? projectCodexResetStatusReceipt(statusReceipt) : null;
  const latestExecution = executionReceipt ? projectCodexResetExecutionReceipt(executionReceipt) : null;
  const status = latestExecution?.status || (latestStatus ? 'STATUS_READY' : 'UNKNOWN');
  return Object.freeze({
    schemaVersion: CODEX_BANKED_RESET_TELEMETRY_SCHEMA_VERSION,
    repository: CODEX_BANKED_RESET_REPOSITORY,
    mailboxIssueNumber: CODEX_BANKED_RESET_MAILBOX_ISSUE,
    telemetryIssueNumber: CODEX_BANKED_RESET_TELEMETRY_ISSUE,
    updatedAtUtc: safeTimestamp(timestampUtc) || new Date(0).toISOString(),
    status,
    pressAttempted: latestExecution?.pressAttempted === true,
    pressCount: latestExecution?.pressCount || 0,
    meterRestored: latestExecution?.meterRestored === true,
    resetControlDisappeared: latestExecution?.resetControlDisappeared === true,
    confirmationEvidencePresent: latestExecution?.confirmationEvidencePresent === true,
    blocker: latestExecution?.blocker || latestStatus?.blocker || (status === 'UNKNOWN' ? 'NO_TRUSTED_RESET_RECEIPT' : ''),
    finalVerdict: latestExecution?.finalVerdict || latestStatus?.finalVerdict || 'CODEX_BANKED_RESET_TELEMETRY_UNKNOWN',
    latestStatus,
    latestExecution,
    arbitraryShellAllowed: false,
    arbitraryBrowserAutomationAllowed: false,
    credentialsMayBeReadOrExported: false,
    repeatedPressAllowed: false,
  });
}

export function buildCodexBankedResetTelemetryIssueBody(record = {}) {
  const payload = JSON.stringify(record, null, 2);
  return [
    `<!-- ${CODEX_BANKED_RESET_TELEMETRY_MARKER} -->`,
    '',
    '# Codex banked reset live telemetry',
    '',
    'Canonical compact projection of trusted Battle Bridge status and reset-execution receipts. The raw durable receipt remains in the Shared Workspace mailbox receipt store.',
    '',
    '```json',
    payload,
    '```',
    '',
    'Completion requires `status: CONFIRMED`, exactly one attempted press, restored-meter evidence, and no retry.',
  ].join('\n');
}
