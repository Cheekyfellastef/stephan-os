function normalizeQuery(text = '') {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

const PROJECT_HINTS = [
  'stephanos',
  'mission console',
  'command deck',
  'codebase',
  'repo',
  'repository',
  'runtime',
  'provider',
  'routing',
  'localhost',
  'home-node',
  'memory',
  'panel',
  'tile',
  'workspace',
  'build',
  'verify',
];

const EXPLICIT_RETRIEVAL_HINTS = [
  'search local',
  'look in repo',
  'find in repo',
  'find in codebase',
  'retrieve from project',
  'from local docs',
  'from memory',
];

const TRIVIAL_GREETING_PATTERN = /^(hi|hello|hey|yo|good morning|good afternoon|good evening|thanks|thank you)[!. ]*$/i;
const SIMPLE_ARITHMETIC_PATTERN = /^(what is\s+)?\d+(\.\d+)?\s*([+\-*/x])\s*\d+(\.\d+)?\??$/i;
const TRIVIAL_WORLD_FACT_PATTERN = /\b(capital of|who is|what is|where is|when is)\b/i;

export function isProjectRelevantQuery(query = '') {
  const normalized = normalizeQuery(query).toLowerCase();
  if (!normalized) return false;
  return PROJECT_HINTS.some((hint) => normalized.includes(hint));
}

export function isExplicitRetrievalQuery(query = '') {
  const normalized = normalizeQuery(query).toLowerCase();
  if (!normalized) return false;
  return EXPLICIT_RETRIEVAL_HINTS.some((hint) => normalized.includes(hint));
}

export function isTrivialNonProjectQuery(query = '') {
  const normalized = normalizeQuery(query);
  if (!normalized) return true;
  if (isProjectRelevantQuery(normalized)) return false;
  if (TRIVIAL_GREETING_PATTERN.test(normalized)) return true;
  if (SIMPLE_ARITHMETIC_PATTERN.test(normalized)) return true;
  if (TRIVIAL_WORLD_FACT_PATTERN.test(normalized) && normalized.length <= 96) return true;
  return false;
}

