# Spatial World Foundry M1 Contracts V1

Goal: #1760, **Spatial World Foundry and Voice-to-Asset Studio Pipeline V1**.

This slice establishes the first source-controlled contracts needed before spatial construction agents can create world content. It is deliberately engine-neutral and does not add a runtime, VR mutation path, scheduler, agent registry, storage service, voice recogniser, merge authority or deployment authority.

## Contracts

`shared/agents/spatialWorldFoundryContractsV1.mjs` defines four linked records:

1. `stephanos.spatial-build-order.v1`
2. `stephanos.spatial-asset-registry-record.v1`
3. `stephanos.spatial-provenance.v1`
4. `stephanos.spatial-world-snapshot.v1`

Together they bind an operator intent to one bounded construction order, an immutable asset identity, attributable provenance and an exact-source world snapshot.

## Reconstructed-record boundary

Every public validator first converts the complete supplied record into one recursively frozen data-only snapshot. Bundle validation observes the complete bundle once and consumes only that inert snapshot.

The boundary rejects, without invoking getters:

- accessor-backed object fields or array indexes;
- sparse arrays and arrays carrying hidden/custom properties;
- custom prototypes;
- cycles;
- symbol keys;
- `__proto__`, `prototype` and `constructor` entries;
- non-finite values;
- structures outside bounded depth, node, array, object-key and string limits.

Accepted strings used as identities must already be in their exact canonical spelling. Whitespace trimming, case folding or later normalization cannot turn a noncanonical registry key into accepted evidence.

## Authority boundary

A voice utterance or selected in-world object is context, not mutation authority. Build-order `allowedOperations` is an explicit safe allowlist:

```text
GENERATE_ASSET
WRITE_SANDBOX
RUN_VALIDATION
```

Unknown operations fail closed. Merge, deploy, approval, lease seizure, runtime mutation, arbitrary shell and direct voice execution cannot be admitted through alternate labels.

## Spatial ownership scopes

The general grammar recognises future spatial vocabulary such as planet, region, object, asset and world-system scopes, but M1 build orders can claim only identities that are already declared by the order itself:

```text
planet:<exact planetId>
region:<exact planetId>/<exact regionId>
object:<one declared objectId>
```

An unrelated planet, region or object fails closed. `asset:` and `world-system:` scopes remain unbound in this M1 order contract and therefore cannot be accepted as ownership claims yet.

This slice validates declarations only. It does not grant, seize or persist leases. Existing Stephanos lease and bounded-parallel-construction machinery remains the authority owner.

## Asset identity and large binaries

Every asset record requires a canonical `sha256:<digest>` content identity. Metadata/source manifests may use safe repository-relative locations. Large binary locations are limited to provider-neutral governed references:

```text
cas://
lfs://
object://
```

Absolute personal filesystem locations, path traversal and ordinary ungoverned relative binary paths are rejected.

This does not select Git LFS, object storage or a content-addressed storage implementation. That decision belongs to later #1760 milestones after evidence about scale and runtime needs.

## Provenance binding

Bundle validation binds provenance to the exact:

```text
build order
asset ID and version
creator agent
operator intent
spatial design-genome version
```

A well-formed provenance record cannot attribute the asset to another creator, intent or genome merely because its asset/version fields match.

## Promotion, snapshot lineage and rollback

The contract publishes the goal's explicit promotion ladder from `DRAFT` through tested candidate states to `LIVE_PROVEN`, with rejection and rollback states retained. Rollback scopes are explicit at asset, object, feature, region, planet and world-state levels.

A world snapshot binds:

- exact 40-character source head;
- world-manifest SHA-256;
- exact asset versions and hashes;
- runtime compatibility declarations;
- proof references;
- known-good status and rollback parent.

Every snapshot scope is also bound to the corresponding bundle lineage:

```text
ASSET      -> exact assetId
OBJECT     -> one declared objectId
FEATURE    -> one declared objectId in M1
REGION     -> exact regionId
PLANET     -> exact planetId
WORLD_STATE -> exact worldStateVersion
```

A clean source merge therefore cannot masquerade as a proven world state, and a snapshot for another asset/object/region/planet/world state cannot satisfy the bundle.

## Cross-record lineage

`validateSpatialWorldFoundryBundle()` fails closed when build order, asset, provenance and snapshot identities do not agree. It binds planet and region lineage, requires the snapshot to contain the exact asset version and content hash, and prevents substitution of individually valid records from unrelated work.

## Focused proof

```bash
node --test shared/agents/spatialWorldFoundryContractsV1.test.mjs
```

The focused tests cover:

- one valid bounded candidate lineage;
- explicit operation allowlisting and voice-authority rejection;
- typed and order-bound ownership scopes;
- unknown-field rejection;
- governed large-asset locations and traversal rejection;
- exact-source and duplicate-asset snapshot rejection;
- creator/intent/genome/planet/region lineage;
- all six snapshot scope bindings;
- accessor, custom-prototype, symbol, cycle and sparse-array rejection;
- canonical identity spelling;
- raw voice remaining context only.

Hosted exact-head checks and provider-neutral review remain authoritative for the published branch.

## Next #1760 slices

After this contract is merged and independently proven, the next bounded work should stay on the existing programme rails:

1. M2 engine-neutral local asset registry plus content-addressed identity implementation;
2. M3 isolated agent sandbox and existing spatial/resource lease integration;
3. M4 one generated primitive asset admitted only to candidate/preview state;
4. M5 deterministic asset validation and promotion transition enforcement;
5. M6 semantic conflict validation in one simple test chamber.

No claim is made here that a spatial runtime, Idea Planet, headset voice path or live-world promotion is operational.
