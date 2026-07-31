import { createHash } from 'node:crypto';

const WINDOWS_SAFE_REQUEST_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{7,120}$/;
const WINDOWS_RESERVED_DEVICE_BASENAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export function createWindowsSafeMailboxReceiptFilename(requestId = '') {
  const value = String(requestId || '');
  if (
    WINDOWS_SAFE_REQUEST_ID_PATTERN.test(value)
    && !WINDOWS_RESERVED_DEVICE_BASENAME.test(value)
  ) {
    return `${value}.json`;
  }
  const digest = createHash('sha256').update(value).digest('hex').slice(0, 32);
  return `_request-${digest}.json`;
}
