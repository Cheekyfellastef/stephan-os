# Stephanos Initial Ten-Question Proving Round V1

## Purpose

Advance #1308, #1290 and product programme #1776 from generic conversational capability contracts into the first canonical proving round that ChatGPT can send to Stephanos through the existing Shared Workspace conversation codec.

This slice defines the questions, issuance binding and fail-closed evaluation boundary. It does not fake a live exchange and it contains no expected answers or target conclusions.

## Canonical first-round identity

The first round is fixed to:

```text
roundId=stephanos-round-001
askerParticipantId=chatgpt-bridge
targetParticipantId=stephanos
roundNumber=1
```

Caller attempts to substitute any of those identities fail closed. The ten canonical capability classes remain:

```text
CURRENT_PROGRAMME_TRUTH
ARCHITECTURE_AND_RELATIONSHIPS
MEMORY_AND_CONTINUITY
AGENT_AND_TOOL_CAPABILITIES
BLOCKERS_AND_PROOF
WHY_A_DECISION_WAS_MADE
WHAT_CHANGED_RECENTLY
NEXT_BEST_ACTION
CROSS_DOMAIN_CONNECTION
SELF_KNOWLEDGE_AND_UNKNOWNS
```

The cross-domain probe asks what connections, if any, can actually be proven. It no longer seeds a conclusion that intelligence, VR Research and Spatial World Foundry necessarily compound toward Idea Planets.

## Existing contracts reused

The round reuses:

- #1774 `stephanosConversationalCapabilityLadderV1.mjs` for exact ten-question validation, epistemic state and gap classification;
- #1777 `stephanosSharedWorkspaceConversationAdapterV1.mjs` for existing Shared Workspace question/answer message records and evaluation;
- #1290 Shared Participant Question and Answer Fabric;
- #1308 as the canonical conversational intelligence owner.

No second conversation transport, chatbot, workspace, memory store, scheduler or gap queue is created.

## Packet issuance and proof binding

`buildInitialStephanosTenQuestionPacketV1()` requires caller-supplied canonical proof references. It then derives one deterministic `issuedPacketRef` from the exact canonical round, including its exact issuance timestamp, and places that reference into every one of the ten Shared Workspace question records.

The packet therefore carries both externally supplied proof references and a deterministic exact-round issuance binding. Creating the packet is still not proof that Stephanos received it.

Every question record retains:

```text
sourceMutationAllowed=false
commandExecutionAllowed=false
approvalAllowed=false
mergeAllowed=false
deploymentAllowed=false
```

The packet also explicitly reports:

```text
completionClaimAllowed=false
liveConversationClaimAllowed=false
```

## Answer evaluation boundary

Returned Shared Workspace answer records must bind to the exact `issuedPacketRef` for the round being evaluated. Grounded answer evidence references must also be present in the record proof set, and an answer timestamp may not predate the exact issued round timestamp.

This closes stale answer replay against a newly reconstructed round and prevents answer evidence strings from floating free of the Shared Workspace proof record.

The child slice deliberately does **not** invent an independent canonical evidence resolver. Even when ten answer records are structurally grounded and correctly bound to the issued packet, a would-be `SETTLED` result is converted to:

```text
state=SAFE_HOLD
refusalReason=independent-evidence-resolution-required
mayAdvanceToNovelRound=false
```

That is intentional. A participant cannot self-attest its own evidence references and thereby paint current, merged, live or authority-bearing claims green. A later live proving layer must resolve those references against independent canonical evidence before settlement can be exposed.

Buildable gaps and partial answers remain visible through the existing #1774 evaluator and continue to hold the ladder for repair/replay.

## Anti-gaming boundary

- Question payloads contain no expected answer text.
- The cross-domain question supplies no required synthesis conclusion.
- Canonical route and round identities cannot be overridden.
- Shared Workspace records require caller proof references.
- Answer records must carry the exact issued-round proof reference.
- Answer evidence references must be bound into the record proof set.
- Answers predating issuance fail closed.
- Structural groundedness alone cannot produce a settled-round claim.
- A genuine unknown or buildable gap remains visible.

## Focused proof

```bash
node --test shared/agents/stephanosConversationalCapabilityLadderV1.test.mjs shared/agents/stephanosSharedWorkspaceConversationAdapterV1.test.mjs shared/agents/stephanosInitialTenQuestionRoundV1.test.mjs
```

The child suite covers exact class diversity, non-seeded cross-domain probing, canonical identity rejection, caller proof requirements, ten-message fan-out, issued-packet proof binding, evidence-ref binding, stale replay rejection, pre-issuance answer rejection, independent-evidence safe hold, buildable-gap propagation, partial-answer repair/replay hold, missing-answer safe hold and exact timestamp validation.

## Truth boundary

This slice does not claim:

- ChatGPT has sent the packet through the live Shared Workspace transport;
- Stephanos has received it;
- Stephanos has produced ten real answers;
- independent canonical evidence resolution exists in this child slice;
- the first capability round has passed;
- peer-level intelligence acceptance has passed.

Those require a later live transport/correlation proving action using the existing #1506/#1290 route, real Stephanos responses and independently resolved proof evidence.

## Next product action

Once #1774/#1777/this slice are source-accepted, the next bounded proving action remains:

```text
LIVE_CHATGPT_TO_STEPHANOS_ROUND_001
```

The live path must submit the ten canonical records through Shared Workspace, collect ten correlated Stephanos answers, resolve their proof references against independent canonical evidence, classify every result, and feed any buildable miss into the existing question-gap flywheel without Stephan acting as courier.
