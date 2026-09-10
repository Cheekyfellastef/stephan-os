import { createHash } from 'node:crypto';
import { STEPHANOS_MEMORY_AUTHORITY_CLASS } from '../runtime/stephanosMemoryAdequacy.mjs';

export const STEPHANOS_EPISODIC_MEMORY_SCHEMA_VERSION = 'stephanos.episodic-memory.v1';
export const STEPHANOS_EPISODIC_MEMORY_PROJECTION_VERSION = 'stephanos.episodic-memory-projection.v1';
export const STEPHANOS_EPISODIC_MEMORY_MAX_EPISODES = 256;
export const STEPHANOS_EPISODIC_MEMORY_MAX_REFS = 24;

export const STEPHANOS_EPISODIC_MEMORY_FRESHNESS = Object.freeze([
  'FRESH', 'STALE', 'UNKNOWN', 'CONFLICTING',
]);
export const STEPHANOS_EPISODIC_MEMORY_STATES = Object.freeze([
  'CURRENT', 'SUPERSEDED', 'UNKNOWN',
]);

const AUTHORITY_CLASSES = new Set(Object.values(STEPHANOS_MEMORY_AUTHORITY_CLASS));
const FRESHNESS = new Set(STEPHANOS_EPISODIC_MEMORY_FRESHNESS);
const STATES = new Set(STEPHANOS_EPISODIC_MEMORY_STATES);
const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
const SAFE_REF = /^(?:issue|pr|goal|intent|episode|component|participant|surface|decision|correction|thread|receipt|evidence|workspace|memory|runtime|project):\/\/[a-z0-9][a-z0-9._:/#-]{0,220}$/i;
const SENSITIVE_TEXT = /\b(?:api[-_ ]?key|password|passwd|secret|bearer|authorization|private[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|cookie|session[-_ ]?cookie|raw prompt|raw response|psychological profile|mental diagnosis)\b/i;
const LOCAL_PATH = /(?:^|\s)(?:[A-Za-z]:\\|\\\\|\/home\/|\/Users\/|\/etc\/|\.\.\/|\.\.\\)/;
const LIST_FIELDS = Object.freeze([
  'participantIds', 'surfaceIds', 'intentRefs', 'goalRefs', 'prRefs', 'componentRefs',
  'decisionRefs', 'correctionRefs', 'openThreadRefs', 'sourceRefs', 'proofRefs',
  'causalParentEpisodeIds',
]);
const EPISODE_KEYS = Object.freeze([
  'schemaVersion', 'episodeId', 'observedAtUtc', 'summary', 'whyItMatters', 'outcome',
  'authorityClass', 'freshness', 'state', 'supersedes', 'supersededBy', ...LIST_FIELDS,
]);
const INPUT_KEYS = Object.freeze(['episodes']);
const INVALID = Symbol('invalid');

const AUTHORITY = Object.freeze({
  sourceMutationAllowed: false,
  memoryWriteAllowed: false,
  durablePromotionAllowed: false,
  correctionAllowed: false,
  forgetAllowed: false,
  providerPromptUseAllowed: false,
  commandExecutionAllowed: false,
  approvalAllowed: false,
  mergeAllowed: false,
  deploymentAllowed: false,
  runtimeMutationAllowed: false,
});

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactObject(value, expectedKeys) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return INVALID;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return INVALID;
    if (Object.getOwnPropertySymbols(value).length) return INVALID;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const actual = Object.keys(descriptors).sort(compareText);
    const expected = [...expectedKeys].sort(compareText);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) return INVALID;
    const output = Object.create(null);
    for (const key of expectedKeys) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) return INVALID;
      output[key] = descriptor.value;
    }
    return Object.freeze(output);
  } catch {
    return INVALID;
  }
}

function denseStringArray(value, maximum = STEPHANOS_EPISODIC_MEMORY_MAX_REFS) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return INVALID;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > maximum) return INVALID;
    if (Object.keys(descriptors).length !== length + 1) return INVALID;
    const output = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set || typeof descriptor.value !== 'string') return INVALID;
      output.push(descriptor.value);
    }
    return Object.freeze(output);
  } catch {
    return INVALID;
  }
}

