# Spatial World Foundry M2 — Asset Registry and Content-Addressed Identity V1

## Purpose

This slice advances #1760 from individual M1 asset records into a deterministic engine-neutral asset registry.

It deliberately remains source-only and provider-neutral. It does not install Git LFS, object storage, a database, an asset server, a game engine integration, a runtime streamer or a new build scheduler.

## Product outcome

Stephanos can now reason about a planet's spatial assets as one coherent versioned registry rather than a pile of independent files.

The registry can answer deterministic questions such as:

```text
Which version of this asset is registered?
What is its immutable content address?
Does this version already exist?
Does its declared parent version exist?
Are all of its dependencies represented?
Would registration introduce a dependency cycle?
Would this reuse an existing identity with conflicting content?
Which logical asset versions point to the same physical content hash?
```

This is the M2 foundation for later provenance inspection, large-asset storage, isolated agent construction, preview promotion and rollback.

## Existing M1 contract reused

The registry consumes the asset records from:

`shared/agents/spatialWorldFoundryContractsV1.mjs`

Every registry entry must first pass `validateSpatialAssetRecord`.

M2 therefore inherits M1 requirements for:

- exact `sha256:` content hashes;
- asset, version, creator, build-order, planet and region identity;
- parent versions;
- source/influence references;
- licence and rights state;
- dependencies and dependents;
- engine/runtime compatibility;
- validation, promotion and live state;
- rollback references;
- provider-neutral source and large-asset locations.

## Registry contract

A registry contains:

```text
schemaVersion
registryId
planetId
sourceHead
generation
entries
createdAtUtc
```

The registry is bound to one planet and one exact 40-character source head.

Every entry is a complete M1 spatial asset record.

## Immutable logical identity

A version identity is:

```text
<assetId>@<version>
```

The same version identity may not appear twice in one registry.

A registration request for an already-identical record becomes:

```text
NOOP_ALREADY_REGISTERED
```

The same identity with different content or metadata becomes:

```text
BLOCKED_IDENTITY_CONFLICT
```

This prevents an agent from silently rewriting what `asset-tree-01@v1` means.

## Content-addressed physical identity

The canonical engine-neutral physical content address is derived from the M1 content hash:

```text
sha256:<64 hex>
        ↓
cas://sha256/<64 hex>
```

The registry does not claim the object is physically stored at that URI yet. It provides the immutable address that a later CAS, LFS or object-storage adapter can satisfy.

Multiple logical assets may intentionally share one content address. The content-address index preserves all logical identities rather than collapsing them into one asset.

## Parent-version lineage

When an asset declares:

```text
parentVersion = v1
```

then the same registry must already contain:

```text
<same assetId>@v1
```

A new version cannot invent a missing parent.

## Dependency integrity

Each dependency is an asset ID.

For a valid registry:

- every declared dependency must exist in the same planet registry;
- an asset may not depend on itself;
- dependency cycles fail closed.

This creates the first deterministic asset-graph integrity layer before semantic world validation in later Foundry milestones.

## Pure registration planner

`planSpatialAssetRegistration(registry, assetRecord)` never writes storage or source.

It returns one of:

```text
REGISTER
NOOP_ALREADY_REGISTERED
BLOCKED_INVALID_REGISTRY
BLOCKED_INVALID_ASSET
BLOCKED_PLANET_MISMATCH
BLOCKED_IDENTITY_CONFLICT
BLOCKED_MISSING_PARENT
BLOCKED_MISSING_DEPENDENCY
BLOCKED_DEPENDENCY_CYCLE
```

For a valid `REGISTER` plan it reports:

- immutable logical asset identity;
- exact content hash;
- canonical CAS address;
- current and next registry generation;
- deterministic candidate registry hash.

## Authority boundary

Every registration plan carries:

```text
storageWriteAllowed = false
sourceMutationAllowed = false
mergeAllowed = false
deploymentAllowed = false
runtimeMutationAllowed = false
```

M2 decides whether a registry transition is structurally admissible. It does not perform that transition in a live storage system.

## Focused proof

```bash
node --test shared/agents/spatialWorldFoundryContractsV1.test.mjs shared/agents/spatialWorldFoundryAssetRegistryV1.test.mjs
```

Coverage includes:

- valid registry identity;
- canonical content addresses;
- physical-content deduplication with distinct logical identities;
- pure authority-free registration plan;
- idempotent no-op versus identity conflict;
- parent-version requirements;
- dependency requirements;
- dependency-cycle rejection;
- planet-boundary and missing-parent rejection.

## Next Foundry milestone

M3 should connect these immutable asset/resource identities to isolated agent construction and existing Stephanos resource-lease machinery.

That next slice should still avoid direct live-world mutation. The first aim is to prove that two agents can safely own non-overlapping asset/resource scopes and produce independently attributable registry candidates under one known-good world state.
