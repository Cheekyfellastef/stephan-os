import { resolveArtistIntelligence } from './musicArtistIntelligence.js';

export const MUSIC_DISCOVERY_CONNECTIONS_SCHEMA_VERSION = 'stephanos.music-discovery-connections.v1';
export const MUSIC_DISCOVERY_EVIDENCE_CLASSES = Object.freeze([
  'VERIFIED_CATALOGUE_EVIDENCE',
  'OPERATOR_TASTE_EVIDENCE',
  'LOCAL_SEED_INFERENCE',
]);

const MAX_CONNECTIONS = 8;
const MAX_EVIDENCE_RECORDS = 128;
const MAX_LOCAL_LIST_ITEMS = 64;
const SAFE_TEXT = /^[^\u0000-\u001f\u007f]{1,240}$/;
const INPUT_KEYS = new Set(['artistName', 'maxConnections', 'catalogueEvidence', 'tasteEvidence']);
const EVIDENCE_KEYS = new Set(['artistName', 'verified', 'sourceRef', 'reason']);

const CONTINUITY_POLICY = Object.freeze({
  replacesPlayerDom: false,
  changesCurrentTrack: false,
  changesRatings: false,
  changesTeachingState: false,
});

const CLAIM_BOUNDARY = Object.freeze({
  collaborationClaimsAllowed: false,
  labelClaimsAllowed: false,
  listeningHistoryClaimsAllowed: false,
  spotifyPlaybackClaimsAllowed: false,
});

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalized(value) {
  return text(value).toLowerCase();
}

function safeText(value) {
  const candidate = text(value);
  return SAFE_TEXT.test(candidate) ? candidate : '';
}

function snapshotPlainDataRecord(value, allowedKeys) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (Object.getPrototypeOf(value) !== Object.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== 'string' || !allowedKeys.has(key))) return null;
    const output = Object.create(null);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || descriptor.get || descriptor.set || !Object.hasOwn(descriptor, 'value')) return null;
      output[key] = descriptor.value;
    }
    return Object.freeze(output);
  } catch {
    return null;
  }
}

function snapshotDenseDataArray(value, maximumItems) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== 'string')) return null;
    const lengthDescriptor = descriptors.length;
    if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value')) return null;
    const length = lengthDescriptor.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > maximumItems) return null;
    if (keys.length !== length + 1) return null;
    const output = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !descriptor.enumerable || descriptor.get || descriptor.set || !Object.hasOwn(descriptor, 'value')) return null;
      output.push(descriptor.value);
    }
    return Object.freeze(output);
  } catch {
    return null;
  }
}

function safeEvidenceRecord(record) {
  const output = snapshotPlainDataRecord(record, EVIDENCE_KEYS);
  if (!output) return null;
  const artistName = safeText(output.artistName);
  const sourceRef = output.sourceRef == null ? '' : safeText(output.sourceRef);
  const reason = output.reason == null ? '' : safeText(output.reason);
  if (!artistName) return null;
  if (output.verified !== undefined && typeof output.verified !== 'boolean') return null;
  return Object.freeze({ artistName, verified: output.verified === true, sourceRef, reason });
}

function evidenceIndex(value) {
  const records = snapshotDenseDataArray(value, MAX_EVIDENCE_RECORDS);
  if (!records) return new Map();
  const index = new Map();
  const conflicted = new Set();
  for (const record of records) {
    const safe = safeEvidenceRecord(record);
    if (!safe) continue;
    const key = normalized(safe.artistName);
    if (conflicted.has(key)) continue;
    if (index.has(key)) {
      index.delete(key);
      conflicted.add(key);
      continue;
    }
    index.set(key, safe);
  }
  return index;
}

function sharedLanes(anchor, candidate) {
  const anchorLanes = snapshotDenseDataArray(anchor?.lanes, MAX_LOCAL_LIST_ITEMS) || [];
  const candidateLanes = snapshotDenseDataArray(candidate?.lanes, MAX_LOCAL_LIST_ITEMS) || [];
  const normalizedAnchorLanes = new Set(anchorLanes.map(normalized).filter(Boolean));
  return candidateLanes.filter((lane) => normalizedAnchorLanes.has(normalized(lane)));
}

