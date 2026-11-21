# Spatial World Foundry M7 Known-Good Snapshot & Multi-Level Rollback V1

Status: source-only, plan-only

## Purpose

Advance #1760 from semantic validation into the first explicit known-good snapshot and rollback proof layer. M7 reuses the canonical M1 `stephanos.spatial-world-snapshot.v1` contract rather than introducing a second snapshot registry, world store, promotion service, scheduler or runtime executor.

## Known-good snapshot contract

`buildSpatialKnownGoodSnapshotV1()` prepares one deterministic content-addressed known-good snapshot from exact engine-neutral world state:

- planet, rollback scope and scope identity;
- exact source head;
- world-state version and world-manifest SHA-256;
- immutable asset `<assetId, version, contentHash>` inventory;
- runtime compatibility declarations;
- optional rollback-parent snapshot identity;
- proof references and exact timestamp.

Asset ordering is canonicalized before identity generation so equivalent inventories produce the same snapshot identity. The generated snapshot is then validated by the existing M1 snapshot validator. The planner does not write or promote the snapshot.

## Multi-level rollback planning

`planSpatialRollbackV1()` accepts a current snapshot and an explicit known-good target snapshot and prepares bounded rollback intent for the first three proving scopes required by M7:

- `ASSET` restores only the named asset version present in the known-good snapshot;
- `REGION` requires an exact region-scope snapshot and restores its complete asset inventory;
- `WORLD_STATE` requires an exact world-state snapshot and restores its exact source head, manifest, asset inventory and runtime compatibility declaration.

Targets must be structurally valid, explicitly `knownGood=true`, belong to the same planet, differ from the current snapshot, and match the requested scope/identity. M7 deliberately does not infer a target, walk an unproven snapshot chain, mutate a registry, or execute restoration.

## Authority boundary

Every result is plan-only. M7 grants no snapshot write, rollback execution, source/asset/registry mutation, promotion, merge, deployment, runtime/world mutation, headset action or arbitrary-command authority.

Runtime restoration, live world changes and any consequential promotion remain separately authorized and separately proven through the existing Stephanos machinery.

## Proof direction

The focused deterministic suite covers canonical snapshot construction, content-addressed identity, hostile input rejection, asset rollback, region rollback, world-state rollback, known-good/planet/identity refusal and zero-authority invariants.
