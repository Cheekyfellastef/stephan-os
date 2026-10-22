// Source-test fixtures only. No production caller, filesystem write, process
// launch or authority assertion. Expected bytes come from the existing renderer.
import {
  PARALLEL_SEED_REQUEST_SCHEMA,
  renderParallelSeedCanonicalInventoryV1,
} from '../../runtime/seedCanopyParallelForgeV1.mjs';
import { buildSeedCanopyCanonicalInventoryV1 } from '../seedCanopyCanonicalInventoryV1.mjs';

export const SEED_CANOPY_INVENTORY_VECTORS_SCHEMA_V1 =
  'stephanos.seed-canopy-canonical-inventory-vectors.v1';

export function buildSeedCanopyInventoryGoldenVectorsV1(seeds) {
  buildSeedCanopyCanonicalInventoryV1(seeds);
  let sequence = 0;
  const makeCase = (name, seed, intent) => {
    const suffix = String(++sequence).padStart(2, '0');
    const manifest = Object.freeze({
      schemaVersion: PARALLEL_SEED_REQUEST_SCHEMA,
      seedId: seed.seedId,
      ownerIssue: seed.issue,
      contractSource: seed.source,
      taskId: 'native-inventory-' + suffix,
      intent,
      targetPath: 'docs/architecture/native-seed-inventory-' + suffix + '.md',
      expectedTargetSha256: null,
      baseSha: 'a'.repeat(40),
      testPaths: Object.freeze(['shared/runtime/seedCanopyParallelForgeV1.test.mjs']),
      reviewAuthority: 'PROTECTED_REVIEW_REQUIRED',
      sourceScopeApproval: 'EXACT_TARGET_ONLY',
      mergeAllowed: false,
      deployAllowed: false,
      runtimeMutationAllowed: false,
      generationMode: 'CANONICAL_INVENTORY_V1',
    });
    const rendered = renderParallelSeedCanonicalInventoryV1(manifest, seed);
    return Object.freeze({ name, manifest, expectedContent: rendered.content });
  };
  const cases = seeds.map((seed) => makeCase(
    'canonical:' + seed.seedId,
    seed,
    'Produce a source-only inventory draft from this declared canonical seed.',
  ));
  const seed = seeds[0];
  cases.push(
    makeCase('unicode-and-markdown-literals', seed,
      'Inventory café, 日本語 and 🛰️; preserve "quotes", \\backslash and \`code\`.'),
    makeCase('replace-cr-lf-tab-and-angle-brackets', seed,
      'First\r\nsecond\t<third>\nfourth'),
    makeCase('ecmascript-trim-includes-bom', seed,
      '\uFEFF\u2000 \tInventory with ECMAScript whitespace.\u00A0\u2028\uFEFF'),
    makeCase('ecmascript-trim-preserves-nel', seed,
      '\u0085Inventory preserves NEXT LINE as text.\u0085'),
    makeCase('maximum-intent-ascii', seed, 'x'.repeat(2400)),
    makeCase('maximum-intent-astral-pair-at-boundary', seed, 'x'.repeat(2398) + '🛰'),
    makeCase('maximum-intent-astral-pairs', seed, '🛰'.repeat(1200)),
  );
  return Object.freeze({
    schemaVersion: SEED_CANOPY_INVENTORY_VECTORS_SCHEMA_V1,
    cases: Object.freeze(cases),
  });
}

export function serializeSeedCanopyInventoryGoldenVectorsV1(seeds) {
  return JSON.stringify(buildSeedCanopyInventoryGoldenVectorsV1(seeds), null, 2) + '\n';
}
