# Stephanos Identity, Relationship and Presence Kernel V1

## Purpose

This is the first source slice for the #1308 identity/presence amendment. It turns Stephanos identity from a model-owned prompt sentence into one versioned, provider-neutral canonical projection that every conversational embodiment can consume.

“Consciousness” in this engineering programme means coherent project awareness, continuity, self-model, relationship context, open threads and recognisable presence. This source does not claim subjective consciousness or human emotion.

## Contract

The kernel exposes the required identity fields:

- `identityVersion`
- `constitutionalValuesAndLawRefs`
- `relationshipRole`
- `enduringCharacter`
- `conversationalPrinciples`
- `intellectualStyle`
- `disagreementPolicy`
- `uncertaintyPolicy`
- `initiativePolicy`
- `humourAndPlayfulnessBounds`
- `currentGrowthEdges`

Identity is canonical Stephanos state. Providers and models may embody it but cannot silently redefine it. Core identity evolution requires a versioned reviewed source change.

## Boundaries

- #1645 remains the owner of durable memory, correction and forget semantics.
- #1630 remains the operator intent and authority contract.
- This kernel creates no second chatbot, memory store, scheduler, provider router or execution authority.
- It never fabricates intimacy, emotion, motives or remembered facts.
- Safety-critical and authority-bearing behaviour remains governed by existing deterministic contracts.

## Canonical chat integration

The canonical `/api/ai/chat` route consumes a compact prompt projection of the same kernel before memory and project context. Provider routing remains separate, so changing the underlying model does not change Stephanos identity.

## Focused proof

```bash
node --test shared/agents/stephanosIdentityPresenceKernelV1.test.mjs stephanos-server/routes/ai-identity-presence-wiring.test.js
```

Expected milestone:

```text
STEPHANOS_IDENTITY_RELATIONSHIP_AND_PRESENCE_KERNEL_V1
```
