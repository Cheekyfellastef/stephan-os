export const PR_ESTATE_SCHEMA_VERSION = 'stephanos.pr-estate.v1';
export const PR_ESTATE_KIND = 'stephanos.pr-estate.ledger';

export const PR_DISPOSITIONS = Object.freeze({
  ACTIVE_CANONICAL: 'ACTIVE_CANONICAL',
  WAITING_ACCEPTANCE: 'WAITING_ACCEPTANCE',
  WAITING_OPERATOR_APPROVAL: 'WAITING_OPERATOR_APPROVAL',
  RECOVER_UNIQUE_WORK: 'RECOVER_UNIQUE_WORK',
  SUPERSEDED: 'SUPERSEDED',
  ALREADY_IN_MAIN: 'ALREADY_IN_MAIN',
  PLACEHOLDER_FAILED: 'PLACEHOLDER_FAILED',
  AMBIGUOUS_REVIEW_REQUIRED: 'AMBIGUOUS_REVIEW_REQUIRED',
});

export const VALID_DISPOSITIONS = new Set(Object.values(PR_DISPOSITIONS));
export const TERMINAL_DISPOSITIONS = new Set([
  PR_DISPOSITIONS.SUPERSEDED,
  PR_DISPOSITIONS.ALREADY_IN_MAIN,
  PR_DISPOSITIONS.PLACEHOLDER_FAILED,
]);
export const PLACEHOLDER_PATTERN = /codex generated this pull request, but encountered an unexpected error after generation/i;
export const GENERIC_PLACEHOLDER_TITLE_KEY = 'codex generated pull request';
export const ACCEPTANCE_PENDING_PATTERN = /(?:acceptance|live proof|browser proof)[^\n]{0,120}(?:required|pending|remain(?:s|ing)?|needed|outstanding|awaiting|not yet)|(?:required|pending|awaiting|outstanding|needed|not yet)[^\n]{0,120}(?:acceptance|live proof|browser proof)/i;
export const ACCEPTANCE_COMPLETE_PATTERN = /(?:acceptance|live proof|browser proof)[^\n]{0,120}(?:passed|complete(?:d)?|satisfied|verified|done)|(?:passed|complete(?:d)?|satisfied|verified|done)[^\n]{0,120}(?:acceptance|live proof|browser proof)/i;
export const ACCEPTANCE_NEGATED_COMPLETE_PATTERN = /(?:acceptance|live proof|browser proof)[^\n]{0,120}\b(?:not(?:\s+yet)?|never)\s+(?:been\s+)?(?:passed|complete(?:d)?|satisfied|verified|done)|\b(?:not(?:\s+yet)?|never)\s+(?:been\s+)?(?:passed|complete(?:d)?|satisfied|verified|done)[^\n]{0,120}(?:acceptance|live proof|browser proof)/i;
export const APPROVAL_PENDING_PATTERN = /do not merge without[^\n]{0,120}approval|(?:approval)[^\n]{0,120}(?:required|pending|awaiting|outstanding|remain(?:s|ing)?|not yet)|(?:required|pending|awaiting|outstanding|remain(?:s|ing)?|not yet)[^\n]{0,120}(?:operator|exact[- ]head|explicit)?[^\n]{0,40}approval/i;
export const APPROVAL_COMPLETE_PATTERN = /(?:approval|merge gate)[^\n]{0,120}(?:granted|complete(?:d)?|satisfied|approved|done)|(?:granted|complete(?:d)?|satisfied|approved|done)[^\n]{0,120}(?:approval|merge gate)/i;
export const APPROVAL_NEGATED_COMPLETE_PATTERN = /(?:approval|merge gate)[^\n]{0,120}\b(?:not(?:\s+yet)?|never)\s+(?:been\s+)?(?:granted|complete(?:d)?|satisfied|approved|done)|\b(?:not(?:\s+yet)?|never)\s+(?:been\s+)?(?:granted|complete(?:d)?|satisfied|approved|done)[^\n]{0,120}(?:approval|merge gate)/i;
export const SAFE_FAMILY_ID = /^[a-z0-9][a-z0-9-]{0,100}$/;
export const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/i;

export function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function asText(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

export function asInteger(value, fallback = null) {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : fallback;
  if (typeof value !== 'string' || !/^-?\d+$/.test(value.trim())) return fallback;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

export function asPositiveInteger(value, fallback = null) {
  const parsed = asInteger(value, fallback);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function asBooleanOrNull(value) {
  return value === true ? true : (value === false ? false : null);
}

export function unique(values) {
  return [...new Set(values)];
}

export function readAliasedField(input, names) {
  const present = names
    .filter((name) => hasOwn(input, name))
    .map((name) => ({ name, value: input[name] }));
  if (!present.length) {
    return {
      present: false,
      value: undefined,
      name: '',
      aliases: [],
      conflicting: false,
    };
  }
  const [first] = present;
  return {
    present: true,
    value: first.value,
    name: first.name,
    aliases: present.map((item) => item.name),
    conflicting: present.some((item) => !Object.is(item.value, first.value)),
  };
}

export function normalizeLabels(labels) {
  if (!Array.isArray(labels)) return [];
  return unique(labels.map((label) => asText(label?.name ?? label, '')).filter(Boolean)).sort();
}

export function normalizeFiles(files) {
  if (!Array.isArray(files)) return [];
  return unique(files.map((file) => asText(file?.path ?? file?.filename ?? file, '')).filter(Boolean)).sort();
}
