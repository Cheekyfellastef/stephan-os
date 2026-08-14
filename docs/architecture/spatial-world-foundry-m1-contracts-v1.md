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

## Authority boundary

A voice utterance or selected in-world object is context, not mutation authority. Build-order `allowedOperations` fails closed if it contains authority-bearing operations such as merge, deploy, approval, lease seizure, runtime mutation, arbitrary shell or direct voice execution.

Build orders must declare at least one spatial resource scope using the future lease vocabulary:

- `planet:<id>`
- `region:<planet>/<region>`
- `object:<id>`
- `world-system:<id>`
- `asset:<id>`

This M1 slice validates scope identity only. It does not grant, seize or persist leases. Existing Stephanos lease and bounded-parallel-construction machinery remains the authority owner.

## Asset identity and large binaries

Every asset record requires a `sha256:<digest>` content identity. Metadata/source manifests may use repository-relative locations. Large binary locations are limited to provider-neutral governed references such as `cas://`, `lfs://` or `object://`; absolute personal filesystem locations are rejected by the contract.

This does not select Git LFS, object storage or a content-addressed storage implementation. That decision belongs to later #1760 milestones after evidence about scale and runtime needs.

## Promotion and rollback

The contract publishes the goal's explicit promotion ladder from `DRAFT` through tested candidate states to `LIVE_PROVEN`, with rejection and rollback states retained. Rollback scopes are explicit at asset, object, feature, region, planet and world-state levels.

A world snapshot binds:

- exact 40-character source head;
- world-manifest SHA-256;
- exact asset versions and hashes;
- runtime compatibility declarations;
- proof references;
- known-good status and rollback parent.

A clean source merge therefore cannot masquerade as a proven world state.

## Cross-record lineage

`validateSpatialWorldFoundryBundle()` fails closed when build order, asset, provenance and snapshot identities do not agree. This prevents an asset or snapshot from being substituted into unrelated mission lineage merely because each record is individually well formed.

## Focused proof

```bash
node --test shared/agents/spatialWorldFoundryContractsV1.test.mjs
```

The focused tests cover:

- one valid bounded candidate lineage;
- voice/authority bypass rejection;
- invalid resource scopes;
- unknown-field rejection;
- personal absolute-path rejection for large assets;
- exact-source and duplicate-asset snapshot rejection;
- cross-record lineage substitution.

## Next #1760 slices

After this contract is merged and independently proven, the next bounded work should stay on the existing programme rails:

1. M2 engine-neutral local asset registry plus content-addressed identity implementation;
2. M3 isolated agent sandbox and existing spatial/resource lease integration;
3. M4 one generated primitive asset admitted only to candidate/preview state;
4. M5 deterministic asset validation and promotion transition enforcement;
5. M6 semantic conflict validation in one simple test chamber.

No claim is made here that a spatial runtime, Idea Planet, headset voice path or live-world promotion is operational.