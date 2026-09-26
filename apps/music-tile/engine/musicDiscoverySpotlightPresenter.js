import { buildMusicDiscoveryConnections } from './musicDiscoveryConnections.js';

export const MUSIC_DISCOVERY_SPOTLIGHT_SCHEMA_VERSION = 'stephanos.music-discovery-spotlight.v1';

const SURFACES = new Set(['DISCOVERY_SPOTLIGHT', 'LISTENING_ROOM']);
const INPUT_KEYS = new Set([
  'surface',
  'artistName',
  'maxCards',
  'catalogueEvidence',
  'tasteEvidence',
]);
const SAFE_TEXT = /^[^\u0000-\u001f\u007f]{1,240}$/;
const EVIDENCE_LABELS = Object.freeze({
  VERIFIED_CATALOGUE_EVIDENCE: 'Verified catalogue evidence',
  OPERATOR_TASTE_EVIDENCE: 'Your Music Tile evidence',
  LOCAL_SEED_INFERENCE: 'Local discovery inference',
});

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function safeText(value) {
  const candidate = text(value);
  return SAFE_TEXT.test(candidate) ? candidate : '';
}

function snapshotRequest(value) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (Object.getPrototypeOf(value) !== Object.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== 'string' || !INPUT_KEYS.has(key))) return null;
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

function unavailable(surface, message) {
  return Object.freeze({
    schemaVersion: MUSIC_DISCOVERY_SPOTLIGHT_SCHEMA_VERSION,
    surface,
    status: 'EVIDENCE_UNAVAILABLE',
    anchorArtist: '',
    headline: 'Discovery connection unavailable',
    message,
    cards: Object.freeze([]),
    continuityPolicy: Object.freeze({
      replacesPlayerDom: false,
      changesCurrentTrack: false,
      changesRatings: false,
      changesTeachingState: false,
    }),
  });
}

function cardFromConnection(connection) {
  return Object.freeze({
    cardType: 'MUSIC_DISCOVERY_CONNECTION',
    artistName: safeText(connection.artistName),
    title: safeText(connection.artistName),
    whyInteresting: safeText(connection.whyInteresting),
    evidenceClass: connection.evidenceClass,
    evidenceLabel: EVIDENCE_LABELS[connection.evidenceClass] || 'Evidence unavailable',
    evidenceReason: safeText(connection.evidenceReason),
    externallyVerified: connection.externallyVerified === true,
    action: Object.freeze({
      type: 'SEARCH_EXISTING_CATALOGUE',
      query: safeText(connection.searchQuery),
    }),
  });
}

export function buildMusicDiscoverySpotlightView(input = {}) {
  const request = snapshotRequest(input);
  if (!request) {
    return unavailable('DISCOVERY_SPOTLIGHT', 'Discovery presentation input was malformed and could not be inspected safely.');
  }

  const surfaceCandidate = text(request.surface).toUpperCase();
  const surface = SURFACES.has(surfaceCandidate) ? surfaceCandidate : 'DISCOVERY_SPOTLIGHT';
  const artistName = safeText(request.artistName);
  const requestedMaximum = Number.isSafeInteger(request.maxCards) ? request.maxCards : 4;
  const maxCards = Math.min(6, Math.max(1, requestedMaximum));
  const discovery = buildMusicDiscoveryConnections({
    artistName,
    maxConnections: maxCards,
    catalogueEvidence: request.catalogueEvidence,
    tasteEvidence: request.tasteEvidence,
  });

  if (discovery.status !== 'READY') {
    return Object.freeze({
      ...unavailable(surface, discovery.message),
      anchorArtist: safeText(discovery.anchorArtist),
      continuityPolicy: discovery.continuityPolicy,
    });
  }

  const cards = discovery.connections.slice(0, maxCards).map(cardFromConnection);
  return Object.freeze({
    schemaVersion: MUSIC_DISCOVERY_SPOTLIGHT_SCHEMA_VERSION,
    surface,
    status: cards.length > 0 ? 'READY' : 'EVIDENCE_UNAVAILABLE',
    anchorArtist: safeText(discovery.anchorArtist),
    headline: `Explore beyond ${safeText(discovery.anchorArtist)}`,
    message: discovery.message,
    cards: Object.freeze(cards),
    continuityPolicy: discovery.continuityPolicy,
    claims: discovery.claims,
  });
}