function exactTimestamp(value) {
  if (typeof value !== 'string' || !value) return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function safeText(value, maximum) {
  return typeof value === 'string'
    && value === value.trim()
    && value.length > 0
    && value.length <= maximum
    && !SENSITIVE_TEXT.test(value)
    && !LOCAL_PATH.test(value);
}

function safeRef(value) {
  return typeof value === 'string' && SAFE_REF.test(value) && !value.includes('..') && !SENSITIVE_TEXT.test(value) && !LOCAL_PATH.test(value);
}

function safeRefList(values, field, errors, allowIds = false) {
  if (values === INVALID) {
    errors.push(`${field}-must-be-dense-bounded-string-array`);
    return [];
  }
  const output = [];
  for (const value of values) {
    const safe = allowIds ? SAFE_ID.test(value) : safeRef(value);
    if (!safe) errors.push(`${field}-contains-unsafe-ref`);
    else output.push(value);
  }
  if (new Set(output).size !== output.length) errors.push(`${field}-contains-duplicate`);
  return output;
}

function normalizeOptionalEpisodeId(value, field, errors) {
  if (value === null) return null;
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    errors.push(`${field}-invalid`);
    return null;
  }
  return value;
}

function normalizeEpisode(value, index) {
  const errors = [];
  const episode = exactObject(value, EPISODE_KEYS);
  if (episode === INVALID) return { episode: null, errors: [`episode-${index}:invalid-exact-data-shape`] };
  if (episode.schemaVersion !== STEPHANOS_EPISODIC_MEMORY_SCHEMA_VERSION) errors.push('schemaVersion-mismatch');
  if (!SAFE_ID.test(episode.episodeId || '')) errors.push('episodeId-invalid');
  if (!exactTimestamp(episode.observedAtUtc)) errors.push('observedAtUtc-invalid');
  for (const [field, maximum] of [['summary', 600], ['whyItMatters', 600], ['outcome', 600]]) {
    if (!safeText(episode[field], maximum)) errors.push(`${field}-invalid`);
  }
  const authorityClass = AUTHORITY_CLASSES.has(episode.authorityClass)
    ? episode.authorityClass : STEPHANOS_MEMORY_AUTHORITY_CLASS.UNKNOWN;
  if (!AUTHORITY_CLASSES.has(episode.authorityClass)) errors.push('authorityClass-invalid');
  const freshness = FRESHNESS.has(episode.freshness) ? episode.freshness : 'UNKNOWN';
  if (!FRESHNESS.has(episode.freshness)) errors.push('freshness-invalid');
  const state = STATES.has(episode.state) ? episode.state : 'UNKNOWN';
  if (!STATES.has(episode.state)) errors.push('state-invalid');
  const supersedes = normalizeOptionalEpisodeId(episode.supersedes, 'supersedes', errors);
  const supersededBy = normalizeOptionalEpisodeId(episode.supersededBy, 'supersededBy', errors);
  if (state === 'SUPERSEDED' && !supersededBy) errors.push('superseded-state-requires-supersededBy');
  if (state === 'CURRENT' && supersededBy) errors.push('current-state-cannot-have-supersededBy');

  const lists = Object.create(null);
  for (const field of LIST_FIELDS) {
    const values = denseStringArray(episode[field]);
    const allowIds = ['participantIds', 'surfaceIds', 'causalParentEpisodeIds'].includes(field);
    lists[field] = Object.freeze(safeRefList(values, field, errors, allowIds));
  }
  if (!lists.sourceRefs.length && !lists.proofRefs.length) errors.push('source-or-proof-ref-required');
  if (lists.causalParentEpisodeIds.includes(episode.episodeId)) errors.push('episode-cannot-cause-itself');

  const normalized = Object.freeze({
    episodeId: episode.episodeId,
    observedAtUtc: episode.observedAtUtc,
    observedAtMs: exactTimestamp(episode.observedAtUtc) ? Date.parse(episode.observedAtUtc) : 0,
    summary: episode.summary,
    whyItMatters: episode.whyItMatters,
    outcome: episode.outcome,
    authorityClass,
    freshness,
    state,
    supersedes,
    supersededBy,
    ...lists,
  });
  return { episode: normalized, errors: errors.map((error) => `episode-${index}:${error}`) };
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function projectionId(episodes) {
  return `episodic-${createHash('sha256').update(JSON.stringify(episodes)).digest('hex').slice(0, 32)}`;
}

export function buildStephanosEpisodicMemoryV1(input = {}) {
  const errors = [];
  const observed = exactObject(input, INPUT_KEYS);
  if (observed === INVALID) {
    return deepFreeze({
      schemaVersion: STEPHANOS_EPISODIC_MEMORY_PROJECTION_VERSION,
      projectionKind: 'READ_ONLY_EPISODIC_MEMORY',
      projectionId: '',
      verdict: 'SAFE_HOLD',
      episodes: [],
      chronology: [],
      causalEdges: [],
      currentEpisodeIds: [],
      supersededEpisodeIds: [],
      authority: AUTHORITY,
      valid: false,
      validationErrors: ['input-invalid-exact-data-shape'],
    });
  }

  let descriptors;
  try {
    if (!Array.isArray(observed.episodes) || Object.getPrototypeOf(observed.episodes) !== Array.prototype) throw new Error();
    descriptors = Object.getOwnPropertyDescriptors(observed.episodes);
    const length = descriptors.length?.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > STEPHANOS_EPISODIC_MEMORY_MAX_EPISODES || Object.keys(descriptors).length !== length + 1) throw new Error();
  } catch {
    errors.push('episodes-must-be-dense-bounded-array');
  }

  const episodes = [];
  if (descriptors && !errors.includes('episodes-must-be-dense-bounded-array')) {
    for (let index = 0; index < descriptors.length.value; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) {
        errors.push(`episode-${index}:must-be-own-enumerable-data-entry`);
        continue;
      }
      const normalized = normalizeEpisode(descriptor.value, index);
      errors.push(...normalized.errors);
      if (normalized.episode) episodes.push(normalized.episode);
    }
  }

  const ids = episodes.map((episode) => episode.episodeId);
  if (new Set(ids).size !== ids.length) errors.push('episodeIds-must-be-unique');
  const idSet = new Set(ids);
  for (const episode of episodes) {
    for (const parent of episode.causalParentEpisodeIds) if (!idSet.has(parent)) errors.push(`episode-${episode.episodeId}:causal-parent-not-present:${parent}`);
    if (episode.supersedes && !idSet.has(episode.supersedes)) errors.push(`episode-${episode.episodeId}:supersedes-not-present:${episode.supersedes}`);
    if (episode.supersededBy && !idSet.has(episode.supersededBy)) errors.push(`episode-${episode.episodeId}:supersededBy-not-present:${episode.supersededBy}`);
  }

  const chronology = [...episodes].sort((a, b) => a.observedAtMs - b.observedAtMs || compareText(a.episodeId, b.episodeId));
  const publicEpisodes = chronology.map(({ observedAtMs, ...episode }) => Object.freeze(episode));
  const causalEdges = [];
  for (const episode of chronology) for (const parentEpisodeId of episode.causalParentEpisodeIds) causalEdges.push(Object.freeze({ fromEpisodeId: parentEpisodeId, toEpisodeId: episode.episodeId }));
  causalEdges.sort((a, b) => compareText(a.fromEpisodeId, b.fromEpisodeId) || compareText(a.toEpisodeId, b.toEpisodeId));
  const uniqueErrors = [...new Set(errors)];
  return deepFreeze({
    schemaVersion: STEPHANOS_EPISODIC_MEMORY_PROJECTION_VERSION,
    projectionKind: 'READ_ONLY_EPISODIC_MEMORY',
    projectionId: uniqueErrors.length ? '' : projectionId(publicEpisodes),
    verdict: uniqueErrors.length ? 'SAFE_HOLD' : 'EPISODIC_MEMORY_PROJECTED',
    episodes: publicEpisodes,
    chronology: publicEpisodes.map((episode) => episode.episodeId),
    causalEdges,
    currentEpisodeIds: publicEpisodes.filter((episode) => episode.state === 'CURRENT').map((episode) => episode.episodeId),
    supersededEpisodeIds: publicEpisodes.filter((episode) => episode.state === 'SUPERSEDED').map((episode) => episode.episodeId),
    authority: AUTHORITY,
    valid: uniqueErrors.length === 0,
    validationErrors: uniqueErrors,
  });
}
