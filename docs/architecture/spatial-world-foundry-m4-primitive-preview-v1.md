# Spatial World Foundry M4 Primitive Preview V1

## Purpose

This is the first bounded construction slice after the M1 contracts, M2 asset registry and M3 isolated-lane/lease bridge.

It plans exactly one deterministic primitive asset as a sandbox ghost-preview candidate. It does not generate a binary, write the sandbox, mutate the registry, import an engine asset, change the live world or promote anything.

## Preconditions

M4 requires:

1. a valid M1 Spatial Build Order permitting `GENERATE_ASSET`, `WRITE_SANDBOX` and `RUN_VALIDATION`;
2. a valid M2 registry for the same planet;
3. an admitted M3 isolated-lane plan for that exact build order;
4. an exact active `Stephanos Bounded Construction Lease V1` matching lane, branch, source identities and owned spatial contracts;
5. a bounded primitive specification.

The primitive vocabulary is deliberately tiny: box, sphere, cylinder or plane with finite dimensions, material hint and bounded transform.

## Deterministic candidate identity

The canonical primitive specification is serialized deterministically and SHA-256 hashed. The resulting M1 asset record uses that hash and canonical `cas://sha256/<hash>` content identity, remains `integrationState=DRAFT` and `liveState=NOT_LIVE`, and is checked through the existing M2 registration planner.

## Preview state

A successful M4 result is `PRIMITIVE_PREVIEW_CANDIDATE_PLANNED` with a `GHOST_CANDIDATE` / `SANDBOX_ONLY` preview descriptor.

An exact lease establishes that the canonical lane could perform its bounded sandbox operation. This planner still retains `primitiveGenerationExecutionAllowed=false` and `sandboxWriteExecutionAllowed=false`; no write occurs in this source slice.

## Next proof

After M2 and M3 are admitted in order, a separately authorised fixed executor can use this contract to generate one real primitive inside the isolated sandbox, emit the exact write/storage/validation receipts, and expose a non-live preview candidate for M5 validation. No live promotion is implied.
