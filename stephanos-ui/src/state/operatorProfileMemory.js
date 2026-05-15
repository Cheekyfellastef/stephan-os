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
  };
}

export function persistOperatorProfile(profile = {}, storage = globalThis.localStorage) {
  if (!storage?.setItem) return false;
  storage.setItem(OPERATOR_PROFILE_STORAGE_KEY, JSON.stringify(profile));
  return true;
}

export function readOperatorProfile(storage = globalThis.localStorage) {
  if (!storage?.getItem) return createEmptyOperatorProfile();
  const raw = storage.getItem(OPERATOR_PROFILE_STORAGE_KEY);
  if (!raw) return createEmptyOperatorProfile();
  try {
    const parsed = JSON.parse(raw);
    return { ...createEmptyOperatorProfile(), ...parsed, storageKey: OPERATOR_PROFILE_STORAGE_KEY, rawTranscriptStored: 'no' };
  } catch {
    return createEmptyOperatorProfile();
  }
}

export { OPERATOR_PROFILE_STORAGE_KEY, OPERATOR_PROFILE_VERSION };
