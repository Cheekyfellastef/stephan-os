# Spatial World Foundry M3 Isolated Agent Lanes V1

## Purpose

Advance #1760 from M1 contracts and M2 asset identity into the first multi-agent construction safety layer.

M3 does not create a VR-only scheduler, worker pool or lock service. It translates a valid Spatial Build Order into the existing canonical Stephanos bounded-construction admission and lease model.

## Existing machinery reused

M3 consumes:

- `spatialWorldFoundryContractsV1.mjs` for the governed build-order/resource-scope contract;
- `boundedParallelConstructionLanesV1.mjs` for duplicate detection, ownership conflict detection, capacity admission and canonical bounded construction leases;
- normal exact-head, proof, review and integration governance downstream.

The canonical lease schema remains:

```text
Stephanos Bounded Construction Lease V1
```

No competing spatial lease authority is introduced.

## Product flow

```text
Spatial Build Order
  -> validate exact governed build-order contract
  -> derive logical spatial resource contracts
  -> prepare one isolated construction-lane candidate
  -> submit candidate to existing construction admission
  -> non-overlapping scope: ADMITTED
  -> overlapping scope: SERIAL_QUEUE
  -> canonical construction authority issues exact bounded lease
  -> only then may the spatial agent begin sandbox writes
```

## Resource scopes

M3 translates #1760 scopes into canonical construction ownership contracts, for example:

```text
region:idea-planet-001/landing-bay
```

becomes:

```text
spatial-resource:region:idea-planet-001/landing-bay
```

The underlying construction admission already rejects overlapping owned contracts. This allows independent regions/assets to proceed concurrently while a second writer targeting the same resource is serialised.

M3 deliberately uses logical ownership contracts rather than pretending a spatial resource is a repository filesystem path.

## Sandbox identity

Each admitted build order receives deterministic logical identities for:

```text
laneId
sandboxId
```

These are derived from the build order, spatial scope, base source identity and branch. A sandbox identity does not itself create a filesystem, container, engine workspace or runtime process.

A later executor may realise that logical sandbox through an approved engine/runtime adapter, but it must retain the same build-order, lane, lease and resource-scope lineage.

## Write gate

Admission is not mutation authority.

Even when the existing construction admission returns `ADMITTED`, M3 reports:

```text
leaseIssueRequired=true
mayBeginAgentWrites=false
```

The product wrapper itself has:

```text
directWorkspaceWriteAllowed=false
sourceMutationAllowed=false
leaseIssueAllowed=false
leaseSeizureAllowed=false
mergeAllowed=false
deploymentAllowed=false
runtimeMutationAllowed=false
voiceExecutionAllowed=false
```

Before any agent write, the caller must present an exact `Stephanos Bounded Construction Lease V1` matching:

- admitted lane ID;
- branch;
- base and head source identity;
- exact owned spatial resource contracts;
- reservation ID;
- unexpired lease time;
- retained no-merge/no-deploy/no-approval/no-seizure/no-runtime-mutation boundaries.

An expired lease fails closed even when every other identity still matches.

## Parallel construction behavior

Two build orders with different non-overlapping spatial contracts can both be admitted, subject to the existing global construction capacity rules.

Two build orders claiming the same region, object, asset or other logical resource contract cannot both become active writers. The second plan remains waiting/serialised until canonical ownership is free and re-evaluated.

This provides the first product-level bridge from #1760's spatial resource scopes to the already-proven Stephanos parallel construction machinery.

## Authority-bearing capability rejection

A spatial lane cannot request construction capabilities such as:

```text
MERGE
DEPLOY
APPROVE
LEASE_SEIZE
RUNTIME_MUTATE
```

The original M1 build-order validator also retains its prohibition on raw voice execution and authority-bearing allowed operations.

## Focused proof

```bash
node --test shared/agents/spatialWorldFoundryContractsV1.test.mjs shared/agents/spatialWorldFoundryAssetRegistryV1.test.mjs shared/agents/spatialWorldFoundryIsolatedLaneV1.test.mjs
```

The M3 suite covers:

- translation into canonical construction admission;
- non-overlapping parallel spatial scopes;
- overlapping scope serialisation;
- missing inventory fail-closed behavior;
- authority-bearing capability rejection;
- write hold before canonical lease issuance;
- exact-scope lease binding;
- expired lease rejection;
- wrong-resource lease rejection.

## Truth boundary

M3 remains source-only planning and authority binding.

It does not claim:

- a real agent sandbox has been created;
- a mesh or texture generator has executed;
- any asset has been written to large-asset storage;
- a game engine has imported content;
- Quest 3 has previewed content;
- a world candidate has been promoted or made live.

Those remain later #1760 milestones.

## Next milestone

After M1-M3 are accepted, the next bounded product slice remains #1760 M4:

```text
one generated primitive asset enters the registry and preview state
```

That slice should use one canonical lease-bound isolated construction lane and retain provenance, content-address identity, validation and rollback lineage end to end.
