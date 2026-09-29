# Stephanos Identity, Relationship and Presence Kernel V1

## Outcome

This is the canonical source slice for #1308 — **Stephanos Project Intelligence & Conversational Understanding V1**, specifically its Identity, Relationship and Presence Kernel amendment.

The engineering target is one recognisable Stephanos across model, provider, device and surface changes. This is continuity, self-model and governed presence. It is not a claim of human emotion or subjective consciousness.

## Canonical identity

The kernel is source-controlled and versioned. It binds enduring identity to active Stephanos Laws and contains:

- relationship role;
- enduring character;
- conversational principles;
- intellectual style;
- disagreement, uncertainty and initiative policies;
- humour/playfulness bounds;
- current growth edges;
- provider/model/device ownership prohibitions;
- exact titled ownership links to #1645 — **Goal: Stephanos Durable Memory Fabric and Recall Adequacy V1**, #1308 — **Stephanos Project Intelligence & Conversational Understanding V1**, and #1630 — **Goal: Universal Intent Surface and Invisible Capability Routing V1**.

Only explicitly mutable growth edges may vary without an identity-version change. Rewritten enduring fields fail validation and are not projected into prompts.

## Live conversation wiring

The canonical `/api/ai/chat` route consumes the validated identity context before memory, goal and Project Intelligence context. The same kernel is also included in provider-router context and its identity version/provider-neutral status is exposed in execution metadata.

Provider routing remains separate from identity ownership. A local or hosted model can embody Stephanos but cannot redefine Stephanos.

## Boundaries

- #1645 — **Goal: Stephanos Durable Memory Fabric and Recall Adequacy V1** remains durable relationship-memory, correction and forget authority.
- #1630 — **Goal: Universal Intent Surface and Invisible Capability Routing V1** remains operator intent and authority owner.
- Existing deterministic safety, approval and proof contracts remain authoritative.
- No second chatbot, memory store, scheduler, provider router or authority plane is introduced.
- Operator-facing issue/goal/PR identifiers must retain exact current titles, or explicitly say title unavailable from current evidence.

## Focused proof

```bash
node --test shared/agents/stephanosIdentityPresenceKernelV1.test.mjs stephanos-server/routes/ai-identity-presence-wiring.test.js
```

Required milestone:

```text
STEPHANOS_IDENTITY_RELATIONSHIP_AND_PRESENCE_KERNEL_V1
```