function evidenceFor(candidateName, catalogue, taste) {
  const key = normalized(candidateName);
  const catalogueRecord = catalogue.get(key);
  if (catalogueRecord?.verified === true) {
    return Object.freeze({
      evidenceClass: 'VERIFIED_CATALOGUE_EVIDENCE',
      evidenceRef: catalogueRecord.sourceRef || '',
      evidenceReason: catalogueRecord.reason || 'Verified catalogue evidence supplied for this artist.',
      externallyVerified: true,
    });
  }
  const tasteRecord = taste.get(key);
  if (tasteRecord) {
    return Object.freeze({
      evidenceClass: 'OPERATOR_TASTE_EVIDENCE',
      evidenceRef: tasteRecord.sourceRef || '',
      evidenceReason: tasteRecord.reason || 'Operator-owned Music Tile taste evidence supplied for this artist.',
      externallyVerified: false,
    });
  }
  return Object.freeze({
    evidenceClass: 'LOCAL_SEED_INFERENCE',
    evidenceRef: '',
    evidenceReason: 'Local artist-intelligence seed suggests this discovery branch; it is not external verification.',
    externallyVerified: false,
  });
}

function whyInteresting(anchor, candidateName) {
  const candidateResult = resolveArtistIntelligence(candidateName);
  const overlap = sharedLanes(anchor, candidateResult.artist);
  if (overlap.length > 0) {
    return `Shares ${overlap.slice(0, 2).join(' and ')} with ${anchor.canonicalName}; explore the overlap without treating it as a collaboration or label claim.`;
  }
  return `Seeded as a discovery branch from ${anchor.canonicalName}; treat the connection as an inference until catalogue or operator-owned evidence strengthens it.`;
}

function unavailableResult(artistName, message) {
  return Object.freeze({
    schemaVersion: MUSIC_DISCOVERY_CONNECTIONS_SCHEMA_VERSION,
    status: 'EVIDENCE_UNAVAILABLE',
    anchorArtist: artistName,
    connections: Object.freeze([]),
    message,
    continuityPolicy: CONTINUITY_POLICY,
    claims: CLAIM_BOUNDARY,
  });
}

export function buildMusicDiscoveryConnections(input = {}) {
  const request = snapshotPlainDataRecord(input, INPUT_KEYS);
  if (!request) {
    return unavailableResult('', 'Discovery evidence was malformed and could not be inspected safely.');
  }

  const artistName = safeText(request.artistName);
  const requestedMaximum = Number.isSafeInteger(request.maxConnections) ? request.maxConnections : 6;
  const maxConnections = Math.min(MAX_CONNECTIONS, Math.max(1, requestedMaximum));
  const catalogue = evidenceIndex(request.catalogueEvidence);
  const taste = evidenceIndex(request.tasteEvidence);
  const resolved = resolveArtistIntelligence(artistName);
  const anchor = resolved.artist;

  if (!artistName || !anchor || resolved.status !== 'resolved') {
    return unavailableResult(
      artistName,
      artistName
        ? 'No governed local discovery connections are available for this artist yet.'
        : 'Choose an artist before asking for discovery connections.',
    );
  }

  const related = snapshotDenseDataArray(anchor.relatedArtists, MAX_LOCAL_LIST_ITEMS) || [];
  const seen = new Set();
  const connections = [];
  for (const rawCandidate of related) {
    const candidateName = safeText(rawCandidate);
    const key = normalized(candidateName);
    if (!candidateName || !key || key === normalized(anchor.canonicalName) || seen.has(key)) continue;
    seen.add(key);
    const evidence = evidenceFor(candidateName, catalogue, taste);
    connections.push(Object.freeze({
      artistName: candidateName,
      connectionType: 'DISCOVERY_BRANCH',
      whyInteresting: whyInteresting(anchor, candidateName),
      evidenceClass: evidence.evidenceClass,
      evidenceRef: evidence.evidenceRef,
      evidenceReason: evidence.evidenceReason,
      externallyVerified: evidence.externallyVerified,
      searchQuery: candidateName,
    }));
    if (connections.length >= maxConnections) break;
  }

  return Object.freeze({
    schemaVersion: MUSIC_DISCOVERY_CONNECTIONS_SCHEMA_VERSION,
    status: connections.length > 0 ? 'READY' : 'EVIDENCE_UNAVAILABLE',
    anchorArtist: anchor.canonicalName,
    connections: Object.freeze(connections),
    message: connections.length > 0
      ? 'Discovery connections are evidence-labelled. Inference remains visibly different from verified catalogue evidence.'
      : 'No governed discovery connections are available for this artist yet.',
    continuityPolicy: CONTINUITY_POLICY,
    claims: CLAIM_BOUNDARY,
  });
}
