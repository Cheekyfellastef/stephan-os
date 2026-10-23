// Derived source data for the fixed native inventory operation. The existing
// seed contracts remain canonical. This projection has no host, approval,
// source-ownership, merge or execution authority.
export const SEED_CANOPY_CANONICAL_INVENTORY_SCHEMA_V1 =
  'stephanos.seed-canopy-canonical-inventory.v1';

const fullMatch = (pattern, value) => typeof value === 'string'
  && pattern.exec(value)?.[0] === value;
const safeId = (value) => fullMatch(/^[a-z0-9][a-z0-9-]{2,79}$/, value);
function wellFormedUnicode(value) {
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xD800 && unit <= 0xDBFF) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xDC00 && next <= 0xDFFF)) return false;
    } else if (unit >= 0xDC00 && unit <= 0xDFFF) return false;
  }
  return true;
}
const safeSource = (value) => typeof value === 'string'
  && value.length > 0 && value.length <= 220 && wellFormedUnicode(value)
  && value === value.trim()
  && !value.includes('\\') && !value.includes('//')
  && !value.startsWith('/') && !value.endsWith('/')
  && !value.split('/').some((part) => !part || part === '.' || part === '..')
  && !/[\x00-\x1f:*?"<>|]/.test(value);

// Accept actual HIGH_LEVEL_FLYWHEEL_SEEDS_V1 from the canonical projection.
// Callers cannot turn this function or the serialized file into authentication.
export function buildSeedCanopyCanonicalInventoryV1(seeds) {
  if (!Array.isArray(seeds) || seeds.length < 1 || seeds.length > 64)
    throw new Error('SEED_CANOPY_PROJECTION_SEED_COUNT_INVALID');
  const seen = new Set();
  const rows = seeds.map((seed) => {
    if (!seed || !safeId(seed.seedId) || seen.has(seed.seedId)
      || typeof seed.title !== 'string' || !seed.title.trim() || seed.title.length > 2400
      || !wellFormedUnicode(seed.title) || seed.title.includes('\0')
      || typeof seed.issue !== 'string' || seed.issue.length > 80 || !fullMatch(/^#[0-9]+$/, seed.issue)
      || !safeSource(seed.source))
      throw new Error('SEED_CANOPY_PROJECTION_SEED_INVALID');
    seen.add(seed.seedId);
    // Match renderParallelSeedCanonicalInventoryV1 exactly: do not trim the
    // first rung or search later entries when the declared first rung is invalid.
    // Do not run RegExp.test on an untyped object: it invokes attacker-defined
    // toString/valueOf code before the projection has validated the candidate.
    // Null/missing remain the established INVENTORY fallback.
    const candidateRung = Array.isArray(seed.growthRungs) ? seed.growthRungs[0] : undefined;
    if (candidateRung !== undefined && candidateRung !== null
        && typeof candidateRung !== 'string')
      throw new Error('SEED_CANOPY_PROJECTION_RUNG_TYPE_INVALID');
    const firstRung = typeof candidateRung === 'string' && /^[A-Z0-9_]{3,90}$/.test(candidateRung)
      ? candidateRung : 'INVENTORY';
    if (!fullMatch(/^[A-Z0-9_]{3,90}$/, firstRung))
      throw new Error('SEED_CANOPY_PROJECTION_RUNG_TOKEN_INVALID');
    return Object.freeze({
      seedId: seed.seedId,
      title: seed.title,
      issue: seed.issue,
      source: seed.source,
      firstRung,
    });
  });
  return Object.freeze({
    schemaVersion: SEED_CANOPY_CANONICAL_INVENTORY_SCHEMA_V1,
    seeds: Object.freeze(rows),
  });
}

export function serializeSeedCanopyCanonicalInventoryV1(seeds) {
  return JSON.stringify(buildSeedCanopyCanonicalInventoryV1(seeds), null, 2) + '\n';
}
