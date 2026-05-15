const OPERATOR_PROFILE_STORAGE_KEY = 'stephanos.operator.profile.v1';
const OPERATOR_PROFILE_VERSION = 'operator-profile.v1';

function asText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function sanitizeName(value) {
  const cleaned = asText(value).replace(/[^a-zA-Z\-'.\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  return cleaned.split(' ').map((part) => part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : '').join(' ').trim();
}

const NAME_PATTERNS = [
  /\bremember\s+my\s+name\s+is\s+([a-z][a-z\-'.\s]{0,50})/i,
  /\bmy\s+name\s+is\s+([a-z][a-z\-'.\s]{0,50})/i,
  /\bi\s+am\s+([a-z][a-z\-'.\s]{0,50})/i,
];

export function createEmptyOperatorProfile() {
  return {
    version: OPERATOR_PROFILE_VERSION,
    key: 'operator.identity.name',
    operatorName: '',
    known: false,
    source: 'none',
    confidence: 'unknown',
    updatedAt: '',
    nextAction: 'Ask operator for preferred name when relevant.',
    warnings: [],
    rawTranscriptStored: 'no',
    storageKey: OPERATOR_PROFILE_STORAGE_KEY,
    rehydrated: false,
    storageReadStatus: 'missing',
    lastReadAt: '',
    lastWriteAt: '',
  };
}

export function extractOperatorNameCandidate(message = '') {
  const raw = asText(message);
  if (!raw) return null;
  for (const pattern of NAME_PATTERNS) {
    const match = raw.match(pattern);
    if (!match?.[1]) continue;
    const operatorName = sanitizeName(match[1]);
    if (!operatorName) continue;
    const explicitRemember = /\bremember\b/i.test(raw);
    return {
      key: 'operator.identity.name',
      value: operatorName,
      source: 'operator explicit statement',
      confidence: explicitRemember ? 'high' : 'high',
      explicitRemember,
      class: 'operator-profile/durable-identity',
    };
  }
  return null;
}

export function updateOperatorProfileFromMessage(previousProfile = {}, message = '') {
  const base = { ...createEmptyOperatorProfile(), ...(previousProfile || {}) };
  const candidate = extractOperatorNameCandidate(message);
  if (!candidate) return base;
  return {
    ...base,
    key: candidate.key,
    operatorName: candidate.value,
    known: true,
    source: candidate.source,
    confidence: candidate.confidence,
    updatedAt: new Date().toISOString(),
    nextAction: 'Use operatorName in future responses when relevant.',
    warnings: [],
    rawTranscriptStored: 'no',
    storageKey: OPERATOR_PROFILE_STORAGE_KEY,
    rehydrated: false,
    storageReadStatus: 'success',
    lastReadAt: previousProfile?.lastReadAt || '',
    lastWriteAt: previousProfile?.lastWriteAt || '',
  };
}

export function persistOperatorProfile(profile = {}, storage = globalThis.localStorage) {
  if (!storage?.setItem) return false;
  const now = new Date().toISOString();
  const normalized = {
    ...createEmptyOperatorProfile(),
    ...(profile && typeof profile === 'object' ? profile : {}),
    storageKey: OPERATOR_PROFILE_STORAGE_KEY,
    rawTranscriptStored: 'no',
    lastWriteAt: now,
  };
  storage.setItem(OPERATOR_PROFILE_STORAGE_KEY, JSON.stringify(normalized));
  return true;
}

function normalizeStoredProfile(parsed = {}) {
  const normalized = { ...createEmptyOperatorProfile(), ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  const safeName = sanitizeName(normalized.operatorName);
  const known = Boolean(normalized.known && safeName);
  return {
    ...normalized,
    operatorName: known ? safeName : '',
    known,
    source: known ? String(normalized.source || 'operator explicit statement') : 'none',
    confidence: known ? String(normalized.confidence || 'high') : 'unknown',
    rawTranscriptStored: 'no',
    storageKey: OPERATOR_PROFILE_STORAGE_KEY,
  };
}

export function readOperatorProfile(storage = globalThis.localStorage) {
  const now = new Date().toISOString();
  if (!storage?.getItem) return { ...createEmptyOperatorProfile(), storageReadStatus: 'unavailable', lastReadAt: now };
  const raw = storage.getItem(OPERATOR_PROFILE_STORAGE_KEY);
  if (!raw) return { ...createEmptyOperatorProfile(), storageReadStatus: 'missing', lastReadAt: now };
  try {
    const parsed = JSON.parse(raw);
    const normalized = normalizeStoredProfile(parsed);
    return { ...normalized, rehydrated: normalized.known, storageReadStatus: 'success', lastReadAt: now };
  } catch {
    return { ...createEmptyOperatorProfile(), storageReadStatus: 'corrupt', lastReadAt: now };
  }
}

export { OPERATOR_PROFILE_STORAGE_KEY, OPERATOR_PROFILE_VERSION };
