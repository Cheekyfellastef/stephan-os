import { createHash } from 'node:crypto';

const WINDOWS_SAFE_REQUEST_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{7,120}$/;
const WINDOWS_RESERVED_DEVICE_BASENAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const LEGACY_FALLBACK_REQUEST_ID_NAMESPACE = /^request-[0-9a-f]{32}$/;
const LEGACY_WINDOWS_SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{7,120}$/;

function receiptFilenameDigest(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}

export function createWindowsSafeMailboxReceiptFilename(requestId = '') {
  const value = String(requestId || '');
  if (
    WINDOWS_SAFE_REQUEST_ID_PATTERN.test(value)
    && !WINDOWS_RESERVED_DEVICE_BASENAME.test(value)
    && !LEGACY_FALLBACK_REQUEST_ID_NAMESPACE.test(value)
  ) {
    return `${value}.json`;
  }
  return `_request-${receiptFilenameDigest(value)}.json`;
}

// The mailbox has had two source-controlled filename writers. Keep their exact
// mappings as bounded read-only compatibility candidates; new writes must only
// use createWindowsSafeMailboxReceiptFilename().
function createLegacyMailboxReceiptFilenameV0(requestId = '') {
  const value = String(requestId || '');
  if (LEGACY_WINDOWS_SAFE_REQUEST_ID_PATTERN.test(value)) {
    return `${value}.json`;
  }
  return `request-${receiptFilenameDigest(value)}.json`;
}

function createLegacyMailboxReceiptFilenameV1(requestId = '') {
  const value = String(requestId || '');
  if (
    LEGACY_WINDOWS_SAFE_REQUEST_ID_PATTERN.test(value)
    && !WINDOWS_RESERVED_DEVICE_BASENAME.test(value)
    && !value.endsWith('.')
  ) {
    return `${value}.json`;
  }
  return `request-${receiptFilenameDigest(value)}.json`;
}

export function getReadableMailboxReceiptFilenames(requestId = '') {
  const value = String(requestId || '');
  return Object.freeze([
    ...new Set([
      createWindowsSafeMailboxReceiptFilename(value),
      createLegacyMailboxReceiptFilenameV1(value),
      createLegacyMailboxReceiptFilenameV0(value),
    ]),
  ]);
}

export function isReadableMailboxReceiptFilename(filename = '', requestId = '') {
  return getReadableMailboxReceiptFilenames(requestId).includes(String(filename || ''));
}
