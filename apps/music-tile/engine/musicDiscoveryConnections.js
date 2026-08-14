import { resolveArtistIntelligence } from './musicArtistIntelligence.js';

export const MUSIC_DISCOVERY_CONNECTIONS_SCHEMA_VERSION = 'stephanos.music-discovery-connections.v1';
export const MUSIC_DISCOVERY_EVIDENCE_CLASSES = Object.freeze([
  'VERIFIED_CATALOGUE_EVIDENCE',
  'OPERATOR_TASTE_EVIDENCE',
  'LOCAL_SEED_INFERENCE',
]);

const MAX_CONNECTIONS = 8;
const SAFE_TEXT = /^[^\u0000-\u001f\u007f]{1,240}$/;

const CONTINUITY_POLICY = Object.freeze({
  replacesPlayerDom: false,
  changesCurrentTrack: false,
  changesRatings: false,
  changesTeachingState: false,
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

function denseArray(value) {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}

function safeEvidenceRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  if (Object.getPrototypeOf(record) !== Object.prototype) return null;
  const descriptors = Object.getOwnPropertyDescriptors(record);
  const allowed = new Set(['artistName', 'verified', 'sourceRef', 'reason']);
  if (Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string' || !allowed.has(key))) return null;
  const output = {};
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable || descriptor.get || descriptor.set || !Object.hasOwn(descriptor, 'value')) return null;
    output[key] = descriptor.value;
  }
  const artistName = safeText(output.artistName);
  const sourceRef = output.sourceRef == null ? '' : safeText(output.sourceRef);
  const reason = output.reason == null ? '' : safeText(output.reason);
  if (!artistName) return null;
  if (output.verified !== undefined && typeof output.verified !== 'boolean') return null;
  return Object.freeze({ artistName, verified: output.verified === true, sourceRef, reason });
}

function evidenceIndex(value) {
  if (!denseArray(value)) return new Map();
  const index = new Map();
  for (const record of value) {
    const safe = safeEvidenceRecord(record);
    if (!safe) continue;
    index.set(normalized(safe.artistName), safe);
  }
  return index;
}

function sharedLanes(anchor, candidate) {
  const anchorLanes = new Set((anchor?.lanes || []).map(normalized).filter(Boolean));
  return (candidate?.lanes || []).filter((lane) => anchorLanes.has(normalized(lane)));
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

export function buildMusicDiscoveryConnections(input = {}) {
  const artistName = safeText(input.artistName);
  const requestedMaximum = Number.isSafeInteger(input.maxConnections) ? input.maxConnections : 6;
  const maxConnections = Math.min(MAX_CONNECTIONS, Math.max(1, requestedMaximum));
  const catalogue = evidenceIndex(input.catalogueEvidence);
  const taste = evidenceIndex(input.tasteEvidence);
  const resolved = resolveArtistIntelligence(artistName);
  const anchor = resolved.artist;

  if (!artistName || !anchor || resolved.status !== 'resolved') {
    return Object.freeze({
      schemaVersion: MUSIC_DISCOVERY_CONNECTIONS_SCHEMA_VERSION,
      status: 'EVIDENCE_UNAVAILABLE',
      anchorArtist: artistName,
      connections: Object.freeze([]),
      message: artistName
        ? 'No governed local discovery connections are available for this artist yet.'
        : 'Choose an artist before asking for discovery connections.',
      continuityPolicy: CONTINUITY_POLICY,
      claims: Object.freeze({ collaborationClaimsAllowed:false, labelClaimsAllowed:false, listeningHistoryClaimsAllowed:false, spotifyPlaybackClaimsAllowed:false }),
    });
  }

  const related = denseArray(anchor.relatedArtists) ? anchor.relatedArtists : [];
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
    claims: Object.freeze({ collaborationClaimsAllowed:false, labelClaimsAllowed:false, listeningHistoryClaimsAllowed:false, spotifyPlaybackClaimsAllowed:false }),
  });
}
