# Stephanos Memory Adequacy V1

Issue: #1645

## Purpose

Stephanos already has typed records, session memory, a local mirror, a shared-backend adapter, Shared Workspace receipts and several specialised memory consumers. Those parts are useful, but their presence alone does not prove that Stephanos can remember the operator, reconstruct the project, recover the machinery or distinguish shared truth from local intent.

Memory Adequacy V1 adds a read-only evidence model over those existing parts. It does not create another memory store.

## Required memory domains

The audit models seven separate domains:

1. session memory;
2. operator memory;
3. project and architecture memory;
4. goal and decision memory;
5. lessons and incident memory;
6. runtime and proof memory;
7. ephemeral working context.

The durable domains require fresh shared authority, non-empty authoritative record evidence, enforced retention, at least 80% retrieval coverage, proven deletion, converged conflict handling and proven backup or export.

## Authority classes

```text
SHARED_AUTHORITY
LOCAL_MIRROR
PENDING_LOCAL_INTENT
STALE_EVIDENCE
INFERRED
UNKNOWN
```

A local mirror is never promoted into shared authority. An observation older than its domain freshness bound is reclassified as stale even when it originally claimed shared authority.

## Shared Workspace connection

Repository source presence is not a live Shared Workspace connection.

The audit reports `sharedWorkspaceConnected=true` only when an explicit authority-bearing connection observation says `CONNECTED`, carries a source and proof reference, and is no more than 15 minutes old.

## Fresh-observer reconstruction

A fresh observer is ready to reconstruct Stephanos only when all of these domains are adequate:

- project and architecture memory;
- goal and decision memory;
- lessons and incident memory;
- runtime and proof memory.

This is the measurable memory layer beneath #1609. It does not replace #1609's full architectural self-reconstruction acceptance.

## Capacity and bounds

The V1 audit is bounded to:

- 5,000 observations;
- 1,000,000 records per observation;
- 512 MiB per observation;
- 32 proof references per observation;
- an explicit total capacity, defaulting to 1 GiB for source-model evaluation.

Crossing the declared capacity blocks the audit. Crossing 80% reports capacity pressure.

## Safety

- read-only model;
- no source, runtime or Shared Workspace mutation;
- no credentials, sessions, secrets or unrestricted logs;
- no inference of connection, durability or deletion from source presence;
- malformed or unsafe evidence blocks instead of being truncated into authority.

## First source proof

```bash
node --check shared/runtime/stephanosMemoryAdequacy.mjs
node --test shared/runtime/stephanosMemoryAdequacy.test.mjs
git diff --check
```

## Next live slice

The next implementation must build an adapter that gathers bounded observations from existing sources:

- `stephanosMemory` diagnostics and typed records;
- Shared Workspace status and receipts;
- GitHub machinery and goal inventories;
- Mission Operations and runtime-proof receipts;
- lesson and continuity records.

That adapter must preserve each source's authority, provenance and freshness. It must not flatten repository presence, local mirrors and live runtime proof into one optimistic status.
