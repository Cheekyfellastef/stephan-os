const PATCH_COURIER_VERSION = 'v1';
const DEFAULT_BEGIN_MARKER = 'BEGIN_DIFF_1290_PATCH_COURIER_BASE64';
const DEFAULT_END_MARKER = 'END_DIFF_1290_PATCH_COURIER_BASE64';

function toText(value = '', fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function toBase64(value = '') {
  return Buffer.from(String(value ?? ''), 'utf8').toString('base64');
}

function fromBase64(value = '') {
  return Buffer.from(String(value ?? ''), 'base64').toString('utf8');
}

function normalizeMarker(value, fallback) {
  return toText(value, fallback).replace(/\s+/g, '_').toUpperCase();
}

function hasBase64Only(value = '') {
  return /^[A-Za-z0-9+/]*={0,2}$/.test(String(value ?? ''));
}

export function buildPatchCourierPacket({
  diff = '',
  issue = '1290',
  label = 'PATCH_COURIER',
  beginMarker,
  endMarker,
} = {}) {
  const normalizedIssue = toText(issue, 'PATCH');
  const normalizedLabel = normalizeMarker(label, 'PATCH_COURIER');
  const normalizedBeginMarker = normalizeMarker(
    beginMarker,
    normalizedIssue === '1290'
      ? DEFAULT_BEGIN_MARKER
      : `BEGIN_DIFF_${normalizedIssue}_${normalizedLabel}_BASE64`,
  );
  const normalizedEndMarker = normalizeMarker(
    endMarker,
    normalizedIssue === '1290'
      ? DEFAULT_END_MARKER
      : `END_DIFF_${normalizedIssue}_${normalizedLabel}_BASE64`,
  );
  const payloadBase64 = toBase64(diff);

  return {
    version: PATCH_COURIER_VERSION,
    issue: normalizedIssue,
    label: normalizedLabel,
    beginMarker: normalizedBeginMarker,
    endMarker: normalizedEndMarker,
    payloadBase64,
    empty: String(diff ?? '').length === 0,
    packetText: [normalizedBeginMarker, payloadBase64, normalizedEndMarker].join('\n'),
  };
}

export function parsePatchCourierPacket(packetText = '') {
  const lines = String(packetText ?? '').trim().split(/\r?\n/);
  if (lines.length !== 3) {
    throw new Error('Patch Courier packet must contain exactly begin marker, base64 payload, and end marker lines.');
  }

  const [beginMarker, payloadBase64, endMarker] = lines.map((line) => line.trim());
  if (!beginMarker.startsWith('BEGIN_DIFF_')) {
    throw new Error('Patch Courier packet is missing a BEGIN_DIFF marker.');
  }
  if (!endMarker.startsWith('END_DIFF_')) {
    throw new Error('Patch Courier packet is missing an END_DIFF marker.');
  }
  if (!hasBase64Only(payloadBase64)) {
    throw new Error('Patch Courier payload must be base64 encoded.');
  }

  return {
    version: PATCH_COURIER_VERSION,
    beginMarker,
    endMarker,
    payloadBase64,
    diff: fromBase64(payloadBase64),
    empty: payloadBase64.length === 0,
  };
}

export function buildPatchCourierDiffCommand(paths = []) {
  const normalizedPaths = Array.isArray(paths)
    ? paths.map((path) => toText(path)).filter(Boolean)
    : [];
  const pathArgs = normalizedPaths.length > 0 ? ` -- ${normalizedPaths.join(' ')}` : '';
  return `git diff --binary${pathArgs} | base64 -w 0`;
}
