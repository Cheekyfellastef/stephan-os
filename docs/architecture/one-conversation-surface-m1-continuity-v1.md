# One Conversation Surface M1 — Continuity Contract V1

## Goal

Advance #1630 and umbrella product programme #1776 with the first bounded source contract for **one Stephanos conversation across replaceable surfaces and minds**.

This slice does not create another chatbot, identity store, memory store, scheduler, dispatcher, worker, mailbox, runtime service or provider route. It is a pure product continuity projection over existing durable Stephanos identity, mission, memory and Shared Workspace concepts.

## Operator outcome

The operator should experience:

```text
one Stephanos
one continuing intent
one continuing mission
many replaceable surfaces and specialist organs behind it
```

Changing from ChatGPT web to Battle Bridge desktop, Work, phone/tablet, WhatsApp, future voice or Quest presentation must not create a second private mission reality.

## M1 contract

`shared/agents/oneConversationSurfaceV1.mjs` defines a read-only continuity projection bound to:

- `stephanosIdentityVersion`;
- `operatorRelationshipContextRef`;
- `intentId`;
- `missionId`;
- `memoryAuthorityRef`;
- per-surface thread references;
- explicit proof references and freshness.

Supported presentation/execution surfaces are registered as bounded names. Their presence does not grant authority.

A surface observation may record the underlying model or execution organ for audit, but route identity is hidden from the normal projection by default. Provider substitution cannot replace Stephanos identity, mission, memory authority or operator relationship context.

## Conflict and freshness truth

The projection refuses to blend conflicting chat-local realities. A mismatch in identity, intent, mission, relationship context or memory authority becomes:

```text
EVIDENCE_CONFLICTING
```

Stale observations remain `STALE`. Missing or malformed evidence remains `UNKNOWN`. Cross-surface continuation is permitted only from a `CURRENT` projection with a proven source thread.

No model confidence or fluent prose can override those truth states.

## Shared Workspace reuse

M1 can project the current continuity state into the existing Shared Workspace `MESSAGE` kind using the existing `sharedAgentWorkspaceStore` validator.

The message is evidence and continuity context only. It carries no command, source-write, approval, merge, deployment or runtime-mutation authority.

The slice deliberately does not write to the store itself. Existing #1290/#1506 and their governed runtime paths remain responsible for actual transport and persistence.

## Authority boundary

Every projection and continuation plan retains:

```text
sourceMutationAllowed=false
commandExecutionAllowed=false
approvalAllowed=false
mergeAllowed=false
deploymentAllowed=false
runtimeMutationAllowed=false
```

Any attempted widening of these fields fails validation.

Voice and Quest 3 are presentation surfaces only at M1. They gain no direct shell, Git, Battle Bridge, runtime or approval authority.

## Focused proof

```bash
node --test shared/agents/oneConversationSurfaceV1.test.mjs
```

The focused tests cover:

1. one canonical intent/mission across ChatGPT web and Battle Bridge desktop;
2. provider/model substitution without Stephanos identity loss;
3. continuation to another authorised surface without manual summary courier work;
4. voice and Quest presentation with zero mutation authority;
5. fail-closed mission conflict;
6. authority-smuggling rejection;
7. stale evidence blocking continuation;
8. a valid read-only Shared Workspace continuity message;
9. rejection of unregistered competing front doors.

## Relationship to active product lanes

- #1774/#1777/#1783 own Stephanos conversational capability proving and the first ten-question round.
- #1779 owns VR Research participant Q&A.
- #1775 owns mixed Work/local execution routing and remains execution-route machinery, not the conversation identity contract.
- #1630 owns the seamless operator experience and cross-surface continuity acceptance.
- #1776 remains the product programme controller.

This M1 slice is intentionally additive and does not touch the files or ownership of those active lanes.

## Next product milestone

After source acceptance, the next bounded product slice should connect this projection to the existing #1506/#1290 message path so a real conversation can continue across at least two authorised surfaces while preserving the exact same intent, mission and Stephanos identity.

That later transport proof must reuse existing Shared Workspace machinery. It must not create a second conversation bus.

## Truth boundary

This source contract does **not** prove that ChatGPT web, Battle Bridge, WhatsApp, voice or Quest currently share a live conversation. It does not claim provider substitution has occurred in production. Runtime and cross-device acceptance remain separate evidence gates.
