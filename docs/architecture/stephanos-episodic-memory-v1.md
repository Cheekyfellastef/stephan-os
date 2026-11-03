# Stephanos Episodic Memory V1

## Purpose

Advance #1645 by adding the first bounded `EPISODIC_MEMORY` contract on top of the existing Stephanos memory authority model. The contract reconstructs important attributable episodes without creating another memory database or storing unrestricted conversations.

## Scope

`shared/agents/stephanosEpisodicMemoryV1.mjs` accepts an explicit bounded set of already-observed episode projections and returns a deterministic read-only chronology plus causal lineage. Each episode can retain:

- what happened and why it matters later;
- participant and surface identities;
- intent, goal, PR, component, decision, correction and open-thread references;
- evidence/proof references;
- outcome and current-versus-superseded state;
- causal parent episode identities;
- existing memory authority and freshness classification.

The module reuses `STEPHANOS_MEMORY_AUTHORITY_CLASS` from the canonical Memory Adequacy contract. Missing or invalid authority is never upgraded to shared authority.

## Truth and privacy boundary

The projection is allowlisted and data-only. It rejects unsafe references, filesystem paths, credential-shaped or raw-context text, accessor/prototype tricks, dangling causal links and contradictory supersession state. Historical superseded episodes remain inspectable but are not reported as current truth.

This contract does not ingest raw chat logs, diagnose the operator, infer hidden motives or create a psychological profile.

## Authority boundary

Every authority flag is false. The contract grants no:

- memory write or durable promotion;
- correction or forget operation;
- source mutation or command execution;
- provider prompt authority;
- approval, merge or deployment authority;
- runtime mutation.

A valid projection is evidence-selection and continuity structure only.

## Focused proof

```bash
node --test shared/agents/stephanosEpisodicMemoryV1.test.mjs
```

The focused suite covers chronology, causal lineage, current-versus-superseded truth, unknown authority preservation, hostile references, dangling lineage, disallowed raw-context text, accessor-bearing input and zero mutation authority.

## Next #1645 slices

Later slices can consume this contract for relationship/open-thread reconstruction, semantic and prospective memory, reflection/consolidation and compact retrieval packs. Those later steps must continue to use the existing shared memory authority and correction/forget machinery rather than creating a second store.
